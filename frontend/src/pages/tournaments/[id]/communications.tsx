import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  Stack,
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
  getLeagueCommunications,
  getTournaments,
} from '@services/adapter';
import {
  createLeagueCommunication,
  deleteLeagueCommunication,
  updateLeagueCommunication,
} from '@services/league';

function formatDate(value: string | null | undefined) {
  if (value == null || value === '') return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function CommunicationsPage({ standalone = false }: { standalone?: boolean }) {
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

  const swrCommunicationsResponse = getLeagueCommunications(activeTournamentId);
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const isAdmin = swrAdminUsersResponse.data != null;

  const rows = useMemo(
    () => swrCommunicationsResponse.data?.data ?? [],
    [swrCommunicationsResponse.data]
  );
  const announcements = rows.filter((row: any) => row.kind === 'ANNOUNCEMENT');
  const rules = rows.filter((row: any) => row.kind === 'RULE');
  const notes = rows.filter((row: any) => row.kind === 'NOTE');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [kind, setKind] = useState<'NOTE' | 'ANNOUNCEMENT' | 'RULE'>('ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setKind('ANNOUNCEMENT');
    setTitle('');
    setBody('');
    setPinned(false);
  };

  const startEdit = (row: any) => {
    setEditingId(Number(row.id));
    if (row.kind === 'NOTE' || row.kind === 'RULE' || row.kind === 'ANNOUNCEMENT') {
      setKind(row.kind);
    } else {
      setKind('ANNOUNCEMENT');
    }
    setTitle(String(row.title ?? ''));
    setBody(String(row.body ?? ''));
    setPinned(Boolean(row.pinned));
  };

  const content = (
    <Stack>
      <Title>League Notes, Rules & Announcements</Title>
      <Text c="dimmed">
        League-wide rules, notes, and commissioner announcements for players and admins.
      </Text>

      {swrCommunicationsResponse.error && (
        <RequestErrorAlert error={swrCommunicationsResponse.error} />
      )}

      {isAdmin && (
        <Card withBorder>
          <Stack>
            <Title order={4}>{editingId == null ? 'New Message' : 'Edit Message'}</Title>
            <Select
              label="Type"
              value={kind}
              allowDeselect={false}
              data={[
                { value: 'ANNOUNCEMENT', label: 'Announcement' },
                { value: 'RULE', label: 'League Rule' },
                { value: 'NOTE', label: 'League Note' },
              ]}
              onChange={(value) =>
                setKind(
                  value === 'NOTE' || value === 'RULE' || value === 'ANNOUNCEMENT'
                    ? value
                    : 'ANNOUNCEMENT'
                )
              }
            />
            <TextInput
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Weekly league update"
            />
            <Textarea
              label="Message"
              value={body}
              minRows={4}
              onChange={(event) => setBody(event.currentTarget.value)}
              placeholder="Add your announcement or note details"
            />
            <Checkbox
              label="Pin message"
              checked={pinned}
              onChange={(event) => setPinned(event.currentTarget.checked)}
            />
            <Group>
              <Button
                onClick={async () => {
                  if (activeTournamentId <= 0 || title.trim() === '' || body.trim() === '') return;
                  if (editingId == null) {
                    await createLeagueCommunication(activeTournamentId, {
                      kind,
                      title: title.trim(),
                      body: body.trim(),
                      pinned,
                    });
                    showNotification({
                      color: 'green',
                      title: 'Message created',
                      message: '',
                    });
                  } else {
                    await updateLeagueCommunication(activeTournamentId, editingId, {
                      kind,
                      title: title.trim(),
                      body: body.trim(),
                      pinned,
                    });
                    showNotification({
                      color: 'green',
                      title: 'Message updated',
                      message: '',
                    });
                  }
                  resetForm();
                  await swrCommunicationsResponse.mutate();
                }}
              >
                {editingId == null ? 'Save Message' : 'Update Message'}
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
        <Title order={4} mb="sm">
          Announcements
        </Title>
        <Stack>
          {announcements.length < 1 && (
            <Text c="dimmed" size="sm">
              No announcements yet.
            </Text>
          )}
          {announcements.map((row: any) => (
            <Card key={`announcement-${row.id}`} withBorder>
              <Group justify="space-between" mb={6}>
                <Group>
                  <Text fw={700}>{row.title}</Text>
                  {row.pinned ? <Badge color="yellow">Pinned</Badge> : null}
                </Group>
                {isAdmin && (
                  <Group gap={8}>
                    <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={async () => {
                        await deleteLeagueCommunication(activeTournamentId, Number(row.id));
                        await swrCommunicationsResponse.mutate();
                      }}
                    >
                      Delete
                    </Button>
                  </Group>
                )}
              </Group>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{row.body}</Text>
              <Text mt="xs" size="xs" c="dimmed">
                {row.created_by_user_name ?? 'League admin'} | Updated {formatDate(row.updated)}
              </Text>
            </Card>
          ))}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">
          League Rules
        </Title>
        <Stack>
          {rules.length < 1 && (
            <Text c="dimmed" size="sm">
              No rules posted yet.
            </Text>
          )}
          {rules.map((row: any) => (
            <Card key={`rule-${row.id}`} withBorder>
              <Group justify="space-between" mb={6}>
                <Group>
                  <Text fw={700}>{row.title}</Text>
                  {row.pinned ? <Badge color="yellow">Pinned</Badge> : null}
                </Group>
                {isAdmin && (
                  <Group gap={8}>
                    <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={async () => {
                        await deleteLeagueCommunication(activeTournamentId, Number(row.id));
                        await swrCommunicationsResponse.mutate();
                      }}
                    >
                      Delete
                    </Button>
                  </Group>
                )}
              </Group>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{row.body}</Text>
              <Text mt="xs" size="xs" c="dimmed">
                {row.created_by_user_name ?? 'League admin'} | Updated {formatDate(row.updated)}
              </Text>
            </Card>
          ))}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">
          League Notes
        </Title>
        <Stack>
          {notes.length < 1 && (
            <Text c="dimmed" size="sm">
              No notes yet.
            </Text>
          )}
          {notes.map((row: any) => (
            <Card key={`note-${row.id}`} withBorder>
              <Group justify="space-between" mb={6}>
                <Group>
                  <Text fw={700}>{row.title}</Text>
                  {row.pinned ? <Badge color="yellow">Pinned</Badge> : null}
                </Group>
                {isAdmin && (
                  <Group gap={8}>
                    <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={async () => {
                        await deleteLeagueCommunication(activeTournamentId, Number(row.id));
                        await swrCommunicationsResponse.mutate();
                      }}
                    >
                      Delete
                    </Button>
                  </Group>
                )}
              </Group>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{row.body}</Text>
              <Text mt="xs" size="xs" c="dimmed">
                {row.created_by_user_name ?? 'League admin'} | Updated {formatDate(row.updated)}
              </Text>
            </Card>
          ))}
        </Stack>
      </Card>
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }

  return <TournamentLayout tournament_id={tournamentData.id}>{content}</TournamentLayout>;
}
