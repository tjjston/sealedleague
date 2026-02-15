import { createAxios, handleRequestError } from './adapter';

export async function upsertCardPoolEntry(
  tournament_id: number,
  card_id: string,
  quantity: number,
  user_id?: number,
  season_id?: number
) {
  return createAxios()
    .put(`tournaments/${tournament_id}/league/card_pool`, {
      card_id,
      quantity,
      user_id,
      season_id,
    })
    .catch((response: any) => handleRequestError(response));
}

export async function saveDeck(
  tournament_id: number,
  body: {
    name: string;
    leader: string;
    base: string;
    season_id?: number;
    tournament_id?: number;
    leader_image_url?: string;
    mainboard: Record<string, number>;
    sideboard: Record<string, number>;
    user_id?: number;
  }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/decks`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function exportDeckSwuDb(tournament_id: number, deck_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/decks/${deck_id}/export/swudb`)
    .catch((response: any) => handleRequestError(response));
}

export async function importDeckSwuDb(
  tournament_id: number,
  body: {
    name: string;
    leader: string;
    base: string;
    season_id?: number;
    deck: Array<{ id: string; count: number }>;
    sideboard?: Array<{ id: string; count: number }>;
    user_id?: number;
  }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/decks/import/swudb`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function deleteDeck(tournament_id: number, deck_id: number) {
  return createAxios()
    .delete(`tournaments/${tournament_id}/league/decks/${deck_id}`)
    .catch((response: any) => handleRequestError(response));
}

export async function submitLeagueEntry(
  tournament_id: number,
  body: {
    participant_name?: string;
    season_id?: number;
    deck_name: string;
    leader: string;
    base: string;
    leader_image_url?: string;
    mainboard: Record<string, number>;
    sideboard: Record<string, number>;
  }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/submit_entry`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function submitTournamentApplication(
  tournament_id: number,
  body: {
    season_id?: number;
    deck_id?: number;
    participant_name?: string;
    leader_image_url?: string;
  }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/apply`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function updateSeasonPrivileges(
  tournament_id: number,
  user_id: number,
  body: {
    role: 'PLAYER' | 'ADMIN';
    can_manage_points: boolean;
    can_manage_tournaments: boolean;
  },
  season_id?: number
) {
  const suffix = season_id == null ? '' : `?season_id=${season_id}`;
  return createAxios()
    .put(`tournaments/${tournament_id}/league/admin/users/${user_id}/season_privileges${suffix}`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function getLeagueAdminSeasons(tournament_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/admin/seasons`)
    .catch((response: any) => handleRequestError(response));
}

export async function createLeagueSeason(
  tournament_id: number,
  body: { name: string; is_active: boolean; tournament_ids: number[] }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/seasons`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function updateLeagueSeason(
  tournament_id: number,
  season_id: number,
  body: { name?: string; is_active?: boolean; tournament_ids?: number[] }
) {
  return createAxios()
    .put(`tournaments/${tournament_id}/league/admin/seasons/${season_id}`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function deleteLeagueSeason(tournament_id: number, season_id: number) {
  return createAxios()
    .delete(`tournaments/${tournament_id}/league/admin/seasons/${season_id}`)
    .catch((response: any) => handleRequestError(response));
}

export async function submitSeasonDraftPick(
  tournament_id: number,
  body: {
    from_season_id: number;
    to_season_id: number;
    target_user_id: number;
    source_user_id: number;
  }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/season_draft/pick`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function adjustSeasonUserPoints(
  tournament_id: number,
  season_id: number,
  user_id: number,
  body: { points_delta: number; reason?: string }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/seasons/${season_id}/users/${user_id}/points`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function getTournamentApplications(tournament_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/admin/applications`)
    .catch((response: any) => handleRequestError(response));
}

export async function awardAccolade(
  tournament_id: number,
  user_id: number,
  accolade: string,
  notes?: string
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/users/${user_id}/accolades`, {
      accolade,
      notes,
    })
    .catch((response: any) => handleRequestError(response));
}

export async function exportStandingsTemplate(tournament_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/admin/export/standings`)
    .catch((response: any) => handleRequestError(response));
}

export async function importStandingsTemplate(
  tournament_id: number,
  body: { rows: Array<{ user_email: string; points_delta: number; reason?: string }> }
) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/import/standings`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function exportTournamentFormatTemplate(tournament_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/admin/export/tournament_format`)
    .catch((response: any) => handleRequestError(response));
}

export async function importTournamentFormatTemplate(tournament_id: number, body: any) {
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/import/tournament_format`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function exportSeasonStandingsCsv(tournament_id: number) {
  return createAxios()
    .get(`tournaments/${tournament_id}/league/admin/export/season_standings.csv`, {
      responseType: 'text',
    })
    .catch((response: any) => handleRequestError(response));
}

export async function importSeasonStandingsCsv(tournament_id: number, file: File) {
  const body = new FormData();
  body.append('file', file);
  return createAxios()
    .post(`tournaments/${tournament_id}/league/admin/import/standings.csv`, body)
    .catch((response: any) => handleRequestError(response));
}

export async function simulateSealedDraft(body: { set_codes: string[]; pack_count: number }) {
  return createAxios()
    .post('league/draft/simulate', body)
    .catch((response: any) => handleRequestError(response));
}
