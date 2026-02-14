import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Flex,
  Grid,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { AiOutlineHourglass } from '@react-icons/all-files/ai/AiOutlineHourglass';
import { IconAlertCircle, IconTrophy } from '@tabler/icons-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RoundsGridCols } from '@components/brackets/brackets';
import MatchModal from '@components/modals/match_modal';
import { NoContent } from '@components/no_content/empty_table_info';
import { Time, formatTime } from '@components/utils/datetime';
import { formatMatchInput1, formatMatchInput2 } from '@components/utils/match';
import { Translator } from '@components/utils/types';
import { getTournamentIdFromRouter, responseIsValid } from '@components/utils/util';
import { MatchWithDetails } from '@openapi';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getCourts, getStages, getUser } from '@services/adapter';
import { getMatchLookup, getStageItemLookup, stringToColour } from '@services/lookups';

function ScheduleRow({
  data,
  openMatchModal,
  stageItemsLookup,
  matchesLookup,
  editable,
  winnerByStageItemId,
}: {
  data: any;
  openMatchModal: any;
  stageItemsLookup: any;
  matchesLookup: any;
  editable: boolean;
  winnerByStageItemId: Record<number, string>;
}) {
  const { t } = useTranslation();
  const winColor = '#2a8f37';
  const drawColor = '#656565';
  const loseColor = '#af4034';
  const team1_color =
    data.match.stage_item_input1_score > data.match.stage_item_input2_score
      ? winColor
      : data.match.stage_item_input1_score === data.match.stage_item_input2_score
        ? drawColor
        : loseColor;
  const team2_color =
    data.match.stage_item_input2_score > data.match.stage_item_input1_score
      ? winColor
      : data.match.stage_item_input1_score === data.match.stage_item_input2_score
        ? drawColor
        : loseColor;

  return (
    <UnstyledButton
      style={{ width: '48rem', cursor: editable ? 'pointer' : 'default' }}
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
        mt="md"
        pt="0rem"
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
              <Text fw={500}>
                {formatMatchInput1(t, stageItemsLookup, matchesLookup, data.match)}
              </Text>
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
              <Text fw={500}>
                {formatMatchInput2(t, stageItemsLookup, matchesLookup, data.match)}
              </Text>
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
  );
}

