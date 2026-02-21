import { Button, Card, Grid, Group, ScrollArea, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TournamentsCardTable from '@components/card_tables/tournaments';
import TournamentModal from '@components/modals/tournament_modal';
import { DateTime } from '@components/utils/datetime';
import PreloadLink from '@components/utils/link';
import MarkdownContent from '@components/utils/markdown';
import { capitalize } from '@components/utils/util';
import {
  checkForAuthError,
  createAxios,
  getLeagueCommunications,
  getLeagueNextOpponent,
  getStages,
  getTournaments,
  getUser,
} from '@services/adapter';
import Layout from './_layout';

function DashboardBracketTree({ stageItem }: { stageItem: any }) {
  const isCompact = useMediaQuery('(max-width: 64em)');
  const rounds = [...(stageItem?.rounds ?? [])]
    .filter((round: any) => round != null)
    .sort((a: any, b: any) =>
      String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );

  if (rounds.length < 1) {
    return (
      <Text c="dimmed" size="sm">
        Bracket will appear after rounds are generated.
      </Text>
    );
  }

  const visibleRounds = rounds.slice(0, isCompact ? 4 : 8);
  const hiddenRoundsCount = rounds.length - visibleRounds.length;

  const roundCards = visibleRounds.map((round: any) => {
    const roundMatches = Array.isArray(round?.matches) ? round.matches : [];
    const visibleMatches = roundMatches.slice(0, isCompact ? 4 : 10);
    const hiddenMatchesCount = roundMatches.length - visibleMatches.length;
    return (
      <Card key={round?.id ?? round?.name} withBorder miw={isCompact ? undefined : 240}>
        <Text fw={700} mb="sm">
          {round?.name ?? 'Round'}
        </Text>
        <Stack gap="xs">
          {visibleMatches.map((match: any) => {
            const s1 = Number(match?.stage_item_input1_score ?? 0);
            const s2 = Number(match?.stage_item_input2_score ?? 0);
            const t1 = String(match?.stage_item_input1?.team?.name ?? 'TBD');
            const t2 = String(match?.stage_item_input2?.team?.name ?? 'TBD');
            const row1Style = {
              fontWeight: s1 > s2 ? 700 : 500,
              color: s1 > s2 ? '#1f7a2e' : undefined,
            };
            const row2Style = {
              fontWeight: s2 > s1 ? 700 : 500,
              color: s2 > s1 ? '#1f7a2e' : undefined,
            };

            return (
              <Card key={match?.id ?? `${t1}-${t2}`} withBorder p="xs">
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" lineClamp={1} style={row1Style}>
                    {t1}
                  </Text>
                  <Text size="sm" style={row1Style}>
                    {s1}
                  </Text>
                </Group>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" lineClamp={1} style={row2Style}>
                    {t2}
                  </Text>
                  <Text size="sm" style={row2Style}>
                    {s2}
                  </Text>
                </Group>
              </Card>
            );
          })}
          {hiddenMatchesCount > 0 ? (
            <Text size="xs" c="dimmed">
              +{hiddenMatchesCount} more match{hiddenMatchesCount === 1 ? '' : 'es'}
            </Text>
          ) : null}
        </Stack>
      </Card>
    );
  });

  if (isCompact) {
    return (
      <Stack gap="sm">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {roundCards}
        </SimpleGrid>
        {hiddenRoundsCount > 0 ? (
          <Text size="xs" c="dimmed">
            +{hiddenRoundsCount} more round{hiddenRoundsCount === 1 ? '' : 's'} available in Full
            Results
          </Text>
        ) : null}
      </Stack>
    );
  }

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <Group align="flex-start" wrap="nowrap">
        {roundCards}
      </Group>
      {hiddenRoundsCount > 0 ? (
        <Text size="xs" c="dimmed" mt="xs">
          +{hiddenRoundsCount} more round{hiddenRoundsCount === 1 ? '' : 's'} available in Full
          Results
        </Text>
      ) : null}
    </ScrollArea>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'CLOSED'
  >('OPEN');
  const [seasonFilter, setSeasonFilter] = useState<string>('ALL');
  const [seasonFilterLoaded, setSeasonFilterLoaded] = useState(false);
  const [seasonNamesByTournament, setSeasonNamesByTournament] = useState<Record<number, string[]>>({});

  const swrUserResponse = getUser();
  checkForAuthError(swrUserResponse);
  const accountType = String(swrUserResponse.data?.data?.account_type ?? 'REGULAR');
  const isAdmin = accountType === 'ADMIN';

  const swrTournamentsResponse = getTournaments('ALL');
  checkForAuthError(swrTournamentsResponse);
  const allTournaments = swrTournamentsResponse.data?.data ?? [];

  useEffect(() => {
    if (!seasonFilterLoaded) return;
    let canceled = false;
    if (allTournaments.length < 1) {
      setSeasonNamesByTournament({});
      return () => {
        canceled = true;
      };
    }
    const loadSeasons = async () => {
      const entries = await Promise.all(
        allTournaments.map(async (tournament: any) => {
          try {
            const response = await createAxios().get(`tournaments/${tournament.id}/league/seasons`);
            const seasonNames = (response.data?.data ?? [])
              .map((season: any) => String(season?.name ?? '').trim())
              .filter((name: string) => name !== '');
            return [Number(tournament.id), seasonNames] as const;
          } catch {
            return [Number(tournament.id), []] as const;
          }
        })
      );
      if (canceled) return;
      setSeasonNamesByTournament(
        entries.reduce((result: Record<number, string[]>, [tournamentId, names]) => {
          result[tournamentId] = names;
          return result;
        }, {})
      );
    };
    void loadSeasons();
    return () => {
      canceled = true;
    };
  }, [allTournaments, seasonFilterLoaded]);

  const eventLifecycleStatus = (tournament: any) => {
    const status = String(tournament?.status ?? '').toUpperCase();
    if (status === 'OPEN' || status === 'PLANNED' || status === 'IN_PROGRESS' || status === 'CLOSED') {
      return status;
    }
    if (new Date(tournament?.start_time ?? '').getTime() > Date.now()) return 'PLANNED';
    return 'IN_PROGRESS';
  };

  const tournaments = useMemo(
    () =>
      allTournaments.filter((tournament: any) => {
        const statusPasses =
          statusFilter === 'ALL'
            ? true
            : statusFilter === 'OPEN'
              ? String(tournament?.status ?? '').toUpperCase() === 'OPEN'
              : eventLifecycleStatus(tournament) === statusFilter;
        if (!statusPasses) return false;

        if (seasonFilter === 'ALL') return true;
        const seasonNames = seasonNamesByTournament[Number(tournament?.id ?? 0)] ?? [];
        return seasonNames.includes(seasonFilter);
      }),
    [allTournaments, statusFilter, seasonFilter, seasonNamesByTournament]
  );

  const seasonFilterOptions = useMemo(() => {
    if (!seasonFilterLoaded) {
      return [{ label: 'All Seasons', value: 'ALL' }];
    }
    const names = new Set<string>();
    allTournaments.forEach((tournament: any) => {
      (seasonNamesByTournament[Number(tournament?.id ?? 0)] ?? []).forEach((name: string) => {
        if (name.trim() !== '') names.add(name.trim());
      });
    });
    return [
      { label: 'All Seasons', value: 'ALL' },
      ...[...names].sort((left, right) => left.localeCompare(right)).map((name) => ({
        label: name,
        value: name,
      })),
    ];
  }, [allTournaments, seasonNamesByTournament]);

  const upcoming = useMemo(
    () =>
      [...tournaments]
        .filter((item: any) => item.status === 'OPEN')
        .sort(
          (a: any, b: any) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        ),
    [tournaments]
  );
  const nextEvent = upcoming[0] ?? null;
  const currentEvent =
    upcoming.find((item: any) => new Date(item.start_time).getTime() <= Date.now()) ?? nextEvent;
  const nextEventRunning =
    nextEvent != null &&
    nextEvent.status === 'OPEN' &&
    new Date(nextEvent.start_time).getTime() <= Date.now();
  const dashboardTournamentId = Number(currentEvent?.id ?? nextEvent?.id ?? allTournaments[0]?.id ?? 0);
  const swrCommunicationsResponse = getLeagueCommunications(
    Number.isFinite(dashboardTournamentId) && dashboardTournamentId > 0 ? dashboardTournamentId : null
  );
  const pinnedAnnouncement = useMemo(() => {
    const rows = swrCommunicationsResponse.data?.data ?? [];
    return rows.find((row: any) => row.kind === 'ANNOUNCEMENT' && row.pinned) ?? null;
  }, [swrCommunicationsResponse.data]);

  const swrNextOpponentResponse = getLeagueNextOpponent(nextEvent?.id ?? null);
  const nextOpponent = swrNextOpponentResponse.data?.data;
  const swrCurrentEventStagesResponse = getStages(currentEvent?.id ?? null, true);
  const currentEventStages = swrCurrentEventStagesResponse.data?.data ?? [];
  const activeStage =
    currentEventStages.find((stage: any) => stage.is_active) ?? currentEventStages[0] ?? null;
  const bracketStageItem =
    activeStage?.stage_items?.find(
      (stageItem: any) =>
        stageItem.type === 'SINGLE_ELIMINATION' || stageItem.type === 'DOUBLE_ELIMINATION'
    ) ??
    activeStage?.stage_items?.find((stageItem: any) => (stageItem.rounds ?? []).length > 0) ??
    null;

  return (
    <Layout>
      <Stack gap="md">
        <Grid align="end">
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Title>League Dashboard</Title>
            <Text c="dimmed">Upcoming events, submissions, and quick league actions.</Text>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Group grow>
              <Select
                size="md"
                data={[
                  { label: 'All', value: 'ALL' },
                  { label: 'Planned', value: 'PLANNED' },
                  { label: 'Open', value: 'OPEN' },
                  { label: 'In Progress', value: 'IN_PROGRESS' },
                  { label: 'Closed', value: 'CLOSED' },
                ]}
                allowDeselect={false}
                value={statusFilter}
                onChange={(value) => setStatusFilter((value as any) ?? 'OPEN')}
              />
              <Select
                size="md"
                data={seasonFilterOptions}
                allowDeselect={false}
                value={seasonFilter}
                onDropdownOpen={() => setSeasonFilterLoaded(true)}
                onChange={(value) => {
                  if (value != null && value !== 'ALL') {
                    setSeasonFilterLoaded(true);
                  }
                  setSeasonFilter(value ?? 'ALL');
                }}
              />
            </Group>
          </Grid.Col>
        </Grid>

        {pinnedAnnouncement != null ? (
          <Card withBorder>
            <Group justify="space-between" mb="xs">
              <Title order={4}>Pinned Announcement</Title>
              <Button
                size="xs"
                variant="light"
                component={PreloadLink}
                href="/league/communications"
              >
                View All
              </Button>
            </Group>
            <Text fw={700} mb={6}>
              {pinnedAnnouncement.title}
            </Text>
            <MarkdownContent text={pinnedAnnouncement.body} />
          </Card>
        ) : null}

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <Card withBorder>
            <Text size="sm" c="dimmed">Next Event</Text>
            {swrTournamentsResponse.isLoading ? (
              <Text size="sm" c="dimmed">Loading events...</Text>
            ) : null}
            <Title order={4}>{nextEvent?.name ?? 'No open events'}</Title>
            <Text size="sm" mt="xs">
              {nextEvent != null ? <DateTime datetime={nextEvent.start_time} /> : '-'}
            </Text>
            {nextEventRunning && nextOpponent != null ? (
              <Text size="sm" mt="xs">
                Next opponent: {nextOpponent.opponent_team_name ?? 'TBD'}
              </Text>
            ) : null}
            {nextEvent != null ? (
              <Button
                mt="md"
                component={PreloadLink}
                href={`/tournaments/${nextEvent.id}/entries`}
              >
                Open Event
              </Button>
            ) : null}
          </Card>

          <Card withBorder>
            <Text size="sm" c="dimmed">Quick Actions</Text>
            <Stack mt="xs">
              <Button variant="light" component={PreloadLink} href="/league/deckbuilder">
                Deckbuilder
              </Button>
              <Button variant="light" component={PreloadLink} href="/league/sealed-draft">
                Sealed Simulator
              </Button>
              <Button variant="light" component={PreloadLink} href="/league/players">
                Player Directory
              </Button>
            </Stack>
          </Card>

          <Card withBorder>
            <Text size="sm" c="dimmed">Admin</Text>
            {isAdmin ? (
              <Stack mt="xs">
                <Button variant="default" component={PreloadLink} href="/clubs">
                  Manage Clubs
                </Button>
                <TournamentModal swrTournamentsResponse={swrTournamentsResponse} />
                <Text size="sm" c="dimmed">
                  Background image settings are available in the header photo menu and saved per user.
                </Text>
              </Stack>
            ) : (
              <Text mt="xs" size="sm" c="dimmed">
                You can view events and submit decks from each tournament event page. Background settings
                are available from the header photo menu.
              </Text>
            )}
          </Card>
        </SimpleGrid>

        {currentEvent != null && bracketStageItem != null ? (
          <Card withBorder>
            <Stack>
              <Group justify="space-between">
                <div>
                  <Text size="sm" c="dimmed">Current Tournament Bracket</Text>
                  <Title order={4}>{currentEvent.name}</Title>
                </div>
                <Button component={PreloadLink} href={`/tournaments/${currentEvent.id}/results`}>
                  Full Results
                </Button>
              </Group>
              <DashboardBracketTree stageItem={bracketStageItem} />
            </Stack>
          </Card>
        ) : currentEvent != null && swrCurrentEventStagesResponse.isLoading ? (
          <Card withBorder>
            <Text c="dimmed">Loading current bracket...</Text>
          </Card>
        ) : null}

        <Group justify="space-between" mt="sm">
          <Title order={3}>{capitalize(t('tournaments_title'))}</Title>
        </Group>
        <TournamentsCardTable
          tournaments={tournaments}
          isLoading={swrTournamentsResponse.isLoading}
          error={swrTournamentsResponse.error}
        />
      </Stack>
    </Layout>
  );
}
