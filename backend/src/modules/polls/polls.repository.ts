import { Inject, Injectable } from '@nestjs/common';
import {
  type ExpressionBuilder,
  type Selectable,
  type Transaction,
  sql,
} from 'kysely';
import { Database } from '../../infra/database/database.js';
import type {
  DB,
  ElementOptions,
  PollElements,
  Polls,
  PollStatus,
} from '../../infra/database/db.js';
import type { User } from '../users/users.repository.js';
import { type AudienceRule, respondentCode } from './eligibility.js';
import type { PollDraftInput } from './poll-draft.schema.js';

export type PollRow = Selectable<Polls>;
export type ElementRow = Selectable<PollElements> & {
  options: Selectable<ElementOptions>[];
};
export interface PollAggregate {
  poll: PollRow;
  rules: AudienceRule[];
  /** Codes polls: the viewer given to find() is on the list. */
  listed: boolean;
  /** Codes polls: how many ids are on the list (the list itself: audienceCodes). */
  codeCount: number;
  elements: ElementRow[];
  reviews: { decision: string; comment: string | null; createdAt: Date }[];
}

export const EDITABLE: PollStatus[] = ['draft', 'rejected'];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface Cursor {
  t: string;
  id: string;
}

@Injectable()
export class PollsRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  async createDraft(ownerId: string, draft: PollDraftInput): Promise<string> {
    return this.db.transaction().execute(async (tx) => {
      const { id } = await tx
        .insertInto('polls')
        // createdAt from JS (ms precision) so keyset cursors, which carry ms,
        // compare exactly; DB now() has µs and would skip rows between pages.
        .values({ ownerId, createdAt: new Date(), ...pollColumns(draft) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeContent(tx, id, draft);
      return id;
    });
  }

  /**
   * Replaces the whole draft in one transaction. The row update is guarded by
   * owner, status and version, so a stale editor or a submitted poll can't be
   * overwritten. Returns false when the guard didn't match.
   */
  async replaceDraft(
    id: string,
    ownerId: string,
    expectedVersion: number,
    draft: PollDraftInput,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable('polls')
        .set({
          ...pollColumns(draft),
          version: sql`version + 1`,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .where('ownerId', '=', ownerId)
        .where('version', '=', expectedVersion)
        .where('status', 'in', EDITABLE)
        .where('deletedAt', 'is', null)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) return false;

      // Drafts have no ballots yet, so elements are simply rewritten.
      await tx
        .deleteFrom('pollAudienceRules')
        .where('pollId', '=', id)
        .execute();
      await tx
        .deleteFrom('pollAudienceCodes')
        .where('pollId', '=', id)
        .execute();
      await tx.deleteFrom('pollElements').where('pollId', '=', id).execute();
      await writeContent(tx, id, draft);
      return true;
    });
  }

  /**
   * The poll with its rules and content. `viewer` is who is asking: for a
   * codes poll it decides `listed`, without loading the whole list.
   */
  async find(id: string, viewer?: User): Promise<PollAggregate | undefined> {
    const poll = await this.db
      .selectFrom('polls')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!poll) return undefined;

    const code = viewer ? respondentCode(viewer) : null;
    const isCodes = poll.audience === 'codes';
    const [rules, elements, options, reviews, codes] = await Promise.all([
      this.db
        .selectFrom('pollAudienceRules')
        .select(['facultyCode', 'studentYear'])
        .where('pollId', '=', id)
        .orderBy('facultyCode')
        .orderBy('studentYear')
        .execute(),
      this.db
        .selectFrom('pollElements')
        .selectAll()
        .where('pollId', '=', id)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('elementOptions')
        .innerJoin(
          'pollElements',
          'pollElements.id',
          'elementOptions.elementId',
        )
        .selectAll('elementOptions')
        .where('pollElements.pollId', '=', id)
        .orderBy('elementOptions.position')
        .execute(),
      this.db
        .selectFrom('pollReviews')
        .select(['decision', 'comment', 'createdAt'])
        .where('pollId', '=', id)
        .orderBy('createdAt', 'desc')
        .execute(),
      isCodes
        ? this.db
            .selectFrom('pollAudienceCodes')
            .select([
              (eb) => eb.fn.countAll<string>().as('n'),
              sql<boolean>`bool_or(code = ${code ?? ''})`.as('listed'),
            ])
            .where('pollId', '=', id)
            .executeTakeFirstOrThrow()
        : null,
    ]);

