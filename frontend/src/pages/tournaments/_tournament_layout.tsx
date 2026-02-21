import { Card, Group, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { HiArchiveBoxArrowDown } from 'react-icons/hi2';

import { TournamentLinks, getTournamentHeaderLinks } from '@components/navbar/_main_links';
import { responseIsValid } from '@components/utils/util';
import Layout from '@pages/_layout';
import {
  checkForAuthError,
  getBaseApiUrl,
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
  const userDirectoryResponse = getUserDirectory();
  checkForAuthError(tournamentResponse);
  checkForAuthError(stagesResponse);

  const tournamentLinks = <TournamentLinks tournament_id={tournament_id} />;
  const tournamentHeaderLinks = getTournamentHeaderLinks(tournament_id);
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
