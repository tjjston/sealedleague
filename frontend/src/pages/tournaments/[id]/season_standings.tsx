import { Badge, Button, Card, Group, Select, Stack, Table, Text, Title, FileInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueAdminUsers, getLeagueSeasonHistory, getTournaments } from '@services/adapter';
import { exportSeasonStandingsCsv, importSeasonStandingsCsv } from '@services/league';

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

  const swrStandingsResponse = getLeagueSeasonHistory(activeTournamentId);
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const isAdmin = swrAdminUsersResponse.data != null;
  const seasons = swrStandingsResponse.data?.data?.seasons ?? [];
  const cumulativeRows = swrStandingsResponse.data?.data?.cumulative ?? [];
  const [importFile, setImportFile] = useState<File | null>(null);

  function StandingsTable({ rows }: { rows: any[] }) {
    return (
      <Table stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Player</Table.Th>
            <Table.Th>Points</Table.Th>
            <Table.Th>Wins</Table.Th>
            <Table.Th>Placements</Table.Th>
            <Table.Th>Packs</Table.Th>
            <Table.Th>Privileges</Table.Th>
            <Table.Th>Accolades</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row: any, index: number) => (
            <Table.Tr key={`${row.user_id}-${index}`}>
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
              <Table.Td>{row.tournament_wins ?? 0}</Table.Td>
              <Table.Td>{row.tournament_placements ?? 0}</Table.Td>
              <Table.Td>{row.prize_packs ?? 0}</Table.Td>
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
    );
  }
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
                <Group>
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
                  <FileInput
                    value={importFile}
                    onChange={setImportFile}
                    placeholder="Import standings CSV"
                    accept=".csv,text/csv"
                  />
                  <Button
                    onClick={async () => {
                      if (importFile == null) return;
                      await importSeasonStandingsCsv(activeTournamentId, importFile);
                      await swrStandingsResponse.mutate();
                      setImportFile(null);
                      showNotification({ color: 'green', title: 'Standings CSV imported', message: '' });
                    }}
                  >
                    Import CSV
                  </Button>
                </Group>
              )}
            </Group>
          </Card>
        )}
        <Card withBorder>
          <Title order={4} mb="sm">Cumulative Across All Seasons</Title>
          <StandingsTable rows={cumulativeRows} />
        </Card>
        {seasons.map((season: any) => (
          <Card withBorder key={season.season_id}>
            <Group justify="space-between" mb="sm">
              <Title order={4}>{season.season_name}</Title>
              {season.is_active && <Badge color="green">Active</Badge>}
            </Group>
            <StandingsTable rows={season.standings ?? []} />
          </Card>
        ))}
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }
  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
