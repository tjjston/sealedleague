import { showNotification } from '@mantine/notifications';
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios';
import { useNavigate } from 'react-router';
import useSWR, { SWRResponse } from 'swr';

import { SchedulerSettings } from '@components/utils/match';
import { TournamentFilter } from '@components/utils/tournament';
import { Pagination } from '@components/utils/util';
import {
  ClubsResponse,
  CourtsResponse,
  PlayersResponse,
  RankingsResponse,
  RoundWithMatches,
  StageItemInputOptionsResponse,
  StageRankingResponse,
  StagesWithStageItemsResponse,
  TeamsWithPlayersResponse,
  TournamentResponse,
  TournamentsResponse,
  UpcomingMatchesResponse,
  UserPublicResponse,
} from '@openapi';
import dayjs from 'dayjs';
import { getLogin, performLogout, tokenPresent } from './local_storage';

export function handleRequestError(response: AxiosError) {
  if (response.code === 'ERR_NETWORK') {
    showNotification({
      color: 'red',
      title: 'An error occurred',
      message: 'Cannot reach the API server. Check container health and API URL.',
      autoClose: 10000,
    });
    return;
  }

  // @ts-ignore
  if (response.response != null && response.response.data.detail != null) {
    // If the detail contains an array, there is likely a pydantic validation error occurring.
    // @ts-ignore
    const { detail } = response.response.data;
    let message: string;

    if (Array.isArray(detail)) {
      const firstError = detail[0];
      message = `${firstError.loc.slice(1).join(' - ')}: ${firstError.msg}`;
    } else {
      message = detail.toString();
    }

    showNotification({
      color: 'red',
      title: 'An error occurred',
      message,
      autoClose: 10000,
    });
    return;
  }

  showNotification({
    color: 'red',
    title: 'An error occurred',
    message: response.message,
    autoClose: 10000,
  });
}

export function requestSucceeded(result: AxiosResponse | AxiosError) {
  // @ts-ignore
  return result.name !== 'AxiosError';
}

export function getBaseApiUrl() {
  return import.meta.env.VITE_API_BASE_URL != null ? import.meta.env.VITE_API_BASE_URL : '/api';
}

export function createAxios() {
  const user = getLogin();
  const access_token = user != null ? user.access_token : '';
  return axios.create({
    baseURL: getBaseApiUrl(),
    headers: {
      Authorization: `bearer ${access_token}`,
      Accept: 'application/json',
    },
  });
}

export async function awaitRequestAndHandleError(
  requestFunction: (instance: AxiosInstance) => Promise<AxiosResponse>
): Promise<AxiosError | AxiosResponse> {
  let response = null;
  try {
    response = await requestFunction(createAxios());
  } catch (exc: any) {
    if (exc.name === 'AxiosError') {
      handleRequestError(exc);
      return exc;
    }
    throw exc;
  }
  return response;
}

function getTimeState() {
  // Used to force a refresh on SWRResponse, even when the response stays the same.
  // For example, when the page layout depends on time, but the response contains
  // timestamps that don't change, this is necessary.
  return { time: dayjs() };
}

const fetcher = (url: string) =>
  createAxios()
    .get(url)
    .then((res: { data: any }) => res.data);

const fetcherWithTimestamp = (url: string) =>
  createAxios()
    .get(url)
    .then((res: { data: any }) => ({ ...res.data, ...getTimeState() }));

export function getClubs(): SWRResponse<ClubsResponse> {
  return useSWR('clubs', fetcher);
}

export function getTournamentByEndpointName(
  tournament_endpoint_name: string
): SWRResponse<TournamentsResponse> {
  return useSWR(`tournaments?endpoint_name=${tournament_endpoint_name}`, fetcher);
}

export function getTournamentById(tournament_id: number): SWRResponse<TournamentResponse> {
  return useSWR(`tournaments/${tournament_id}`, fetcher);
}

export function getTournaments(filter: TournamentFilter): SWRResponse<TournamentsResponse> {
  return useSWR(`tournaments?filter_=${filter}`, fetcher);
}

export function getPlayers(
  tournament_id: number,
  not_in_team: boolean = false
): SWRResponse<PlayersResponse> {
  return useSWR(
    `tournaments/${tournament_id}/players?not_in_team=${not_in_team}&limit=100`,
    fetcher
  );
}

