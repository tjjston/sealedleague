import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  HoverCard,
  Image,
  Modal,
  MultiSelect,
  NumberInput,
  Pagination,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Textarea,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconPlus,
  IconSelector,
  IconTrash,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';

import { DateTime } from '@components/utils/datetime';
import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueCardPool,
  getLeagueCardsGlobal,
  getLeagueCards,
  getLeagueAdminUsers,
  getLeagueDecks,
  getLeagueMetaAnalysis,
  getLeagueSeasons,
  getTournamentApplications,
  getTournaments,
  getUser,
} from '@services/adapter';
import {
  deleteDeck,
  importDeckSwuDb,
  renameDeck,
  saveDeck,
  submitLeagueEntry,
  submitTournamentApplication,
  upsertCardPoolEntry,
} from '@services/league';

type CardItem = {
  card_id: string;
  set_code: string;
  name: string;
  character_variant?: string | null;
  number: string;
  type: string;
  rarity: string;
  cost: number | null;
  power?: number | null;
  hp?: number | null;
  aspects: string[];
  traits: string[];
  keywords: string[];
  arenas: string[];
  rules_text: string;
  image_url?: string | null;
};

type DeckGraphView =
  | 'cost'
  | 'type'
  | 'rarity'
  | 'aspect'
  | 'alignment'
  | 'out_aspect'
  | 'synergy'
  | 'arena'
  | 'power'
  | 'hp';
type AlignmentFilter = 'heroic' | 'villainy' | 'neither';
type CardSortKey =
  | 'name'
  | 'type'
  | 'rarity'
  | 'cost'
  | 'power'
  | 'hp'
  | 'aspects'
  | 'arena'
  | 'set'
  | 'pool';
type SortDirection = 'asc' | 'desc';
type AnalyticsSortBy = 'label' | 'value';
type RandomBaseAspect = 'aggression' | 'command' | 'cunning' | 'vigilance';
type LeaderBaseViewMode = 'main' | 'leaders_bases';

const HEROIC_ASPECT_VALUES = new Set(['heroic', 'heroism']);
const VILLAINY_ASPECT_VALUES = new Set(['villainy']);
const ASPECT_FILTER_NEUTRAL = 'Neutral';
const DEFAULT_ASPECT_OPTIONS = ['Aggression', 'Cunning', 'Command', 'Vigilance', ASPECT_FILTER_NEUTRAL];
const ASPECT_ICON_BY_KEY: Record<string, string> = {
  aggression: '/icons/aspects/aggression.png',
  command: '/icons/aspects/command.png',
  cunning: '/icons/aspects/cunning.png',
  vigilance: '/icons/aspects/vigilance.png',
  villainy: '/icons/aspects/villainy.png',
  heroic: '/icons/aspects/heroism.png',
  heroism: '/icons/aspects/heroism.png',
};
const DEFAULT_ROWS_PER_PAGE = 20;
const DEFAULT_VISIBLE_LINES = 20;
const MIN_VISIBLE_LINES = 8;
const MAX_VISIBLE_LINES = 80;
const TABLE_BASE_HEIGHT = 56;
const TABLE_ROW_HEIGHT = 40;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];
const CARD_LIST_ROWS_PER_PAGE_STORAGE_KEY = 'deckbuilder_card_list_rows_per_page';
const CARD_LIST_VISIBLE_LINES_STORAGE_KEY = 'deckbuilder_card_list_visible_lines';
const CARD_LIST_VISIBLE_LINES_MODE_STORAGE_KEY = 'deckbuilder_card_list_visible_lines_mode';
const ALL_DECK_OWNERS_VALUE = '__ALL__';
const ALL_SEASONS_VALUE = '__ALL_SEASONS__';
type CardListVisibleLinesMode = 'manual' | 'fit';
const RANDOM_BASE_OPTION_BY_ASPECT: Record<RandomBaseAspect, { value: string; label: string }> = {
  aggression: {
    value: '__RANDOM_BASE_AGGRESSION__',
    label: 'Random 30 HP Aggressive Base',
  },
  command: {
    value: '__RANDOM_BASE_COMMAND__',
    label: 'Random 30 HP Command Base',
  },
  cunning: {
    value: '__RANDOM_BASE_CUNNING__',
    label: 'Random 30 HP Cunning Base',
  },
  vigilance: {
    value: '__RANDOM_BASE_VIGILANCE__',
    label: 'Random 30 HP Vigilance Base',
  },
};
const RANDOM_BASE_OPTIONS = [
  RANDOM_BASE_OPTION_BY_ASPECT.cunning,
  RANDOM_BASE_OPTION_BY_ASPECT.aggression,
  RANDOM_BASE_OPTION_BY_ASPECT.vigilance,
  RANDOM_BASE_OPTION_BY_ASPECT.command,
];
const RANDOM_BASE_ASPECT_BY_VALUE: Record<string, RandomBaseAspect> = {
  [RANDOM_BASE_OPTION_BY_ASPECT.aggression.value]: 'aggression',
  [RANDOM_BASE_OPTION_BY_ASPECT.command.value]: 'command',
  [RANDOM_BASE_OPTION_BY_ASPECT.cunning.value]: 'cunning',
  [RANDOM_BASE_OPTION_BY_ASPECT.vigilance.value]: 'vigilance',
};
const ALIGNMENT_OPTIONS: Array<{ value: AlignmentFilter; label: string }> = [
  { value: 'heroic', label: 'Heroic' },
  { value: 'villainy', label: 'Villainy' },
  { value: 'neither', label: 'Neither' },
];

function countCards(deck: Record<string, number>) {
  return Object.values(deck).reduce((sum, count) => sum + count, 0);
}

function normalizeSet(values: string[] | undefined) {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
}

function isLeaderOrBase(card: CardItem | null | undefined) {
  if (card == null) return false;
  const normalized = card.type.toLowerCase();
  return normalized === 'leader' || normalized === 'base';
}

function aggregateCountMap(entries: Array<[string, number]>) {
  const map: Record<string, number> = {};
  entries.forEach(([key, qty]) => {
    map[key] = (map[key] ?? 0) + qty;
  });
  return map;
}

