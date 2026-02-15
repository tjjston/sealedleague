import { SWRResponse } from 'swr';

import { assert_not_none } from '@components/utils/assert';
import { groupBy, responseIsValid } from '@components/utils/util';
import {
  Court,
  CourtsResponse,
  FullTeamWithPlayers,
  MatchWithDetails,
  StageWithStageItems,
} from '@openapi';
import { getTeams } from './adapter';

export function getTeamsLookup(tournamentId: number) {
  const swrTeamsResponse: SWRResponse = getTeams(tournamentId);
  const isResponseValid = responseIsValid(swrTeamsResponse);

  if (!isResponseValid) {
    return null;
  }
  return Object.fromEntries(
    swrTeamsResponse.data.data.teams.map((x: FullTeamWithPlayers) => [x.id, x])
  );
}

export function getStageItemLookup(swrStagesResponse: SWRResponse) {
  let result: any[] = [];
  if (swrStagesResponse?.data == null) return Object.fromEntries(result);

  (swrStagesResponse.data.data ?? []).forEach((stage: StageWithStageItems) => {
    const stageItems = Array.isArray((stage as any)?.stage_items) ? (stage as any).stage_items : [];
    stageItems
      .filter((stageItem: any) => stageItem != null && stageItem.id != null)
      .forEach((stage_item: any) => {
        result = result.concat([[stage_item.id, stage_item]]);
      });
  });
  return Object.fromEntries(result);
}

export function getStageItemList(swrStagesResponse: SWRResponse) {
  let result: any[] = [];

  (swrStagesResponse?.data?.data ?? []).forEach((stage: StageWithStageItems) => {
    const stageItems = Array.isArray((stage as any)?.stage_items) ? (stage as any).stage_items : [];
    stageItems
      .filter((stageItem: any) => stageItem != null)
      .forEach((stage_item: any) => {
        result = result.concat([[stage_item]]);
      });
  });
  return result;
}

export function getStageItemTeamIdsLookup(swrStagesResponse: SWRResponse) {
  let result: any[] = [];

  (swrStagesResponse?.data?.data ?? []).forEach((stage: StageWithStageItems) => {
    const stageItems = Array.isArray((stage as any)?.stage_items) ? (stage as any).stage_items : [];
    stageItems
      .filter((stageItem: any) => stageItem != null && stageItem.id != null)
      .forEach((stageItem: any) => {
        const inputs = Array.isArray(stageItem.inputs) ? stageItem.inputs : [];
        const teamIds = inputs.map((input: any) => input?.team_id).filter((teamId: any) => teamId != null);
        result = result.concat([[stageItem.id, teamIds]]);
      });
  });
  return Object.fromEntries(result);
}

export function getStageItemTeamsLookup(swrStagesResponse: SWRResponse) {
  let result: any[] = [];

  (swrStagesResponse?.data?.data ?? []).forEach((stage: StageWithStageItems) => {
    const stageItems = Array.isArray((stage as any)?.stage_items) ? (stage as any).stage_items : [];
    stageItems
      .filter((stageItem: any) => stageItem != null && stageItem.id != null)
      .sort((si1: any, si2: any) => (si1.name > si2.name ? 1 : -1))
      .forEach((stageItem: any) => {
        const inputs = Array.isArray(stageItem.inputs) ? stageItem.inputs : [];
        const teams_with_inputs = inputs.filter((input: any) => input != null && input.team != null);

        if (teams_with_inputs.length > 0) {
          result = result.concat([[stageItem.id, teams_with_inputs]]);
        }
      });
  });
  return Object.fromEntries(result);
}

export function getMatchLookup(swrStagesResponse: SWRResponse) {
  let result: any[] = [];

  (swrStagesResponse?.data?.data ?? []).forEach((stage: StageWithStageItems) => {
    const stageItems = Array.isArray((stage as any)?.stage_items) ? (stage as any).stage_items : [];
    stageItems
      .filter((stageItem: any) => stageItem != null && stageItem.id != null)
      .forEach((stageItem: any) => {
        const rounds = Array.isArray(stageItem.rounds) ? stageItem.rounds : [];
        rounds
          .filter((round: any) => round != null)
          .forEach((round: any) => {
            const matches = Array.isArray(round.matches) ? round.matches : [];
            matches
              .filter((match: any) => match != null && match.id != null)
              .forEach((match: any) => {
                result = result.concat([[match.id, { match, stageItem }]]);
              });
          });
      });
  });
  return Object.fromEntries(result);
}

export function stringToColour(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'pink',
    'violet',
    'green',
    'blue',
    'red',
    'grape',
    'indigo',
    'cyan',
    'orange',
    'yellow',
    'teal',
  ];
  return colors[Math.abs(hash) % colors.length];
}

export function getMatchLookupByCourt(swrStagesResponse: SWRResponse) {
  const matches = Object.values(getMatchLookup(swrStagesResponse)).map((x) => x.match);
  return groupBy(['court_id'])(matches);
}

export function getScheduleData(
  swrCourtsResponse: SWRResponse<CourtsResponse>,
  matchesByCourtId: any
): { court: Court; matches: MatchWithDetails[] }[] {
  return (swrCourtsResponse.data?.data || []).map((court: Court) => ({
    matches: (matchesByCourtId[court.id] || [])
      .filter((match: MatchWithDetails) => match.start_time != null)
      .sort((m1: MatchWithDetails, m2: MatchWithDetails) => {
        return assert_not_none(m1.position_in_schedule) > assert_not_none(m2.position_in_schedule)
          ? 1
          : -1 || [];
      }),
    court,
  }));
}
