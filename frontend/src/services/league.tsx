import { createAxios, handleRequestError } from './adapter';

export async function upsertCardPoolEntry(
  tournament_id: number,
  card_id: string,
  quantity: number,
  user_id?: number
) {
  return createAxios()
    .put(`tournaments/${tournament_id}/league/card_pool`, { card_id, quantity, user_id })
    .catch((response: any) => handleRequestError(response));
}

export async function saveDeck(
  tournament_id: number,
  body: {
    name: string;
    leader: string;
    base: string;
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

export async function updateSeasonPrivileges(
  tournament_id: number,
  user_id: number,
  body: {
    role: 'PLAYER' | 'ADMIN';
    can_manage_points: boolean;
    can_manage_tournaments: boolean;
  }
) {
  return createAxios()
    .put(`tournaments/${tournament_id}/league/admin/users/${user_id}/season_privileges`, body)
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
