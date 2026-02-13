import { Button, Grid, Select, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import TournamentsCardTable from '@components/card_tables/tournaments';
import TournamentModal from '@components/modals/tournament_modal';
import PreloadLink from '@components/utils/link';
import { TournamentFilter } from '@components/utils/tournament';
import { capitalize } from '@components/utils/util';
import { checkForAuthError, getTournaments, getUser } from '@services/adapter';
import Layout from './_layout';
import classes from './index.module.css';

export default function HomePage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TournamentFilter>('OPEN');

  const swrUserResponse = getUser();
  checkForAuthError(swrUserResponse);
  const accountType = String(swrUserResponse.data?.data?.account_type ?? 'REGULAR');
  const canCreateTournament = accountType === 'ADMIN';
  const swrTournamentsResponse = getTournaments(filter, canCreateTournament);
  checkForAuthError(swrTournamentsResponse);

  return (
    <Layout>
      <Grid>
        <Grid.Col span="auto">
          <Title>{capitalize(t('tournaments_title'))}</Title>
        </Grid.Col>
        <Grid.Col span="content" className={classes.fullWithMobile}>
          <Select
            size="md"
            placeholder="Pick value"
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
        <Grid.Col span="content" className={classes.fullWithMobile}>
          {canCreateTournament ? (
            <Button variant="default" component={PreloadLink} href="/clubs">
              Manage Clubs
            </Button>
          ) : null}
        </Grid.Col>
        <Grid.Col span="content" className={classes.fullWithMobile}>
          {canCreateTournament ? <TournamentModal swrTournamentsResponse={swrTournamentsResponse} /> : null}
        </Grid.Col>
      </Grid>
      {canCreateTournament ? (
        <TournamentsCardTable swrTournamentsResponse={swrTournamentsResponse} />
      ) : (
        <Text c="dimmed" mt="md">
          Only admins can view tournaments.
        </Text>
      )}
    </Layout>
  );
}
