import { Button, Card, Group, Progress, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import RequestErrorAlert from '@components/utils/error_alert';
import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getLeagueSeasonDraft, getTournaments } from '@services/adapter';
import { submitSeasonDraftPick } from '@services/league';

function formatBuckets(rows: any[] | null | undefined) {
  if (rows == null || rows.length < 1) return '-';
  return rows
    .slice(0, 8)
    .map((row: any) => `${row.label}: ${row.count}`)
    .join(', ');
}

function BucketList({
  rows,
  bars = false,
}: {
  rows: any[] | null | undefined;
  bars?: boolean;
}) {
  if (rows == null || rows.length < 1) {
    return <Text size="sm">-</Text>;
  }

  const topRows = rows.slice(0, 8);
  const maxCount = Math.max(...topRows.map((row: any) => Number(row?.count ?? 0)), 1);

  return (
    <Stack gap={4}>
      {topRows.map((row: any) => {
        const count = Number(row?.count ?? 0);
        const label = String(row?.label ?? '-');
        return (
          <div key={`${label}-${count}`}>
            <Group justify="space-between" gap="xs">
              <Text size="xs" fw={600}>
                {label}
              </Text>
              <Text size="xs">{count}</Text>
            </Group>
            {bars ? <Progress value={(count / maxCount) * 100} size="sm" radius="xl" /> : null}
          </div>
        );
      })}
    </Stack>
  );
}

export default function SeasonDraftPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedSourceByTarget, setSelectedSourceByTarget] = useState<Record<string, string | null>>({});

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

  const swrDraftResponse = getLeagueSeasonDraft(activeTournamentId);
  const draftData = swrDraftResponse.data?.data;
  const draftOrder = draftData?.draft_order ?? [];
  const cardBases = draftData?.card_bases ?? [];

  const firstUnpickedIndex = useMemo(
    () => draftOrder.findIndex((row: any) => row.picked_source_user_id == null),
    [draftOrder]
  );

  const availableSourceOptions = useMemo(() => {
    return cardBases
      .filter((base: any) => base.claimed_by_user_id == null)
      .map((base: any) => ({
        value: String(base.source_user_id),
        label: `${base.source_user_name} (${base.total_cards} cards, ${base.previous_wins}-${base.previous_draws}-${base.previous_losses})`,
      }));
  }, [cardBases]);

  const content = (
    <Stack>
      <Title>Season Card Pool Draft</Title>
      <Text c="dimmed">
        Draft order runs from lowest previous season points to highest. Card bases shown are from the
        immediately previous season only.
      </Text>

      {standalone && (
        <Card withBorder>
          <Select
            label="Tournament"
            value={selectedTournamentId}
            onChange={(value) => {
              setSelectedTournamentId(value);
              if (value != null) {
                window.localStorage.setItem('league_default_tournament_id', value);
              }
            }}
            allowDeselect={false}
            data={tournaments.map((t: any) => ({ value: String(t.id), label: t.name }))}
            style={{ minWidth: 320 }}
          />
        </Card>
      )}

      {swrDraftResponse.error && <RequestErrorAlert error={swrDraftResponse.error} />}

      {!swrDraftResponse.isLoading && draftData != null && draftData.from_season_id == null && (
        <Card withBorder>
          <Text c="dimmed">Need at least two seasons to run the card pool draft.</Text>
        </Card>
      )}

      {draftData != null && draftData.from_season_id != null && (
        <Card withBorder>
          <Group justify="space-between">
            <Title order={4}>Season Transition</Title>
            <Text fw={600}>
              {draftData.from_season_name} {'->'} {draftData.to_season_name}
            </Text>
          </Group>
        </Card>
      )}

      {draftData != null && draftOrder.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="sm">
            Draft Order
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pick</Table.Th>
                <Table.Th>Player</Table.Th>
                <Table.Th>Prev Season</Table.Th>
                <Table.Th>Picked Card Base</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {draftOrder.map((row: any, index: number) => {
                const pickLocked = firstUnpickedIndex !== -1 && index !== firstUnpickedIndex;
                const selectedSource = selectedSourceByTarget[String(row.user_id)] ?? null;
                return (
                  <Table.Tr key={row.user_id}>
                    <Table.Td>{row.pick_number}</Table.Td>
                    <Table.Td>{row.user_name}</Table.Td>
                    <Table.Td>
                      {row.previous_points} pts | {row.previous_wins}-{row.previous_draws}-{row.previous_losses}
                    </Table.Td>
                    <Table.Td>
                      {row.picked_source_user_name != null
                        ? row.picked_source_user_name
                        : 'Not drafted'}
                    </Table.Td>
                    <Table.Td>
                      {row.picked_source_user_id == null && draftData.from_season_id != null && draftData.to_season_id != null ? (
                        <Group justify="flex-end" wrap="nowrap">
                          <Select
                            placeholder="Choose card base"
                            value={selectedSource}
                            onChange={(value) => {
                              setSelectedSourceByTarget((prev) => ({
                                ...prev,
                                [String(row.user_id)]: value,
                              }));
                            }}
                            data={availableSourceOptions}
                            disabled={pickLocked}
                            searchable
                            style={{ minWidth: 260 }}
                          />
                          <Button
                            size="xs"
                            disabled={pickLocked || selectedSource == null}
                            onClick={async () => {
                              if (selectedSource == null) return;
                              await submitSeasonDraftPick(activeTournamentId, {
                                from_season_id: Number(draftData.from_season_id),
                                to_season_id: Number(draftData.to_season_id),
                                target_user_id: Number(row.user_id),
                                source_user_id: Number(selectedSource),
                              });
                              showNotification({
                                color: 'green',
                                title: 'Draft pick saved',
                                message: '',
                              });
                              await swrDraftResponse.mutate();
                            }}
                          >
                            Assign
                          </Button>
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          {pickLocked ? 'Waiting for earlier picks' : '-'}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {draftData != null && cardBases.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="sm">
            Available Card Bases (Previous Season)
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Card Base</Table.Th>
                <Table.Th>Prev Record</Table.Th>
                <Table.Th>Total Cards</Table.Th>
                <Table.Th>Cost Dist</Table.Th>
                <Table.Th>Type Dist</Table.Th>
                <Table.Th>Aspect Dist</Table.Th>
                <Table.Th>Trait Dist</Table.Th>
                <Table.Th>Rarity Dist</Table.Th>
                <Table.Th>Claimed By</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cardBases.map((base: any) => (
                <Table.Tr key={base.source_user_id}>
                  <Table.Td>{base.source_user_name}</Table.Td>
                  <Table.Td>
                    {base.previous_points} pts | {base.previous_wins}-{base.previous_draws}-{base.previous_losses}
                  </Table.Td>
                  <Table.Td>{base.total_cards}</Table.Td>
                  <Table.Td>
                    <BucketList rows={base.by_cost} bars />
                  </Table.Td>
                  <Table.Td>{formatBuckets(base.by_type)}</Table.Td>
                  <Table.Td>{formatBuckets(base.by_aspect)}</Table.Td>
                  <Table.Td>{formatBuckets(base.by_trait)}</Table.Td>
                  <Table.Td>{formatBuckets(base.by_rarity)}</Table.Td>
                  <Table.Td>{base.claimed_by_user_name ?? '-'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }

  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
