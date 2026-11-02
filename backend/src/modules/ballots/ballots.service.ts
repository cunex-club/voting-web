import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors.js';
import type { Env } from '../../config/env.js';
import { isEligible, respondentCode } from '../polls/eligibility.js';
import {
  canSeePoll,
  isAcceptingVotes,
  isBeforeOpening,
} from '../polls/poll-access.js';
import { pollNotFound } from '../polls/poll-errors.js';
import { PollsRepository } from '../polls/polls.repository.js';
import type { User } from '../users/users.repository.js';
import { type BallotBody, checkAnswers } from './answers.js';
import { BallotsRepository } from './ballots.repository.js';
import { voterKey } from './voter-key.js';

const pollNotStarted = () =>
  new AppError(
    'POLL_NOT_STARTED',
    HttpStatus.CONFLICT,
    'Voting has not started yet',
  );
const pollClosed = () =>
  new AppError('POLL_CLOSED', HttpStatus.CONFLICT, 'Voting has closed');

@Injectable()
export class BallotsService {
  private readonly pepper: string;

  constructor(
    private readonly polls: PollsRepository,
    private readonly ballots: BallotsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('VOTER_KEY_PEPPER');
  }

  async submit(user: User, pollId: string, body: BallotBody) {
    const agg = await this.polls.find(pollId, user);
    if (!agg || !canSeePoll(agg, user)) throw pollNotFound();
    const { poll } = agg;

    // Owner and admins can see any poll but only vote where eligible.
    if (!isEligible(poll.audience, agg.rules, user, agg.listed)) {
      throw new AppError(
        'NOT_ELIGIBLE',
        HttpStatus.FORBIDDEN,
        'You are not in this poll’s audience',
      );
    }
    if (isBeforeOpening(poll)) throw pollNotStarted();
    if (!isAcceptingVotes(poll)) throw pollClosed();

    const { problems, ballot } = checkAnswers(agg.elements, body);
    if (problems.length > 0) {
      throw new AppError(
        'INVALID_ANSWERS',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'Some answers are invalid',
        { problems },
      );
    }

    const result = await this.ballots.save({
      pollId,
      voterKey: voterKey(this.pepper, pollId, user.id),
      allowEdit: poll.allowAnswerEdit,
      // Snapshot at vote time for faculty/year breakdowns.
      facultyCode: user.isChulaVerified ? user.facultyCode : null,
      studentYear: user.isChulaVerified ? user.studentYear : null,
      // Only polls that told voters up front ("ระบุคนส่ง") keep who answered.
      respondentCode: poll.identifySender ? respondentCode(user) : null,
      ballot,
    });
    if (result.kind === 'closed') throw pollClosed();
    if (result.kind === 'already_voted') {
      throw new AppError(
        'ALREADY_VOTED',
        HttpStatus.CONFLICT,
        'You already answered and this poll does not allow changes',
      );
    }
    return {
      created: result.kind === 'created',
      ballot: toBallotView(ballot.choices, ballot.texts, result.submittedAt),
    };
  }

  async mine(user: User, pollId: string) {
    const agg = await this.polls.find(pollId, user);
    if (!agg || !canSeePoll(agg, user)) throw pollNotFound();
    const found = await this.ballots.find(
      pollId,
      voterKey(this.pepper, pollId, user.id),
    );
    if (!found) {
      throw new AppError(
        'NO_BALLOT',
        HttpStatus.NOT_FOUND,
        'You have not answered this poll',
      );
    }
    return toBallotView(found.choices, found.texts, found.submittedAt);
  }
}

function toBallotView(
  choices: { elementId: string; optionId: string }[],
  texts: { elementId: string; answer: string }[],
  submittedAt: Date,
) {
  const byElement = new Map<string, string[]>();
  for (const c of choices) {
    byElement.set(c.elementId, [
      ...(byElement.get(c.elementId) ?? []),
      c.optionId,
    ]);
  }
  return {
    answers: [
      ...[...byElement].map(([elementId, optionIds]) => ({
        elementId,
        optionIds,
      })),
      ...texts.map((t) => ({ elementId: t.elementId, text: t.answer })),
    ],
    submittedAt,
  };
}
