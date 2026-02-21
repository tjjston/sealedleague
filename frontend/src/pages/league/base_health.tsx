import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconMinus, IconPlayerPlay, IconPlayerStop, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import Layout from '@pages/_layout';
import { getLeagueCards, getStages, getTournamentApplications } from '@services/adapter';

const DEFAULT_BASE_HEALTH = 30;
const DEFAULT_ROUND_MINUTES = 55;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_SERIES_LENGTH = 15;

const BASE_ASPECT_COLORS: Record<string, string> = {
  aggression: '#b42318',
  command: '#0369a1',
  cunning: '#7e22ce',
  vigilance: '#a16207',
  villainy: '#4b5563',
  heroic: '#9ca3af',
  heroism: '#9ca3af',
};

const DEFAULT_PLAYER_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#ca8a04',
  '#7c3aed',
  '#0f766e',
  '#db2777',
  '#4b5563',
];

type PlayerState = {
  id: number;
  name: string;
  health: number;
  maxHealth: number;
  forceActive: boolean;
  leaderName: string | null;
  leaderImageUrl: string | null;
  baseName: string | null;
  baseImageUrl: string | null;
  baseAspects: string[];
};

function createPlayer(id: number, health: number): PlayerState {
  return {
    id,
    name: `Player ${id}`,
    health,
    maxHealth: health,
    forceActive: false,
    leaderName: null,
    leaderImageUrl: null,
    baseName: null,
    baseImageUrl: null,
    baseAspects: [],
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeAspectKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed)) return `rgba(148, 163, 184, ${alpha})`;
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatClock(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function normalizeSeriesLength(value: number) {
  const clamped = clampNumber(Math.round(value), 1, MAX_SERIES_LENGTH);
  return clamped % 2 === 0 ? Math.min(MAX_SERIES_LENGTH, clamped + 1) : clamped;
}

function getPlayerPalette(player: PlayerState) {
  const fromBase = player.baseAspects
    .map((aspect) => BASE_ASPECT_COLORS[normalizeAspectKey(aspect)])
    .filter((color): color is string => color != null);
  if (fromBase.length > 0) return [...new Set(fromBase)];
  return [DEFAULT_PLAYER_COLORS[(player.id - 1) % DEFAULT_PLAYER_COLORS.length]];
}

export default function BaseHealthPage() {
  const isMobile = useMediaQuery('(max-width: 48em)');
  const location = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const parsedTournamentId = Number(queryParams.get('tournament_id') ?? 0);
  const parsedMatchId = Number(queryParams.get('match_id') ?? 0);
  const autoTournamentId = Number.isFinite(parsedTournamentId) ? parsedTournamentId : 0;
  const autoMatchId = Number.isFinite(parsedMatchId) ? parsedMatchId : 0;
  const hasAutoSetupParams = autoTournamentId > 0 && autoMatchId > 0;

  const [baseHealth, setBaseHealth] = useState<number>(DEFAULT_BASE_HEALTH);
  const [playerCount, setPlayerCount] = useState<number>(2);
  const [players, setPlayers] = useState<PlayerState[]>(() =>
    Array.from({ length: 2 }, (_, index) => createPlayer(index + 1, DEFAULT_BASE_HEALTH))
  );
  const [autoSetupMessage, setAutoSetupMessage] = useState<{
    color: 'green' | 'red' | 'yellow';
    text: string;
  } | null>(null);
  const appliedAutoSetupKeyRef = useRef<string | null>(null);

  const [roundMinutes, setRoundMinutes] = useState<number>(DEFAULT_ROUND_MINUTES);
  const [secondsLeft, setSecondsLeft] = useState<number>(DEFAULT_ROUND_MINUTES * 60);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [seriesEnabled, setSeriesEnabled] = useState<boolean>(false);
  const [seriesLength, setSeriesLength] = useState<number>(3);
  const [seriesGameWinners, setSeriesGameWinners] = useState<Array<number | null>>(() =>
    Array.from({ length: 3 }, () => null)
  );

  const swrStagesResponse = getStages(
    hasAutoSetupParams ? autoTournamentId : null,
    true,
    true
  );
  const swrApplicationsResponse = getTournamentApplications(
    hasAutoSetupParams ? autoTournamentId : null,
    'all'
  );
  const swrCardsResponse = getLeagueCards(hasAutoSetupParams ? autoTournamentId : null, {
    limit: 5000,
    offset: 0,
  });

  const cardsById = useMemo(() => {
    const rows = swrCardsResponse.data?.data?.cards ?? [];
    return rows.reduce(
      (
        result: Record<
          string,
          {
            name: string;
            hp: number | null;
            aspects: string[];
            image_url: string | null;
          }
        >,
        card: any
      ) => {
        const id = normalizeKey(card?.card_id);
        if (id === '' || result[id] != null) return result;
        result[id] = {
          name: String(card?.name ?? card?.card_id ?? id),
          hp: Number.isFinite(Number(card?.hp)) ? Number(card.hp) : null,
          aspects: Array.isArray(card?.aspects)
            ? card.aspects.map((value: any) => String(value))
            : [],
          image_url:
            String(card?.image_url ?? '').trim() === '' ? null : String(card?.image_url ?? ''),
        };
        return result;
      },
      {}
    );
  }, [swrCardsResponse.data?.data?.cards]);

  const applicationByName = useMemo(() => {
    const rows = swrApplicationsResponse.data?.data ?? [];
    return rows.reduce((result: Record<string, any>, row: any) => {
      const key = normalizeKey(row?.user_name);
      if (key === '' || result[key] != null) return result;
      result[key] = row;
      return result;
    }, {});
  }, [swrApplicationsResponse.data?.data]);

  const autoSetupKey = hasAutoSetupParams ? `${autoTournamentId}:${autoMatchId}` : null;

  useEffect(() => {
    setPlayers((currentPlayers) => {
      const normalizedCount = clampNumber(playerCount, MIN_PLAYERS, MAX_PLAYERS);
      if (normalizedCount === currentPlayers.length) return currentPlayers;
      if (normalizedCount < currentPlayers.length) return currentPlayers.slice(0, normalizedCount);
      const nextPlayers = [...currentPlayers];
      for (let index = currentPlayers.length; index < normalizedCount; index += 1) {
        nextPlayers.push(createPlayer(index + 1, baseHealth));
      }
      return nextPlayers;
    });
  }, [playerCount, baseHealth]);

  useEffect(() => {
    if (!hasAutoSetupParams || autoSetupKey == null) {
      appliedAutoSetupKeyRef.current = null;
      setAutoSetupMessage(null);
      return;
    }
    if (appliedAutoSetupKeyRef.current === autoSetupKey) return;

    if (
      swrStagesResponse.error != null ||
      swrApplicationsResponse.error != null ||
      swrCardsResponse.error != null
    ) {
      setAutoSetupMessage({
        color: 'red',
        text: 'Could not load match deck data automatically. You can still track manually.',
      });
      appliedAutoSetupKeyRef.current = autoSetupKey;
      return;
    }

    const stages = swrStagesResponse.data?.data;
    const applications = swrApplicationsResponse.data?.data;
    const cards = swrCardsResponse.data?.data?.cards;
    if (stages == null || applications == null || cards == null) return;

    const targetMatch =
      stages
        .flatMap((stage: any) => stage?.stage_items ?? [])
        .flatMap((stageItem: any) => stageItem?.rounds ?? [])
        .flatMap((round: any) => round?.matches ?? [])
        .find((match: any) => Number(match?.id ?? 0) === autoMatchId) ?? null;

    if (targetMatch == null) {
      setAutoSetupMessage({
        color: 'red',
        text: `Match #${autoMatchId} was not found in tournament #${autoTournamentId}.`,
      });
      appliedAutoSetupKeyRef.current = autoSetupKey;
      return;
    }

    const resolvePlayerFromInput = (input: any, playerId: number): PlayerState => {
      const teamName = String(input?.team?.name ?? '').trim();
      const playerNames = Array.isArray(input?.team?.players)
        ? input.team.players.map((player: any) => String(player?.name ?? '').trim())
        : [];
      const lookupKeys = [...new Set([teamName, ...playerNames].map(normalizeKey).filter(Boolean))];
      const application = lookupKeys.map((key) => applicationByName[key]).find((row) => row != null) ?? null;

      const leaderId = normalizeKey(application?.deck_leader);
      const baseId = normalizeKey(application?.deck_base);
      const leaderCard = leaderId === '' ? null : cardsById[leaderId] ?? null;
      const baseCard = baseId === '' ? null : cardsById[baseId] ?? null;
      const maxHealth = clampNumber(Number(baseCard?.hp ?? DEFAULT_BASE_HEALTH), 1, 99);

      return {
        id: playerId,
        name: teamName !== '' ? teamName : `Player ${playerId}`,
        health: maxHealth,
        maxHealth,
        forceActive: false,
        leaderName:
          leaderCard?.name ??
          (String(application?.deck_leader ?? '').trim() === ''
            ? null
            : String(application.deck_leader)),
        leaderImageUrl: leaderCard?.image_url ?? null,
        baseName:
          baseCard?.name ??
          (String(application?.deck_base ?? '').trim() === ''
            ? null
            : String(application.deck_base)),
        baseImageUrl: baseCard?.image_url ?? null,
        baseAspects: baseCard?.aspects ?? [],
      };
    };

    const configuredPlayers = [
      resolvePlayerFromInput(targetMatch?.stage_item_input1, 1),
      resolvePlayerFromInput(targetMatch?.stage_item_input2, 2),
    ];
    const withSubmittedDeckCount = configuredPlayers.filter(
      (player) => player.leaderName != null && player.baseName != null
    ).length;

    setPlayers(configuredPlayers);
    setPlayerCount(2);
    setAutoSetupMessage({
      color: withSubmittedDeckCount > 0 ? 'green' : 'yellow',
      text:
        withSubmittedDeckCount > 0
          ? `Loaded match #${autoMatchId}. Players were configured from submitted decks.`
          : `Loaded match #${autoMatchId}. Deck submissions were not found for one or more players.`,
    });
    appliedAutoSetupKeyRef.current = autoSetupKey;
  }, [
    autoSetupKey,
    autoMatchId,
    autoTournamentId,
    hasAutoSetupParams,
    swrStagesResponse.data,
    swrStagesResponse.error,
    swrApplicationsResponse.data,
    swrApplicationsResponse.error,
    swrCardsResponse.data,
    swrCardsResponse.error,
    cardsById,
    applicationByName,
  ]);

  useEffect(() => {
    if (timerRunning) return;
    setSecondsLeft(roundMinutes * 60);
  }, [roundMinutes, timerRunning]);

  useEffect(() => {
    if (!timerRunning) return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          setTimerRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timerRunning]);

  useEffect(() => {
    if (players.length === 2 || !seriesEnabled) return;
    setSeriesEnabled(false);
  }, [players.length, seriesEnabled]);

  useEffect(() => {
    setSeriesGameWinners((current) => {
      if (current.length === seriesLength) return current;
      return Array.from({ length: seriesLength }, (_, index) => current[index] ?? null);
    });
  }, [seriesLength]);

  const timerPercent = useMemo(() => {
    const totalSeconds = Math.max(1, roundMinutes * 60);
    return clampNumber((secondsLeft / totalSeconds) * 100, 0, 100);
  }, [secondsLeft, roundMinutes]);

  const seriesScoreByPlayer = useMemo(() => {
    const result: Record<number, number> = {};
    seriesGameWinners.forEach((winnerId) => {
      if (winnerId == null) return;
      result[winnerId] = (result[winnerId] ?? 0) + 1;
    });
    return result;
  }, [seriesGameWinners]);

  const seriesWinsNeeded = useMemo(() => Math.floor(seriesLength / 2) + 1, [seriesLength]);

  const seriesWinnerId = useMemo(
    () =>
      players.find((player) => (seriesScoreByPlayer[player.id] ?? 0) >= seriesWinsNeeded)?.id ?? null,
    [players, seriesScoreByPlayer, seriesWinsNeeded]
  );

  const isCompactDuelLayout = isMobile && players.length === 2;

  const playerGridCols = useMemo(() => {
    if (isCompactDuelLayout) return { base: 2 };
    if (playerCount <= 2) return { base: 1, sm: 2 };
    if (playerCount <= 4) return { base: 1, sm: 2, lg: 2 };
    return { base: 1, sm: 2, lg: 4 };
  }, [playerCount, isCompactDuelLayout]);

  const playerCardMinHeight =
    isCompactDuelLayout ? '48vh' : playerCount <= 2 ? '42vh' : playerCount <= 4 ? '33vh' : '24vh';
  const hpFontSize =
    isCompactDuelLayout
      ? 'clamp(2.3rem, 8.8vw, 4rem)'
      : playerCount <= 2
      ? 'clamp(3.6rem, 12vw, 8.2rem)'
      : playerCount <= 4
        ? 'clamp(2.6rem, 7vw, 5rem)'
        : 'clamp(2rem, 5.2vw, 3.4rem)';
  const deltaButtonSize: 'md' | 'lg' | 'xl' =
    isCompactDuelLayout ? 'md' : playerCount <= 2 ? 'xl' : playerCount <= 4 ? 'lg' : 'md';
  const deltaButtonFontSize = playerCount <= 2 ? '1.6rem' : playerCount <= 4 ? '1.25rem' : '1.05rem';
  const deltaActionSizePx = isCompactDuelLayout ? 34 : playerCount <= 2 ? 62 : playerCount <= 4 ? 52 : 44;
  const deltaIconSizePx = isCompactDuelLayout ? 16 : playerCount <= 2 ? 30 : playerCount <= 4 ? 24 : 18;
  const cornerCardWidthPx = isCompactDuelLayout ? 56 : playerCount <= 2 ? 98 : playerCount <= 4 ? 82 : 64;
  const cornerCardHeightPx = isCompactDuelLayout ? 78 : playerCount <= 2 ? 138 : playerCount <= 4 ? 116 : 90;

  const updatePlayerHealth = (playerId: number, change: number) => {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId
          ? { ...player, health: clampNumber(player.health + change, 0, player.maxHealth) }
          : player
      )
    );
  };

  const updatePlayerName = (playerId: number, value: string) => {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId ? { ...player, name: value } : player
      )
    );
  };

  const togglePlayerForce = (playerId: number, active: boolean) => {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === playerId ? { ...player, forceActive: active } : player
      )
    );
  };

  const resetAllPlayers = () => {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) => {
        const nextMaxHealth = player.baseName == null ? baseHealth : player.maxHealth;
        return {
          ...player,
          maxHealth: nextMaxHealth,
          health: nextMaxHealth,
          forceActive: false,
        };
      })
    );
  };

  const resetClock = () => {
    setTimerRunning(false);
    setSecondsLeft(roundMinutes * 60);
  };

  const setSeriesGameWinner = (gameIndex: number, winnerId: number | null) => {
    setSeriesGameWinners((current) => {
      const next = [...current];
      next[gameIndex] = winnerId;
      return next;
    });
  };

  const resetSeries = () => {
    setSeriesGameWinners(Array.from({ length: seriesLength }, () => null));
  };

  return (
    <Layout>
      <Stack
        gap={isCompactDuelLayout ? 'xs' : 'sm'}
        style={{ minHeight: isMobile ? 'calc(100dvh - 8rem)' : 'calc(100vh - 9rem)' }}
      >
        {hasAutoSetupParams &&
        appliedAutoSetupKeyRef.current !== autoSetupKey &&
        swrStagesResponse.error == null &&
        swrApplicationsResponse.error == null &&
        swrCardsResponse.error == null ? (
          <Alert color="blue">Loading match and deck data...</Alert>
        ) : null}
        {autoSetupMessage != null ? (
          <Alert color={autoSetupMessage.color}>{autoSetupMessage.text}</Alert>
        ) : null}

        <Group justify="space-between" align={isCompactDuelLayout ? 'center' : 'flex-end'}>
          <div>
            <Title order={isCompactDuelLayout ? 3 : 1}>Base Health Tracker</Title>
            {!isCompactDuelLayout && (
              <Text c="dimmed" size="sm">
                Track base HP for up to 8 players and toggle Force status. When launched from
                Results, players load with submitted leader/base and base HP.
              </Text>
            )}
          </div>
          <Group gap={isCompactDuelLayout ? 6 : 'md'} wrap={isCompactDuelLayout ? 'nowrap' : 'wrap'}>
            {isCompactDuelLayout ? null : (
              <>
                <NumberInput
                  label="Players"
                  min={MIN_PLAYERS}
                  max={MAX_PLAYERS}
                  value={playerCount}
                  onChange={(value) =>
                    setPlayerCount(clampNumber(Number(value) || MIN_PLAYERS, MIN_PLAYERS, MAX_PLAYERS))
                  }
                  w={92}
                  allowDecimal={false}
                />
                <NumberInput
                  label="Default HP"
                  min={1}
                  max={99}
                  value={baseHealth}
                  onChange={(value) => setBaseHealth(clampNumber(Number(value) || 1, 1, 99))}
                  w={110}
                  allowDecimal={false}
                />
              </>
            )}
            <Button
              leftSection={<IconRefresh size={isCompactDuelLayout ? 14 : 16} />}
              size={isCompactDuelLayout ? 'xs' : 'sm'}
              variant="light"
              onClick={resetAllPlayers}
            >
              Reset
            </Button>
            {isCompactDuelLayout ? null : (
              <>
                <Switch
                  label="Series"
                  checked={seriesEnabled}
                  onChange={(event) => {
                    setSeriesEnabled(event.currentTarget.checked);
                    if (!event.currentTarget.checked) {
                      resetSeries();
                    }
                  }}
                  disabled={players.length !== 2}
                />
                <NumberInput
                  label="Best Of"
                  min={1}
                  max={MAX_SERIES_LENGTH}
                  step={2}
                  allowDecimal={false}
                  value={seriesLength}
                  onChange={(value) =>
                    setSeriesLength(normalizeSeriesLength(Number(value) || 1))
                  }
                  disabled={!seriesEnabled || players.length !== 2}
                  w={92}
                />
              </>
            )}
          </Group>
        </Group>
        {isCompactDuelLayout ? (
          <Group justify="space-between" align="center">
            <NumberInput
              label="Round"
              min={1}
              max={300}
              allowDecimal={false}
              value={roundMinutes}
              onChange={(value) => setRoundMinutes(clampNumber(Number(value) || 1, 1, 300))}
              w={86}
              size="xs"
            />
            <Switch
              label="Series"
              checked={seriesEnabled}
              onChange={(event) => {
                setSeriesEnabled(event.currentTarget.checked);
                if (!event.currentTarget.checked) {
                  resetSeries();
                }
              }}
              disabled={players.length !== 2}
            />
          </Group>
        ) : null}

        {seriesEnabled && players.length === 2 && !isCompactDuelLayout ? (
          <Card withBorder shadow="sm">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Title order={4}>Series Tracker (Best of {seriesLength})</Title>
                <Group gap={8}>
                  <Badge size="lg" variant="light">
                    {players[0]?.name ?? 'Player 1'} {seriesScoreByPlayer[players[0]?.id ?? -1] ?? 0}
                  </Badge>
                  <Badge size="lg" variant="light">
                    {players[1]?.name ?? 'Player 2'} {seriesScoreByPlayer[players[1]?.id ?? -1] ?? 0}
                  </Badge>
                  <Button size="xs" variant="light" onClick={resetSeries}>
                    New Series
                  </Button>
                </Group>
              </Group>

              {seriesGameWinners.map((winnerId, gameIndex) => (
                <Group key={`series-game-${gameIndex + 1}`} justify="space-between">
                  <Text fw={600}>Game {gameIndex + 1}</Text>
                  <Group gap={6}>
                    <Button
                      size="xs"
                      variant={winnerId === players[0]?.id ? 'filled' : 'light'}
                      onClick={() => setSeriesGameWinner(gameIndex, players[0]?.id ?? null)}
                    >
                      {players[0]?.name ?? 'Player 1'}
                    </Button>
                    <Button
                      size="xs"
                      variant={winnerId === players[1]?.id ? 'filled' : 'light'}
                      onClick={() => setSeriesGameWinner(gameIndex, players[1]?.id ?? null)}
                    >
                      {players[1]?.name ?? 'Player 2'}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={() => setSeriesGameWinner(gameIndex, null)}
                    >
                      Clear
                    </Button>
                  </Group>
                </Group>
              ))}

              <Text size="sm" c={seriesWinnerId == null ? 'dimmed' : undefined}>
                {seriesWinnerId == null
                  ? `Series in progress (${seriesWinsNeeded} wins needed)`
                  : `Series winner: ${players.find((player) => player.id === seriesWinnerId)?.name ?? 'Player'}`}
              </Text>
            </Stack>
          </Card>
        ) : null}

        <SimpleGrid cols={playerGridCols} spacing={isCompactDuelLayout ? 'xs' : 'md'} style={{ flex: 1 }}>
          {players.map((player) => {
            const hpPercent = clampNumber((player.health / Math.max(player.maxHealth, 1)) * 100, 0, 100);
            const healthColor = hpPercent <= 33 ? 'red' : hpPercent <= 66 ? 'yellow' : 'green';
            const palette = getPlayerPalette(player);
            const primaryBaseColor = palette[0];
            const secondaryBaseColor = palette[1] ?? primaryBaseColor;
            const cardBackground = `linear-gradient(135deg, ${hexToRgba(primaryBaseColor, 0.18)} 0%, ${hexToRgba(secondaryBaseColor, 0.08)} 100%)`;
            const hasCornerArt = player.leaderImageUrl != null || player.baseImageUrl != null;
            return (
              <Card
                key={player.id}
                withBorder
                shadow="sm"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  borderColor: player.forceActive
                    ? 'var(--mantine-color-yellow-5)'
                    : hexToRgba(primaryBaseColor, 0.62),
                  background: cardBackground,
                  minHeight: playerCardMinHeight,
                }}
              >
                {player.leaderImageUrl != null ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 1,
                    }}
                  >
                    <img
                      src={player.leaderImageUrl}
                      alt={player.leaderName ?? 'Leader'}
                      width={cornerCardWidthPx}
                      height={cornerCardHeightPx}
                      style={{
                        objectFit: 'contain',
                        borderRadius: 8,
                        border: `1px solid ${hexToRgba(primaryBaseColor, 0.55)}`,
                        boxShadow: '0 5px 16px rgba(0,0,0,0.25)',
                        background: '#f8fafc',
                      }}
                    />
                  </div>
                ) : null}
                {player.baseImageUrl != null ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      zIndex: 1,
                    }}
                  >
                    <img
                      src={player.baseImageUrl}
                      alt={player.baseName ?? 'Base'}
                      width={cornerCardWidthPx}
                      height={cornerCardHeightPx}
                      style={{
                        objectFit: 'contain',
                        borderRadius: 8,
                        border: `1px solid ${hexToRgba(primaryBaseColor, 0.55)}`,
                        boxShadow: '0 5px 16px rgba(0,0,0,0.25)',
                        background: '#f8fafc',
                      }}
                    />
                  </div>
                ) : null}

                <Stack
                  gap={isCompactDuelLayout ? 'xs' : 'sm'}
                  style={{
                    height: '100%',
                    paddingTop: hasCornerArt ? cornerCardHeightPx + 16 : 0,
                  }}
                >
                  {isCompactDuelLayout ? (
                    <Group justify="space-between" align="center">
                      <Text fw={700} lineClamp={1} size="sm">
                        {player.name}
                      </Text>
                      <Badge color={player.forceActive ? 'yellow' : 'gray'} variant="light" size="sm">
                        {player.forceActive ? 'Force ON' : 'Force OFF'}
                      </Badge>
                    </Group>
                  ) : (
                    <Group justify="space-between" align="flex-start">
                      <TextInput
                        value={player.name}
                        onChange={(event) => updatePlayerName(player.id, event.currentTarget.value)}
                        aria-label={`Player ${player.id} name`}
                        maxLength={24}
                        style={{ flex: 1 }}
                      />
                      <Badge color={player.forceActive ? 'yellow' : 'gray'} variant="light">
                        {player.forceActive ? 'Force ON' : 'Force OFF'}
                      </Badge>
                    </Group>
                  )}

                  <Group grow align="flex-start">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text size="xs" c="dimmed">
                        Leader
                      </Text>
                      <Text size={isCompactDuelLayout ? 'xs' : 'sm'} fw={600} lineClamp={isCompactDuelLayout ? 1 : 2}>
                        {player.leaderName ?? '-'}
                      </Text>
                    </Stack>
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Text size="xs" c="dimmed">
                        Base
                      </Text>
                      <Text size={isCompactDuelLayout ? 'xs' : 'sm'} fw={600} lineClamp={isCompactDuelLayout ? 1 : 2}>
                        {player.baseName ?? '-'}
                      </Text>
                    </Stack>
                  </Group>

                  {!isCompactDuelLayout && (
                    <Group gap={4} wrap="wrap">
                      {(player.baseAspects.length > 0 ? player.baseAspects : ['Neutral']).map(
                        (aspect, aspectIndex) => {
                          const aspectKey = normalizeAspectKey(aspect);
                          const color =
                            BASE_ASPECT_COLORS[aspectKey] ??
                            palette[aspectIndex % palette.length] ??
                            '#64748b';
                          return (
                            <Badge
                              key={`${player.id}-${aspect}-${aspectIndex}`}
                              variant="light"
                              size="sm"
                              style={{
                                color,
                                backgroundColor: hexToRgba(color, 0.18),
                                border: `1px solid ${hexToRgba(color, 0.45)}`,
                              }}
                            >
                              {aspect}
                            </Badge>
                          );
                        }
                      )}
                    </Group>
                  )}

                  <Title order={1} ta="center" style={{ fontSize: hpFontSize }}>
                    {player.health}
                  </Title>
                  {!isCompactDuelLayout && (
                    <Text size="xs" c="dimmed" ta="center">
                      {player.health} / {player.maxHealth} HP
                    </Text>
                  )}
                  <Progress
                    value={hpPercent}
                    color={healthColor}
                    size={isCompactDuelLayout ? 'md' : 'xl'}
                    radius="xl"
                  />

                  {isCompactDuelLayout ? (
                    <Group justify="center" gap={4} wrap="nowrap">
                      <ActionIcon
                        variant="light"
                        color="red"
                        size={deltaActionSizePx}
                        onClick={() => updatePlayerHealth(player.id, -5)}
                        aria-label={`Remove five health from ${player.name}`}
                      >
                        <IconMinus size={deltaIconSizePx} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="red"
                        size={deltaActionSizePx}
                        onClick={() => updatePlayerHealth(player.id, -1)}
                        aria-label={`Remove one health from ${player.name}`}
                      >
                        <Text fw={700} size="xs">
                          -1
                        </Text>
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="green"
                        size={deltaActionSizePx}
                        onClick={() => updatePlayerHealth(player.id, 1)}
                        aria-label={`Add one health to ${player.name}`}
                      >
                        <Text fw={700} size="xs">
                          +1
                        </Text>
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="green"
                        size={deltaActionSizePx}
                        onClick={() => updatePlayerHealth(player.id, 5)}
                        aria-label={`Add five health to ${player.name}`}
                      >
                        <IconPlus size={deltaIconSizePx} />
                      </ActionIcon>
                      <Button
                        size="xs"
                        variant={player.forceActive ? 'filled' : 'light'}
                        color={player.forceActive ? 'yellow' : 'gray'}
                        onClick={() => togglePlayerForce(player.id, !player.forceActive)}
                      >
                        Force
                      </Button>
                    </Group>
                  ) : (
                    <>
                      <Group justify="center" gap={6}>
                        <ActionIcon
                          variant="light"
                          color="red"
                          size={deltaActionSizePx}
                          onClick={() => updatePlayerHealth(player.id, -5)}
                          aria-label={`Remove five health from ${player.name}`}
                        >
                          <IconMinus size={deltaIconSizePx} />
                        </ActionIcon>
                        <Button
                          variant="light"
                          color="red"
                          size={deltaButtonSize}
                          style={{ minWidth: playerCount <= 2 ? 96 : 76, fontSize: deltaButtonFontSize }}
                          onClick={() => updatePlayerHealth(player.id, -1)}
                        >
                          -1
                        </Button>
                        <Button
                          variant="light"
                          color="green"
                          size={deltaButtonSize}
                          style={{ minWidth: playerCount <= 2 ? 96 : 76, fontSize: deltaButtonFontSize }}
                          onClick={() => updatePlayerHealth(player.id, 1)}
                        >
                          +1
                        </Button>
                        <ActionIcon
                          variant="light"
                          color="green"
                          size={deltaActionSizePx}
                          onClick={() => updatePlayerHealth(player.id, 5)}
                          aria-label={`Add five health to ${player.name}`}
                        >
                          <IconPlus size={deltaIconSizePx} />
                        </ActionIcon>
                      </Group>

                      <Switch
                        checked={player.forceActive}
                        onChange={(event) => togglePlayerForce(player.id, event.currentTarget.checked)}
                        label="Activate the Force"
                      />
                    </>
                  )}
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>

        {isCompactDuelLayout ? null : <Divider my={4} />}

        <Card withBorder shadow="sm" p={isCompactDuelLayout ? 'xs' : 'sm'}>
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" wrap="wrap">
              <Text fw={700}>Round Clock</Text>
              <Text fw={700} size="xl">
                {formatClock(secondsLeft)}
              </Text>
              {isCompactDuelLayout ? null : (
                <NumberInput
                  label="Minutes"
                  min={1}
                  max={300}
                  allowDecimal={false}
                  value={roundMinutes}
                  onChange={(value) => setRoundMinutes(clampNumber(Number(value) || 1, 1, 300))}
                  w={110}
                  size="xs"
                />
              )}
            </Group>
            <Group>
              <Button
                size="xs"
                onClick={() => {
                  if (timerRunning) {
                    setTimerRunning(false);
                    return;
                  }
                  if (secondsLeft === 0) {
                    setSecondsLeft(roundMinutes * 60);
                  }
                  setTimerRunning(true);
                }}
                leftSection={timerRunning ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
                color={timerRunning ? 'red' : 'blue'}
              >
                {timerRunning ? 'Stop' : secondsLeft === 0 ? 'Restart' : 'Start'}
              </Button>
              <Button size="xs" variant="light" onClick={resetClock} leftSection={<IconRefresh size={14} />}>
                Reset
              </Button>
            </Group>
          </Group>
          <Progress
            mt="xs"
            value={timerPercent}
            color={secondsLeft <= 300 ? 'red' : 'blue'}
            size="md"
          />
        </Card>
      </Stack>
    </Layout>
  );
}
