import {
  Badge,
  Button,
  Card,
  Group,
  Image,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import RequestErrorAlert from '@components/utils/error_alert';
import Layout from '@pages/_layout';
import { checkForAuthError, getUser, getUserCareer } from '@services/adapter';
import { updateUserAccountType } from '@services/user';

type CareerProfile = {
  user_id: number;
  user_name: string;
  user_email: string;
  account_type: string;
  overall_wins: number;
  overall_draws: number;
  overall_losses: number;
  overall_matches: number;
  overall_win_percentage: number;
  season_records: {
    season_id: number;
    season_name: string;
    wins: number;
    draws: number;
    losses: number;
    matches: number;
    win_percentage: number;
  }[];
  most_used_aspects: { aspect: string; count: number }[];
  favorite_card: {
    card_id: string;
    name: string | null;
    image_url: string | null;
    uses: number;
  } | null;
};

export default function LeaguePlayerProfilePage() {
  const params = useParams();
  const navigate = useNavigate();
  const userId = Number(params.user_id ?? 0);

  const swrCurrentUserResponse = getUser();
  const swrCareerResponse = getUserCareer(Number.isFinite(userId) && userId > 0 ? userId : null);
  checkForAuthError(swrCareerResponse);
  checkForAuthError(swrCurrentUserResponse);

  const profile: CareerProfile | null = useMemo(
    () => swrCareerResponse.data?.data ?? null,
    [swrCareerResponse.data]
  );

  const [accountType, setAccountType] = useState<'REGULAR' | 'ADMIN'>('REGULAR');

  useEffect(() => {
    if (profile != null) {
      setAccountType(profile.account_type === 'ADMIN' ? 'ADMIN' : 'REGULAR');
    }
  }, [profile]);

  const canEditAccess = swrCurrentUserResponse.data?.data?.account_type === 'ADMIN';

  return (
    <Layout>
      <Group justify="space-between" mb="md">
        <Group>
          <Button variant="light" onClick={() => navigate('/league/players')}>
            Back
          </Button>
          <Title order={2}>Player Profile</Title>
        </Group>
      </Group>

      {swrCareerResponse.error && <RequestErrorAlert error={swrCareerResponse.error} />}

      {profile != null && (
        <Stack>
          <Card withBorder>
            <Group justify="space-between" align="start">
              <div>
                <Title order={3}>{profile.user_name}</Title>
                <Text c="dimmed">{profile.user_email}</Text>
              </div>
              <Badge color={profile.account_type === 'ADMIN' ? 'grape' : 'blue'}>
                {profile.account_type === 'ADMIN' ? 'ADMIN' : 'USER'}
              </Badge>
            </Group>
            {canEditAccess ? (
              <Group mt="md" align="end">
                <Select
                  label="Account Type"
                  value={accountType}
                  onChange={(value) => setAccountType((value as 'REGULAR' | 'ADMIN') ?? 'REGULAR')}
                  data={[
                    { value: 'REGULAR', label: 'USER' },
                    { value: 'ADMIN', label: 'ADMIN' },
                  ]}
                  allowDeselect={false}
                  style={{ minWidth: 200 }}
                />
                <Button
                  onClick={async () => {
                    await updateUserAccountType(profile.user_id, accountType);
                    await swrCareerResponse.mutate();
                  }}
                >
                  Save Account Type
                </Button>
              </Group>
            ) : null}
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Overall Record
            </Title>
            <Text>
              {profile.overall_wins}-{profile.overall_draws}-{profile.overall_losses} (
              {profile.overall_matches} matches)
            </Text>
            <Text>Win percentage: {profile.overall_win_percentage.toFixed(2)}%</Text>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Season Records
            </Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Season</Table.Th>
                  <Table.Th>Record</Table.Th>
                  <Table.Th>Matches</Table.Th>
                  <Table.Th>Win %</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {profile.season_records.map((season) => (
                  <Table.Tr key={season.season_id}>
                    <Table.Td>{season.season_name}</Table.Td>
                    <Table.Td>
                      {season.wins}-{season.draws}-{season.losses}
                    </Table.Td>
                    <Table.Td>{season.matches}</Table.Td>
                    <Table.Td>{season.win_percentage.toFixed(2)}%</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Most Used Aspects
            </Title>
            <Group>
              {profile.most_used_aspects.length < 1 ? (
                <Text c="dimmed">No deck history available.</Text>
              ) : (
                profile.most_used_aspects.map((item) => (
                  <Badge key={item.aspect} variant="light">
                    {item.aspect} ({item.count})
                  </Badge>
                ))
              )}
            </Group>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Favorite Card
            </Title>
            {profile.favorite_card == null ? (
              <Text c="dimmed">No card usage data available.</Text>
            ) : (
              <Group align="start">
                {profile.favorite_card.image_url != null ? (
                  <Image
                    src={profile.favorite_card.image_url}
                    alt={profile.favorite_card.name ?? profile.favorite_card.card_id}
                    w={180}
                    radius="md"
                  />
                ) : null}
                <div>
                  <Text fw={600}>{profile.favorite_card.name ?? profile.favorite_card.card_id}</Text>
                  <Text c="dimmed">Card ID: {profile.favorite_card.card_id}</Text>
                  <Text>Uses in decklists: {profile.favorite_card.uses}</Text>
                </div>
              </Group>
            )}
          </Card>
        </Stack>
      )}
    </Layout>
  );
}
