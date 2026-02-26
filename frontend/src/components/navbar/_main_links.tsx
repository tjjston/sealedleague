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
  IconLayoutGrid,
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
import classes from './_main_links.module.css';

interface MainLinkProps {
  icon: Icon;
  label: string;
  link: string;
  links?: MainLinkProps[] | null;
}

function isExternalLink(link: string) {
  return /^https?:\/\//i.test(String(link).trim());
}

function MainLinkMobile({ item, pathName }: { item: MainLinkProps; pathName: String }) {
  const external = isExternalLink(item.link);
  return (
    <>
      <UnstyledButton
        hiddenFrom="sm"
        component={external ? 'a' : PreloadLink}
        href={item.link}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
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
  const external = isExternalLink(item.link);
  return (
    <>
      <Tooltip position="right" label={item.label} transitionProps={{ duration: 0 }}>
        <UnstyledButton
          visibleFrom="sm"
          component={external ? 'a' : PreloadLink}
          href={item.link}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer' : undefined}
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
  return [
    { link: '/dashboard', label: 'Dashboard', links: [], icon: IconHome },
    { link: '/league/deckbuilder', label: 'Deckbuilder', links: [], icon: IconBrackets },
    {
      link: '/league/season-standings',
      label: 'League',
      links: [
        { link: '/league/season-standings', label: 'Standings', icon: IconChartBar },
        { link: '/league/communications', label: 'Announcements', icon: IconChecklist },
        { link: '/league/projected_schedule', label: 'Schedule', icon: IconCalendar },
        { link: '/league/season-draft', label: 'Draft', icon: IconChecklist },
        { link: '/league/players', label: 'Players', icon: IconUser },
        { link: '/league/meta-analysis', label: 'Meta', icon: IconAdjustments },
      ],
      icon: IconLayoutGrid,
    },
    {
      link: '/league/sealed-draft',
      label: 'Tools',
      links: [
        { link: '/league/sealed-draft', label: 'Sealed Sim', icon: IconCards },
        { link: '/league/base-health', label: 'Base Health', icon: IconScoreboard },
        { link: 'https://karabast.net/', label: 'Karabast', icon: IconBrackets },
      ],
      icon: IconSettings,
    },
  ];
}

export function getBaseLinks() {
  const location = useLocation();
  const pathName = location.pathname.replace(/\/+$/, '');
  const mobileLinks: MainLinkProps[] = getBaseLinksDict().flatMap((link) => {
    if (link.links == null || link.links.length < 1) {
      return [link];
    }
    return [
      { icon: link.icon, label: link.label, link: link.link, links: [] },
      ...link.links.map((nestedLink) => ({ ...nestedLink, links: [] })),
    ];
  });
  const dedupedLinks = mobileLinks.filter(
    (item, index) => mobileLinks.findIndex((candidate) => candidate.link === item.link) === index
  );
  return dedupedLinks.map((link) => (
    <MainLinkMobile key={link.label + link.link} item={link} pathName={pathName} />
  ));
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

export function getTournamentHeaderLinks(
  tournament_id: number,
  currentEventTournamentId: number | null = null
) {
  const tm_prefix = `/tournaments/${tournament_id}`;
  const links = [
    ...(currentEventTournamentId != null && currentEventTournamentId > 0
      ? [
          {
            link: `/tournaments/${currentEventTournamentId}/results`,
            label: 'Current Event',
            links: [],
            icon: IconBrackets,
          },
        ]
      : []),
    { link: `${tm_prefix}/admin`, label: 'League Admin', links: [], icon: IconAdjustments },
  ];
  return links;
}
