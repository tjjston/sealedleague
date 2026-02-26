import { Card, Group, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { HiArchiveBoxArrowDown } from 'react-icons/hi2';
import { useMemo } from 'react';

import { TournamentLinks, getTournamentHeaderLinks } from '@components/navbar/_main_links';
import { responseIsValid } from '@components/utils/util';
import Layout from '@pages/_layout';
import {
  checkForAuthError,
  getBaseApiUrl,
  getLeagueProjectedSchedule,
  getStages,
  getTournamentById,
  getUserDirectory,
} from '@services/adapter';

function getWinnerNameForCompletedStageItem(stageItem: any): string | null {
  const nonDraftMatches = (stageItem?.rounds ?? []).flatMap((round: any) =>
    round?.is_draft ? [] : (round?.matches ?? [])
  );
  if (nonDraftMatches.length < 1) return null;
  const hasPendingMatch = nonDraftMatches.some(
    (match: any) =>
      match == null ||
      Number(match?.stage_item_input1_score ?? 0) === Number(match?.stage_item_input2_score ?? 0)
  );
  if (hasPendingMatch) return null;

  const dependentMatchIds = new Set<number>();
  nonDraftMatches.forEach((match: any) => {
    [
      match?.stage_item_input1_winner_from_match_id,
      match?.stage_item_input2_winner_from_match_id,
      match?.stage_item_input1_loser_from_match_id,
      match?.stage_item_input2_loser_from_match_id,
    ].forEach((dependencyId) => {
      const parsedDependencyId = Number(dependencyId ?? 0);
      if (Number.isFinite(parsedDependencyId) && parsedDependencyId > 0) {
        dependentMatchIds.add(parsedDependencyId);
      }
    });
  });

  const terminalMatches = nonDraftMatches.filter((match: any) => !dependentMatchIds.has(Number(match?.id ?? 0)));
  const finalMatch = terminalMatches[terminalMatches.length - 1] ?? null;
  if (finalMatch == null) return null;
  const score1 = Number(finalMatch?.stage_item_input1_score ?? 0);
  const score2 = Number(finalMatch?.stage_item_input2_score ?? 0);
  if (score1 === score2) return null;
  const winnerInput = score1 > score2 ? finalMatch?.stage_item_input1 : finalMatch?.stage_item_input2;
  return String(winnerInput?.team?.name ?? '').trim() || null;
}

export default function TournamentLayout({ children, tournament_id }: any) {
  const tournamentResponse = getTournamentById(tournament_id);
  const stagesResponse = getStages(tournament_id, true, false);
  const projectedScheduleResponse = getLeagueProjectedSchedule(tournament_id);
  const userDirectoryResponse = getUserDirectory();
  checkForAuthError(tournamentResponse);
  checkForAuthError(stagesResponse);

  const tournamentLinks = <TournamentLinks tournament_id={tournament_id} />;
  const currentEventTournamentId = useMemo(() => {
    const rows = projectedScheduleResponse.data?.data ?? [];
    const linkedRows = (rows as any[])
      .map((row: any) => {
        const linkedTournamentId = Number(row?.linked_tournament_id ?? 0);
        if (!Number.isInteger(linkedTournamentId) || linkedTournamentId <= 0) return null;
        const startsAtRaw = String(row?.starts_at ?? '').trim();
        const startsAtMs = startsAtRaw === '' ? Number.NaN : new Date(startsAtRaw).getTime();
        return {
          linkedTournamentId,
          linkedTournamentStatus: String(row?.linked_tournament_status ?? '').trim().toUpperCase(),
          startsAtMs,
          id: Number(row?.id ?? 0),
        };
      })
      .filter((row: any) => row != null);
    if (linkedRows.length < 1) return null;

    const byRecentStartOrId = (left: any, right: any) => {
      const leftStart = Number.isFinite(left.startsAtMs) ? left.startsAtMs : Number.NEGATIVE_INFINITY;
      const rightStart = Number.isFinite(right.startsAtMs) ? right.startsAtMs : Number.NEGATIVE_INFINITY;
      if (leftStart !== rightStart) return rightStart - leftStart;
      return Number(right.id ?? 0) - Number(left.id ?? 0);
    };
    const nowMs = Date.now();
    const inProgress = linkedRows
      .filter((row: any) => row.linkedTournamentStatus === 'IN_PROGRESS')
      .sort(byRecentStartOrId);
    const started = linkedRows
      .filter((row: any) => Number.isFinite(row.startsAtMs) && row.startsAtMs <= nowMs)
      .sort(byRecentStartOrId);
    const open = linkedRows
      .filter((row: any) => row.linkedTournamentStatus === 'OPEN')
      .sort(byRecentStartOrId);

    const preferred = inProgress[0] ?? started[0] ?? open[0] ?? null;
    const resolvedTournamentId = Number(preferred?.linkedTournamentId ?? 0);
    if (!Number.isInteger(resolvedTournamentId) || resolvedTournamentId <= 0) return null;
    if (resolvedTournamentId === Number(tournament_id)) return null;
    return resolvedTournamentId;
  }, [projectedScheduleResponse.data?.data, tournament_id]);
  const tournamentHeaderLinks = getTournamentHeaderLinks(tournament_id, currentEventTournamentId);
  const breadcrumbs = responseIsValid(tournamentResponse) ? (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
      <Title order={3} maw="20rem" style={{ whiteSpace: 'nowrap' }}>
        /
      </Title>
      <Title order={3} maw="20rem" lineClamp={1}>
        {tournamentResponse.data?.data.name}
      </Title>

      <Tooltip label="Closed tournament">
        <ThemeIcon
          color="yellow"
          variant="light"
          style={{
            visibility: tournamentResponse.data?.data.status === 'CLOSED' ? 'visible' : 'hidden',
          }}
        >
          <HiArchiveBoxArrowDown />
        </ThemeIcon>
      </Tooltip>
    </Group>
  ) : null;

  let championName: string | null = null;
  let championStageId = -1;
  let championStageItemId = -1;
  const stages = responseIsValid(stagesResponse) ? stagesResponse.data?.data ?? [] : [];
  stages.forEach((stage: any) => {
    const stageId = Number(stage?.id ?? 0);
    (stage?.stage_items ?? []).forEach((stageItem: any) => {
      const winnerName = getWinnerNameForCompletedStageItem(stageItem);
      const stageItemId = Number(stageItem?.id ?? 0);
      if (
        winnerName != null &&
        (stageId > championStageId ||
          (stageId === championStageId && stageItemId > championStageItemId))
      ) {
        championName = winnerName;
        championStageId = stageId;
        championStageItemId = stageItemId;
      }
    });
  });
  const avatarByUserName = (userDirectoryResponse.data?.data ?? []).reduce(
    (result: Record<string, string>, row: any) => {
      const key = String(row?.user_name ?? '').trim().toLowerCase();
      const avatarUrl = String(row?.avatar_url ?? '').trim();
      if (key === '' || avatarUrl === '' || result[key] != null) return result;
      result[key] = avatarUrl.startsWith('http') ? avatarUrl : `${getBaseApiUrl()}/${avatarUrl}`;
      return result;
    },
    {}
  );
  const championAvatarUrl =
    championName != null ? avatarByUserName[String(championName).trim().toLowerCase()] ?? null : null;

  return (
    <Layout
      additionalNavbarLinks={{ sidebar: tournamentLinks, header: tournamentHeaderLinks }}
      breadcrumbs={breadcrumbs}
    >
      {championName != null ? (
        <Card
          withBorder
          mb="sm"
          style={{
            background:
              championAvatarUrl != null
                ? `linear-gradient(135deg, rgba(12, 16, 28, 0.86) 0%, rgba(12, 16, 28, 0.66) 60%, rgba(12, 16, 28, 0.76) 100%), url(${championAvatarUrl})`
                : 'linear-gradient(135deg, rgba(255,245,194,0.35) 0%, rgba(255,255,255,0.9) 55%, rgba(245,247,255,0.95) 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          <Stack gap={2}>
            <Text fw={700} c={championAvatarUrl != null ? 'white' : undefined}>
              Tournament Champion
            </Text>
            <Title order={2} c={championAvatarUrl != null ? 'white' : undefined}>
              {championName}
            </Title>
          </Stack>
        </Card>
      ) : null}
      {children}
    </Layout>
  );
}
