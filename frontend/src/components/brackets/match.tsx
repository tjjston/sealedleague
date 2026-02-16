import { Center, Grid, UnstyledButton, useMantineTheme } from '@mantine/core';
import { useColorScheme } from '@mantine/hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SWRResponse } from 'swr';

import MatchModal from '@components/modals/match_modal';
import { assert_not_none } from '@components/utils/assert';
import { Time } from '@components/utils/datetime';
import { formatMatchInput1, formatMatchInput2, isMatchHappening } from '@components/utils/match';
import { formatStageItemInputWithRecord } from '@components/utils/stage_item_input';
import { TournamentMinimal } from '@components/utils/tournament';
import { MatchWithDetails, RoundWithMatches, StagesWithStageItemsResponse } from '@openapi';
import { getUser } from '@services/adapter';
import { getMatchLookup, getStageItemLookup } from '@services/lookups';
import classes from './match.module.css';

export function MatchBadge({ match, theme }: { match: MatchWithDetails; theme: any }) {
  const visibility = match.court ? 'visible' : 'hidden';
  const badgeColor = useColorScheme() ? theme.colors.blue[7] : theme.colors.blue[7];
  return (
    <Center style={{ transform: 'translateY(0%)', visibility }}>
      <div
        style={{
          width: '75%',
          backgroundColor: isMatchHappening(match) ? theme.colors.grape[9] : badgeColor,
          borderRadius: '8px 8px 0px 0px',
          padding: '4px 12px 4px 12px',
        }}
      >
        <Center>
          <b>
            {match.court?.name} |{' '}
            {match.start_time != null ? <Time datetime={match.start_time} /> : null}
          </b>
        </Center>
      </div>
    </Center>
  );
}

export default function Match({
  swrStagesResponse,
  swrUpcomingMatchesResponse,
  tournamentData,
  match,
  readOnly,
  round,
}: {
  swrStagesResponse: SWRResponse<StagesWithStageItemsResponse>;
  swrUpcomingMatchesResponse: SWRResponse | null;
  tournamentData: TournamentMinimal;
  match: MatchWithDetails;
  readOnly: boolean;

  round: RoundWithMatches;
}) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const swrCurrentUserResponse = getUser();
  const winner_style = {
    backgroundColor: theme.colors.green[9],
  };

  const stageItemsLookup = getStageItemLookup(swrStagesResponse);
  const matchesLookup = getMatchLookup(swrStagesResponse);

  const team1_style =
    match.stage_item_input1_score > match.stage_item_input2_score ? winner_style : {};
  const team2_style =
    match.stage_item_input1_score < match.stage_item_input2_score ? winner_style : {};

  const team1_label = formatMatchInput1(t, stageItemsLookup, matchesLookup, match);
  const team2_label = formatMatchInput2(t, stageItemsLookup, matchesLookup, match);
  const team1_label_with_record =
    formatStageItemInputWithRecord(match.stage_item_input1, stageItemsLookup) || team1_label;
  const team2_label_with_record =
    formatStageItemInputWithRecord(match.stage_item_input2, stageItemsLookup) || team2_label;
  const team1_logo = (match.stage_item_input1 as any)?.team?.logo_path;
  const team2_logo = (match.stage_item_input2 as any)?.team?.logo_path;

  const [opened, setOpened] = useState(false);
  const currentUser = swrCurrentUserResponse.data?.data ?? null;
  const currentUserName = String(currentUser?.name ?? '').trim().toLowerCase();
  const isAdmin = String(currentUser?.account_type ?? 'REGULAR') === 'ADMIN';
  const userCanSubmitScore =
    !readOnly &&
    currentUserName !== '' &&
    !isAdmin &&
    [match.stage_item_input1, match.stage_item_input2].some((stageItemInput: any) => {
      const teamName = String(stageItemInput?.team?.name ?? '').trim().toLowerCase();
      if (teamName === currentUserName) return true;
      const players = Array.isArray(stageItemInput?.team?.players) ? stageItemInput.team.players : [];
      return players.some(
        (player: any) => String(player?.name ?? '').trim().toLowerCase() === currentUserName
      );
    });

  const bracket = (
    <>
      <MatchBadge match={match} theme={theme} />
      <div className={classes.top} style={team1_style}>
        <Grid grow>
          <Grid.Col span={10}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {team1_logo && (
                <img
                  src={team1_logo}
                  alt="leader"
                  style={{ width: 20, height: 20, borderRadius: 999, objectFit: 'cover' }}
                />
              )}
              <span>{team1_label_with_record}</span>
            </div>
          </Grid.Col>
          <Grid.Col span={2}>{match.stage_item_input1_score}</Grid.Col>
        </Grid>
      </div>
      <div className={classes.divider} />
      <div className={classes.bottom} style={team2_style}>
        <Grid grow>
          <Grid.Col span={10}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {team2_logo && (
                <img
                  src={team2_logo}
                  alt="leader"
                  style={{ width: 20, height: 20, borderRadius: 999, objectFit: 'cover' }}
                />
              )}
              <span>{team2_label_with_record}</span>
            </div>
          </Grid.Col>
          <Grid.Col span={2}>{match.stage_item_input2_score}</Grid.Col>
        </Grid>
      </div>
    </>
  );

  if (readOnly) {
    return <div className={classes.root}>{bracket}</div>;
  }

  return (
    <>
      <UnstyledButton
        className={classes.root}
        onClick={() => setOpened(!opened)}
        style={
          userCanSubmitScore
            ? {
                borderRadius: 10,
                backgroundColor: 'rgba(80, 160, 255, 0.18)',
                boxShadow: '0 0 0 1px rgba(80, 160, 255, 0.5)',
              }
            : undefined
        }
      >
        {bracket}
      </UnstyledButton>
      <MatchModal
        swrStagesResponse={assert_not_none(swrStagesResponse)}
        swrUpcomingMatchesResponse={swrUpcomingMatchesResponse}
        tournamentData={tournamentData}
        match={match}
        opened={opened}
        setOpened={setOpened}
        round={round}
      />
    </>
  );
}
