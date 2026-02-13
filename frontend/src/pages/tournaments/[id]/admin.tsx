import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  Select,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { showNotification } from '@mantine/notifications';

import { getTournamentIdFromRouter } from '@components/utils/util';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueAdminUsers, getLeagueDecks } from '@services/adapter';
import { updateUserAccountType } from '@services/user';
import {
  awardAccolade,
  deleteDeck,
  exportStandingsTemplate,
  exportTournamentFormatTemplate,
  importStandingsTemplate,
  importTournamentFormatTemplate,
  updateSeasonPrivileges,
} from '@services/league';

export default function LeagueAdminPage() {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrUsersResponse = getLeagueAdminUsers(tournamentData.id);
  const swrDecksResponse = getLeagueDecks(tournamentData.id);
  const users = swrUsersResponse.data?.data ?? [];
  const decks = swrDecksResponse.data?.data ?? [];

  const [accolades, setAccolades] = useState<Record<string, string>>({});
  const [standingsTemplateJson, setStandingsTemplateJson] = useState('');
  const [tournamentTemplateJson, setTournamentTemplateJson] = useState('');

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
                      value={user.account_type}
                      data={[
                        { value: 'REGULAR', label: 'REGULAR' },
                        { value: 'DEMO', label: 'DEMO' },
                      ]}
                      allowDeselect={false}
                      onChange={async (value) => {
                        if (value == null) return;
                        await updateUserAccountType(user.user_id, value as 'REGULAR' | 'DEMO');
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
                        });
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
                          });
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
                          });
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
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
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
