import {
  Badge,
  Card,
  Group,
  Image,
  Progress,
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

const ASPECT_ICON_BY_KEY: Record<string, string> = {
  aggression: '/icons/aspects/aggression.png',
  command: '/icons/aspects/command.png',
  cunning: '/icons/aspects/cunning.png',
  vigilance: '/icons/aspects/vigilance.png',
  villainy: '/icons/aspects/villainy.png',
  heroic: '/icons/aspects/heroism.png',
  heroism: '/icons/aspects/heroism.png',
};

const ASPECT_COLOR_BY_KEY: Record<string, string> = {
  aggression: '#c2410c',
  command: '#0891b2',
  cunning: '#7c3aed',
  vigilance: '#ca8a04',
  villainy: '#9ca3af',
  heroic: '#e5e7eb',
  heroism: '#e5e7eb',
};

function normalizeAspectKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function getAspectKeysFromComboLabel(label: string): string[] {
  const normalized = label.trim();
  if (normalized === '' || normalized.toLowerCase() === 'colorless / neutral') {
    return [];
  }
  return normalized
    .split('+')
    .map((part) => normalizeAspectKey(part))
    .filter((part) => part !== '');
}

function getHeroVillainVisual(label: string) {
  const key = normalizeAspectKey(label);
  if (key.includes('villain')) {
    return { color: ASPECT_COLOR_BY_KEY.villainy, iconSources: ['/icons/aspects/villainy.png'] };
  }
  if (key.includes('hero')) {
    return { color: ASPECT_COLOR_BY_KEY.heroic, iconSources: ['/icons/aspects/heroism.png'] };
  }
  return { color: '#64748b', iconSources: [] as string[] };
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) return `rgba(100, 116, 139, ${alpha})`;
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function AspectLabel({
  aspectKey,
}: {
  aspectKey: string;
}) {
  if (aspectKey === 'none') {
    return (
      <Text size="xs" c="dimmed">
        None
      </Text>
    );
  }
  const iconSrc = ASPECT_ICON_BY_KEY[aspectKey];
  const label = aspectKey.charAt(0).toUpperCase() + aspectKey.slice(1);
  return (
    <Group gap={4} wrap="nowrap">
      {iconSrc != null ? <Image src={iconSrc} alt={label} w={12} h={12} fit="contain" /> : null}
      <Text size="xs">{label}</Text>
    </Group>
  );
}

function AspectHeatmapCard({
  rows,
}: {
  rows: Array<{
    label: string;
    primary: string;
    secondary: string;
    metaSharePct: number;
  }>;
}) {
  if (rows.length < 1) {
    return (
      <Card withBorder>
        <Title order={4} mb="sm">
          Aspect Combo Share Heatmap
        </Title>
        <Text c="dimmed" size="sm">
          Not enough data yet.
        </Text>
      </Card>
    );
  }
  const axisOrder = ['aggression', 'command', 'cunning', 'vigilance', 'none'];
  const primaryAxes = axisOrder.filter((key) => rows.some((row) => row.primary === key));
  const secondaryAxes = axisOrder.filter((key) => rows.some((row) => row.secondary === key));
  if (primaryAxes.length < 1 || secondaryAxes.length < 1) {
    return (
      <Card withBorder>
        <Title order={4} mb="sm">
          Aspect Combo Share Heatmap
        </Title>
        <Text c="dimmed" size="sm">
          Not enough data yet.
        </Text>
      </Card>
    );
  }
  const byKey: Record<string, number> = {};
  rows.forEach((row) => {
    const key = `${row.secondary}|${row.primary}`;
    byKey[key] = (byKey[key] ?? 0) + Number(row.metaSharePct ?? 0);
  });
  const maxShare = Math.max(...Object.values(byKey), 0.01);

  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        Aspect Combo Share Heatmap
      </Title>
      <Text size="xs" c="dimmed" mb="sm">
        X-axis: Primary Aspect | Y-axis: Secondary Aspect | Color intensity: % of field.
      </Text>
      <Table withColumnBorders withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <Text size="xs" fw={700}>
                Secondary \ Primary
              </Text>
            </Table.Th>
            {primaryAxes.map((primaryKey) => (
              <Table.Th key={`heatmap-primary-${primaryKey}`}>
                <AspectLabel aspectKey={primaryKey} />
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {secondaryAxes.map((secondaryKey) => (
            <Table.Tr key={`heatmap-row-${secondaryKey}`}>
              <Table.Td>
                <AspectLabel aspectKey={secondaryKey} />
              </Table.Td>
              {primaryAxes.map((primaryKey) => {
                const key = `${secondaryKey}|${primaryKey}`;
                const share = Number(byKey[key] ?? 0);
                const intensity = Math.max(0, Math.min(1, share / maxShare));
                const dominantColor = ASPECT_COLOR_BY_KEY[primaryKey] ?? '#64748b';
                return (
                  <Table.Td
                    key={`heatmap-cell-${secondaryKey}-${primaryKey}`}
                    style={{
                      backgroundColor: share <= 0 ? undefined : hexToRgba(dominantColor, 0.12 + intensity * 0.68),
                    }}
                  >
                    <Text size="xs" fw={600}>
                      {share.toFixed(1)}%
                    </Text>
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function PatternBars({
  title,
  rows,
}: {
  title: string;
  rows: any[];
}) {
  if (rows.length < 1) {
    return (
      <Card withBorder>
        <Title order={4} mb="sm">
          {title}
        </Title>
        <Text c="dimmed" size="sm">
          Not enough completed deck data yet.
        </Text>
      </Card>
    );
  }

  const maxDecks = Math.max(...rows.map((row: any) => Number(row.decks ?? 0)), 1);
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {title}
      </Title>
      <Stack gap="sm">
        {rows.slice(0, 6).map((row: any) => (
          <Stack key={String(row.label)} gap={4}>
            <Group justify="space-between">
              <Text fw={600}>{row.label}</Text>
              <Text size="sm" c="dimmed">
                {Number(row.avg_win_rate ?? 0).toFixed(2)}% | {row.decks ?? 0} decks
              </Text>
            </Group>
            <Progress value={(Number(row.decks ?? 0) / maxDecks) * 100} />
            {row.summary != null && String(row.summary).trim() !== '' ? (
              <Text size="xs" c="dimmed">
                {row.summary}
              </Text>
            ) : null}
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}

function PieChartCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; color?: string; iconSources?: string[] }>;
}) {
  if (rows.length < 1) {
    return (
      <Card withBorder>
        <Title order={4} mb="sm">
          {title}
        </Title>
        <Text c="dimmed" size="sm">
          Not enough data yet.
        </Text>
      </Card>
    );
  }

  const total = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  if (total <= 0) {
    return (
      <Card withBorder>
        <Title order={4} mb="sm">
          {title}
        </Title>
        <Text c="dimmed" size="sm">
          Not enough data yet.
        </Text>
      </Card>
    );
  }

  const palette = ['#0f4c5c', '#5f0f40', '#9a031e', '#fb8b24', '#e36414', '#2a9d8f', '#264653'];
  let offset = 0;
  const segments = rows.map((row, index) => {
    const pct = (Number(row.value ?? 0) / total) * 100;
    const start = offset;
    const end = offset + pct;
    offset = end;
    return {
      ...row,
      pct,
      color: row.color ?? palette[index % palette.length],
      start,
      end,
      iconSources: row.iconSources ?? [],
    };
  });
  const gradient = segments.map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`).join(', ');

  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {title}
      </Title>
      <Group align="flex-start" wrap="nowrap">
        <div style={{ width: 160, height: 160, position: 'relative', flex: '0 0 auto' }}>
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: '50%',
              background: `conic-gradient(${gradient})`,
              border: '1px solid rgba(0, 0, 0, 0.08)',
            }}
          />
          {segments
            .filter((segment) => segment.iconSources.length > 0 && segment.pct >= 1)
            .map((segment) => {
              const mid = (segment.start + segment.end) / 2;
              const radians = ((mid * 3.6 - 90) * Math.PI) / 180;
              const x = 50 + Math.cos(radians) * 32;
              const y = 50 + Math.sin(radians) * 32;
              return (
                <img
                  key={`icon-${segment.label}`}
                  src={segment.iconSources[0]}
                  alt={segment.label}
                  title={segment.label}
                  style={{
                    position: 'absolute',
                    left: `calc(${x}% - 8px)`,
                    top: `calc(${y}% - 8px)`,
                    width: 16,
                    height: 16,
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.9))',
                  }}
                />
              );
            })}
        </div>
        <Stack gap={6}>
          {segments.map((segment) => (
            <Group key={segment.label} gap={8}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: segment.color,
                  flex: '0 0 auto',
                }}
              />
              {segment.iconSources.length > 0 ? (
                <Group gap={4} wrap="nowrap">
                  {segment.iconSources.slice(0, 3).map((iconSrc, index) => (
                    <Image
                      key={`${segment.label}-icon-${index}`}
                      src={iconSrc}
                      alt={segment.label}
                      w={12}
                      h={12}
                      fit="contain"
                    />
                  ))}
                </Group>
              ) : null}
              <Text size="sm">
                {segment.label}: {segment.value.toFixed(2)} ({segment.pct.toFixed(1)}%)
              </Text>
            </Group>
          ))}
        </Stack>
      </Group>
    </Card>
  );
}

export default function LeagueMetaAnalysisPage() {
  const swrTournamentsResponse = getTournaments('ALL');
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const activeTournamentId = Number(selectedTournamentId ?? 0);

  useEffect(() => {
    if (tournaments.length < 1 || selectedTournamentId != null) return;
    const selected = [...tournaments].sort((left: any, right: any) => Number(left.id) - Number(right.id))[0];
    if (selected == null) return;
    setSelectedTournamentId(String(selected.id));
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

  const topCards = useMemo(() => {
    const rows = meta?.top_cards ?? [];
    const dedupedByName: Record<string, any> = {};
    rows.forEach((row: any) => {
      const cardName = String(row?.card_name ?? '').trim();
      const fallbackId = String(row?.card_id ?? '').trim();
      const key = (cardName !== '' ? cardName : fallbackId).toLowerCase();
      if (key === '') return;
      const previous = dedupedByName[key];
      if (previous == null) {
        dedupedByName[key] = { ...row };
        return;
      }
      previous.deck_count = Number(previous.deck_count ?? 0) + Number(row?.deck_count ?? 0);
      previous.total_copies = Number(previous.total_copies ?? 0) + Number(row?.total_copies ?? 0);
      if ((String(previous?.image_url ?? '').trim() === '') && String(row?.image_url ?? '').trim() !== '') {
        previous.image_url = row.image_url;
      }
    });
    return Object.values(dedupedByName).sort((left: any, right: any) => {
      const copiesDiff = Number(right?.total_copies ?? 0) - Number(left?.total_copies ?? 0);
      if (copiesDiff !== 0) return copiesDiff;
      return Number(right?.deck_count ?? 0) - Number(left?.deck_count ?? 0);
    });
  }, [meta]);
  const topLeaders = useMemo(
    () =>
      [...(meta?.top_leaders ?? [])].sort((left: any, right: any) => {
        const winRateDiff = Number(right?.win_rate ?? 0) - Number(left?.win_rate ?? 0);
        if (winRateDiff !== 0) return winRateDiff;
        return Number(right?.count ?? 0) - Number(left?.count ?? 0);
      }),
    [meta]
  );
  const topCostCurvePatterns = useMemo(() => meta?.top_cost_curve_patterns ?? [], [meta]);
  const topArenaPatterns = useMemo(() => meta?.top_arena_patterns ?? [], [meta]);
  const metaTakeaways = useMemo(() => meta?.meta_takeaways ?? [], [meta]);
  const topTraits = useMemo(() => meta?.top_traits ?? [], [meta]);
  const topKeywords = useMemo(() => meta?.top_keywords ?? [], [meta]);
  const topDeckTraits = useMemo(() => meta?.top_deck_traits ?? [], [meta]);
  const topDeckKeywords = useMemo(() => meta?.top_deck_keywords ?? [], [meta]);
  const topDeckCardTypes = useMemo(() => meta?.top_deck_card_types ?? [], [meta]);
  const topDeckSampleSize = Number(meta?.top_decks_sample_size ?? 0);
  const heroVillainBreakdown = useMemo(() => meta?.hero_villain_breakdown ?? [], [meta]);
  const aspectComboBreakdown = useMemo(() => meta?.aspect_combo_breakdown ?? [], [meta]);
  const keywordWinImpact = useMemo(() => meta?.keyword_win_impact ?? [], [meta]);
  const liveMetaFindings = useMemo(() => meta?.live_meta_findings ?? [], [meta]);
  const trendingCards = useMemo(() => meta?.trending_cards ?? [], [meta]);
  const replacementSignals = useMemo(() => meta?.replacement_signals ?? [], [meta]);
  const heroVillainDeckRows = useMemo(
    () =>
      heroVillainBreakdown.map((row: any) => ({
        label: String(row?.label ?? ''),
        value: Number(row?.decks ?? 0),
        ...getHeroVillainVisual(String(row?.label ?? '')),
      })),
    [heroVillainBreakdown]
  );
  const heroVillainWinRows = useMemo(
    () =>
      heroVillainBreakdown.map((row: any) => ({
        label: String(row?.label ?? ''),
        value: Math.max(0, Number(row?.avg_win_rate ?? 0)),
        ...getHeroVillainVisual(String(row?.label ?? '')),
      })),
    [heroVillainBreakdown]
  );
  const topDeckTypeRows = useMemo(
    () =>
      topDeckCardTypes.map((row: any) => ({
        label: String(row?.label ?? ''),
        value: Number(row?.count ?? 0),
      })),
    [topDeckCardTypes]
  );
  const mostUsedAspectCombos = useMemo(
    () =>
      [...aspectComboBreakdown]
        .sort((left: any, right: any) => Number(right?.decks ?? 0) - Number(left?.decks ?? 0))
        .slice(0, 8),
    [aspectComboBreakdown]
  );
  const leastUsedAspectCombos = useMemo(
    () =>
      [...aspectComboBreakdown]
        .sort((left: any, right: any) => Number(left?.decks ?? 0) - Number(right?.decks ?? 0))
        .slice(0, 8),
    [aspectComboBreakdown]
  );
  const mostSuccessfulAspectCombos = useMemo(
    () =>
      [...aspectComboBreakdown]
        .sort((left: any, right: any) => {
          const winDiff = Number(right?.avg_win_rate ?? 0) - Number(left?.avg_win_rate ?? 0);
          if (winDiff !== 0) return winDiff;
          return Number(right?.decks ?? 0) - Number(left?.decks ?? 0);
        })
        .slice(0, 8),
    [aspectComboBreakdown]
  );
  const aspectComboPerformanceRows = useMemo(() => {
    const totalDecks = Math.max(0, Number(meta?.total_decks ?? 0));
    return aspectComboBreakdown
      .map((row: any) => {
        const label = String(row?.label ?? '');
        const decks = Number(row?.decks ?? 0);
        const winRate = Number(row?.avg_win_rate ?? 0);
        const metaSharePct = totalDecks > 0 ? (decks / totalDecks) * 100 : 0;
        const overperformanceIndex = winRate - metaSharePct;
        const comboKeys = getAspectKeysFromComboLabel(label).filter(
          (key) => key !== 'heroic' && key !== 'heroism' && key !== 'villainy'
        );
        const primary = comboKeys[0] ?? 'none';
        const secondary = comboKeys[1] ?? 'none';
        return {
          label,
          decks,
          winRate,
          metaSharePct,
          overperformanceIndex,
          primary,
          secondary,
          iconSources: comboKeys
            .map((key) => ASPECT_ICON_BY_KEY[key])
            .filter((value) => value != null),
        };
      })
      .sort(
        (left: any, right: any) =>
          Number(right.overperformanceIndex ?? 0) - Number(left.overperformanceIndex ?? 0)
      );
  }, [aspectComboBreakdown, meta?.total_decks]);
  const aspectComboHeatmapRows = useMemo(
    () =>
      aspectComboPerformanceRows.map((row: any) => ({
        label: row.label,
        primary: row.primary,
        secondary: row.secondary,
        metaSharePct: row.metaSharePct,
      })),
    [aspectComboPerformanceRows]
  );

  return (
    <Layout>
      <Stack>
        <Title>Meta Analysis</Title>
        <Text c="dimmed">
          League-wide view across all players and all mapped events/weeks in the selected season.
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
          {swrTournamentsResponse.isLoading || swrSeasonsResponse.isLoading ? (
            <Text size="xs" c="dimmed" mt={8}>
              Loading seasons...
            </Text>
          ) : null}
        </Card>

        {swrMetaResponse.error && <RequestErrorAlert error={swrMetaResponse.error} />}
        {swrMetaResponse.isLoading ? (
          <Card withBorder>
            <Text c="dimmed">Loading meta analysis...</Text>
          </Card>
        ) : null}

        {meta != null && (
          <Card withBorder>
            <Group justify="space-between">
              <Text fw={700}>Season: {meta.season_name}</Text>
              <Badge>{meta.total_decks} decks</Badge>
            </Group>
          </Card>
        )}

        {liveMetaFindings.length > 0 ? (
          <Card withBorder>
            <Title order={4} mb="sm">
              Live Meta Findings
            </Title>
            <Stack gap={6}>
              {liveMetaFindings.slice(0, 8).map((finding: string, index: number) => (
                <Text key={`finding-${index}-${finding}`} size="sm">
                  {finding}
                </Text>
              ))}
            </Stack>
          </Card>
        ) : null}

        <Group grow align="start">
          <PatternBars title="Winning Cost Curve Patterns" rows={topCostCurvePatterns} />
          <PatternBars title="Winning Arena Patterns" rows={topArenaPatterns} />
        </Group>

        <PieChartCard
          title={`Top-Deck Card Type Distribution${topDeckSampleSize > 0 ? ` (${topDeckSampleSize} decks)` : ''}`}
          rows={topDeckTypeRows}
        />

        <Group grow align="start">
          <PieChartCard title="Heroic vs Villainy by Deck Count" rows={heroVillainDeckRows} />
          <PieChartCard title="Heroic vs Villainy by Win % Share" rows={heroVillainWinRows} />
        </Group>

        <Card withBorder>
          <Title order={4} mb="sm">
            Aspect Combo Win % vs Popularity
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Overperformance Index = Win % - Meta Share %. Negative values suggest overplayed field share.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Combo</Table.Th>
                <Table.Th>Decks</Table.Th>
                <Table.Th>Meta Share %</Table.Th>
                <Table.Th>Win %</Table.Th>
                <Table.Th>Overperformance Index</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {aspectComboPerformanceRows.slice(0, 20).map((row: any) => (
                <Table.Tr key={`combo-perf-${row.label}`}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {row.iconSources.slice(0, 3).map((iconSrc: string, index: number) => (
                        <Image
                          key={`${row.label}-icon-${index}`}
                          src={iconSrc}
                          alt={row.label}
                          w={12}
                          h={12}
                          fit="contain"
                        />
                      ))}
                      <Text size="sm">{row.label}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>{row.decks}</Table.Td>
                  <Table.Td>{row.metaSharePct.toFixed(2)}%</Table.Td>
                  <Table.Td>{row.winRate.toFixed(2)}%</Table.Td>
                  <Table.Td>
                    <Badge color={row.overperformanceIndex >= 0 ? 'teal' : 'red'} variant="light">
                      {row.overperformanceIndex >= 0 ? '+' : ''}
                      {row.overperformanceIndex.toFixed(2)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
              {aspectComboPerformanceRows.length < 1 ? (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" size="sm">
                      No combo performance rows yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Card>

        <AspectHeatmapCard rows={aspectComboHeatmapRows} />

        <Card withBorder>
          <Title order={4} mb="sm">
            Win Impact Score per Keyword
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Win Impact Score = Win % with keyword - League Average Win %.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Keyword</Table.Th>
                <Table.Th>Decks</Table.Th>
                <Table.Th>Meta Share %</Table.Th>
                <Table.Th>Win % with Keyword</Table.Th>
                <Table.Th>League Avg Win %</Table.Th>
                <Table.Th>Win Impact Score</Table.Th>
                <Table.Th>Top 4 Conversion %</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keywordWinImpact.slice(0, 25).map((row: any) => (
                <Table.Tr key={`keyword-impact-${row.keyword}`}>
                  <Table.Td>
                    <Text fw={600}>{row.keyword}</Text>
                  </Table.Td>
                  <Table.Td>{row.deck_count ?? 0}</Table.Td>
                  <Table.Td>{Number(row.usage_share_pct ?? 0).toFixed(2)}%</Table.Td>
                  <Table.Td>{Number(row.win_rate_with_keyword ?? 0).toFixed(2)}%</Table.Td>
                  <Table.Td>{Number(row.league_avg_win_rate ?? 0).toFixed(2)}%</Table.Td>
                  <Table.Td>
                    <Badge
                      color={Number(row.win_impact_score ?? 0) >= 0 ? 'teal' : 'red'}
                      variant="light"
                    >
                      {Number(row.win_impact_score ?? 0) >= 0 ? '+' : ''}
                      {Number(row.win_impact_score ?? 0).toFixed(2)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{Number(row.top4_conversion_pct ?? 0).toFixed(2)}%</Table.Td>
                </Table.Tr>
              ))}
              {keywordWinImpact.length < 1 ? (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" size="sm">
                      No keyword impact rows yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Card>

        <Group grow align="start">
          <Card withBorder>
            <Title order={4} mb="sm">
              Aspect Combos Most Used
            </Title>
            <Stack gap={6}>
              {mostUsedAspectCombos.map((row: any) => (
                <Text size="sm" key={`most-${row.label}`}>
                  {row.label}: {row.decks} decks | {Number(row.avg_win_rate ?? 0).toFixed(2)}% win
                </Text>
              ))}
              {mostUsedAspectCombos.length < 1 ? (
                <Text c="dimmed" size="sm">
                  No combo data yet.
                </Text>
              ) : null}
            </Stack>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Aspect Combos Least Used
            </Title>
            <Stack gap={6}>
              {leastUsedAspectCombos.map((row: any) => (
                <Text size="sm" key={`least-${row.label}`}>
                  {row.label}: {row.decks} decks | {Number(row.avg_win_rate ?? 0).toFixed(2)}% win
                </Text>
              ))}
              {leastUsedAspectCombos.length < 1 ? (
                <Text c="dimmed" size="sm">
                  No combo data yet.
                </Text>
              ) : null}
            </Stack>
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              Aspect Combos Most Successful
            </Title>
            <Stack gap={6}>
              {mostSuccessfulAspectCombos.map((row: any) => (
                <Text size="sm" key={`best-${row.label}`}>
                  {row.label}: {Number(row.avg_win_rate ?? 0).toFixed(2)}% win | {row.decks} decks
                </Text>
              ))}
              {mostSuccessfulAspectCombos.length < 1 ? (
                <Text c="dimmed" size="sm">
                  No combo data yet.
                </Text>
              ) : null}
            </Stack>
          </Card>
        </Group>

        {metaTakeaways.length > 0 ? (
          <Card withBorder>
            <Title order={4} mb="sm">
              Meta Takeaways
            </Title>
            <Stack gap={6}>
              {metaTakeaways.map((line: string, index: number) => (
                <Text key={`${index}-${line}`} size="sm">
                  {line}
                </Text>
              ))}
            </Stack>
          </Card>
        ) : null}

        <Card withBorder>
          <Title order={4} mb="sm">
            Best Performing Leaders
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
            Top-Deck Traits and Keywords
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Highlighted from the highest win-rate deck sample.
          </Text>
          <Group align="flex-start" grow>
            <Stack gap={8}>
              <Text fw={600}>Traits</Text>
              <Group gap={8}>
                {topDeckTraits.slice(0, 18).map((row: any) => (
                  <Badge key={`top-trait-${row.label}`} color="cyan" variant="light">
                    {row.label}: {row.count}
                  </Badge>
                ))}
                {topDeckTraits.length < 1 ? (
                  <Text size="sm" c="dimmed">
                    No data
                  </Text>
                ) : null}
              </Group>
            </Stack>
            <Stack gap={8}>
              <Text fw={600}>Keywords</Text>
              <Group gap={8}>
                {topDeckKeywords.slice(0, 18).map((row: any) => (
                  <Badge key={`top-keyword-${row.label}`} color="teal" variant="light">
                    {row.label}: {row.count}
                  </Badge>
                ))}
                {topDeckKeywords.length < 1 ? (
                  <Text size="sm" c="dimmed">
                    No data
                  </Text>
                ) : null}
              </Group>
            </Stack>
          </Group>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Most Played Cards (Popularity)
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
              {topCards.slice(0, 30).map((row: any, index: number) => (
                <Table.Tr key={`${String(row.card_name ?? row.card_id)}-${index}`}>
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
              Trait Trends (All Decks)
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
              Keyword Trends (All Decks)
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

        <Card withBorder>
          <Title order={4} mb="sm">
            Trending Cards (Recent Week-to-Week Delta)
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Tracks usage delta and win-rate delta versus the previous event week.
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Image</Table.Th>
                <Table.Th>Card</Table.Th>
                <Table.Th>Usage Delta</Table.Th>
                <Table.Th>Win % Delta</Table.Th>
                <Table.Th>Current Usage</Table.Th>
                <Table.Th>Previous Usage</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {trendingCards.slice(0, 14).map((row: any, index: number) => (
                <Table.Tr key={`${row.card_id}-${index}`}>
                  <Table.Td>
                    {row.image_url != null && row.image_url !== '' ? (
                      <Image src={row.image_url} h={42} w={72} fit="contain" radius="sm" />
                    ) : (
                      <Text size="xs" c="dimmed">
                        -
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{row.card_name ?? row.card_id}</Table.Td>
                  <Table.Td>{Number(row.usage_delta ?? 0) >= 0 ? `+${row.usage_delta}` : row.usage_delta}</Table.Td>
                  <Table.Td>
                    {Number(row.win_rate_delta ?? 0) >= 0
                      ? `+${Number(row.win_rate_delta ?? 0).toFixed(2)}%`
                      : `${Number(row.win_rate_delta ?? 0).toFixed(2)}%`}
                  </Table.Td>
                  <Table.Td>{row.current_usage ?? 0}</Table.Td>
                  <Table.Td>{row.previous_usage ?? 0}</Table.Td>
                </Table.Tr>
              ))}
              {trendingCards.length < 1 ? (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" size="sm">
                      Not enough week-over-week data yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : null}
            </Table.Tbody>
          </Table>
        </Card>

        {replacementSignals.length > 0 ? (
          <Card withBorder>
            <Title order={4} mb="sm">
              Replacement Signals
            </Title>
            <Stack gap={6}>
              {replacementSignals.map((line: string, index: number) => (
                <Text size="sm" key={`${index}-${line}`}>
                  {line}
                </Text>
              ))}
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </Layout>
  );
}
