import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import {
  CunexClient,
  type CunexNotification,
  type CunexProfile,
  type NotificationReport,
} from './cunex.client.js';

// Fake students for local development and tests (CUNEX_MODE=mock).
// Token format: `mock_<key>`, e.g. mock_eng-2567. `mock_expired` simulates E002.
export const MOCK_CUNEX_USERS = {
  'eng-2567': {
    userId: '100000000000000001',
    studentId: '6730000121',
    staffId: null,
    facultyCode: '21',
    facultyNameTh: 'คณะวิศวกรรมศาสตร์',
    facultyNameEn: 'Faculty of Engineering',
    studentYear: 2567,
  },
  'med-2566': {
    userId: '100000000000000002',
    studentId: '6630000230',
    staffId: null,
    facultyCode: '30',
    facultyNameTh: 'คณะแพทยศาสตร์',
    facultyNameEn: 'Faculty of Medicine',
    studentYear: 2566,
  },
  'arts-2565': {
    userId: '100000000000000003',
    studentId: '6530000322',
    staffId: null,
    facultyCode: '22',
    facultyNameTh: 'คณะอักษรศาสตร์',
    facultyNameEn: 'Faculty of Arts',
    studentYear: 2565,
  },
  admin: {
    userId: '100000000000000099',
    studentId: '6430000923',
    staffId: null,
    facultyCode: '23',
    facultyNameTh: 'คณะวิทยาศาสตร์',
    facultyNameEn: 'Faculty of Science',
    studentYear: 2564,
  },
  staff: {
    userId: '100000000000000050',
    studentId: null,
    staffId: '10000050',
    facultyCode: '21',
    facultyNameTh: 'คณะวิศวกรรมศาสตร์',
    facultyNameEn: 'Faculty of Engineering',
    studentYear: null,
  },
} satisfies Record<string, CunexProfile>;

export type MockCunexUser = keyof typeof MOCK_CUNEX_USERS;

export const DEFAULT_MOCK_USER: MockCunexUser = 'eng-2567';

export function isMockCunexUser(key: string): key is MockCunexUser {
  return Object.hasOwn(MOCK_CUNEX_USERS, key);
}

@Injectable()
export class MockCunexClient extends CunexClient {
  getProfile(token: string): Promise<CunexProfile> {
    const key = token.startsWith('mock_') ? token.slice('mock_'.length) : '';
    if (!isMockCunexUser(key)) {
      return Promise.reject(
        new AppError(
          'CUNEX_TOKEN_INVALID',
          HttpStatus.UNAUTHORIZED,
          'CUNEX token is invalid or expired',
        ),
      );
    }
    return Promise.resolve({ ...MOCK_CUNEX_USERS[key] });
  }

  // Skips the CUNEX login page and goes straight to our callback, like CUNEX would.
  loginUrl({ mockUser }: { mockUser?: string }): string {
    const key =
      mockUser && isMockCunexUser(mockUser) ? mockUser : DEFAULT_MOCK_USER;
    return `/api/v1/auth/cunex/callback?token=mock_${key}`;
  }

  /** Everything "sent", for tests and the dev log. */
  readonly sentNotifications: CunexNotification[] = [];
  private readonly logger = new Logger('MockCunex');

  /** Tests: make createShareLink fail like the live gateway (no create_link). */
  failShareLinks = false;

  createShareLink(callbackUrl: string): Promise<string> {
    if (this.failShareLinks) {
      return Promise.reject(new Error('CUNEX create_link returned 404: null'));
    }
    const id = createHash('sha1').update(callbackUrl).digest('hex').slice(0, 8);
    return Promise.resolve(`https://cunex.page.link/mock-${id}`);
  }

  sendNotifications(items: CunexNotification[]): Promise<NotificationReport> {
    this.sentNotifications.push(...items);
    this.logger.log(`would notify ${items.length} CUNEX user(s)`);
    return Promise.resolve({ succeeded: items.length, failed: 0 });
  }
}
