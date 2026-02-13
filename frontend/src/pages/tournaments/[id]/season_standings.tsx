import { Badge, Button, Card, Group, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';

import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueAdminUsers, getLeagueSeasonStandings, getTournaments } from '@services/adapter';
import { exportSeasonStandingsCsv } from '@services/league';

export default function SeasonStandingsPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);

  useEffect(() => {
    if (!standalone || tournaments.length < 1 || selectedTournamentId != null) return;
    const saved = window.localStorage.getItem('league_default_tournament_id');
    const selected = tournaments.find((t: any) => String(t.id) === saved) ?? tournaments[0];
    setSelectedTournamentId(String(selected.id));
    window.localStorage.setItem('league_default_tournament_id', String(selected.id));
  }, [standalone, tournaments, selectedTournamentId]);

  const activeTournamentId = standalone
    ? Number(selectedTournamentId ?? tournaments[0]?.id ?? 0)
    : tournamentData.id;

  const swrStandingsResponse = getLeagueSeasonStandings(activeTournamentId);
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const isAdmin = swrAdminUsersResponse.data != null;
  const rows = swrStandingsResponse.data?.data ?? [];
  const content = (
    <Stack>
        <Title>Season Standings</Title>
        <Text c="dimmed">Cumulative points and league accolades for this active season.</Text>
        {standalone && (
          <Card withBorder>
            <Group align="end">
              <Select
                label="Tournament"
                value={selectedTournamentId}
                onChange={(value) => {
                  setSelectedTournamentId(value);
                  if (value != null) {
                    window.localStorage.setItem('league_default_tournament_id', value);
                  }
                }}
                allowDeselect={false}
                data={tournaments.map((t: any) => ({ value: String(t.id), label: t.name }))}
                style={{ minWidth: 320 }}
              />
              {isAdmin && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const response = await exportSeasonStandingsCsv(activeTournamentId);
                    // @ts-ignore
                    const csv = response?.data;
                    if (csv == null) return;
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `season-standings-${activeTournamentId}.csv`;
                    link.click();
                    window.URL.revokeObjectURL(url);
                  }}
                >
                  Export CSV
                </Button>
              )}
            </Group>
          </Card>
        )}
        <Card withBorder>
          <Table stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Player</Table.Th>
                <Table.Th>Points</Table.Th>
                <Table.Th>Privileges</Table.Th>
                <Table.Th>Accolades</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row: any, index: number) => (
                <Table.Tr key={row.user_id}>
                  <Table.Td>{index + 1}</Table.Td>
                  <Table.Td>
                    <Stack gap={0}>
                      <Text fw={600}>{row.user_name}</Text>
                      <Text size="xs" c="dimmed">
                        {row.user_email}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>{row.points}</Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {row.role != null && <Badge variant="light">{row.role}</Badge>}
                      {row.can_manage_points && <Badge color="teal">Points</Badge>}
                      {row.can_manage_tournaments && <Badge color="indigo">Tournaments</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {(row.accolades ?? []).map((accolade: string) => (
                        <Badge key={`${row.user_id}-${accolade}`} color="yellow" variant="light">
                          {accolade}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }
  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
