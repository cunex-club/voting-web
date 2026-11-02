import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { Database } from '../../infra/database/database.js';
import type { Users } from '../../infra/database/db.js';
import type { CunexProfile } from '../cunex/cunex.client.js';

export type User = Selectable<Users>;

export interface Me {
  id: string;
  role: User['role'];
  studentId: string | null;
  isChulaVerified: boolean;
  faculty: { code: string; nameTh: string; nameEn: string } | null;
  studentYear: number | null;
  providers: string[];
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class UsersRepository {
  constructor(@Inject(Database) private readonly db: Database) {}

  findById(id: string): Promise<User | undefined> {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Creates or refreshes the user behind a CUNEX login. Faculty and entry year
   * come from CUNEX every time, so a student who changes faculty is updated.
   * `grantAdmin` only ever promotes; it never removes an existing admin.
   */
  async upsertFromCunex(
    profile: CunexProfile,
    grantAdmin: boolean,
  ): Promise<User> {
    try {
      return await this.upsertFromCunexOnce(profile, grantAdmin);
    } catch (err) {
      // Two first logins racing: the loser hits the identity unique key. By now
      // the identity exists, so a second pass takes the update path.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        return this.upsertFromCunexOnce(profile, grantAdmin);
      }
      throw err;
    }
  }

  private upsertFromCunexOnce(
    profile: CunexProfile,
    grantAdmin: boolean,
  ): Promise<User> {
    return this.db.transaction().execute(async (tx) => {
      if (profile.facultyCode) {
        await tx
          .insertInto('faculties')
          .values({
            code: profile.facultyCode,
            nameTh: profile.facultyNameTh,
            nameEn: profile.facultyNameEn,
          })
          // Seeded names (0006) win; a login only adds a faculty we lack.
          .onConflict((oc) => oc.column('code').doNothing())
          .execute();
      }

      const identity = await tx
        .selectFrom('userIdentities')
        .select('userId')
        .where('provider', '=', 'cunex')
        .where('providerSubject', '=', profile.userId)
        .executeTakeFirst();

      const fields = {
        isChulaVerified: true,
        studentId: profile.studentId,
        staffId: profile.staffId,
        facultyCode: profile.facultyCode,
        studentYear: profile.studentYear,
        lastLoginAt: new Date(),
      };

      if (identity) {
        return tx
          .updateTable('users')
          .set(grantAdmin ? { ...fields, role: 'admin' } : fields)
          .where('id', '=', identity.userId)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      const user = await tx
        .insertInto('users')
        .values({ ...fields, role: grantAdmin ? 'admin' : 'user' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('userIdentities')
        .values({
          userId: user.id,
          provider: 'cunex',
          providerSubject: profile.userId,
        })
        .execute();
      return user;
    });
  }

  async getMe(id: string): Promise<Me | undefined> {
    const row = await this.db
      .selectFrom('users')
      .leftJoin('faculties', 'faculties.code', 'users.facultyCode')
      .select([
        'users.id',
        'users.role',
        'users.studentId',
        'users.isChulaVerified',
        'users.studentYear',
        'faculties.code as facultyCode',
        'faculties.nameTh as facultyNameTh',
        'faculties.nameEn as facultyNameEn',
      ])
      .where('users.id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;

    const providers = await this.db
      .selectFrom('userIdentities')
      .select('provider')
      .where('userId', '=', id)
      .orderBy('createdAt')
      .execute();

    return {
      id: row.id,
      role: row.role,
      studentId: row.studentId,
      isChulaVerified: row.isChulaVerified,
      faculty: row.facultyCode
        ? {
            code: row.facultyCode,
            nameTh: row.facultyNameTh ?? '',
            nameEn: row.facultyNameEn ?? '',
          }
        : null,
      studentYear: row.studentYear,
      providers: providers.map((p) => p.provider),
    };
  }
}
