import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors.js';
import type { Env } from '../../config/env.js';
import type { PollStatus } from '../../infra/database/db.js';
import { voterKey } from '../ballots/voter-key.js';
import { ImagesService } from '../images/images.service.js';
import type { User } from '../users/users.repository.js';
import { findProblems } from './completeness.js';
import { imageRefs } from './poll-images.js';
import {
  canSeePoll,
  canViewResults,
  isAcceptingVotes,
  needsReview,
} from './poll-access.js';
import {
  closesAtPassed,
  invalidOpensAt,
  pollLocked as locked,
  pollNotFound as notFound,
} from './poll-errors.js';
import { PollJobs } from './poll-jobs.js';
import type { PollDraftInput } from './poll-draft.schema.js';
import type { ResultDisplay } from './result-display.js';
import {
  EDITABLE,
  type PollAggregate,
  type PollRow,
  PollsRepository,
} from './polls.repository.js';
import {
  type MyBallot,
  toDetail,
  toPreview,
  toDraftInput,
  toSummary,
} from './polls.view.js';

@Injectable()
export class PollsService {
  private readonly pepper: string;

  constructor(
    private readonly repo: PollsRepository,
    private readonly jobs: PollJobs,
    private readonly images: ImagesService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('VOTER_KEY_PEPPER');
  }

  async create(user: User, draft: PollDraftInput) {
    await this.checkReferences(user, draft);
    const id = await this.repo.createDraft(user.id, draft);
    return this.get(user, id);
  }

  async replace(
    user: User,
    id: string,
    version: number,
    draft: PollDraftInput,
  ) {
    await this.checkReferences(user, draft);
    if (await this.repo.replaceDraft(id, user.id, version, draft)) {
      return this.get(user, id);
    }
    // The guarded update matched nothing: work out which guard failed.
    const { poll } = await this.owned(user, id);
    if (!EDITABLE.includes(poll.status)) throw locked(poll.status);
    throw new AppError(
      'VERSION_CONFLICT',
      HttpStatus.PRECONDITION_FAILED,
      'The poll was changed since you loaded it',
      { currentVersion: poll.version },
    );
  }

  async get(user: User, id: string) {
    const agg = await this.repo.find(id);
    if (!agg || !canSeePoll(agg, user)) throw notFound();
    const { poll } = agg;
    const isOwner = poll.ownerId === user.id;

    const [myBallot] = await this.myBallots(user, [poll]);
    return toDetail(agg, {
      isOwner,
      canSeeReviews: isOwner || user.role === 'admin',
      myBallot: myBallot!,
      canViewResults: canViewResults(poll, user, myBallot!.submitted),
    });
  }

  /**
   * The intro card of a published poll for someone who opened a shared link
   * without logging in. Drafts, polls under review and taken-down polls stay
   * 404, the same answer as a poll that doesn't exist.
   */
  async preview(id: string) {
    const agg = await this.repo.find(id);
    const published =
      agg?.poll.status === 'open' || agg?.poll.status === 'closed';
    if (!agg || !published || agg.poll.takenDownAt) throw notFound();
    return toPreview(agg);
  }

  async submit(user: User, id: string) {
    const agg = await this.owned(user, id);
    if (!EDITABLE.includes(agg.poll.status)) throw locked(agg.poll.status);

    const draft = toDraftInput(agg);
    const problems = findProblems(draft, new Date());
    // The browser uploaded these itself; make sure each one really arrived
    // and really is an image before an admin ever looks at the poll.
    const checks = await Promise.all(
      imageRefs(draft).map(async (r) => ({
        ...r,
        result: await this.images.check(r.url),
      })),
    );
    for (const c of checks) {
      if (c.result === 'missing') {
        problems.push({
          path: c.path,
          message: 'ไม่พบไฟล์รูป (อัปโหลดไม่สำเร็จ)',
        });
      } else if (c.result === 'not_an_image') {
        problems.push({
          path: c.path,
          message: 'ไฟล์นี้ไม่ใช่รูป JPEG/PNG/WebP',
        });
      }
    }
    if (problems.length > 0) {
      throw new AppError(
        'POLL_INCOMPLETE',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The poll is not ready for review',
        { problems },
      );
    }
    // Only polls for all of Chula go through admin review. Narrower or public
    // audiences skip the queue and wait for the owner to publish them.
    await this.move(
      user,
      id,
      EDITABLE,
      {
        status: needsReview(agg.poll.audience) ? 'pending_review' : 'approved',
        submittedAt: new Date(),
      },
      'poll.submit',
    );
    return this.get(user, id);
  }

