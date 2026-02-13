import { Button, Grid, Group, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import PlayerCreateModal from '@components/modals/player_create_modal';
import PlayersTable from '@components/tables/players';
import { getTableState, tableStateToPagination } from '@components/tables/table';
import { capitalize, getTournamentIdFromRouter } from '@components/utils/util';
import TournamentLayout from '@pages/tournaments/_tournament_layout';
import { getPlayersPaginated } from '@services/adapter';
import { importUsersAsPlayers } from '@services/player';

export default function PlayersPage() {
  const tableState = getTableState('name');
  const { tournamentData } = getTournamentIdFromRouter();
  const swrPlayersResponse = getPlayersPaginated(
    tournamentData.id,
    tableStateToPagination(tableState)
  );
  const playerCount = swrPlayersResponse.data != null ? swrPlayersResponse.data.data.count : 1;
  const { t } = useTranslation();
  return (
    <TournamentLayout tournament_id={tournamentData.id}>
      <Grid justify="space-between">
        <Grid.Col span="auto">
          <Title>{capitalize(t('players_title'))}</Title>
        </Grid.Col>
        <Grid.Col span="content">
          <Group>
            <Button
              variant="outline"
              onClick={async () => {
                await importUsersAsPlayers(tournamentData.id);
                await swrPlayersResponse.mutate();
              }}
            >
              Import Users
            </Button>
            <PlayerCreateModal
              swrPlayersResponse={swrPlayersResponse}
              tournament_id={tournamentData.id}
            />
          </Group>
        </Grid.Col>
      </Grid>
      <PlayersTable
        playerCount={playerCount}
        swrPlayersResponse={swrPlayersResponse}
        tournamentData={tournamentData}
        tableState={tableState}
      />
    </TournamentLayout>
  );
}
