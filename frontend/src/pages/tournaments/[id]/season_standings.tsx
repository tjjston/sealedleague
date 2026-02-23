import {
  Badge,
  Button,
  Card,
  Checkbox,
  HoverCard,
  FileInput,
  Group,
  Image,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import RequestErrorAlert from '@components/utils/error_alert';
import PreloadLink from '@components/utils/link';
import {
  buildCardLookupByKey,
  resolveCardFromLookup,
  resolveCardLabel,
} from '@components/utils/card_id';
import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueCardsGlobal,
  getUser,
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
  updateSeasonPrivileges,
} from '@services/league';
export default function SeasonStandingsPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrTournamentsResponse = getTournaments('ALL');
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
  const swrCurrentUserResponse = getUser();
  const swrUserDirectoryResponse = getUserDirectory();
  const isAdmin = String(swrCurrentUserResponse.data?.data?.account_type ?? 'REGULAR') === 'ADMIN';
  const swrAdminSeasonsResponse = getLeagueAdminSeasons(isAdmin ? activeTournamentId : null);
  const seasons = swrStandingsResponse.data?.data?.seasons;
  const seasonHistoryRows = useMemo(() => {
    const byId = new Map<number, any>();
    for (const season of seasons ?? []) {
      const seasonId = Number(season?.season_id ?? 0);
      if (!Number.isInteger(seasonId) || seasonId <= 0) continue;
      const existing = byId.get(seasonId);
      if (existing == null) {
        byId.set(seasonId, season);
        continue;
      }
      const existingIsActive = Boolean(existing?.is_active);
      const candidateIsActive = Boolean(season?.is_active);
      if (!existingIsActive && candidateIsActive) {
        byId.set(seasonId, season);
        continue;
      }
      if (existingIsActive === candidateIsActive) {
        byId.set(seasonId, season);
      }
    }
    return [...byId.values()].sort(
      (left: any, right: any) => Number(left?.season_id ?? 0) - Number(right?.season_id ?? 0)
    );
  }, [seasons]);
  const adminSeasons = swrAdminSeasonsResponse.data?.data;
  const cumulativeRows = swrStandingsResponse.data?.data?.cumulative ?? [];
  const [importFile, setImportFile] = useState<File | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [seasonNameDrafts, setSeasonNameDrafts] = useState<Record<number, string>>({});
  const [seasonExpanded, setSeasonExpanded] = useState<Record<number, boolean>>({});
  const [seasonVisibilitySeasonId, setSeasonVisibilitySeasonId] = useState<number | null>(null);

  const seasonRows = useMemo(() => {
    const sourceRows =
      adminSeasons != null && adminSeasons.length > 0
        ? adminSeasons.map((season: any) => ({
            season_id: Number(season.season_id),
            season_name: String(season.name ?? ''),
            is_active: Boolean(season.is_active),
          }))
        : seasonHistoryRows.map((season: any) => ({
            season_id: Number(season.season_id),
            season_name: String(season.season_name ?? ''),
            is_active: Boolean(season.is_active),
          }));

    const byId = new Map<number, { season_id: number; season_name: string; is_active: boolean }>();
    for (const row of sourceRows) {
      if (!Number.isInteger(row.season_id) || row.season_id <= 0) continue;
      const existing = byId.get(row.season_id);
      if (existing == null) {
        byId.set(row.season_id, row);
        continue;
      }
      if (!existing.is_active && row.is_active) {
        byId.set(row.season_id, row);
        continue;
      }
      if (existing.is_active === row.is_active) {
        byId.set(row.season_id, row);
      }
    }

    return [...byId.values()]
      .sort((left, right) => left.season_id - right.season_id)
      .map((row) => ({ season_id: row.season_id, season_name: row.season_name }));
  }, [adminSeasons, seasonHistoryRows]);
  const swrCardCatalogResponse = getLeagueCardsGlobal({ limit: 5000, offset: 0 });
  const cardCatalogRows = swrCardCatalogResponse.data?.data?.cards ?? [];
  const cardLookupById = useMemo(() => buildCardLookupByKey(cardCatalogRows as any[]), [cardCatalogRows]);
  const swrAdminUsersResponse = getLeagueAdminUsers(
    isAdmin ? activeTournamentId : null,
    isAdmin ? seasonVisibilitySeasonId : null
  );
  const adminUsers = swrAdminUsersResponse.data?.data ?? [];

  useEffect(() => {
    if (seasonRows.length < 1) {
      setSeasonVisibilitySeasonId(null);
      return;
    }
    const activeSeasonId =
      Number(
        seasonHistoryRows.find((season: any) => Boolean(season?.is_active))?.season_id ?? 0
      ) || null;
    setSeasonVisibilitySeasonId((previous) => {
      if (
        previous != null &&
        seasonRows.some((row) => Number(row.season_id) === Number(previous))
      ) {
        return previous;
      }
      if (activeSeasonId != null && seasonRows.some((row) => Number(row.season_id) === activeSeasonId)) {
        return activeSeasonId;
      }
      return seasonRows[0].season_id;
    });
  }, [seasonRows, seasonHistoryRows]);

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
      const card = resolveCardFromLookup(cardLookupById, row?.favorite_card_id ?? row?.favorite_card_name);
      result[key] = {
        cardName: resolveCardLabel({
          explicitName: row?.favorite_card_name,
          cardId: row?.favorite_card_id,
          lookup: cardLookupById,
          emptyLabel: 'No showcase card selected',
        }),
        imageUrl:
          String(row?.favorite_card_image_url ?? '').trim() !== ''
            ? String(row.favorite_card_image_url)
            : String(card?.image_url ?? '').trim() !== ''
              ? String(card?.image_url)
              : null,
      };
      return result;
    }, {});
  }, [cardLookupById, swrUserDirectoryResponse.data?.data]);

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
            {isAdmin ? <Table.Th>Privileges</Table.Th> : null}
            <Table.Th>Accolades</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row: any, index: number) => {
            const showcase = showcaseByUserName[String(row.user_name ?? '').trim().toLowerCase()] ?? null;
            const profileHref =
              Number.isFinite(Number(row.user_id)) && Number(row.user_id) > 0
                ? `/league/players/${row.user_id}`
                : null;
            const playerNameText = (
              <Text fw={600} td="underline" style={{ textDecorationStyle: 'dotted' }}>
                {row.user_name}
              </Text>
            );
            const playerNameNode =
              profileHref != null ? (
                <PreloadLink href={profileHref}>{playerNameText}</PreloadLink>
              ) : (
                playerNameText
              );
            return (
              <Table.Tr key={`${row.user_id}-${index}`}>
                <Table.Td>{index + 1}</Table.Td>
                <Table.Td>
                  <Stack gap={0}>
                    {showcase != null ? (
                      <HoverCard width={240} shadow="md" position="right">
                        <HoverCard.Target>{playerNameNode}</HoverCard.Target>
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
                      profileHref != null ? (
                        <PreloadLink href={profileHref}>
                          <Text fw={600}>{row.user_name}</Text>
                        </PreloadLink>
                      ) : (
                        <Text fw={600}>{row.user_name}</Text>
                      )
                    )}
                  </Stack>
                </Table.Td>
                <Table.Td>{row.points}</Table.Td>
                <Table.Td>{row.event_wins ?? 0}</Table.Td>
                <Table.Td>{row.tournament_wins ?? 0}</Table.Td>
                <Table.Td>{row.tournament_placements ?? 0}</Table.Td>
                <Table.Td>{row.prize_packs ?? 0}</Table.Td>
                {isAdmin ? (
                  <Table.Td>
                    <Group gap={6}>
                      {row.role != null && <Badge variant="light">{row.role}</Badge>}
                      {row.can_manage_points && <Badge color="teal">Points</Badge>}
                      {row.can_manage_tournaments && <Badge color="indigo">Tournaments</Badge>}
                    </Group>
                  </Table.Td>
                ) : null}
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
      {swrStandingsResponse.error && <RequestErrorAlert error={swrStandingsResponse.error} />}
      {swrAdminSeasonsResponse.error && <RequestErrorAlert error={swrAdminSeasonsResponse.error} />}
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
      {isAdmin && (
        <Card withBorder>
          <Stack>
            <Group justify="space-between" align="end">
              <Title order={4}>Season Player Visibility</Title>
              <Select
                label="Season"
                value={seasonVisibilitySeasonId != null ? String(seasonVisibilitySeasonId) : null}
                onChange={(value) =>
                  setSeasonVisibilitySeasonId(value != null ? Number(value) : null)
                }
                data={seasonRows.map((row) => ({
                  value: String(row.season_id),
                  label: row.season_name,
                }))}
                allowDeselect={false}
                style={{ minWidth: 260 }}
              />
            </Group>
            <Text c="dimmed" size="sm">
              Hide/unhide individual players for the selected season standings.
            </Text>
            {swrAdminUsersResponse.error && <RequestErrorAlert error={swrAdminUsersResponse.error} />}
            <Table stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Hide From Standings</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {adminUsers.map((user: any) => (
                  <Table.Tr key={String(user.user_id)}>
                    <Table.Td>{String(user.user_name ?? '')}</Table.Td>
                    <Table.Td>
                      <Checkbox
                        checked={Boolean(user.hide_from_standings)}
                        disabled={seasonVisibilitySeasonId == null}
                        onChange={async (event) => {
                          if (seasonVisibilitySeasonId == null || activeTournamentId <= 0) return;
                          await updateSeasonPrivileges(
                            activeTournamentId,
                            Number(user.user_id),
                            {
                              role:
                                String(user.role ?? 'PLAYER').toUpperCase() === 'ADMIN'
                                  ? 'ADMIN'
                                  : 'PLAYER',
                              can_manage_points: Boolean(user.can_manage_points),
                              can_manage_tournaments: Boolean(user.can_manage_tournaments),
                              hide_from_standings: event.currentTarget.checked,
                            },
                            seasonVisibilitySeasonId
                          );
                          await swrAdminUsersResponse.mutate();
                          await swrStandingsResponse.mutate();
                          showNotification({
                            color: 'green',
                            title: event.currentTarget.checked
                              ? 'Player hidden from season standings'
                              : 'Player shown in season standings',
                            message: '',
                          });
                        }}
                      />
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
      {seasonHistoryRows.map((season: any) => (
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
