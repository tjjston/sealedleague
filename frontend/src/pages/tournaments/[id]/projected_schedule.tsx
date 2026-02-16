import {
  Button,
  Card,
  Group,
  NumberInput,
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
import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueAdminUsers,
  getLeagueProjectedSchedule,
  getTournaments,
} from '@services/adapter';
import {
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
  const isAdmin = swrAdminUsersResponse.data != null;
  const rows = useMemo(() => swrScheduleResponse.data?.data ?? [], [swrScheduleResponse.data]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [roundLabel, setRoundLabel] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState('');
  const [sortOrder, setSortOrder] = useState<number>(0);

  const resetForm = () => {
    setEditingId(null);
    setRoundLabel('');
    setStartsAt('');
    setTitle('');
    setDetails('');
    setStatus('');
    setSortOrder(0);
  };

  const startEdit = (row: any) => {
    setEditingId(Number(row.id));
    setRoundLabel(String(row.round_label ?? ''));
    setStartsAt(toLocalInputValue(row.starts_at));
    setTitle(String(row.title ?? ''));
    setDetails(String(row.details ?? ''));
    setStatus(String(row.status ?? ''));
    setSortOrder(Number(row.sort_order ?? 0));
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
            <TextInput
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value)}
              placeholder="Planned / Open / In Progress / Completed"
            />
            <Group>
              <Button
                onClick={async () => {
                  if (activeTournamentId <= 0 || title.trim() === '') return;
                  const payload = {
                    round_label: roundLabel.trim() === '' ? null : roundLabel.trim(),
                    starts_at: startsAt.trim() === '' ? null : new Date(startsAt).toISOString(),
                    title: title.trim(),
                    details: details.trim() === '' ? null : details.trim(),
                    status: status.trim() === '' ? null : status.trim(),
                    sort_order: Number(sortOrder ?? 0),
                  };
                  if (editingId == null) {
                    await createProjectedScheduleItem(activeTournamentId, payload);
                    showNotification({
                      color: 'green',
                      title: 'Schedule item created',
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

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Round/Stage</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Projected Start</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Details</Table.Th>
              <Table.Th>Sort</Table.Th>
              {isAdmin && <Table.Th></Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length < 1 && (
              <Table.Tr>
                <Table.Td colSpan={isAdmin ? 7 : 6}>
                  <Text c="dimmed" size="sm">
                    No projected schedule items configured yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((row: any) => (
              <Table.Tr key={row.id}>
                <Table.Td>{row.round_label ?? '-'}</Table.Td>
                <Table.Td>{row.title}</Table.Td>
                <Table.Td>{formatDate(row.starts_at)}</Table.Td>
                <Table.Td>{row.status ?? '-'}</Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {row.details ?? '-'}
                  </Text>
                </Table.Td>
                <Table.Td>{row.sort_order ?? 0}</Table.Td>
                {isAdmin && (
                  <Table.Td>
                    <Group justify="flex-end" gap={8}>
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
