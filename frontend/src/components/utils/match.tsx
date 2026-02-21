import { MatchWithDetails } from '@openapi';
import dayjs from 'dayjs';
import { formatStageItemInput } from './stage_item_input';
import { Translator } from './types';

export interface SchedulerSettings {
  eloThreshold: number;
  setEloThreshold: any;
  limit: number;
  setLimit: any;
  iterations: number;
  setIterations: any;
  onlyRecommended: string;
  setOnlyRecommended: any;
}

export function getMatchStartTime(match: MatchWithDetails) {
  return dayjs(match.start_time || '');
}

export function getMatchEndTime(match: MatchWithDetails) {
  return getMatchStartTime(match).add(match.duration_minutes + match.margin_minutes, 'minutes');
}

export function isMatchHappening(match: MatchWithDetails) {
  return getMatchStartTime(match) < dayjs() && getMatchEndTime(match) > dayjs();
}

export function isMatchInTheFutureOrPresent(match: MatchWithDetails) {
  return getMatchEndTime(match) > dayjs();
}

export function isMatchInTheFuture(match: MatchWithDetails) {
  return getMatchStartTime(match) > dayjs();
}

export function formatMatchInput1(
  t: Translator,
  stageItemsLookup: any,
  matchesLookup: any,
  match: MatchWithDetails,
  visitedMatchIds: Set<number> = new Set()
): string {
  const formatted = formatStageItemInput(match.stage_item_input1, stageItemsLookup);
  if (formatted != null) return formatted;

  const winnerFromMatchId = Number(match.stage_item_input1_winner_from_match_id ?? 0);
  if (Number.isFinite(winnerFromMatchId) && winnerFromMatchId > 0) {
    return formatDependentMatchInput(
      t,
      stageItemsLookup,
      matchesLookup,
      winnerFromMatchId,
      'Winner',
      visitedMatchIds
    );
  }

  const loserFromMatchId = Number(match.stage_item_input1_loser_from_match_id ?? 0);
  if (Number.isFinite(loserFromMatchId) && loserFromMatchId > 0) {
    return formatDependentMatchInput(
      t,
      stageItemsLookup,
      matchesLookup,
      loserFromMatchId,
      'Loser',
      visitedMatchIds
    );
  }

  return t('empty_slot');
}

export function formatMatchInput2(
  t: Translator,
  stageItemsLookup: any,
  matchesLookup: any,
  match: MatchWithDetails,
  visitedMatchIds: Set<number> = new Set()
): string {
  const formatted = formatStageItemInput(match.stage_item_input2, stageItemsLookup);
  if (formatted != null) return formatted;

  const winnerFromMatchId = Number(match.stage_item_input2_winner_from_match_id ?? 0);
  if (Number.isFinite(winnerFromMatchId) && winnerFromMatchId > 0) {
    return formatDependentMatchInput(
      t,
      stageItemsLookup,
      matchesLookup,
      winnerFromMatchId,
      'Winner',
      visitedMatchIds
    );
  }

  const loserFromMatchId = Number(match.stage_item_input2_loser_from_match_id ?? 0);
  if (Number.isFinite(loserFromMatchId) && loserFromMatchId > 0) {
    return formatDependentMatchInput(
      t,
      stageItemsLookup,
      matchesLookup,
      loserFromMatchId,
      'Loser',
      visitedMatchIds
    );
  }

  return t('empty_slot');
}

function formatDependentMatchInput(
  t: Translator,
  stageItemsLookup: any,
  matchesLookup: any,
  sourceMatchId: number,
  resultType: 'Winner' | 'Loser',
  visitedMatchIds: Set<number>
): string {
  if (visitedMatchIds.has(sourceMatchId)) return t('empty_slot');
  const sourceMatch = matchesLookup?.[sourceMatchId]?.match as MatchWithDetails | undefined;
  if (sourceMatch == null) return t('empty_slot');

  const nextVisitedMatchIds = new Set(visitedMatchIds);
  nextVisitedMatchIds.add(sourceMatchId);
  const matchInput1 = formatMatchInput1(
    t,
    stageItemsLookup,
    matchesLookup,
    sourceMatch,
    nextVisitedMatchIds
  );
  const matchInput2 = formatMatchInput2(
    t,
    stageItemsLookup,
    matchesLookup,
    sourceMatch,
    nextVisitedMatchIds
  );
  return `${resultType} of match ${matchInput1} - ${matchInput2}`;
}