  async setClosesAt(user: User, id: string, closesAt: Date) {
    const { poll } = await this.owned(user, id);
    if (closesAt <= new Date()) {
      throw new AppError(
        'INVALID_CLOSES_AT',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'closesAt must be in the future',
      );
    }
    if (poll.opensAt && closesAt <= poll.opensAt) {
      throw new AppError(
        'INVALID_CLOSES_AT',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'closesAt must be after opensAt',
      );
    }
    // Drafts change closesAt through PUT; this endpoint is for after submit.
    const allowed: PollStatus[] = ['pending_review', 'approved', 'open'];
    if (!allowed.includes(poll.status)) throw locked(poll.status);
    await this.move(user, id, allowed, { closesAt }, 'poll.closes_at');
    if (poll.status === 'open') await this.jobs.rescheduleClose(id, closesAt);
    return this.get(user, id);
  }

  /**
   * "Publish": the owner opens an approved poll for voting, either now or at
   * a scheduled time (the saved opensAt, or a new one picked when publishing).
   * A scheduled poll is listed straight away; ballots wait for opensAt.
   * opensAt is always written, so the DB says when voting actually started.
   */
  async publish(
    user: User,
    id: string,
    opts: { now?: boolean; opensAt?: Date } = {},
  ) {
    const { poll } = await this.owned(user, id);
    if (poll.status !== 'approved') throw locked(poll.status);
    if (!poll.closesAt || poll.closesAt <= new Date()) throw closesAtPassed();

    const now = new Date();
    if (opts.opensAt && opts.opensAt <= now) {
      throw invalidOpensAt('เวลาเปิดโหวตต้องอยู่ในอนาคต');
    }
    if (opts.opensAt && opts.opensAt >= poll.closesAt) {
      throw invalidOpensAt('เวลาเปิดโหวตต้องอยู่ก่อนเวลาปิดโหวต');
    }
    const savedSchedule =
      poll.opensAt && poll.opensAt > now ? poll.opensAt : null;
    const opensAt = opts.now ? now : (opts.opensAt ?? savedSchedule ?? now);
    const scheduled = opensAt > now;
    await this.move(
      user,
      id,
      ['approved'],
      { status: 'open', opensAt, openedAt: opensAt },
      scheduled ? 'poll.publish_scheduled' : 'poll.publish',
    );
    await this.jobs.opened(id, opensAt, poll.closesAt);
    return this.get(user, id);
  }

  /** The realtime switch stays editable until the poll opens. */
  async setRealtime(user: User, id: string, showResultsRealtime: boolean) {
    const { poll } = await this.owned(user, id);
    const allowed: PollStatus[] = ['pending_review', 'approved'];
    if (!allowed.includes(poll.status)) throw locked(poll.status);
    await this.move(
      user,
      id,
      allowed,
      { showResultsRealtime },
      'poll.realtime',
    );
    return this.get(user, id);
  }

  /** "เผยแพร่ผล": what voters see of the results, once the poll has opened. */
  async setResultDisplay(user: User, id: string, display: ResultDisplay) {
    const { poll } = await this.owned(user, id);
    const allowed: PollStatus[] = ['open', 'closed'];
    if (!allowed.includes(poll.status)) throw locked(poll.status);
    await this.move(
      user,
      id,
      allowed,
      { resultDisplay: JSON.stringify(display) },
      'poll.result_display',
    );
    return this.get(user, id);
  }

