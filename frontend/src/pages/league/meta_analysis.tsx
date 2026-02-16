import {
  Badge,
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

import RequestErrorAlert from '@components/utils/error_alert';
import Layout from '@pages/_layout';
import { getLeagueMetaAnalysis, getLeagueSeasons, getTournaments } from '@services/adapter';

export default function LeagueMetaAnalysisPage() {
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const activeTournamentId = Number(selectedTournamentId ?? 0);

  useEffect(() => {
    if (tournaments.length < 1 || selectedTournamentId != null) return;
    const saved = window.localStorage.getItem('league_default_tournament_id');
    const selected = tournaments.find((t: any) => String(t.id) === saved) ?? tournaments[0];
    if (selected == null) return;
    setSelectedTournamentId(String(selected.id));
    window.localStorage.setItem('league_default_tournament_id', String(selected.id));
  }, [selectedTournamentId, tournaments]);

  const swrSeasonsResponse = getLeagueSeasons(
    Number.isFinite(activeTournamentId) && activeTournamentId > 0 ? activeTournamentId : null
  );
  const seasons = swrSeasonsResponse.data?.data ?? [];
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  useEffect(() => {
    if (seasons.length < 1 || selectedSeasonId != null) return;
    const activeSeason = seasons.find((season: any) => season.is_active) ?? seasons[0];
    if (activeSeason == null) return;
    setSelectedSeasonId(String(activeSeason.season_id));
  }, [selectedSeasonId, seasons]);

  const selectedSeasonNumber =
    selectedSeasonId != null && selectedSeasonId !== '' ? Number(selectedSeasonId) : null;

  const swrMetaResponse = getLeagueMetaAnalysis(
    Number.isFinite(activeTournamentId) && activeTournamentId > 0 ? activeTournamentId : null,
    selectedSeasonNumber
  );
  const meta = swrMetaResponse.data?.data;

  const topCards = useMemo(() => meta?.top_cards ?? [], [meta]);
  const topLeaders = useMemo(() => meta?.top_leaders ?? [], [meta]);
  const topBases = useMemo(() => meta?.top_bases ?? [], [meta]);
  const topArchetypes = useMemo(() => meta?.top_archetypes ?? [], [meta]);
  const topTraits = useMemo(() => meta?.top_traits ?? [], [meta]);
  const topKeywords = useMemo(() => meta?.top_keywords ?? [], [meta]);

  return (
    <Layout>
      <Stack>
        <Title>Meta Analysis</Title>
        <Text c="dimmed">
          Track card usage, deck cores, archetypes, and synergy trends by season.
        </Text>

        <Card withBorder>
          <Group grow align="end">
            <Select
              label="Season"
              value={selectedSeasonId}
              onChange={setSelectedSeasonId}
              allowDeselect={false}
              data={seasons.map((season: any) => ({
                value: String(season.season_id),
                label: `${season.name}${season.is_active ? ' (Active)' : ''}`,
              }))}
            />
          </Group>
          <Text size="xs" c="dimmed" mt={8}>
            Tournament: {tournaments.find((t: any) => String(t.id) === selectedTournamentId)?.name ?? '-'}
          </Text>
        </Card>

        {swrMetaResponse.error && <RequestErrorAlert error={swrMetaResponse.error} />}

        {meta != null && (
          <Card withBorder>
            <Group justify="space-between">
              <Text fw={700}>Season: {meta.season_name}</Text>
              <Badge>{meta.total_decks} decks</Badge>
            </Group>
          </Card>
        )}

        <Card withBorder>
          <Title order={4} mb="sm">
            Most Used Cards
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Image</Table.Th>
                <Table.Th>Card</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Decks</Table.Th>
                <Table.Th>Copies</Table.Th>
                <Table.Th>Traits</Table.Th>
                <Table.Th>Keywords</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {topCards.slice(0, 30).map((row: any) => (
                <Table.Tr key={row.card_id}>
                  <Table.Td>
                    {row.image_url != null && row.image_url !== '' ? (
                      <Image src={row.image_url} h={42} w={72} fit="contain" radius="sm" />
                    ) : (
                      <Text size="xs" c="dimmed">
                        -
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text fw={600}>{row.card_name ?? 'Unknown card'}</Text>
                  </Table.Td>
                  <Table.Td>{row.card_type ?? '-'}</Table.Td>
                  <Table.Td>{row.deck_count ?? 0}</Table.Td>
                  <Table.Td>{row.total_copies ?? 0}</Table.Td>
                  <Table.Td>{(row.traits ?? []).slice(0, 3).join(', ') || '-'}</Table.Td>
                  <Table.Td>{(row.keywords ?? []).slice(0, 3).join(', ') || '-'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Group grow align="start">
          <Card withBorder>
            <Title order={4} mb="sm">
              Top Leaders
            </Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Image</Table.Th>
                  <Table.Th>Leader</Table.Th>
                  <Table.Th>Decks</Table.Th>
                  <Table.Th>Win %</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topLeaders.slice(0, 15).map((row: any) => (
                  <Table.Tr key={row.card_id}>
                    <Table.Td>
                      {row.image_url != null && row.image_url !== '' ? (
                        <Image src={row.image_url} h={42} w={72} fit="contain" radius="sm" />
                      ) : (
                        <Text size="xs" c="dimmed">
                          -
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{row.card_name ?? 'Unknown leader'}</Table.Td>
                    <Table.Td>{row.count ?? 0}</Table.Td>
                    <Table.Td>{row.win_rate ?? 0}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Top Bases
            </Title>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Image</Table.Th>
                  <Table.Th>Base</Table.Th>
                  <Table.Th>Decks</Table.Th>
                  <Table.Th>Win %</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topBases.slice(0, 15).map((row: any) => (
                  <Table.Tr key={row.card_id}>
                    <Table.Td>
                      {row.image_url != null && row.image_url !== '' ? (
                        <Image src={row.image_url} h={42} w={72} fit="contain" radius="sm" />
                      ) : (
                        <Text size="xs" c="dimmed">
                          -
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{row.card_name ?? 'Unknown base'}</Table.Td>
                    <Table.Td>{row.count ?? 0}</Table.Td>
                    <Table.Td>{row.win_rate ?? 0}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        </Group>

        <Card withBorder>
          <Title order={4} mb="sm">
            Top Archetypes
          </Title>
          <Table>
            <Table.Thead>
                <Table.Tr>
                  <Table.Th>Leader</Table.Th>
                  <Table.Th>Base</Table.Th>
                  <Table.Th>Decks</Table.Th>
                  <Table.Th>Win %</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {topArchetypes.slice(0, 20).map((row: any) => (
                <Table.Tr key={`${row.leader_card_id}-${row.base_card_id}`}>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      {row.leader_image_url != null && row.leader_image_url !== '' ? (
                        <Image src={row.leader_image_url} h={32} w={56} fit="contain" radius="sm" />
                      ) : null}
                      <Text>{row.leader_name ?? 'Unknown leader'}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      {row.base_image_url != null && row.base_image_url !== '' ? (
                        <Image src={row.base_image_url} h={32} w={56} fit="contain" radius="sm" />
                      ) : null}
                      <Text>{row.base_name ?? 'Unknown base'}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{row.count ?? 0}</Table.Td>
                  <Table.Td>{row.win_rate ?? 0}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Group grow align="start">
          <Card withBorder>
            <Title order={4} mb="sm">
              Trait Trends
            </Title>
            <Group gap={8}>
              {topTraits.slice(0, 25).map((row: any) => (
                <Badge key={row.label} variant="light">
                  {row.label}: {row.count}
                </Badge>
              ))}
            </Group>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Keyword Trends
            </Title>
            <Group gap={8}>
              {topKeywords.slice(0, 25).map((row: any) => (
                <Badge key={row.label} variant="light">
                  {row.label}: {row.count}
                </Badge>
              ))}
            </Group>
          </Card>
        </Group>
      </Stack>
    </Layout>
  );
}
