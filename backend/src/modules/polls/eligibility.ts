import type { PollAudience } from '../../infra/database/db.js';
import type { User } from '../users/users.repository.js';

export interface AudienceRule {
  facultyCode: string | null;
  studentYear: number | null;
}

/**
 * Who may answer a poll. Public: anyone logged in. Chula: any CUNEX-verified
 * user. Restricted: CUNEX-verified users matching at least one rule; inside a
 * rule every set field must match. Codes: CUNEX-verified users whose student
 * or staff id is on the poll's list (`listed`, looked up by the repository).
 * Must stay in sync with `eligibleFor()` in polls.repository.ts (SQL version).
 */
export function isEligible(
  audience: PollAudience,
  rules: AudienceRule[],
  user: Pick<User, 'isChulaVerified' | 'facultyCode' | 'studentYear'>,
  listed = false,
): boolean {
  if (audience === 'public') return true;
  if (!user.isChulaVerified) return false;
  if (audience === 'chula') return true;
  if (audience === 'codes') return listed;
  return rules.some(
    (r) =>
      (r.facultyCode === null || r.facultyCode === user.facultyCode) &&
      (r.studentYear === null || r.studentYear === user.studentYear),
  );
}

/** The id a codes list or an identify-sender poll knows this user by. */
export const respondentCode = (user: Pick<User, 'studentId' | 'staffId'>) =>
  user.studentId ?? user.staffId;
