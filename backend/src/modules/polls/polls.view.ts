import { wasClosedEarly } from './poll-access.js';
import {
  type PollDraftInput,
  pollDraftSchema,
  QUESTION_TYPES,
} from './poll-draft.schema.js';
import type { PollAggregate, PollRow } from './polls.repository.js';
import { resultDisplayOf } from './result-display.js';

export interface MyBallot {
  submitted: boolean;
  canEdit: boolean;
}

export interface PollSummary {
  id: string;
  status: PollRow['status'];
  title: string;
  description: string;
  coverImageUrl: string | null;
  audience: PollRow['audience'];
  opensAt: Date | null;
  closesAt: Date | null;
  openedAt: Date | null;
  closedAt: Date | null;
  closedEarly: boolean;
  showResultsRealtime: boolean;
  identifySender: boolean;
  questionCount: number;
  createdAt: Date;
  myBallot?: MyBallot;
}

export function toSummary(
  p: PollRow,
  questionCount: number,
  myBallot?: MyBallot,
): PollSummary {
  return {
    id: p.id,
    status: p.status,
    title: p.title,
    description: p.description,
    coverImageUrl: p.coverImageUrl,
    audience: p.audience,
    opensAt: p.opensAt,
    closesAt: p.closesAt,
    openedAt: p.openedAt,
    closedAt: p.closedAt,
    closedEarly: wasClosedEarly(p),
    showResultsRealtime: p.showResultsRealtime,
    identifySender: p.identifySender,
    questionCount,
    createdAt: p.createdAt,
    ...(myBallot ? { myBallot } : {}),
  };
}

export function toDetail(
  agg: PollAggregate,
  ctx: {
    isOwner: boolean;
    canSeeReviews: boolean;
    myBallot: MyBallot;
    canViewResults: boolean;
    /** Codes polls, owner and admins only: the id list. */
    codes?: string[];
  },
) {
  const { poll } = agg;
  return {
    id: poll.id,
    status: poll.status,
    version: poll.version,
    title: poll.title,
    description: poll.description,
    coverImageUrl: poll.coverImageUrl,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    submittedAt: poll.submittedAt,
    openedAt: poll.openedAt,
    closedAt: poll.closedAt,
    closedEarly: wasClosedEarly(poll),
    closeReason: poll.closeReason,
    createdAt: poll.createdAt,
    updatedAt: poll.updatedAt,
    audience: audienceOf(agg, ctx.codes),
    settings: {
      showResultsRealtime: poll.showResultsRealtime,
      allowAnswerEdit: poll.allowAnswerEdit,
      listedPublicly: poll.listedPublicly,
      identifySender: poll.identifySender,
    },
    resultDisplay: resultDisplayOf(poll),
    shareUrl: poll.shareUrl,
    elements: agg.elements.map((e) => ({
      id: e.id,
      type: e.type,
      title: e.title,
      isRequired: e.isRequired,
      config: e.config,
      ...(hasOptions(e.type)
        ? {
            options: e.options.map((o) => ({
              id: o.id,
              label: o.label,
              description: o.description,
              imageUrl: o.imageUrl,
              imageAlt: o.imageAlt,
              popup: o.popup,
            })),
          }
        : {}),
    })),
    isOwner: ctx.isOwner,
    myBallot: ctx.myBallot,
    canViewResults: ctx.canViewResults,
    takenDown: poll.takenDownAt !== null,
    // Owner and admins only, like the review history.
    ...(ctx.canSeeReviews
      ? { reviews: agg.reviews, takedownReason: poll.takedownReason }
      : {}),
  };
}

/**
 * What anyone with the link sees before logging in: the intro card only.
 * No questions, no results and nothing about the viewer.
 */
export function toPreview(agg: PollAggregate) {
  const { poll } = agg;
  return {
    id: poll.id,
    status: poll.status,
    title: poll.title,
    description: poll.description,
    coverImageUrl: poll.coverImageUrl,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    closedAt: poll.closedAt,
    closedEarly: wasClosedEarly(poll),
    closeReason: poll.closeReason,
    audience: audienceOf(agg),
    // Shown before login too: voters must know their id goes with the answers.
    identifySender: poll.identifySender,
    questionCount: agg.elements.filter((e) => QUESTION_TYPES.has(e.type))
      .length,
  };
}

/** Stored poll → the same shape the editor sends, re-validated by the schema. */
export function toDraftInput(
  agg: PollAggregate,
  codes: string[] = [],
): PollDraftInput {
  const { poll } = agg;
  return pollDraftSchema.parse({
    title: poll.title,
    description: poll.description,
    coverImageUrl: poll.coverImageUrl,
    opensAt: poll.opensAt?.toISOString() ?? null,
    closesAt: poll.closesAt?.toISOString() ?? null,
    audience: audienceOf(agg, codes),
    settings: {
      showResultsRealtime: poll.showResultsRealtime,
      allowAnswerEdit: poll.allowAnswerEdit,
      listedPublicly: poll.listedPublicly,
      identifySender: poll.identifySender,
    },
    elements: agg.elements.map((e) => ({
      type: e.type,
      title: e.title,
      isRequired: e.isRequired,
      config: e.config,
      ...(hasOptions(e.type)
        ? {
            options: e.options.map((o) => ({
              label: o.label,
              description: o.description,
              imageUrl: o.imageUrl,
              imageAlt: o.imageAlt,
              popup: o.popup,
            })),
          }
        : {}),
    })),
  });
}

/**
 * Codes polls carry how many ids are listed; the ids themselves only when
 * `codes` is given (owner and admins), never to voters.
 */
function audienceOf(
  { poll, rules, codeCount }: PollAggregate,
  codes?: string[],
) {
  if (poll.audience === 'restricted')
    return { type: 'restricted' as const, rules };
  if (poll.audience === 'codes') {
    return { type: 'codes' as const, codeCount, ...(codes ? { codes } : {}) };
  }
  return { type: poll.audience };
}

function hasOptions(type: string) {
  return (
    type === 'single_choice' || type === 'multi_choice' || type === 'dropdown'
  );
}