export function getPlayersPaginated(
  tournament_id: number,
  pagination: Pagination
): SWRResponse<PlayersResponse> {
  return useSWR(
    `tournaments/${tournament_id}/players?limit=${pagination.limit}&offset=${pagination.offset}&sort_by=${pagination.sort_by}&sort_direction=${pagination.sort_direction}`,
    fetcher
  );
}

export function getTeams(tournament_id: number | undefined): SWRResponse<TeamsWithPlayersResponse> {
  return useSWR(
    tournament_id == null ? null : `tournaments/${tournament_id}/teams?limit=100`,
    fetcher
  );
}

export function getTeamsPaginated(
  tournament_id: number,
  pagination: Pagination
): SWRResponse<TeamsWithPlayersResponse> {
  return useSWR(
    `tournaments/${tournament_id}/teams?limit=${pagination.limit}&offset=${pagination.offset}&sort_by=${pagination.sort_by}&sort_direction=${pagination.sort_direction}`,
    fetcher
  );
}

export function getTeamsLive(tournament_id: number | null): SWRResponse<TeamsWithPlayersResponse> {
  return useSWR(tournament_id == null ? null : `tournaments/${tournament_id}/teams`, fetcher, {
    refreshInterval: 5_000,
  });
}

export function getAvailableStageItemInputs(
  tournament_id: number
): SWRResponse<StageItemInputOptionsResponse> {
  return useSWR(`tournaments/${tournament_id}/available_inputs`, fetcher);
}

export function getStages(
  tournament_id: number | null,
  no_draft_rounds: boolean = false
): SWRResponse<StagesWithStageItemsResponse> {
  return useSWR(
    tournament_id == null || tournament_id === -1
      ? null
      : `tournaments/${tournament_id}/stages?no_draft_rounds=${no_draft_rounds}`,
    fetcher
  );
}

export function getStagesLive(
  tournament_id: number | null
): SWRResponse<StagesWithStageItemsResponse> {
  return useSWR(
    tournament_id == null ? null : `tournaments/${tournament_id}/stages?no_draft_rounds=true`,
    fetcherWithTimestamp,
    {
      refreshInterval: 5_000,
    }
  );
}

export function getRankings(tournament_id: number): SWRResponse<RankingsResponse> {
  return useSWR(`tournaments/${tournament_id}/rankings`, fetcher);
}

export function getRankingsPerStageItem(tournament_id: number): SWRResponse<StageRankingResponse> {
  return useSWR(`tournaments/${tournament_id}/next_stage_rankings`, fetcher);
}

export function getCourts(tournament_id: number): SWRResponse<CourtsResponse> {
  return useSWR(`tournaments/${tournament_id}/courts`, fetcher);
}

export function getCourtsLive(tournament_id: number | null): SWRResponse<CourtsResponse> {
  return useSWR(tournament_id == null ? null : `tournaments/${tournament_id}/courts`, fetcher, {
    refreshInterval: 60_000,
  });
}

export function getUser(): SWRResponse<UserPublicResponse> {
  return useSWR('users/me', fetcher);
}

export function getUsersAdmin(): SWRResponse<any> {
  return useSWR('users', fetcher);
}

export function getLeagueCards(
  tournament_id: number | null,
  filters: {
    query?: string;
    name?: string;
    rules?: string;
    aspect?: string;
    trait?: string;
    keyword?: string;
    arena?: string;
    card_type?: string;
    set_code?: string;
    cost?: number | null;
    cost_min?: number | null;
    cost_max?: number | null;
    limit?: number;
    offset?: number;
  }
): SWRResponse<any> {
  if (tournament_id == null || tournament_id <= 0) {
    return useSWR(null, fetcher);
  }
  const params = new URLSearchParams();
  if (filters.query != null && filters.query !== '') params.set('query', filters.query);
  if (filters.name != null && filters.name !== '') params.set('name', filters.name);
  if (filters.rules != null && filters.rules !== '') params.set('rules', filters.rules);
  if (filters.aspect != null && filters.aspect !== '') params.append('aspect', filters.aspect);
  if (filters.trait != null && filters.trait !== '') params.append('trait', filters.trait);
  if (filters.keyword != null && filters.keyword !== '') params.append('keyword', filters.keyword);
  if (filters.arena != null && filters.arena !== '') params.append('arena', filters.arena);
  if (filters.card_type != null && filters.card_type !== '') params.set('card_type', filters.card_type);
  if (filters.set_code != null && filters.set_code !== '') params.append('set_code', filters.set_code);
  if (filters.cost != null) params.set('cost', String(filters.cost));
  if (filters.cost_min != null) params.set('cost_min', String(filters.cost_min));
  if (filters.cost_max != null) params.set('cost_max', String(filters.cost_max));
  params.set('limit', String(filters.limit ?? 100));
  params.set('offset', String(filters.offset ?? 0));
  return useSWR(`tournaments/${tournament_id}/league/cards?${params.toString()}`, fetcher);
}

