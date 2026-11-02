import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { AppError } from '../../common/errors.js';
import type { Env } from '../../config/env.js';
import { voterKey } from '../ballots/voter-key.js';
import { canSeePoll, canViewResults } from '../polls/poll-access.js';
import { pollNotFound } from '../polls/poll-errors.js';
import { QUESTION_TYPES } from '../polls/poll-draft.schema.js';
import {
  type ElementRow,
  type PollAggregate,
  PollsRepository,
} from '../polls/polls.repository.js';
import {
  type ResultDisplay,
  resultDisplayOf,
} from '../polls/result-display.js';
import type { User } from '../users/users.repository.js';
import { applyKAnonymity, type GroupCounts } from './k-anonymity.js';
import { type Breakdown, ResultsRepository } from './results.repository.js';

const CACHE_SECONDS = 3;

export interface CachedResults {
  /** JSON body, already serialized */
  body: string;
  etag: string;
}

/** Raw counts, cached per poll and breakdown. Only answered elements/options. */
interface Tally {
  totalBallots: number;
  elements: {
    elementId: string;
    answered: number;
    options: { optionId: string; count: number }[];
  }[];
  breakdown?: {
    by: Breakdown;
    minGroupSize: number;
    groups: ReturnType<typeof applyKAnonymity>;
  };
  generatedAt: string;
}

@Injectable()
export class ResultsService {
  private readonly k: number;
  private readonly pepper: string;
  // Requests for the same results on this replica wait for one DB query.
  private readonly inFlight = new Map<string, Promise<Tally>>();

  constructor(
    private readonly polls: PollsRepository,
    private readonly repo: ResultsRepository,
    @Inject(Redis) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.k = config.get('RESULTS_MIN_GROUP_SIZE');
    this.pepper = config.get('VOTER_KEY_PEPPER');
  }

  async results(
    user: User,
    pollId: string,
    breakdown: Breakdown | 'none',
  ): Promise<CachedResults> {
    const agg = await this.polls.find(pollId, user);
    if (!agg || !canSeePoll(agg, user)) throw pollNotFound();
    const { poll } = agg;
    const staff = poll.ownerId === user.id || user.role === 'admin';
    const voted = staff || (await this.hasVoted(user, pollId));
    if (!canViewResults(poll, user, voted)) throw resultsHidden();
    // Per-group numbers would get around hidden counts: owner and admins only.
    if (!staff && breakdown !== 'none') throw resultsHidden();

    const tally = await this.tally(pollId, breakdown);
    const view = present(agg, tally, staff ? null : resultDisplayOf(poll));
    // ETag over the numbers only, so it stays stable while nothing changes.
    const etag = `W/"${createHash('sha1').update(JSON.stringify(view)).digest('base64url')}"`;
    return {
      body: JSON.stringify({ ...view, generatedAt: tally.generatedAt }),
      etag,
    };
  }

  async textAnswers(
    user: User,
    pollId: string,
    elementId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    const agg = await this.polls.find(pollId, user);
    if (!agg || !canSeePoll(agg, user)) throw pollNotFound();
    // Free text can identify people; only the owner and admins read it.
    if (agg.poll.ownerId !== user.id && user.role !== 'admin') {
      throw resultsHidden();
    }
    const el = agg.elements.find((e) => e.id === elementId);
    if (!el || el.type !== 'text_question') {
      throw new AppError(
        'ELEMENT_NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'No such text question in this poll',
      );
    }
    const after = cursor
      ? Buffer.from(cursor, 'base64url').toString()
      : undefined;
    return this.repo.textAnswers(pollId, elementId, after, limit);
  }

