import { Center, Divider, Group, Tooltip, UnstyledButton } from '@mantine/core';
import {
  Icon,
  IconAdjustments,
  IconBrackets,
  IconCalendar,
  IconCards,
  IconChartBar,
  IconChecklist,
  IconHome,
  IconLogout,
  IconScoreboard,
  IconSettings,
  IconTrophy,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import PreloadLink from '@components/utils/link';
import { capitalize } from '@components/utils/util';
import { getUser } from '@services/adapter';
import classes from './_main_links.module.css';

interface MainLinkProps {
  icon: Icon;
  label: string;
  link: string;
  links?: MainLinkProps[] | null;
}

function MainLinkMobile({ item, pathName }: { item: MainLinkProps; pathName: String }) {
  return (
    <>
      <UnstyledButton
        hiddenFrom="sm"
        component={PreloadLink}
        href={item.link}
        className={classes.mobileLink}
        style={{ width: '100%' }}
        data-active={pathName === item.link || undefined}
      >
        <Group className={classes.mobileLinkGroup}>
          <item.icon stroke={1.5} />
          <p style={{ marginLeft: '0.5rem' }}>{item.label}</p>
        </Group>
        <Divider />
      </UnstyledButton>
    </>
  );
}

function MainLink({ item, pathName }: { item: MainLinkProps; pathName: String }) {
  return (
    <>
      <Tooltip position="right" label={item.label} transitionProps={{ duration: 0 }}>
        <UnstyledButton
          visibleFrom="sm"
          component={PreloadLink}
          href={item.link}
          className={classes.link}
          data-active={pathName.startsWith(item.link) || undefined}
        >
          <item.icon stroke={1.5} />
        </UnstyledButton>
      </Tooltip>
      <MainLinkMobile item={item} pathName={pathName} />
    </>
  );
}

export function getBaseLinksDict() {
  const { t } = useTranslation();
  const swrUserResponse = getUser();
  const user = swrUserResponse.data?.data ?? null;
  const currentLeader =
    (user as any)?.current_leader_name ??
    (user as any)?.current_leader_card_id ??
    'No leader';
  const accountLabel = user != null ? `Account (${user.name} | ${currentLeader})` : 'Account';

  return [
    { link: '/dashboard', label: 'Dashboard', links: [], icon: IconHome },
    { link: '/league/communications', label: 'League Notes', links: [], icon: IconChecklist },
    { link: '/league/projected_schedule', label: 'Projected Schedule', links: [], icon: IconCalendar },
    { link: '/league/deckbuilder', label: 'Deckbuilder', links: [], icon: IconBrackets },
    { link: '/league/sealed-draft', label: 'Sealed Draft', links: [], icon: IconCards },
    { link: '/league/season-draft', label: 'Season Draft', links: [], icon: IconChecklist },
    { link: '/league/season-standings', label: 'Season Standings', links: [], icon: IconChartBar },
    { link: '/league/meta-analysis', label: 'Meta Analysis', links: [], icon: IconAdjustments },
    { link: '/league/players', label: 'Players', links: [], icon: IconUser },
    {
      link: '/user',
      label: accountLabel,
      links: [
        { link: '/user', label: 'Profile', icon: IconUser },
        { link: '/user/settings', label: 'Settings', icon: IconSettings },
        { link: '/logout', label: 'Logout', icon: IconLogout },
      ],
      icon: IconUser,
    },
  ];
}

export function getBaseLinks() {
  const location = useLocation();
  const pathName = location.pathname.replace(/\/+$/, '');
  return getBaseLinksDict()
    .filter((link) => link.links.length < 1)
    .map((link) => <MainLinkMobile key={link.label} item={link} pathName={pathName} />);
}

export function TournamentLinks({ tournament_id }: any) {
  const location = useLocation();
  const { t } = useTranslation();
  const tm_prefix = `/tournaments/${tournament_id}`;
  const pathName = location.pathname.replace('[id]', tournament_id).replace(/\/+$/, '');

  const data = [
    {
      icon: IconTrophy,
      label: capitalize(t('stage_title')),
      link: `${tm_prefix}/stages`,
    },
    {
      icon: IconChecklist,
      label: 'Entries',
      link: `${tm_prefix}/entries`,
    },
    {
      icon: IconUsers,
      label: capitalize(t('teams_title')),
      link: `${tm_prefix}/teams`,
    },
    {
      icon: IconCalendar,
      label: capitalize(t('planning_title')),
      link: `${tm_prefix}/schedule`,
    },
    {
      icon: IconBrackets,
      label: capitalize(t('results_title')),
      link: `${tm_prefix}/results`,
    },
    {
      icon: IconScoreboard,
      label: capitalize(t('rankings_title')),
      link: `${tm_prefix}/rankings`,
    },
    {
      icon: IconSettings,
      label: capitalize(t('tournament_setting_title')),
      link: `${tm_prefix}/settings`,
    },
  ];

  const links = data.map((link) => <MainLink key={link.label} item={link} pathName={pathName} />);
  return (
    <>
      <Center hiddenFrom="sm">
        <h2>{capitalize(t('tournament_title'))}</h2>
      </Center>
      <Divider hiddenFrom="sm" />
      {links}
    </>
  );
}

export function getTournamentHeaderLinks(tournament_id: number) {
  const tm_prefix = `/tournaments/${tournament_id}`;
  return [
    { link: `${tm_prefix}/admin`, label: 'League Admin', links: [], icon: IconAdjustments },
  ];
}
