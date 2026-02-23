import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Flex,
  Grid,
  Group,
  HoverCard,
  Image,
  Select,
  Table,
  Stack,
  Tabs,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { showNotification } from '@mantine/notifications';
import { AiOutlineHourglass } from '@react-icons/all-files/ai/AiOutlineHourglass';
import { IconAlertCircle, IconTrophy } from '@tabler/icons-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BracketTree, { BracketTreeSection } from '@components/brackets/bracket_tree';
import MatchModal from '@components/modals/match_modal';
import { NoContent } from '@components/no_content/empty_table_info';
import RequestErrorAlert from '@components/utils/error_alert';
import { Time, formatTime } from '@components/utils/datetime';
import PreloadLink from '@components/utils/link';
import { formatMatchInput1, formatMatchInput2 } from '@components/utils/match';
import { Translator } from '@components/utils/types';
import { getTournamentIdFromRouter, responseIsValid } from '@components/utils/util';
import { MatchWithDetails } from '@openapi';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import {
  getCourts,
  getBaseApiUrl,
  getLeagueCardsGlobal,
  getStages,
  getTournamentById,
  getTournamentApplications,
  getUser,
  getUserDirectory,
} from '@services/adapter';
import { getMatchLookup, getStageItemLookup, stringToColour } from '@services/lookups';
import { getKarabastMatchBundle, updateKarabastGameName } from '@services/match';
import { endStageItemEarly, updateStageItemWinnerConfirmation } from '@services/stage_item';

type TeamDeckPreview = {
  leaderName: string;
  baseName: string;
  leaderImageUrl: string | null;
  baseImageUrl: string | null;
};

type BracketSectionKey = 'WINNERS' | 'LOSERS' | 'FINALS' | 'MAIN';
const WIN_CELEBRATION_STORAGE_PREFIX = 'results_win_celebrated';
const OUTCOME_CONFIRMATION_NOTICE_STORAGE_PREFIX = 'results_pending_winner_notice';

function getSingleEliminationRoundCount(teamCount: number): number {
  if (!Number.isFinite(teamCount) || teamCount <= 1) return 0;
  return Math.ceil(Math.log2(teamCount));
}

