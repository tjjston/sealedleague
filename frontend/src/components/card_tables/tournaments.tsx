import { Badge, Button, Card, Group, Image, Text, UnstyledButton } from '@mantine/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyTableInfo } from '@components/no_content/empty_table_info';
import { DateTime } from '@components/utils/datetime';
import RequestErrorAlert from '@components/utils/error_alert';
import PreloadLink from '@components/utils/link';
import { TableSkeletonSingleColumn } from '@components/utils/skeletons';
import { Tournament } from '@openapi';
import { getBaseApiUrl } from '@services/adapter';
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
  const lifecycleStatus = useMemo(() => {
    if (tournament.status === 'OPEN' || tournament.status === 'PLANNED' || tournament.status === 'IN_PROGRESS' || tournament.status === 'CLOSED') {
      return tournament.status;
    }
    if (new Date(tournament.start_time).getTime() > Date.now()) return 'PLANNED';
    return 'IN_PROGRESS';
  }, [tournament.start_time, tournament.status]);
  const lifecycleStatusLabel =
    lifecycleStatus === 'IN_PROGRESS'
      ? 'In Progress'
      : lifecycleStatus === 'PLANNED'
        ? 'Planned'
        : lifecycleStatus === 'CLOSED'
          ? 'Closed'
          : lifecycleStatus;
  const winnerName = String((tournament as any)?.winner_name ?? '').trim();

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
            <Stat title="Status" value={lifecycleStatusLabel} />
          </Card.Section>

          <Card.Section className={classes.section}>
            <Stat title={t('start_time')} value={<DateTime datetime={tournament.start_time} />} />
          </Card.Section>

          {winnerName !== '' ? (
            <Card.Section className={classes.section}>
              <Stat title="Winner" value={winnerName} />
            </Card.Section>
          ) : null}

          <Card.Section className={classes.section}>
            <Group w="100%">
              <Badge
                fullWidth
                color="yellow"
                variant="outline"
                size="lg"
                style={{ visibility: tournament.status === 'CLOSED' ? 'visible' : 'hidden' }}
              >
                Closed
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
  tournaments,
  isLoading,
  error,
}: {
  tournaments: Tournament[];
  isLoading: boolean;
  error: any;
}) {
  const { t } = useTranslation();

  if (error) {
    return <RequestErrorAlert error={error} />;
  }
  if (isLoading) {
    return <TableSkeletonSingleColumn />;
  }

  const rows = [...tournaments]
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
