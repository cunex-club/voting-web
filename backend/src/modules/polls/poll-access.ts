import type { PollAudience } from '../../infra/database/db.js';
import type { User } from '../users/users.repository.js';
import { isEligible } from './eligibility.js';
import type { PollAggregate, PollRow } from './polls.repository.js';
import { resultDisplayOf } from './result-display.js';

/** Only polls for all of Chula wait for an admin; the rest go straight to approved. */
export const needsReview = (audience: PollAudience) => audience === 'chula';

const isStaff = (poll: PollRow, user: User) =>
  poll.ownerId === user.id || user.role === 'admin';

/**
 * Owner and admins see every status; everyone else only published polls they
 * may answer, unless an admin took the poll down. Callers answer 404 (not 403)
 * when this is false, so poll ids can't be probed. `agg` must come from
 * `find(id, user)` for codes polls to be seen by the people on the list.
 */
export function canSeePoll(agg: PollAggregate, user: User): boolean {
  if (isStaff(agg.poll, user)) return true;
  // Taken down by an admin: gone for everyone but the owner and admins.
  if (agg.poll.takenDownAt) return false;
  const published = agg.poll.status === 'open' || agg.poll.status === 'closed';
  return (
    published && isEligible(agg.poll.audience, agg.rules, user, agg.listed)
  );
}

/**
 * Owner/admin always. Voters only while the owner keeps results published:
 * once voting has ended, or live (realtime) after they have answered, so
 * early results don't sway their own vote.
 */
export function canViewResults(
  poll: PollRow,
  user: User,
  hasVoted: boolean,
): boolean {
  if (isStaff(poll, user)) return true;
  if (!resultDisplayOf(poll).published) return false;
  if (hasVotingEnded(poll)) return true;
  return poll.status === 'open' && poll.showResultsRealtime && hasVoted;
}

/** Published with a scheduled opening that hasn't come yet. */
export function isBeforeOpening(poll: PollRow, now = new Date()): boolean {
  return poll.status === 'open' && !!poll.opensAt && poll.opensAt > now;
}

/** Voting is open: status open, past opensAt and the deadline not yet reached. */
export function isAcceptingVotes(poll: PollRow, now = new Date()): boolean {
  return (
    poll.status === 'open' &&
    !isBeforeOpening(poll, now) &&
    !!poll.closesAt &&
    poll.closesAt > now
  );
}

/** Closed, or still `open` past its deadline before the worker caught up. */
export function hasVotingEnded(poll: PollRow, now = new Date()): boolean {
  return (
    poll.status === 'closed' ||
    (poll.status === 'open' && (!poll.closesAt || poll.closesAt <= now))
  );
}

/** Closed by the owner (or an admin) before closesAt. */
export function wasClosedEarly(poll: PollRow): boolean {
  return (
    poll.status === 'closed' &&
    !!poll.closedAt &&
    !!poll.closesAt &&
    poll.closedAt < poll.closesAt
  );
}
