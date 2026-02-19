import { Badge, Button, Card, Group, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';

import { DateTime } from '@components/utils/datetime';
import RequestErrorAlert from '@components/utils/error_alert';
import PreloadLink from '@components/utils/link';
import { getTournamentIdFromRouter } from '@components/utils/util';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  checkForAuthError,
  getLeagueCardsGlobal,
  getLeagueDecks,
  getLeagueNextOpponent,
  getTournamentApplications,
  getTournamentById,
  getUser,
} from '@services/adapter';
import { submitTournamentApplication, withdrawTournamentApplication } from '@services/league';

type TournamentDeck = {
  id: number;
  name: string;
  leader: string;
  base: string;
  tournaments_submitted?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  matches?: number;
  win_percentage?: number;
};

type TournamentApplication = {
  user_id: number;
  user_name: string;
  deck_id: number | null;
  deck_name: string | null;
  deck_leader: string | null;
  deck_base: string | null;
  status: string;
};

export default function TournamentEntriesPage() {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrCurrentUserResponse = getUser();
  const swrTournamentResponse = getTournamentById(tournamentData.id);
  const swrDecksResponse = getLeagueDecks(tournamentData.id);
  const swrCardsResponse = getLeagueCardsGlobal({ limit: 5000, offset: 0 });

  checkForAuthError(swrCurrentUserResponse);
  checkForAuthError(swrTournamentResponse);
  checkForAuthError(swrDecksResponse);
  checkForAuthError(swrCardsResponse);

  const isAdmin = String(swrCurrentUserResponse.data?.data?.account_type ?? 'REGULAR') === 'ADMIN';

  const swrApplicationsResponse = getTournamentApplications(
    tournamentData.id,
    isAdmin ? 'admin' : 'all'
  );
  const swrMyApplicationResponse = getTournamentApplications(tournamentData.id, 'me');
  const swrNextOpponentResponse = getLeagueNextOpponent(tournamentData.id);
  checkForAuthError(swrApplicationsResponse);
  checkForAuthError(swrMyApplicationResponse);
  checkForAuthError(swrNextOpponentResponse);

  const decks: TournamentDeck[] = swrDecksResponse.data?.data ?? [];
  const cardLookup: Record<string, string> = useMemo(() => {
    const rows = swrCardsResponse.data?.data?.cards ?? [];
    return rows.reduce((result: Record<string, string>, card: any) => {
      const cardId = String(card?.card_id ?? '').trim().toLowerCase();
      const cardName = String(card?.name ?? '').trim();
      if (cardId !== '' && cardName !== '' && result[cardId] == null) {
        result[cardId] = cardName;
      }
      return result;
    }, {});
  }, [swrCardsResponse.data?.data?.cards]);
  const applications: TournamentApplication[] = swrApplicationsResponse.data?.data ?? [];
  const myApplication: TournamentApplication | null = (swrMyApplicationResponse.data?.data ?? [])[0] ?? null;
  const nextOpponent = swrNextOpponentResponse.data?.data;

  const formatCardName = (cardId: string | null | undefined) => {
    const normalized = String(cardId ?? '').trim().toLowerCase();
    if (normalized === '') return '-';
    return cardLookup[normalized] ?? cardId ?? '-';
  };

  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDeckId == null && decks.length > 0) {
      setSelectedDeckId(String(decks[0].id));
    }
  }, [selectedDeckId, decks]);

  const deckOptions = useMemo(
    () =>
      decks.map((deck) => ({
        value: String(deck.id),
        label: `${deck.name} (${formatCardName(deck.leader)} / ${formatCardName(deck.base)}) - ${deck.wins ?? 0}-${deck.draws ?? 0}-${deck.losses ?? 0}`,
      })),
    [decks, cardLookup]
  );
  const selectedDeck = decks.find((deck) => String(deck.id) === selectedDeckId) ?? null;

  const tournament = swrTournamentResponse.data?.data;

  return (
    <TournamentLayout tournament_id={tournamentData.id}>
      <Stack>
        <Title order={2}>Tournament Entries</Title>
        <Text c="dimmed">
          Submit your deck for this event and track who has already entered.
        </Text>

        {swrTournamentResponse.error && <RequestErrorAlert error={swrTournamentResponse.error} />}
        {swrApplicationsResponse.error && <RequestErrorAlert error={swrApplicationsResponse.error} />}
        {swrDecksResponse.error && <RequestErrorAlert error={swrDecksResponse.error} />}

        <Card withBorder>
          <Group justify="space-between" align="start">
            <Stack gap={2}>
              <Title order={4}>{tournament?.name ?? 'Tournament'}</Title>
              <Text size="sm" c="dimmed">
                Club: {(tournament as any)?.club_name ?? '-'}
              </Text>
              <Text size="sm">
                Start: {tournament?.start_time != null ? <DateTime datetime={tournament.start_time} /> : '-'}
              </Text>
              <Text size="sm">
                Match duration: {tournament?.duration_minutes ?? '-'} min, break: {tournament?.margin_minutes ?? '-'} min
              </Text>
              {nextOpponent != null ? (
                <Text size="sm">
                  Next opponent: {nextOpponent.opponent_team_name ?? 'TBD'} (
                  {nextOpponent.start_time != null ? <DateTime datetime={nextOpponent.start_time} /> : 'TBD'})
                </Text>
              ) : null}
            </Stack>
            <Badge color={tournament?.status === 'ARCHIVED' ? 'gray' : 'green'} variant="light">
              {tournament?.status ?? 'OPEN'}
            </Badge>
          </Group>
        </Card>

        <Card withBorder>
          <Stack>
            <Title order={4}>Submit Deck</Title>
            <Select
              label="Choose Deck"
              value={selectedDeckId}
              onChange={setSelectedDeckId}
              data={deckOptions}
              searchable
              clearable
            />
            <Group>
              <Button
                onClick={async () => {
                  if (selectedDeckId == null) return;
                  await submitTournamentApplication(tournamentData.id, {
                    deck_id: Number(selectedDeckId),
                  });
                  await Promise.all([swrApplicationsResponse.mutate(), swrMyApplicationResponse.mutate()]);
                }}
                disabled={selectedDeckId == null}
              >
                Submit Selected Deck
              </Button>
              <Button
                variant="light"
                color="red"
                disabled={myApplication == null}
                onClick={async () => {
                  await withdrawTournamentApplication(tournamentData.id);
                  await Promise.all([swrApplicationsResponse.mutate(), swrMyApplicationResponse.mutate()]);
                }}
              >
                Withdraw Submission
              </Button>
              <Button
                variant="outline"
                component={PreloadLink}
                href={`/league/deckbuilder`}
                onClick={() =>
                  window.localStorage.setItem('league_default_tournament_id', String(tournamentData.id))
                }
              >
                Open Deckbuilder
              </Button>
            </Group>
            {myApplication != null ? (
              <Text size="sm" c="dimmed">
                Current submission: {myApplication.deck_name ?? `Deck #${myApplication.deck_id ?? '-'}`} (
                {formatCardName(myApplication.deck_leader)} / {formatCardName(myApplication.deck_base)}) -{' '}
                {myApplication.status}
              </Text>
            ) : (
              <Text size="sm" c="dimmed">No submission yet for this tournament.</Text>
            )}
            {selectedDeck != null ? (
              <Text size="sm" c="dimmed">
                Selected deck record: {selectedDeck.wins ?? 0}-{selectedDeck.draws ?? 0}-{selectedDeck.losses ?? 0} (
                {selectedDeck.matches ?? 0} matches, {(selectedDeck.win_percentage ?? 0).toFixed(2)}% win rate,{' '}
                {selectedDeck.tournaments_submitted ?? 0} tournament entries)
              </Text>
            ) : null}
          </Stack>
        </Card>

        {isAdmin ? (
          <Card withBorder>
            <Group>
              <Button component={PreloadLink} href={`/tournaments/${tournamentData.id}/schedule`}>
                Schedule Rounds
              </Button>
              <Button
                variant="outline"
                component={PreloadLink}
                href={`/tournaments/${tournamentData.id}/stages`}
              >
                Manage Stages
              </Button>
            </Group>
            <Text size="sm" c="dimmed" mt="sm">
              Schedule and stage planning should be done after players have submitted decks below.
            </Text>
          </Card>
        ) : null}

        <Card withBorder>
          <Title order={4} mb="sm">Submitted Decks</Title>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Player</Table.Th>
                <Table.Th>Deck</Table.Th>
                <Table.Th>Leader / Base</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {applications.length < 1 ? (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text c="dimmed" size="sm">
                      No decks submitted yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                applications.map((application) => (
                  <Table.Tr key={`${application.user_id}-${application.deck_id ?? 'none'}`}>
                    <Table.Td>{application.user_name}</Table.Td>
                    <Table.Td>{application.deck_name ?? (application.deck_id != null ? `Deck #${application.deck_id}` : '-')}</Table.Td>
                    <Table.Td>
                      {formatCardName(application.deck_leader)} / {formatCardName(application.deck_base)}
                    </Table.Td>
                    <Table.Td>{application.status}</Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </TournamentLayout>
  );
}