function Schedule({
  t,
  stageItemsLookup,
  openMatchModal,
  matchesLookup,
  canEditMatch,
  winnerByStageItemId,
}: {
  t: Translator;
  stageItemsLookup: any;
  openMatchModal: CallableFunction;
  matchesLookup: any;
  canEditMatch: (match: any) => boolean;
  winnerByStageItemId: Record<number, string>;
}) {
  const matches: any[] = Object.values(matchesLookup);
  const sortedMatches = matches
    .filter((m1: any) => m1.match.start_time != null)
    .sort((m1: any, m2: any) => (m1.match.court?.name > m2.match.court?.name ? 1 : -1))
    .sort((m1: any, m2: any) => (m1.match.start_time > m2.match.start_time ? 1 : -1));

  const rows: React.JSX.Element[] = [];

  for (let c = 0; c < sortedMatches.length; c += 1) {
    const data = sortedMatches[c];

    if (c < 1 || sortedMatches[c - 1].match.start_time) {
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
        winnerByStageItemId={winnerByStageItemId}
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
    matchesLookup.length < 1 ? (
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
  const [selectedBracketStageItemId, setSelectedBracketStageItemId] = useState<number | null>(null);

  const { t } = useTranslation();
  const { tournamentData } = getTournamentIdFromRouter();
  const swrCurrentUserResponse = getUser();
  const swrStagesResponse = getStages(tournamentData.id);
  const swrCourtsResponse = getCourts(tournamentData.id);

  const stageItemsLookup = responseIsValid(swrStagesResponse)
    ? getStageItemLookup(swrStagesResponse)
    : [];
  const matchesLookup = responseIsValid(swrStagesResponse) ? getMatchLookup(swrStagesResponse) : [];
  const stages = swrStagesResponse.data?.data ?? [];
  const eliminationStageItems = useMemo(
    () =>
      stages
        .flatMap((stage: any) => stage.stage_items ?? [])
        .filter(
          (stageItem: any) =>
            stageItem.type === 'SINGLE_ELIMINATION' || stageItem.type === 'DOUBLE_ELIMINATION'
        ),
    [stages]
  );
  const finishedStageItemWinners = useMemo(() => {
    const summaries: Array<{ stage_item_id: number; stage_item_name: string; winner: string }> = [];
    stages.forEach((stage: any) => {
      (stage.stage_items ?? []).forEach((stageItem: any) => {
        const nonDraftMatches = (stageItem.rounds ?? []).flatMap((round: any) =>
          round.is_draft ? [] : (round.matches ?? [])
        );
        if (nonDraftMatches.length < 1) return;
        const finished = nonDraftMatches.every(
          (match: any) =>
            !(match.stage_item_input1_score === 0 && match.stage_item_input2_score === 0)
        );
        if (!finished) return;

        const rankedInputs = [...(stageItem.inputs ?? [])]
          .filter((input: any) => input?.team?.name != null)
          .sort((a: any, b: any) => {
            const pointsDiff = Number(b?.points ?? 0) - Number(a?.points ?? 0);
            if (pointsDiff !== 0) return pointsDiff;
            const winsDiff = Number(b?.wins ?? 0) - Number(a?.wins ?? 0);
            if (winsDiff !== 0) return winsDiff;
            const drawsDiff = Number(b?.draws ?? 0) - Number(a?.draws ?? 0);
            if (drawsDiff !== 0) return drawsDiff;
            return Number(a?.losses ?? 0) - Number(b?.losses ?? 0);
          });
        const winnerName = String(rankedInputs[0]?.team?.name ?? '').trim();
        if (winnerName === '') return;

        summaries.push({
          stage_item_id: stageItem.id,
          stage_item_name: stageItem.name,
          winner: winnerName,
        });
      });
    });
    return summaries;
  }, [stages]);
  const winnerByStageItemId = useMemo(
    () =>
      finishedStageItemWinners.reduce(
        (result: Record<number, string>, item) => {
          result[item.stage_item_id] = item.winner;
          return result;
        },
        {}
      ),
    [finishedStageItemWinners]
  );
  const activeBracketStageItem =
    eliminationStageItems.find((stageItem: any) => stageItem.id === selectedBracketStageItemId) ??
    eliminationStageItems[0] ??
    null;

  if (!responseIsValid(swrStagesResponse)) return null;
  if (!responseIsValid(swrCourtsResponse)) return null;

  const currentUser = swrCurrentUserResponse.data?.data ?? null;
  const currentUserName = String(currentUser?.name ?? '').trim().toLowerCase();
  const isAdmin = String(currentUser?.account_type ?? 'REGULAR') === 'ADMIN';

  function canEditMatch(matchToCheck: any) {
    if (isAdmin) return true;
    const team1Name = String(matchToCheck?.stage_item_input1?.team?.name ?? '')
      .trim()
      .toLowerCase();
    const team2Name = String(matchToCheck?.stage_item_input2?.team?.name ?? '')
      .trim()
      .toLowerCase();
    return (
      currentUserName !== '' &&
      (team1Name === currentUserName || team2Name === currentUserName)
    );
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
      />
      <Title>{t('results_title')}</Title>
      {finishedStageItemWinners.length > 0 ? (
        <Card
          withBorder
          mt="sm"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,245,194,0.35) 0%, rgba(255,255,255,0.85) 55%, rgba(245,247,255,0.95) 100%)',
          }}
        >
          <Stack>
            <Group justify="space-between">
              <Group gap="xs">
                <IconTrophy size={20} />
                <Title order={4}>Event Champions</Title>
              </Group>
            </Group>
            <Group>
              {finishedStageItemWinners.map((item) => (
                <Badge key={item.stage_item_id} size="lg" color="yellow" variant="filled">
                  {item.stage_item_name}: {item.winner}
                </Badge>
              ))}
            </Group>
          </Stack>
        </Card>
      ) : null}
      {activeBracketStageItem != null ? (
        <Card withBorder mt="sm">
          <Stack>
            <Group justify="space-between">
              <Title order={4}>Elimination Bracket</Title>
              <Group>
                {eliminationStageItems.map((stageItem: any) => (
                  <Button
                    key={stageItem.id}
                    size="xs"
                    variant={stageItem.id === activeBracketStageItem.id ? 'filled' : 'outline'}
                    onClick={() => setSelectedBracketStageItemId(stageItem.id)}
                  >
                    {stageItem.name}
                    {winnerByStageItemId[stageItem.id] != null
                      ? ` | Winner: ${winnerByStageItemId[stageItem.id]}`
                      : ''}
                  </Button>
                ))}
              </Group>
            </Group>
            {winnerByStageItemId[activeBracketStageItem.id] != null ? (
              <Badge size="lg" color="yellow" variant="light">
                Winner: {winnerByStageItemId[activeBracketStageItem.id]}
              </Badge>
            ) : null}
            <RoundsGridCols
              tournamentData={tournamentData}
              swrStagesResponse={swrStagesResponse as any}
              readOnly
              stageItem={activeBracketStageItem}
              displaySettings={{
                matchVisibility: 'all',
                setMatchVisibility: () => {},
                teamNamesDisplay: 'team-names',
                setTeamNamesDisplay: () => {},
                showManualSchedulingOptions: 'false',
                setShowManualSchedulingOptions: () => {},
              }}
              swrUpcomingMatchesResponse={null}
            />
          </Stack>
        </Card>
      ) : null}
      <Center mt="1rem">
        <Schedule
          t={t}
          matchesLookup={matchesLookup}
          stageItemsLookup={stageItemsLookup}
          openMatchModal={openMatchModal}
          canEditMatch={canEditMatch}
          winnerByStageItemId={winnerByStageItemId}
        />
      </Center>
    </TournamentLayout>
  );
}
