import { HttpStatus, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import {
  CunexClient,
  type CunexNotification,
  type CunexProfile,
  type NotificationReport,
} from './cunex.client.js';

export interface LiveCunexConfig {
  gatewayUrl: string;
  loginUrl: string | null;
  clientId: string;
  clientSecret: string;
}

// GET {GATEWAY}/profile response. The live gateway differs from the LLE docs:
// the student id comes as `refId` (docs: `studentId`), and it adds userType,
// names, title and email, which we ignore. Anything odd in the optional
// fields becomes null rather than failing the login.
const loose = <T extends z.ZodType>(schema: T) => schema.nullish().catch(null);
const profileSchema = z.object({
  userId: z.string().min(1),
  userType: loose(z.string()),
  refId: loose(z.string()),
  studentId: loose(z.string()),
  facultyCode: loose(z.string().regex(/^\d{2}$/)),
  facultyNameTH: loose(z.string()),
  facultyNameEN: loose(z.string()),
  studentYear: loose(z.coerce.string().regex(/^\d{4}$/)),
});

// 417 + errorCode means the token itself is the problem, not CUNEX.
const TOKEN_ERRORS = new Set(['E002', 'E004']);

export class LiveCunexClient extends CunexClient {
  private readonly logger = new Logger(LiveCunexClient.name);

  constructor(private readonly cfg: LiveCunexConfig) {
    super();
  }

  async getProfile(token: string): Promise<CunexProfile> {
    const url = new URL('profile', withTrailingSlash(this.cfg.gatewayUrl));
    url.searchParams.set('token', token);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ClientId: this.cfg.clientId,
          ClientSecret: this.cfg.clientSecret,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      this.logger.error(
        `CUNEX /profile unreachable: ${(err as Error).message}`,
      );
      throw unavailable();
    }

    const body: unknown = await res.json().catch(() => null);

    // An unknown or used-up token comes back as 204 with no body.
    if (res.status === 204 || (res.ok && body === null)) {
      throw tokenInvalid();
    }

    if (res.status === 417) {
      const code = z.object({ errorCode: z.string() }).safeParse(body);
      if (code.success && TOKEN_ERRORS.has(code.data.errorCode)) {
        throw tokenInvalid();
      }
    }
    if (!res.ok) {
      this.logger.error(`CUNEX /profile returned ${res.status}`);
      throw unavailable();
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.error('CUNEX /profile returned an unexpected body');
      throw unavailable();
    }
    const p = parsed.data;
    const refId = p.refId ?? p.studentId ?? null;
    // refId is the student id (10 digits) for students and, we expect, the
    // staff id (8 digits) for staff. Anything else is not used for matching.
    const isStudent = !p.userType || /^stu/i.test(p.userType);
    return {
      userId: p.userId,
      studentId: refId && /^\d{10}$/.test(refId) ? refId : null,
      staffId: !isStudent && refId && /^\d{8}$/.test(refId) ? refId : null,
      facultyCode: p.facultyCode ?? null,
      facultyNameTh: p.facultyNameTH ?? '',
      facultyNameEn: p.facultyNameEN ?? '',
      studentYear: p.studentYear ? Number(p.studentYear) : null,
    };
  }

  loginUrl(): string | null {
    return this.cfg.loginUrl;
  }

  async createShareLink(callbackUrl: string): Promise<string> {
    const body = await this.post('create_link', { callbackUrl });
    const parsed = z
      .object({ status: z.literal('success'), shareUrl: z.url() })
      .safeParse(body);
    if (!parsed.success) {
      throw new Error(`CUNEX create_link failed: ${JSON.stringify(body)}`);
    }
    return parsed.data.shareUrl;
  }

  async sendNotifications(
    items: CunexNotification[],
  ): Promise<NotificationReport> {
    const body = await this.post('notification', {
      data: items.map((n) => ({
        userId: n.userId,
        text_TH: n.textTh,
        ...(n.textEn ? { text_EN: n.textEn } : {}),
        ...(n.callbackUrl ? { callbackUrl: n.callbackUrl } : {}),
      })),
    });
    const parsed = z
      .object({ summarySuccess: z.number(), summaryFailed: z.number() })
      .safeParse(body);
    if (!parsed.success) {
      throw new Error(`CUNEX notification failed: ${JSON.stringify(body)}`);
    }
    return {
      succeeded: parsed.data.summarySuccess,
      failed: parsed.data.summaryFailed,
    };
  }

  /** POST for the worker's calls. Errors throw so BullMQ retries the job. */
  private async post(path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(
      new URL(path, withTrailingSlash(this.cfg.gatewayUrl)),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ClientId: this.cfg.clientId,
          ClientSecret: this.cfg.clientSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body: unknown = await res.json().catch(() => null);

    // An unknown or used-up token comes back as 204 with no body.
    if (res.status === 204 || (res.ok && body === null)) {
      throw tokenInvalid();
    }
    if (!res.ok) {
      throw new Error(
        `CUNEX ${path} returned ${res.status}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }
}

function unavailable() {
  return new AppError(
    'CUNEX_UNAVAILABLE',
    HttpStatus.BAD_GATEWAY,
    'CUNEX is not reachable right now',
  );
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function tokenInvalid() {
  return new AppError(
    'CUNEX_TOKEN_INVALID',
    HttpStatus.UNAUTHORIZED,
    'CUNEX token is invalid or expired',
  );
}
