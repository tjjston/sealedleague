import { Badge, Button, Card, Group, Image, Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { SWRResponse } from 'swr';

import { EmptyTableInfo } from '@components/no_content/empty_table_info';
import { DateTime } from '@components/utils/datetime';
import RequestErrorAlert from '@components/utils/error_alert';
import PreloadLink from '@components/utils/link';
import { TableSkeletonSingleColumn } from '@components/utils/skeletons';
import { Tournament, TournamentsResponse } from '@openapi';
import { getBaseApiUrl, getLeagueNextOpponent } from '@services/adapter';
import classes from './tournaments.module.css';

export function TournamentLogo({ tournament }: { tournament: Tournament }) {
  return (
    <Image
      radius="md"
      alt="Logo of the tournament"
      src={`${getBaseApiUrl()}/static/tournament-logos/${tournament.logo_path}`}
      fallbackSrc={`https://placehold.co/318x160?text=${tournament.name}`}
      height={160}
    />
  );
}

function Stat({ title, value }: { title: string; value: any }) {
  return (
    <div key={title}>
      <Text size="xs" c="dimmed">
        {title}
      </Text>
      <Text fw={500} size="sm">
        {value}
      </Text>
    </div>
  );
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const { t } = useTranslation();
  const swrNextOpponentResponse = getLeagueNextOpponent(tournament.id);
  const nextOpponent = swrNextOpponentResponse.data?.data;
  const tournamentRunning =
    tournament.status === 'OPEN' && new Date(tournament.start_time).getTime() <= Date.now();

  return (
    <Group key={tournament.id} className={classes.card}>
      <UnstyledButton component={PreloadLink} href={`/tournaments/${tournament.id}/entries`} w="100%">
        <Card shadow="sm" padding="lg" radius="md" withBorder w="100%">
          <Card.Section>
            <TournamentLogo tournament={tournament} />
          </Card.Section>

          <Group justify="space-between" mt="md" mb="xs">
            <Text fw={500} lineClamp={1}>
              {tournament.name}
            </Text>
          </Group>

          <Card.Section className={classes.section}>
            <Stat title="Club" value={(tournament as any).club_name ?? '-'} />
          </Card.Section>

          <Card.Section className={classes.section}>
            <Stat title={t('start_time')} value={<DateTime datetime={tournament.start_time} />} />
          </Card.Section>

          {tournamentRunning ? (
            <Card.Section className={classes.section}>
              <Stat
                title="Your Next Opponent"
                value={
                  nextOpponent != null ? (
                    <>
                      {nextOpponent.opponent_team_name ?? 'TBD'}
                      {nextOpponent.start_time != null ? (
                        <>
                          {' at '}
                          <DateTime datetime={nextOpponent.start_time} />
                        </>
                      ) : null}
                    </>
                  ) : (
                    'No pending match'
                  )
                }
              />
            </Card.Section>
          ) : null}

          <Card.Section className={classes.section}>
            <Group w="100%">
              <Badge
                fullWidth
                color="yellow"
                variant="outline"
                size="lg"
                style={{ visibility: tournament.status === 'ARCHIVED' ? 'visible' : 'hidden' }}
              >
                {t('archived_label')}
              </Badge>
              <Button
                component={PreloadLink}
                color="blue"
                fullWidth
                radius="md"
                href={`/tournaments/${tournament.id}/entries`}
              >
                VIEW EVENT
              </Button>
            </Group>
          </Card.Section>
        </Card>
      </UnstyledButton>
    </Group>
  );
}

export default function TournamentsCardTable({
  swrTournamentsResponse,
}: {
  swrTournamentsResponse: SWRResponse<TournamentsResponse>;
}) {
  const { t } = useTranslation();

  if (swrTournamentsResponse.error) {
    return <RequestErrorAlert error={swrTournamentsResponse.error} />;
  }
  if (swrTournamentsResponse.isLoading) {
    return <TableSkeletonSingleColumn />;
  }

  const tournaments: Tournament[] =
    swrTournamentsResponse.data != null ? swrTournamentsResponse.data.data : [];

  const rows = tournaments
    .sort(
      (t1: Tournament, t2: Tournament) =>
        new Date(t1.start_time).getTime() - new Date(t2.start_time).getTime()
    )
    .map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />);

  if (rows.length < 1) return <EmptyTableInfo entity_name={t('tournaments_title')} />;

  return (
    <Group gap="sm" style={{ width: '100%' }}>
      {rows}
    </Group>
  );
}
