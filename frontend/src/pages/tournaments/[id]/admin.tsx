import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  MultiSelect,
  Select,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import { getTournamentIdFromRouter } from '@components/utils/util';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueAdminSeasons, getLeagueAdminUsers, getLeagueDecks, getTournaments } from '@services/adapter';
import { updateUserAccountType } from '@services/user';
import {
  adjustSeasonUserPoints,
  awardAccolade,
  createLeagueSeason,
  deleteLeagueSeason,
  deleteDeck,
  exportStandingsTemplate,
  exportTournamentFormatTemplate,
  importStandingsTemplate,
  importTournamentFormatTemplate,
  updateLeagueSeason,
  updateSeasonPrivileges,
} from '@services/league';

export default function LeagueAdminPage() {
  const { tournamentData } = getTournamentIdFromRouter();
  const [seasonForPoints, setSeasonForPoints] = useState<string | null>(null);
  const swrUsersResponse = getLeagueAdminUsers(
    tournamentData.id,
    seasonForPoints != null ? Number(seasonForPoints) : null,
    true
  );
  const swrSeasonsResponse = getLeagueAdminSeasons(tournamentData.id);
  const swrTournamentsResponse = getTournaments('OPEN');
  const swrDecksResponse = getLeagueDecks(tournamentData.id);
  const users = swrUsersResponse.data?.data ?? [];
  const seasons = swrSeasonsResponse.data?.data ?? [];
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const decks = swrDecksResponse.data?.data ?? [];

  const [accolades, setAccolades] = useState<Record<string, string>>({});
  const [standingsTemplateJson, setStandingsTemplateJson] = useState('');
  const [tournamentTemplateJson, setTournamentTemplateJson] = useState('');
  const [seasonName, setSeasonName] = useState('');
  const [seasonTournamentIds, setSeasonTournamentIds] = useState<string[]>([]);
  const [pointsDeltaByUser, setPointsDeltaByUser] = useState<Record<string, string>>({});
  const [pointsReasonByUser, setPointsReasonByUser] = useState<Record<string, string>>({});

  useEffect(() => {
    if (seasons.length < 1) {
      setSeasonForPoints(null);
      return;
    }
    if (
      seasonForPoints != null &&
      seasons.some((season: any) => String(season.season_id) === String(seasonForPoints))
    ) {
      return;
    }
    const activeSeason = seasons.find((season: any) => Boolean(season?.is_active));
    setSeasonForPoints(String(activeSeason?.season_id ?? seasons[0]?.season_id));
  }, [seasons, seasonForPoints]);

  return (
    <TournamentLayout tournament_id={tournamentData.id}>
      <Stack>
        <Title>League Admin</Title>

        <Card withBorder>
          <Title order={4} mb="sm">
            Templates: Export / Import
          </Title>
          <Stack>
            <Group>
              <Button
                variant="outline"
                onClick={async () => {
                  const response = await exportStandingsTemplate(tournamentData.id);
                  // @ts-ignore
                  const payload = response?.data;
                  if (payload == null) return;
                  const json = JSON.stringify(payload, null, 2);
                  setStandingsTemplateJson(json);
                  await navigator.clipboard.writeText(json);
                  showNotification({ color: 'green', title: 'Standings template exported', message: '' });
                }}
              >
                Export Standings Template
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  const response = await exportTournamentFormatTemplate(tournamentData.id);
                  // @ts-ignore
                  const payload = response?.data;
                  if (payload == null) return;
                  const json = JSON.stringify(payload, null, 2);
                  setTournamentTemplateJson(json);
                  await navigator.clipboard.writeText(json);
                  showNotification({ color: 'green', title: 'Tournament format exported', message: '' });
                }}
              >
                Export Tournament Format
              </Button>
            </Group>

            <Textarea
              label="Standings Template JSON"
              minRows={5}
              value={standingsTemplateJson}
              onChange={(event) => setStandingsTemplateJson(event.currentTarget.value)}
            />
            <Button
              onClick={async () => {
                try {
                  const payload = JSON.parse(standingsTemplateJson);
                  await importStandingsTemplate(tournamentData.id, { rows: payload.rows ?? [] });
                  showNotification({ color: 'green', title: 'Standings imported', message: '' });
                } catch {
                  showNotification({ color: 'red', title: 'Invalid standings JSON', message: '' });
                }
              }}
            >
              Import Standings Template
            </Button>

            <Textarea
              label="Tournament Format JSON"
              minRows={5}
              value={tournamentTemplateJson}
              onChange={(event) => setTournamentTemplateJson(event.currentTarget.value)}
            />
            <Button
              onClick={async () => {
                try {
                  const payload = JSON.parse(tournamentTemplateJson);
                  await importTournamentFormatTemplate(tournamentData.id, payload.data ?? payload);
                  showNotification({ color: 'green', title: 'Tournament format imported', message: '' });
                } catch {
                  showNotification({ color: 'red', title: 'Invalid tournament format JSON', message: '' });
                }
              }}
            >
              Import Tournament Format
            </Button>
          </Stack>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Seasons
          </Title>
          <Stack>
            <Group>
              <TextInput
                label="Season Name"
                value={seasonName}
                onChange={(event) => setSeasonName(event.currentTarget.value)}
              />
              <MultiSelect
                label="Linked Tournaments"
                value={seasonTournamentIds}
                onChange={setSeasonTournamentIds}
                data={tournaments.map((t: any) => ({ value: String(t.id), label: t.name }))}
                style={{ minWidth: 320 }}
              />
              <Button
                onClick={async () => {
                  if (seasonName.trim() === '') return;
                  await createLeagueSeason(tournamentData.id, {
                    name: seasonName.trim(),
                    is_active: false,
                    tournament_ids: seasonTournamentIds.map((id) => Number(id)),
                  });
                  setSeasonName('');
                  await swrSeasonsResponse.mutate();
                }}
              >
                Create Season
              </Button>
            </Group>

            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Active</Table.Th>
                  <Table.Th>Tournaments</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {seasons.map((season: any) => (
                  <Table.Tr key={season.season_id}>
                    <Table.Td>{season.name}</Table.Td>
                    <Table.Td>{season.is_active ? 'Yes' : 'No'}</Table.Td>
                    <Table.Td>{(season.tournament_ids ?? []).join(', ') || '-'}</Table.Td>
                    <Table.Td>
                      <Group>
                        {!season.is_active && (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={async () => {
                              await updateLeagueSeason(tournamentData.id, season.season_id, {
                                is_active: true,
                              });
                              await swrSeasonsResponse.mutate();
                            }}
                          >
                            Set Active
                          </Button>
                        )}
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={async () => {
                            await deleteLeagueSeason(tournamentData.id, season.season_id);
                            await swrSeasonsResponse.mutate();
                          }}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            User Privileges
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Season Role</Table.Th>
                <Table.Th>Permissions</Table.Th>
                <Table.Th>Accolades</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.map((user: any) => (
                <Table.Tr key={user.user_id}>
                  <Table.Td>{user.user_name}</Table.Td>
                  <Table.Td>
                    <Select
                      value={user.account_type === 'ADMIN' ? 'ADMIN' : 'REGULAR'}
                      data={[
                        { value: 'REGULAR', label: 'USER' },
                        { value: 'ADMIN', label: 'ADMIN' },
                      ]}
                      allowDeselect={false}
                      onChange={async (value) => {
                        if (value == null) return;
                        await updateUserAccountType(user.user_id, value as 'REGULAR' | 'ADMIN');
                        await swrUsersResponse.mutate();
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Select
                      value={user.role ?? 'PLAYER'}
                      data={[
                        { value: 'PLAYER', label: 'PLAYER' },
                        { value: 'ADMIN', label: 'ADMIN' },
                      ]}
                      allowDeselect={false}
                      onChange={async (value) => {
                        const role = (value ?? 'PLAYER') as 'PLAYER' | 'ADMIN';
                        await updateSeasonPrivileges(tournamentData.id, user.user_id, {
                          role,
                          can_manage_points: Boolean(user.can_manage_points),
                          can_manage_tournaments: Boolean(user.can_manage_tournaments),
                          hide_from_standings: Boolean(user.hide_from_standings),
                        }, seasonForPoints != null ? Number(seasonForPoints) : undefined);
                        await swrUsersResponse.mutate();
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={4}>
                      <Checkbox
                        label="Manage points"
                        checked={Boolean(user.can_manage_points)}
                        onChange={async (event) => {
                          await updateSeasonPrivileges(tournamentData.id, user.user_id, {
                            role: (user.role ?? 'PLAYER') as 'PLAYER' | 'ADMIN',
                            can_manage_points: event.currentTarget.checked,
                            can_manage_tournaments: Boolean(user.can_manage_tournaments),
                            hide_from_standings: Boolean(user.hide_from_standings),
                          }, seasonForPoints != null ? Number(seasonForPoints) : undefined);
                          await swrUsersResponse.mutate();
                        }}
                      />
                      <Checkbox
                        label="Manage tournaments"
                        checked={Boolean(user.can_manage_tournaments)}
                        onChange={async (event) => {
                          await updateSeasonPrivileges(tournamentData.id, user.user_id, {
                            role: (user.role ?? 'PLAYER') as 'PLAYER' | 'ADMIN',
                            can_manage_points: Boolean(user.can_manage_points),
                            can_manage_tournaments: event.currentTarget.checked,
                            hide_from_standings: Boolean(user.hide_from_standings),
                          }, seasonForPoints != null ? Number(seasonForPoints) : undefined);
                          await swrUsersResponse.mutate();
                        }}
                      />
                      <Checkbox
                        label="Hide from standings"
                        checked={Boolean(user.hide_from_standings)}
                        onChange={async (event) => {
                          await updateSeasonPrivileges(tournamentData.id, user.user_id, {
                            role: (user.role ?? 'PLAYER') as 'PLAYER' | 'ADMIN',
                            can_manage_points: Boolean(user.can_manage_points),
                            can_manage_tournaments: Boolean(user.can_manage_tournaments),
                            hide_from_standings: event.currentTarget.checked,
                          }, seasonForPoints != null ? Number(seasonForPoints) : undefined);
                          await swrUsersResponse.mutate();
                        }}
                      />
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Group wrap="nowrap">
                      <TextInput
                        placeholder="Add accolade"
                        value={accolades[String(user.user_id)] ?? ''}
                        onChange={(event) => {
                          setAccolades((prev) => ({
                            ...prev,
                            [String(user.user_id)]: event.currentTarget.value,
                          }));
                        }}
                      />
                      <Button
                        onClick={async () => {
                          const value = accolades[String(user.user_id)] ?? '';
                          if (value.trim() === '') return;
                          await awardAccolade(tournamentData.id, user.user_id, value.trim());
                          setAccolades((prev) => ({ ...prev, [String(user.user_id)]: '' }));
                        }}
                      >
                        Award
                      </Button>
                      <TextInput
                        placeholder="Points delta"
                        value={pointsDeltaByUser[String(user.user_id)] ?? ''}
                        onChange={(event) =>
                          setPointsDeltaByUser((prev) => ({
                            ...prev,
                            [String(user.user_id)]: event.currentTarget.value,
                          }))
                        }
                      />
                      <TextInput
                        placeholder="Reason"
                        value={pointsReasonByUser[String(user.user_id)] ?? ''}
                        onChange={(event) =>
                          setPointsReasonByUser((prev) => ({
                            ...prev,
                            [String(user.user_id)]: event.currentTarget.value,
                          }))
                        }
                      />
                      <Button
                        variant="light"
                        onClick={async () => {
                          if (seasonForPoints == null) return;
                          const delta = Number(pointsDeltaByUser[String(user.user_id)] ?? '0');
                          if (!Number.isFinite(delta) || delta === 0) return;
                          await adjustSeasonUserPoints(
                            tournamentData.id,
                            Number(seasonForPoints),
                            user.user_id,
                            { points_delta: delta, reason: pointsReasonByUser[String(user.user_id)] ?? '' }
                          );
                          setPointsDeltaByUser((prev) => ({ ...prev, [String(user.user_id)]: '' }));
                          setPointsReasonByUser((prev) => ({ ...prev, [String(user.user_id)]: '' }));
                        }}
                      >
                        Adjust Points
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Select
            label="Season Context For Privileges / Points"
            value={seasonForPoints}
            onChange={setSeasonForPoints}
            data={seasons.map((s: any) => ({ value: String(s.season_id), label: s.name }))}
            mt="sm"
          />
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Decklist Management
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Deck</Table.Th>
                <Table.Th>Owner</Table.Th>
                <Table.Th>Leader / Base</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {decks.map((deck: any) => (
                <Table.Tr key={deck.id}>
                  <Table.Td>{deck.name}</Table.Td>
                  <Table.Td>{deck.user_name}</Table.Td>
                  <Table.Td>
                    {deck.leader} / {deck.base}
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={async () => {
                        await deleteDeck(tournamentData.id, deck.id);
                        await swrDecksResponse.mutate();
                      }}
                    >
                      <IconTrash size={15} />
                    </ActionIcon>
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
