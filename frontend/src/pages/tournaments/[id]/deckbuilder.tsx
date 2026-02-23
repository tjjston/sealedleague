import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
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
  getLeagueSeasons,
  getTournaments,
  getUser,
} from '@services/adapter';
import {
  deleteDeck,
  exportDeckSwuDb,
  importDeckSwuDb,
  saveDeck,
  submitLeagueEntry,
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

const HEROIC_ASPECT_VALUES = new Set(['heroic', 'heroism']);
const VILLAINY_ASPECT_VALUES = new Set(['villainy']);
const DEFAULT_ASPECT_OPTIONS = ['Aggression', 'Cunning', 'Command', 'Vigilance'];
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
const ALL_DECK_OWNERS_VALUE = '__ALL__';
const ALL_SEASONS_VALUE = '__ALL_SEASONS__';

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

function getTableHeightFromVisibleLines(visibleLines: number) {
  return TABLE_BASE_HEIGHT + clampVisibleLines(visibleLines) * TABLE_ROW_HEIGHT;
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
}: {
  data: Array<{ label: string; value: number }>;
  total: number;
}) {
  if (data.length < 1 || total <= 0) {
    return (
      <Text size="sm" c="dimmed">
        Add cards to your deck to see analytics.
      </Text>
    );
  }

  return (
    <Stack>
      {data.map((row) => (
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

  const allCards: CardItem[] = swrCatalogResponse.data?.data?.cards ?? [];
  const decks = swrDecksResponse.data?.data ?? [];
  const cardPoolEntries = swrCardPoolResponse.data?.data ?? [];

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
  const [aspectFilter, setAspectFilter] = useState<string | null>(null);
  const [alignmentFilter, setAlignmentFilter] = useState<AlignmentFilter | null>(null);
  const [cardSortKey, setCardSortKey] = useState<CardSortKey>('set');
  const [cardSortDirection, setCardSortDirection] = useState<SortDirection>('desc');
  const [selectedCosts, setSelectedCosts] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [arenaFilter, setArenaFilter] = useState<string | null>(null);

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

  const [deckName, setDeckName] = useState('League Deck');
  const [leaderCardId, setLeaderCardId] = useState<string | null>(null);
  const [baseCardId, setBaseCardId] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<Record<string, number>>({});
  const [sideboard, setSideboard] = useState<Record<string, number>>({});

  const [graphView, setGraphView] = useState<DeckGraphView>('cost');
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
      [...new Set(allCards.map((card: CardItem) => card.type).filter((value) => value != null && value !== ''))]
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
    const normalizedAspectFilter = (aspectFilter ?? '').trim().toLowerCase();
    const selectedTypeSet = new Set(selectedTypes);
    const selectedRaritySet = new Set(selectedRarities);
    const selectedSetSet = new Set(selectedSets);
    const selectedCostSet = new Set(selectedCosts.map((value) => Number(value)));
    const selectedTraitSet = new Set(selectedTraits.map((value) => value.toLowerCase()));
    const selectedKeywordSet = new Set(selectedKeywords.map((value) => value.toLowerCase()));

    return allCards
      .filter((card: CardItem) => {
        const name = card.name.toLowerCase();
        const variant = (card.character_variant ?? '').toLowerCase();
        const rules = (card.rules_text ?? '').toLowerCase();
        const type = card.type.toLowerCase();
        const aspects = (card.aspects ?? []).map((value) => value.toLowerCase());
        const traits = (card.traits ?? []).map((value) => value.toLowerCase());
        const keywords = (card.keywords ?? []).map((value) => value.toLowerCase());
        const arenas = (card.arenas ?? []).map((value) => value.toLowerCase());
        const rarity = (card.rarity ?? '').toLowerCase();

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
        if (normalizedAspectFilter !== '' && !aspects.includes(normalizedAspectFilter)) {
          return false;
        }
        if (alignmentFilter != null) {
          const hasHeroic = aspects.some((value) => HEROIC_ASPECT_VALUES.has(value));
          const hasVillainy = aspects.some((value) => VILLAINY_ASPECT_VALUES.has(value));
          const alignment: AlignmentFilter = hasVillainy
            ? 'villainy'
            : hasHeroic
              ? 'heroic'
              : 'neither';
          if (alignment !== alignmentFilter) {
            return false;
          }
        }
        if (selectedCostSet.size > 0 && (card.cost == null || !selectedCostSet.has(card.cost))) {
          return false;
        }
        if (selectedTypeSet.size > 0 && !selectedTypeSet.has(card.type)) return false;
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
    aspectFilter,
    alignmentFilter,
    selectedCosts,
    selectedTypes,
    selectedRarities,
    selectedSets,
    arenaFilter,
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
  const cardListTableHeight = useMemo(
    () => getTableHeightFromVisibleLines(cardListVisibleLines),
    [cardListVisibleLines]
  );
  const cardListStart = cappedFilteredCards.length < 1 ? 0 : (cardListPage - 1) * cardListRowsPerPage + 1;
  const cardListEnd = Math.min(cardListPage * cardListRowsPerPage, cappedFilteredCards.length);

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

  async function onExportSwuDb(deckId: number) {
    if (!hasTournament) return;
    const response = await exportDeckSwuDb(activeTournamentId, deckId);
    // @ts-ignore
    const payload = response?.data;
    if (payload == null) return;
    const json = JSON.stringify(payload, null, 2);
    await navigator.clipboard.writeText(json);
    showNotification({
      color: 'green',
      title: 'Exported SWUDB JSON',
      message: 'Deck JSON copied to clipboard.',
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

  const deckMetrics = useMemo(() => {
    const deckEntries = deckRows
      .map((row) => {
        const resolvedCardId = resolveCatalogCardId(row.card_id);
        const effectiveCardId = resolvedCardId !== '' ? resolvedCardId : row.card_id;
        return { row, card: cardsById[effectiveCardId] };
      })
      .filter((x) => x.card != null);
    const totalQty = deckEntries.reduce((sum, x) => sum + x.row.qty, 0);

    const byCost = aggregateCountMap(
      deckEntries.map((x) => [String(x.card?.cost ?? '-'), x.row.qty])
    );
    const byPower = aggregateCountMap(
      deckEntries.map((x) => [String(x.card?.power ?? '-'), x.row.qty])
    );
    const byHp = aggregateCountMap(deckEntries.map((x) => [String(x.card?.hp ?? '-'), x.row.qty]));
    const byType = aggregateCountMap(deckEntries.map((x) => [x.card?.type ?? 'Unknown', x.row.qty]));
    const byRarity = aggregateCountMap(deckEntries.map((x) => [x.card?.rarity ?? 'Unknown', x.row.qty]));
    const byArena = aggregateCountMap(
      deckEntries.flatMap((x) => {
        const arenas = x.card?.arenas ?? [];
        if (arenas.length < 1) return [['None', x.row.qty] as [string, number]];
        return arenas.map((arena) => [arena, x.row.qty] as [string, number]);
      })
    );

    const keywordTrait = aggregateCountMap(
      deckEntries.flatMap((x) => [
        ...(x.card?.keywords ?? []).map((value) => [`Keyword: ${value}`, x.row.qty] as [string, number]),
        ...(x.card?.traits ?? []).map((value) => [`Trait: ${value}`, x.row.qty] as [string, number]),
      ])
    );

    const outOfAspect = deckEntries.reduce((sum, x) => {
      const cardAspects = (x.card?.aspects ?? []).map((a) => a.toLowerCase());
      const invalid = cardAspects.some((aspect) => !allowedAspects.has(aspect));
      return invalid ? sum + x.row.qty : sum;
    }, 0);

    const inAspect = totalQty - outOfAspect;

    const toSortedRows = (mapping: Record<string, number>) =>
      Object.entries(mapping)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);

    return {
      totalQty,
      byCost: toSortedRows(byCost),
      byPower: toSortedRows(byPower),
      byHp: toSortedRows(byHp),
      byType: toSortedRows(byType),
      byRarity: toSortedRows(byRarity),
      byArena: toSortedRows(byArena),
      bySynergy: toSortedRows(keywordTrait).slice(0, 20),
      outAspectRows: [
        { label: 'In Aspect', value: inAspect < 0 ? 0 : inAspect },
        { label: 'Out of Aspect', value: outOfAspect },
      ],
    };
  }, [deckRows, cardsById, allowedAspects, cardIdByLookupKey]);

  let graphContent = null;
  if (graphView === 'cost') {
    graphContent = <GraphBars data={deckMetrics.byCost} total={deckMetrics.totalQty} />;
  } else if (graphView === 'power') {
    graphContent = <GraphBars data={deckMetrics.byPower} total={deckMetrics.totalQty} />;
  } else if (graphView === 'hp') {
    graphContent = <GraphBars data={deckMetrics.byHp} total={deckMetrics.totalQty} />;
  } else if (graphView === 'type') {
    graphContent = <GraphBars data={deckMetrics.byType} total={deckMetrics.totalQty} />;
  } else if (graphView === 'rarity') {
    graphContent = <GraphBars data={deckMetrics.byRarity} total={deckMetrics.totalQty} />;
  } else if (graphView === 'out_aspect') {
    graphContent = <GraphBars data={deckMetrics.outAspectRows} total={deckMetrics.totalQty} />;
  } else if (graphView === 'synergy') {
    graphContent = <GraphBars data={deckMetrics.bySynergy} total={deckMetrics.totalQty} />;
  } else {
    graphContent = <GraphBars data={deckMetrics.byArena} total={deckMetrics.totalQty} />;
  }

  async function onExportAnalyticsJson() {
    const payload = {
      deck_name: deckName,
      leader: leaderCard?.card_id ?? null,
      base: baseCard?.card_id ?? null,
      total_cards: deckMetrics.totalQty,
      by_cost: deckMetrics.byCost,
      by_power: deckMetrics.byPower,
      by_hp: deckMetrics.byHp,
      by_type: deckMetrics.byType,
      by_rarity: deckMetrics.byRarity,
      aspect_fit: deckMetrics.outAspectRows,
      synergy: deckMetrics.bySynergy,
      by_arena: deckMetrics.byArena,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    showNotification({ color: 'green', title: 'Analytics JSON copied', message: '' });
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
    await swrDecksResponse.mutate();
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
                    <Stack gap={0}>
                      <Text size="sm">{card?.name ?? resolveCardDisplayName(row.card_id)}</Text>
                      {card?.character_variant != null && card.character_variant !== '' ? (
                        <Text size="xs" c="dimmed">
                          {card.character_variant}
                        </Text>
                      ) : null}
                    </Stack>
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
                  <Select
                    label="Aspect"
                    data={aspectOptions}
                    value={aspectFilter}
                    onChange={setAspectFilter}
                    clearable
                    searchable
                  />
                  <Select
                    label="Alignment"
                    value={alignmentFilter}
                    onChange={(value) => setAlignmentFilter((value as AlignmentFilter | null) ?? null)}
                    data={[
                      { value: 'heroic', label: 'Heroic' },
                      { value: 'villainy', label: 'Villainy' },
                      { value: 'neither', label: 'Neither' },
                    ]}
                    clearable
                  />
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
                  <NumberInput
                    label="Card table visible lines"
                    value={cardListVisibleLines}
                    min={MIN_VISIBLE_LINES}
                    max={MAX_VISIBLE_LINES}
                    onChange={(value) => {
                      const numeric = Number(value ?? DEFAULT_VISIBLE_LINES);
                      if (!Number.isFinite(numeric)) return;
                      setCardListVisibleLines(clampVisibleLines(numeric));
                    }}
                  />
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
                <Select searchable label="Base" value={baseCardId} onChange={setBaseCardId} data={baseOptions} />
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

                <Button onClick={onSaveDeck} disabled={leaderCardId == null || baseCardId == null}>
                  Save Deck
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
                              onClick={() => {
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
                              }}
                            >
                              Load
                            </Button>
                            <Button size="xs" variant="subtle" onClick={() => onExportSwuDb(deck.id)}>
                              Export JSON
                            </Button>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={async () => {
                                const response = await deleteDeck(activeTournamentId, deck.id);
                                if (response == null) return;
                                await swrDecksResponse.mutate();
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
            <Group justify="space-between">
              <Title order={4}>Deck Composition Analytics</Title>
              <Group>
                <Button variant="outline" size="xs" onClick={onExportAnalyticsJson}>
                  Export Analytics JSON
                </Button>
                <SegmentedControl
                  value={graphView}
                  onChange={(value) => setGraphView(value as DeckGraphView)}
                  data={[
                    { value: 'cost', label: 'By Cost' },
                    { value: 'power', label: 'By Power' },
                    { value: 'hp', label: 'By HP' },
                    { value: 'type', label: 'By Type' },
                    { value: 'rarity', label: 'By Rarity' },
                    { value: 'out_aspect', label: 'Aspect Fit' },
                    { value: 'synergy', label: 'Synergy' },
                    { value: 'arena', label: 'By Arena' },
                  ]}
                />
              </Group>
            </Group>
            {graphContent}
          </Stack>
        </Card>
    </Stack>
  );

  if (standalone) {
    return <Layout>{content}</Layout>;
  }

  return <TournamentLayout tournament_id={activeTournamentId}>{content}</TournamentLayout>;
}
