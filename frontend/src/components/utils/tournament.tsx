export type TournamentStatus = 'OPEN' | 'PLANNED' | 'IN_PROGRESS' | 'CLOSED';

export type TournamentFilter = 'ALL' | TournamentStatus;

export interface TournamentMinimal {
  id: number;
}
