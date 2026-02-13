import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  MultiSelect,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { showNotification } from '@mantine/notifications';

import Layout from '@pages/_layout';
import { getTournaments } from '@services/adapter';
import { saveDeck, simulateSealedDraft } from '@services/league';

type CardItem = {
  card_id: string;
  set_code: string;
  name: string;
  character_variant?: string | null;
  type: string;
  rarity: string;
  traits?: string[];
  keywords?: string[];
  rules_text?: string;
  aspects: string[];
  arenas: string[];
  cost: number | null;
  power?: number | null;
  hp?: number | null;
  image_url?: string | null;
};

function countCards(deck: Record<string, number>) {
  return Object.values(deck).reduce((sum, count) => sum + count, 0);
}

function normalizeSet(values: string[] | undefined) {
  return new Set((values ?? []).map((value) => value.toLowerCase()));
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

export default function SealedDraftSimulationPage() {
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [setCodes, setSetCodes] = useState<string[]>(['sor']);
  const [packCount, setPackCount] = useState<number>(6);
  const [simulation, setSimulation] = useState<any>(null);

  const [deckName, setDeckName] = useState('Sealed Draft Deck');
  const [leaderCardId, setLeaderCardId] = useState<string | null>(null);
  const [baseCardId, setBaseCardId] = useState<string | null>(null);
  const [mainboard, setMainboard] = useState<Record<string, number>>({});
  const [sideboard, setSideboard] = useState<Record<string, number>>({});
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
  const [onlyLegalCards, setOnlyLegalCards] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageLabel, setPreviewImageLabel] = useState<string>('');

  useEffect(() => {
    if (tournaments.length < 1 || selectedTournamentId != null) return;
    const saved = window.localStorage.getItem('league_default_tournament_id');
    const selected = tournaments.find((t: any) => String(t.id) === saved) ?? tournaments[0];
    setSelectedTournamentId(String(selected.id));
    window.localStorage.setItem('league_default_tournament_id', String(selected.id));
  }, [tournaments, selectedTournamentId]);

  const activeTournamentId = Number(selectedTournamentId ?? tournaments[0]?.id ?? 0);
  const hasTournament = Number.isFinite(activeTournamentId) && activeTournamentId > 0;

  const leaders: CardItem[] = simulation?.leaders ?? [];
  const bases: CardItem[] = simulation?.bases ?? [];
  const poolCards: CardItem[] = simulation?.non_leader_base_pool ?? [];

  const poolCountMap = useMemo(() => {
    const result: Record<string, number> = {};
    poolCards.forEach((card) => {
      result[card.card_id] = (result[card.card_id] ?? 0) + 1;
    });
    return result;
  }, [poolCards]);

  const usedCountMap = useMemo(() => {
    const result: Record<string, number> = {};
    Object.entries(mainboard).forEach(([cardId, qty]) => {
      result[cardId] = (result[cardId] ?? 0) + qty;
    });
    Object.entries(sideboard).forEach(([cardId, qty]) => {
      result[cardId] = (result[cardId] ?? 0) + qty;
    });
    return result;
  }, [mainboard, sideboard]);

  const cardsById = useMemo(() => {
    const result: Record<string, CardItem> = {};
    poolCards.forEach((card) => {
      result[card.card_id] = card;
    });
    leaders.forEach((card) => {
      result[card.card_id] = card;
    });
    bases.forEach((card) => {
      result[card.card_id] = card;
    });
    return result;
  }, [poolCards, leaders, bases]);

  const uniquePoolCards = useMemo(
    () => Object.keys(poolCountMap).map((cardId) => cardsById[cardId]).filter((card) => card != null),
    [poolCountMap, cardsById]
  );

  const uniqueLeaderOptions = useMemo(
    () =>
      [...new Map(leaders.map((card) => [card.card_id, card])).values()].map((card) => ({
        value: card.card_id,
        label: `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''} (${card.set_code.toUpperCase()})`,
      })),
    [leaders]
  );
  const uniqueBaseOptions = useMemo(
    () =>
      [...new Map(bases.map((card) => [card.card_id, card])).values()].map((card) => ({
        value: card.card_id,
        label: `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''} (${card.set_code.toUpperCase()})`,
      })),
    [bases]
  );

  const typeOptions = useMemo(
    () =>
      [...new Set(uniquePoolCards.map((card: CardItem) => card.type).filter((value) => value != null && value !== ''))]
        .sort()
        .map((value) => ({ value, label: value })),
    [uniquePoolCards]
  );
  const rarityOptions = useMemo(
    () =>
      [...new Set(uniquePoolCards.map((card: CardItem) => card.rarity).filter((value) => value != null && value !== ''))]
        .sort()
        .map((value) => ({ value, label: value })),
    [uniquePoolCards]
  );
  const setOptions = useMemo(
    () =>
      [...new Set(uniquePoolCards.map((card: CardItem) => card.set_code).filter((value) => value != null && value !== ''))]
        .sort()
        .map((value) => ({ value, label: value.toUpperCase() })),
    [uniquePoolCards]
  );
  const arenaOptions = useMemo(
    () =>
      [
        ...new Set(
          uniquePoolCards
            .flatMap((card: CardItem) => card.arenas ?? [])
            .map((value) => value.trim())
            .filter((value) => value !== '')
        ),
      ]
        .sort()
        .map((value) => ({ value, label: value })),
    [uniquePoolCards]
  );

  const leaderCard = cardsById[leaderCardId ?? ''];
  const baseCard = cardsById[baseCardId ?? ''];
  const allowedAspects = useMemo(() => {
    const leaderAspects = normalizeSet(leaderCard?.aspects);
    const baseAspects = normalizeSet(baseCard?.aspects);
    return new Set([...leaderAspects, ...baseAspects]);
  }, [leaderCard, baseCard]);

  const filteredPoolCards = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedName = nameQuery.trim().toLowerCase();
    const normalizedRules = rulesQuery.trim().toLowerCase();
    const normalizedKeyword = keywordQuery.trim().toLowerCase();
    const normalizedTrait = traitQuery.trim().toLowerCase();
    const normalizedAspect = aspectQuery.trim().toLowerCase();

    return uniquePoolCards
      .filter((card: CardItem) => {
        const name = card.name.toLowerCase();
        const variant = (card.character_variant ?? '').toLowerCase();
        const rules = (card.rules_text ?? '').toLowerCase();
        const type = card.type.toLowerCase();
        const rarity = (card.rarity ?? '').toLowerCase();
        const aspects = (card.aspects ?? []).map((value) => value.toLowerCase());
        const traits = (card.traits ?? []).map((value) => value.toLowerCase());
        const keywords = (card.keywords ?? []).map((value) => value.toLowerCase());
        const arenas = (card.arenas ?? []).map((value) => value.toLowerCase());

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
        if (normalizedKeyword !== '' && !keywords.some((value) => value.includes(normalizedKeyword))) return false;
        if (normalizedTrait !== '' && !traits.some((value) => value.includes(normalizedTrait))) return false;
        if (normalizedAspect !== '' && !aspects.some((value) => value.includes(normalizedAspect))) return false;
        if (costQuery !== '' && card.cost !== Number(costQuery)) return false;
        if (typeFilter != null && card.type !== typeFilter) return false;
        if (rarityFilter != null && card.rarity !== rarityFilter) return false;
        if (setFilter != null && card.set_code !== setFilter) return false;
        if (arenaFilter != null && !(card.arenas ?? []).includes(arenaFilter)) return false;

        if (onlyLegalCards) {
          if (allowedAspects.size < 1) return false;
          const cardAspects = (card.aspects ?? []).map((value) => value.toLowerCase());
          if (cardAspects.some((value) => !allowedAspects.has(value))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return (a.character_variant ?? '').localeCompare(b.character_variant ?? '');
      });
  }, [
    uniquePoolCards,
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
    onlyLegalCards,
    allowedAspects,
  ]);

  const deckRows = useMemo(() => {
    const rows: Array<{ side: 'Main' | 'Side'; card_id: string; qty: number }> = [];
    Object.entries(mainboard).forEach(([card_id, qty]) => rows.push({ side: 'Main', card_id, qty }));
    Object.entries(sideboard).forEach(([card_id, qty]) => rows.push({ side: 'Side', card_id, qty }));
    return rows;
  }, [mainboard, sideboard]);

  async function runSimulation() {
    const response = await simulateSealedDraft({
      set_codes: setCodes,
      pack_count: packCount,
    });
    // @ts-ignore
    const data = response?.data?.data;
    if (data == null) return;
    setSimulation(data);
    setMainboard({});
    setSideboard({});
    setLeaderCardId(null);
    setBaseCardId(null);
  }

  function addCard(cardId: string, side: 'main' | 'side') {
    const pulled = poolCountMap[cardId] ?? 0;
    const used = usedCountMap[cardId] ?? 0;
    if (used >= pulled) {
      return;
    }
    if (side === 'main') {
      setMainboard((prev) => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }));
    } else {
      setSideboard((prev) => ({ ...prev, [cardId]: (prev[cardId] ?? 0) + 1 }));
    }
  }

  function removeCard(cardId: string, side: 'main' | 'side') {
    const update = (prev: Record<string, number>) => {
      const current = prev[cardId] ?? 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[cardId];
        return next;
      }
      return { ...prev, [cardId]: current - 1 };
    };
    if (side === 'main') setMainboard(update);
    else setSideboard(update);
  }

  async function saveSealedDeck() {
    if (!hasTournament || leaderCardId == null || baseCardId == null) return;
    if (countCards(mainboard) < 30) {
      showNotification({
        color: 'red',
        title: 'Mainboard too small',
        message: 'Sealed deck requires at least 30 cards in the mainboard.',
      });
      return;
    }

    await saveDeck(activeTournamentId, {
      tournament_id: activeTournamentId,
      name: deckName,
      leader: leaderCardId,
      base: baseCardId,
      leader_image_url: cardsById[leaderCardId]?.image_url ?? undefined,
      mainboard,
      sideboard,
    });
    showNotification({ color: 'green', title: 'Sealed deck saved', message: '' });
  }

  function getSwudbExportPayload() {
    if (leaderCardId == null || baseCardId == null) return null;
    return {
      name: deckName,
      leader: { id: leaderCardId, count: 1 },
      base: { id: baseCardId, count: 1 },
      deck: Object.entries(mainboard).map(([id, count]) => ({ id, count })),
      sideboard: Object.entries(sideboard).map(([id, count]) => ({ id, count })),
    };
  }

  function getTextExport() {
    const main = Object.entries(mainboard)
      .map(([cardId, qty]) => `${qty}x ${cardsById[cardId]?.name ?? cardId}`)
      .join('\n');
    const side = Object.entries(sideboard)
      .map(([cardId, qty]) => `${qty}x ${cardsById[cardId]?.name ?? cardId}`)
      .join('\n');
    return [
      `Deck: ${deckName}`,
      `Leader: ${cardsById[leaderCardId ?? '']?.name ?? '-'}`,
      `Base: ${cardsById[baseCardId ?? '']?.name ?? '-'}`,
      '',
      'Mainboard',
      main,
      '',
      'Sideboard',
      side,
    ].join('\n');
  }

  return (
    <Layout>
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
        <Title>Sealed Draft Simulation</Title>
        <Text c="dimmed">
          Simulate sealed packs, choose leader/base, then build a 30-card minimum deck with sideboard.
        </Text>

        <Card withBorder>
          <Group align="end">
            <MultiSelect
              label="Set Codes"
              value={setCodes}
              onChange={setSetCodes}
              data={['sor', 'shd', 'twi', 'jtl', 'lof', 'ibh', 'sec', 'law'].map((x) => ({
                value: x,
                label: x.toUpperCase(),
              }))}
              style={{ minWidth: 260 }}
            />
            <NumberInput
              label="Packs Opened"
              min={1}
              max={36}
              value={packCount}
              onChange={(value) => setPackCount(Number(value ?? 6))}
              style={{ width: 160 }}
            />
            <Button onClick={runSimulation}>Run Simulation</Button>
          </Group>
        </Card>

        {simulation != null && (
          <>
            <Card withBorder>
              <Title order={4} mb="sm">Leaders Opened</Title>
              <Group>
                {leaders.map((card, index) => (
                  <Card key={`leader-${card.card_id}-${index}`} withBorder p="xs">
                    <Stack gap={4}>
                      {card.image_url != null && (
                        <Image
                          src={card.image_url}
                          w={220}
                          h={120}
                          fit="contain"
                          radius="sm"
                          style={{ cursor: 'zoom-in' }}
                          onClick={() => {
                            setPreviewImageLabel(
                              `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}`
                            );
                            setPreviewImageUrl(card.image_url ?? null);
                          }}
                        />
                      )}
                      <Text size="xs">{card.name}</Text>
                      {card.character_variant != null && card.character_variant !== '' ? (
                        <Text size="xs" c="dimmed">
                          {card.character_variant}
                        </Text>
                      ) : null}
                    </Stack>
                  </Card>
                ))}
              </Group>
            </Card>

            <Card withBorder>
              <Title order={4} mb="sm">Bases Opened</Title>
              <Group>
                {bases.map((card, index) => (
                  <Card key={`base-${card.card_id}-${index}`} withBorder p="xs">
                    <Stack gap={4}>
                      {card.image_url != null && (
                        <Image
                          src={card.image_url}
                          w={220}
                          h={120}
                          fit="contain"
                          radius="sm"
                          style={{ cursor: 'zoom-in' }}
                          onClick={() => {
                            setPreviewImageLabel(
                              `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}`
                            );
                            setPreviewImageUrl(card.image_url ?? null);
                          }}
                        />
                      )}
                      <Text size="xs">{card.name}</Text>
                      {card.character_variant != null && card.character_variant !== '' ? (
                        <Text size="xs" c="dimmed">
                          {card.character_variant}
                        </Text>
                      ) : null}
                    </Stack>
                  </Card>
                ))}
              </Group>
            </Card>

            <Card withBorder>
              <Title order={4} mb="sm">Packs</Title>
              <Stack>
                {(simulation?.packs ?? []).map((pack: any) => (
                  <Card key={`pack-${pack.pack_index}`} withBorder>
                    <Text fw={600}>Pack {pack.pack_index}</Text>
                    {(() => {
                      const packCards = [
                        ...(pack.commons ?? []),
                        ...(pack.uncommons ?? []),
                        pack.rare_or_legendary,
                        pack.leader,
                        pack.base,
                        pack.wildcard,
                      ].filter((card) => card != null);
                      const rarity: Record<string, number> = {};
                      const type: Record<string, number> = {};
                      const aspect: Record<string, number> = {};
                      const cost: Record<string, number> = {};
                      packCards.forEach((card: any) => {
                        const rarityKey = card.rarity ?? 'Unknown';
                        const typeKey = card.type ?? 'Unknown';
                        rarity[rarityKey] = (rarity[rarityKey] ?? 0) + 1;
                        type[typeKey] = (type[typeKey] ?? 0) + 1;
                        const aspects = card.aspects ?? [];
                        if (aspects.length < 1) {
                          aspect['None'] = (aspect['None'] ?? 0) + 1;
                        } else {
                          aspects.forEach((a: string) => {
                            aspect[a] = (aspect[a] ?? 0) + 1;
                          });
                        }
                        const costKey = String(card.cost ?? '-');
                        cost[costKey] = (cost[costKey] ?? 0) + 1;
                      });
                      const toText = (data: Record<string, number>) =>
                        Object.entries(data)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' | ');
                      return (
                        <Stack gap={4}>
                          <Text size="sm">Rarity: {toText(rarity)}</Text>
                          <Text size="sm">Type: {toText(type)}</Text>
                          <Text size="sm">Aspect: {toText(aspect)}</Text>
                          <Text size="sm">Cost: {toText(cost)}</Text>
                        </Stack>
                      );
                    })()}
                  </Card>
                ))}
              </Stack>
            </Card>

            <Card withBorder>
              <Stack>
                <Title order={4}>Build Deck</Title>
                <TextInput label="Deck Name" value={deckName} onChange={(e) => setDeckName(e.currentTarget.value)} />
                <Select
                  label="Save To Tournament"
                  value={selectedTournamentId}
                  onChange={(value) => {
                    setSelectedTournamentId(value);
                    if (value != null) window.localStorage.setItem('league_default_tournament_id', value);
                  }}
                  data={tournaments.map((t: any) => ({ value: String(t.id), label: t.name }))}
                  clearable
                />
                <Select searchable label="Leader" data={uniqueLeaderOptions} value={leaderCardId} onChange={setLeaderCardId} />
                {leaderCard?.image_url != null && <Image src={leaderCard.image_url} h={130} fit="contain" radius="sm" />}
                <Select searchable label="Base" data={uniqueBaseOptions} value={baseCardId} onChange={setBaseCardId} />
                {baseCard?.image_url != null && <Image src={baseCard.image_url} h={130} fit="contain" radius="sm" />}
                <Group>
                  <Badge>Mainboard: {countCards(mainboard)}</Badge>
                  <Badge>Sideboard: {countCards(sideboard)}</Badge>
                </Group>
                <Group grow>
                  <TextInput label="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
                  <TextInput label="Name" value={nameQuery} onChange={(e) => setNameQuery(e.currentTarget.value)} />
                  <TextInput label="Rules" value={rulesQuery} onChange={(e) => setRulesQuery(e.currentTarget.value)} />
                </Group>
                <Group grow>
                  <TextInput label="Keyword" value={keywordQuery} onChange={(e) => setKeywordQuery(e.currentTarget.value)} />
                  <TextInput label="Trait" value={traitQuery} onChange={(e) => setTraitQuery(e.currentTarget.value)} />
                  <TextInput label="Aspect" value={aspectQuery} onChange={(e) => setAspectQuery(e.currentTarget.value)} />
                </Group>
                <Group grow>
                  <Select label="Arena" data={arenaOptions} value={arenaFilter} onChange={setArenaFilter} clearable />
                  <NumberInput label="Cost" min={0} max={20} value={costQuery} onChange={(value) => setCostQuery(value === '' ? '' : Number(value))} />
                  <Select label="Card Type" data={typeOptions} value={typeFilter} onChange={setTypeFilter} clearable />
                  <Select label="Rarity" data={rarityOptions} value={rarityFilter} onChange={setRarityFilter} clearable />
                  <Select label="Set" data={setOptions} value={setFilter} onChange={setSetFilter} clearable />
                </Group>
                <Switch
                  label="Only legal cards (leader/base aspects)"
                  checked={onlyLegalCards}
                  onChange={(event) => setOnlyLegalCards(event.currentTarget.checked)}
                />
                <ScrollArea h={360}>
                  <Table stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Image</Table.Th>
                        <Table.Th>Card</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Aspects</Table.Th>
                        <Table.Th>Arena</Table.Th>
                        <Table.Th>Set</Table.Th>
                        <Table.Th>Pulled</Table.Th>
                        <Table.Th>Used</Table.Th>
                        <Table.Th>Cost</Table.Th>
                        <Table.Th>Power</Table.Th>
                        <Table.Th>HP</Table.Th>
                        <Table.Th>Rarity</Table.Th>
                        <Table.Th>Actions</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {filteredPoolCards.map((card) => (
                        <Table.Tr key={card.card_id}>
                          <Table.Td>
                            {card.image_url != null ? (
                              <Image
                                src={card.image_url}
                                w={58}
                                h={82}
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
                          <Table.Td>
                            <Stack gap={0}>
                              <Text size="sm">{card.name}</Text>
                              {card.character_variant != null && card.character_variant !== '' ? (
                                <Text size="xs" c="dimmed">
                                  {card.character_variant}
                                </Text>
                              ) : null}
                              <Text size="xs" c="dimmed">
                                {card.card_id}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>{card.type}</Table.Td>
                          <Table.Td>{(card.aspects ?? []).join(', ') || '-'}</Table.Td>
                          <Table.Td>{(card.arenas ?? []).join(', ') || '-'}</Table.Td>
                          <Table.Td>{card.set_code.toUpperCase()}</Table.Td>
                          <Table.Td>{poolCountMap[card.card_id] ?? 0}</Table.Td>
                          <Table.Td>{usedCountMap[card.card_id] ?? 0}</Table.Td>
                          <Table.Td>{card.cost ?? '-'}</Table.Td>
                          <Table.Td>{card.power ?? '-'}</Table.Td>
                          <Table.Td>{card.hp ?? '-'}</Table.Td>
                          <Table.Td>{card.rarity}</Table.Td>
                          <Table.Td>
                            <Group gap={4}>
                              <ActionIcon
                                color="green"
                                variant="light"
                                disabled={(usedCountMap[card.card_id] ?? 0) >= (poolCountMap[card.card_id] ?? 0)}
                                onClick={() => addCard(card.card_id, 'main')}
                              >
                                <IconPlus size={14} />
                              </ActionIcon>
                              <ActionIcon
                                color="blue"
                                variant="light"
                                disabled={(usedCountMap[card.card_id] ?? 0) >= (poolCountMap[card.card_id] ?? 0)}
                                onClick={() => addCard(card.card_id, 'side')}
                              >
                                <IconPlus size={14} />
                              </ActionIcon>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Side</Table.Th>
                      <Table.Th>Qty</Table.Th>
                      <Table.Th>Card</Table.Th>
                      <Table.Th></Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {deckRows.map((row) => (
                      <Table.Tr key={`${row.side}-${row.card_id}`}>
                        <Table.Td>{row.side}</Table.Td>
                        <Table.Td>{row.qty}</Table.Td>
                        <Table.Td>{cardsById[row.card_id]?.name ?? row.card_id}</Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => removeCard(row.card_id, row.side === 'Main' ? 'main' : 'side')}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>

                <Group>
                  <Button
                    onClick={saveSealedDeck}
                    disabled={!hasTournament || leaderCardId == null || baseCardId == null}
                  >
                    Save Sealed Deck
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const payload = getSwudbExportPayload();
                      if (payload == null) return;
                      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      showNotification({ color: 'green', title: 'SWUDB JSON copied', message: '' });
                    }}
                    disabled={leaderCardId == null || baseCardId == null}
                  >
                    Copy JSON
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const payload = getSwudbExportPayload();
                      if (payload == null) return;
                      triggerDownload(
                        `${deckName.replace(/\s+/g, '-').toLowerCase() || 'sealed-deck'}.json`,
                        JSON.stringify(payload, null, 2),
                        'application/json;charset=utf-8'
                      );
                    }}
                    disabled={leaderCardId == null || baseCardId == null}
                  >
                    Export JSON
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(getTextExport());
                      showNotification({ color: 'green', title: 'Decklist text copied', message: '' });
                    }}
                  >
                    Copy TXT
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      triggerDownload(
                        `${deckName.replace(/\s+/g, '-').toLowerCase() || 'sealed-deck'}.txt`,
                        getTextExport(),
                        'text/plain;charset=utf-8'
                      )
                    }
                  >
                    Export TXT
                  </Button>
                </Group>
              </Stack>
            </Card>
          </>
        )}
      </Stack>
    </Layout>
  );
}
