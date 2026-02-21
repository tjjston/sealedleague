import {
  Button,
  Card,
  Group,
  MultiSelect,
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
import { useEffect, useMemo, useRef, useState } from 'react';

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

function getRoundRobinSlotPairings(teamCount: number): Array<Array<[number, number]>> {
  if (teamCount < 2) return [];

  let rounds = teamCount - 1;
  if (teamCount % 2 === 1) rounds = teamCount;
  const matchesPerRound = Math.floor((rounds + 1) / 2);

  let slots = Array.from({ length: rounds + 1 }, (_, index) => index);
  const pairings: Array<Array<[number, number]>> = [];
  for (let round = 0; round < rounds; round += 1) {
    const roundPairings: Array<[number, number]> = [];
    for (let match = 0; match < matchesPerRound; match += 1) {
      roundPairings.push([slots[match], slots[slots.length - 1 - match]]);
    }
    pairings.push(roundPairings);

    const rotatingSlot = rounds - round;
    slots = slots.filter((slot) => slot !== rotatingSlot);
    slots.splice(1, 0, rotatingSlot);
  }
  return pairings;
}

function getRegularSeasonWeekMatchups(
  participantNames: string[],
  weekIndex: number,
  totalGamesPerOpponent: number,
  gamesPerWeek: number
): string[] {
  if (participantNames.length < 2) return [];

  const rounds = getRoundRobinSlotPairings(participantNames.length);
  if (rounds.length < 1) return [];

  const roundsPerCycle = rounds.length;
  const normalizedWeekIndex = Math.max(1, weekIndex);
  const cycleIndex = Math.floor((normalizedWeekIndex - 1) / roundsPerCycle);
  const roundIndex = (normalizedWeekIndex - 1) % roundsPerCycle;
  const normalizedTotalGames = Math.max(1, totalGamesPerOpponent);
  const normalizedGamesPerWeek = Math.max(1, gamesPerWeek);
  const gamesBeforeWeek = cycleIndex * normalizedGamesPerWeek;
  const remainingGames = Math.max(0, normalizedTotalGames - gamesBeforeWeek);
  const gamesThisWeek = Math.min(normalizedGamesPerWeek, remainingGames);
  if (gamesThisWeek < 1) return [];

  const lines: string[] = [];
  for (const [leftIndex, rightIndex] of rounds[roundIndex] ?? []) {
    if (leftIndex >= participantNames.length || rightIndex >= participantNames.length) continue;
    for (let gameOffset = 0; gameOffset < gamesThisWeek; gameOffset += 1) {
      const gameNumber = gamesBeforeWeek + gameOffset + 1;
      const isEvenGame = gameNumber % 2 === 0;
      const left = participantNames[isEvenGame ? rightIndex : leftIndex];
      const right = participantNames[isEvenGame ? leftIndex : rightIndex];
      lines.push(`Game ${gameNumber}: ${left} vs ${right}`);
    }
  }
  return lines;
}

function getRegularSeasonGamesThisWeek(
  participantCount: number,
  weekIndex: number,
  totalGamesPerOpponent: number,
  gamesPerWeek: number
) {
  if (participantCount < 2) return 0;
  const roundsPerCycle = participantCount % 2 === 0 ? participantCount - 1 : participantCount;
  const normalizedWeekIndex = Math.max(1, weekIndex);
  const normalizedTotalGames = Math.max(1, totalGamesPerOpponent);
  const normalizedGamesPerWeek = Math.max(1, gamesPerWeek);
  const cycleIndex = Math.floor((normalizedWeekIndex - 1) / roundsPerCycle);
  const gamesBeforeWeek = cycleIndex * normalizedGamesPerWeek;
  const remainingGames = Math.max(0, normalizedTotalGames - gamesBeforeWeek);
  return Math.min(normalizedGamesPerWeek, remainingGames);
}

export default function ProjectedSchedulePage({ standalone = false }: { standalone?: boolean }) {
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

  const swrScheduleResponse = getLeagueProjectedSchedule(activeTournamentId);
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const swrSeasonsResponse = getLeagueSeasons(activeTournamentId);
  const seasons = swrSeasonsResponse.data?.data ?? [];
  const isAdmin = swrAdminUsersResponse.data != null;
  const rows = useMemo(() => swrScheduleResponse.data?.data ?? [], [swrScheduleResponse.data]);
  const [filterSeasonId, setFilterSeasonId] = useState<string>('ALL');
  const [seasonFilterTouched, setSeasonFilterTouched] = useState(false);
  const [filterTournamentId, setFilterTournamentId] = useState<string>('ALL');
  const [filterUserId, setFilterUserId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [roundLabel, setRoundLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'CLOSED'>('PLANNED');
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [seriesWeeks, setSeriesWeeks] = useState<number>(1);

  const [wizardSeasonId, setWizardSeasonId] = useState<string | null>(null);
  const [wizardStartsAt, setWizardStartsAt] = useState('');
  const [wizardRoundRobinWeeks, setWizardRoundRobinWeeks] = useState<number>(4);
  const [wizardFinalStages, setWizardFinalStages] = useState('Swiss Finals, Top Cut');
  const [wizardMode, setWizardMode] = useState<
    'ROUND_ROBIN_AND_FINALS' | 'REGULAR_SEASON_MATCHUP'
  >('ROUND_ROBIN_AND_FINALS');
  const [wizardGamesPerOpponent, setWizardGamesPerOpponent] = useState<number>(4);
  const [wizardGamesPerWeek, setWizardGamesPerWeek] = useState<number>(2);
  const [wizardParticipantUserIds, setWizardParticipantUserIds] = useState<string[]>([]);
  const editCardRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const adminUsers = swrAdminUsersResponse.data?.data ?? [];
  const wizardParticipantOptions = useMemo(() => {
    const seen = new Set<number>();
    const options: Array<{ value: string; label: string }> = [];
    for (const user of adminUsers) {
      const userId = Number(user?.user_id);
      const userName = String(user?.user_name ?? '').trim();
      if (!Number.isInteger(userId) || userId <= 0 || userName === '' || seen.has(userId)) continue;
      seen.add(userId);
      options.push({ value: String(userId), label: userName });
    }
    options.sort((left, right) => left.label.localeCompare(right.label));
    return options;
  }, [adminUsers]);

  const userNameById = useMemo(() => {
    const lookup = new Map<number, string>();
    for (const user of adminUsers) {
      const userId = Number(user?.user_id);
      const userName = String(user?.user_name ?? '').trim();
      if (!Number.isInteger(userId) || userId <= 0 || userName === '') continue;
      lookup.set(userId, userName);
    }
    return lookup;
  }, [adminUsers]);

  useEffect(() => {
    setWizardParticipantUserIds([]);
  }, [activeTournamentId]);

  useEffect(() => {
    const validSeasonIds = new Set(seasons.map((season: any) => String(season.season_id)));
    const activeSeason = seasons.find((season: any) => Boolean(season?.is_active));
    const preferredSeasonId =
      activeSeason != null
        ? String(activeSeason.season_id)
        : seasons.length > 0
          ? String(seasons[0].season_id)
          : null;

    if (preferredSeasonId == null) {
      if (wizardSeasonId != null) setWizardSeasonId(null);
      if (editingId == null && seasonId != null) setSeasonId(null);
      return;
    }

    if (wizardSeasonId == null || !validSeasonIds.has(wizardSeasonId)) {
      setWizardSeasonId(preferredSeasonId);
    }

    if (editingId == null && (seasonId == null || !validSeasonIds.has(seasonId))) {
      setSeasonId(preferredSeasonId);
    }
  }, [seasons, wizardSeasonId, seasonId, editingId]);

  const wizardSelectedParticipantIds = useMemo(() => {
    const allowedValues = new Set(wizardParticipantOptions.map((option) => option.value));
    const explicitParticipantIds: number[] = [];
    for (const value of wizardParticipantUserIds) {
      if (!allowedValues.has(value)) continue;
      const userId = Number(value);
      if (!Number.isInteger(userId) || userId <= 0) continue;
      explicitParticipantIds.push(userId);
    }
    if (explicitParticipantIds.length > 0) {
      return explicitParticipantIds;
    }
    return wizardParticipantOptions
      .map((option) => Number(option.value))
      .filter((userId) => Number.isInteger(userId) && userId > 0);
  }, [wizardParticipantOptions, wizardParticipantUserIds]);

  const wizardParticipantCount = useMemo(() => {
    const scopedUsers =
      wizardSelectedParticipantIds.length > 0
        ? wizardSelectedParticipantIds
            .map((userId) => String(userNameById.get(userId) ?? '').trim())
            .filter((name) => name !== '')
        : [];
    const names = new Set<string>();
    for (const user of scopedUsers) {
      const name = String(user).trim().toLowerCase();
      if (name !== '') names.add(name);
    }
    return names.size;
  }, [userNameById, wizardSelectedParticipantIds]);
  const wizardRegularSeasonWeeks = useMemo(() => {
    if (wizardParticipantCount < 2) return 0;
    const roundsPerCycle = wizardParticipantCount % 2 === 0 ? wizardParticipantCount - 1 : wizardParticipantCount;
    const gamesPerOpponent = Math.max(1, Number(wizardGamesPerOpponent ?? 1));
    const gamesPerWeek = Math.max(1, Number(wizardGamesPerWeek ?? 1));
    const matchupWeeksPerOpponent = Math.ceil(gamesPerOpponent / gamesPerWeek);
    return roundsPerCycle * matchupWeeksPerOpponent;
  }, [wizardParticipantCount, wizardGamesPerOpponent, wizardGamesPerWeek]);

  useEffect(() => {
    setFilterSeasonId('ALL');
    setSeasonFilterTouched(false);
    setFilterTournamentId('ALL');
    setFilterUserId('ALL');
    setFilterStatus('ALL');
  }, [activeTournamentId]);

  useEffect(() => {
    const validSeasonIds = new Set(seasons.map((season: any) => String(season.season_id)));
    if (seasonFilterTouched) {
      if (filterSeasonId !== 'ALL' && !validSeasonIds.has(filterSeasonId)) {
        setFilterSeasonId('ALL');
      }
      return;
    }

    const activeSeason = seasons.find((season: any) => Boolean(season.is_active));
    if (activeSeason != null) {
      setFilterSeasonId(String(activeSeason.season_id));
      return;
    }
    setFilterSeasonId('ALL');
  }, [seasons, filterSeasonId, seasonFilterTouched]);

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

  const normalizeScheduleStatus = (value: any): 'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'CLOSED' => {
    const rawStatus = String(value ?? '').trim().toUpperCase();
    if (rawStatus === 'OPEN') return 'OPEN';
    if (rawStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (rawStatus === 'CLOSED' || rawStatus === 'COMPLETED') return 'CLOSED';
    return 'PLANNED';
  };

  const getRowStatus = (row: any): 'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'CLOSED' =>
    normalizeScheduleStatus(row?.linked_tournament_status ?? row?.status);

  const startEdit = (row: any) => {
    setEditingId(Number(row.id));
    setRoundLabel(String(row.round_label ?? ''));
    setStartsAt(toLocalInputValue(row.starts_at));
    setTitle(String(row.title ?? ''));
    setDetails(String(row.details ?? ''));
    setStatus(getRowStatus(row));
    setSeasonId(row.season_id != null ? String(row.season_id) : null);
    setSortOrder(Number(row.sort_order ?? 0));
    setSeriesWeeks(1);
    window.requestAnimationFrame(() => {
      editCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titleInputRef.current?.focus();
    });
  };

  const linkedTournamentOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: 'ALL', label: 'All Events' }];
    const seen = new Set<number>();
    for (const row of rows) {
      const linkedId = Number(row?.linked_tournament_id);
      if (!Number.isInteger(linkedId) || linkedId <= 0 || seen.has(linkedId)) continue;
      seen.add(linkedId);
      const linkedName = String(row?.linked_tournament_name ?? '').trim();
      options.push({
        value: String(linkedId),
        label: linkedName === '' ? `Event ${linkedId}` : linkedName,
      });
    }
    return options;
  }, [rows]);

  const filterUserOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: 'ALL', label: 'All Players' }];
    const seen = new Set<number>();
    for (const user of adminUsers) {
      const userId = Number(user?.user_id);
      const userName = String(user?.user_name ?? '').trim();
      if (!Number.isInteger(userId) || userId <= 0 || userName === '' || seen.has(userId)) continue;
      seen.add(userId);
      options.push({ value: String(userId), label: userName });
    }
    options.sort((left, right) => {
      if (left.value === 'ALL') return -1;
      if (right.value === 'ALL') return 1;
      return left.label.localeCompare(right.label);
    });
    return options;
  }, [adminUsers]);

  const filteredRows = useMemo(() => {
    const selectedUserId = Number(filterUserId);
    return rows.filter((row: any) => {
      if (filterSeasonId !== 'ALL') {
        if (String(row?.season_id ?? '') !== filterSeasonId) return false;
      }

      if (filterTournamentId !== 'ALL') {
        if (String(row?.linked_tournament_id ?? '') !== filterTournamentId) return false;
      }

      if (filterUserId !== 'ALL' && Number.isInteger(selectedUserId) && selectedUserId > 0) {
        const isRegularSeasonMatchup =
          String(row?.event_template ?? 'STANDARD').toUpperCase() === 'REGULAR_SEASON_MATCHUP';
        const participantIds = Array.isArray(row?.participant_user_ids) ? row.participant_user_ids : [];
        if (participantIds.length > 0) {
          return participantIds.some((rawUserId: any) => Number(rawUserId) === selectedUserId);
        }
        if (isRegularSeasonMatchup) return false;
      }

      if (filterStatus !== 'ALL') {
        if (getRowStatus(row) !== filterStatus) return false;
      }
      return true;
    });
  }, [rows, filterSeasonId, filterTournamentId, filterUserId, filterStatus]);

  const regularSeasonRows = useMemo(
    () =>
      filteredRows.filter(
        (row: any) => String(row?.event_template ?? 'STANDARD').toUpperCase() === 'REGULAR_SEASON_MATCHUP'
      ),
    [filteredRows]
  );
  const eventRows = useMemo(
    () =>
      filteredRows.filter(
        (row: any) => String(row?.event_template ?? 'STANDARD').toUpperCase() !== 'REGULAR_SEASON_MATCHUP'
      ),
    [filteredRows]
  );

  const getParticipantNamesForRow = (row: any): string[] => {
    const selectedParticipantIds = Array.isArray(row?.participant_user_ids)
      ? row.participant_user_ids
      : [];
    if (selectedParticipantIds.length < 1) {
      return [];
    }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const rawUserId of selectedParticipantIds) {
      const userId = Number(rawUserId);
      if (!Number.isInteger(userId) || userId <= 0) continue;
      const rawName = String(userNameById.get(userId) ?? '').trim();
      const normalized = rawName.toLowerCase();
      if (normalized === '' || seen.has(normalized)) continue;
      seen.add(normalized);
      names.push(rawName);
    }
    names.sort((left, right) => left.localeCompare(right));
    return names;
  };

  const renderRowActions = (row: any) => {
    if (!isAdmin) return null;
    if (Number(row?.id) <= 0) return <Table.Td />;
    return (
      <Table.Td>
        <Group justify="flex-end" gap={8}>
          {row.linked_tournament_id == null && (
            <Button
              size="xs"
              variant="light"
              onClick={async () => {
                const confirmed = window.confirm(`Create an event from \"${row.title}\"?`);
                if (!confirmed) return;
                await createProjectedScheduleEvent(activeTournamentId, Number(row.id));
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
            {editingId === Number(row.id) ? 'Editing' : 'Edit'}
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
    );
  };

  const content = (
    <Stack>
      <Title>Projected League Schedule</Title>
      <Text c="dimmed">
        Configurable roadmap for planned rounds and events. Admins can update this at any time.
      </Text>

      {swrScheduleResponse.error && <RequestErrorAlert error={swrScheduleResponse.error} />}

      <Card withBorder>
        <Stack gap="xs">
          <Title order={4}>Schedule Filters</Title>
          <Group grow align="end">
            <Select
              label="Season"
              value={filterSeasonId}
              allowDeselect={false}
              data={[
                { value: 'ALL', label: 'All Seasons' },
                ...seasons.map((season: any) => ({
                  value: String(season.season_id),
                  label: `${season.name}${season.is_active ? ' (Current)' : ''}`,
                })),
              ]}
              onChange={(value) => {
                setSeasonFilterTouched(true);
                setFilterSeasonId(value ?? 'ALL');
              }}
            />
            <Select
              label="Tournament/Event"
              value={filterTournamentId}
              allowDeselect={false}
              data={linkedTournamentOptions}
              onChange={(value) => setFilterTournamentId(value ?? 'ALL')}
            />
            <Select
              label="Player"
              value={filterUserId}
              allowDeselect={false}
              searchable
              data={filterUserOptions}
              onChange={(value) => setFilterUserId(value ?? 'ALL')}
            />
            <Select
              label="Event Status"
              value={filterStatus}
              allowDeselect={false}
              data={[
                { value: 'ALL', label: 'All Statuses' },
                { value: 'PLANNED', label: 'Planned' },
                { value: 'OPEN', label: 'Open' },
                { value: 'IN_PROGRESS', label: 'In Progress' },
                { value: 'CLOSED', label: 'Closed' },
              ]}
              onChange={(value) => setFilterStatus(value ?? 'ALL')}
            />
          </Group>
          <Text size="sm" c="dimmed">
            Showing {filteredRows.length} of {rows.length} schedule items.
          </Text>
        </Stack>
      </Card>

      {isAdmin && (
        <Card withBorder ref={editCardRef}>
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
              ref={titleInputRef}
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
                  { value: 'CLOSED', label: 'Closed' },
                ]}
                onChange={(value) => {
                  if (value === 'OPEN' || value === 'IN_PROGRESS' || value === 'CLOSED') {
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
              Generate weekly schedule templates for normal round-robin blocks or regular season matchups.
            </Text>
            <Group grow align="end">
              <Select
                label="Mode"
                value={wizardMode}
                allowDeselect={false}
                data={[
                  { value: 'ROUND_ROBIN_AND_FINALS', label: 'Round Robin + Finals' },
                  { value: 'REGULAR_SEASON_MATCHUP', label: 'Season Matchup' },
                ]}
                onChange={(value) => {
                  if (value === 'REGULAR_SEASON_MATCHUP') {
                    setWizardMode('REGULAR_SEASON_MATCHUP');
                    return;
                  }
                  setWizardMode('ROUND_ROBIN_AND_FINALS');
                }}
              />
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
              {wizardMode === 'REGULAR_SEASON_MATCHUP' ? (
                <>
                  <NumberInput
                    label="Total Games vs Each Opponent"
                    value={wizardGamesPerOpponent}
                    onChange={(value) => setWizardGamesPerOpponent(Math.max(1, Number(value ?? 1)))}
                    min={1}
                    max={20}
                  />
                  <NumberInput
                    label="Games Per Matchup Week"
                    value={wizardGamesPerWeek}
                    onChange={(value) => setWizardGamesPerWeek(Math.max(1, Number(value ?? 1)))}
                    min={1}
                    max={20}
                  />
                </>
              ) : (
                <NumberInput
                  label="Round Robin Weeks"
                  value={wizardRoundRobinWeeks}
                  onChange={(value) => setWizardRoundRobinWeeks(Math.max(1, Number(value ?? 1)))}
                  min={1}
                  max={20}
                />
              )}
            </Group>
            {wizardMode === 'REGULAR_SEASON_MATCHUP' && (
              <MultiSelect
                label="Participants"
                description="Leave empty to include all current users."
                placeholder="Optional: choose specific players"
                data={wizardParticipantOptions}
                searchable
                clearable
                value={wizardParticipantUserIds}
                onChange={setWizardParticipantUserIds}
              />
            )}
            {wizardMode === 'REGULAR_SEASON_MATCHUP' ? (
              <Text size="sm" c="dimmed">
                Participants selected: {wizardParticipantCount} | Weekly events to generate:{' '}
                {wizardRegularSeasonWeeks}
                {' | '}
                Matchup weeks per opponent:{' '}
                {Math.ceil(
                  Math.max(1, Number(wizardGamesPerOpponent ?? 1)) /
                    Math.max(1, Number(wizardGamesPerWeek ?? 1))
                )}
              </Text>
            ) : (
              <TextInput
                label="Finals Stages (comma separated)"
                value={wizardFinalStages}
                onChange={(event) => setWizardFinalStages(event.currentTarget.value)}
                placeholder="Swiss Finals, Top Cut, Championship"
              />
            )}
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
                  const participantUserIds =
                    wizardSelectedParticipantIds.length > 0 ? wizardSelectedParticipantIds : null;

                  if (wizardMode === 'REGULAR_SEASON_MATCHUP') {
                    if (wizardRegularSeasonWeeks < 1) {
                      showNotification({
                        color: 'red',
                        title: 'Not enough participants',
                        message: 'Season Matchup requires at least 2 participants.',
                      });
                      return;
                    }
                    if (participantUserIds == null || participantUserIds.length < 2) {
                      showNotification({
                        color: 'red',
                        title: 'Participants required',
                        message: 'Select at least 2 users for regular season matchups.',
                      });
                      return;
                    }

                    for (let week = 0; week < wizardRegularSeasonWeeks; week += 1) {
                      await createProjectedScheduleItem(activeTournamentId, {
                        round_label: `Regular Season Week ${week + 1}`,
                        starts_at: new Date(
                          startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000
                        ).toISOString(),
                        title: `${seasonLabel} Regular Season Matchups - Week ${week + 1}`,
                        details: null,
                        status: 'PLANNED',
                        event_template: 'REGULAR_SEASON_MATCHUP',
                        regular_season_week_index: week + 1,
                        regular_season_games_per_opponent: Math.max(
                          1,
                          Number(wizardGamesPerOpponent ?? 1)
                        ),
                        regular_season_games_per_week: Math.max(1, Number(wizardGamesPerWeek ?? 1)),
                        participant_user_ids: participantUserIds,
                        season_id: seasonNumber,
                        sort_order: week,
                      });
                    }
                  } else {
                    for (let week = 0; week < Math.max(1, Number(wizardRoundRobinWeeks ?? 1)); week += 1) {
                      await createProjectedScheduleItem(activeTournamentId, {
                        round_label: `Week ${week + 1}`,
                        starts_at: new Date(
                          startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000
                        ).toISOString(),
                        title: `${seasonLabel} Round Robin - Week ${week + 1}`,
                        details: null,
                        status: 'PLANNED',
                        event_template: 'STANDARD',
                        regular_season_week_index: null,
                        regular_season_games_per_opponent: null,
                        regular_season_games_per_week: null,
                        participant_user_ids: null,
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
                        event_template: 'STANDARD',
                        regular_season_week_index: null,
                        regular_season_games_per_opponent: null,
                        regular_season_games_per_week: null,
                        participant_user_ids: null,
                        season_id: seasonNumber,
                        sort_order: Math.max(1, Number(wizardRoundRobinWeeks ?? 1)) + index,
                      });
                    }
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
        <Stack gap="xs">
          <Title order={4}>Tournament / Round Robin / Swiss Events</Title>
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
              {eventRows.length < 1 && (
                <Table.Tr>
                  <Table.Td colSpan={isAdmin ? 9 : 8}>
                    <Text c="dimmed" size="sm">
                      {rows.length < 1
                        ? 'No tournament/round-robin/swiss schedule items yet.'
                        : 'No tournament/round-robin/swiss items match the current filters.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {eventRows.map((row: any) => (
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
                  <Table.Td>{getRowStatus(row)}</Table.Td>
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
                  {renderRowActions(row)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="xs">
          <Title order={4}>Regular Season Matchups</Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Week</Table.Th>
                <Table.Th>Season</Table.Th>
                <Table.Th>Title</Table.Th>
                <Table.Th>Projected Start</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Matchups</Table.Th>
                <Table.Th>Event</Table.Th>
                <Table.Th>Sort</Table.Th>
                {isAdmin && <Table.Th></Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {regularSeasonRows.length < 1 && (
                <Table.Tr>
                  <Table.Td colSpan={isAdmin ? 9 : 8}>
                    <Text c="dimmed" size="sm">
                      {rows.length < 1
                        ? 'No regular season matchup items yet.'
                        : 'No regular season matchup items match the current filters.'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {regularSeasonRows.map((row: any) => {
                const weekIndex = Math.max(
                  1,
                  Number(row.regular_season_week_index ?? (Number(row.sort_order ?? 0) + 1))
                );
                const totalGamesPerOpponent = Math.max(
                  1,
                  Number(row.regular_season_games_per_opponent ?? 1)
                );
                const gamesPerWeek = Math.max(1, Number(row.regular_season_games_per_week ?? 1));
                const participantNames = getParticipantNamesForRow(row);
                const gamesThisWeek = getRegularSeasonGamesThisWeek(
                  participantNames.length,
                  weekIndex,
                  totalGamesPerOpponent,
                  gamesPerWeek
                );
                const matchups = getRegularSeasonWeekMatchups(
                  participantNames,
                  weekIndex,
                  totalGamesPerOpponent,
                  gamesPerWeek
                );

                return (
                  <Table.Tr key={row.id}>
                    <Table.Td>{row.round_label ?? `Week ${weekIndex}`}</Table.Td>
                    <Table.Td>
                      {row.season_id != null
                        ? seasons.find((season: any) => Number(season.season_id) === Number(row.season_id))
                            ?.name ?? `Season ${row.season_id}`
                        : '-'}
                    </Table.Td>
                  <Table.Td>{row.title}</Table.Td>
                  <Table.Td>{formatDate(row.starts_at)}</Table.Td>
                  <Table.Td>{getRowStatus(row)}</Table.Td>
                  <Table.Td>
                      <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                        {`Participants: ${participantNames.length} | Total vs opponent: ${totalGamesPerOpponent} | Games this week: ${gamesThisWeek}`}
                      </Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {matchups.length > 0
                          ? matchups.join('\n')
                          : participantNames.length < 1
                            ? 'No participant list assigned for this schedule row'
                            : participantNames.length < 2
                            ? 'Not enough participants to generate matchup preview'
                            : 'No matchup preview available for this week'}
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
                    {renderRowActions(row)}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }

  return <TournamentLayout tournament_id={tournamentData.id}>{content}</TournamentLayout>;
}