  /**
   * "ระบุคนส่ง": who answered what, a page at a time, for the owner and
   * admins of a poll that told its voters their id goes with the answers.
   */
  async responses(
    user: User,
    pollId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    const agg = await this.identifiedPoll(user, pollId);
    const page = await this.repo.responses(pollId, decodeCursor(cursor), limit);
    const last = page.ballots.at(-1);
    return {
      items: toResponses(agg, page),
      nextCursor:
        page.hasMore && last
          ? Buffer.from(
              JSON.stringify({
                t: last.submittedAt.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }

  /**
   * The same as a CSV file: one row per respondent, one column per question,
   * chosen options by label. Starts with a BOM so Excel reads Thai correctly.
   */
  async responsesCsv(user: User, pollId: string) {
    const agg = await this.identifiedPoll(user, pollId);
    const questions = agg.elements.filter((e) => QUESTION_TYPES.has(e.type));
    const labels = new Map(
      questions.flatMap((e) => e.options.map((o) => [o.id, o.label] as const)),
    );
    const lines = [
      [
        'รหัส',
        'เวลาที่ส่ง',
        ...questions.map((q, i) => q.title || `ข้อ ${i + 1}`),
      ],
    ];
    let after: { t: Date; id: string } | undefined;
    for (;;) {
      const page = await this.repo.responses(pollId, after, 1000);
      for (const r of toResponses(agg, page)) {
        const byElement = new Map(r.answers.map((a) => [a.elementId, a]));
        lines.push([
          r.code ?? '',
          r.submittedAt.toISOString(),
          ...questions.map((q) => {
            const a = byElement.get(q.id);
            if (!a) return '';
            return 'text' in a
              ? a.text
              : a.optionIds.map((id) => labels.get(id) ?? '').join(' | ');
          }),
        ]);
      }
      const last = page.ballots.at(-1);
      if (!page.hasMore || !last) break;
      after = { t: last.submittedAt, id: last.id };
    }
    return BOM + lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
  }

  private async identifiedPoll(user: User, pollId: string) {
    const agg = await this.polls.find(pollId, user);
    if (!agg || !canSeePoll(agg, user)) throw pollNotFound();
    if (agg.poll.ownerId !== user.id && user.role !== 'admin') {
      throw resultsHidden();
    }
    if (!agg.poll.identifySender) {
      throw new AppError(
        'SENDER_NOT_IDENTIFIED',
        HttpStatus.CONFLICT,
        'This poll does not identify who answered',
      );
    }
    return agg;
  }

  private async hasVoted(user: User, pollId: string) {
    const voted = await this.polls.votedPollIds([
      { pollId, key: voterKey(this.pepper, pollId, user.id) },
    ]);
    return voted.has(pollId);
  }

  private async tally(
    pollId: string,
    breakdown: Breakdown | 'none',
  ): Promise<Tally> {
    const key = `results:${pollId}:${breakdown}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as Tally;

    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.compute(pollId, breakdown)
        .then(async (r) => {
          await this.redis.set(key, JSON.stringify(r), 'EX', CACHE_SECONDS);
          return r;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private async compute(
    pollId: string,
    breakdown: Breakdown | 'none',
  ): Promise<Tally> {
    const [totals, grouped] = await Promise.all([
      this.repo.totals(pollId),
      breakdown === 'none' ? null : this.repo.byGroup(pollId, breakdown),
    ]);

    const elements = new Map<string, Tally['elements'][number]>();
    const entry = (elementId: string) => {
      let e = elements.get(elementId);
      if (!e) {
        e = { elementId, answered: 0, options: [] };
        elements.set(elementId, e);
      }
      return e;
    };
    for (const a of totals.answered) entry(a.elementId).answered = a.n;
    for (const o of totals.options) {
      entry(o.elementId).options.push({ optionId: o.optionId, count: o.n });
    }

    return {
      totalBallots: totals.totalBallots,
      elements: [...elements.values()],
      ...(grouped && breakdown !== 'none'
        ? {
            breakdown: {
              by: breakdown,
              minGroupSize: this.k,
              groups: applyKAnonymity(toGroups(grouped), this.k),
            },
          }
        : {}),
      generatedAt: new Date().toISOString(),
    };
  }
}

const CHOICE_TYPES = new Set(['single_choice', 'multi_choice', 'dropdown']);

/**
 * Every question of the poll in order, with unanswered options as 0.
 * Voters (`display` set) get only the published choice questions, and the
 * numbers the owner hid come back as null. `weight` (count ÷ the top
 * option's count) sizes bars and slices; a chart shows that much anyway.
 */
function present(
  agg: PollAggregate,
  tally: Tally,
  display: ResultDisplay | null,
) {
  const shown = (e: ElementRow) =>
    display === null
      ? QUESTION_TYPES.has(e.type)
      : CHOICE_TYPES.has(e.type) &&
        (display.elementIds === null || display.elementIds.includes(e.id));
  const showCount = display?.showCount ?? true;
  const showPercent = display?.showPercent ?? true;
  const showTotal = display?.showTotal ?? true;
  const counted = new Map(tally.elements.map((e) => [e.elementId, e]));

  return {
    // Lets a live results screen stop polling once the poll has closed.
    status: agg.poll.status,
    totalBallots: showTotal ? tally.totalBallots : null,
    elements: agg.elements.filter(shown).map((e) => {
      const t = counted.get(e.id);
      const answered = t?.answered ?? 0;
      const counts = new Map(t?.options.map((o) => [o.optionId, o.count]));
      const top = Math.max(0, ...counts.values());
      return {
        elementId: e.id,
        type: e.type,
        answered: showTotal ? answered : null,
        ...(CHOICE_TYPES.has(e.type)
          ? {
              options: e.options.map((o) => {
                const count = counts.get(o.id) ?? 0;
                return {
                  optionId: o.id,
                  count: showCount ? count : null,
                  percent: showPercent ? percentOf(count, answered) : null,
                  weight: top === 0 ? 0 : round(count / top, 3),
                };
              }),
            }
          : {}),
      };
    }),
    ...(display === null && tally.breakdown
      ? { breakdown: tally.breakdown }
      : {}),
  };
}

/** Share of the people who answered this question, 1 decimal. */
const percentOf = (count: number, answered: number) =>
  answered === 0 ? 0 : round((count / answered) * 100, 1);

function round(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function toGroups(grouped: Awaited<ReturnType<ResultsRepository['byGroup']>>) {
  const groups = new Map<string, GroupCounts>();
  for (const t of grouped.groupTotals) {
    groups.set(t.group, { group: t.group, total: t.n, counts: new Map() });
  }
  for (const c of grouped.counts) {
    const g = groups.get(c.group);
    if (!g) continue;
    const el = g.counts.get(c.elementId) ?? new Map<string, number>();
    el.set(c.optionId, c.n);
    g.counts.set(c.elementId, el);
  }
  // Biggest groups first; stable order for the ETag.
  return [...groups.values()].sort(
    (a, b) => b.total - a.total || a.group.localeCompare(b.group),
  );
}

type ResponsesPage = Awaited<ReturnType<ResultsRepository['responses']>>;

/** Ballots with their answers in question order (choices in option order). */
function toResponses(agg: PollAggregate, page: ResponsesPage) {
  const position = new Map(
    agg.elements.flatMap((e) => [
      [e.id, e.position] as const,
      ...e.options.map((o) => [o.id, o.position] as const),
    ]),
  );
  const at = (id: string) => position.get(id) ?? 0;
  return page.ballots.map((b) => {
    const chosen = new Map<string, string[]>();
    for (const c of page.choices) {
      if (c.ballotId !== b.id) continue;
      chosen.set(c.elementId, [...(chosen.get(c.elementId) ?? []), c.optionId]);
    }
    const answers: (
      | { elementId: string; optionIds: string[] }
      | { elementId: string; text: string }
    )[] = [
      ...[...chosen].map(([elementId, optionIds]) => ({
        elementId,
        optionIds: optionIds.sort((x, y) => at(x) - at(y)),
      })),
      ...page.texts
        .filter((t) => t.ballotId === b.id)
        .map((t) => ({ elementId: t.elementId, text: t.answer })),
    ];
    return {
      code: b.respondentCode,
      submittedAt: b.submittedAt,
      answers: answers.sort((x, y) => at(x.elementId) - at(y.elementId)),
    };
  });
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as {
      t?: unknown;
      id?: unknown;
    };
    return typeof c.t === 'string' && typeof c.id === 'string'
      ? { t: new Date(c.t), id: c.id }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Quoted when needed; a leading = + - @ is defused so Excel won't run it. */
// Excel needs it to read the file as UTF-8 (Thai).
const BOM = String.fromCharCode(0xfeff);

function csvCell(value: string) {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function resultsHidden() {
  return new AppError(
    'RESULTS_HIDDEN',
    HttpStatus.FORBIDDEN,
    'Results are not available to you yet',
  );
}
