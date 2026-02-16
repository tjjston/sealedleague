import { Badge, Card, Group, Table, Text, Title } from '@mantine/core';
import { useMemo } from 'react';

import PreloadLink from '@components/utils/link';
import { getWeaponIconConfig } from '@constants/weapon_icons';
import RequestErrorAlert from '@components/utils/error_alert';
import Layout from '@pages/_layout';
import { checkForAuthError, getBaseApiUrl, getUserDirectory } from '@services/adapter';

type PlayerUser = {
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  weapon_icon: string | null;
  tournaments_won: number;
  tournaments_placed: number;
  total_cards_active_season: number;
  total_cards_career_pool: number;
  favorite_media: string | null;
  current_leader_card_id: string | null;
  current_leader_name: string | null;
  current_leader_image_url: string | null;
};

function PlayerWeaponIcon({ weaponIcon }: { weaponIcon: string | null }) {
  const config = getWeaponIconConfig(weaponIcon);
  if (config == null) {
    return <Text c="dimmed">-</Text>;
  }
  return (
    <img
      src={config.iconPath}
      alt={config.label}
      title={config.label}
      width={18}
      height={18}
      style={{ objectFit: 'contain' }}
    />
  );
}

export default function LeaguePlayersPage() {
  const swrUsersResponse = getUserDirectory();
  checkForAuthError(swrUsersResponse);

  const users: PlayerUser[] = useMemo(() => swrUsersResponse.data?.data ?? [], [swrUsersResponse.data]);

  return (
    <Layout>
      <Group justify="space-between" mb="md">
        <Title>Players</Title>
      </Group>

      {swrUsersResponse.error && <RequestErrorAlert error={swrUsersResponse.error} />}

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Avatar</Table.Th>
              <Table.Th>Current Deck Leader</Table.Th>
              <Table.Th>Tournaments Won</Table.Th>
              <Table.Th>Tournaments Placed</Table.Th>
              <Table.Th>Cards (Active Season)</Table.Th>
              <Table.Th>Cards (Career Pool)</Table.Th>
              <Table.Th>Favorite SW Media</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user) => (
              <Table.Tr key={user.user_id}>
                <Table.Td>
                  <PreloadLink href={`/league/players/${user.user_id}`}>
                    <Group gap={6}>
                      <PlayerWeaponIcon weaponIcon={user.weapon_icon} />
                      <Text fw={600}>{user.user_name}</Text>
                    </Group>
                  </PreloadLink>
                </Table.Td>
                <Table.Td>
                  {user.avatar_url != null && user.avatar_url !== '' ? (
                    <img
                      src={
                        user.avatar_url.startsWith('http')
                          ? user.avatar_url
                          : `${getBaseApiUrl()}/${user.avatar_url}`
                      }
                      alt={`${user.user_name} avatar`}
                      style={{ width: 44, height: 44, borderRadius: 9999, objectFit: 'cover' }}
                    />
                  ) : (
                    <Badge color="gray">No avatar</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group>
                    {user.current_leader_image_url != null && user.current_leader_image_url !== '' ? (
                      <img
                        src={user.current_leader_image_url}
                        alt={user.current_leader_name ?? user.current_leader_card_id ?? 'Leader'}
                        style={{ width: 36, height: 52, borderRadius: 6, objectFit: 'cover' }}
                      />
                    ) : null}
                    <Text>
                      {user.current_leader_name ??
                        user.current_leader_card_id ??
                        'No deck leader selected'}
                    </Text>
                  </Group>
                </Table.Td>
                <Table.Td>{user.tournaments_won ?? 0}</Table.Td>
                <Table.Td>{user.tournaments_placed ?? 0}</Table.Td>
                <Table.Td>{user.total_cards_active_season ?? 0}</Table.Td>
                <Table.Td>{user.total_cards_career_pool ?? 0}</Table.Td>
                <Table.Td>{user.favorite_media ?? '-'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Layout>
  );
}
