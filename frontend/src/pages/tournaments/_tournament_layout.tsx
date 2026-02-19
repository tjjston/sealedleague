import { Group, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { HiArchiveBoxArrowDown } from 'react-icons/hi2';

import { TournamentLinks, getTournamentHeaderLinks } from '@components/navbar/_main_links';
import { responseIsValid } from '@components/utils/util';
import Layout from '@pages/_layout';
import { checkForAuthError, getTournamentById } from '@services/adapter';

export default function TournamentLayout({ children, tournament_id }: any) {
  const { t } = useTranslation();

  const tournamentResponse = getTournamentById(tournament_id);
  checkForAuthError(tournamentResponse);

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

      <Tooltip label={`${t('archived_header_label')}`}>
        <ThemeIcon
          color="yellow"
          variant="light"
          style={{
            visibility: tournamentResponse.data?.data.status === 'ARCHIVED' ? 'visible' : 'hidden',
          }}
        >
          <HiArchiveBoxArrowDown />
        </ThemeIcon>
      </Tooltip>
    </Group>
  ) : null;

  return (
    <Layout
      additionalNavbarLinks={{ sidebar: tournamentLinks, header: tournamentHeaderLinks }}
      breadcrumbs={breadcrumbs}
    >
      {children}
    </Layout>
  );
}
