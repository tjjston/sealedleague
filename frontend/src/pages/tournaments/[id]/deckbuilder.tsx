import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  Image,
  NumberInput,
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
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import { useEffect, useMemo, useState } from 'react';

import { getTournamentIdFromRouter } from '@components/utils/util';
import Layout from '@pages/_layout';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getLeagueAdminUsers,
  getLeagueCardPool,
  getLeagueCards,
  getLeagueDecks,
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
  number: string;
  type: string;
  rarity: string;
  cost: number | null;
  aspects: string[];
  traits: string[];
  keywords: string[];
  arenas: string[];
  rules_text: string;
  image_url?: string | null;
};

type DeckGraphView = 'cost' | 'type' | 'rarity' | 'out_aspect' | 'synergy' | 'arena';

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
  const hasTournament = Number.isFinite(activeTournamentId) && activeTournamentId > 0;

  const swrCurrentUserResponse = getUser();
  const swrAdminUsersResponse = getLeagueAdminUsers(activeTournamentId);
  const isAdmin = swrAdminUsersResponse.data != null;
  const adminUsers = swrAdminUsersResponse.data?.data ?? [];

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    const currentId = swrCurrentUserResponse.data?.data?.id;
    if (currentId == null) return;

    if (!isAdmin) {
      setSelectedUserId(String(currentId));
      return;
    }

    if (selectedUserId == null && adminUsers.length > 0) {
      const exists = adminUsers.some((user: any) => user.user_id === currentId);
      setSelectedUserId(String(exists ? currentId : adminUsers[0].user_id));
    }
  }, [swrCurrentUserResponse.data, isAdmin, selectedUserId, adminUsers]);

  const targetUserId = isAdmin && selectedUserId != null ? Number(selectedUserId) : null;

  const swrCatalogResponse = getLeagueCards(hasTournament ? activeTournamentId : null, {
    limit: 5000,
    offset: 0,
  });
  const swrCardPoolResponse = getLeagueCardPool(hasTournament ? activeTournamentId : null, targetUserId);
  const swrDecksResponse = getLeagueDecks(hasTournament ? activeTournamentId : null, targetUserId);

  const allCards: CardItem[] = swrCatalogResponse.data?.data?.cards ?? [];
  const decks = swrDecksResponse.data?.data ?? [];
  const cardPoolEntries = swrCardPoolResponse.data?.data ?? [];

  const cardsById = useMemo(() => {
    return (allCards as CardItem[]).reduce((result: Record<string, CardItem>, card: CardItem) => {
      result[card.card_id] = card;
      return result;
    }, {});
  }, [allCards]);

  const cardPoolMap = useMemo(() => {
    return (cardPoolEntries as any[]).reduce((result: Record<string, number>, entry: any) => {
      result[entry.card_id] = entry.quantity;
      return result;
    }, {});
  }, [cardPoolEntries]);

  const [query, setQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [rulesQuery, setRulesQuery] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [traitQuery, setTraitQuery] = useState('');
  const [aspectQuery, setAspectQuery] = useState('');
  const [costQuery, setCostQuery] = useState<number | ''>('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [arenaFilter, setArenaFilter] = useState<string | null>(null);

  const [showCardImage, setShowCardImage] = useState(false);
  const [onlyLegalCards, setOnlyLegalCards] = useState(false);
  const [onlyCardsInPool, setOnlyCardsInPool] = useState(false);

  const [deckName, setDeckName] = useState('League Deck');
  const [leaderCardId, setLeaderCardId] = useState<string | null>(null);
  const [baseCardId, setBaseCardId] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<Record<string, number>>({});
  const [sideboard, setSideboard] = useState<Record<string, number>>({});

  const [graphView, setGraphView] = useState<DeckGraphView>('cost');
  const [swudbImportJson, setSwudbImportJson] = useState('');

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

  const leaderOptions = useMemo(
    () =>
      allCards
        .filter((card: CardItem) => card.type.toLowerCase() === 'leader')
        .map((card: CardItem) => ({
          value: card.card_id,
          label: `${card.name} (${card.set_code.toUpperCase()})`,
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
          label: `${card.name} (${card.set_code.toUpperCase()})`,
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
    const normalizedKeyword = keywordQuery.trim().toLowerCase();
    const normalizedTrait = traitQuery.trim().toLowerCase();
    const normalizedAspect = aspectQuery.trim().toLowerCase();

    return allCards
      .filter((card: CardItem) => {
        const name = card.name.toLowerCase();
        const rules = (card.rules_text ?? '').toLowerCase();
        const type = card.type.toLowerCase();
        const aspects = (card.aspects ?? []).map((value) => value.toLowerCase());
        const traits = (card.traits ?? []).map((value) => value.toLowerCase());
        const keywords = (card.keywords ?? []).map((value) => value.toLowerCase());
        const arenas = (card.arenas ?? []).map((value) => value.toLowerCase());
        const rarity = (card.rarity ?? '').toLowerCase();

        if (normalizedQuery !== '') {
          const haystack = `${name} ${rules} ${type} ${rarity} ${aspects.join(' ')} ${traits.join(' ')} ${keywords.join(' ')} ${arenas.join(' ')}`;
          if (!haystack.includes(normalizedQuery)) return false;
        }
        if (normalizedName !== '' && !name.includes(normalizedName)) return false;
        if (normalizedRules !== '' && !rules.includes(normalizedRules)) return false;
        if (normalizedKeyword !== '' && !keywords.some((value) => value.includes(normalizedKeyword))) {
          return false;
        }
        if (normalizedTrait !== '' && !traits.some((value) => value.includes(normalizedTrait))) {
          return false;
        }
        if (normalizedAspect !== '' && !aspects.some((value) => value.includes(normalizedAspect))) {
          return false;
        }
        if (costQuery !== '' && card.cost !== Number(costQuery)) return false;
        if (typeFilter != null && card.type !== typeFilter) return false;
        if (rarityFilter != null && card.rarity !== rarityFilter) return false;
        if (setFilter != null && card.set_code !== setFilter) return false;
        if (arenaFilter != null && !(card.arenas ?? []).includes(arenaFilter)) return false;
        if (onlyCardsInPool && (cardPoolMap[card.card_id] ?? 0) <= 0) return false;

        if (onlyLegalCards) {
          if (allowedAspects.size < 1) return false;
          const cardAspects = (card.aspects ?? []).map((value) => value.toLowerCase());
          if (cardAspects.some((value) => !allowedAspects.has(value))) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const nameSort = a.name.localeCompare(b.name);
        if (nameSort !== 0) return nameSort;
        return (a.cost ?? 999) - (b.cost ?? 999);
      });
  }, [
    allCards,
    query,
    nameQuery,
    rulesQuery,
    keywordQuery,
    traitQuery,
    aspectQuery,
    costQuery,
    typeFilter,
    rarityFilter,
    setFilter,
    arenaFilter,
    onlyCardsInPool,
    cardPoolMap,
    onlyLegalCards,
    allowedAspects,
  ]);

  async function addToPool(cardId: string, nextQuantity: number) {
    if (!hasTournament) return;
    await upsertCardPoolEntry(activeTournamentId, cardId, nextQuantity, targetUserId ?? undefined);
    await swrCardPoolResponse.mutate();
  }

  function addCardToDeck(cardId: string, side: 'main' | 'side') {
    const card = cardsById[cardId];
    if (side === 'main' && isLeaderOrBase(card)) {
      return;
    }

    if (side === 'main') {
      setMainboard((prev) => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }));
      return;
    }
    setSideboard((prev) => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }));
  }

  function removeCardFromDeck(cardId: string, side: 'main' | 'side') {
    const update = (prev: Record<string, number>) => {
      const current = prev[cardId] ?? 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[cardId];
        return next;
      }
      return { ...prev, [cardId]: current - 1 };
    };

    if (side === 'main') {
      setMainboard(update);
      return;
    }
    setSideboard(update);
  }

  async function onSaveDeck() {
    if (!hasTournament || leaderCard == null || baseCard == null) return;

    await saveDeck(activeTournamentId, {
      user_id: targetUserId ?? undefined,
      tournament_id: activeTournamentId,
      name: deckName,
      leader: leaderCard.card_id,
      base: baseCard.card_id,
      leader_image_url: leaderCard.image_url ?? undefined,
      mainboard,
      sideboard,
    });
    await swrDecksResponse.mutate();
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
    if (!hasTournament) return;
    try {
      const parsed = JSON.parse(swudbImportJson);
      const leader = parsed.leader?.id ?? parsed.leader;
      const base = parsed.base?.id ?? parsed.base;
      const deck = Array.isArray(parsed.deck) ? parsed.deck : [];
      const sideboard = Array.isArray(parsed.sideboard) ? parsed.sideboard : [];
      await importDeckSwuDb(activeTournamentId, {
        user_id: targetUserId ?? undefined,
        name: parsed.name ?? `Imported Deck ${new Date().toISOString()}`,
        leader,
        base,
        deck,
        sideboard,
      });
      await swrDecksResponse.mutate();
      showNotification({ color: 'green', title: 'Import successful', message: '' });
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
      const cardA = cardsById[a.card_id];
      const cardB = cardsById[b.card_id];
      return (cardA?.name ?? a.card_id).localeCompare(cardB?.name ?? b.card_id);
    });
  }, [mainboard, sideboard, cardsById]);

  const deckMetrics = useMemo(() => {
    const deckEntries = deckRows.map((row) => ({ row, card: cardsById[row.card_id] })).filter((x) => x.card != null);
    const totalQty = deckEntries.reduce((sum, x) => sum + x.row.qty, 0);

    const byCost = aggregateCountMap(
      deckEntries.map((x) => [String(x.card?.cost ?? '-'), x.row.qty])
    );
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
      byType: toSortedRows(byType),
      byRarity: toSortedRows(byRarity),
      byArena: toSortedRows(byArena),
      bySynergy: toSortedRows(keywordTrait).slice(0, 20),
      outAspectRows: [
        { label: 'In Aspect', value: inAspect < 0 ? 0 : inAspect },
        { label: 'Out of Aspect', value: outOfAspect },
      ],
    };
  }, [deckRows, cardsById, allowedAspects]);

  let graphContent = null;
  if (graphView === 'cost') {
    graphContent = <GraphBars data={deckMetrics.byCost} total={deckMetrics.totalQty} />;
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

  const content = (
    <Stack>
        <Title order={2}>Deckbuilder</Title>
        <Text c="dimmed">
          Search by name, keyword, trait, cost, type, aspect, set, rules, and arena. Card pools remain user-specific.
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
            />
          </Card>
        )}
        {!hasTournament && <Text c="dimmed">No tournament selected.</Text>}

        {isAdmin && (
          <Card withBorder>
            <Group>
              <Select
                label="Deck Owner"
                value={selectedUserId}
                onChange={setSelectedUserId}
                allowDeselect={false}
                data={adminUsers.map((user: any) => ({
                  value: String(user.user_id),
                  label: `${user.user_name} (${user.user_email})`,
                }))}
                style={{ minWidth: 340 }}
              />
              <Text size="sm" c="dimmed" mt="1.6rem">
                Admin mode: edit card pool and decks for this player.
              </Text>
            </Group>
          </Card>
        )}

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
                  <TextInput
                    label="Keyword"
                    value={keywordQuery}
                    onChange={(e) => setKeywordQuery(e.currentTarget.value)}
                  />
                  <TextInput label="Trait" value={traitQuery} onChange={(e) => setTraitQuery(e.currentTarget.value)} />
                  <TextInput
                    label="Aspect"
                    value={aspectQuery}
                    onChange={(e) => setAspectQuery(e.currentTarget.value)}
                  />
                </Group>
                <Group grow>
                  <Select label="Arena" data={arenaOptions} value={arenaFilter} onChange={setArenaFilter} clearable />
                  <NumberInput
                    label="Cost"
                    min={0}
                    max={20}
                    value={costQuery}
                    onChange={(value) => setCostQuery(value === '' ? '' : Number(value))}
                  />
                  <Select
                    label="Card Type"
                    data={typeOptions}
                    value={typeFilter}
                    onChange={setTypeFilter}
                    clearable
                  />
                  <Select
                    label="Rarity"
                    data={rarityOptions}
                    value={rarityFilter}
                    onChange={setRarityFilter}
                    clearable
                  />
                  <Select label="Set" data={setOptions} value={setFilter} onChange={setSetFilter} clearable />
                </Group>
                <Group>
                  <Switch
                    label="Only legal cards (leader/base aspects)"
                    checked={onlyLegalCards}
                    onChange={(event) => setOnlyLegalCards(event.currentTarget.checked)}
                  />
                  <Switch
                    label={isAdmin ? 'Only cards in selected player pool' : 'Only cards in my pool'}
                    checked={onlyCardsInPool}
                    onChange={(event) => setOnlyCardsInPool(event.currentTarget.checked)}
                  />
                  <Switch
                    label="Show images"
                    checked={showCardImage}
                    onChange={(event) => setShowCardImage(event.currentTarget.checked)}
                  />
                </Group>

                <ScrollArea h={500}>
                  <Table highlightOnHover stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        {showCardImage && <Table.Th>Image</Table.Th>}
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Rarity</Table.Th>
                        <Table.Th>Cost</Table.Th>
                        <Table.Th>Aspects</Table.Th>
                        <Table.Th>Arena</Table.Th>
                        <Table.Th>Set</Table.Th>
                        <Table.Th>Pool</Table.Th>
                        <Table.Th></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredCards.map((card: CardItem) => {
                        const currentQty = cardPoolMap[card.card_id] ?? 0;
                        const cardIsLeaderOrBase = isLeaderOrBase(card);
                        return (
                          <Table.Tr key={card.card_id}>
                            {showCardImage && (
                              <Table.Td>
                                {card.image_url != null ? (
                                  <Image src={card.image_url} w={64} h={90} radius="sm" />
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
                            <Table.Td>{(card.aspects ?? []).join(', ') || '-'}</Table.Td>
                            <Table.Td>{(card.arenas ?? []).join(', ') || '-'}</Table.Td>
                            <Table.Td>{card.set_code.toUpperCase()}</Table.Td>
                            <Table.Td>
                              <NumberInput
                                value={currentQty}
                                min={0}
                                max={99}
                                w={86}
                                onChange={(value) => {
                                  const numeric = Number(value ?? 0);
                                  addToPool(card.card_id, Number.isNaN(numeric) ? 0 : numeric);
                                }}
                              />
                            </Table.Td>
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
                  <Image src={leaderCard.image_url} h={130} fit="contain" radius="sm" />
                )}
                <Select searchable label="Base" value={baseCardId} onChange={setBaseCardId} data={baseOptions} />
                {baseCard?.image_url != null && <Image src={baseCard.image_url} h={130} fit="contain" radius="sm" />}
                <Group justify="space-between">
                  <Text>Mainboard ({countCards(mainboard)})</Text>
                  <Text size="sm" c="dimmed">
                    Sideboard ({countCards(sideboard)})
                  </Text>
                </Group>

                <ScrollArea h={260}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Side</Table.Th>
                        <Table.Th>Qty</Table.Th>
                        <Table.Th>Name</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Cost</Table.Th>
                        <Table.Th>Aspect</Table.Th>
                        <Table.Th>Arena/Set</Table.Th>
                        <Table.Th></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {deckRows.length < 1 && (
                        <Table.Tr>
                          <Table.Td colSpan={8}>
                            <Text c="dimmed" size="sm">
                              No cards added yet.
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )}
                      {deckRows.map((row) => {
                        const card = cardsById[row.card_id];
                        return (
                          <Table.Tr key={`${row.side}-${row.card_id}`}>
                            <Table.Td>{row.side}</Table.Td>
                            <Table.Td>{row.qty}</Table.Td>
                            <Table.Td>{card?.name ?? row.card_id}</Table.Td>
                            <Table.Td>{card?.type ?? '-'}</Table.Td>
                            <Table.Td>{card?.cost ?? '-'}</Table.Td>
                            <Table.Td>{card != null ? (card.aspects ?? []).join(', ') || '-' : '-'}</Table.Td>
                            <Table.Td>
                              {card != null
                                ? `${(card.arenas ?? []).join('/') || '-'} / ${card.set_code.toUpperCase()}`
                                : '-'}
                            </Table.Td>
                            <Table.Td>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={() => removeCardFromDeck(row.card_id, row.side === 'Main' ? 'main' : 'side')}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                <Button onClick={onSaveDeck} disabled={leaderCardId == null || baseCardId == null}>
                  Save Deck
                </Button>
                <Button variant="outline" onClick={onSubmitEntry} disabled={leaderCardId == null || baseCardId == null}>
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
                          const leaderLabel =
                            allCards.find((card: CardItem) => card.card_id === deck.leader)?.name ??
                            deck.leader;
                          const baseLabel =
                            allCards.find((card: CardItem) => card.card_id === deck.base)?.name ??
                            deck.base;
                          return (
                        <Group justify="space-between" align="start">
                          <Stack gap={0}>
                            <Text fw={600}>{deck.name}</Text>
                            <Text size="xs" c="dimmed">
                              {leaderLabel} / {baseLabel}
                            </Text>
                            {isAdmin && (
                              <Text size="xs" c="dimmed">
                                {deck.user_name}
                              </Text>
                            )}
                          </Stack>
                          <Group gap={4}>
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => {
                                setDeckName(deck.name);
                                setMainboard(deck.mainboard ?? {});
                                setSideboard(deck.sideboard ?? {});

                                const leader = allCards.find(
                                  (card: CardItem) =>
                                    card.type.toLowerCase() === 'leader' &&
                                    (card.name === deck.leader || card.card_id === deck.leader)
                                );
                                const base = allCards.find(
                                  (card: CardItem) =>
                                    card.type.toLowerCase() === 'base' &&
                                    (card.name === deck.base || card.card_id === deck.base)
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
                                await deleteDeck(activeTournamentId, deck.id);
                                await swrDecksResponse.mutate();
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
