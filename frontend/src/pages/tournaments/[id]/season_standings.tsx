import {
  Badge,
  Button,
  Card,
  HoverCard,
  FileInput,
  Group,
  Image,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueAdminSeasons,
  getLeagueAdminUsers,
  getLeagueSeasonHistory,
  getTournaments,
  getUserDirectory,
} from '@services/adapter';
import {
  createLeagueSeason,
  deleteLeagueSeason,
  exportSeasonStandingsCsv,
  importSeasonStandingsCsv,
  updateLeagueSeason,
} from '@services/league';
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
  const swrUserDirectoryResponse = getUserDirectory();
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const swrAdminSeasonsResponse = getLeagueAdminSeasons(activeTournamentId);
  const isAdmin = swrAdminUsersResponse.data != null || swrAdminSeasonsResponse.data != null;
  const seasons = swrStandingsResponse.data?.data?.seasons;
  const adminSeasons = swrAdminSeasonsResponse.data?.data;
  const cumulativeRows = swrStandingsResponse.data?.data?.cumulative ?? [];
  const [importFile, setImportFile] = useState<File | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [seasonNameDrafts, setSeasonNameDrafts] = useState<Record<number, string>>({});
  const [seasonExpanded, setSeasonExpanded] = useState<Record<number, boolean>>({});

  const seasonRows = useMemo(
    () =>
      (adminSeasons != null && adminSeasons.length > 0
        ? adminSeasons.map((season: any) => ({
            season_id: Number(season.season_id),
            season_name: String(season.name ?? ''),
          }))
        : (seasons ?? []).map((season: any) => ({
            season_id: Number(season.season_id),
            season_name: String(season.season_name ?? ''),
          }))) as Array<{ season_id: number; season_name: string }>,
    [adminSeasons, seasons]
  );

  useEffect(() => {
    setSeasonNameDrafts((previous) => {
      const next = { ...previous };
      let changed = false;
      seasonRows.forEach((row) => {
        if (next[row.season_id] == null || next[row.season_id] === '') {
          next[row.season_id] = row.season_name;
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [seasonRows]);

  const showcaseByUserName = useMemo(() => {
    const rows = swrUserDirectoryResponse.data?.data ?? [];
    return rows.reduce((result: Record<string, any>, row: any) => {
      const key = String(row?.user_name ?? '').trim().toLowerCase();
      if (key === '' || result[key] != null) return result;
      result[key] = {
        cardName: row?.favorite_card_name ?? row?.favorite_card_id ?? null,
        imageUrl: row?.favorite_card_image_url ?? null,
      };
      return result;
    }, {});
  }, [swrUserDirectoryResponse.data?.data]);

  function StandingsTable({ rows }: { rows: any[] }) {
    return (
      <Table stickyHeader>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Player</Table.Th>
            <Table.Th>Points</Table.Th>
            <Table.Th>Event Wins</Table.Th>
            <Table.Th>Tournament Wins</Table.Th>
            <Table.Th>Placements</Table.Th>
            <Table.Th>Packs</Table.Th>
            <Table.Th>Privileges</Table.Th>
            <Table.Th>Accolades</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row: any, index: number) => {
            const showcase = showcaseByUserName[String(row.user_name ?? '').trim().toLowerCase()] ?? null;
            return (
              <Table.Tr key={`${row.user_id}-${index}`}>
                <Table.Td>{index + 1}</Table.Td>
                <Table.Td>
                  <Stack gap={0}>
                    {showcase != null ? (
                      <HoverCard width={240} shadow="md" position="right">
                        <HoverCard.Target>
                          <Text fw={600} td="underline" style={{ textDecorationStyle: 'dotted' }}>
                            {row.user_name}
                          </Text>
                        </HoverCard.Target>
                        <HoverCard.Dropdown>
                          <Stack gap={6}>
                            <Text fw={700} size="sm">
                              Showcase Card
                            </Text>
                            {showcase.imageUrl ? (
                              <Image src={showcase.imageUrl} h={130} fit="contain" radius="sm" />
                            ) : null}
                            <Text size="sm">{showcase.cardName ?? 'No showcase card selected'}</Text>
                          </Stack>
                        </HoverCard.Dropdown>
                      </HoverCard>
                    ) : (
                      <Text fw={600}>{row.user_name}</Text>
                    )}
                    <Text size="xs" c="dimmed">
                      {row.user_email}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>{row.points}</Table.Td>
                <Table.Td>{row.event_wins ?? 0}</Table.Td>
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
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }
  const content = (
    <Stack>
      <Title>Season Standings</Title>
      <Text c="dimmed">Cumulative points and league accolades for this active season.</Text>
      {isAdmin && (
        <Card withBorder>
          <Stack>
            <Title order={4}>Season Controls</Title>
            <Group align="end">
              <TextInput
                label="New Season Name"
                placeholder="Season 3"
                value={seasonName}
                onChange={(event) => setSeasonName(event.currentTarget.value)}
                style={{ minWidth: 260 }}
              />
              <Button
                onClick={async () => {
                  if (seasonName.trim() === '' || activeTournamentId <= 0) return;
                  await createLeagueSeason(activeTournamentId, {
                    name: seasonName.trim(),
                    is_active: false,
                    tournament_ids: [activeTournamentId],
                  });
                  setSeasonName('');
                  await swrAdminSeasonsResponse.mutate();
                  await swrStandingsResponse.mutate();
                  showNotification({ color: 'green', title: 'Season created', message: '' });
                }}
              >
                Create Season
              </Button>
            </Group>
            <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Season</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                {((adminSeasons ?? []).length > 0
                  ? (adminSeasons ?? []).map((season: any) => ({
                      season_id: season.season_id,
                      season_name: season.name,
                      is_active: season.is_active,
                    }))
                  : (seasons ?? [])
                ).map((season: any) => (
                  <Table.Tr key={season.season_id}>
                    <Table.Td>
                      <TextInput
                        size="xs"
                        value={seasonNameDrafts[season.season_id] ?? season.season_name}
                        onChange={(event) =>
                          setSeasonNameDrafts((previous) => ({
                            ...previous,
                            [season.season_id]: event.currentTarget.value,
                          }))
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      {season.is_active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>}
                    </Table.Td>
                    <Table.Td>
                      <Group>
                        <Button
                          size="xs"
                          variant="light"
                          disabled={
                            (seasonNameDrafts[season.season_id] ?? season.season_name).trim() === '' ||
                            (seasonNameDrafts[season.season_id] ?? season.season_name).trim() ===
                              String(season.season_name ?? '').trim()
                          }
                          onClick={async () => {
                            if (activeTournamentId <= 0) return;
                            const nextName = (seasonNameDrafts[season.season_id] ?? season.season_name).trim();
                            if (nextName === '') return;
                            await updateLeagueSeason(activeTournamentId, season.season_id, {
                              name: nextName,
                            });
                            await swrAdminSeasonsResponse.mutate();
                            await swrStandingsResponse.mutate();
                            showNotification({ color: 'green', title: 'Season renamed', message: '' });
                          }}
                        >
                          Save Name
                        </Button>
                        {!season.is_active && (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={async () => {
                              if (activeTournamentId <= 0) return;
                              await updateLeagueSeason(activeTournamentId, season.season_id, {
                                is_active: true,
                              });
                              await swrAdminSeasonsResponse.mutate();
                              await swrStandingsResponse.mutate();
                              showNotification({
                                color: 'green',
                                title: 'Active season updated',
                                message: '',
                              });
                            }}
                          >
                            Set Active
                          </Button>
                        )}
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          disabled={season.is_active}
                          onClick={async () => {
                            if (activeTournamentId <= 0) return;
                            const confirmed = window.confirm(
                              `Delete ${season.season_name}? This cannot be undone.`
                            );
                            if (!confirmed) return;
                            await deleteLeagueSeason(activeTournamentId, season.season_id);
                            setSeasonNameDrafts((previous) => {
                              const next = { ...previous };
                              delete next[season.season_id];
                              return next;
                            });
                            await swrAdminSeasonsResponse.mutate();
                            await swrStandingsResponse.mutate();
                            showNotification({ color: 'green', title: 'Season deleted', message: '' });
                          }}
                        >
                          Delete
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>
      )}
      {standalone && isAdmin && (
        <Card withBorder>
          <Group align="end">
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
                  showNotification({
                    color: 'green',
                    title: 'Standings CSV imported',
                    message: '',
                  });
                }}
              >
                Import CSV
              </Button>
            </Group>
          </Group>
        </Card>
      )}
      <Card withBorder>
        <Title order={4} mb="sm">
          Cumulative Across All Seasons
        </Title>
        <StandingsTable rows={cumulativeRows} />
      </Card>
      {(seasons ?? []).map((season: any) => (
        <Card withBorder key={season.season_id}>
          <Group justify="space-between" mb="sm">
            <Title order={4}>{season.season_name}</Title>
            <Group gap={8}>
              {season.is_active && <Badge color="green">Active</Badge>}
              <Button
                size="xs"
                variant="subtle"
                onClick={() =>
                  setSeasonExpanded((previous) => ({
                    ...previous,
                    [season.season_id]:
                      !(previous[season.season_id] ?? Boolean(season.is_active)),
                  }))
                }
              >
                {(seasonExpanded[season.season_id] ?? Boolean(season.is_active))
                  ? 'Hide standings'
                  : 'Show standings'}
              </Button>
            </Group>
          </Group>
          {(seasonExpanded[season.season_id] ?? Boolean(season.is_active)) && (
            <StandingsTable rows={season.standings ?? []} />
          )}
        </Card>
      ))}
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }
  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