  async close(user: User, id: string, reason: string | undefined) {
    const { poll } = await this.owned(user, id);
    if (poll.status !== 'open') throw locked(poll.status);
    await this.move(
      user,
      id,
      ['open'],
      {
        status: 'closed',
        closedAt: new Date(),
        closeReason: reason || null,
      },
      'poll.close',
    );
    await this.jobs.cancelClose(id);
    return this.get(user, id);
  }

  async remove(user: User, id: string) {
    const { poll } = await this.owned(user, id);
    if (!EDITABLE.includes(poll.status)) throw locked(poll.status);
    await this.move(
      user,
      id,
      EDITABLE,
      { deletedAt: new Date() },
      'poll.delete',
    );
  }

  async feed(
    user: User,
    status: 'open' | 'closed',
    cursor: string | undefined,
    limit: number,
  ) {
    const page = await this.repo.listFeed(user, status, cursor, limit);
    const [ballots, counts] = await Promise.all([
      this.myBallots(user, page.items),
      this.repo.questionCounts(page.items.map((p) => p.id)),
    ]);
    return {
      items: page.items.map((p, i) =>
        toSummary(p, counts.get(p.id) ?? 0, ballots[i]),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async mine(
    user: User,
    status: PollStatus | undefined,
    cursor: string | undefined,
    limit: number,
  ) {
    const page = await this.repo.listMine(user.id, status, cursor, limit);
    const counts = await this.repo.questionCounts(page.items.map((p) => p.id));
    return {
      items: page.items.map((p) => toSummary(p, counts.get(p.id) ?? 0)),
      nextCursor: page.nextCursor,
    };
  }

  listFaculties() {
    return this.repo.listFaculties();
  }

  /** The poll, if `user` owns it. Anyone else gets the same 404 as a missing poll. */
  private async owned(user: User, id: string): Promise<PollAggregate> {
    const agg = await this.repo.find(id);
    if (!agg || agg.poll.ownerId !== user.id) throw notFound();
    return agg;
  }

  private async move(
    user: User,
    id: string,
    from: PollStatus[],
    set: Parameters<PollsRepository['transition']>[2],
    action: string,
  ) {
    // Lost a race with another request that changed the status first.
    if (
      !(await this.repo.transition(id, from, set, user.id, action, user.id))
    ) {
      const { poll } = await this.owned(user, id);
      throw locked(poll.status);
    }
  }

  private async myBallots(user: User, polls: PollRow[]): Promise<MyBallot[]> {
    const voted = await this.repo.votedPollIds(
      polls.map((p) => ({
        pollId: p.id,
        key: voterKey(this.pepper, p.id, user.id),
      })),
    );
    return polls.map((p) => {
      const submitted = voted.has(p.id);
      return {
        submitted,
        canEdit: submitted && p.allowAnswerEdit && isAcceptingVotes(p),
      };
    });
  }

  private async checkReferences(user: User, draft: PollDraftInput) {
    if (draft.audience.type === 'restricted') {
      const codes = [
        ...new Set(
          draft.audience.rules
            .map((r) => r.facultyCode)
            .filter((c): c is string => !!c),
        ),
      ];
      const unknown = await this.repo.unknownFaculties(codes);
      if (unknown.length > 0) {
        throw new AppError(
          'UNKNOWN_FACULTY',
          HttpStatus.UNPROCESSABLE_ENTITY,
          'Unknown faculty code',
          { facultyCodes: unknown },
        );
      }
    }

    // Only images uploaded through POST /images/uploads: an outside URL would
    // let a third-party server see everyone who opens the poll.
    const foreign = imageRefs(draft).filter((r) => !this.images.isOurs(r.url));
    if (foreign.length > 0) {
      throw new AppError(
        'INVALID_IMAGE_URL',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Images must be uploaded through /images/uploads',
        {
          problems: foreign.map((r) => ({
            path: r.path,
            message: 'ต้องอัปโหลดรูปผ่านระบบ',
          })),
        },
      );
    }
  }
}
