import {
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';

import RequestErrorAlert from '@components/utils/error_alert';
import PreloadLink from '@components/utils/link';
import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueAdminUsers,
  getLeagueProjectedSchedule,
  getLeagueSeasons,
  getTournaments,
} from '@services/adapter';
import {
  createProjectedScheduleEvent,
  createProjectedScheduleItem,
  deleteProjectedScheduleItem,
  updateProjectedScheduleItem,
} from '@services/league';

function formatDate(value: string | null | undefined) {
  if (value == null || value === '') return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toLocalInputValue(isoValue: string | null | undefined) {
  if (isoValue == null || isoValue === '') return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function ProjectedSchedulePage({ standalone = false }: { standalone?: boolean }) {
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

  const swrScheduleResponse = getLeagueProjectedSchedule(activeTournamentId);
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const swrSeasonsResponse = getLeagueSeasons(activeTournamentId);
  const seasons = swrSeasonsResponse.data?.data ?? [];
  const isAdmin = swrAdminUsersResponse.data != null;
  const rows = useMemo(() => swrScheduleResponse.data?.data ?? [], [swrScheduleResponse.data]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [roundLabel, setRoundLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'COMPLETED'>('PLANNED');
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [seriesWeeks, setSeriesWeeks] = useState<number>(1);

  const [wizardSeasonId, setWizardSeasonId] = useState<string | null>(null);
  const [wizardStartsAt, setWizardStartsAt] = useState('');
  const [wizardRoundRobinWeeks, setWizardRoundRobinWeeks] = useState<number>(4);
  const [wizardFinalStages, setWizardFinalStages] = useState('Swiss Finals, Top Cut');

  const resetForm = () => {
    setEditingId(null);
    setRoundLabel('');
    setStartsAt('');
    setTitle('');
    setDetails('');
    setStatus('PLANNED');
    setSeasonId(null);
    setSortOrder(0);
    setSeriesWeeks(1);
  };

  const startEdit = (row: any) => {
    setEditingId(Number(row.id));
    setRoundLabel(String(row.round_label ?? ''));
    setStartsAt(toLocalInputValue(row.starts_at));
    setTitle(String(row.title ?? ''));
    setDetails(String(row.details ?? ''));
    const rawStatus = String(row.status ?? '').trim().toUpperCase();
    if (rawStatus === 'OPEN' || rawStatus === 'IN_PROGRESS' || rawStatus === 'COMPLETED') {
      setStatus(rawStatus);
    } else {
      setStatus('PLANNED');
    }
    setSeasonId(row.season_id != null ? String(row.season_id) : null);
    setSortOrder(Number(row.sort_order ?? 0));
    setSeriesWeeks(1);
  };

  const content = (
    <Stack>
      <Title>Projected League Schedule</Title>
      <Text c="dimmed">
        Configurable roadmap for planned rounds and events. Admins can update this at any time.
      </Text>

      {swrScheduleResponse.error && <RequestErrorAlert error={swrScheduleResponse.error} />}

      {isAdmin && (
        <Card withBorder>
          <Stack>
            <Title order={4}>
              {editingId == null ? 'Add Schedule Item' : 'Edit Schedule Item'}
            </Title>
            <Group grow align="end">
              <TextInput
                label="Round/Stage"
                value={roundLabel}
                onChange={(event) => setRoundLabel(event.currentTarget.value)}
                placeholder="Week 3 Round Robin"
              />
              <TextInput
                label="Start Time"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.currentTarget.value)}
              />
              <NumberInput
                label="Sort Order"
                value={sortOrder}
                onChange={(value) => setSortOrder(Number(value ?? 0))}
                min={0}
                max={1000}
              />
            </Group>
            <TextInput
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Swiss Round 1 Pairings Posted"
            />
            <Textarea
              label="Details"
              minRows={3}
              value={details}
              onChange={(event) => setDetails(event.currentTarget.value)}
              placeholder="Expected timing and additional notes"
            />
            <Group grow align="end">
              <Select
                label="Status"
                value={status}
                allowDeselect={false}
                data={[
                  { value: 'PLANNED', label: 'Planned' },
                  { value: 'OPEN', label: 'Open' },
                  { value: 'IN_PROGRESS', label: 'In Progress' },
                  { value: 'COMPLETED', label: 'Completed' },
                ]}
                onChange={(value) => {
                  if (value === 'OPEN' || value === 'IN_PROGRESS' || value === 'COMPLETED') {
                    setStatus(value);
                    return;
                  }
                  setStatus('PLANNED');
                }}
              />
              <Select
                label="Season (Optional)"
                value={seasonId}
                onChange={setSeasonId}
                clearable
                searchable
                data={seasons.map((season: any) => ({
                  value: String(season.season_id),
                  label: `${season.name}${season.is_active ? ' (Active)' : ''}`,
                }))}
              />
              {editingId == null && (
                <NumberInput
                  label="Repeat Weekly"
                  value={seriesWeeks}
                  onChange={(value) => setSeriesWeeks(Math.max(1, Number(value ?? 1)))}
                  min={1}
                  max={12}
                  step={1}
                />
              )}
            </Group>
            <Group>
              <Button
                onClick={async () => {
                  if (activeTournamentId <= 0 || title.trim() === '') return;
                  const payload = {
                    round_label: roundLabel.trim() === '' ? null : roundLabel.trim(),
                    starts_at: startsAt.trim() === '' ? null : new Date(startsAt).toISOString(),
                    title: title.trim(),
                    details: details.trim() === '' ? null : details.trim(),
                    status: status,
                    season_id: seasonId == null || seasonId === '' ? null : Number(seasonId),
                    sort_order: Number(sortOrder ?? 0),
                  };
                  if (editingId == null) {
                    const repeatCount = Math.max(1, Number(seriesWeeks ?? 1));
                    const baseStartsAt = payload.starts_at == null ? null : new Date(payload.starts_at);
                    for (let index = 0; index < repeatCount; index += 1) {
                      const startsAtIso =
                        baseStartsAt == null
                          ? null
                          : new Date(baseStartsAt.getTime() + index * 7 * 24 * 60 * 60 * 1000).toISOString();
                      await createProjectedScheduleItem(activeTournamentId, {
                        ...payload,
                        starts_at: startsAtIso,
                        title:
                          repeatCount > 1
                            ? `${payload.title} (Week ${index + 1})`
                            : payload.title,
                        sort_order: Number(sortOrder ?? 0) + index,
                      });
                    }
                    showNotification({
                      color: 'green',
                      title:
                        repeatCount > 1
                          ? `Created ${repeatCount} schedule items`
                          : 'Schedule item created',
                      message: '',
                    });
                  } else {
                    await updateProjectedScheduleItem(activeTournamentId, editingId, payload);
                    showNotification({
                      color: 'green',
                      title: 'Schedule item updated',
                      message: '',
                    });
                  }
                  resetForm();
                  await swrScheduleResponse.mutate();
                }}
              >
                {editingId == null ? 'Save Item' : 'Update Item'}
              </Button>
              {editingId != null && (
                <Button variant="light" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      )}

      {isAdmin && (
        <Card withBorder>
          <Stack>
            <Title order={4}>Season Schedule Helper</Title>
            <Text c="dimmed" size="sm">
              Quickly create a weekly round-robin block plus finals milestones.
            </Text>
            <Group grow align="end">
              <Select
                label="Season"
                value={wizardSeasonId}
                onChange={setWizardSeasonId}
                clearable
                searchable
                data={seasons.map((season: any) => ({
                  value: String(season.season_id),
                  label: `${season.name}${season.is_active ? ' (Active)' : ''}`,
                }))}
              />
              <TextInput
                label="Start Time"
                type="datetime-local"
                value={wizardStartsAt}
                onChange={(event) => setWizardStartsAt(event.currentTarget.value)}
              />
              <NumberInput
                label="Round Robin Weeks"
                value={wizardRoundRobinWeeks}
                onChange={(value) =>
                  setWizardRoundRobinWeeks(Math.max(1, Number(value ?? 1)))
                }
                min={1}
                max={20}
              />
            </Group>
            <TextInput
              label="Finals Stages (comma separated)"
              value={wizardFinalStages}
              onChange={(event) => setWizardFinalStages(event.currentTarget.value)}
              placeholder="Swiss Finals, Top Cut, Championship"
            />
            <Group>
              <Button
                variant="outline"
                onClick={async () => {
                  if (activeTournamentId <= 0 || wizardStartsAt.trim() === '') return;
                  const startDate = new Date(wizardStartsAt);
                  if (Number.isNaN(startDate.getTime())) return;

                  const seasonLabel =
                    seasons.find((season: any) => String(season.season_id) === wizardSeasonId)?.name ??
                    'Season';
                  const seasonNumber =
                    wizardSeasonId == null || wizardSeasonId === '' ? null : Number(wizardSeasonId);

                  for (let week = 0; week < Math.max(1, Number(wizardRoundRobinWeeks ?? 1)); week += 1) {
                    await createProjectedScheduleItem(activeTournamentId, {
                      round_label: `Week ${week + 1}`,
                      starts_at: new Date(
                        startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000
                      ).toISOString(),
                      title: `${seasonLabel} Round Robin - Week ${week + 1}`,
                      details: null,
                      status: 'PLANNED',
                      season_id: seasonNumber,
                      sort_order: week,
                    });
                  }

                  const finalsStages = wizardFinalStages
                    .split(',')
                    .map((value) => value.trim())
                    .filter((value) => value !== '');
                  for (let index = 0; index < finalsStages.length; index += 1) {
                    const stage = finalsStages[index];
                    await createProjectedScheduleItem(activeTournamentId, {
                      round_label: `Finals ${index + 1}`,
                      starts_at: new Date(
                        startDate.getTime() +
                          (Math.max(1, Number(wizardRoundRobinWeeks ?? 1)) + index) *
                            7 *
                            24 *
                            60 *
                            60 *
                            1000
                      ).toISOString(),
                      title: `${seasonLabel} ${stage}`,
                      details: null,
                      status: 'PLANNED',
                      season_id: seasonNumber,
                      sort_order: Math.max(1, Number(wizardRoundRobinWeeks ?? 1)) + index,
                    });
                  }
                  showNotification({
                    color: 'green',
                    title: 'Season schedule generated',
                    message: '',
                  });
                  await swrScheduleResponse.mutate();
                }}
              >
                Generate Season Schedule
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Round/Stage</Table.Th>
              <Table.Th>Season</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Projected Start</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Details</Table.Th>
              <Table.Th>Event</Table.Th>
              <Table.Th>Sort</Table.Th>
              {isAdmin && <Table.Th></Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length < 1 && (
              <Table.Tr>
                <Table.Td colSpan={isAdmin ? 9 : 8}>
                  <Text c="dimmed" size="sm">
                    No projected schedule items configured yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((row: any) => (
              <Table.Tr key={row.id}>
                <Table.Td>{row.round_label ?? '-'}</Table.Td>
                <Table.Td>
                  {row.season_id != null
                    ? seasons.find((season: any) => Number(season.season_id) === Number(row.season_id))
                        ?.name ?? `Season ${row.season_id}`
                    : '-'}
                </Table.Td>
                <Table.Td>{row.title}</Table.Td>
                <Table.Td>{formatDate(row.starts_at)}</Table.Td>
                <Table.Td>{row.status ?? 'PLANNED'}</Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {row.details ?? '-'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {row.linked_tournament_id != null ? (
                    <Button
                      size="xs"
                      variant="subtle"
                      component={PreloadLink}
                      href={`/tournaments/${row.linked_tournament_id}/entries`}
                    >
                      {row.linked_tournament_name ?? `Event ${row.linked_tournament_id}`}
                    </Button>
                  ) : (
                    <Text size="sm" c="dimmed">
                      -
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{row.sort_order ?? 0}</Table.Td>
                {isAdmin && (
                  <Table.Td>
                    <Group justify="flex-end" gap={8}>
                      {row.linked_tournament_id == null && (
                        <Button
                          size="xs"
                          variant="light"
                          onClick={async () => {
                            const confirmed = window.confirm(
                              `Create an event from \"${row.title}\"?`
                            );
                            if (!confirmed) return;
                            await createProjectedScheduleEvent(
                              activeTournamentId,
                              Number(row.id)
                            );
                            await swrScheduleResponse.mutate();
                            showNotification({
                              color: 'green',
                              title: 'Event created',
                              message: '',
                            });
                          }}
                        >
                          Create Event
                        </Button>
                      )}
                      <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        onClick={async () => {
                          await deleteProjectedScheduleItem(activeTournamentId, Number(row.id));
                          await swrScheduleResponse.mutate();
                        }}
                      >
                        Delete
                      </Button>
                    </Group>
                  </Table.Td>
                )}
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

  return <TournamentLayout tournament_id={tournamentData.id}>{content}</TournamentLayout>;
}
