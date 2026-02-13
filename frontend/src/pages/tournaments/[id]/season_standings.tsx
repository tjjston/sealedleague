import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';

import { getTournamentIdFromRouter } from '@components/utils/util';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueSeasonStandings } from '@services/adapter';

export default function SeasonStandingsPage() {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrStandingsResponse = getLeagueSeasonStandings(tournamentData.id);
  const rows = swrStandingsResponse.data?.data ?? [];

  return (
    <TournamentLayout tournament_id={tournamentData.id}>
      <Stack>
        <Title>Season Standings</Title>
        <Text c="dimmed">Cumulative points and league accolades for this active season.</Text>
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
    </TournamentLayout>
  );
}