function combineBoardQuantities(
  main: Record<string, number> | null | undefined,
  side: Record<string, number> | null | undefined
) {
  const totals: Record<string, number> = {};
  Object.entries(main ?? {}).forEach(([cardId, qty]) => {
    const numeric = Number(qty ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    totals[cardId] = (totals[cardId] ?? 0) + Math.trunc(numeric);
  });
  Object.entries(side ?? {}).forEach(([cardId, qty]) => {
    const numeric = Number(qty ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    totals[cardId] = (totals[cardId] ?? 0) + Math.trunc(numeric);
  });
  return totals;
}

function parseCardNumber(value: string | null | undefined) {
  if (value == null) return Number.NEGATIVE_INFINITY;
  const cleaned = String(value).trim();
  const numeric = Number(cleaned);
  if (Number.isFinite(numeric)) return numeric;
  const match = cleaned.match(/\d+/);
  return match != null ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function clampVisibleLines(value: number) {
  return Math.max(MIN_VISIBLE_LINES, Math.min(MAX_VISIBLE_LINES, Math.trunc(value)));
}

function getTableHeightFromVisibleLines(
  visibleLines: number,
  options?: { clamp?: boolean }
) {
  const shouldClamp = options?.clamp !== false;
  const normalizedLines = shouldClamp
    ? clampVisibleLines(visibleLines)
    : Math.max(0, Math.trunc(Number(visibleLines) || 0));
  return TABLE_BASE_HEIGHT + normalizedLines * TABLE_ROW_HEIGHT;
}

function normalizePageSize(value: number) {
  const normalized = Math.trunc(value);
  return PAGE_SIZE_OPTIONS.includes(normalized) ? normalized : DEFAULT_ROWS_PER_PAGE;
}

function getStoredNumber(key: string) {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key);
  if (raw == null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getStoredVisibleLinesMode(): CardListVisibleLinesMode {
  if (typeof window === 'undefined') return 'manual';
  const raw = String(window.localStorage.getItem(CARD_LIST_VISIBLE_LINES_MODE_STORAGE_KEY) ?? '').trim().toLowerCase();
  return raw === 'fit' ? 'fit' : 'manual';
}

function normalizeCardIdLookupKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function removeNumericPaddingFromCardId(value: string | null | undefined) {
  const normalized = normalizeCardIdLookupKey(value).replace(/--+/g, '-').replace(/^-+|-+$/g, '');
  const match = normalized.match(/^([a-z]+)-(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  const [, setCode, number, suffix] = match;
  const trimmedNumber = String(Number(number));
  return `${setCode}-${trimmedNumber}${suffix}`;
}

function buildCardLookupKeys(value: string | null | undefined) {
  const raw = String(value ?? '').trim().toLowerCase();
  const normalized = normalizeCardIdLookupKey(value).replace(/--+/g, '-').replace(/^-+|-+$/g, '');
  const noPadding = removeNumericPaddingFromCardId(value);
  return [raw, normalized, noPadding].filter((item, index, all) => item !== '' && all.indexOf(item) === index);
}

function normalizeLooseCardId(value: string | null | undefined) {
  const noPadding = removeNumericPaddingFromCardId(value);
  if (noPadding !== '') return noPadding;
  return normalizeCardIdLookupKey(value).replace(/--+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeBoardEntries(
  entries: Record<string, number> | null | undefined,
  resolveCatalogCardId: (value: string | null | undefined) => string
) {
  const result: Record<string, number> = {};
  Object.entries(entries ?? {}).forEach(([rawCardId, rawQty]) => {
    const qty = Number(rawQty ?? 0);
    if (!Number.isFinite(qty)) return;
    const normalizedQty = Math.max(0, Math.min(99, Math.trunc(qty)));
    if (normalizedQty <= 0) return;
    const resolvedCatalogId = resolveCatalogCardId(rawCardId);
    const normalizedCardId =
      resolvedCatalogId !== '' ? resolvedCatalogId : normalizeLooseCardId(rawCardId);
    if (normalizedCardId === '') return;
    result[normalizedCardId] = (result[normalizedCardId] ?? 0) + normalizedQty;
  });
  return result;
}

function boardEntriesEqual(
  left: Record<string, number> | null | undefined,
  right: Record<string, number> | null | undefined
) {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([cardId, qty]) => Number(right?.[cardId] ?? NaN) === Number(qty ?? 0));
}

function normalizeAspectKey(value: string) {
  return value.trim().toLowerCase();
}

function isAlignmentFilter(value: string): value is AlignmentFilter {
  return value === 'heroic' || value === 'villainy' || value === 'neither';
}

function resolveAlignmentForAspects(aspects: string[] | null | undefined): AlignmentFilter {
  const normalizedAspects = (aspects ?? []).map((value) => String(value).trim().toLowerCase());
  const hasHeroic = normalizedAspects.some((value) => HEROIC_ASPECT_VALUES.has(value));
  const hasVillainy = normalizedAspects.some((value) => VILLAINY_ASPECT_VALUES.has(value));
  if (hasVillainy) return 'villainy';
  if (hasHeroic) return 'heroic';
  return 'neither';
}

function AspectIcons({ aspects }: { aspects: string[] }) {
  if (aspects.length < 1) return <Text size="sm">-</Text>;
  return (
    <Group gap={6} wrap="wrap">
      {aspects.map((aspect) => {
        const key = normalizeAspectKey(aspect);
        const iconPath = ASPECT_ICON_BY_KEY[key];
        return (
          <Group key={`${aspect}-${iconPath ?? 'no-icon'}`} gap={4} wrap="nowrap">
            {iconPath != null ? (
              <img
                src={iconPath}
                alt={aspect}
                width={14}
                height={14}
                style={{ objectFit: 'contain' }}
              />
            ) : null}
            <Text size="xs">{aspect}</Text>
          </Group>
        );
      })}
    </Group>
  );
}

function GraphBars({
  data,
  total,
  emptyMessage,
  sortBy = 'value',
  sortDirection = 'desc',
}: {
  data: Array<{ label: string; value: number }>;
  total: number;
  emptyMessage?: string;
  sortBy?: AnalyticsSortBy;
  sortDirection?: SortDirection;
}) {
  if (data.length < 1 || total <= 0) {
    return (
      <Text size="sm" c="dimmed">
        {emptyMessage ?? 'Add cards to your deck to see analytics.'}
      </Text>
    );
  }

  const sortedData = [...data].sort((left, right) => {
    if (sortBy === 'label') {
      const labelDiff = compareText(left.label, right.label);
      if (labelDiff !== 0) return sortDirection === 'asc' ? labelDiff : -labelDiff;
      const valueDiff = left.value - right.value;
      return sortDirection === 'asc' ? valueDiff : -valueDiff;
    }

    const valueDiff = left.value - right.value;
    if (valueDiff !== 0) return sortDirection === 'asc' ? valueDiff : -valueDiff;
    const labelDiff = compareText(left.label, right.label);
    return sortDirection === 'asc' ? labelDiff : -labelDiff;
  });

  return (
    <Stack>
      {sortedData.map((row) => (
        <Stack key={row.label} gap={4}>
          <Group justify="space-between" gap="xs">
            <Text size="sm">{row.label}</Text>
            <Text size="xs" c="dimmed">
              {row.value}
            </Text>
          </Group>
          <Progress value={(row.value / total) * 100} />
        </Stack>
      ))}
    </Stack>
  );
}

function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText != null) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back below for browsers with restricted clipboard API contexts.
    }
  }

  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-10000px';
    textarea.style.left = '-10000px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function sanitizeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toSwudbCardId(cardId: unknown) {
  const normalized = String(cardId ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === '') return '';

  const separatorIndex = normalized.indexOf('-');
  if (separatorIndex < 1 || separatorIndex >= normalized.length - 1) {
    return normalized.replace(/-/g, '_').toUpperCase();
  }

  const setCode = normalized.slice(0, separatorIndex);
  const remainder = normalized.slice(separatorIndex + 1);
  const firstToken = remainder.split('-', 1)[0].trim();
  const parsed = firstToken.match(/^0*(\d+)([a-z]*)$/i);
  if (parsed == null) {
    return `${setCode}_${remainder}`.toUpperCase();
  }

  const number = Number(parsed[1]);
  const rawSuffix = String(parsed[2] ?? '').toLowerCase();
  const suffix = rawSuffix === 'f' ? '' : rawSuffix;
  return `${setCode}_${String(number).padStart(3, '0')}${suffix}`.toUpperCase();
}

function buildSwudbCardPoolEntries(
  rows: Array<{ card_id?: string | null; quantity?: number | null }>
) {
  const aggregated: Record<string, number> = {};
  rows.forEach((row) => {
    const normalizedId = toSwudbCardId(row.card_id);
    const quantity = Math.max(0, Math.trunc(Number(row.quantity ?? 0)));
    if (normalizedId === '' || quantity <= 0) return;
    aggregated[normalizedId] = (aggregated[normalizedId] ?? 0) + quantity;
  });
  return Object.entries(aggregated)
    .sort((left, right) => compareText(left[0], right[0]))
    .map(([id, count]) => ({ id, count }));
}

function buildSwudbDeckClipboardPayload(params: {
  name: string;
  author?: string | null;
  leaderCardId: string;
  baseCardId: string;
  mainboard: Record<string, number>;
  sideboard: Record<string, number>;
}) {
  const metadata: Record<string, string> = { name: params.name };
  const author = String(params.author ?? '').trim();
  if (author !== '') {
    metadata.author = author;
  }
  return {
    metadata,
    leader: { id: toSwudbCardId(params.leaderCardId), count: 1 as const },
    base: { id: toSwudbCardId(params.baseCardId), count: 1 as const },
    deck: buildSwudbCardPoolEntries(
      Object.entries(params.mainboard).map(([card_id, quantity]) => ({ card_id, quantity }))
    ),
    sideboard: buildSwudbCardPoolEntries(
      Object.entries(params.sideboard).map(([card_id, quantity]) => ({ card_id, quantity }))
    ),
  };
}

export default function DeckbuilderPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const { tournamentData } = getTournamentIdFromRouter();
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];

  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedTargetUserId, setSelectedTargetUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!standalone || tournaments.length < 1 || selectedTournamentId != null) return;
    const requestedTournamentId = new URLSearchParams(window.location.search).get('tournament_id');
    const saved = window.localStorage.getItem('league_default_tournament_id');
    const preferredTournamentId = requestedTournamentId ?? saved;
    const selected =
      tournaments.find((t: any) => String(t.id) === preferredTournamentId) ?? tournaments[0];
    if (selected == null) return;
    setSelectedTournamentId(String(selected.id));
    window.localStorage.setItem('league_default_tournament_id', String(selected.id));
  }, [standalone, tournaments, selectedTournamentId]);

  const activeTournamentId = standalone
    ? Number(selectedTournamentId ?? 0)
    : tournamentData.id;
  const hasTournament = Number.isFinite(activeTournamentId) && activeTournamentId > 0;
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);

  const swrCurrentUserResponse = getUser();
  const isAdmin = String(swrCurrentUserResponse.data?.data?.account_type ?? 'REGULAR') === 'ADMIN';
  const swrAdminUsersResponse = getLeagueAdminUsers(
    isAdmin && hasTournament ? activeTournamentId : null,
    null,
    true
  );
  const adminUsers = swrAdminUsersResponse.data?.data ?? [];
  const targetUserId =
    isAdmin &&
    selectedTargetUserId != null &&
    selectedTargetUserId !== '' &&
    selectedTargetUserId !== ALL_DECK_OWNERS_VALUE
      ? Number(selectedTargetUserId)
      : null;
  const isAdminAllOwnersView = isAdmin && targetUserId == null;
  const currentUserId = Number(swrCurrentUserResponse.data?.data?.id ?? 0);
  const swrSeasonsResponse = getLeagueSeasons(hasTournament ? activeTournamentId : null);
  const seasons = swrSeasonsResponse.data?.data ?? [];
  const seasonOptions = useMemo(() => {
    const byId = new Map<number, any>();
    for (const season of seasons) {
      const seasonId = Number(season?.season_id ?? 0);
      if (!Number.isInteger(seasonId) || seasonId <= 0) continue;
      const existing = byId.get(seasonId);
      if (existing == null) {
        byId.set(seasonId, season);
        continue;
      }
      const existingIsActive = Boolean(existing?.is_active);
      const candidateIsActive = Boolean(season?.is_active);
      if (!existingIsActive && candidateIsActive) {
        byId.set(seasonId, season);
        continue;
      }
      if (existingIsActive === candidateIsActive) {
        byId.set(seasonId, season);
      }
    }

    return [...byId.values()].sort(
      (left: any, right: any) => Number(left?.season_id ?? 0) - Number(right?.season_id ?? 0)
    );
  }, [seasons]);
  const seasonNameCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    seasonOptions.forEach((season: any) => {
      const key = String(season?.name ?? '').trim().toLowerCase();
      if (key === '') return;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [seasonOptions]);

  useEffect(() => {
    setSelectedSeasonId(ALL_SEASONS_VALUE);
    setSelectedTargetUserId(null);
  }, [activeTournamentId, isAdmin]);

  useEffect(() => {
    if (!hasTournament || seasonOptions.length < 1) return;
    if (selectedSeasonId == null || selectedSeasonId === ALL_SEASONS_VALUE) return;
    const selectedExists = seasonOptions.some(
      (season: any) => String(season.season_id) === selectedSeasonId
    );
    if (selectedExists) return;
    setSelectedSeasonId(ALL_SEASONS_VALUE);
  }, [hasTournament, seasonOptions, selectedSeasonId]);

  const selectedSeasonNumber =
    selectedSeasonId != null &&
    selectedSeasonId !== '' &&
    selectedSeasonId !== ALL_SEASONS_VALUE
      ? Number(selectedSeasonId)
      : null;
  const activeSeasonNumber =
    seasonOptions.find((season: any) => Boolean(season?.is_active))?.season_id ?? null;
  const seasonForMetaAnalysis = selectedSeasonNumber ?? activeSeasonNumber;

  useEffect(() => {
    if (!isAdmin || !hasTournament || adminUsers.length < 1) return;
    if (selectedTargetUserId === ALL_DECK_OWNERS_VALUE) return;
    const searchParams = new URLSearchParams(window.location.search);
    const queryTarget = searchParams.get('user_id');
    const queryTeamName = searchParams.get('team_name')?.trim().toLowerCase();
    const hasCurrentSelection = adminUsers.some(
      (row: any) => String(row.user_id) === String(selectedTargetUserId)
    );
    if (hasCurrentSelection) return;
    const selectedFromQuery =
      queryTarget != null
        ? adminUsers.find((row: any) => String(row.user_id) === queryTarget)
        : null;
    const selectedFromTeamName =
      queryTeamName != null && queryTeamName !== ''
        ? adminUsers.find((row: any) => String(row.user_name ?? '').trim().toLowerCase() === queryTeamName)
        : null;
    const fallback = selectedFromQuery ?? selectedFromTeamName;
    if (fallback != null) {
      setSelectedTargetUserId(String(fallback.user_id));
      return;
    }
    if (!Number.isFinite(currentUserId) || currentUserId <= 0) return;
    const selectedAdminSelf = adminUsers.find(
      (row: any) => Number(row.user_id) === Number(currentUserId)
    );
    if (selectedAdminSelf != null) {
      setSelectedTargetUserId(String(selectedAdminSelf.user_id));
      return;
    }
    const firstPlayer = adminUsers.find(
      (row: any) => String(row.account_type ?? '').toUpperCase() !== 'ADMIN'
    );
    if (firstPlayer != null) {
      setSelectedTargetUserId(String(firstPlayer.user_id));
      return;
    }
    setSelectedTargetUserId(String(adminUsers[0].user_id));
  }, [
    adminUsers,
    currentUserId,
    hasTournament,
    isAdmin,
    selectedTargetUserId,
  ]);

  const swrCatalogResponse = hasTournament
    ? getLeagueCards(activeTournamentId, {
        limit: 5000,
        offset: 0,
      })
    : getLeagueCardsGlobal({
        limit: 5000,
        offset: 0,
      });
  const swrCardPoolResponse = getLeagueCardPool(
    hasTournament ? activeTournamentId : null,
    targetUserId,
    selectedSeasonNumber
  );
  const swrDecksResponse = getLeagueDecks(
    hasTournament ? activeTournamentId : null,
    targetUserId,
    selectedSeasonNumber
  );
  const swrApplicationsResponse = getTournamentApplications(
    hasTournament ? activeTournamentId : null,
    isAdmin ? 'admin' : 'me'
  );
  const swrMetaAnalysisResponse = getLeagueMetaAnalysis(
    hasTournament ? activeTournamentId : null,
    seasonForMetaAnalysis != null ? Number(seasonForMetaAnalysis) : null
  );

  const allCards: CardItem[] = swrCatalogResponse.data?.data?.cards ?? [];
  const decks = swrDecksResponse.data?.data ?? [];
  const tournamentApplications = swrApplicationsResponse.data?.data ?? [];
  const cardPoolEntries = swrCardPoolResponse.data?.data ?? [];
  const metaAnalysis = swrMetaAnalysisResponse.data?.data ?? null;

  const currentDeckIdByUserId = useMemo(() => {
    return (tournamentApplications as any[]).reduce((result: Record<number, number>, application: any) => {
      const userId = Number(application?.user_id ?? 0);
      const deckId = Number(application?.deck_id ?? 0);
      if (!Number.isFinite(userId) || userId <= 0) return result;
      if (!Number.isFinite(deckId) || deckId <= 0) return result;
      result[userId] = deckId;
      return result;
    }, {});
  }, [tournamentApplications]);
  const applicationByUserId = useMemo(() => {
    return (tournamentApplications as any[]).reduce((result: Record<number, any>, application: any) => {
      const userId = Number(application?.user_id ?? 0);
      if (!Number.isFinite(userId) || userId <= 0 || result[userId] != null) return result;
      result[userId] = application;
      return result;
    }, {});
  }, [tournamentApplications]);
  const managedUserId =
    isAdmin
      ? targetUserId
      : Number.isFinite(currentUserId) && currentUserId > 0
        ? currentUserId
        : null;
  const managedUserApplication =
    managedUserId != null ? (applicationByUserId[managedUserId] ?? null) : null;
  const managedUserCurrentDeckId =
    managedUserId != null ? (currentDeckIdByUserId[managedUserId] ?? null) : null;
  const managedUserCurrentDeck =
    managedUserCurrentDeckId != null
      ? ((decks as any[]).find((deck: any) => Number(deck?.id ?? 0) === Number(managedUserCurrentDeckId)) ??
        null)
      : null;

  const cardsById = useMemo(() => {
    return (allCards as CardItem[]).reduce((result: Record<string, CardItem>, card: CardItem) => {
      result[card.card_id] = card;
      return result;
    }, {});
  }, [allCards]);

  const cardIdByLookupKey = useMemo(() => {
    return (allCards as CardItem[]).reduce((result: Record<string, string>, card: CardItem) => {
      buildCardLookupKeys(card.card_id).forEach((key) => {
        result[key] = card.card_id;
      });
      return result;
    }, {});
  }, [allCards]);
  function resolveCatalogCardId(value: string | null | undefined) {
    const lookupKey = buildCardLookupKeys(value).find((candidate) => cardIdByLookupKey[candidate] != null);
    return lookupKey == null ? '' : (cardIdByLookupKey[lookupKey] ?? '');
  }
  function resolveCardDisplayName(value: string | null | undefined) {
    const raw = String(value ?? '').trim();
    if (raw === '') return '-';
    const resolvedId = resolveCatalogCardId(raw);
    if (resolvedId !== '' && cardsById[resolvedId]?.name != null) {
      return cardsById[resolvedId].name;
    }
    return normalizeLooseCardId(raw);
  }

  const cardPoolMap = useMemo(() => {
    return (cardPoolEntries as any[]).reduce((result: Record<string, number>, entry: any) => {
      const rawCardId = String(entry?.card_id ?? '').trim();
      const resolvedCatalogId = resolveCatalogCardId(rawCardId);
      const cardId = resolvedCatalogId !== '' ? resolvedCatalogId : normalizeLooseCardId(rawCardId);
      if (cardId === '') return result;
      const quantity = Number(entry?.quantity ?? 0);
      if (!Number.isFinite(quantity)) return result;
      if (isAdminAllOwnersView) {
        result[cardId] = (result[cardId] ?? 0) + Math.trunc(quantity);
      } else {
        result[cardId] = Math.trunc(quantity);
      }
      return result;
    }, {});
  }, [cardIdByLookupKey, cardPoolEntries, isAdminAllOwnersView]);
  const normalizedCardPoolMap = useMemo(() => {
    return Object.entries(cardPoolMap).reduce((result: Record<string, number>, [cardId, quantity]) => {
      buildCardLookupKeys(cardId).forEach((lookupKey) => {
        result[lookupKey] = (result[lookupKey] ?? 0) + Number(quantity ?? 0);
      });
      return result;
    }, {});
  }, [cardPoolMap]);
  function getPoolQuantity(cardId: string) {
    const directQuantity = cardPoolMap[cardId];
    if (directQuantity != null) return directQuantity;
    const resolvedCatalogId = resolveCatalogCardId(cardId);
    if (resolvedCatalogId !== '' && cardPoolMap[resolvedCatalogId] != null) {
      return cardPoolMap[resolvedCatalogId] ?? 0;
    }
    return buildCardLookupKeys(cardId).reduce(
      (maxQty, lookupKey) => Math.max(maxQty, normalizedCardPoolMap[lookupKey] ?? 0),
      0
    );
  }

  const [query, setQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [rulesQuery, setRulesQuery] = useState('');
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const [selectedAlignments, setSelectedAlignments] = useState<AlignmentFilter[]>([]);
  const [cardSortKey, setCardSortKey] = useState<CardSortKey>('set');
  const [cardSortDirection, setCardSortDirection] = useState<SortDirection>('desc');
  const [selectedCosts, setSelectedCosts] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [arenaFilter, setArenaFilter] = useState<string | null>(null);
  const [leaderBaseViewMode, setLeaderBaseViewMode] = useState<LeaderBaseViewMode>('main');

  const [showCardImage, setShowCardImage] = useState(false);
  const [onlyLegalCards, setOnlyLegalCards] = useState(false);
  const [onlyCardsInPool, setOnlyCardsInPool] = useState(false);
  const [showPoolWarnings, setShowPoolWarnings] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageLabel, setPreviewImageLabel] = useState<string>('');
  const [cardListRowsPerPage, setCardListRowsPerPage] = useState<number>(() =>
    normalizePageSize(getStoredNumber(CARD_LIST_ROWS_PER_PAGE_STORAGE_KEY) ?? DEFAULT_ROWS_PER_PAGE)
  );
  const [cardListPage, setCardListPage] = useState<number>(1);
  const [cardListVisibleLines, setCardListVisibleLines] = useState<number>(() =>
    clampVisibleLines(getStoredNumber(CARD_LIST_VISIBLE_LINES_STORAGE_KEY) ?? DEFAULT_VISIBLE_LINES)
  );
  const [cardListVisibleLinesMode, setCardListVisibleLinesMode] = useState<CardListVisibleLinesMode>(() =>
    getStoredVisibleLinesMode()
  );

  const [deckName, setDeckName] = useState('League Deck');
  const [leaderCardId, setLeaderCardId] = useState<string | null>(null);
  const [baseCardId, setBaseCardId] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<Record<string, number>>({});
  const [sideboard, setSideboard] = useState<Record<string, number>>({});

  const [graphView, setGraphView] = useState<DeckGraphView>('cost');
  const [analyticsScope, setAnalyticsScope] = useState<'deck' | 'pool'>('deck');
  const [analyticsSortBy, setAnalyticsSortBy] = useState<AnalyticsSortBy>('value');
  const [analyticsSortDirection, setAnalyticsSortDirection] = useState<SortDirection>('desc');
  const [swudbImportJson, setSwudbImportJson] = useState('');

  useEffect(() => {
    setMainboard((prev) => {
      const next = normalizeBoardEntries(prev, resolveCatalogCardId);
      return boardEntriesEqual(prev, next) ? prev : next;
    });
    setSideboard((prev) => {
      const next = normalizeBoardEntries(prev, resolveCatalogCardId);
      return boardEntriesEqual(prev, next) ? prev : next;
    });
  }, [cardIdByLookupKey]);

  const typeOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards
            .map((card: CardItem) => card.type)
            .filter((value) => {
              const normalized = String(value ?? '').trim().toLowerCase();
              if (normalized === '') return false;
              return normalized !== 'leader' && normalized !== 'base';
            })
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value })),
    [allCards]
  );

  const setOptions = useMemo(
    () =>
      [...new Set(allCards.map((card: CardItem) => card.set_code).filter((value) => value != null && value !== ''))]
        .sort()
        .map((value) => ({ value, label: value.toUpperCase() })),
    [allCards]
  );

  const rarityOptions = useMemo(
    () =>
      [...new Set(allCards.map((card: CardItem) => card.rarity).filter((value) => value != null && value !== ''))]
        .sort()
        .map((value) => ({ value, label: value })),
    [allCards]
  );

  const arenaOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards
            .flatMap((card: CardItem) => card.arenas ?? [])
            .map((value) => value.trim())
            .filter((value) => value !== '')
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value })),
    [allCards]
  );

  const traitOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards
            .flatMap((card: CardItem) => card.traits ?? [])
            .map((value) => value.trim())
            .filter((value) => value !== '')
        ),
      ]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [allCards]
  );

  const keywordOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards
            .flatMap((card: CardItem) => card.keywords ?? [])
            .map((value) => value.trim())
            .filter((value) => value !== '')
        ),
      ]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value })),
    [allCards]
  );

  const costOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards
            .map((card: CardItem) => card.cost)
            .filter((value): value is number => value != null)
        ),
      ]
        .sort((a, b) => a - b)
        .map((value) => ({ value: String(value), label: String(value) })),
    [allCards]
  );

  const aspectOptions = useMemo(() => {
    const derived = [
      ...new Set(
        allCards
          .flatMap((card: CardItem) => card.aspects ?? [])
          .map((value) => value.trim())
          .filter((value) => value !== '')
          .filter((value) => {
            const normalized = value.toLowerCase();
            return !HEROIC_ASPECT_VALUES.has(normalized) && !VILLAINY_ASPECT_VALUES.has(normalized);
          })
      ),
    ];

    return [...new Set([...DEFAULT_ASPECT_OPTIONS, ...derived])]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [allCards]);

  const leaderOptions = useMemo(
    () =>
      allCards
        .filter((card: CardItem) => card.type.toLowerCase() === 'leader')
        .map((card: CardItem) => ({
          value: card.card_id,
          label: `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''} (${card.set_code.toUpperCase()})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [allCards]
  );

  const baseOptions = useMemo(
    () =>
      allCards
        .filter((card: CardItem) => card.type.toLowerCase() === 'base')
        .map((card: CardItem) => ({
          value: card.card_id,
          label: `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''} (${card.set_code.toUpperCase()})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [allCards]
  );
  const baseSelectOptions = useMemo(
    () => [...RANDOM_BASE_OPTIONS, ...baseOptions],
    [baseOptions]
  );
  const random30HpBasesByAspect = useMemo(() => {
    const result: Record<RandomBaseAspect, CardItem[]> = {
      aggression: [],
      command: [],
      cunning: [],
      vigilance: [],
    };

    allCards
      .filter((card: CardItem) => card.type.toLowerCase() === 'base')
      .forEach((card: CardItem) => {
        const hp = Number(card.hp ?? NaN);
        if (!Number.isFinite(hp) || Math.trunc(hp) !== 30) return;
        const aspectSet = new Set((card.aspects ?? []).map((aspect) => normalizeAspectKey(aspect)));
        (Object.keys(result) as RandomBaseAspect[]).forEach((aspect) => {
          if (aspectSet.has(aspect)) {
            result[aspect].push(card);
          }
        });
      });

    return result;
  }, [allCards]);

  const leaderCard = cardsById[leaderCardId ?? ''];
  const baseCard = cardsById[baseCardId ?? ''];

  const allowedAspects = useMemo(() => {
    const leaderAspects = normalizeSet(leaderCard?.aspects);
    const baseAspects = normalizeSet(baseCard?.aspects);
    return new Set([...leaderAspects, ...baseAspects]);
  }, [leaderCard, baseCard]);

  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedName = nameQuery.trim().toLowerCase();
    const normalizedRules = rulesQuery.trim().toLowerCase();
    const selectedAspectSet = new Set(selectedAspects.map((value) => value.trim().toLowerCase()).filter((value) => value !== ''));
    const selectedTypeSet = new Set(selectedTypes);
    const selectedRaritySet = new Set(selectedRarities);
    const selectedSetSet = new Set(selectedSets);
    const selectedCostSet = new Set(selectedCosts.map((value) => Number(value)));
    const selectedTraitSet = new Set(selectedTraits.map((value) => value.toLowerCase()));
    const selectedKeywordSet = new Set(selectedKeywords.map((value) => value.toLowerCase()));
    const selectedAlignmentSet = new Set(selectedAlignments);

    return allCards
      .filter((card: CardItem) => {
        const name = card.name.toLowerCase();
        const variant = (card.character_variant ?? '').toLowerCase();
        const rules = (card.rules_text ?? '').toLowerCase();
        const type = card.type.toLowerCase();
        const aspects = (card.aspects ?? []).map((value) => value.toLowerCase());
        const hasHeroic = aspects.some((value) => HEROIC_ASPECT_VALUES.has(value));
        const hasVillainy = aspects.some((value) => VILLAINY_ASPECT_VALUES.has(value));
        const nonAlignmentAspects = aspects.filter(
          (value) => !HEROIC_ASPECT_VALUES.has(value) && !VILLAINY_ASPECT_VALUES.has(value)
        );
        const traits = (card.traits ?? []).map((value) => value.toLowerCase());
        const keywords = (card.keywords ?? []).map((value) => value.toLowerCase());
        const arenas = (card.arenas ?? []).map((value) => value.toLowerCase());
        const rarity = (card.rarity ?? '').toLowerCase();
        const isLeaderCard = type === 'leader';
        const isBaseCard = type === 'base';

        if (leaderBaseViewMode === 'main' && (isLeaderCard || isBaseCard)) return false;
        if (leaderBaseViewMode === 'leaders_bases' && !isLeaderCard && !isBaseCard) return false;

        if (normalizedQuery !== '') {
          const haystack = `${name} ${variant} ${rules} ${type} ${rarity} ${aspects.join(' ')} ${traits.join(' ')} ${keywords.join(' ')} ${arenas.join(' ')} ${card.card_id.toLowerCase()}`;
          if (!haystack.includes(normalizedQuery)) return false;
        }
        if (
          normalizedName !== '' &&
          !name.includes(normalizedName) &&
          !variant.includes(normalizedName)
        ) {
          return false;
        }
        if (normalizedRules !== '' && !rules.includes(normalizedRules)) return false;
        if (
          selectedKeywordSet.size > 0 &&
          !keywords.some((value) => selectedKeywordSet.has(value))
        ) {
          return false;
        }
        if (selectedTraitSet.size > 0 && !traits.some((value) => selectedTraitSet.has(value))) {
          return false;
        }
        if (selectedAspectSet.size > 0) {
          const includeNeutral = selectedAspectSet.has(ASPECT_FILTER_NEUTRAL.toLowerCase());
          const matchesNeutral = includeNeutral && !hasHeroic && !hasVillainy && nonAlignmentAspects.length < 1;
          const matchesAspect = aspects.some((value) => selectedAspectSet.has(value));
          if (!matchesNeutral && !matchesAspect) {
            return false;
          }
        }
        if (selectedAlignmentSet.size > 0) {
          const alignment: AlignmentFilter = hasVillainy
            ? 'villainy'
            : hasHeroic
              ? 'heroic'
              : 'neither';
          if (!selectedAlignmentSet.has(alignment)) {
            return false;
          }
        }
        if (selectedCostSet.size > 0 && (card.cost == null || !selectedCostSet.has(card.cost))) {
          return false;
        }
        if (leaderBaseViewMode === 'main' && selectedTypeSet.size > 0 && !selectedTypeSet.has(card.type)) return false;
        if (selectedRaritySet.size > 0 && !selectedRaritySet.has(card.rarity)) return false;
        if (selectedSetSet.size > 0 && !selectedSetSet.has(card.set_code)) return false;
        if (arenaFilter != null && !(card.arenas ?? []).includes(arenaFilter)) return false;
        if (onlyCardsInPool && getPoolQuantity(card.card_id) <= 0) return false;

        if (onlyLegalCards) {
          if (allowedAspects.size < 1) return false;
          const cardAspects = (card.aspects ?? []).map((value) => value.toLowerCase());
          if (cardAspects.some((value) => !allowedAspects.has(value))) return false;
        }

        return true;
      });
  }, [
    allCards,
    query,
    nameQuery,
    rulesQuery,
    selectedKeywords,
    selectedTraits,
    selectedAspects,
    selectedAlignments,
    selectedCosts,
    selectedTypes,
    selectedRarities,
    selectedSets,
    arenaFilter,
    leaderBaseViewMode,
    onlyCardsInPool,
    cardPoolMap,
    onlyLegalCards,
    allowedAspects,
  ]);

  const sortedFilteredCards = useMemo(() => {
    const defaultSort = (a: CardItem, b: CardItem) => {
      const setSort = compareText(b.set_code, a.set_code);
      if (setSort !== 0) return setSort;
      const numberSort = parseCardNumber(b.number) - parseCardNumber(a.number);
      if (numberSort !== 0) return numberSort;
      const nameSort = compareText(a.name, b.name);
      if (nameSort !== 0) return nameSort;
      return compareText(a.character_variant ?? '', b.character_variant ?? '');
    };

    const sorted = [...filteredCards].sort((a, b) => {
      let sortValue = 0;

      if (cardSortKey === 'name') {
        sortValue = compareText(
          `${a.name} ${a.character_variant ?? ''}`.trim(),
          `${b.name} ${b.character_variant ?? ''}`.trim()
        );
      } else if (cardSortKey === 'type') {
        sortValue = compareText(a.type ?? '', b.type ?? '');
      } else if (cardSortKey === 'rarity') {
        sortValue = compareText(a.rarity ?? '', b.rarity ?? '');
      } else if (cardSortKey === 'cost') {
        sortValue = (a.cost ?? -1) - (b.cost ?? -1);
      } else if (cardSortKey === 'power') {
        sortValue = (a.power ?? -1) - (b.power ?? -1);
      } else if (cardSortKey === 'hp') {
        sortValue = (a.hp ?? -1) - (b.hp ?? -1);
      } else if (cardSortKey === 'aspects') {
        sortValue = compareText((a.aspects ?? []).join(', '), (b.aspects ?? []).join(', '));
      } else if (cardSortKey === 'arena') {
        sortValue = compareText((a.arenas ?? []).join(', '), (b.arenas ?? []).join(', '));
      } else if (cardSortKey === 'set') {
        sortValue = compareText(a.set_code, b.set_code);
        if (sortValue === 0) {
          sortValue = parseCardNumber(a.number) - parseCardNumber(b.number);
        }
      } else if (cardSortKey === 'pool') {
        sortValue = getPoolQuantity(a.card_id) - getPoolQuantity(b.card_id);
      }

      if (sortValue === 0) return defaultSort(a, b);
      return cardSortDirection === 'asc' ? sortValue : -sortValue;
    });

    return sorted;
  }, [filteredCards, cardSortKey, cardSortDirection, cardPoolMap]);

  const cappedFilteredCards = sortedFilteredCards;
  const cardListTotalPages = useMemo(
    () => Math.max(1, Math.ceil(cappedFilteredCards.length / cardListRowsPerPage)),
    [cappedFilteredCards, cardListRowsPerPage]
  );
  const visibleFilteredCards = useMemo(() => {
    const start = (cardListPage - 1) * cardListRowsPerPage;
    return cappedFilteredCards.slice(start, start + cardListRowsPerPage);
  }, [cappedFilteredCards, cardListPage, cardListRowsPerPage]);
  const effectiveCardListVisibleLines = useMemo(() => {
    if (cardListVisibleLinesMode === 'fit') {
      return Math.max(0, visibleFilteredCards.length);
    }
    return clampVisibleLines(cardListVisibleLines);
  }, [cardListVisibleLinesMode, cardListVisibleLines, visibleFilteredCards.length]);
  const cardListTableHeight = useMemo(
    () =>
      getTableHeightFromVisibleLines(effectiveCardListVisibleLines, {
        clamp: cardListVisibleLinesMode !== 'fit',
      }),
    [effectiveCardListVisibleLines, cardListVisibleLinesMode]
  );
  const showLeaderBaseTiles = leaderBaseViewMode === 'leaders_bases';
  const cardListStart = cappedFilteredCards.length < 1 ? 0 : (cardListPage - 1) * cardListRowsPerPage + 1;
  const cardListEnd = Math.min(cardListPage * cardListRowsPerPage, cappedFilteredCards.length);
  const visibleLeaderCards = useMemo(
    () => visibleFilteredCards.filter((card: CardItem) => card.type.toLowerCase() === 'leader'),
    [visibleFilteredCards]
  );
  const visibleBaseCards = useMemo(
    () => visibleFilteredCards.filter((card: CardItem) => card.type.toLowerCase() === 'base'),
    [visibleFilteredCards]
  );

  useEffect(() => {
    setCardListPage(1);
  }, [cardListRowsPerPage, sortedFilteredCards]);

  useEffect(() => {
    if (cardListPage > cardListTotalPages) {
      setCardListPage(cardListTotalPages);
    }
  }, [cardListPage, cardListTotalPages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CARD_LIST_ROWS_PER_PAGE_STORAGE_KEY, String(cardListRowsPerPage));
  }, [cardListRowsPerPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CARD_LIST_VISIBLE_LINES_STORAGE_KEY, String(cardListVisibleLines));
  }, [cardListVisibleLines]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CARD_LIST_VISIBLE_LINES_MODE_STORAGE_KEY, cardListVisibleLinesMode);
  }, [cardListVisibleLinesMode]);

  useEffect(() => {
    const hasLeader = String(leaderCardId ?? '').trim() !== '';
    const hasBase = String(baseCardId ?? '').trim() !== '';
    const nextMode: LeaderBaseViewMode = hasLeader && hasBase ? 'main' : 'leaders_bases';
    setLeaderBaseViewMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [leaderCardId, baseCardId]);

  const deckUsageByCard = useMemo(() => {
    const usage: Record<string, { main: number; side: number; total: number }> = {};
    Object.entries(mainboard).forEach(([cardId, qty]) => {
      usage[cardId] = {
        main: qty,
        side: usage[cardId]?.side ?? 0,
        total: qty + (usage[cardId]?.side ?? 0),
      };
    });
    Object.entries(sideboard).forEach(([cardId, qty]) => {
      usage[cardId] = {
        main: usage[cardId]?.main ?? 0,
        side: qty,
        total: (usage[cardId]?.main ?? 0) + qty,
      };
    });
    return usage;
  }, [mainboard, sideboard]);

  const poolViolations = useMemo(() => {
    const violations: Array<{
      card_id: string;
      used: number;
      pool: number;
      reason: 'missing' | 'excess';
    }> = [];
    Object.entries(deckUsageByCard).forEach(([cardId, usage]) => {
      if (usage.total <= 0) return;
      const poolQty = getPoolQuantity(cardId);
      if (poolQty <= 0) {
        violations.push({ card_id: cardId, used: usage.total, pool: 0, reason: 'missing' });
      } else if (usage.total > poolQty) {
        violations.push({ card_id: cardId, used: usage.total, pool: poolQty, reason: 'excess' });
      }
    });
    return violations;
  }, [deckUsageByCard, cardPoolMap]);

  async function addToPool(
    cardId: string,
    nextQuantity: number,
    ownerUserId?: number,
    options?: { silent?: boolean; skipMutate?: boolean }
  ) {
    if (!hasTournament) return;
    const resolvedCatalogId = resolveCatalogCardId(cardId);
    const normalizedCardId = resolvedCatalogId !== '' ? resolvedCatalogId : normalizeLooseCardId(cardId);
    if (normalizedCardId === '') return;
    const resolvedQuantity = Math.max(0, Math.min(99, Math.trunc(Number(nextQuantity) || 0)));
    const resolvedOwnerUserId =
      isAdmin && Number.isFinite(ownerUserId ?? NaN)
        ? Number(ownerUserId)
        : isAdmin && Number.isFinite(targetUserId ?? NaN)
          ? Number(targetUserId)
          : undefined;
    if (isAdmin && (resolvedOwnerUserId == null || resolvedOwnerUserId <= 0)) {
      if (!options?.silent) {
        showNotification({
          color: 'red',
          title: 'Select a single player',
          message: 'Choose one Deck/Card Pool Owner to edit card pool quantities.',
        });
      }
      return;
    }
    const response = await upsertCardPoolEntry(
      activeTournamentId,
      normalizedCardId,
      resolvedQuantity,
      resolvedOwnerUserId,
      selectedSeasonNumber ?? undefined
    );
    if (response == null) return;
    if (!options?.skipMutate) {
      await swrCardPoolResponse.mutate();
    }
    if (!options?.silent) {
      const cardName = cardsById[normalizedCardId]?.name ?? resolveCardDisplayName(normalizedCardId);
      showNotification({
        id: `card-pool-update-${normalizedCardId}`,
        color: 'green',
        title: 'Card pool updated',
        message: `${cardName}: ${resolvedQuantity}`,
      });
    }
  }

  async function addDeckToCardPool(
    mainboardEntries: Record<string, number>,
    sideboardEntries: Record<string, number>,
    sourceLabel: string,
    ownerUserId?: number
  ) {
    if (!hasTournament) return;
    if (isAdmin && isAdminAllOwnersView) {
      showNotification({
        color: 'red',
        title: 'Select a single player',
        message: 'Choose one Deck/Card Pool Owner before adding deck cards to a pool.',
      });
      return;
    }
    const combined = combineBoardQuantities(mainboardEntries, sideboardEntries);
    const updates = Object.entries(combined);
    if (updates.length < 1) {
      showNotification({
        color: 'red',
        title: 'No cards to add',
        message: 'This deck does not contain any cards.',
      });
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to add cards from "${sourceLabel}" to this card pool?\n\n` +
      `This can update up to ${updates.length} card entries and will not reduce existing quantities.`
    );
    if (!confirmed) return;

    let changedCount = 0;
    let attemptedCount = 0;
    for (const [cardId, requiredQty] of updates) {
      attemptedCount += 1;
      const currentQty = getPoolQuantity(cardId);
      const nextQty = Math.max(currentQty, requiredQty);
      if (nextQty === currentQty) continue;
      await addToPool(cardId, nextQty, ownerUserId, { silent: true, skipMutate: true });
      changedCount += 1;
    }
    if (changedCount > 0) {
      await swrCardPoolResponse.mutate();
    }

    showNotification({
      color: 'green',
      title: 'Card pool synced from deck',
      message:
        changedCount > 0
          ? `${sourceLabel}: updated ${changedCount} of ${attemptedCount} cards.`
          : `${sourceLabel}: card pool already covers this deck.`,
    });
  }

  function setDeckCardQuantity(cardId: string, side: 'main' | 'side', nextQuantity: number) {
    const resolvedCatalogId = resolveCatalogCardId(cardId);
    const normalizedCardId = resolvedCatalogId !== '' ? resolvedCatalogId : normalizeLooseCardId(cardId);
    if (normalizedCardId === '') return;
    const normalizedQty = Math.max(0, Math.min(99, Math.trunc(Number(nextQuantity) || 0)));
    const update = (prev: Record<string, number>) => {
      if (normalizedQty <= 0) {
        if (prev[normalizedCardId] == null) return prev;
        const next = { ...prev };
        delete next[normalizedCardId];
        return next;
      }
      return { ...prev, [normalizedCardId]: normalizedQty };
    };
    if (side === 'main') {
      setMainboard(update);
      return;
    }
    setSideboard(update);
  }

  function clearDeckCard(cardId: string, side: 'main' | 'side') {
    setDeckCardQuantity(cardId, side, 0);
  }

  function addCardToDeck(cardId: string, side: 'main' | 'side') {
    const resolvedCatalogId = resolveCatalogCardId(cardId);
    const normalizedCardId = resolvedCatalogId !== '' ? resolvedCatalogId : normalizeLooseCardId(cardId);
    if (normalizedCardId === '') return;
    const card = cardsById[normalizedCardId];
    if (side === 'main' && isLeaderOrBase(card)) {
      return;
    }

    if (side === 'main') {
      setDeckCardQuantity(normalizedCardId, 'main', (mainboard[normalizedCardId] ?? 0) + 1);
      return;
    }
    setDeckCardQuantity(normalizedCardId, 'side', (sideboard[normalizedCardId] ?? 0) + 1);
  }

  async function onSaveDeck() {
    if (!hasTournament || leaderCard == null || baseCard == null) return;
    if (poolViolations.length > 0) {
      const missingCount = poolViolations.filter((item) => item.reason === 'missing').length;
      const excessCount = poolViolations.filter((item) => item.reason === 'excess').length;
      const proceed = window.confirm(
        `This deck has ${poolViolations.length} card-pool issue(s): ${missingCount} missing card(s) and ${excessCount} over-limit card(s). Do you want to proceed?`
      );
      if (!proceed) return;
    }

    const response = await saveDeck(activeTournamentId, {
      user_id: targetUserId ?? undefined,
      tournament_id: activeTournamentId,
      season_id: selectedSeasonNumber ?? undefined,
      name: deckName,
      leader: leaderCard.card_id,
      base: baseCard.card_id,
      leader_image_url: leaderCard.image_url ?? undefined,
      mainboard,
      sideboard,
    });
    if (response == null) return;
    await swrDecksResponse.mutate();
    showNotification({
      color: 'green',
      title: 'Deck saved',
      message: '',
    });
  }

  async function onExportSwuDb(deck: any) {
    if (!hasTournament || deck == null) return;
    const deckName = String(deck?.name ?? '').trim() || 'Deck';
    const payload = buildSwudbDeckClipboardPayload({
      name: deckName,
      author: String(deck?.user_name ?? '').trim(),
      leaderCardId: String(deck?.leader ?? ''),
      baseCardId: String(deck?.base ?? ''),
      mainboard: deck?.mainboard ?? {},
      sideboard: deck?.sideboard ?? {},
    });
    const json = JSON.stringify(payload, null, 2);
    const copied = await copyTextToClipboard(json);
    if (!copied) {
      showNotification({
        color: 'red',
        title: 'Copy failed',
        message: 'Could not copy deck JSON to clipboard in this browser context.',
      });
      return;
    }
    showNotification({
      color: 'green',
      title: 'Exported SWUDB JSON',
      message: 'Deck JSON copied to clipboard.',
    });
  }

  async function onRenameSavedDeck(deck: any) {
    if (!hasTournament) return;
    const currentName = String(deck?.name ?? '').trim();
    const nextNameInput = window.prompt('Enter a new deck name', currentName);
    if (nextNameInput == null) return;
    const nextName = nextNameInput.trim();
    if (nextName === '') {
      showNotification({
        color: 'red',
        title: 'Rename failed',
        message: 'Deck name cannot be empty.',
      });
      return;
    }
    if (nextName === currentName) return;

    const response = await renameDeck(activeTournamentId, Number(deck.id), nextName);
    if (response == null) return;
    await swrDecksResponse.mutate();
    if (deckName.trim() === currentName) {
      setDeckName(nextName);
    }
    showNotification({
      color: 'green',
      title: 'Deck renamed',
      message: '',
    });
  }

  function loadDeckIntoEditor(deck: any) {
    setDeckName(deck.name);
    setMainboard(normalizeBoardEntries(deck.mainboard ?? {}, resolveCatalogCardId));
    setSideboard(normalizeBoardEntries(deck.sideboard ?? {}, resolveCatalogCardId));

    const leaderDeckValue = String(deck.leader ?? '');
    const baseDeckValue = String(deck.base ?? '');
    const leaderResolvedId = resolveCatalogCardId(leaderDeckValue);
    const baseResolvedId = resolveCatalogCardId(baseDeckValue);
    const leader = allCards.find(
      (card: CardItem) =>
        card.type.toLowerCase() === 'leader' &&
        (card.name === leaderDeckValue || card.card_id === leaderResolvedId)
    );
    const base = allCards.find(
      (card: CardItem) =>
        card.type.toLowerCase() === 'base' &&
        (card.name === baseDeckValue || card.card_id === baseResolvedId)
    );
    setLeaderCardId(leader?.card_id ?? null);
    setBaseCardId(base?.card_id ?? null);
  }

  async function onSetCurrentDeck(deck: any) {
    if (!hasTournament) return;
    const deckId = Number(deck?.id ?? 0);
    if (!Number.isFinite(deckId) || deckId <= 0) return;
    const ownerUserId = Number(deck?.user_id ?? 0);

    await submitTournamentApplication(activeTournamentId, {
      deck_id: deckId,
      season_id: selectedSeasonNumber ?? undefined,
      user_id:
        isAdmin && Number.isFinite(ownerUserId) && ownerUserId > 0
          ? ownerUserId
          : undefined,
    });
    await swrApplicationsResponse.mutate();
    showNotification({
      color: 'green',
      title: 'Current deck updated',
      message: '',
    });
  }

  function onClearCurrentDeck() {
    const hasDeckState =
      leaderCardId != null ||
      baseCardId != null ||
      Object.keys(mainboard).length > 0 ||
      Object.keys(sideboard).length > 0;
    if (!hasDeckState) return;

    const proceed = window.confirm(
      'Are you sure you want to clear the current deck? This removes leader, base, mainboard, and sideboard cards.'
    );
    if (!proceed) return;

    setLeaderCardId(null);
    setBaseCardId(null);
    setMainboard({});
    setSideboard({});
    showNotification({
      color: 'green',
      title: 'Deck cleared',
      message: 'Current deck has been reset.',
    });
  }

  async function onImportSwuDb() {
    try {
      const parsed = JSON.parse(swudbImportJson);
      const resolveCardId = (rawId: unknown) => {
        const asString = String(rawId ?? '').trim();
        if (asString === '') return '';
        const mapped = resolveCatalogCardId(asString);
        return mapped !== '' ? mapped : asString;
      };
      const sanitizeEntries = (entries: unknown) =>
        (Array.isArray(entries) ? entries : [])
          .map((entry: any) => {
            const id = resolveCardId(entry?.id);
            const count = Number(entry?.count ?? 0);
            return {
              id,
              count: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0,
            };
          })
          .filter((entry) => entry.id !== '' && entry.count > 0);

      const leader = resolveCardId(parsed?.leader?.id ?? parsed?.leader);
      const base = resolveCardId(parsed?.base?.id ?? parsed?.base);
      if (leader === '' || base === '') {
        showNotification({
          color: 'red',
          title: 'Import failed',
          message: 'Missing leader or base in SWUDB JSON.',
        });
        return;
      }

      const deck = sanitizeEntries(parsed?.deck);
      const importedSideboard = sanitizeEntries(parsed?.sideboard);
      const importedName =
        String(parsed?.metadata?.name ?? parsed?.name ?? '').trim() ||
        `Imported Deck ${new Date().toISOString()}`;

      setDeckName(importedName);
      setLeaderCardId(leader);
      setBaseCardId(base);
      const nextMainboard = normalizeBoardEntries(
        deck.reduce(
          (result: Record<string, number>, entry: { id: string; count: number }) => ({
            ...result,
            [entry.id]: entry.count,
          }),
          {}
        ),
        resolveCatalogCardId
      );
      const nextSideboard = normalizeBoardEntries(
        importedSideboard.reduce(
          (result: Record<string, number>, entry: { id: string; count: number }) => ({
            ...result,
            [entry.id]: entry.count,
          }),
          {}
        ),
        resolveCatalogCardId
      );
      setMainboard(nextMainboard);
      setSideboard(nextSideboard);

      if (hasTournament) {
        await importDeckSwuDb(activeTournamentId, {
          user_id: targetUserId ?? undefined,
          season_id: selectedSeasonNumber ?? undefined,
          name: importedName,
          leader,
          base,
          deck: Object.entries(nextMainboard).map(([id, count]) => ({ id, count })),
          sideboard: Object.entries(nextSideboard).map(([id, count]) => ({ id, count })),
        });
        await swrDecksResponse.mutate();
      }
      showNotification({
        color: 'green',
        title: 'Import successful',
        message: hasTournament
          ? 'Deck imported and saved.'
          : 'Deck loaded locally. Select a tournament to save or submit.',
      });
      setSwudbImportJson('');
    } catch {
      showNotification({
        color: 'red',
        title: 'Import failed',
        message: 'Invalid SWUDB JSON payload.',
      });
    }
  }

  const deckRows = useMemo(() => {
    const rows: Array<{ side: 'Main' | 'Side'; card_id: string; qty: number }> = [];
    Object.entries(mainboard).forEach(([card_id, qty]) => rows.push({ side: 'Main', card_id, qty }));
    Object.entries(sideboard).forEach(([card_id, qty]) => rows.push({ side: 'Side', card_id, qty }));
    return rows.sort((a, b) => {
      const cardAId = resolveCatalogCardId(a.card_id);
      const cardBId = resolveCatalogCardId(b.card_id);
      const cardA = cardsById[cardAId !== '' ? cardAId : a.card_id];
      const cardB = cardsById[cardBId !== '' ? cardBId : b.card_id];
      return resolveCardDisplayName(cardA?.name ?? a.card_id).localeCompare(
        resolveCardDisplayName(cardB?.name ?? b.card_id)
      );
    });
  }, [mainboard, sideboard, cardsById, cardIdByLookupKey]);
  const mainDeckRows = useMemo(
    () => deckRows.filter((row) => row.side === 'Main'),
    [deckRows]
  );
  const sideDeckRows = useMemo(
    () => deckRows.filter((row) => row.side === 'Side'),
    [deckRows]
  );

  const buildCompositionMetrics = (
    entries: Array<{ card_id: string; qty: number; card: CardItem }>,
    aspectFitReference?: Set<string>
  ) => {
    const totalQty = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.qty ?? 0)), 0);
    const uniqueCardCount = new Set(entries.map((entry) => String(entry.card_id))).size;
    const byCost = aggregateCountMap(entries.map((entry) => [String(entry.card.cost ?? '-'), entry.qty]));
    const byPower = aggregateCountMap(entries.map((entry) => [String(entry.card.power ?? '-'), entry.qty]));
    const byHp = aggregateCountMap(entries.map((entry) => [String(entry.card.hp ?? '-'), entry.qty]));
    const byType = aggregateCountMap(entries.map((entry) => [entry.card.type ?? 'Unknown', entry.qty]));
    const byRarity = aggregateCountMap(entries.map((entry) => [entry.card.rarity ?? 'Unknown', entry.qty]));
    const byAspect = aggregateCountMap(
      entries.flatMap((entry) => {
        const aspects = entry.card.aspects ?? [];
        if (aspects.length < 1) return [['None', entry.qty] as [string, number]];
        return aspects.map((aspect) => [aspect, entry.qty] as [string, number]);
      })
    );
    const byAlignment = aggregateCountMap(
      entries.map((entry) => {
        const alignment = resolveAlignmentForAspects(entry.card.aspects ?? []);
        const label = alignment === 'heroic' ? 'Heroic' : alignment === 'villainy' ? 'Villainy' : 'Neither';
        return [label, entry.qty] as [string, number];
      })
    );
    const byArena = aggregateCountMap(
      entries.flatMap((entry) => {
        const arenas = entry.card.arenas ?? [];
        if (arenas.length < 1) return [['None', entry.qty] as [string, number]];
        return arenas.map((arena) => [arena, entry.qty] as [string, number]);
      })
    );
    const bySynergy = aggregateCountMap(
      entries.flatMap((entry) => [
        ...(entry.card.keywords ?? []).map((value) => [`Keyword: ${value}`, entry.qty] as [string, number]),
        ...(entry.card.traits ?? []).map((value) => [`Trait: ${value}`, entry.qty] as [string, number]),
      ])
    );
    const bySet = aggregateCountMap(entries.map((entry) => [String(entry.card.set_code ?? '').toUpperCase(), entry.qty]));

    const outOfAspect = entries.reduce((sum, entry) => {
      if (aspectFitReference == null) return sum;
      const cardAspects = (entry.card.aspects ?? []).map((value) => value.toLowerCase());
      const invalid = cardAspects.some((aspect) => !aspectFitReference.has(aspect));
      return invalid ? sum + entry.qty : sum;
    }, 0);
    const inAspect = totalQty - outOfAspect;

    const toSortedRows = (mapping: Record<string, number>) =>
      Object.entries(mapping)
        .map(([label, value]) => ({ label, value }))
        .sort((left, right) => right.value - left.value || compareText(left.label, right.label));

    return {
      totalQty,
      uniqueCardCount,
      byCost: toSortedRows(byCost),
      byPower: toSortedRows(byPower),
      byHp: toSortedRows(byHp),
      byType: toSortedRows(byType),
      byRarity: toSortedRows(byRarity),
      byAspect: toSortedRows(byAspect),
      byAlignment: toSortedRows(byAlignment),
      byArena: toSortedRows(byArena),
      bySynergy: toSortedRows(bySynergy).slice(0, 25),
      bySet: toSortedRows(bySet),
      outAspectRows: [
        { label: 'In Aspect', value: inAspect < 0 ? 0 : inAspect },
        { label: 'Out of Aspect', value: outOfAspect },
      ],
    };
  };

  const deckMetricEntries = useMemo(
    () =>
      deckRows
        .map((row) => {
          const resolvedCardId = resolveCatalogCardId(row.card_id);
          const effectiveCardId = resolvedCardId !== '' ? resolvedCardId : row.card_id;
          const card = cardsById[effectiveCardId];
          if (card == null) return null;
          return { card_id: effectiveCardId, qty: row.qty, card };
        })
        .filter((entry): entry is { card_id: string; qty: number; card: CardItem } => entry != null),
    [deckRows, cardsById, cardIdByLookupKey]
  );
  const poolMetricEntries = useMemo(
    () =>
      Object.entries(cardPoolMap)
        .map(([rawCardId, rawQty]) => {
          const resolvedCardId = resolveCatalogCardId(rawCardId);
          const effectiveCardId = resolvedCardId !== '' ? resolvedCardId : rawCardId;
          const qty = Math.max(0, Math.trunc(Number(rawQty ?? 0)));
          if (qty <= 0) return null;
          const card = cardsById[effectiveCardId];
          if (card == null) return null;
          return { card_id: effectiveCardId, qty, card };
        })
        .filter((entry): entry is { card_id: string; qty: number; card: CardItem } => entry != null),
    [cardPoolMap, cardsById, cardIdByLookupKey]
  );
  const cardPoolExportRows = useMemo(
    () =>
      poolMetricEntries
        .map((entry) => ({
          card_id: entry.card_id,
          quantity: entry.qty,
          name: String(entry.card.name ?? '').trim() || entry.card_id,
          character_variant: entry.card.character_variant ?? null,
          set_code: String(entry.card.set_code ?? '').toUpperCase(),
          type: entry.card.type ?? null,
          rarity: entry.card.rarity ?? null,
          cost: entry.card.cost ?? null,
          power: entry.card.power ?? null,
          hp: entry.card.hp ?? null,
          alignment: resolveAlignmentForAspects(entry.card.aspects ?? []),
          aspects: entry.card.aspects ?? [],
          traits: entry.card.traits ?? [],
          keywords: entry.card.keywords ?? [],
          arenas: entry.card.arenas ?? [],
        }))
        .sort(
          (left, right) =>
            Number(right.quantity ?? 0) - Number(left.quantity ?? 0) ||
            compareText(String(left.name ?? left.card_id), String(right.name ?? right.card_id))
        ),
    [poolMetricEntries]
  );
  const selectedOwnerLabel = useMemo(() => {
    if (isAdmin && isAdminAllOwnersView) return 'All Users';
    if (isAdmin && targetUserId != null) {
      const owner = adminUsers.find((row: any) => Number(row.user_id) === Number(targetUserId));
      if (owner != null) return String(owner.user_name ?? '').trim() || `User ${targetUserId}`;
    }
    return String(swrCurrentUserResponse.data?.data?.name ?? 'Current User').trim() || 'Current User';
  }, [adminUsers, isAdmin, isAdminAllOwnersView, swrCurrentUserResponse.data?.data?.name, targetUserId]);
  const selectedSeasonLabel = useMemo(() => {
    if (selectedSeasonNumber != null) {
      const season = seasonOptions.find((row: any) => Number(row?.season_id) === Number(selectedSeasonNumber));
      return season != null ? String(season.name ?? `Season ${selectedSeasonNumber}`) : `Season ${selectedSeasonNumber}`;
    }
    if (selectedSeasonId === ALL_SEASONS_VALUE) return 'All Seasons';
    if (activeSeasonNumber != null) {
      const season = seasonOptions.find((row: any) => Number(row?.season_id) === Number(activeSeasonNumber));
      if (season != null) return `${String(season.name ?? `Season ${activeSeasonNumber}`)} (Active)`;
      return `Season ${activeSeasonNumber} (Active)`;
    }
    return 'Current Season';
  }, [activeSeasonNumber, selectedSeasonId, selectedSeasonNumber, seasonOptions]);
  const deckMetrics = useMemo(
    () => buildCompositionMetrics(deckMetricEntries, allowedAspects),
    [deckMetricEntries, allowedAspects]
  );
  const poolMetrics = useMemo(
    () => buildCompositionMetrics(poolMetricEntries, allowedAspects),
    [poolMetricEntries, allowedAspects]
  );
  const activeMetrics = analyticsScope === 'deck' ? deckMetrics : poolMetrics;
  const analyticsEmptyMessage =
    analyticsScope === 'deck'
      ? 'Add cards to your current deck to see analytics.'
      : 'No cards in this card pool yet for the selected owner/season.';

  const metaTakeaways = useMemo(
    () => (metaAnalysis?.meta_takeaways ?? []).slice(0, 6),
    [metaAnalysis]
  );
  const metaTopLeaders = useMemo(
    () =>
      [...(metaAnalysis?.top_leaders ?? [])]
        .sort((left: any, right: any) => Number(right?.win_rate ?? 0) - Number(left?.win_rate ?? 0))
        .slice(0, 6),
    [metaAnalysis]
  );
  const metaTopAspectCombos = useMemo(
    () =>
      [...(metaAnalysis?.aspect_combo_breakdown ?? [])]
        .sort((left: any, right: any) => Number(right?.avg_win_rate ?? 0) - Number(left?.avg_win_rate ?? 0))
        .slice(0, 6),
    [metaAnalysis]
  );
  const metaKeywordImpact = useMemo(
    () =>
      [...(metaAnalysis?.keyword_win_impact ?? [])]
        .filter((row: any) => Number(row?.win_impact_score ?? 0) > 0)
        .sort((left: any, right: any) => Number(right?.win_impact_score ?? 0) - Number(left?.win_impact_score ?? 0))
        .slice(0, 8),
    [metaAnalysis]
  );
  const normalizedPoolLookupKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.keys(cardPoolMap).forEach((cardId) => {
      buildCardLookupKeys(cardId).forEach((lookupKey) => keys.add(lookupKey));
    });
    return keys;
  }, [cardPoolMap]);
  const poolMetaOverlap = useMemo(() => {
    const topCards = (metaAnalysis?.top_cards ?? []).slice(0, 30);
    let considered = 0;
    let owned = 0;
    topCards.forEach((row: any) => {
      const rawCardId = String(row?.card_id ?? '').trim();
      if (rawCardId === '') return;
      considered += 1;
      const hasCard = buildCardLookupKeys(rawCardId).some((lookupKey) =>
        normalizedPoolLookupKeys.has(lookupKey)
      );
      if (hasCard) owned += 1;
    });
    return {
      owned,
      considered,
      pct: considered > 0 ? (owned / considered) * 100 : 0,
    };
  }, [metaAnalysis, normalizedPoolLookupKeys]);
  const poolBuildGuidance = useMemo(() => {
    const lines: string[] = [];
    const topPoolAspects = poolMetrics.byAspect.slice(0, 3).map((row) => row.label);
    if (topPoolAspects.length > 0) {
      lines.push(`Your pool is deepest in: ${topPoolAspects.join(', ')}.`);
    }
    const topPoolAlignments = poolMetrics.byAlignment
      .filter((row) => row.value > 0)
      .slice(0, 2)
      .map((row) => row.label);
    if (topPoolAlignments.length > 0) {
      lines.push(`Alignment depth favors: ${topPoolAlignments.join(' + ')}.`);
    }
    const topPoolSynergy = poolMetrics.bySynergy[0];
    if (topPoolSynergy != null) {
      lines.push(`Most supported synergy in your pool: ${topPoolSynergy.label}.`);
    }
    const bestMetaCombo = metaTopAspectCombos[0];
    if (bestMetaCombo != null) {
      lines.push(
        `Strong current meta combo: ${bestMetaCombo.label} (${Number(bestMetaCombo.avg_win_rate ?? 0).toFixed(2)}% win).`
      );
    }
    if (poolMetaOverlap.considered > 0) {
      lines.push(
        `You currently own ${poolMetaOverlap.owned}/${poolMetaOverlap.considered} of the top 30 meta cards (${poolMetaOverlap.pct.toFixed(1)}%).`
      );
    }
    return lines;
  }, [poolMetrics, metaTopAspectCombos, poolMetaOverlap]);

  let graphContent = null;
  if (graphView === 'cost') {
    graphContent = <GraphBars data={activeMetrics.byCost} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'power') {
    graphContent = <GraphBars data={activeMetrics.byPower} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'hp') {
    graphContent = <GraphBars data={activeMetrics.byHp} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'type') {
    graphContent = <GraphBars data={activeMetrics.byType} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'rarity') {
    graphContent = <GraphBars data={activeMetrics.byRarity} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'aspect') {
    graphContent = <GraphBars data={activeMetrics.byAspect} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'alignment') {
    graphContent = <GraphBars data={activeMetrics.byAlignment} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'out_aspect') {
    graphContent = <GraphBars data={activeMetrics.outAspectRows} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else if (graphView === 'synergy') {
    graphContent = <GraphBars data={activeMetrics.bySynergy} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  } else {
    graphContent = <GraphBars data={activeMetrics.byArena} total={activeMetrics.totalQty} emptyMessage={analyticsEmptyMessage} sortBy={analyticsSortBy} sortDirection={analyticsSortDirection} />;
  }

  async function onExportCardPoolJson() {
    if (cardPoolExportRows.length < 1) {
      showNotification({
        color: 'red',
        title: 'No card pool data',
        message: 'No cards found in the selected card pool scope.',
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const filenameBase = `card-pool-${sanitizeFilenamePart(selectedOwnerLabel)}-${sanitizeFilenamePart(selectedSeasonLabel)}`;
    const swudbEntries = buildSwudbCardPoolEntries(
      cardPoolExportRows.map((row) => ({
        card_id: row.card_id,
        quantity: row.quantity,
      }))
    );
    const exportName = `${selectedOwnerLabel} Full Deck Pool`;
    const payload = {
      metadata: {
        name: exportName,
        author: selectedOwnerLabel,
        exported_at: nowIso,
        tournament_id: activeTournamentId,
        owner: selectedOwnerLabel,
        season: selectedSeasonLabel,
        scope:
          isAdmin && isAdminAllOwnersView
            ? 'all_users'
            : isAdmin
              ? 'single_user_admin_view'
              : 'current_user',
      },
      name: exportName,
      deck: swudbEntries,
      sideboard: [],
      cards: swudbEntries,
      totals: {
        unique_cards: cardPoolExportRows.length,
        total_copies: poolMetrics.totalQty,
      },
    };
    triggerDownload(
      `${filenameBase}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );
    showNotification({
      color: 'green',
      title: 'Card pool exported',
      message: 'Downloaded SWUDB-style card pool JSON export.',
    });
  }

  async function onExportCardPoolTxt() {
    if (cardPoolExportRows.length < 1) {
      showNotification({
        color: 'red',
        title: 'No card pool data',
        message: 'No cards found in the selected card pool scope.',
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const filenameBase = `card-pool-${sanitizeFilenamePart(selectedOwnerLabel)}-${sanitizeFilenamePart(selectedSeasonLabel)}`;
    const lines: string[] = [
      '# Sealed League Card Pool Export',
      `Exported At (UTC): ${nowIso}`,
      `Tournament ID: ${activeTournamentId}`,
      `Owner: ${selectedOwnerLabel}`,
      `Season: ${selectedSeasonLabel}`,
      `Unique Cards: ${cardPoolExportRows.length}`,
      `Total Copies: ${poolMetrics.totalQty}`,
      '',
      'Cards',
      '-----',
    ];
    cardPoolExportRows.forEach((row) => {
      const variant = String(row.character_variant ?? '').trim();
      const displayName = variant === '' ? row.name : `${row.name} - ${variant}`;
      lines.push(
        `${row.quantity}x ${displayName} [${row.set_code}] (${row.card_id}) | ${row.type ?? '-'} | Alignment: ${row.alignment}`
      );
    });
    triggerDownload(
      `${filenameBase}.txt`,
      lines.join('\n'),
      'text/plain;charset=utf-8'
    );
    showNotification({
      color: 'green',
      title: 'Card pool exported',
      message: 'Downloaded TXT card pool export.',
    });
  }

  async function onCopyCurrentDeckJson() {
    if (leaderCardId == null || baseCardId == null) {
      showNotification({
        color: 'red',
        title: 'Deck not ready',
        message: 'Select a leader and base before exporting deck JSON.',
      });
      return;
    }

    const normalizedDeckName = deckName.trim() === '' ? 'League Deck' : deckName.trim();
    const authorName = String(swrCurrentUserResponse.data?.data?.name ?? '').trim();
    const payload = buildSwudbDeckClipboardPayload({
      name: normalizedDeckName,
      author: authorName,
      leaderCardId,
      baseCardId,
      mainboard,
      sideboard,
    });
    const copied = await copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (!copied) {
      showNotification({
        color: 'red',
        title: 'Copy failed',
        message: 'Could not copy deck JSON to clipboard in this browser context.',
      });
      return;
    }
    showNotification({
      color: 'green',
      title: 'Deck JSON copied',
      message: 'Current deck JSON copied to clipboard.',
    });
  }

  async function onSubmitEntry() {
    if (!hasTournament || leaderCard == null || baseCard == null) return;
    await submitLeagueEntry(activeTournamentId, {
      season_id: selectedSeasonNumber ?? undefined,
      deck_name: deckName,
      leader: leaderCard.card_id,
      base: baseCard.card_id,
      leader_image_url: leaderCard.image_url ?? undefined,
      mainboard,
      sideboard,
    });
    await Promise.all([swrDecksResponse.mutate(), swrApplicationsResponse.mutate()]);
    showNotification({
      color: 'green',
      title: 'Tournament entry submitted',
      message: 'You have been entered with your selected deck.',
    });
  }

  function toggleCardSort(nextKey: CardSortKey) {
    if (cardSortKey === nextKey) {
      setCardSortDirection(cardSortDirection === 'asc' ? 'desc' : 'asc');
      return;
    }
    setCardSortKey(nextKey);
    setCardSortDirection('asc');
  }

  function sortIndicatorFor(key: CardSortKey) {
    if (cardSortKey !== key) return <IconSelector size={14} stroke={1.8} />;
    if (cardSortDirection === 'asc') return <IconChevronUp size={14} stroke={1.8} />;
    return <IconChevronDown size={14} stroke={1.8} />;
  }

  function onSelectBase(value: string | null) {
    if (value == null || value.trim() === '') {
      setBaseCardId(null);
      return;
    }

    const randomAspect = RANDOM_BASE_ASPECT_BY_VALUE[value];
    if (randomAspect == null) {
      setBaseCardId(value);
      return;
    }

    const candidates = random30HpBasesByAspect[randomAspect] ?? [];
    if (candidates.length < 1) {
      showNotification({
        color: 'red',
        title: 'No matching base found',
        message: `No 30 HP ${randomAspect} base is currently available in the card catalog.`,
      });
      return;
    }

    const selectedBase = candidates[Math.floor(Math.random() * candidates.length)];
    if (selectedBase == null) return;
    setBaseCardId(selectedBase.card_id);
    showNotification({
      color: 'green',
      title: 'Random base selected',
      message: `${selectedBase.name}${selectedBase.character_variant ? ` - ${selectedBase.character_variant}` : ''}`,
    });
  }

  const renderDeckSection = (
    title: string,
    rows: Array<{ side: 'Main' | 'Side'; card_id: string; qty: number }>,
    side: 'main' | 'side'
  ) => {
    const visibleStart = rows.length < 1 ? 0 : 1;
    const visibleEnd = rows.length;
    return (
      <Stack gap={6}>
        <Group justify="space-between" align="end">
          <Text fw={600}>{title}</Text>
          <Text size="xs" c="dimmed">
            Showing {visibleStart}-{visibleEnd} of {rows.length}
          </Text>
        </Group>
        <Table stickyHeader stickyHeaderOffset={0}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Cost</Table.Th>
              <Table.Th>Power</Table.Th>
              <Table.Th>HP</Table.Th>
              <Table.Th>Aspect</Table.Th>
              <Table.Th>Arena/Set</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length < 1 && (
              <Table.Tr>
                <Table.Td colSpan={8}>
                  <Text c="dimmed" size="sm">
                    No cards added yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((row) => {
              const resolvedRowCardId = resolveCatalogCardId(row.card_id);
              const effectiveCardId = resolvedRowCardId !== '' ? resolvedRowCardId : row.card_id;
              const card = cardsById[effectiveCardId];
              const usage = deckUsageByCard[row.card_id];
              const totalQty = usage?.total ?? row.qty;
              const poolQty = getPoolQuantity(effectiveCardId);
              const rowHighlightColor =
                showPoolWarnings && totalQty > 0
                  ? poolQty <= 0
                    ? 'rgba(255, 0, 0, 0.12)'
                    : totalQty > poolQty
                      ? 'rgba(255, 215, 0, 0.20)'
                      : undefined
                  : undefined;
              return (
                <Table.Tr
                  key={`${side}-${row.card_id}`}
                  style={rowHighlightColor ? { backgroundColor: rowHighlightColor } : undefined}
                >
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <NumberInput
                        value={row.qty}
                        min={0}
                        max={99}
                        w={74}
                        onChange={(value) => {
                          const numeric = Number(value ?? 0);
                          setDeckCardQuantity(row.card_id, side, Number.isNaN(numeric) ? 0 : numeric);
                        }}
                      />
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        onClick={() => clearDeckCard(row.card_id, side)}
                        title="Remove card from this section"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {(() => {
                      const cardName = card?.name ?? resolveCardDisplayName(row.card_id);
                      const variant = String(card?.character_variant ?? '').trim();
                      const previewLabel = variant === '' ? cardName : `${cardName} - ${variant}`;
                      const imageUrl = String(card?.image_url ?? '').trim();

                      const nameStack = (
                        <Stack
                          gap={0}
                          style={imageUrl !== '' ? { cursor: 'zoom-in' } : undefined}
                          onClick={
                            imageUrl === ''
                              ? undefined
                              : () => {
                                  setPreviewImageLabel(previewLabel);
                                  setPreviewImageUrl(imageUrl);
                                }
                          }
                        >
                          <Text size="sm">{cardName}</Text>
                          {variant !== '' ? (
                            <Text size="xs" c="dimmed">
                              {variant}
                            </Text>
                          ) : null}
                        </Stack>
                      );

                      if (imageUrl === '') return nameStack;

                      return (
                        <HoverCard width={280} shadow="md" openDelay={120} closeDelay={80} withinPortal>
                          <HoverCard.Target>
                            <div>{nameStack}</div>
                          </HoverCard.Target>
                          <HoverCard.Dropdown>
                            <Stack gap={6}>
                              <Image src={imageUrl} h={260} fit="contain" radius="sm" />
                              <Text size="xs" c="dimmed">
                                {previewLabel}
                              </Text>
                            </Stack>
                          </HoverCard.Dropdown>
                        </HoverCard>
                      );
                    })()}
                  </Table.Td>
                  <Table.Td>{card?.type ?? '-'}</Table.Td>
                  <Table.Td>{card?.cost ?? '-'}</Table.Td>
                  <Table.Td>{card?.power ?? '-'}</Table.Td>
                  <Table.Td>{card?.hp ?? '-'}</Table.Td>
                  <Table.Td>{card != null ? <AspectIcons aspects={card.aspects ?? []} /> : '-'}</Table.Td>
                  <Table.Td>
                    {card != null ? `${(card.arenas ?? []).join('/') || '-'} / ${card.set_code.toUpperCase()}` : '-'}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Stack>
    );
  };

  const content = (
    <Stack>
        <Modal
          opened={previewImageUrl != null}
          onClose={() => setPreviewImageUrl(null)}
          title={previewImageLabel}
          size="85vw"
          centered
        >
          {previewImageUrl != null && (
            <Image src={previewImageUrl} alt={previewImageLabel} fit="contain" style={{ maxHeight: '78vh' }} />
          )}
        </Modal>
        <Title order={2}>Deckbuilder</Title>
        <Text c="dimmed">
          Search by name, keyword, trait, cost, type, aspect, alignment, set, rules, and arena.
          Card pools remain user-specific per season and auto-save on quantity change.
        </Text>
        {(standalone || seasons.length > 0) && (
          <Card withBorder>
            <Stack>
              {standalone && (
                <Select
                  label="Tournament"
                  value={selectedTournamentId}
                  onChange={(value) => {
                    setSelectedTournamentId(value);
                    if (value != null) {
                      window.localStorage.setItem('league_default_tournament_id', value);
                    }
                  }}
                  allowDeselect
                  clearable
                  data={tournaments.map((t: any) => ({ value: String(t.id), label: t.name }))}
                />
              )}
              {isAdmin && hasTournament && (
                <Select
                  label="Deck/Card Pool Owner"
                  value={selectedTargetUserId}
                  onChange={(value) => setSelectedTargetUserId(value ?? ALL_DECK_OWNERS_VALUE)}
                  allowDeselect
                  clearable
                  searchable
                  data={[
                    { value: ALL_DECK_OWNERS_VALUE, label: 'All users (admin view)' },
                    ...adminUsers.map((row: any) => ({
                      value: String(row.user_id),
                      label: `${row.user_name} (${row.user_email})`,
                    })),
                  ]}
                />
              )}
              {isAdminAllOwnersView && (
                <Text size="xs" c="dimmed">
                  Card pool quantity edits are disabled while viewing all users. Select one owner to edit pool values.
                </Text>
              )}
              {seasonOptions.length > 0 && (
                <Select
                  label="Season"
                  value={selectedSeasonId}
                  onChange={(value) => setSelectedSeasonId(value ?? ALL_SEASONS_VALUE)}
                  allowDeselect
                  clearable
                  data={[
                    { value: ALL_SEASONS_VALUE, label: 'All seasons (deck carryover)' },
                    ...seasonOptions.map((season: any) => ({
                      value: String(season.season_id),
                      label: `${season.name}${season.is_active ? ' (Active)' : ''}${
                        (seasonNameCounts[String(season.name ?? '').trim().toLowerCase()] ?? 0) > 1
                          ? ` [#${season.season_id}]`
                          : ''
                      }`,
                    })),
                  ]}
                />
              )}
            </Stack>
          </Card>
        )}
        {!hasTournament && <Text c="dimmed">No tournament selected.</Text>}

        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Card withBorder>
              <Stack>
                <Group grow>
                  <TextInput label="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
                  <TextInput label="Name" value={nameQuery} onChange={(e) => setNameQuery(e.currentTarget.value)} />
                  <TextInput
                    label="Rules"
                    value={rulesQuery}
                    onChange={(e) => setRulesQuery(e.currentTarget.value)}
                  />
                </Group>
                <Group grow>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Keywords"
                      data={keywordOptions}
                      value={selectedKeywords}
                      onChange={setSelectedKeywords}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedKeywords(keywordOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedKeywords([])}
                      >
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Traits"
                      data={traitOptions}
                      value={selectedTraits}
                      onChange={setSelectedTraits}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedTraits(traitOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedTraits([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Aspects"
                      data={aspectOptions}
                      value={selectedAspects}
                      onChange={setSelectedAspects}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedAspects(aspectOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedAspects([])}
                      >
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Alignment"
                      data={ALIGNMENT_OPTIONS}
                      value={selectedAlignments}
                      onChange={(values) =>
                        setSelectedAlignments(values.filter((value): value is AlignmentFilter => isAlignmentFilter(value)))
                      }
                      clearable
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedAlignments(ALIGNMENT_OPTIONS.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedAlignments([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                </Group>
                <Group grow>
                  <Select label="Arena" data={arenaOptions} value={arenaFilter} onChange={setArenaFilter} clearable />
                  <Stack gap={4}>
                    <MultiSelect
                      label="Costs"
                      data={costOptions}
                      value={selectedCosts}
                      onChange={setSelectedCosts}
                      clearable
                      searchable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedCosts(costOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedCosts([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Card Types"
                      data={typeOptions}
                      value={selectedTypes}
                      onChange={setSelectedTypes}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedTypes(typeOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedTypes([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Rarities"
                      data={rarityOptions}
                      value={selectedRarities}
                      onChange={setSelectedRarities}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedRarities(rarityOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedRarities([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                  <Stack gap={4}>
                    <MultiSelect
                      label="Sets"
                      data={setOptions}
                      value={selectedSets}
                      onChange={setSelectedSets}
                      searchable
                      clearable
                      maxDropdownHeight={220}
                    />
                    <Group gap={6}>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setSelectedSets(setOptions.map((option) => option.value))}
                      >
                        Select all
                      </Button>
                      <Button size="xs" variant="subtle" onClick={() => setSelectedSets([])}>
                        Clear
                      </Button>
                    </Group>
                  </Stack>
                </Group>
                <Group>
                  <Stack gap={4} style={{ minWidth: '22rem' }}>
                    <Text size="sm" fw={600}>
                      Leader/Base View
                    </Text>
                    <SegmentedControl
                      value={leaderBaseViewMode}
                      onChange={(value) =>
                        setLeaderBaseViewMode(
                          value === 'leaders_bases' ? value : 'main'
                        )
                      }
                      data={[
                        { value: 'main', label: 'Main Cards' },
                        { value: 'leaders_bases', label: 'Leader & Base Tiles' },
                      ]}
                    />
                  </Stack>
                  <Switch
                    label="Only legal cards (leader/base aspects)"
                    checked={onlyLegalCards}
                    onChange={(event) => setOnlyLegalCards(event.currentTarget.checked)}
                  />
                  <Switch
                    label="Only cards in my pool"
                    checked={onlyCardsInPool}
                    onChange={(event) => setOnlyCardsInPool(event.currentTarget.checked)}
                  />
                  <Switch
                    label="Show images"
                    checked={showCardImage}
                    onChange={(event) => setShowCardImage(event.currentTarget.checked)}
                  />
                  <Switch
                    label="Highlight pool issues in deck (red missing, yellow over limit)"
                    checked={showPoolWarnings}
                    onChange={(event) => setShowPoolWarnings(event.currentTarget.checked)}
                  />
                </Group>
                <ScrollArea h={cardListTableHeight}>
                  <Group justify="space-between" mb="xs">
                    <Text size="sm" c="dimmed">
                      Showing {cardListStart}-{cardListEnd} of {cappedFilteredCards.length}
                    </Text>
                    <Pagination
                      value={cardListPage}
                      onChange={setCardListPage}
                      total={cardListTotalPages}
                      withEdges
                      siblings={1}
                      boundaries={1}
                      size="sm"
                    />
                  </Group>
                  {showLeaderBaseTiles ? (
                    <Stack gap="md">
                      <Group justify="space-between" align="center">
                        <Text size="sm" c="dimmed">
                          Leader tiles are shown first, then base tiles. Use the button on a tile to assign it to your current deck.
                        </Text>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => setLeaderBaseViewMode('main')}
                        >
                          Hide Leader/Base Tiles
                        </Button>
                      </Group>

                      <Stack gap="xs">
                        <Group justify="space-between" align="end">
                          <Text fw={700}>Leaders</Text>
                          <Text size="xs" c="dimmed">
                            {visibleLeaderCards.length} shown
                          </Text>
                        </Group>
                        {visibleLeaderCards.length < 1 ? (
                          <Text size="sm" c="dimmed">
                            No leaders match the current filters.
                          </Text>
                        ) : (
                          <Grid>
                            {visibleLeaderCards.map((card: CardItem) => {
                              const currentQty = getPoolQuantity(card.card_id);
                              const isSelectedCard = leaderCardId === card.card_id;
                              return (
                                <Grid.Col key={card.card_id} span={{ base: 12, sm: 6, xl: 4 }}>
                                  <Card
                                    withBorder
                                    radius="md"
                                    style={
                                      isSelectedCard
                                        ? { borderColor: 'var(--mantine-color-green-6)', borderWidth: 2 }
                                        : undefined
                                    }
                                  >
                                    <Stack gap="sm">
                                      {card.image_url != null ? (
                                        <Image
                                          src={card.image_url}
                                          h={220}
                                          fit="cover"
                                          radius="sm"
                                          style={{ cursor: 'zoom-in' }}
                                          onClick={() => {
                                            setPreviewImageLabel(
                                              `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}`
                                            );
                                            setPreviewImageUrl(card.image_url ?? null);
                                          }}
                                        />
                                      ) : (
                                        <Text size="sm" c="dimmed">
                                          No image
                                        </Text>
                                      )}
                                      <Stack gap={2}>
                                        <Text fw={700}>
                                          {card.name}
                                          {card.character_variant ? ` - ${card.character_variant}` : ''}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {card.set_code.toUpperCase()} • {card.rarity || '-'} • {card.card_id}
                                        </Text>
                                        <AspectIcons aspects={card.aspects ?? []} />
                                      </Stack>
                                      <Group justify="space-between" wrap="nowrap">
                                        <Text size="sm">Pool</Text>
                                        <NumberInput
                                          value={currentQty}
                                          min={0}
                                          max={99}
                                          w={96}
                                          disabled={isAdminAllOwnersView}
                                          onChange={(value) => {
                                            const numeric = Number(value ?? 0);
                                            addToPool(card.card_id, Number.isNaN(numeric) ? 0 : numeric);
                                          }}
                                        />
                                      </Group>
                                      <Button
                                        variant={isSelectedCard ? 'filled' : 'light'}
                                        color="green"
                                        onClick={() => setLeaderCardId(card.card_id)}
                                      >
                                        {isSelectedCard ? 'Leader Selected' : 'Set as Leader'}
                                      </Button>
                                    </Stack>
                                  </Card>
                                </Grid.Col>
                              );
                            })}
                          </Grid>
                        )}
                      </Stack>

                      <Stack gap="xs">
                        <Group justify="space-between" align="end">
                          <Text fw={700}>Bases</Text>
                          <Text size="xs" c="dimmed">
                            {visibleBaseCards.length} shown
                          </Text>
                        </Group>
                        {visibleBaseCards.length < 1 ? (
                          <Text size="sm" c="dimmed">
                            No bases match the current filters.
                          </Text>
                        ) : (
                          <Grid>
                            {visibleBaseCards.map((card: CardItem) => {
                              const currentQty = getPoolQuantity(card.card_id);
                              const isSelectedCard = baseCardId === card.card_id;
                              return (
                                <Grid.Col key={card.card_id} span={{ base: 12, sm: 6, xl: 4 }}>
                                  <Card
                                    withBorder
                                    radius="md"
                                    style={
                                      isSelectedCard
                                        ? { borderColor: 'var(--mantine-color-green-6)', borderWidth: 2 }
                                        : undefined
                                    }
                                  >
                                    <Stack gap="sm">
                                      {card.image_url != null ? (
                                        <Image
                                          src={card.image_url}
                                          h={220}
                                          fit="cover"
                                          radius="sm"
                                          style={{ cursor: 'zoom-in' }}
                                          onClick={() => {
                                            setPreviewImageLabel(
                                              `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}`
                                            );
                                            setPreviewImageUrl(card.image_url ?? null);
                                          }}
                                        />
                                      ) : (
                                        <Text size="sm" c="dimmed">
                                          No image
                                        </Text>
                                      )}
                                      <Stack gap={2}>
                                        <Text fw={700}>
                                          {card.name}
                                          {card.character_variant ? ` - ${card.character_variant}` : ''}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {card.set_code.toUpperCase()} • {card.rarity || '-'} • {card.card_id}
                                        </Text>
                                        <AspectIcons aspects={card.aspects ?? []} />
                                      </Stack>
                                      <Group justify="space-between" wrap="nowrap">
                                        <Text size="sm">Pool</Text>
                                        <NumberInput
                                          value={currentQty}
                                          min={0}
                                          max={99}
                                          w={96}
                                          disabled={isAdminAllOwnersView}
                                          onChange={(value) => {
                                            const numeric = Number(value ?? 0);
                                            addToPool(card.card_id, Number.isNaN(numeric) ? 0 : numeric);
                                          }}
                                        />
                                      </Group>
                                      <Button
                                        variant={isSelectedCard ? 'filled' : 'light'}
                                        color="green"
                                        onClick={() => setBaseCardId(card.card_id)}
                                      >
                                        {isSelectedCard ? 'Base Selected' : 'Set as Base'}
                                      </Button>
                                    </Stack>
                                  </Card>
                                </Grid.Col>
                              );
                            })}
                          </Grid>
                        )}
                      </Stack>
                    </Stack>
                  ) : (
                    <Table highlightOnHover stickyHeader>
                      <Table.Thead>
                        <Table.Tr>
                          {showCardImage && <Table.Th>Image</Table.Th>}
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('name')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Name</Text>
                              {sortIndicatorFor('name')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('type')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Type</Text>
                              {sortIndicatorFor('type')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('rarity')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Rarity</Text>
                              {sortIndicatorFor('rarity')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('cost')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Cost</Text>
                              {sortIndicatorFor('cost')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('power')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Power</Text>
                              {sortIndicatorFor('power')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('hp')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>HP</Text>
                              {sortIndicatorFor('hp')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('aspects')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Aspects</Text>
                              {sortIndicatorFor('aspects')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('arena')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Arena</Text>
                              {sortIndicatorFor('arena')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('set')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Set</Text>
                              {sortIndicatorFor('set')}
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ cursor: 'pointer' }} onClick={() => toggleCardSort('pool')}>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm" fw={600}>Pool</Text>
                              {sortIndicatorFor('pool')}
                            </Group>
                          </Table.Th>
                          <Table.Th>Main</Table.Th>
                          <Table.Th>Side</Table.Th>
                          <Table.Th></Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {visibleFilteredCards.map((card: CardItem) => {
                          const currentQty = getPoolQuantity(card.card_id);
                          const mainQty = mainboard[card.card_id] ?? 0;
                          const sideQty = sideboard[card.card_id] ?? 0;
                          const totalQty = mainQty + sideQty;
                          const cardIsLeaderOrBase = isLeaderOrBase(card);
                          const rowHighlightColor =
                            showPoolWarnings && totalQty > 0
                              ? currentQty <= 0
                                ? 'rgba(255, 0, 0, 0.12)'
                                : totalQty > currentQty
                                  ? 'rgba(255, 215, 0, 0.20)'
                                  : undefined
                              : undefined;
                          return (
                            <Table.Tr key={card.card_id} style={rowHighlightColor ? { backgroundColor: rowHighlightColor } : undefined}>
                              {showCardImage && (
                                <Table.Td>
                                  {card.image_url != null ? (
                                    <Image
                                      src={card.image_url}
                                      w={64}
                                      h={90}
                                      radius="sm"
                                      style={{ cursor: 'zoom-in' }}
                                      onClick={() => {
                                        setPreviewImageLabel(
                                          `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}`
                                        );
                                        setPreviewImageUrl(card.image_url ?? null);
                                      }}
                                    />
                                  ) : (
                                    <Text size="xs" c="dimmed">
                                      No image
                                    </Text>
                                  )}
                                </Table.Td>
                              )}
                              <Table.Td>
                                <Stack gap={0}>
                                  <Text fw={600}>{card.name}</Text>
                                  {card.character_variant != null && card.character_variant !== '' && (
                                    <Text size="xs" c="dimmed">
                                      {card.character_variant}
                                    </Text>
                                  )}
                                  <Group gap={6}>
                                    <Text size="xs" c="dimmed">
                                      {card.card_id}
                                    </Text>
                                  </Group>
                                </Stack>
                              </Table.Td>
                              <Table.Td>{card.type}</Table.Td>
                              <Table.Td>{card.rarity || '-'}</Table.Td>
                              <Table.Td>{card.cost ?? '-'}</Table.Td>
                              <Table.Td>{card.power ?? '-'}</Table.Td>
                              <Table.Td>{card.hp ?? '-'}</Table.Td>
                              <Table.Td>
                                <AspectIcons aspects={card.aspects ?? []} />
                              </Table.Td>
                              <Table.Td>{(card.arenas ?? []).join(', ') || '-'}</Table.Td>
                              <Table.Td>{card.set_code.toUpperCase()}</Table.Td>
                              <Table.Td>
                                <Group gap={4} wrap="nowrap">
                                  <NumberInput
                                    value={currentQty}
                                    min={0}
                                    max={99}
                                    w={86}
                                    disabled={isAdminAllOwnersView}
                                    onChange={(value) => {
                                      const numeric = Number(value ?? 0);
                                      addToPool(card.card_id, Number.isNaN(numeric) ? 0 : numeric);
                                    }}
                                  />
                                </Group>
                              </Table.Td>
                              <Table.Td>{mainQty}</Table.Td>
                              <Table.Td>{sideQty}</Table.Td>
                              <Table.Td>
                                <Group gap={4} justify="flex-end">
                                  <ActionIcon
                                    variant="light"
                                    color="green"
                                    disabled={cardIsLeaderOrBase}
                                    onClick={() => addCardToDeck(card.card_id, 'main')}
                                    title={cardIsLeaderOrBase ? 'Leader/Base cannot be in main deck' : 'Add to mainboard'}
                                  >
                                    <IconPlus size={14} />
                                  </ActionIcon>
                                  <ActionIcon
                                    variant="light"
                                    color="blue"
                                    onClick={() => addCardToDeck(card.card_id, 'side')}
                                    title="Add to sideboard"
                                  >
                                    <IconPlus size={14} />
                                  </ActionIcon>
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  )}
                </ScrollArea>
                <Group grow>
                  <Select
                    label="Card rows per page"
                    value={String(cardListRowsPerPage)}
                    onChange={(value) => {
                      const numeric = Number(value ?? DEFAULT_ROWS_PER_PAGE);
                      if (!Number.isFinite(numeric) || numeric <= 0) return;
                      setCardListRowsPerPage(normalizePageSize(numeric));
                    }}
                    data={PAGE_SIZE_OPTIONS.map((value) => ({ value: String(value), label: String(value) }))}
                  />
                  <Stack gap={4}>
                    <Select
                      label="Card visible lines mode"
                      value={cardListVisibleLinesMode}
                      onChange={(value) =>
                        setCardListVisibleLinesMode(value === 'fit' ? 'fit' : 'manual')
                      }
                      allowDeselect={false}
                      data={[
                        { value: 'manual', label: 'Manual' },
                        { value: 'fit', label: 'Fit to results' },
                      ]}
                    />
                    <NumberInput
                      label="Card table visible lines"
                      value={cardListVisibleLines}
                      min={MIN_VISIBLE_LINES}
                      max={MAX_VISIBLE_LINES}
                      disabled={cardListVisibleLinesMode === 'fit'}
                      description={
                        cardListVisibleLinesMode === 'fit'
                          ? `Auto-sized to ${visibleFilteredCards.length} row${visibleFilteredCards.length === 1 ? '' : 's'} on this page`
                          : undefined
                      }
                      onChange={(value) => {
                        const numeric = Number(value ?? DEFAULT_VISIBLE_LINES);
                        if (!Number.isFinite(numeric)) return;
                        setCardListVisibleLines(clampVisibleLines(numeric));
                      }}
                    />
                  </Stack>
                </Group>
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card withBorder>
              <Stack>
                <Title order={4}>Current Deck</Title>
                <TextInput label="Deck Name" value={deckName} onChange={(e) => setDeckName(e.currentTarget.value)} />
                <Select
                  searchable
                  label="Leader"
                  value={leaderCardId}
                  onChange={setLeaderCardId}
                  data={leaderOptions}
                />
                {leaderCard?.image_url != null && (
                  <Image
                    src={leaderCard.image_url}
                    h={130}
                    fit="contain"
                    radius="sm"
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => {
                      setPreviewImageLabel(
                        `${leaderCard.name}${leaderCard.character_variant ? ` - ${leaderCard.character_variant}` : ''}`
                      );
                      setPreviewImageUrl(leaderCard.image_url ?? null);
                    }}
                  />
                )}
                <Select
                  searchable
                  label="Base"
                  value={baseCardId}
                  onChange={onSelectBase}
                  data={baseSelectOptions}
                />
                {baseCard?.image_url != null && (
                  <Image
                    src={baseCard.image_url}
                    h={130}
                    fit="contain"
                    radius="sm"
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => {
                      setPreviewImageLabel(
                        `${baseCard.name}${baseCard.character_variant ? ` - ${baseCard.character_variant}` : ''}`
                      );
                      setPreviewImageUrl(baseCard.image_url ?? null);
                    }}
                  />
                )}
                <Group justify="space-between">
                  <Text>Mainboard ({countCards(mainboard)})</Text>
                  <Text size="sm" c="dimmed">
                    Sideboard ({countCards(sideboard)})
                  </Text>
                </Group>
                {renderDeckSection(
                  `Mainboard (${countCards(mainboard)})`,
                  mainDeckRows,
                  'main'
                )}
                {renderDeckSection(
                  `Sideboard (${countCards(sideboard)})`,
                  sideDeckRows,
                  'side'
                )}
                <Button
                  variant="outline"
                  disabled={deckRows.length < 1 || (isAdmin && isAdminAllOwnersView)}
                  onClick={() =>
                    addDeckToCardPool(
                      mainboard,
                      sideboard,
                      deckName.trim() === '' ? 'Current deck' : deckName,
                      isAdmin ? targetUserId ?? undefined : currentUserId
                    )
                  }
                >
                  Add Current Deck to Card Pool
                </Button>
                <Group grow>
                  <Button
                    variant="outline"
                    onClick={onExportCardPoolJson}
                    disabled={cardPoolExportRows.length < 1}
                  >
                    Export Card Pool SWUDB JSON
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onExportCardPoolTxt}
                    disabled={cardPoolExportRows.length < 1}
                  >
                    Export Card Pool TXT
                  </Button>
                </Group>

                <Button onClick={onSaveDeck} disabled={leaderCardId == null || baseCardId == null}>
                  Save Deck
                </Button>
                <Button
                  variant="outline"
                  onClick={onCopyCurrentDeckJson}
                  disabled={leaderCardId == null || baseCardId == null}
                >
                  Copy Deck JSON
                </Button>
                <Button
                  variant="light"
                  color="red"
                  onClick={onClearCurrentDeck}
                  disabled={
                    leaderCardId == null &&
                    baseCardId == null &&
                    Object.keys(mainboard).length < 1 &&
                    Object.keys(sideboard).length < 1
                  }
                >
                  Clear Deck
                </Button>
                {poolViolations.length > 0 && (
                  <Text size="sm" c="yellow">
                    Save warning: {poolViolations.length} card-pool issue(s) detected ({poolViolations.filter((item) => item.reason === 'missing').length} missing, {poolViolations.filter((item) => item.reason === 'excess').length} over limit).
                  </Text>
                )}
                <Button
                  variant="outline"
                  onClick={onSubmitEntry}
                  disabled={!hasTournament || leaderCardId == null || baseCardId == null}
                >
                  Submit Tournament Entry
                </Button>
              </Stack>
            </Card>

            <Card mt="md" withBorder>
              <Stack>
                <Title order={5}>Saved Decks</Title>
                {!isAdminAllOwnersView ? (
                  <Group justify="space-between" align="end">
                    <Text size="sm" c="dimmed">
                      {managedUserApplication == null
                        ? 'Current Deck: Not set'
                        : managedUserCurrentDeck != null
                          ? `Current Deck: ${managedUserCurrentDeck.name}`
                          : `Current Deck: ${managedUserApplication.deck_name ?? `Deck #${managedUserCurrentDeckId ?? '-'}`}`}
                    </Text>
                    {managedUserCurrentDeck != null ? (
                      <Button size="xs" variant="light" onClick={() => loadDeckIntoEditor(managedUserCurrentDeck)}>
                        Load Current Deck
                      </Button>
                    ) : null}
                  </Group>
                ) : (
                  <Text size="sm" c="dimmed">
                    Current deck badges are shown per user in the list below.
                  </Text>
                )}
                <Textarea
                  label="Import SWUDB JSON"
                  placeholder='Paste JSON, then click "Import JSON"'
                  minRows={4}
                  value={swudbImportJson}
                  onChange={(event) => setSwudbImportJson(event.currentTarget.value)}
                />
                <Button variant="outline" onClick={onImportSwuDb} disabled={swudbImportJson.trim() === ''}>
                  Import JSON
                </Button>
                <ScrollArea h={180}>
                  <Stack gap="xs">
                    {(decks as any[]).map((deck: any) => (
                      <Card key={deck.id} withBorder>
                        {(() => {
                          const leaderLabel = resolveCardDisplayName(deck.leader);
                          const baseLabel = resolveCardDisplayName(deck.base);
                          return (
                        <Group justify="space-between" align="start">
                          <Stack gap={0}>
                            <Text fw={600}>{deck.name}</Text>
                            {currentDeckIdByUserId[Number(deck.user_id ?? 0)] === Number(deck.id) ? (
                              <Badge color="green" variant="light" mt={4}>
                                Current Deck
                              </Badge>
                            ) : null}
                            <Text size="xs" c="dimmed">
                              {leaderLabel} / {baseLabel}
                            </Text>
                            <Text size="xs" c="dimmed">
                              Record: {deck.wins ?? 0}-{deck.draws ?? 0}-{deck.losses ?? 0} (
                              {deck.matches ?? 0} matches, {(deck.win_percentage ?? 0).toFixed(2)}% win rate,{' '}
                              {deck.tournaments_submitted ?? 0} events submitted)
                            </Text>
                            {(deck.updated ?? deck.created) != null && (
                              <Text size="xs" c="dimmed">
                                Updated:{' '}
                                <DateTime
                                  datetime={String(deck.updated ?? deck.created)}
                                />
                              </Text>
                            )}
                            {isAdmin && (
                              <Text size="xs" c="dimmed">
                                {deck.user_name}
                              </Text>
                            )}
                          </Stack>
                          <Group gap={4}>
                            {isAdmin && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={isAdminAllOwnersView}
                                onClick={async () => {
                                  await addDeckToCardPool(
                                    deck.mainboard ?? {},
                                    deck.sideboard ?? {},
                                    String(deck.name ?? 'Saved deck').trim() || 'Saved deck',
                                    Number(deck.user_id ?? 0)
                                  );
                                }}
                              >
                                Add to Pool
                              </Button>
                            )}
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => loadDeckIntoEditor(deck)}
                            >
                              Load
                            </Button>
                            <Button
                              size="xs"
                              variant={
                                currentDeckIdByUserId[Number(deck.user_id ?? 0)] === Number(deck.id)
                                  ? 'filled'
                                  : 'outline'
                              }
                              color={
                                currentDeckIdByUserId[Number(deck.user_id ?? 0)] === Number(deck.id)
                                  ? 'green'
                                  : undefined
                              }
                              onClick={async () => onSetCurrentDeck(deck)}
                              disabled={!hasTournament}
                            >
                              {currentDeckIdByUserId[Number(deck.user_id ?? 0)] === Number(deck.id)
                                ? 'Current Deck'
                                : 'Set Current'}
                            </Button>
                            <Button
                              size="xs"
                              variant="subtle"
                              onClick={() => onRenameSavedDeck(deck)}
                            >
                              Rename
                            </Button>
                            <Button size="xs" variant="subtle" onClick={() => onExportSwuDb(deck)}>
                              Copy JSON
                            </Button>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={async () => {
                                const response = await deleteDeck(activeTournamentId, deck.id);
                                if (response == null) return;
                                await Promise.all([
                                  swrDecksResponse.mutate(),
                                  swrApplicationsResponse.mutate(),
                                ]);
                                showNotification({
                                  color: 'green',
                                  title: 'Deck deleted',
                                  message: '',
                                });
                              }}
                            >
                              <IconTrash size={15} />
                            </ActionIcon>
                          </Group>
                        </Group>
                          );
                        })()}
                      </Card>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Card withBorder>
          <Stack>
            <Group justify="space-between" align="start">
              <Stack gap={2}>
                <Title order={4}>Composition Analytics</Title>
                <Text size="xs" c="dimmed">
                  Toggle between your current deck and full card pool to plan builds against the current season meta.
                </Text>
              </Stack>
              <Group>
                <SegmentedControl
                  value={analyticsScope}
                  onChange={(value) => setAnalyticsScope(value as 'deck' | 'pool')}
                  data={[
                    { value: 'deck', label: 'Current Deck' },
                    { value: 'pool', label: 'Total Card Pool' },
                  ]}
                />
                <SegmentedControl
                  value={graphView}
                  onChange={(value) => setGraphView(value as DeckGraphView)}
                  data={[
                    { value: 'cost', label: 'By Cost' },
                    { value: 'power', label: 'By Power' },
                    { value: 'hp', label: 'By HP' },
                    { value: 'type', label: 'By Type' },
                    { value: 'rarity', label: 'By Rarity' },
                    { value: 'aspect', label: 'By Aspect' },
                    { value: 'alignment', label: 'By Alignment' },
                    { value: 'out_aspect', label: 'Aspect Fit' },
                    { value: 'synergy', label: 'Synergy' },
                    { value: 'arena', label: 'By Arena' },
                  ]}
                />
                <Select
                  label="Sort"
                  value={analyticsSortBy}
                  onChange={(value) => setAnalyticsSortBy(value === 'label' ? 'label' : 'value')}
                  allowDeselect={false}
                  data={[
                    { value: 'label', label: 'Category' },
                    { value: 'value', label: 'Card count' },
                  ]}
                />
                <SegmentedControl
                  value={analyticsSortDirection}
                  onChange={(value) => setAnalyticsSortDirection(value === 'asc' ? 'asc' : 'desc')}
                  data={[
                    { value: 'asc', label: 'Asc' },
                    { value: 'desc', label: 'Desc' },
                  ]}
                />
              </Group>
            </Group>
            <Group gap={8}>
              <Badge color={analyticsScope === 'deck' ? 'blue' : 'teal'} variant="light">
                {analyticsScope === 'deck' ? 'Deck Scope' : 'Pool Scope'}
              </Badge>
              <Badge variant="light">
                {activeMetrics.totalQty} total copies
              </Badge>
              <Badge variant="light">
                {activeMetrics.uniqueCardCount} unique cards
              </Badge>
              {analyticsScope === 'pool' ? (
                <Badge color="indigo" variant="light">
                  Top-30 Meta Card Coverage: {poolMetaOverlap.owned}/{poolMetaOverlap.considered}
                </Badge>
              ) : null}
            </Group>
            {graphContent}
            {analyticsScope === 'pool' ? (
              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder>
                    <Stack>
                      <Text fw={600}>Pool by Aspect</Text>
                      <GraphBars
                        data={poolMetrics.byAspect}
                        total={poolMetrics.totalQty}
                        emptyMessage="No card pool data for aspects yet."
                        sortBy={analyticsSortBy}
                        sortDirection={analyticsSortDirection}
                      />
                    </Stack>
                  </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder>
                    <Stack>
                      <Text fw={600}>Pool by Alignment</Text>
                      <GraphBars
                        data={poolMetrics.byAlignment}
                        total={poolMetrics.totalQty}
                        emptyMessage="No card pool alignment data yet."
                        sortBy={analyticsSortBy}
                        sortDirection={analyticsSortDirection}
                      />
                    </Stack>
                  </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder>
                    <Stack>
                      <Text fw={600}>Pool Synergy Depth</Text>
                      <GraphBars
                        data={poolMetrics.bySynergy.slice(0, 12)}
                        total={poolMetrics.totalQty}
                        emptyMessage="No trait/keyword synergy data yet."
                        sortBy={analyticsSortBy}
                        sortDirection={analyticsSortDirection}
                      />
                    </Stack>
                  </Card>
                </Grid.Col>
              </Grid>
            ) : null}
          </Stack>
        </Card>
        <Card withBorder>
          <Stack>
            <Group justify="space-between" align="start">
              <Title order={4}>Current Season Meta Build Guidance</Title>
              {metaAnalysis != null ? (
                <Group gap={8}>
                  <Badge variant="light">{String(metaAnalysis.season_name ?? 'Season')}</Badge>
                  <Badge color="grape" variant="light">
                    {Number(metaAnalysis.total_decks ?? 0)} decks analyzed
                  </Badge>
                </Group>
              ) : null}
            </Group>
            {swrMetaAnalysisResponse.isLoading ? (
              <Text size="sm" c="dimmed">
                Loading current season meta insights...
              </Text>
            ) : null}
            {!swrMetaAnalysisResponse.isLoading && metaAnalysis == null ? (
              <Text size="sm" c="dimmed">
                Meta analysis is not available yet for this season.
              </Text>
            ) : null}
            {metaAnalysis != null ? (
              <>
                {poolMetaOverlap.considered > 0 ? (
                  <Stack gap={4}>
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>
                        Pool Coverage of Top 30 Meta Cards
                      </Text>
                      <Text size="xs" c="dimmed">
                        {poolMetaOverlap.owned}/{poolMetaOverlap.considered} ({poolMetaOverlap.pct.toFixed(1)}%)
                      </Text>
                    </Group>
                    <Progress value={poolMetaOverlap.pct} />
                  </Stack>
                ) : null}
                <Stack gap={4}>
                  <Text fw={600} size="sm">
                    Helpful Build Notes
                  </Text>
                  {poolBuildGuidance.length > 0 ? (
                    poolBuildGuidance.map((line, index) => (
                      <Text size="sm" key={`pool-guidance-${index}`}>
                        {line}
                      </Text>
                    ))
                  ) : (
                    <Text size="sm" c="dimmed">
                      Build guidance will appear once your card pool and season meta data are available.
                    </Text>
                  )}
                </Stack>
                <Grid>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Stack gap={6}>
                      <Text fw={600} size="sm">
                        Strong Leaders In Current Meta
                      </Text>
                      <Group gap={6}>
                        {metaTopLeaders.length > 0 ? (
                          metaTopLeaders.map((row: any) => (
                            <Badge key={`meta-leader-${String(row?.card_id ?? row?.card_name ?? '')}`} color="blue" variant="light">
                              {String(row?.card_name ?? 'Unknown')}: {Number(row?.win_rate ?? 0).toFixed(2)}%
                            </Badge>
                          ))
                        ) : (
                          <Text size="sm" c="dimmed">
                            No leader meta rows yet.
                          </Text>
                        )}
                      </Group>
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Stack gap={6}>
                      <Text fw={600} size="sm">
                        Positive Meta Keywords
                      </Text>
                      <Group gap={6}>
                        {metaKeywordImpact.length > 0 ? (
                          metaKeywordImpact.map((row: any) => (
                            <Badge key={`meta-keyword-${String(row?.keyword ?? '')}`} color="teal" variant="light">
                              {String(row?.keyword ?? 'Keyword')}: +{Number(row?.win_impact_score ?? 0).toFixed(2)}
                            </Badge>
                          ))
                        ) : (
                          <Text size="sm" c="dimmed">
                            No keyword impact rows yet.
                          </Text>
                        )}
                      </Group>
                    </Stack>
                  </Grid.Col>
                </Grid>
                {metaTakeaways.length > 0 ? (
                  <Stack gap={4}>
                    <Text fw={600} size="sm">
                      Meta Takeaways
                    </Text>
                    {metaTakeaways.map((line: string, index: number) => (
                      <Text size="sm" key={`meta-takeaway-${index}`}>
                        {line}
                      </Text>
                    ))}
                  </Stack>
                ) : null}
              </>
            ) : null}
          </Stack>
        </Card>
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }

  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