function launchWinnerConfetti() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const viewportHeight = Math.max(window.innerHeight, 600);
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '0';
  container.style.top = '0';
  container.style.width = '100vw';
  container.style.height = '100vh';
  container.style.pointerEvents = 'none';
  container.style.overflow = 'hidden';
  container.style.zIndex = '9999';

  const colors = ['#f59f00', '#fab005', '#69db7c', '#4dabf7', '#ff8787', '#da77f2'];
  const pieceCount = 140;

  for (let index = 0; index < pieceCount; index += 1) {
    const piece = document.createElement('span');
    const size = 5 + Math.random() * 7;
    const startXPercent = Math.random() * 100;
    const driftX = (Math.random() - 0.5) * 360;
    const rotate = (Math.random() - 0.5) * 1080;
    const duration = 1200 + Math.random() * 1600;
    const delay = Math.random() * 220;

    piece.style.position = 'absolute';
    piece.style.left = `${startXPercent}%`;
    piece.style.top = '-14px';
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (0.7 + Math.random() * 0.8)}px`;
    piece.style.borderRadius = `${Math.max(1, size / 4)}px`;
    piece.style.background = colors[index % colors.length];
    piece.style.opacity = '0.95';

    piece.animate(
      [
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', opacity: 1 },
        {
          transform: `translate3d(${driftX}px, ${viewportHeight + 80}px, 0) rotate(${rotate}deg)`,
          opacity: 0,
        },
      ],
      {
        duration,
        delay,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        fill: 'forwards',
      }
    );
    container.appendChild(piece);
  }

  document.body.appendChild(container);
  window.setTimeout(() => {
    container.remove();
  }, 3400);
}

function normalizeRoundName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCardIdLookupKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function removeNumericPaddingFromCardId(value: string | null | undefined) {
  const normalized = normalizeCardIdLookupKey(value);
  const match = normalized.match(/^([a-z]+)-(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  const [, setCode, number, suffix] = match;
  const trimmedNumber = String(Number(number));
  return `${setCode}-${trimmedNumber}${suffix}`;
}

function buildCardLookupKeys(value: string | null | undefined) {
  const raw = String(value ?? '').trim().toLowerCase();
  const normalized = normalizeCardIdLookupKey(value);
  const noPadding = removeNumericPaddingFromCardId(value);
  return [raw, normalized, noPadding].filter((item, index, all) => item !== '' && all.indexOf(item) === index);
}

function toPositiveInt(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : 0;
}

function toSwudbCardId(cardId: unknown) {
  const normalized = String(cardId ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalized === '') return '';

  const [setCode, ...rest] = normalized.split('-');
  const remainder = rest.join('-').trim();
  if (setCode === '' || remainder === '') {
    return normalized.replace(/-/g, '_').toUpperCase();
  }

  const firstToken = remainder.split('-', 1)[0].trim();
  const parsed = firstToken.match(/^0*(\d+)([a-z]*)$/i);
  if (parsed == null) {
    return `${setCode}_${remainder}`.toUpperCase();
  }
  const number = Number(parsed[1] ?? 0);
  const suffixRaw = String(parsed[2] ?? '').toLowerCase();
  const suffix = suffixRaw === 'f' ? '' : suffixRaw;
  return `${setCode}_${String(number).padStart(3, '0')}${suffix}`.toUpperCase();
}

function normalizeSwudbEntries(value: unknown): Array<{ id: string; count: number }> {
  const aggregated: Record<string, number> = {};
  if (Array.isArray(value)) {
    value.forEach((entry: any) => {
      const cardId = toSwudbCardId(entry?.id ?? entry?.card_id ?? '');
      const count = toPositiveInt(entry?.count ?? entry?.quantity ?? entry?.qty);
      if (cardId === '' || count <= 0) return;
      aggregated[cardId] = (aggregated[cardId] ?? 0) + count;
    });
  } else if (value != null && typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([cardIdRaw, countRaw]) => {
      const cardId = toSwudbCardId(cardIdRaw);
      const count = toPositiveInt(countRaw);
      if (cardId === '' || count <= 0) return;
      aggregated[cardId] = (aggregated[cardId] ?? 0) + count;
    });
  }
  return Object.entries(aggregated)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([id, count]) => ({ id, count }));
}

function normalizeSwudbDeckExport(
  value: any,
  fallbackName: string | null | undefined,
  fallbackAuthor: string | null | undefined
):
  | {
      metadata: { name: string; author?: string };
      leader: { id: string; count: 1 };
      base: { id: string; count: 1 };
      deck: Array<{ id: string; count: number }>;
      sideboard: Array<{ id: string; count: number }>;
    }
  | null {
  if (value == null || typeof value !== 'object') return null;

  const leaderId = toSwudbCardId(value?.leader?.id ?? value?.leader);
  const baseId = toSwudbCardId(value?.base?.id ?? value?.base);
  if (leaderId === '' || baseId === '') return null;

  const deck = normalizeSwudbEntries(value?.deck ?? value?.mainboard ?? value?.main_board ?? {});
  const sideboard = normalizeSwudbEntries(value?.sideboard ?? value?.side_board ?? {});
  const metadataName =
    String(value?.metadata?.name ?? value?.name ?? fallbackName ?? '')
      .trim() || 'Deck';
  const metadataAuthor = String(value?.metadata?.author ?? value?.author ?? fallbackAuthor ?? '').trim();
  const metadata = metadataAuthor === '' ? { name: metadataName } : { name: metadataName, author: metadataAuthor };

  return {
    metadata,
    leader: { id: leaderId, count: 1 },
    base: { id: baseId, count: 1 },
    deck,
    sideboard,
  };
}

function inferDoubleEliminationSection(
  roundName: string,
  roundIndex: number,
  winnersRoundCount: number,
  losersRoundCount: number
): BracketSectionKey {
  const normalized = roundName.toLowerCase();
  if (normalized.startsWith('wb') || normalized.includes('winners')) return 'WINNERS';
  if (normalized.startsWith('lb') || normalized.includes('losers')) return 'LOSERS';
  if (normalized.includes('grand final') || normalized.includes('grandfinal')) return 'FINALS';
  if (roundIndex < winnersRoundCount) return 'WINNERS';
  if (roundIndex < winnersRoundCount + losersRoundCount) return 'LOSERS';
  return 'FINALS';
}

function getDoubleEliminationRoundLabel(
  section: BracketSectionKey,
  sectionIndex: number,
  winnersRoundCount: number,
  losersRoundCount: number
): string {
  if (section === 'WINNERS') {
    return sectionIndex === winnersRoundCount ? 'WB Final' : `WB Round ${sectionIndex}`;
  }
  if (section === 'LOSERS') {
    return sectionIndex === losersRoundCount ? 'LB Final' : `LB Round ${sectionIndex}`;
  }
  if (section === 'FINALS') {
    return sectionIndex === 1 ? 'Grand Final' : 'Grand Final Reset';
  }
  return `Round ${sectionIndex}`;
}

function getSingleEliminationRoundLabel(roundIndex: number, totalRounds: number): string {
  if (totalRounds <= 1) return 'Final';
  const roundsRemaining = totalRounds - roundIndex;
  if (roundsRemaining <= 0) return 'Final';
  if (roundsRemaining === 1) return 'Semifinals';
  if (roundsRemaining === 2) return 'Quarterfinals';
  const participants = 2 ** (roundsRemaining + 1);
  return `Round of ${participants}`;
}

function ScheduleRow({
  data,
  openMatchModal,
  stageItemsLookup,
  matchesLookup,
  editable,
  submittableByUser,
  winnerByStageItemId,
  resolveDeckPreviewForTeam,
  baseTrackerHref,
  karabastGameName,
  karabastLobbyUrl,
  onCopyKarabastGameName,
  onCopyKarabastDeckSlot,
  onEditKarabastLobbyUrl,
  karabastEnabled,
}: {
  data: any;
  openMatchModal: any;
  stageItemsLookup: any;
  matchesLookup: any;
  editable: boolean;
  submittableByUser: boolean;
  winnerByStageItemId: Record<number, string>;
  resolveDeckPreviewForTeam: (teamName: string | null | undefined) => TeamDeckPreview | null;
  baseTrackerHref: string;
  karabastGameName: string;
  karabastLobbyUrl: string | null;
  onCopyKarabastGameName: () => Promise<void>;
  onCopyKarabastDeckSlot: (slot: number) => Promise<void>;
  onEditKarabastLobbyUrl: () => Promise<void>;
  karabastEnabled: boolean;
}) {
  const { t } = useTranslation();
  const winColor = '#2a8f37';
  const drawColor = '#656565';
  const loseColor = '#af4034';
  const team1Score = Number(data?.match?.stage_item_input1_score ?? 0);
  const team2Score = Number(data?.match?.stage_item_input2_score ?? 0);
  const team1_color =
    team1Score > team2Score
      ? winColor
      : team1Score === team2Score
        ? drawColor
        : loseColor;
  const team2_color =
    team2Score > team1Score
      ? winColor
      : team1Score === team2Score
        ? drawColor
        : loseColor;
  const team1Name = String(data?.match?.stage_item_input1?.team?.name ?? '').trim();
  const team2Name = String(data?.match?.stage_item_input2?.team?.name ?? '').trim();
  const team1Label =
    team1Name !== '' ? team1Name : formatMatchInput1(t, stageItemsLookup, matchesLookup, data.match);
  const team2Label =
    team2Name !== '' ? team2Name : formatMatchInput2(t, stageItemsLookup, matchesLookup, data.match);
  const karabastHref = karabastLobbyUrl ?? 'https://karabast.net/';

  const renderTeamLabel = (teamLabel: string, teamNameForLookup: string) => {
    const preview = resolveDeckPreviewForTeam(teamNameForLookup);
    if (preview == null) {
      return <Text fw={500}>{teamLabel}</Text>;
    }
    return (
      <HoverCard width={280} shadow="md" position="right">
        <HoverCard.Target>
          <Text fw={500} td="underline" style={{ textDecorationStyle: 'dotted' }}>
            {teamLabel}
          </Text>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <Stack gap="xs">
            <Text fw={700}>Submitted Deck</Text>
            <Group grow>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Leader
                </Text>
                {preview.leaderImageUrl != null && preview.leaderImageUrl !== '' ? (
                  <Image src={preview.leaderImageUrl} h={110} fit="contain" radius="sm" />
                ) : null}
                <Text size="sm">{preview.leaderName}</Text>
              </Stack>
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Base
                </Text>
                {preview.baseImageUrl != null && preview.baseImageUrl !== '' ? (
                  <Image src={preview.baseImageUrl} h={110} fit="contain" radius="sm" />
                ) : null}
                <Text size="sm">{preview.baseName}</Text>
              </Stack>
            </Group>
          </Stack>
        </HoverCard.Dropdown>
      </HoverCard>
    );
  };

  return (
    <div style={{ width: '48rem' }}>
      <Group justify="space-between" mt="md" mb={4}>
        <Group gap={8}>
          <Text size="sm" c="dimmed">
            Lobby: {karabastLobbyUrl ?? karabastGameName}
          </Text>
          <Button
            size="xs"
            variant="filled"
            color="teal"
            component="a"
            href={karabastHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            {karabastLobbyUrl != null ? 'Open Lobby' : 'Open Karabast'}
          </Button>
          <Button
            size="xs"
            variant="light"
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              await onCopyKarabastGameName();
            }}
          >
            {karabastLobbyUrl != null ? 'Copy Lobby URL' : 'Copy Lobby Name'}
          </Button>
          {karabastEnabled && editable ? (
            <Button
              size="xs"
              variant="light"
              color="violet"
              onClick={async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await onEditKarabastLobbyUrl();
              }}
            >
              Set Invite Link
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="light"
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              await onCopyKarabastDeckSlot(1);
            }}
          >
            Copy {team1Label} Deck
          </Button>
          <Button
            size="xs"
            variant="light"
            onClick={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              await onCopyKarabastDeckSlot(2);
            }}
          >
            Copy {team2Label} Deck
          </Button>
        </Group>
        <Button component={PreloadLink} href={baseTrackerHref} size="xs" variant="light">
          Open Base Tracker
        </Button>
      </Group>
      <UnstyledButton
        style={{ width: '100%', cursor: editable ? 'pointer' : 'default' }}
        onClick={() => {
          if (editable) {
            openMatchModal(data.match);
          }
        }}
      >
        <Card
          shadow="sm"
          radius="md"
          withBorder
          pt="0rem"
          style={
            submittableByUser
              ? {
                  backgroundColor: 'rgba(80, 160, 255, 0.14)',
                  borderColor: 'rgba(80, 160, 255, 0.7)',
                }
              : undefined
          }
        >
          <Card.Section withBorder>
            <Grid pt="0.75rem" pb="0.5rem">
              <Grid.Col mb="0rem" span={4}>
                <Text pl="sm" mt="sm" fw={800}>
                  {data.match.court?.name ?? 'TBD Court'}
                </Text>
              </Grid.Col>
              <Grid.Col mb="0rem" span={4}>
                <Center>
                  <Text mt="sm" fw={800}>
                    {data.match.start_time != null ? <Time datetime={data.match.start_time} /> : null}
                  </Text>
                </Center>
              </Grid.Col>
              <Grid.Col mb="0rem" span={4}>
                <Flex justify="right">
                  <Badge
                    color={stringToColour(`${data.stageItem.id}`)}
                    variant="outline"
                    mr="md"
                    mt="0.8rem"
                    size="md"
                  >
                    {data.stageItem.name}
                  </Badge>
                  {winnerByStageItemId[data.stageItem.id] != null ? (
                    <Badge color="yellow" variant="light" mt="0.8rem" size="md">
                      Winner: {winnerByStageItemId[data.stageItem.id]}
                    </Badge>
                  ) : null}
                </Flex>
              </Grid.Col>
            </Grid>
          </Card.Section>
          <Stack pt="sm">
            <Grid>
              <Grid.Col span="auto" pb="0rem">
                {renderTeamLabel(team1Label, team1Name)}
              </Grid.Col>
              <Grid.Col span="content" pb="0rem">
                <div
                  style={{
                    backgroundColor: team1_color,
                    borderRadius: '0.5rem',
                    paddingLeft: '1rem',
                    paddingRight: '1rem',
                    color: 'white',
                    fontWeight: 800,
                  }}
                >
                  {data.match.stage_item_input1_score}
                </div>
              </Grid.Col>
            </Grid>
            <Grid mb="0rem">
              <Grid.Col span="auto" pb="0rem">
                {renderTeamLabel(team2Label, team2Name)}
              </Grid.Col>
              <Grid.Col span="content" pb="0rem">
                <div
                  style={{
                    backgroundColor: team2_color,
                    borderRadius: '0.5rem',
                    paddingLeft: '1rem',
                    paddingRight: '1rem',
                    color: 'white',
                    fontWeight: 800,
                  }}
                >
                  {data.match.stage_item_input2_score}
                </div>
              </Grid.Col>
            </Grid>
          </Stack>
        </Card>
      </UnstyledButton>
    </div>
  );
}

class SectionErrorBoundary extends React.Component<
  { title: string; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { title: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: React.ErrorInfo) {
    // Prevent full-page crash if one section receives malformed API data.
  }

  render() {
    if (this.state.hasError) {
      return (
        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md">
          {this.props.title}
        </Alert>
      );
    }
    return this.props.children;
  }
}

function Schedule({
  t,
  stageItemsLookup,
  openMatchModal,
  matchesLookup,
  canEditMatch,
  isSubmittableByUser,
  winnerByStageItemId,
  resolveDeckPreviewForTeam,
  buildBaseTrackerHref,
  getKarabastGameName,
  getKarabastLobbyUrl,
  copyKarabastGameName,
  copyKarabastDeckForSlot,
  editKarabastLobbyUrl,
  karabastEnabled,
}: {
  t: Translator;
  stageItemsLookup: any;
  openMatchModal: CallableFunction;
  matchesLookup: any;
  canEditMatch: (match: any) => boolean;
  isSubmittableByUser: (match: any) => boolean;
  winnerByStageItemId: Record<number, string>;
  resolveDeckPreviewForTeam: (teamName: string | null | undefined) => TeamDeckPreview | null;
  buildBaseTrackerHref: (match: any) => string;
  getKarabastGameName: (match: any) => string;
  getKarabastLobbyUrl: (match: any) => string | null;
  copyKarabastGameName: (match: any) => Promise<void>;
  copyKarabastDeckForSlot: (match: any, slot: number) => Promise<void>;
  editKarabastLobbyUrl: (match: any) => Promise<void>;
  karabastEnabled: boolean;
}) {
  const matches: any[] = Object.values(matchesLookup ?? {}).filter(
    (value: any) => value != null && value.match != null && value.stageItem != null
  );
  const sortedMatches = matches
    .filter((entry: any) => entry?.match?.start_time != null)
    .sort((left: any, right: any) => {
      const leftCourt = String(left?.match?.court?.name ?? '');
      const rightCourt = String(right?.match?.court?.name ?? '');
      if (leftCourt !== rightCourt) return leftCourt.localeCompare(rightCourt);
      const leftTime = String(left?.match?.start_time ?? '');
      const rightTime = String(right?.match?.start_time ?? '');
      return leftTime.localeCompare(rightTime);
    });

  const rows: React.JSX.Element[] = [];

  for (let c = 0; c < sortedMatches.length; c += 1) {
    const data = sortedMatches[c];

    if (c < 1 || sortedMatches[c - 1]?.match?.start_time) {
      const startTime = formatTime(data.match.start_time);

      if (c < 1 || startTime !== formatTime(sortedMatches[c - 1].match.start_time)) {
        rows.push(
          <Center mt="md" key={`time-${c}`}>
            <Text size="xl" fw={800}>
              {startTime}
            </Text>
          </Center>
        );
      }
    }

    rows.push(
      <ScheduleRow
        key={data.match.id}
        data={data}
        openMatchModal={openMatchModal}
        stageItemsLookup={stageItemsLookup}
        matchesLookup={matchesLookup}
        editable={canEditMatch(data.match)}
        submittableByUser={isSubmittableByUser(data.match)}
        winnerByStageItemId={winnerByStageItemId}
        resolveDeckPreviewForTeam={resolveDeckPreviewForTeam}
        baseTrackerHref={buildBaseTrackerHref(data.match)}
        karabastGameName={getKarabastGameName(data.match)}
        karabastLobbyUrl={getKarabastLobbyUrl(data.match)}
        onCopyKarabastGameName={async () => copyKarabastGameName(data.match)}
        onCopyKarabastDeckSlot={async (slot) => copyKarabastDeckForSlot(data.match, slot)}
        onEditKarabastLobbyUrl={async () => editKarabastLobbyUrl(data.match)}
        karabastEnabled={karabastEnabled}
      />
    );
  }

  if (rows.length < 1) {
    return (
      <NoContent
        title={t('no_matches_title')}
        description={t('no_matches_description')}
        icon={<AiOutlineHourglass />}
      />
    );
  }

  const noItemsAlert =
    sortedMatches.length < 1 ? (
      <Alert
        icon={<IconAlertCircle size={16} />}
        title={t('no_matches_title')}
        color="gray"
        radius="md"
      >
        {t('drop_match_alert_title')}
      </Alert>
    ) : null;

  return (
    <Group wrap="nowrap" align="top">
      <div style={{ width: '48rem' }}>
        {rows}
        {noItemsAlert}
      </div>
    </Group>
  );
}

export default function ResultsPage() {
  const [modalOpened, modalSetOpened] = useState(false);
  const [match, setMatch] = useState<MatchWithDetails | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [selectedBracketStageItemId, setSelectedBracketStageItemId] = useState<number | null>(null);
  const [winnerActionStageItemIds, setWinnerActionStageItemIds] = useState<number[]>([]);
  const useStageDropdown = useMediaQuery('(max-width: 62em)');

  const { t } = useTranslation();
  const { tournamentData } = getTournamentIdFromRouter();
  const swrCurrentUserResponse = getUser();
  const currentUser = swrCurrentUserResponse.data?.data ?? null;
  const isAdmin = String(currentUser?.account_type ?? 'REGULAR') === 'ADMIN';
  const includeTeamPlayers = currentUser == null ? false : !isAdmin;
  const swrStagesResponse = getStages(tournamentData.id, true, includeTeamPlayers);
  const swrCourtsResponse = getCourts(tournamentData.id);
  const swrTournamentResponse = getTournamentById(tournamentData.id);
  const swrApplicationsResponse = getTournamentApplications(tournamentData.id, 'all');
  const swrUserDirectoryResponse = getUserDirectory();
  const swrCardsResponse = getLeagueCardsGlobal({ limit: 5000, offset: 0 });
  const karabastEnabled =
    String(swrTournamentResponse.data?.data?.club_name ?? '')
      .trim()
      .toLowerCase() === 'karabast';

  const stageItemsLookup = responseIsValid(swrStagesResponse)
    ? getStageItemLookup(swrStagesResponse)
    : [];
  const matchesLookup = responseIsValid(swrStagesResponse) ? getMatchLookup(swrStagesResponse) : [];
  const stages = swrStagesResponse.data?.data ?? [];

  useEffect(() => {
    if (stages.length < 1) {
      setSelectedStageId(null);
      return;
    }
    const hasSelectedStage = stages.some((stage: any) => String(stage.id) === selectedStageId);
    if (!hasSelectedStage) {
      setSelectedStageId(String(stages[0].id));
    }
  }, [stages, selectedStageId]);

  const selectedStage =
    stages.find((stage: any) => String(stage.id) === selectedStageId) ?? stages[0] ?? null;
  const eliminationStageItemsInSelectedStage = useMemo(
    () =>
      (selectedStage?.stage_items ?? []).filter(
        (stageItem: any) =>
          stageItem.type === 'SINGLE_ELIMINATION' || stageItem.type === 'DOUBLE_ELIMINATION'
      ),
    [selectedStage]
  );

  useEffect(() => {
    if (eliminationStageItemsInSelectedStage.length < 1) {
      setSelectedBracketStageItemId(null);
      return;
    }
    const hasSelectedBracketStageItem = eliminationStageItemsInSelectedStage.some(
      (stageItem: any) => stageItem.id === selectedBracketStageItemId
    );
    if (!hasSelectedBracketStageItem) {
      setSelectedBracketStageItemId(eliminationStageItemsInSelectedStage[0].id);
    }
  }, [eliminationStageItemsInSelectedStage, selectedBracketStageItemId]);
  const stageItemOutcomeSummaries = useMemo(() => {
    const summaries: Array<{
      stage_item_id: number;
      stage_item_name: string;
      is_complete: boolean;
      has_pending_matches: boolean;
      is_confirmed: boolean;
      ended_early: boolean;
      computed_winner: string;
      computed_winner_player_names: string[];
      confirmed_winner: string;
      confirmed_winner_player_names: string[];
    }> = [];
    stages.forEach((stage: any) => {
      (stage.stage_items ?? []).forEach((stageItem: any) => {
        const nonDraftMatches = (stageItem.rounds ?? []).flatMap((round: any) =>
          round.is_draft ? [] : (round.matches ?? [])
        );
        if (nonDraftMatches.length < 1) return;

        const hasPendingMatches = nonDraftMatches.some(
          (match: any) => match.stage_item_input1_score === 0 && match.stage_item_input2_score === 0
        );
        const isComplete = !hasPendingMatches;

        const rankedInputs = [...(stageItem.inputs ?? [])]
          .filter((input: any) => input?.team?.name != null)
          .sort((a: any, b: any) => {
            const pointsDiff = Number(b?.points ?? 0) - Number(a?.points ?? 0);
            if (pointsDiff !== 0) return pointsDiff;
            const winsDiff = Number(b?.wins ?? 0) - Number(a?.wins ?? 0);
            if (winsDiff !== 0) return winsDiff;
            const drawsDiff = Number(b?.draws ?? 0) - Number(a?.draws ?? 0);
            if (drawsDiff !== 0) return drawsDiff;
            const lossesDiff = Number(a?.losses ?? 0) - Number(b?.losses ?? 0);
            if (lossesDiff !== 0) return lossesDiff;
            return String(a?.team?.name ?? '').localeCompare(String(b?.team?.name ?? ''));
          });
        const winnerInput = rankedInputs[0] ?? null;
        const computedWinner = String(winnerInput?.team?.name ?? '').trim();
        const computedWinnerPlayerNames = Array.isArray(winnerInput?.team?.players)
          ? winnerInput.team.players
              .map((player: any) => String(player?.name ?? '').trim().toLowerCase())
              .filter((name: string) => name !== '')
          : [];

        const confirmed = Boolean(stageItem?.winner_confirmed);
        const endedEarly = Boolean(stageItem?.ended_early);
        const confirmedWinnerTeamId = Number(stageItem?.winner_team_id ?? 0);
        let confirmedWinner = String(stageItem?.winner_team_name ?? '').trim();
        let confirmedWinnerPlayerNames: string[] = [];
        if (confirmedWinnerTeamId > 0) {
          const confirmedInput =
            (stageItem.inputs ?? []).find(
              (input: any) => Number(input?.team?.id ?? 0) === confirmedWinnerTeamId
            ) ?? null;
          if (confirmedInput != null) {
            if (confirmedWinner === '') {
              confirmedWinner = String(confirmedInput?.team?.name ?? '').trim();
            }
            confirmedWinnerPlayerNames = Array.isArray(confirmedInput?.team?.players)
              ? confirmedInput.team.players
                  .map((player: any) => String(player?.name ?? '').trim().toLowerCase())
                  .filter((name: string) => name !== '')
              : [];
          }
        }
        if (confirmedWinner === '') confirmedWinner = computedWinner;

        summaries.push({
          stage_item_id: stageItem.id,
          stage_item_name: String(stageItem?.name ?? `Event ${stageItem?.id ?? ''}`),
          is_complete: isComplete,
          has_pending_matches: hasPendingMatches,
          is_confirmed: confirmed,
          ended_early: endedEarly,
          computed_winner: computedWinner,
          computed_winner_player_names: [...new Set(computedWinnerPlayerNames)],
          confirmed_winner: confirmedWinner,
          confirmed_winner_player_names: [...new Set(confirmedWinnerPlayerNames)],
        });
      });
    });
    return summaries;
  }, [stages]);
  const confirmedStageItemWinners = useMemo(
    () =>
      stageItemOutcomeSummaries
        .filter((summary) => summary.is_confirmed && summary.confirmed_winner !== '')
        .map((summary) => ({
          stage_item_id: summary.stage_item_id,
          stage_item_name: summary.stage_item_name,
          winner: summary.confirmed_winner,
          winner_player_names: summary.confirmed_winner_player_names,
          ended_early: summary.ended_early,
        })),
    [stageItemOutcomeSummaries]
  );
  const pendingOutcomeConfirmations = useMemo(
    () =>
      stageItemOutcomeSummaries.filter(
        (summary) => summary.is_complete && !summary.is_confirmed && summary.computed_winner !== ''
      ),
    [stageItemOutcomeSummaries]
  );
  const endEarlyEligibleStageItems = useMemo(
    () =>
      stageItemOutcomeSummaries.filter(
        (summary) =>
          !summary.is_complete &&
          summary.has_pending_matches &&
          !summary.is_confirmed &&
          summary.computed_winner !== ''
      ),
    [stageItemOutcomeSummaries]
  );
  const eventStandings = useMemo(() => {
    const statsByTeamName = new Map<
      string,
      { name: string; swiss_points: number; wins: number; draws: number; losses: number }
    >();
    stages.forEach((stage: any) => {
      (stage.stage_items ?? []).forEach((stageItem: any) => {
        const hasNonDraftRounds = (stageItem.rounds ?? []).some((round: any) => !round?.is_draft);
        if (!hasNonDraftRounds) return;
        (stageItem.inputs ?? []).forEach((input: any) => {
          const teamName = String(input?.team?.name ?? '').trim();
          if (teamName === '') return;
          const key = teamName.toLowerCase();
          const current = statsByTeamName.get(key) ?? {
            name: teamName,
            swiss_points: 0,
            wins: 0,
            draws: 0,
            losses: 0,
          };
          current.swiss_points += Number(input?.points ?? 0);
          current.wins += Number(input?.wins ?? 0);
          current.draws += Number(input?.draws ?? 0);
          current.losses += Number(input?.losses ?? 0);
          statsByTeamName.set(key, current);
        });
      });
    });

    const sorted = [...statsByTeamName.values()].sort((left, right) => {
      const leftPoints = Number(left?.swiss_points ?? 0);
      const rightPoints = Number(right?.swiss_points ?? 0);
      if (rightPoints !== leftPoints) return rightPoints - leftPoints;
      const winsDiff = Number(right?.wins ?? 0) - Number(left?.wins ?? 0);
      if (winsDiff !== 0) return winsDiff;
      const drawsDiff = Number(right?.draws ?? 0) - Number(left?.draws ?? 0);
      if (drawsDiff !== 0) return drawsDiff;
      const lossesDiff = Number(left?.losses ?? 0) - Number(right?.losses ?? 0);
      if (lossesDiff !== 0) return lossesDiff;
      return String(left?.name ?? '').localeCompare(String(right?.name ?? ''));
    });
    return sorted.map((team: any, index: number) => {
      const wins = Number(team?.wins ?? 0);
      const draws = Number(team?.draws ?? 0);
      const losses = Number(team?.losses ?? 0);
      const matches = wins + draws + losses;
      return {
        rank: index + 1,
        name: String(team?.name ?? ''),
        swiss_points: Number(team?.swiss_points ?? 0),
        wins,
        draws,
        losses,
        win_rate: matches > 0 ? ((wins / matches) * 100).toFixed(2) : '0.00',
      };
    });
  }, [stages]);

  const cardLookupById = useMemo(() => {
    const rows = swrCardsResponse.data?.data?.cards ?? [];
    return rows.reduce((result: Record<string, { name: string; image_url: string | null }>, card: any) => {
      const payload = {
        name: String(card?.name ?? card?.card_id ?? ''),
        image_url: card?.image_url ?? null,
      };
      buildCardLookupKeys(card?.card_id).forEach((key) => {
        if (key !== '' && result[key] == null) {
          result[key] = payload;
        }
      });
      return result;
    }, {});
  }, [swrCardsResponse.data?.data?.cards]);

  const applicationByUserName = useMemo(() => {
    const applications = swrApplicationsResponse.data?.data ?? [];
    return applications.reduce((result: Record<string, any>, row: any) => {
      const key = String(row?.user_name ?? '').trim().toLowerCase();
      if (key === '' || result[key] != null) return result;
      result[key] = row;
      return result;
    }, {});
  }, [swrApplicationsResponse.data?.data]);

  const resolveDeckPreviewForTeam = (teamName: string | null | undefined): TeamDeckPreview | null => {
    const key = String(teamName ?? '').trim().toLowerCase();
    if (key === '') return null;
    const application = applicationByUserName[key];
    if (application == null) return null;
    const leaderLookupKey =
      buildCardLookupKeys(application.deck_leader).find((candidate) => cardLookupById[candidate] != null) ?? '';
    const baseLookupKey =
      buildCardLookupKeys(application.deck_base).find((candidate) => cardLookupById[candidate] != null) ?? '';
    if (leaderLookupKey === '' || baseLookupKey === '') return null;
    return {
      leaderName: cardLookupById[leaderLookupKey]?.name ?? application.deck_leader ?? '-',
      baseName: cardLookupById[baseLookupKey]?.name ?? application.deck_base ?? '-',
      leaderImageUrl: cardLookupById[leaderLookupKey]?.image_url ?? null,
      baseImageUrl: cardLookupById[baseLookupKey]?.image_url ?? null,
    };
  };
  const winnerByStageItemId = useMemo(
    () =>
      confirmedStageItemWinners.reduce(
        (result: Record<number, string>, item) => {
          result[item.stage_item_id] = item.winner;
          return result;
        },
        {}
      ),
    [confirmedStageItemWinners]
  );
  const avatarUrlByUserName = useMemo(() => {
    const rows = swrUserDirectoryResponse.data?.data ?? [];
    return rows.reduce((result: Record<string, string>, row: any) => {
      const key = String(row?.user_name ?? '').trim().toLowerCase();
      const rawAvatarUrl = String(row?.avatar_url ?? '').trim();
      if (key === '' || rawAvatarUrl === '' || result[key] != null) return result;
      result[key] = rawAvatarUrl.startsWith('http')
        ? rawAvatarUrl
        : `${getBaseApiUrl()}/${rawAvatarUrl}`;
      return result;
    }, {});
  }, [swrUserDirectoryResponse.data?.data]);
  const championBannerAvatarUrl = useMemo(() => {
    for (const winnerSummary of confirmedStageItemWinners) {
      const winnerNameKey = String(winnerSummary?.winner ?? '').trim().toLowerCase();
      if (winnerNameKey === '') continue;
      const avatarUrl = avatarUrlByUserName[winnerNameKey];
      if (avatarUrl != null && avatarUrl !== '') {
        return avatarUrl;
      }
    }
    return null;
  }, [avatarUrlByUserName, confirmedStageItemWinners]);
  useEffect(() => {
    if (!isAdmin || pendingOutcomeConfirmations.length < 1) return;
    if (typeof window === 'undefined') return;

    const unseen = pendingOutcomeConfirmations.filter((summary) => {
      const storageKey = `${OUTCOME_CONFIRMATION_NOTICE_STORAGE_PREFIX}_${tournamentData.id}_${summary.stage_item_id}`;
      if (window.localStorage.getItem(storageKey) === '1') return false;
      window.localStorage.setItem(storageKey, '1');
      return true;
    });
    if (unseen.length < 1) return;

    showNotification({
      color: 'orange',
      title: 'Event outcome confirmation required',
      message:
        unseen.length === 1
          ? `${unseen[0].stage_item_name} has a calculated winner ready to confirm.`
          : `${unseen.length} events have calculated winners ready to confirm.`,
      autoClose: 8000,
    });
  }, [isAdmin, pendingOutcomeConfirmations, tournamentData.id]);
  useEffect(() => {
    const currentUserName = String(currentUser?.name ?? '').trim().toLowerCase();
    if (currentUserName === '' || confirmedStageItemWinners.length < 1) return;
    if (typeof window === 'undefined') return;

    const newlyWon: Array<{ stage_item_id: number; stage_item_name: string }> = [];
    confirmedStageItemWinners.forEach((winnerSummary) => {
      const winnerName = String(winnerSummary?.winner ?? '').trim().toLowerCase();
      const winnerPlayers = Array.isArray(winnerSummary?.winner_player_names)
        ? winnerSummary.winner_player_names
        : [];
      const isWinner =
        winnerName === currentUserName ||
        winnerPlayers.some((playerName: string) => playerName === currentUserName);
      if (!isWinner) return;

      const storageKey = `${WIN_CELEBRATION_STORAGE_PREFIX}_${tournamentData.id}_${winnerSummary.stage_item_id}_${currentUserName}`;
      if (window.localStorage.getItem(storageKey) === '1') return;
      window.localStorage.setItem(storageKey, '1');
      newlyWon.push({
        stage_item_id: winnerSummary.stage_item_id,
        stage_item_name: String(winnerSummary.stage_item_name ?? '').trim() || 'event',
      });
    });

    if (newlyWon.length < 1) return;

    launchWinnerConfetti();
    const wonLabel =
      newlyWon.length === 1
        ? `You won ${newlyWon[0].stage_item_name}.`
        : `You won ${newlyWon.length} events: ${newlyWon.map((item) => item.stage_item_name).join(', ')}.`;
    showNotification({
      color: 'yellow',
      title: 'Congratulations, Champion!',
      message: `${wonLabel} Great run.`,
      autoClose: 9000,
    });
  }, [currentUser?.name, confirmedStageItemWinners, tournamentData.id]);
  const activeBracketStageItem =
    eliminationStageItemsInSelectedStage.find(
      (stageItem: any) => stageItem.id === selectedBracketStageItemId
    ) ??
    eliminationStageItemsInSelectedStage[0] ??
    null;
  const stageOptions = stages.map((stage: any) => ({
    value: String(stage.id),
    label: String(stage.name ?? `Stage ${stage.id}`),
  }));
  const bracketStageItemOptions = eliminationStageItemsInSelectedStage.map((stageItem: any) => ({
    value: String(stageItem.id),
    label: String(stageItem.name ?? `Stage Item ${stageItem.id}`),
  }));
  const bracketSections = useMemo<BracketTreeSection[]>(() => {
    if (activeBracketStageItem == null) return [];
    const nowTimestamp = Date.now();

    const inputLookup = (activeBracketStageItem.inputs ?? []).reduce(
      (result: Record<number, any>, input: any) => {
        const inputId = Number(input?.id ?? 0);
        if (Number.isFinite(inputId) && inputId > 0) result[inputId] = input;
        return result;
      },
      {}
    );
    const sortedRounds = [...(activeBracketStageItem.rounds ?? [])]
      .filter((round: any) => !round?.is_draft)
      .sort((left: any, right: any) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
    if (sortedRounds.length < 1) return [];

    const winnersRoundCount =
      activeBracketStageItem.type === 'DOUBLE_ELIMINATION'
        ? getSingleEliminationRoundCount(Number(activeBracketStageItem?.team_count ?? 0))
        : 0;
    const losersRoundCount =
      activeBracketStageItem.type === 'DOUBLE_ELIMINATION'
        ? Math.max(0, 2 * winnersRoundCount - 2)
        : 0;

    const roundMetaById = new Map<
      number,
      {
        section: BracketSectionKey;
        sectionIndex: number;
        label: string;
      }
    >();
    const sectionCounters: Record<BracketSectionKey, number> = {
      WINNERS: 0,
      LOSERS: 0,
      FINALS: 0,
      MAIN: 0,
    };

    sortedRounds.forEach((round: any, roundIndex: number) => {
      const roundId = Number(round?.id ?? 0);
      if (!Number.isFinite(roundId) || roundId <= 0) return;
      const rawRoundName = normalizeRoundName(round?.name);
      const section: BracketSectionKey =
        activeBracketStageItem.type === 'DOUBLE_ELIMINATION'
          ? inferDoubleEliminationSection(
              rawRoundName,
              roundIndex,
              winnersRoundCount,
              losersRoundCount
            )
          : 'MAIN';
      sectionCounters[section] += 1;

      const genericRoundName =
        rawRoundName === '' ||
        (/^round\s+\d+$/i.test(rawRoundName) && activeBracketStageItem.type === 'DOUBLE_ELIMINATION');
      const label =
        activeBracketStageItem.type === 'DOUBLE_ELIMINATION'
          ? getDoubleEliminationRoundLabel(
              section,
              sectionCounters[section],
              winnersRoundCount,
              losersRoundCount
            )
          : activeBracketStageItem.type === 'SINGLE_ELIMINATION'
            ? rawRoundName !== '' && !genericRoundName
              ? rawRoundName
              : getSingleEliminationRoundLabel(sectionCounters.MAIN, sortedRounds.length)
            : rawRoundName !== '' && !genericRoundName
              ? rawRoundName
              : sectionCounters.MAIN === sortedRounds.length
                ? 'Final'
                : `Round ${sectionCounters.MAIN}`;

      roundMetaById.set(roundId, {
        section,
        sectionIndex: sectionCounters[section],
        label,
      });
    });

    const matchesWithRoundMeta = sortedRounds.flatMap((round: any) =>
      [...(round?.matches ?? [])]
        .filter((match: any) => match != null)
        .map((match: any) => ({
          ...match,
          __round_id: Number(round?.id ?? 0),
        }))
    );

    const matchesById = matchesWithRoundMeta.reduce((result: Record<number, any>, match: any) => {
      const matchId = Number(match?.id ?? 0);
      if (Number.isFinite(matchId) && matchId > 0) {
        result[matchId] = match;
      }
      return result;
    }, {});
    const sourceMatchIdsByMatchId = matchesWithRoundMeta.reduce(
      (result: Record<number, number[]>, match: any) => {
        const matchId = Number(match?.id ?? 0);
        if (!Number.isFinite(matchId) || matchId <= 0) return result;
        result[matchId] = Array.from(
          new Set(
            [
              Number(match?.stage_item_input1_winner_from_match_id ?? 0),
              Number(match?.stage_item_input2_winner_from_match_id ?? 0),
              Number(match?.stage_item_input1_loser_from_match_id ?? 0),
              Number(match?.stage_item_input2_loser_from_match_id ?? 0),
            ].filter((sourceId) => Number.isFinite(sourceId) && sourceId > 0 && matchesById[sourceId] != null)
          )
        );
        return result;
      },
      {}
    );

    const matchSectionById = matchesWithRoundMeta.reduce((result: Record<number, BracketSectionKey>, match: any) => {
      const matchId = Number(match?.id ?? 0);
      const roundId = Number(match?.__round_id ?? 0);
      const roundMeta = roundMetaById.get(roundId);
      if (Number.isFinite(matchId) && matchId > 0 && roundMeta != null) {
        result[matchId] = roundMeta.section;
      }
      return result;
    }, {});

    const sectionColumns: Record<BracketSectionKey, any[]> = {
      WINNERS: [],
      LOSERS: [],
      FINALS: [],
      MAIN: [],
    };
    const yOrderByMatchId: Record<number, number> = {};
    const getSeedFallback = (match: any): number => {
      const slot1 = Number(match?.stage_item_input1?.slot ?? inputLookup[Number(match?.stage_item_input1_id ?? 0)]?.slot ?? 9999);
      const slot2 = Number(match?.stage_item_input2?.slot ?? inputLookup[Number(match?.stage_item_input2_id ?? 0)]?.slot ?? 9999);
      return Math.min(slot1, slot2);
    };

    sortedRounds.forEach((round: any, roundIndex: number) => {
      const roundId = Number(round?.id ?? 0);
      const roundMeta = roundMetaById.get(roundId);
      const roundName =
        roundMeta?.label ?? (normalizeRoundName(round?.name) || `Round ${roundIndex + 1}`);
      const roundMatches = [...(round?.matches ?? [])].filter((match: any) => match != null);
      const sortedRoundMatches = roundMatches.sort((left: any, right: any) => {
        const leftSources = sourceMatchIdsByMatchId[Number(left?.id ?? 0)] ?? [];
        const rightSources = sourceMatchIdsByMatchId[Number(right?.id ?? 0)] ?? [];

        const leftHasSourceOrder = leftSources.some((sourceId) => yOrderByMatchId[sourceId] != null);
        const rightHasSourceOrder = rightSources.some((sourceId) => yOrderByMatchId[sourceId] != null);
        if (leftHasSourceOrder !== rightHasSourceOrder) {
          return leftHasSourceOrder ? 1 : -1;
        }
        if (leftHasSourceOrder && rightHasSourceOrder) {
          const leftAvgOrder =
            leftSources
              .map((sourceId) => yOrderByMatchId[sourceId])
              .filter((value) => value != null)
              .reduce((sum, value) => sum + value, 0) / leftSources.length;
          const rightAvgOrder =
            rightSources
              .map((sourceId) => yOrderByMatchId[sourceId])
              .filter((value) => value != null)
              .reduce((sum, value) => sum + value, 0) / rightSources.length;
          if (leftAvgOrder !== rightAvgOrder) {
            return leftAvgOrder - rightAvgOrder;
          }
        }

        const seedDelta = getSeedFallback(left) - getSeedFallback(right);
        if (seedDelta !== 0) return seedDelta;
        return Number(left?.id ?? 0) - Number(right?.id ?? 0);
      });

      const matchRows = sortedRoundMatches.map((match: any, matchIndex: number) => {
        const matchId = Number(match?.id ?? 0);
        yOrderByMatchId[matchId] = matchIndex;
        const team1 = match?.stage_item_input1;
        const team2 = match?.stage_item_input2;
        const fallbackTeam1 = formatMatchInput1(t, stageItemsLookup, matchesLookup, match);
        const fallbackTeam2 = formatMatchInput2(t, stageItemsLookup, matchesLookup, match);
        const isTopBye =
          match?.stage_item_input1_id == null &&
          match?.stage_item_input1_winner_from_match_id == null &&
          match?.stage_item_input1_loser_from_match_id == null;
        const isBottomBye =
          match?.stage_item_input2_id == null &&
          match?.stage_item_input2_winner_from_match_id == null &&
          match?.stage_item_input2_loser_from_match_id == null;
        const team1Name =
          isTopBye ? 'BYE' : String(team1?.team?.name ?? fallbackTeam1 ?? 'TBD').trim() || 'TBD';
        const team2Name =
          isBottomBye ? 'BYE' : String(team2?.team?.name ?? fallbackTeam2 ?? 'TBD').trim() || 'TBD';
        const team1InputId = Number(match?.stage_item_input1_id ?? 0);
        const team2InputId = Number(match?.stage_item_input2_id ?? 0);
        const topSeed = String(team1?.slot ?? inputLookup[team1InputId]?.slot ?? '-');
        const bottomSeed = String(team2?.slot ?? inputLookup[team2InputId]?.slot ?? '-');
        const loserSourceIds = [
          Number(match?.stage_item_input1_loser_from_match_id ?? 0),
          Number(match?.stage_item_input2_loser_from_match_id ?? 0),
        ].filter((sourceId) => Number.isFinite(sourceId) && sourceId > 0);
        const receivedDropFromWinners = loserSourceIds.some(
          (sourceId) => matchSectionById[sourceId] === 'WINNERS'
        );
        const matchNote =
          activeBracketStageItem.type === 'DOUBLE_ELIMINATION' &&
          roundMeta?.section === 'FINALS' &&
          /reset/i.test(roundName)
            ? 'Reset'
            : receivedDropFromWinners
              ? 'WB Drop'
              : undefined;
        const topScore = Number(match?.stage_item_input1_score ?? 0);
        const bottomScore = Number(match?.stage_item_input2_score ?? 0);
        const hasScoreWinner = topScore !== bottomScore;
        const hasByeResolution = (isTopBye && !isBottomBye) || (!isTopBye && isBottomBye);
        const startTimeRaw = String(match?.start_time ?? '').trim();
        const startTimeMs = startTimeRaw === '' ? Number.NaN : Date.parse(startTimeRaw);
        const hasStarted = Number.isFinite(startTimeMs) && startTimeMs <= nowTimestamp;
        const matchStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' =
          hasScoreWinner || hasByeResolution
            ? 'COMPLETE'
            : hasStarted
              ? 'IN_PROGRESS'
              : 'PENDING';

        return {
          id: matchId,
          sourceMatchIds: sourceMatchIdsByMatchId[matchId] ?? [],
          topSeed,
          topName: team1Name,
          topScore,
          bottomSeed,
          bottomName: team2Name,
          bottomScore,
          note: matchNote,
          status: matchStatus,
        };
      });

      const column = {
        id: `round-${round.id}`,
        name: roundName,
        matches: matchRows,
      };
      const sectionKey = roundMeta?.section ?? 'MAIN';
      sectionColumns[sectionKey].push(column);
    });

    if (activeBracketStageItem.type === 'DOUBLE_ELIMINATION') {
      return [
        {
          id: 'winners',
          name: 'Winners Bracket',
          description: 'Undefeated players remain here until their first loss.',
          columns: sectionColumns.WINNERS,
        },
        {
          id: 'losers',
          name: 'Losers Bracket',
          description: 'Players with one loss continue here. A second loss eliminates them.',
          columns: sectionColumns.LOSERS,
        },
        {
          id: 'finals',
          name: 'Grand Finals',
          description: 'LB champion faces WB champion. A reset match appears if needed.',
          columns: sectionColumns.FINALS,
        },
      ].filter((section) => section.columns.length > 0);
    }
    return [
      {
        id: 'main',
        name: 'Bracket',
        description: 'Single-elimination progression.',
        columns: sectionColumns.MAIN,
      },
    ].filter((section) => section.columns.length > 0);
  }, [activeBracketStageItem, matchesLookup, stageItemsLookup, t]);
  const bracketHasColumns = useMemo(
    () => bracketSections.some((section) => section.columns.length > 0),
    [bracketSections]
  );
  const eliminationRecords = useMemo(() => {
    if (activeBracketStageItem == null) return [];

    const eliminationLossThreshold = activeBracketStageItem.type === 'DOUBLE_ELIMINATION' ? 2 : 1;
    const rowsByInputId = new Map<
      number,
      { inputId: number; seed: number; name: string; wins: number; losses: number }
    >();

    (activeBracketStageItem.inputs ?? []).forEach((input: any) => {
      const inputId = Number(input?.id ?? 0);
      if (!Number.isFinite(inputId) || inputId <= 0) return;
      rowsByInputId.set(inputId, {
        inputId,
        seed: Number(input?.slot ?? 0),
        name: String(input?.team?.name ?? 'TBD').trim() || 'TBD',
        wins: 0,
        losses: 0,
      });
    });

    const rounds = [...(activeBracketStageItem.rounds ?? [])]
      .filter((round: any) => !round?.is_draft)
      .sort((left: any, right: any) => Number(left?.id ?? 0) - Number(right?.id ?? 0));
    rounds.forEach((round: any) => {
      (round?.matches ?? []).forEach((match: any) => {
        const score1 = Number(match?.stage_item_input1_score ?? 0);
        const score2 = Number(match?.stage_item_input2_score ?? 0);
        if (score1 === score2) return;

        const winnerInputId =
          score1 > score2
            ? Number(match?.stage_item_input1_id ?? 0)
            : Number(match?.stage_item_input2_id ?? 0);
        const loserInputId =
          score1 > score2
            ? Number(match?.stage_item_input2_id ?? 0)
            : Number(match?.stage_item_input1_id ?? 0);
        const winner = rowsByInputId.get(winnerInputId);
        if (winner != null) winner.wins += 1;
        const loser = rowsByInputId.get(loserInputId);
        if (loser != null) loser.losses += 1;
      });
    });

    return [...rowsByInputId.values()]
      .map((row) => ({
        ...row,
        record: `${row.wins}-${row.losses}`,
        eliminated: row.losses >= eliminationLossThreshold,
      }))
      .sort((left, right) => {
        if (left.eliminated !== right.eliminated) return left.eliminated ? 1 : -1;
        if (left.losses !== right.losses) return left.losses - right.losses;
        if (left.wins !== right.wins) return right.wins - left.wins;
        if (left.seed !== right.seed) return left.seed - right.seed;
        return left.name.localeCompare(right.name);
      });
  }, [activeBracketStageItem]);

  if (swrStagesResponse.error || swrCourtsResponse.error) {
    return (
      <TournamentLayout tournament_id={tournamentData.id}>
        <Title>{t('results_title')}</Title>
        {swrStagesResponse.error != null ? <RequestErrorAlert error={swrStagesResponse.error} /> : null}
        {swrCourtsResponse.error != null ? <RequestErrorAlert error={swrCourtsResponse.error} /> : null}
      </TournamentLayout>
    );
  }

  if (!responseIsValid(swrStagesResponse) || !responseIsValid(swrCourtsResponse)) {
    return (
      <TournamentLayout tournament_id={tournamentData.id}>
        <Title>{t('results_title')}</Title>
        <Text c="dimmed">Loading results…</Text>
      </TournamentLayout>
    );
  }

  const currentUserName = String(currentUser?.name ?? '').trim().toLowerCase();
  const userIsInMatch = (matchToCheck: any) => {
    if (currentUserName === '') return false;
    return [matchToCheck?.stage_item_input1, matchToCheck?.stage_item_input2].some((input: any) => {
      const teamName = String(input?.team?.name ?? '').trim().toLowerCase();
      if (teamName === currentUserName) return true;
      const players = Array.isArray(input?.team?.players) ? input.team.players : [];
      return players.some(
        (player: any) => String(player?.name ?? '').trim().toLowerCase() === currentUserName
      );
    });
  };

  function canEditMatch(matchToCheck: any) {
    if (isAdmin) return true;
    return userIsInMatch(matchToCheck);
  }

  function openMatchModal(matchToOpen: MatchWithDetails) {
    setMatch(matchToOpen);
    modalSetOpened(true);
  }

  function modalSetOpenedAndUpdateMatch(opened: boolean) {
    if (!opened) {
      setMatch(null);
    }
    modalSetOpened(opened);
  }

  const buildBaseTrackerHref = (matchToTrack: any) => {
    const matchId = Number(matchToTrack?.id ?? 0);
    const tournamentId = Number(matchToTrack?.tournament_id ?? tournamentData.id ?? 0);
    if (!Number.isFinite(matchId) || matchId <= 0 || !Number.isFinite(tournamentId) || tournamentId <= 0) {
      return '/league/base-health';
    }
    return `/league/base-health?tournament_id=${tournamentId}&match_id=${matchId}`;
  };

  const getKarabastGameName = (matchToTrack: any) => {
    const customName = String((matchToTrack as any)?.karabast_game_name ?? '').trim();
    if (customName !== '') return customName;
    const matchId = Number(matchToTrack?.id ?? 0);
    if (!Number.isFinite(matchId) || matchId <= 0) return `SL-${tournamentData.id}-M0`;
    return `SL-${tournamentData.id}-M${matchId}`;
  };

  const getKarabastLobbyUrl = (matchToTrack: any) => {
    const customValue = String((matchToTrack as any)?.karabast_game_name ?? '').trim();
    if (customValue === '') return null;
    try {
      const parsed = new URL(customValue);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      const hostname = parsed.hostname.toLowerCase();
      if (hostname !== 'karabast.net' && hostname !== 'www.karabast.net') return null;
      return parsed.toString();
    } catch (_error) {
      return null;
    }
  };

  const copyText = async (value: string, title: string) => {
    if (typeof window === 'undefined' || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      showNotification({
        color: 'green',
        title,
        message: '',
      });
    } catch (_error) {
      showNotification({
        color: 'red',
        title: 'Could not copy to clipboard',
        message: '',
      });
    }
  };

  const copyKarabastGameName = async (matchToTrack: any) => {
    const lobbyUrl = getKarabastLobbyUrl(matchToTrack);
    await copyText(
      lobbyUrl ?? getKarabastGameName(matchToTrack),
      lobbyUrl != null ? 'Karabast lobby URL copied' : 'Karabast lobby name copied'
    );
  };

  const editKarabastLobbyUrl = async (matchToTrack: any) => {
    const matchId = Number(matchToTrack?.id ?? 0);
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    const currentValue = String((matchToTrack as any)?.karabast_game_name ?? '').trim();
    const nextValue = window.prompt(
      'Paste the private Karabast invite link (or shared game name). Leave blank to clear.',
      currentValue
    );
    if (nextValue == null) return;
    await updateKarabastGameName(
      tournamentData.id,
      matchId,
      nextValue.trim() === '' ? null : nextValue.trim()
    );
    await swrStagesResponse.mutate();
  };

  const copyKarabastDeckForSlot = async (matchToTrack: any, slot: number) => {
    const matchId = Number(matchToTrack?.id ?? 0);
    if (!Number.isFinite(matchId) || matchId <= 0) return;
    const response = await getKarabastMatchBundle(tournamentData.id, matchId);
    const payload = response?.data?.data;
    if (payload == null) return;
    const players = Array.isArray((payload as any)?.players) ? (payload as any).players : [];
    const selectedPlayer =
      players.find((player: any) => Number(player?.slot ?? 0) === Number(slot)) ?? null;
    const deckExport = selectedPlayer?.deck_export ?? null;
    if (deckExport == null) {
      const teamName = String(selectedPlayer?.team_name ?? '').trim();
      showNotification({
        color: 'red',
        title: 'No SWUDB deck export found',
        message:
          teamName !== ''
            ? `No submitted deck found for ${teamName}.`
            : 'Save and submit decks for both players, then try again.',
      });
      return;
    }
    const teamName = String(selectedPlayer?.team_name ?? '').trim();
    const strictSwudbDeck = normalizeSwudbDeckExport(
      deckExport,
      String(selectedPlayer?.deck_name ?? '').trim(),
      String(selectedPlayer?.user_name ?? '').trim()
    );
    if (strictSwudbDeck == null) {
      showNotification({
        color: 'red',
        title: 'Invalid deck export format',
        message:
          teamName !== ''
            ? `Could not build SWUDB JSON for ${teamName}.`
            : 'Could not build SWUDB JSON for this deck.',
      });
      return;
    }
    await copyText(
      JSON.stringify(strictSwudbDeck, null, 2),
      teamName !== '' ? `${teamName} SWUDB deck copied` : 'SWUDB deck JSON copied'
    );
  };
  const setWinnerActionRunning = (stageItemId: number, running: boolean) => {
    setWinnerActionStageItemIds((current) => {
      if (running) {
        if (current.includes(stageItemId)) return current;
        return [...current, stageItemId];
      }
      return current.filter((id) => id !== stageItemId);
    });
  };
  const stageItemActionIsRunning = (stageItemId: number) =>
    winnerActionStageItemIds.includes(stageItemId);

  const confirmEventOutcome = async (summary: any) => {
    const stageItemId = Number(summary?.stage_item_id ?? 0);
    if (!Number.isFinite(stageItemId) || stageItemId <= 0) return;
    setWinnerActionRunning(stageItemId, true);
    try {
      const response = await updateStageItemWinnerConfirmation(tournamentData.id, stageItemId, true);
      if (response == null || Number((response as any)?.status ?? 500) >= 400) return;
      await swrStagesResponse.mutate();
      showNotification({
        color: 'green',
        title: 'Winner confirmed',
        message: `${String(summary?.computed_winner ?? '').trim() || 'Winner'} was confirmed for ${summary.stage_item_name}.`,
      });
    } finally {
      setWinnerActionRunning(stageItemId, false);
    }
  };

  const endEventEarly = async (summary: any) => {
    const stageItemId = Number(summary?.stage_item_id ?? 0);
    if (!Number.isFinite(stageItemId) || stageItemId <= 0) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `End "${summary.stage_item_name}" early? Remaining unplayed matchups will be cleared, and the current standings leader will be declared winner.`
      )
    ) {
      return;
    }
    setWinnerActionRunning(stageItemId, true);
    try {
      const response = await endStageItemEarly(tournamentData.id, stageItemId);
      if (response == null || Number((response as any)?.status ?? 500) >= 400) return;
      await swrStagesResponse.mutate();
      showNotification({
        color: 'green',
        title: 'Event ended early',
        message: `${summary.stage_item_name} was ended early and winner confirmed from current standings.`,
      });
    } finally {
      setWinnerActionRunning(stageItemId, false);
    }
  };

  return (
    <TournamentLayout tournament_id={tournamentData.id}>
      <MatchModal
        swrStagesResponse={swrStagesResponse}
        swrUpcomingMatchesResponse={null}
        tournamentData={tournamentData}
        match={match}
        opened={modalOpened}
        setOpened={modalSetOpenedAndUpdateMatch}
        round={null}
        allowAdvancedSettings={isAdmin}
        allowDelete={isAdmin}
        karabastEnabled={karabastEnabled}
      />
      <Group justify="space-between" align="center">
        <Title>{t('results_title')}</Title>
        <Button component={PreloadLink} href="/league/base-health" variant="light">
          Base Health Tool
        </Button>
      </Group>
      {isAdmin && pendingOutcomeConfirmations.length > 0 ? (
        <Card withBorder mt="sm">
          <Stack>
            <Group gap="xs">
              <IconAlertCircle size={18} />
              <Title order={4}>Admin: Confirm Calculated Winners</Title>
            </Group>
            {pendingOutcomeConfirmations.map((summary) => (
              <Group key={`confirm-${summary.stage_item_id}`} justify="space-between" align="center">
                <Text>
                  {summary.stage_item_name}: <b>{summary.computed_winner || 'Unknown'}</b>
                </Text>
                <Button
                  size="xs"
                  onClick={() => confirmEventOutcome(summary)}
                  loading={stageItemActionIsRunning(summary.stage_item_id)}
                >
                  Confirm outcome
                </Button>
              </Group>
            ))}
          </Stack>
        </Card>
      ) : null}
      {isAdmin && endEarlyEligibleStageItems.length > 0 ? (
        <Card withBorder mt="sm">
          <Stack>
            <Group gap="xs">
              <IconAlertCircle size={18} />
              <Title order={4}>Admin: End Event Early</Title>
            </Group>
            {endEarlyEligibleStageItems.map((summary) => (
              <Group key={`end-early-${summary.stage_item_id}`} justify="space-between" align="center">
                <Text>
                  {summary.stage_item_name}
                  {summary.computed_winner !== '' ? ` (Current leader: ${summary.computed_winner})` : ''}
                </Text>
                <Button
                  size="xs"
                  color="red"
                  onClick={() => endEventEarly(summary)}
                  loading={stageItemActionIsRunning(summary.stage_item_id)}
                >
                  End event early
                </Button>
              </Group>
            ))}
          </Stack>
        </Card>
      ) : null}
      {confirmedStageItemWinners.length > 0 ? (
        <Card
          withBorder
          mt="sm"
          style={{
            background:
              championBannerAvatarUrl != null
                ? `linear-gradient(135deg, rgba(12, 16, 28, 0.86) 0%, rgba(12, 16, 28, 0.64) 60%, rgba(12, 16, 28, 0.74) 100%), url(${championBannerAvatarUrl})`
                : 'linear-gradient(135deg, rgba(255,245,194,0.35) 0%, rgba(255,255,255,0.85) 55%, rgba(245,247,255,0.95) 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <Stack>
            <Group justify="space-between">
              <Group gap="xs">
                <IconTrophy size={20} color={championBannerAvatarUrl != null ? 'white' : undefined} />
                <Title order={4} c={championBannerAvatarUrl != null ? 'white' : undefined}>
                  Event Champions
                </Title>
              </Group>
            </Group>
            <Group>
              {confirmedStageItemWinners.map((item) => (
                <Badge key={item.stage_item_id} size="lg" color="yellow" variant="filled">
                  {item.stage_item_name}: {item.winner}
                  {item.ended_early ? ' (Ended Early)' : ''}
                </Badge>
              ))}
            </Group>
          </Stack>
        </Card>
      ) : null}
      {eventStandings.length > 0 ? (
        <Card withBorder mt="sm">
          <Stack>
            <Title order={4}>Event Standings</Title>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>#</Table.Th>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Points</Table.Th>
                  <Table.Th>Wins</Table.Th>
                  <Table.Th>Draws</Table.Th>
                  <Table.Th>Losses</Table.Th>
                  <Table.Th>Win %</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {eventStandings.map((row) => {
                  const preview = resolveDeckPreviewForTeam(row.name);
                  return (
                    <Table.Tr key={`${row.rank}-${row.name}`}>
                      <Table.Td>{row.rank}</Table.Td>
                      <Table.Td>
                        {preview != null ? (
                          <HoverCard width={280} shadow="md" position="right">
                            <HoverCard.Target>
                              <Text td="underline" style={{ textDecorationStyle: 'dotted' }}>
                                {row.name}
                              </Text>
                            </HoverCard.Target>
                            <HoverCard.Dropdown>
                              <Stack gap="xs">
                                <Text fw={700}>Submitted Deck</Text>
                                <Group grow>
                                  <Stack gap={4}>
                                    <Text size="xs" c="dimmed">
                                      Leader
                                    </Text>
                                    {preview.leaderImageUrl != null ? (
                                      <Image src={preview.leaderImageUrl} h={110} fit="contain" radius="sm" />
                                    ) : null}
                                    <Text size="sm">{preview.leaderName}</Text>
                                  </Stack>
                                  <Stack gap={4}>
                                    <Text size="xs" c="dimmed">
                                      Base
                                    </Text>
                                    {preview.baseImageUrl != null ? (
                                      <Image src={preview.baseImageUrl} h={110} fit="contain" radius="sm" />
                                    ) : null}
                                    <Text size="sm">{preview.baseName}</Text>
                                  </Stack>
                                </Group>
                              </Stack>
                            </HoverCard.Dropdown>
                          </HoverCard>
                        ) : (
                          row.name
                        )}
                      </Table.Td>
                      <Table.Td>{row.swiss_points}</Table.Td>
                      <Table.Td>{row.wins}</Table.Td>
                      <Table.Td>{row.draws}</Table.Td>
                      <Table.Td>{row.losses}</Table.Td>
                      <Table.Td>{row.win_rate}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Stack>
        </Card>
      ) : null}
      {stages.length > 0 ? (
        <SectionErrorBoundary title="Could not render elimination bracket.">
          <Card withBorder mt="sm">
            <Stack>
              <Group justify="space-between" align="end">
                <Stack gap={2}>
                  <Title order={4}>Elimination Bracket</Title>
                  <Text size="sm" c="dimmed">
                    {selectedStage != null ? selectedStage.name : 'Select a stage'}
                  </Text>
                </Stack>
                {activeBracketStageItem != null &&
                winnerByStageItemId[activeBracketStageItem.id] != null ? (
                  <Badge size="lg" color="yellow" variant="light">
                    Winner: {winnerByStageItemId[activeBracketStageItem.id]}
                  </Badge>
                ) : null}
              </Group>

              {stages.length > 1 ? (
                useStageDropdown ? (
                  <Select
                    label="Stage"
                    data={stageOptions}
                    value={selectedStageId}
                    onChange={(value) => setSelectedStageId(value)}
                    allowDeselect={false}
                  />
                ) : (
                  <Tabs
                    value={selectedStageId}
                    onChange={(value) => setSelectedStageId(value)}
                    variant="outline"
                  >
                    <Tabs.List>
                      {stages.map((stage: any) => (
                        <Tabs.Tab key={stage.id} value={String(stage.id)}>
                          {stage.name}
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                  </Tabs>
                )
              ) : null}

              {eliminationStageItemsInSelectedStage.length > 1 ? (
                <Select
                  label="Bracket Stage Item"
                  data={bracketStageItemOptions}
                  value={selectedBracketStageItemId != null ? String(selectedBracketStageItemId) : null}
                  onChange={(value) =>
                    setSelectedBracketStageItemId(value != null ? Number(value) : null)
                  }
                  allowDeselect={false}
                />
              ) : null}

              {activeBracketStageItem == null ? (
                <Alert icon={<IconAlertCircle size={16} />} color="gray" radius="md">
                  No elimination bracket in this stage yet.
                </Alert>
              ) : !bracketHasColumns ? (
                <Alert icon={<IconAlertCircle size={16} />} color="gray" radius="md">
                  No rounds available for this bracket yet.
                </Alert>
              ) : (
                <BracketTree sections={bracketSections} />
              )}
              {eliminationRecords.length > 0 ? (
                <Table mt="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Seed</Table.Th>
                      <Table.Th>Player</Table.Th>
                      <Table.Th>Record</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {eliminationRecords.map((row) => (
                      <Table.Tr key={row.inputId}>
                        <Table.Td>{row.seed > 0 ? row.seed : '-'}</Table.Td>
                        <Table.Td>{row.name}</Table.Td>
                        <Table.Td>{row.record}</Table.Td>
                        <Table.Td>
                          <Badge color={row.eliminated ? 'red' : 'green'} variant="light">
                            {row.eliminated ? 'Eliminated' : 'Active'}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : null}
            </Stack>
          </Card>
        </SectionErrorBoundary>
      ) : null}
      <Center mt="1rem">
        <SectionErrorBoundary title="Could not render tournament schedule.">
          <Schedule
            t={t}
            matchesLookup={matchesLookup}
            stageItemsLookup={stageItemsLookup}
            openMatchModal={openMatchModal}
            canEditMatch={canEditMatch}
            isSubmittableByUser={(matchToCheck: any) => !isAdmin && userIsInMatch(matchToCheck)}
            winnerByStageItemId={winnerByStageItemId}
            resolveDeckPreviewForTeam={resolveDeckPreviewForTeam}
            buildBaseTrackerHref={buildBaseTrackerHref}
            getKarabastGameName={getKarabastGameName}
            getKarabastLobbyUrl={getKarabastLobbyUrl}
            copyKarabastGameName={copyKarabastGameName}
            copyKarabastDeckForSlot={copyKarabastDeckForSlot}
            editKarabastLobbyUrl={editKarabastLobbyUrl}
            karabastEnabled={karabastEnabled}
          />
        </SectionErrorBoundary>
      </Center>
    </TournamentLayout>
  );
}