    return {
      poll,
      rules,
      listed: !!code && !!viewer?.isChulaVerified && !!codes?.listed,
      codeCount: Number(codes?.n ?? 0),
      elements: elements.map((e) => ({
        ...e,
        options: options.filter((o) => o.elementId === e.id),
      })),
      reviews,
    };
  }

  /** The full id list of a codes poll, for its owner and admins. */
  async audienceCodes(id: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('pollAudienceCodes')
      .select('code')
      .where('pollId', '=', id)
      .orderBy('code')
      .execute();
    return rows.map((r) => r.code);
  }

  /** Moves a poll between states if (and only if) it is currently in `from`. */
  async transition(
    id: string,
    from: PollStatus[],
    set: Partial<
      Pick<
        PollRow,
        | 'status'
        | 'submittedAt'
        | 'openedAt'
        | 'opensAt'
        | 'closedAt'
        | 'closesAt'
        | 'closeReason'
        | 'deletedAt'
        | 'showResultsRealtime'
      > & { resultDisplay: string }
    >,
    actorId: string,
    action: string,
    ownerId?: string,
  ): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      let q = tx
        .updateTable('polls')
        .set({ ...set, updatedAt: new Date() })
        .where('id', '=', id)
        .where('status', 'in', from)
        .where('deletedAt', 'is', null);
      if (ownerId) q = q.where('ownerId', '=', ownerId);
      const res = await q.executeTakeFirst();
      if (res.numUpdatedRows === 0n) return false;

      await tx
        .insertInto('auditLogs')
        .values({
          actorId,
          action,
          entityType: 'poll',
          entityId: id,
          data: JSON.stringify(set),
        })
        .execute();
      return true;
    });
  }

  /** "หน้ารวม": listed, visible to this user, newest first. */
  async listFeed(
    user: User,
    status: 'open' | 'closed',
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<PollRow>> {
    const timeCol = status === 'open' ? 'openedAt' : 'closedAt';
    let q = this.db
      .selectFrom('polls')
      .selectAll()
      .where('status', '=', status)
      .where('listedPublicly', '=', true)
      .where('deletedAt', 'is', null)
      .where((eb) => eligibleFor(eb, user));
    const c = decodeCursor(cursor);
    if (c) {
      q = q.where((eb) =>
        eb(eb.refTuple(timeCol, 'id'), '<', eb.tuple(new Date(c.t), c.id)),
      );
    }
    const rows = await q
      .orderBy(timeCol, 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    return page(rows, limit, (r) => r[timeCol] ?? r.createdAt);
  }

  async listMine(
    ownerId: string,
    status: PollStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<PollRow>> {
    let q = this.db
      .selectFrom('polls')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('deletedAt', 'is', null);
    if (status) q = q.where('status', '=', status);
    const c = decodeCursor(cursor);
    if (c) {
      q = q.where((eb) =>
        eb(eb.refTuple('createdAt', 'id'), '<', eb.tuple(new Date(c.t), c.id)),
      );
    }
    const rows = await q
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .execute();
    return page(rows, limit, (r) => r.createdAt);
  }

  /** Which of these (poll, voter key) pairs already have a ballot. */
  async votedPollIds(pairs: { pollId: string; key: Buffer }[]) {
    if (pairs.length === 0) return new Set<string>();
    const rows = await this.db
      .selectFrom('ballots')
      .select('pollId')
      .where((eb) =>
        eb.or(
          pairs.map((p) =>
            eb.and([eb('pollId', '=', p.pollId), eb('voterKey', '=', p.key)]),
          ),
        ),
      )
      .execute();
    return new Set(rows.map((r) => r.pollId));
  }

  /** Number of questions (not content elements) per poll, for list cards. */
  async questionCounts(pollIds: string[]): Promise<Map<string, number>> {
    if (pollIds.length === 0) return new Map();
    const rows = await this.db
      .selectFrom('pollElements')
      .select(['pollId', (eb) => eb.fn.countAll<string>().as('n')])
      .where('pollId', 'in', pollIds)
      .where('type', 'in', [
        'text_question',
        'single_choice',
        'multi_choice',
        'dropdown',
      ])
      .groupBy('pollId')
      .execute();
    return new Map(rows.map((r) => [r.pollId, Number(r.n)]));
  }

  async unknownFaculties(codes: string[]): Promise<string[]> {
    if (codes.length === 0) return [];
    const known = await this.db
      .selectFrom('faculties')
      .select('code')
      .where('code', 'in', codes)
      .execute();
    const set = new Set(known.map((k) => k.code));
    return codes.filter((c) => !set.has(c));
  }

  listFaculties() {
    return this.db
      .selectFrom('faculties')
      .select(['code', 'nameTh', 'nameEn'])
      .orderBy('code')
      .execute();
  }
}

/** SQL twin of isEligible() in eligibility.ts. */
export function eligibleFor(eb: ExpressionBuilder<DB, 'polls'>, user: User) {
  const publicPoll = eb('polls.audience', '=', 'public');
  if (!user.isChulaVerified) return publicPoll;
  const code = respondentCode(user);
  return eb.or([
    publicPoll,
    eb('polls.audience', '=', 'chula'),
    ...(code
      ? [
          eb.and([
            eb('polls.audience', '=', 'codes'),
            eb.exists(
              eb
                .selectFrom('pollAudienceCodes as c')
                .select(sql.lit(1).as('one'))
                .whereRef('c.pollId', '=', 'polls.id')
                .where('c.code', '=', code),
            ),
          ]),
        ]
      : []),
    eb.exists(
      eb
        .selectFrom('pollAudienceRules as r')
        .select(sql.lit(1).as('one'))
        .whereRef('r.pollId', '=', 'polls.id')
        .where((r) =>
          r.and([
            r.or([
              r('r.facultyCode', 'is', null),
              r('r.facultyCode', '=', user.facultyCode ?? ''),
            ]),
            r.or([
              r('r.studentYear', 'is', null),
              r('r.studentYear', '=', user.studentYear ?? -1),
            ]),
          ]),
        ),
    ),
  ]);
}

function pollColumns(d: PollDraftInput) {
  return {
    title: d.title,
    description: d.description,
    coverImageUrl: d.coverImageUrl ?? null,
    opensAt: d.opensAt ? new Date(d.opensAt) : null,
    closesAt: d.closesAt ? new Date(d.closesAt) : null,
    audience: d.audience.type,
    showResultsRealtime: d.settings.showResultsRealtime,
    allowAnswerEdit: d.settings.allowAnswerEdit,
    listedPublicly: d.settings.listedPublicly,
    identifySender: d.settings.identifySender,
  };
}

async function writeContent(
  tx: Transaction<DB>,
  pollId: string,
  draft: PollDraftInput,
) {
  if (draft.audience.type === 'restricted') {
    // Identical rules would hit the unique key; they mean the same thing anyway.
    const seen = new Set<string>();
    const rules = draft.audience.rules
      .map((r) => ({
        pollId,
        facultyCode: r.facultyCode ?? null,
        studentYear: r.studentYear ?? null,
      }))
      .filter((r) => {
        const k = `${r.facultyCode}|${r.studentYear}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
    if (rules.length > 0) {
      await tx.insertInto('pollAudienceRules').values(rules).execute();
    }
  }

  if (draft.audience.type === 'codes' && draft.audience.codes.length > 0) {
    const codes = draft.audience.codes.map((code) => ({ pollId, code }));
    // Stay well under Postgres' 65k bind parameters per statement.
    for (let i = 0; i < codes.length; i += 1000) {
      await tx
        .insertInto('pollAudienceCodes')
        .values(codes.slice(i, i + 1000))
        .execute();
    }
  }

  for (const [position, el] of draft.elements.entries()) {
    const { id: elementId } = await tx
      .insertInto('pollElements')
      .values({
        pollId,
        position,
        type: el.type,
        title: 'title' in el ? el.title : '',
        isRequired: 'isRequired' in el ? el.isRequired : false,
        config: JSON.stringify(el.config),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if ('options' in el && el.options.length > 0) {
      await tx
        .insertInto('elementOptions')
        .values(
          el.options.map((o, i) => ({
            elementId,
            position: i,
            label: o.label,
            description: o.description ?? null,
            imageUrl: o.imageUrl ?? null,
            imageAlt: o.imageAlt ?? null,
            popup: o.popup ? JSON.stringify(o.popup) : null,
          })),
        )
        .execute();
    }
  }
}

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const c = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Cursor;
    return typeof c.t === 'string' && typeof c.id === 'string' ? c : null;
  } catch {
    return null;
  }
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
  time: (r: T) => Date,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    rows.length > limit && last
      ? Buffer.from(
          JSON.stringify({ t: time(last).toISOString(), id: last.id }),
        ).toString('base64url')
      : null;
  return { items, nextCursor };
}
