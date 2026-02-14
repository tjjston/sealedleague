import { Button, Card, Grid, Group, ScrollArea, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import TournamentsCardTable from '@components/card_tables/tournaments';
import TournamentModal from '@components/modals/tournament_modal';
import { DateTime } from '@components/utils/datetime';
import PreloadLink from '@components/utils/link';
import { TournamentFilter } from '@components/utils/tournament';
import { capitalize } from '@components/utils/util';
import {
  checkForAuthError,
  getLeagueNextOpponent,
  getStages,
  getTournaments,
  getUser,
} from '@services/adapter';
import Layout from './_layout';

function DashboardBracketTree({ stageItem }: { stageItem: any }) {
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

  return (
    <ScrollArea type="auto" offsetScrollbars>
      <Group align="flex-start" wrap="nowrap">
        {rounds.map((round: any) => (
          <Card key={round?.id ?? round?.name} withBorder miw={280}>
            <Text fw={700} mb="sm">
              {round?.name ?? 'Round'}
            </Text>
            <Stack gap="xs">
              {(round?.matches ?? []).map((match: any) => {
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
                      <Text lineClamp={1} style={row1Style}>
                        {t1}
                      </Text>
                      <Text style={row1Style}>{s1}</Text>
                    </Group>
                    <Group justify="space-between" wrap="nowrap">
                      <Text lineClamp={1} style={row2Style}>
                        {t2}
                      </Text>
                      <Text style={row2Style}>{s2}</Text>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </Card>
        ))}
      </Group>
    </ScrollArea>
  );
}

export default function HomePage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TournamentFilter>('OPEN');

  const swrUserResponse = getUser();
  checkForAuthError(swrUserResponse);
  const accountType = String(swrUserResponse.data?.data?.account_type ?? 'REGULAR');
  const isAdmin = accountType === 'ADMIN';

  const swrTournamentsResponse = getTournaments(filter);
  checkForAuthError(swrTournamentsResponse);
  const tournaments = swrTournamentsResponse.data?.data ?? [];

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
            <Select
              size="md"
              data={[
                { label: 'All', value: 'ALL' },
                { label: 'Archived', value: 'ARCHIVED' },
                { label: 'Open', value: 'OPEN' },
              ]}
              allowDeselect={false}
              value={filter}
              // @ts-ignore
              onChange={(f: TournamentFilter) => setFilter(f)}
            />
          </Grid.Col>
        </Grid>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <Card withBorder>
            <Text size="sm" c="dimmed">Next Event</Text>
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
              </Stack>
            ) : (
              <Text mt="xs" size="sm" c="dimmed">
                You can view events and submit decks from each tournament event page.
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
        ) : null}

        <Group justify="space-between" mt="sm">
          <Title order={3}>{capitalize(t('tournaments_title'))}</Title>
        </Group>
        <TournamentsCardTable swrTournamentsResponse={swrTournamentsResponse} />
      </Stack>
    </Layout>
  );
}
