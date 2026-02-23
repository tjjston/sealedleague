import { Badge, Button, Card, Group, Table, Text, Title } from '@mantine/core';
import { useMemo } from 'react';

import PreloadLink from '@components/utils/link';
import { getAvatarObjectFit, getAvatarObjectPosition } from '@components/utils/avatar';
import {
  buildCardLookupByKey,
  resolveCardFromLookup,
  resolveCardLabel,
} from '@components/utils/card_id';
import { getWeaponIconConfig } from '@constants/weapon_icons';
import RequestErrorAlert from '@components/utils/error_alert';
import Layout from '@pages/_layout';
import {
  checkForAuthError,
  getBaseApiUrl,
  getLeagueCardsGlobal,
  getUser,
  getUserDirectory,
} from '@services/adapter';
import { deleteUserAsAdmin } from '@services/user';

type PlayerUser = {
  user_id: number;
  user_name: string;
  avatar_url: string | null;
  weapon_icon: string | null;
  favorite_card_id: string | null;
  favorite_card_name: string | null;
  favorite_card_image_url: string | null;
  avatar_fit_mode: string | null;
  tournaments_won: number;
  tournaments_placed: number;
  total_saved_decks: number;
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
  const swrCurrentUserResponse = getUser();
  const swrUsersResponse = getUserDirectory();
  checkForAuthError(swrCurrentUserResponse);
  checkForAuthError(swrUsersResponse);
  const isAdmin = String(swrCurrentUserResponse.data?.data?.account_type ?? 'REGULAR') === 'ADMIN';
  const currentUserId = Number(swrCurrentUserResponse.data?.data?.id ?? 0);

  const users: PlayerUser[] = useMemo(() => swrUsersResponse.data?.data ?? [], [swrUsersResponse.data]);
  const swrCardCatalogResponse = getLeagueCardsGlobal({ limit: 5000, offset: 0 });
  const cardCatalogRows = swrCardCatalogResponse.data?.data?.cards ?? [];
  const cardLookupById = useMemo(() => buildCardLookupByKey(cardCatalogRows as any[]), [cardCatalogRows]);

  return (
    <Layout>
      <Group justify="space-between" mb="md">
        <Title>Players</Title>
      </Group>

      {swrUsersResponse.error && <RequestErrorAlert error={swrUsersResponse.error} />}
      {swrUsersResponse.isLoading ? (
        <Card withBorder mb="md">
          <Text c="dimmed">Loading players...</Text>
        </Card>
      ) : null}

      <Card withBorder>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Avatar</Table.Th>
              <Table.Th>Showcase Card</Table.Th>
              <Table.Th>Current Deck Leader</Table.Th>
              <Table.Th>Tournaments Won</Table.Th>
              <Table.Th>Tournaments Placed</Table.Th>
              <Table.Th>Saved Decks</Table.Th>
              <Table.Th>Cards (Active Season)</Table.Th>
              <Table.Th>Cards (Career Pool)</Table.Th>
              <Table.Th>Favorite SW Media</Table.Th>
              {isAdmin ? <Table.Th>Actions</Table.Th> : null}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map((user) => {
              const favoriteCard = resolveCardFromLookup(
                cardLookupById,
                user.favorite_card_id ?? user.favorite_card_name
              );
              const leaderCard = resolveCardFromLookup(
                cardLookupById,
                user.current_leader_card_id ?? user.current_leader_name
              );
              const favoriteCardLabel = resolveCardLabel({
                explicitName: user.favorite_card_name,
                cardId: user.favorite_card_id,
                lookup: cardLookupById,
                emptyLabel: 'No showcase card selected',
              });
              const leaderLabel = resolveCardLabel({
                explicitName: user.current_leader_name,
                cardId: user.current_leader_card_id,
                lookup: cardLookupById,
                emptyLabel: 'No deck leader selected',
              });
              const favoriteImageUrl =
                String(user.favorite_card_image_url ?? '').trim() !== ''
                  ? String(user.favorite_card_image_url)
                  : String(favoriteCard?.image_url ?? '').trim() !== ''
                    ? String(favoriteCard?.image_url)
                    : null;
              const leaderImageUrl =
                String(user.current_leader_image_url ?? '').trim() !== ''
                  ? String(user.current_leader_image_url)
                  : String(leaderCard?.image_url ?? '').trim() !== ''
                    ? String(leaderCard?.image_url)
                    : null;
              return (
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
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 9999,
                          objectFit: getAvatarObjectFit(
                            user.avatar_fit_mode,
                            user.avatar_url,
                            user.favorite_card_image_url
                          ),
                          objectPosition: getAvatarObjectPosition(user.avatar_url),
                        }}
                      />
                    ) : (
                      <Badge color="gray">No avatar</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group>
                      {favoriteImageUrl != null ? (
                        <img
                          src={favoriteImageUrl}
                          alt={favoriteCardLabel}
                          style={{
                            width: 44,
                            height: 72,
                            borderRadius: 6,
                            objectFit: 'contain',
                            background: '#f8f9fa',
                          }}
                        />
                      ) : null}
                      <Text>{favoriteCardLabel}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group>
                      {leaderImageUrl != null ? (
                        <img
                          src={leaderImageUrl}
                          alt={leaderLabel}
                          style={{
                            width: 72,
                            height: 40,
                            borderRadius: 6,
                            objectFit: 'contain',
                            background: '#f8f9fa',
                          }}
                        />
                      ) : null}
                      <Text>{leaderLabel}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{user.tournaments_won ?? 0}</Table.Td>
                  <Table.Td>{user.tournaments_placed ?? 0}</Table.Td>
                  <Table.Td>{user.total_saved_decks ?? 0}</Table.Td>
                  <Table.Td>{user.total_cards_active_season ?? 0}</Table.Td>
                  <Table.Td>{user.total_cards_career_pool ?? 0}</Table.Td>
                  <Table.Td>{user.favorite_media ?? '-'}</Table.Td>
                  {isAdmin ? (
                    <Table.Td>
                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        disabled={currentUserId === Number(user.user_id)}
                        onClick={async () => {
                          const proceed = window.confirm(
                            `Are you sure you want to delete ${user.user_name}? This cannot be undone.`
                          );
                          if (!proceed) return;
                          await deleteUserAsAdmin(Number(user.user_id));
                          await swrUsersResponse.mutate();
                        }}
                      >
                        Delete User
                      </Button>
                    </Table.Td>
                  ) : null}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>
    </Layout>
  );
}