export function getLeagueCardPool(
  tournament_id: number | null,
  user_id?: number | null
): SWRResponse<any> {
  if (tournament_id == null || tournament_id <= 0) {
    return useSWR(null, fetcher);
  }
  const suffix = user_id == null ? '' : `?user_id=${user_id}`;
  return useSWR(`tournaments/${tournament_id}/league/card_pool${suffix}`, fetcher);
}

export function getLeagueDecks(
  tournament_id: number | null,
  user_id?: number | null
): SWRResponse<any> {
  if (tournament_id == null || tournament_id <= 0) {
    return useSWR(null, fetcher);
  }
  const suffix = user_id == null ? '' : `?user_id=${user_id}`;
  return useSWR(`tournaments/${tournament_id}/league/decks${suffix}`, fetcher);
}

export function getLeagueSeasonStandings(tournament_id: number | null): SWRResponse<any> {
  if (tournament_id == null || tournament_id <= 0) {
    return useSWR(null, fetcher);
  }
  return useSWR(`tournaments/${tournament_id}/league/season_standings`, fetcher);
}

export function getLeagueAdminUsers(tournament_id: number | null): SWRResponse<any> {
  if (tournament_id == null || tournament_id <= 0) {
    return useSWR(null, fetcher);
  }
  return useSWR(`tournaments/${tournament_id}/league/admin/users`, fetcher);
}

export function getUpcomingMatches(
  tournament_id: number,
  stage_item_id: number,
  draftRound: RoundWithMatches | null,
  schedulerSettings: SchedulerSettings
): SWRResponse<UpcomingMatchesResponse> {
  return useSWR(
    stage_item_id == null || draftRound == null
      ? null
      : `tournaments/${tournament_id}/stage_items/${stage_item_id}/upcoming_matches?elo_diff_threshold=${schedulerSettings.eloThreshold}&only_recommended=${schedulerSettings.onlyRecommended}&limit=${schedulerSettings.limit}&iterations=${schedulerSettings.iterations}`,
    fetcher
  );
}

export async function uploadTournamentLogo(tournament_id: number, file: any) {
  const bodyFormData = new FormData();
  bodyFormData.append('file', file, file.name);

  return createAxios().post(`tournaments/${tournament_id}/logo`, bodyFormData);
}

export async function removeTournamentLogo(tournament_id: number) {
  return createAxios().post(`tournaments/${tournament_id}/logo`);
}

export async function uploadTeamLogo(tournament_id: number, team_id: number, file: any) {
  const bodyFormData = new FormData();
  bodyFormData.append('file', file, file.name);

  return createAxios().post(`tournaments/${tournament_id}/teams/${team_id}/logo`, bodyFormData);
}

export async function removeTeamLogo(tournament_id: number, team_id: number) {
  return createAxios().post(`tournaments/${tournament_id}/teams/${team_id}/logo`);
}

export function checkForAuthError(response: any) {
  if (typeof window !== 'undefined' && !tokenPresent()) {
    const navigate = useNavigate();
    navigate('/login');
  }

  // We send a simple GET `/clubs` request to test whether we really should log out. // Next
  // sometimes uses out-of-date local storage, so we send an additional request with up-to-date
  // local storage.
  // If that gives a 401, we log out.
  function responseHasAuthError(_response: any) {
    return (
      _response.error != null &&
      _response.error.response != null &&
      _response.error.response.status === 401
    );
  }
  if (responseHasAuthError(response)) {
    createAxios()
      .get('users/me')
      .then(() => {})
      .catch((error: any) => {
        if (error.toJSON().status === 401) {
          performLogout();
        }
      });
  }
}
