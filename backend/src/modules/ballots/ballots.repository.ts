import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../infra/database/database.js';
import type { NormalizedBallot } from './answers.js';

export type SaveResult =
  | { kind: 'created' | 'updated'; submittedAt: Date }
  | { kind: 'closed' }
  | { kind: 'already_voted' };

@Injectable()
export class BallotsRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  /**
   * Inserts or replaces one voter's ballot. The poll row is locked FOR SHARE
   * and re-checked inside the transaction, so a vote can't land after the
   * poll closed, and owner/admin closing waits for in-flight votes.
   * Note: nothing here records who voted — only the pseudonymous voter key —
   * except `respondentCode` on polls that identify senders.
   */
  save(input: {
    pollId: string;
    voterKey: Buffer;
    allowEdit: boolean;
    facultyCode: string | null;
    studentYear: number | null;
    respondentCode: string | null;
    ballot: NormalizedBallot;
  }): Promise<SaveResult> {
    return this.db.transaction().execute(async (tx) => {
      const open = await tx
        .selectFrom('polls')
        .select('id')
        .where('id', '=', input.pollId)
        .where('status', '=', 'open')
        .where('closesAt', '>', sql<Date>`now()`)
        .where((eb) =>
          eb.or([
            eb('opensAt', 'is', null),
            eb('opensAt', '<=', sql<Date>`now()`),
          ]),
        )
        .forShare()
        .executeTakeFirst();
      if (!open) return { kind: 'closed' };

      const minute = sql<Date>`date_trunc('minute', now())`;
      const insert = tx.insertInto('ballots').values({
        pollId: input.pollId,
        voterKey: input.voterKey,
        facultyCode: input.facultyCode,
        studentYear: input.studentYear,
        respondentCode: input.respondentCode,
      });
      const row = await (
        input.allowEdit
          ? insert.onConflict((oc) =>
              oc.columns(['pollId', 'voterKey']).doUpdateSet({
                submittedAt: minute,
                facultyCode: input.facultyCode,
                studentYear: input.studentYear,
                respondentCode: input.respondentCode,
              }),
            )
          : insert.onConflict((oc) =>
              oc.columns(['pollId', 'voterKey']).doNothing(),
            )
      )
        // xmax = 0 only for a freshly inserted row (Postgres MVCC detail).
        .returning(['id', 'submittedAt', sql<boolean>`xmax = 0`.as('inserted')])
        .executeTakeFirst();
      if (!row) return { kind: 'already_voted' };

      if (!row.inserted) {
        await tx
          .deleteFrom('ballotChoices')
          .where('ballotId', '=', row.id)
          .execute();
        await tx
          .deleteFrom('ballotTextAnswers')
          .where('ballotId', '=', row.id)
          .execute();
      }
      if (input.ballot.choices.length > 0) {
        await tx
          .insertInto('ballotChoices')
          .values(
            input.ballot.choices.map((c) => ({
              ballotId: row.id,
              pollId: input.pollId,
              ...c,
            })),
          )
          .execute();
      }
      if (input.ballot.texts.length > 0) {
        await tx
          .insertInto('ballotTextAnswers')
          .values(
            input.ballot.texts.map((t) => ({
              ballotId: row.id,
              pollId: input.pollId,
              ...t,
            })),
          )
          .execute();
      }
      return {
        kind: row.inserted ? 'created' : 'updated',
        submittedAt: row.submittedAt,
      };
    });
  }

  async find(pollId: string, voterKey: Buffer) {
    const ballot = await this.db
      .selectFrom('ballots')
      .select(['id', 'submittedAt'])
      .where('pollId', '=', pollId)
      .where('voterKey', '=', voterKey)
      .executeTakeFirst();
    if (!ballot) return undefined;

    const [choices, texts] = await Promise.all([
      this.db
        .selectFrom('ballotChoices')
        .select(['elementId', 'optionId'])
        .where('ballotId', '=', ballot.id)
        .execute(),
      this.db
        .selectFrom('ballotTextAnswers')
        .select(['elementId', 'answer'])
        .where('ballotId', '=', ballot.id)
        .execute(),
    ]);
    return { submittedAt: ballot.submittedAt, choices, texts };
  }
}
