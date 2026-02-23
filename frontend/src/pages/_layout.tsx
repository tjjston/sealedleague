import {
  ActionIcon,
  AppShell,
  Burger,
  Center,
  Container,
  Group,
  Menu,
  Select,
  Slider,
  Switch,
  Tooltip,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { Icon, IconMoonStars, IconPhoto, IconSun, IconUser } from '@tabler/icons-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';

import { Brand } from '@components/navbar/_brand';
import { getBaseLinks, getBaseLinksDict } from '@components/navbar/_main_links';
import PreloadLink from '@components/utils/link';
import { getUser, getUserCardCatalog } from '@services/adapter';
import classes from './_layout.module.css';

interface HeaderActionLink {
  link: string | null;
  label: string;
  icon: Icon;
  links: { link: string; label: string; icon: Icon }[];
}

interface HeaderActionProps {
  links: HeaderActionLink[];
  navbarState: any;
  breadcrumbs: ReactNode;
  backgroundEnabled: boolean;
  setBackgroundEnabled: (value: boolean) => void;
  backgroundOpacity: number;
  setBackgroundOpacity: (value: number) => void;
  backgroundMode: 'ROTATE' | 'FIXED';
  setBackgroundMode: (value: 'ROTATE' | 'FIXED') => void;
  fixedBackgroundImage: string | null;
  setFixedBackgroundImage: (value: string | null) => void;
}

const ASPECT_ICON_BY_KEY: Record<string, string> = {
  aggression: '/icons/aspects/aggression.png',
  command: '/icons/aspects/command.png',
  cunning: '/icons/aspects/cunning.png',
  vigilance: '/icons/aspects/vigilance.png',
  villainy: '/icons/aspects/villainy.png',
  heroic: '/icons/aspects/heroism.png',
  heroism: '/icons/aspects/heroism.png',
};

const BACKGROUND_IMAGES = [
  '/backgrounds/atat.jpg',
  '/backgrounds/deathstar.jpg',
  '/backgrounds/degobah.jpg',
  '/backgrounds/kylo.jpg',
  '/backgrounds/lightspeed.jpg',
  '/backgrounds/r2.jpg',
  '/backgrounds/star-wars-galaxy-of-heroes-cover-j1fucmpgrjmxh2za-2840910272.jpg',
  '/backgrounds/star-wars-imperial-march-4k-ss-4124253200.jpg',
  '/backgrounds/stormtrooper.jpg',
  '/backgrounds/vader.jpg',
  '/backgrounds/yoda.jpg',
];

function isExternalLink(link: string | null | undefined) {
  return /^https?:\/\//i.test(String(link ?? '').trim());
}

function normalizeAspectKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function formatCardIdForDisplay(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (normalized === '') return '';
  const match = normalized.match(/^([a-z]+)-0*(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  return `${match[1]}-${Number(match[2])}${String(match[3] ?? '').toLowerCase()}`;
}

function normalizeCardIdLookupKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function removeNumericPaddingFromCardId(value: string | null | undefined) {
  const normalized = normalizeCardIdLookupKey(value);
  const match = normalized.match(/^([a-z]+)-(\d+)([a-z]*)$/i);
  if (match == null) return normalized;
  const [, setCode, number, suffix] = match;
  const trimmedNumber = String(Number(number));
  return `${setCode}-${trimmedNumber}${suffix}`;
}

function buildCardLookupKeys(value: string | null | undefined) {
  const raw = String(value ?? '').trim().toLowerCase();
  const normalized = normalizeCardIdLookupKey(value);
  const noPadding = removeNumericPaddingFromCardId(value);
  return [raw, normalized, noPadding].filter((item, index, all) => item !== '' && all.indexOf(item) === index);
}

function looksLikeCardId(value: string | null | undefined) {
  return /^[a-z]{2,5}-\d+[a-z]*$/i.test(normalizeCardIdLookupKey(value));
}

function getMenuItemsForLink(link: HeaderActionLink, _classes: any, pathName: string) {
  const isActive =
    pathName === link.link ||
    (Array.isArray(link.links) && link.links.some((item) => item.link === pathName));
  const menuItems = (link.links ?? []).map((item) => (
    <a
      key={item.label}
      className={classes.link}
      href={item.link}
      target={isExternalLink(item.link) ? '_blank' : undefined}
      rel={isExternalLink(item.link) ? 'noreferrer' : undefined}
    >
      <Center>
        <item.icon />
        <span style={{ marginLeft: '0.25rem', marginTop: '0.2rem' }}>{item.label}</span>
      </Center>
    </a>
  ));
  return (
    <Menu key={link.label} trigger="hover" transitionProps={{ exitDuration: 0 }} withinPortal>
      <Menu.Target>
        <PreloadLink
          className={classes.link}
          href={link.link || ''}
          data-active={isActive || undefined}
        >
          <>{link.label}</>
        </PreloadLink>
      </Menu.Target>
      {menuItems.length > 0 ? <Menu.Dropdown>{menuItems}</Menu.Dropdown> : null}
    </Menu>
  );
}

function ProfileMenu({ pathName }: { pathName: string }) {
  return (
    <Menu trigger="hover" transitionProps={{ exitDuration: 0 }} withinPortal>
      <Menu.Target>
        <Tooltip label="Profile" transitionProps={{ duration: 0 }}>
          <ActionIcon
            component={PreloadLink}
            href="/user"
            variant={pathName.startsWith('/user') ? 'filled' : 'default'}
            size={30}
          >
            <IconUser size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component={PreloadLink} href="/user">
          Profile
        </Menu.Item>
        <Menu.Item component={PreloadLink} href="/logout">
          Logout
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function BackgroundMenu({
  backgroundEnabled,
  setBackgroundEnabled,
  backgroundOpacity,
  setBackgroundOpacity,
  backgroundMode,
  setBackgroundMode,
  fixedBackgroundImage,
  setFixedBackgroundImage,
}: {
  backgroundEnabled: boolean;
  setBackgroundEnabled: (value: boolean) => void;
  backgroundOpacity: number;
  setBackgroundOpacity: (value: number) => void;
  backgroundMode: 'ROTATE' | 'FIXED';
  setBackgroundMode: (value: 'ROTATE' | 'FIXED') => void;
  fixedBackgroundImage: string | null;
  setFixedBackgroundImage: (value: string | null) => void;
}) {
  return (
    <Menu shadow="md" width={320} withinPortal>
      <Menu.Target>
        <Tooltip label="Background" transitionProps={{ duration: 0 }}>
          <ActionIcon variant="default" size={30}>
            <IconPhoto size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <div style={{ padding: '0.5rem 0.75rem' }}>
          <Switch
            label="Show background image"
            checked={backgroundEnabled}
            onChange={(event) => setBackgroundEnabled(event.currentTarget.checked)}
          />
          <Text size="xs" mt="sm" mb={4}>
            Background transparency
          </Text>
          <Slider
            min={0}
            max={100}
            step={1}
            value={backgroundOpacity}
            onChange={setBackgroundOpacity}
            disabled={!backgroundEnabled}
            label={(value) => `${value}%`}
          />
          <Select
            mt="sm"
            label="Image mode"
            allowDeselect={false}
            value={backgroundMode}
            comboboxProps={{ withinPortal: false }}
            data={[
              { value: 'ROTATE', label: 'Rotate hourly' },
              { value: 'FIXED', label: 'Fixed image' },
            ]}
            onChange={(value) =>
              setBackgroundMode(value === 'FIXED' ? 'FIXED' : 'ROTATE')
            }
          />
          {backgroundMode === 'FIXED' ? (
            <Select
              mt="xs"
              searchable
              label="Image"
              value={fixedBackgroundImage}
              comboboxProps={{ withinPortal: false }}
              data={BACKGROUND_IMAGES.map((path) => ({
                value: path,
                label: path.replace('/backgrounds/', ''),
              }))}
              onChange={(value) => {
                setFixedBackgroundImage(value);
                if (value != null && value.trim() !== '') {
                  setBackgroundMode('FIXED');
                  setBackgroundEnabled(true);
                }
              }}
            />
          ) : null}
        </div>
      </Menu.Dropdown>
    </Menu>
  );
}

function HeaderUserSummary() {
  const swrUserResponse = getUser();
  const user = swrUserResponse.data?.data as any;
  const leaderCardId = String(user?.current_leader_card_id ?? '').trim();
  const leaderNameRaw = String(user?.current_leader_name ?? '').trim();
  const leaderLookupId = leaderCardId !== '' ? leaderCardId : leaderNameRaw;
  const swrLeaderCardCatalogResponse = getUserCardCatalog(leaderLookupId, 120);
  const leaderCards = swrLeaderCardCatalogResponse.data?.data ?? [];
  const leaderCardByLookupKey = useMemo(() => {
    return (leaderCards as any[]).reduce((result: Record<string, any>, card: any) => {
      buildCardLookupKeys(card?.card_id).forEach((key) => {
        if (result[key] == null) result[key] = card;
      });
      return result;
    }, {});
  }, [leaderCards]);
  const leaderCardFromCatalog = useMemo(() => {
    const lookupTarget = leaderCardId !== '' ? leaderCardId : leaderLookupId;
    const lookupKey = buildCardLookupKeys(lookupTarget).find(
      (candidate) => leaderCardByLookupKey[candidate] != null
    );
    return lookupKey == null ? null : leaderCardByLookupKey[lookupKey];
  }, [leaderCardId, leaderCardByLookupKey, leaderLookupId]);
  const leaderCardIdKeys = buildCardLookupKeys(leaderCardId);
  const leaderNameLooksLikeCardId =
    leaderNameRaw !== '' &&
    (
      looksLikeCardId(leaderNameRaw) ||
      leaderCardIdKeys.includes(normalizeCardIdLookupKey(leaderNameRaw)) ||
      leaderCardIdKeys.includes(removeNumericPaddingFromCardId(leaderNameRaw))
    );

  const leaderLabel =
    leaderNameRaw !== '' && !leaderNameLooksLikeCardId
      ? leaderNameRaw
      : String(leaderCardFromCatalog?.name ?? '').trim() !== ''
        ? String(leaderCardFromCatalog?.name)
        : formatCardIdForDisplay(leaderCardId !== '' ? leaderCardId : leaderLookupId) || 'No leader selected';
  const leaderImageUrl =
    String(user?.current_leader_image_url ?? '').trim() !== ''
      ? String(user?.current_leader_image_url)
      : String(leaderCardFromCatalog?.image_url ?? '').trim() !== ''
        ? String(leaderCardFromCatalog?.image_url)
        : null;
  const aspectsFromUser = Array.isArray(user?.current_leader_aspects)
    ? user.current_leader_aspects.filter((value: any) => String(value).trim() !== '')
    : [];
  const aspects = aspectsFromUser.length > 0
    ? aspectsFromUser
    : Array.isArray(leaderCardFromCatalog?.aspects)
      ? leaderCardFromCatalog.aspects.filter((value: any) => String(value).trim() !== '')
      : [];
  if (user == null) return null;

  return (
    <Group gap={8} wrap="nowrap" style={{ maxWidth: 'min(44vw, 38rem)', minWidth: 0, flex: '0 1 auto' }}>
      {leaderImageUrl != null ? (
        <img
          src={leaderImageUrl}
          alt={leaderLabel}
          width={56}
          height={32}
          style={{ objectFit: 'contain', borderRadius: 6, background: '#f8fafc', flex: '0 0 auto' }}
        />
      ) : null}
      <div style={{ minWidth: 0 }}>
        <Text size="xs" fw={700} title={String(user.name ?? 'User')} style={{ whiteSpace: 'nowrap' }}>
          {String(user.name ?? 'User')}
        </Text>
        <Text size="xs" c="dimmed" title={leaderLabel} style={{ whiteSpace: 'nowrap' }}>
          {leaderLabel}
        </Text>
        <Group gap={4} wrap="nowrap" style={{ overflow: 'hidden' }}>
          {aspects.slice(0, 4).map((aspect: string) => {
            const key = normalizeAspectKey(aspect);
            const iconSrc = ASPECT_ICON_BY_KEY[key];
            return iconSrc != null ? (
              <img
                key={`${aspect}-${iconSrc}`}
                src={iconSrc}
                alt={aspect}
                title={aspect}
                width={12}
                height={12}
                style={{ objectFit: 'contain', flex: '0 0 auto' }}
              />
            ) : null;
          })}
        </Group>
      </div>
    </Group>
  );
}

export function HeaderAction({
  links,
  navbarState,
  breadcrumbs,
  backgroundEnabled,
  setBackgroundEnabled,
  backgroundOpacity,
  setBackgroundOpacity,
  backgroundMode,
  setBackgroundMode,
  fixedBackgroundImage,
  setFixedBackgroundImage,
}: HeaderActionProps) {
  const location = useLocation();
  const pathName = location.pathname;
  const isXl = useMediaQuery('(min-width: 1200px)');
  const isLg = useMediaQuery('(min-width: 992px)');

  const [opened, { toggle }] = navbarState != null ? navbarState : [false, { toggle: () => {} }];
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });

  const renderTopLink = (link: HeaderActionLink) => {
    if (Array.isArray(link.links) && link.links.length > 0) {
      return getMenuItemsForLink(link, classes, pathName);
    }

    return (
      <PreloadLink
        key={link.label}
        className={classes.link}
        href={link.link || ''}
        data-active={pathName === link.link || undefined}
      >
        {link.label}
      </PreloadLink>
    );
  };

  const maxVisibleTopLinks = isXl ? 5 : isLg ? 4 : 3;
  const visibleLinks = links.slice(0, maxVisibleTopLinks);
  const overflowLinks = links.slice(maxVisibleTopLinks);
  const hasOverflowActive = overflowLinks.some(
    (link) =>
      pathName === link.link ||
      (Array.isArray(link.links) && link.links.some((nestedLink) => nestedLink.link === pathName))
  );

  return (
    <AppShell.Header>
      <Container className={classes.inner} fluid>
        <Group className={classes.leftSection} wrap="nowrap" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" mr="xs" />
          <Brand />
          <Group visibleFrom="xl" className={classes.breadcrumbs} wrap="nowrap">
            {breadcrumbs}
          </Group>
        </Group>
        <Group gap={6} wrap="nowrap">
          <HeaderUserSummary />
          <Group gap={5} visibleFrom="sm" wrap="nowrap" className={classes.topLinks}>
            {visibleLinks.map((link) => renderTopLink(link))}
            {overflowLinks.length > 0 ? (
              <Menu trigger="hover" transitionProps={{ exitDuration: 0 }} withinPortal>
                <Menu.Target>
                  <PreloadLink
                    className={classes.link}
                    href="#"
                    data-active={hasOverflowActive || undefined}
                    onClick={(event) => event.preventDefault()}
                  >
                    More
                  </PreloadLink>
                </Menu.Target>
                <Menu.Dropdown>
                  {overflowLinks.map((link) => (
                    <div key={`overflow-${link.label}`}>
                      <Menu.Item component={PreloadLink} href={link.link || ''}>
                        {link.label}
                      </Menu.Item>
                      {(link.links ?? []).map((nestedLink) => (
                        <Menu.Item
                          key={`overflow-${link.label}-${nestedLink.label}`}
                          component={isExternalLink(nestedLink.link) ? 'a' : PreloadLink}
                          href={nestedLink.link}
                          target={isExternalLink(nestedLink.link) ? '_blank' : undefined}
                          rel={isExternalLink(nestedLink.link) ? 'noreferrer' : undefined}
                        >
                          <Group gap={6} wrap="nowrap">
                            <nestedLink.icon size={14} />
                            <Text size="sm">{nestedLink.label}</Text>
                          </Group>
                        </Menu.Item>
                      ))}
                    </div>
                  ))}
                </Menu.Dropdown>
              </Menu>
            ) : null}
          </Group>
          <ProfileMenu pathName={pathName} />
          <BackgroundMenu
            backgroundEnabled={backgroundEnabled}
            setBackgroundEnabled={setBackgroundEnabled}
            backgroundOpacity={backgroundOpacity}
            setBackgroundOpacity={setBackgroundOpacity}
            backgroundMode={backgroundMode}
            setBackgroundMode={setBackgroundMode}
            fixedBackgroundImage={fixedBackgroundImage}
            setFixedBackgroundImage={setFixedBackgroundImage}
          />
          <ActionIcon
            variant="default"
            onClick={() => setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light')}
            size={30}
          >
            <IconSun size={16} className={classes.light} />
            <IconMoonStars size={16} className={classes.dark} />
          </ActionIcon>
        </Group>
      </Container>
    </AppShell.Header>
  );
}

function NavBar({ links }: any) {
  return (
    <AppShell.Navbar p="md">
      {links == null ? (
        <AppShell.Section grow>
          <div />
        </AppShell.Section>
      ) : (
        links
      )}
    </AppShell.Navbar>
  );
}

export default function Layout({ children, additionalNavbarLinks, breadcrumbs }: any) {
  const navbarState = useDisclosure();
  const [opened] = navbarState;
  const swrUserResponse = getUser();
  const userId = swrUserResponse.data?.data?.id;
  const storagePrefix = useMemo(() => `background:${String(userId ?? 'guest')}`, [userId]);
  const storageKeys = useMemo(
    () => ({
      enabled: `${storagePrefix}:enabled`,
      opacity: `${storagePrefix}:opacity`,
      mode: `${storagePrefix}:mode`,
      fixedImage: `${storagePrefix}:fixed_image`,
    }),
    [storagePrefix]
  );

  const [backgroundEnabled, setBackgroundEnabled] = useState<boolean>(true);
  const [backgroundOpacity, setBackgroundOpacity] = useState<number>(30);
  const [backgroundMode, setBackgroundMode] = useState<'ROTATE' | 'FIXED'>('ROTATE');
  const [fixedBackgroundImage, setFixedBackgroundImage] = useState<string | null>(null);
  const [clock, setClock] = useState<number>(() => Date.now());
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const enabled = window.localStorage.getItem(storageKeys.enabled) !== '0';
    const parsedOpacity = Number(window.localStorage.getItem(storageKeys.opacity) ?? '30');
    const opacity = Number.isFinite(parsedOpacity) ? Math.max(0, Math.min(100, parsedOpacity)) : 30;
    const mode = window.localStorage.getItem(storageKeys.mode) === 'FIXED' ? 'FIXED' : 'ROTATE';
    const fixedImageValue = window.localStorage.getItem(storageKeys.fixedImage);
    const fixedImage =
      fixedImageValue != null && BACKGROUND_IMAGES.includes(fixedImageValue)
        ? fixedImageValue
        : null;
    setBackgroundEnabled(enabled);
    setBackgroundOpacity(opacity);
    setBackgroundMode(mode);
    setFixedBackgroundImage(fixedImage);
  }, [storageKeys]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKeys.enabled, backgroundEnabled ? '1' : '0');
  }, [backgroundEnabled, storageKeys]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKeys.opacity, String(Math.round(backgroundOpacity)));
  }, [backgroundOpacity, storageKeys]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKeys.mode, backgroundMode);
    if (backgroundMode !== 'FIXED' || fixedBackgroundImage == null || fixedBackgroundImage.trim() === '') {
      window.localStorage.removeItem(storageKeys.fixedImage);
    } else {
      window.localStorage.setItem(storageKeys.fixedImage, fixedBackgroundImage);
    }
  }, [backgroundMode, fixedBackgroundImage, storageKeys]);

  useEffect(() => {
    const refreshFromStorage = () => {
      if (typeof window === 'undefined') return;
      const mode = window.localStorage.getItem(storageKeys.mode) === 'FIXED' ? 'FIXED' : 'ROTATE';
      const fixedImageValue = window.localStorage.getItem(storageKeys.fixedImage);
      const fixedImage =
        fixedImageValue != null && BACKGROUND_IMAGES.includes(fixedImageValue)
          ? fixedImageValue
          : null;
      setBackgroundMode(mode);
      setFixedBackgroundImage(fixedImage);
    };
    window.addEventListener('user-background-settings-updated', refreshFromStorage);
    return () => window.removeEventListener('user-background-settings-updated', refreshFromStorage);
  }, [storageKeys]);

  const activeBackgroundImage = useMemo(() => {
    if (backgroundMode === 'FIXED' && fixedBackgroundImage != null) {
      return fixedBackgroundImage;
    }
    if (BACKGROUND_IMAGES.length < 1) return null;
    const hourSlot = Math.floor(clock / 3_600_000);
    return BACKGROUND_IMAGES[hourSlot % BACKGROUND_IMAGES.length];
  }, [backgroundMode, clock, fixedBackgroundImage]);
  const imageOpacity = backgroundEnabled ? Math.max(0, Math.min(1, backgroundOpacity / 100)) : 0;
  const overlayAlphaBase = computedColorScheme === 'dark' ? 0.45 : 0.50;
  const overlayAlpha = Math.max(0, Math.min(1, overlayAlphaBase * imageOpacity));
  const overlayColor =
    computedColorScheme === 'dark'
      ? `rgba(10, 15, 24, ${overlayAlpha})`
      : `rgba(255, 255, 255, ${overlayAlpha})`;
  const shouldRenderBackgroundLayers =
    backgroundEnabled && activeBackgroundImage != null && imageOpacity > 0;

  const linksComponent = (
    <AppShell.Section grow>
      {getBaseLinks()}
      {additionalNavbarLinks?.sidebar ?? additionalNavbarLinks}
    </AppShell.Section>
  );

  const headerLinks = [...getBaseLinksDict(), ...(additionalNavbarLinks?.header ?? [])];

  return (
    <AppShell
      header={{ height: 68 }}
      navbar={{
        width: 80,
        breakpoint: 'sm',
        collapsed: {
          desktop:
            additionalNavbarLinks == null ||
            (additionalNavbarLinks?.sidebar != null
              ? additionalNavbarLinks.sidebar.length < 1
              : additionalNavbarLinks.length < 1),
          mobile: !opened,
        },
      }}
      padding="md"
    >
      {shouldRenderBackgroundLayers ? (
        <>
          <div
            aria-hidden
            style={{
              position: 'fixed',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 0,
              backgroundImage: `url(${activeBackgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundAttachment: 'fixed',
              opacity: imageOpacity,
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'fixed',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 0,
              backgroundColor: overlayColor,
            }}
          />
        </>
      ) : null}
      <HeaderAction
        links={headerLinks}
        navbarState={navbarState}
        breadcrumbs={breadcrumbs}
        backgroundEnabled={backgroundEnabled}
        setBackgroundEnabled={setBackgroundEnabled}
        backgroundOpacity={backgroundOpacity}
        setBackgroundOpacity={setBackgroundOpacity}
        backgroundMode={backgroundMode}
        setBackgroundMode={setBackgroundMode}
        fixedBackgroundImage={fixedBackgroundImage}
        setFixedBackgroundImage={setFixedBackgroundImage}
      />
      <NavBar links={linksComponent} />
      <AppShell.Main>
        <div className={classes.mainContent}>{children}</div>
      </AppShell.Main>
    </AppShell>
  );
}
