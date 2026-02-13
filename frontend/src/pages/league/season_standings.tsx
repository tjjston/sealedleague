import { Alert, Button, Group, Select, Stack, Text, Title } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import Layout from '@pages/_layout';
import { getTournaments } from '@services/adapter';

export default function LeagueSeasonStandingsEntryPage() {
  const navigate = useNavigate();
  const swrTournamentsResponse = getTournaments('OPEN');
  const tournaments = swrTournamentsResponse.data?.data ?? [];

  const options = useMemo(
    () => tournaments.map((t: any) => ({ value: String(t.id), label: t.name })),
    [tournaments]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId == null && options.length > 0) {
      setSelectedId(options[0].value);
    }
  }, [options, selectedId]);

  return (
    <Layout>
      <Stack maw={640}>
        <Title>Season Standings</Title>
        <Text c="dimmed">Choose a tournament to open current season standings.</Text>
        {options.length < 1 ? (
          <Alert color="yellow">No accessible tournaments found.</Alert>
        ) : (
          <Group align="end">
            <Select
              label="Tournament"
              data={options}
              value={selectedId}
              onChange={setSelectedId}
              allowDeselect={false}
              style={{ minWidth: 360 }}
            />
            <Button
              onClick={() => {
                if (selectedId == null) return;
                navigate(`/tournaments/${selectedId}/season-standings`);
              }}
            >
              Open
            </Button>
          </Group>
        )}
      </Stack>
    </Layout>
  );
}
