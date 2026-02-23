import {
  Badge,
  Button,
  Card,
  FileInput,
  Grid,
  Group,
  Image,
  ScrollArea,
  Select,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { showNotification } from '@mantine/notifications';
import { BiGlobe } from '@react-icons/all-files/bi/BiGlobe';
import { IconHash, IconLogout, IconUser } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { PasswordStrength } from '@components/utils/password';
import { getAvatarObjectFit, getAvatarObjectPosition } from '@components/utils/avatar';
import {
  getWeaponIconConfig,
  WEAPON_ICON_OPTIONS,
} from '@constants/weapon_icons';
import { UserPublic } from '@openapi';
import { performLogoutAndRedirect } from '@services/local_storage';
import {
  getBaseApiUrl,
  getUserCardCatalog,
  getUserCardPoolSummary,
  getUserMediaCatalog,
} from '@services/adapter';
import { updatePassword, updateUser, updateUserPreferences, uploadUserAvatar } from '@services/user';

function normalizeCardLookupId(value: string | null | undefined) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized === '' || !normalized.includes('-')) return normalized;
  const [setCode, remainder] = normalized.split('-', 2);
  if (setCode === '' || remainder == null || remainder.trim() === '') return normalized;
  const token = remainder.trim();
  const match = token.match(/^0*(\d+)([a-z]*)$/i);
  if (match == null) return `${setCode}-${token}`;
  return `${setCode}-${Number(match[1])}${String(match[2] ?? '').toLowerCase()}`;
}

function buildCardLookupCandidates(value: string | null | undefined) {
  const normalized = normalizeCardLookupId(value);
  if (normalized === '') return [];
  const result = [normalized];
  const match = normalized.match(/^([a-z]+)-(\d+)([a-z]*)$/i);
  if (match != null) {
    result.push(`${match[1]}-${Number(match[2])}`);
  }
  return result.filter((item, index) => item !== '' && result.indexOf(item) === index);
}

export default function UserForm({ user, t, i18n }: { user: UserPublic; t: any; i18n: any }) {
  const navigate = useNavigate();
  const makeFavoriteCardOptionValue = (
    cardId: string | null | undefined,
    imageUrl: string | null | undefined,
    variantType: string | null | undefined
  ) => `${String(cardId ?? '')}::${String(variantType ?? '').toLowerCase()}::${String(imageUrl ?? '')}`;
  const [favoriteCardSearchInput, setFavoriteCardSearchInput] = useState('');
  const [favoriteCardSearch, setFavoriteCardSearch] = useState('');
  const [favoriteCardId, setFavoriteCardId] = useState<string | null>((user as any).favorite_card_id ?? null);
  const [favoriteCardName, setFavoriteCardName] = useState<string | null>(
    (user as any).favorite_card_name ?? null
  );
  const [favoriteCardImageUrl, setFavoriteCardImageUrl] = useState<string | null>(
    (user as any).favorite_card_image_url ?? null
  );
  const [favoriteCardSelectionValue, setFavoriteCardSelectionValue] = useState<string | null>(
    makeFavoriteCardOptionValue(
      (user as any).favorite_card_id ?? null,
      (user as any).favorite_card_image_url ?? null,
      null
    )
  );
  const [favoriteMediaSearchInput, setFavoriteMediaSearchInput] = useState('');
  const [favoriteMediaSearch, setFavoriteMediaSearch] = useState('');
  const [favoriteMedia, setFavoriteMedia] = useState<string | null>(
    (user as any).favorite_media ?? null
  );
  const [avatarFitMode, setAvatarFitMode] = useState<string | null>(
    (user as any).avatar_fit_mode ?? 'cover'
  );
  const [avatarCardSearchInput, setAvatarCardSearchInput] = useState('');
  const [avatarCardSearch, setAvatarCardSearch] = useState('');
  const [avatarCardSelectionValue, setAvatarCardSelectionValue] = useState<string | null>(null);
  const [cardPoolSearchInput, setCardPoolSearchInput] = useState('');
  const [cardPoolSearch, setCardPoolSearch] = useState('');
  const [weaponIcon, setWeaponIcon] = useState<string | null>((user as any).weapon_icon ?? null);
  const selectedWeaponIcon = getWeaponIconConfig(weaponIcon);
  const [avatarUrl, setAvatarUrl] = useState<string>((user as any).avatar_url ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const swrCardCatalogResponse = getUserCardCatalog(favoriteCardSearch, 1000, true);
  const swrAvatarCardCatalogResponse = getUserCardCatalog(avatarCardSearch, 200, false);
  const swrCardPoolSummaryResponse = getUserCardPoolSummary(cardPoolSearch, 2000);
  const swrMediaCatalogResponse = getUserMediaCatalog(favoriteMediaSearch, 50);
  const cardCatalog = swrCardCatalogResponse.data?.data ?? [];
  const avatarCardCatalog = swrAvatarCardCatalogResponse.data?.data ?? [];
  const cardPoolSummary = swrCardPoolSummaryResponse.data?.data ?? [];
  const mediaCatalog = swrMediaCatalogResponse.data?.data ?? [];
  const details_form = useForm({
    initialValues: {
      name: user != null ? user.name : '',
      email: user != null ? user.email : '',
      password: '',
      language: i18n.language,
    },

    validate: {
      name: (value) => (value !== '' ? null : t('empty_name_validation')),
      email: (value) => (value !== '' ? null : t('empty_email_validation')),
      password: (value) => (value === '' || value.length >= 8 ? null : t('too_short_password_validation')),
    },
  });
  const password_form = useForm({
    initialValues: {
      password: '',
    },

    validate: {
      password: (value) => (value.length >= 8 ? null : t('too_short_password_validation')),
    },
  });

  useEffect(() => {
    setFavoriteCardId((user as any).favorite_card_id ?? null);
    setFavoriteCardName((user as any).favorite_card_name ?? null);
    setFavoriteCardImageUrl((user as any).favorite_card_image_url ?? null);
    setFavoriteCardSelectionValue(
      makeFavoriteCardOptionValue(
        (user as any).favorite_card_id ?? null,
        (user as any).favorite_card_image_url ?? null,
        null
      )
    );
    setFavoriteMedia((user as any).favorite_media ?? null);
    setAvatarFitMode((user as any).avatar_fit_mode ?? 'cover');
    setWeaponIcon((user as any).weapon_icon ?? null);
    setAvatarUrl((user as any).avatar_url ?? '');
    setAvatarCardSelectionValue(null);
  }, [user]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFavoriteCardSearch(favoriteCardSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [favoriteCardSearchInput]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAvatarCardSearch(avatarCardSearchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [avatarCardSearchInput]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setCardPoolSearch(cardPoolSearchInput.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [cardPoolSearchInput]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFavoriteMediaSearch(favoriteMediaSearchInput.trim());
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [favoriteMediaSearchInput]);

  const favoriteCardOptions = useMemo(() => {
    const options = cardCatalog.map((card: any) => {
      const variantType = String(card?.variant_type ?? '').trim();
      const displayName = `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}${variantType !== '' ? ` [${variantType}]` : ''}`;
      return {
        value: makeFavoriteCardOptionValue(card.card_id, card.image_url, variantType),
        label: `${displayName} (${String(card.set_code || '').toUpperCase()})`,
        card_id: card.card_id,
        card_name: displayName,
        image_url: card.image_url ?? null,
      };
    });
    if (
      favoriteCardId != null &&
      favoriteCardId !== '' &&
      !options.some(
        (option: any) =>
          option.card_id === favoriteCardId && option.image_url === (favoriteCardImageUrl ?? null)
      )
    ) {
      options.unshift({
        value: makeFavoriteCardOptionValue(favoriteCardId, favoriteCardImageUrl, null),
        label: favoriteCardName ?? favoriteCardId,
        card_id: favoriteCardId,
        card_name: favoriteCardName ?? favoriteCardId,
        image_url: favoriteCardImageUrl ?? null,
      });
    }
    return options;
  }, [cardCatalog, favoriteCardId, favoriteCardImageUrl, favoriteCardName]);

  const favoriteCardOptionByValue = useMemo(
    () =>
      favoriteCardOptions.reduce((result: Record<string, any>, option: any) => {
        result[option.value] = option;
        return result;
      }, {}),
    [favoriteCardOptions]
  );

  const avatarCardOptions = useMemo(() => {
    const options = avatarCardCatalog
      .filter((card: any) => String(card?.image_url ?? '').trim() !== '')
      .map((card: any) => {
        const variantType = String(card?.variant_type ?? '').trim();
        const displayName = `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''}${variantType !== '' ? ` [${variantType}]` : ''}`;
        return {
          value: makeFavoriteCardOptionValue(card.card_id, card.image_url, variantType),
          label: `${displayName} (${String(card.set_code || '').toUpperCase()})`,
          image_url: card.image_url ?? null,
        };
      });
    if (
      (avatarUrl ?? '').trim() !== '' &&
      (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) &&
      !options.some((option: any) => option.image_url === avatarUrl)
    ) {
      options.unshift({
        value: makeFavoriteCardOptionValue('', avatarUrl, ''),
        label: 'Current avatar card image',
        image_url: avatarUrl,
      });
    }
    return options;
  }, [avatarCardCatalog, avatarUrl]);

  const avatarCardOptionByValue = useMemo(
    () =>
      avatarCardOptions.reduce((result: Record<string, any>, option: any) => {
        result[option.value] = option;
        return result;
      }, {}),
    [avatarCardOptions]
  );

  const userCardPoolRows = useMemo(
    () => {
      const cardCatalogById = cardCatalog.reduce((result: Record<string, any>, card: any) => {
        buildCardLookupCandidates(String(card?.card_id ?? '')).forEach((candidate) => {
          if (candidate !== '' && result[candidate] == null) {
            result[candidate] = card;
          }
        });
        return result;
      }, {});

      const rows = [...cardPoolSummary].map((row: any) => {
        const cardId = normalizeCardLookupId(String(row?.card_id ?? ''));
        const cardMeta =
          buildCardLookupCandidates(cardId)
            .map((candidate) => cardCatalogById[candidate])
            .find((entry) => entry != null) ?? null;
        return {
          ...row,
          card_id: cardId,
          name: String(row?.name ?? '').trim() || String(cardMeta?.name ?? '').trim() || null,
          character_variant:
            String(row?.character_variant ?? '').trim() ||
            String(cardMeta?.character_variant ?? '').trim() ||
            null,
          set_code: String(row?.set_code ?? '').trim() || String(cardMeta?.set_code ?? '').trim() || null,
          image_url: String(row?.image_url ?? '').trim() || String(cardMeta?.image_url ?? '').trim() || null,
        };
      });

      return rows.sort((left: any, right: any) => {
        const qtyDiff = Number(right?.quantity ?? 0) - Number(left?.quantity ?? 0);
        if (qtyDiff !== 0) return qtyDiff;
        const leftName = String(left?.name ?? left?.card_id ?? '').toLowerCase();
        const rightName = String(right?.name ?? right?.card_id ?? '').toLowerCase();
        return leftName.localeCompare(rightName);
      });
    },
    [cardCatalog, cardPoolSummary]
  );

  const favoriteMediaOptions = useMemo(
    () => {
      const options = mediaCatalog.map((media: any) => ({
        value: `${media.title}${media.year ? ` (${media.year})` : ''}`,
        label: `${media.title}${media.year ? ` (${media.year})` : ''}${media.media_type ? ` - ${String(media.media_type).toUpperCase()}` : ''}`,
      }));
      if (
        favoriteMedia != null &&
        favoriteMedia !== '' &&
        !options.some((option: any) => option.value === favoriteMedia)
      ) {
        options.unshift({
          value: favoriteMedia,
          label: favoriteMedia,
        });
      }
      return options;
    },
    [mediaCatalog, favoriteMedia]
  );

  const locales = [
    { value: 'de', label: '🇩🇪 German' },
    { value: 'el', label: '🇬🇷 Greek' },
    { value: 'en', label: '🇺🇸 English' },
    { value: 'es', label: '🇪🇸 Spanish' },
    { value: 'fa', label: '🌐 Persian' },
    { value: 'fr', label: '🇫🇷 French' },
    { value: 'it', label: '🇮🇹 Italian' },
    { value: 'ja', label: '🇯🇵 Japanese' },
    { value: 'nl', label: '🇳🇱 Dutch' },
    { value: 'pt', label: '🇵🇹 Portuguese' },
    { value: 'sv', label: '🇸🇪 Swedish' },
    { value: 'zh', label: '🇨🇳 Chinese' },
  ];

  const changeLanguage = (newLocale: string | null) => {
    if (newLocale == null || newLocale === '') return;
    i18n.changeLanguage(newLocale);
    navigate(`/user?lng=${newLocale}`);
  };

  return (
    <Tabs defaultValue="profile">
      <Tabs.List style={{ flexWrap: 'wrap', rowGap: 6 }}>
        <Tabs.Tab value="details" leftSection={<IconUser size="1.0rem" />}>
          {t('edit_details_tab_title')}
        </Tabs.Tab>
        <Tabs.Tab value="profile" leftSection={<IconUser size="1.0rem" />}>
          Profile
        </Tabs.Tab>
        <Tabs.Tab value="password" leftSection={<IconHash size="1.0rem" />}>
          {t('edit_password_tab_title')}
        </Tabs.Tab>
        <Tabs.Tab value="language" leftSection={<BiGlobe size="1.0rem" />}>
          {t('edit_language_tab_title')}
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="details" pt="xs">
        <form
          onSubmit={details_form.onSubmit(async (values) => {
            if (user == null) return;
            const userUpdateResponse = await updateUser(user.id, {
              name: values.name,
              email: values.email,
            } as any);
            if (userUpdateResponse == null) return;
            if ((values.password ?? '').trim() !== '') {
              const passwordUpdateResponse = await updatePassword(user.id, values.password);
              if (passwordUpdateResponse == null) return;
              details_form.setFieldValue('password', '');
            }
            if ((values.language ?? '') !== '' && values.language !== i18n.language) {
              changeLanguage(values.language);
            }
            showNotification({
              color: 'green',
              title: 'Profile details saved',
              message: '',
            });
          })}
        >
          <TextInput
            withAsterisk
            mt="1.0rem"
            label={t('name_input_label')}
            {...details_form.getInputProps('name')}
          />
          <TextInput
            withAsterisk
            mt="1.0rem"
            label={t('email_input_label')}
            type="email"
            {...details_form.getInputProps('email')}
          />
          <PasswordStrength form={details_form} />
          <Select
            allowDeselect={false}
            mt="1.0rem"
            value={details_form.values.language}
            label={t('language')}
            data={locales}
            onChange={(value) => details_form.setFieldValue('language', value ?? i18n.language)}
          />
          <Button fullWidth style={{ marginTop: 20 }} color="green" type="submit">
            {t('save_button')}
          </Button>
          <Button
            fullWidth
            style={{ marginTop: 20 }}
            color="red"
            variant="outline"
            leftSection={<IconLogout />}
            onClick={() => performLogoutAndRedirect(t, navigate)}
          >
            {t('logout_title')}
          </Button>
        </form>
      </Tabs.Panel>
      <Tabs.Panel value="profile" pt="xs">
        <Grid align="flex-start">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <TextInput
              mt="1.0rem"
              label="Favorite Card Search"
              value={favoriteCardSearchInput}
              onChange={(event) => setFavoriteCardSearchInput(event.currentTarget.value)}
              placeholder="Search your cardpool by name, variant, or card id"
            />
            <Select
              mt="1.0rem"
              searchable
              clearable
              label="Showcase Card (from your cardpool)"
              value={favoriteCardSelectionValue}
              onChange={(value) => {
                setFavoriteCardSelectionValue(value);
                if (value == null) {
                  setFavoriteCardId(null);
                  setFavoriteCardName(null);
                  setFavoriteCardImageUrl(null);
                  return;
                }
                const selected = favoriteCardOptionByValue[value];
                setFavoriteCardId(selected?.card_id ?? null);
                setFavoriteCardName(selected?.card_name ?? null);
                setFavoriteCardImageUrl(selected?.image_url ?? null);
              }}
              data={favoriteCardOptions}
              nothingFoundMessage="No matching owned cards found"
            />
            {swrCardCatalogResponse.isLoading ? (
              <Text size="xs" c="dimmed" mt={4}>
                Loading owned card variants...
              </Text>
            ) : null}
            <Text size="xs" c="dimmed" mt={4}>
              Variant art prioritizes showcase, hyperspace foil, hyperspace, and non-foil owned cards.
            </Text>
            {favoriteCardImageUrl != null && favoriteCardImageUrl !== '' ? (
              <Image src={favoriteCardImageUrl} mt="sm" w={120} radius="sm" />
            ) : null}

            <TextInput
              mt="1.0rem"
              label="Avatar Card Search (all cards)"
              value={avatarCardSearchInput}
              onChange={(event) => setAvatarCardSearchInput(event.currentTarget.value)}
              placeholder="Search any card to use for avatar art"
            />
            <Select
              mt="1.0rem"
              searchable
              clearable
              label="Avatar Card Art (independent from showcase)"
              value={avatarCardSelectionValue}
              onChange={(value) => {
                setAvatarCardSelectionValue(value);
                if (value == null) return;
                const selected = avatarCardOptionByValue[value];
                if (selected?.image_url != null && String(selected.image_url).trim() !== '') {
                  setAvatarUrl(String(selected.image_url));
                }
              }}
              data={avatarCardOptions}
              nothingFoundMessage="No cards found"
            />
            {swrAvatarCardCatalogResponse.isLoading ? (
              <Text size="xs" c="dimmed" mt={4}>
                Loading card catalog...
              </Text>
            ) : null}

            <Select
              mt="1.0rem"
              searchable
              clearable
              label="Favorite Star Wars Media"
              value={favoriteMedia}
              onChange={setFavoriteMedia}
              data={favoriteMediaOptions}
              onSearchChange={setFavoriteMediaSearchInput}
              searchValue={favoriteMediaSearchInput}
              nothingFoundMessage="No media found"
            />
            <Text size="xs" c="dimmed" mt={4}>
              Includes a curated fallback list aligned with IMDb list{' '}
              <a href="https://www.imdb.com/list/ls510243088/" target="_blank" rel="noreferrer">
                ls510243088
              </a>
              .
            </Text>
            <Select
              mt="1.0rem"
              clearable
              searchable
              label="Weapon Icon"
              value={weaponIcon}
              onChange={setWeaponIcon}
              data={WEAPON_ICON_OPTIONS}
              leftSection={
                selectedWeaponIcon == null ? null : (
                  <img
                    src={selectedWeaponIcon.iconPath}
                    alt={selectedWeaponIcon.label}
                    width={18}
                    height={18}
                    style={{ objectFit: 'contain' }}
                  />
                )
              }
              renderOption={({ option }) => {
                const icon = getWeaponIconConfig(option.value);
                return (
                  <Group gap={8} wrap="nowrap">
                    {icon != null ? (
                      <img
                        src={icon.iconPath}
                        alt={icon.label}
                        width={18}
                        height={18}
                        style={{ objectFit: 'contain' }}
                      />
                    ) : null}
                    <Text size="sm">{option.label}</Text>
                  </Group>
                );
              }}
              nothingFoundMessage="No icons found"
            />
            <Text size="xs" c="dimmed" mt={4}>
              Additional icon set reference:{' '}
              <a href="https://icons8.com/icons/set/star-wars" target="_blank" rel="noreferrer">
                Icons8 Star Wars
              </a>
            </Text>

            <TextInput
              mt="1.0rem"
              label="Avatar URL"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.currentTarget.value)}
              placeholder="https://..."
            />
            <FileInput
              mt="1.0rem"
              label="Upload Avatar"
              accept="image/png,image/jpeg,image/webp"
              value={avatarFile}
              onChange={setAvatarFile}
            />
            <Select
              mt="1.0rem"
              allowDeselect={false}
              label="Avatar Image Fit"
              value={avatarFitMode ?? 'cover'}
              onChange={(value) => setAvatarFitMode(value ?? 'cover')}
              data={[
                { value: 'cover', label: 'Fill circle (cover)' },
                { value: 'contain', label: 'Fit full image (contain)' },
              ]}
            />
            <Button
              mt="sm"
              variant="light"
              onClick={async () => {
                if (avatarFile == null || user == null) return;
                const response = await uploadUserAvatar(user.id, avatarFile);
                if (response == null) return;
                const uploadedAvatarUrl = response?.data?.data?.avatar_url ?? '';
                setAvatarUrl(uploadedAvatarUrl);
                setAvatarFile(null);
                showNotification({
                  color: 'green',
                  title: 'Avatar uploaded',
                  message: '',
                });
              }}
            >
              Upload Avatar
            </Button>
            <Button
              fullWidth
              mt="sm"
              color="green"
              onClick={async () => {
                if (user == null) return;
                const response = await updateUserPreferences(user.id, {
                  avatar_url: avatarUrl === '' ? null : avatarUrl,
                  avatar_fit_mode: avatarFitMode ?? 'cover',
                  favorite_card_id: favoriteCardId,
                  favorite_card_name: favoriteCardName,
                  favorite_card_image_url: favoriteCardImageUrl,
                  favorite_media: favoriteMedia,
                  weapon_icon: weaponIcon,
                });
                if (response == null) return;
                showNotification({
                  color: 'green',
                  title: 'Profile preferences saved',
                  message: '',
                });
              }}
            >
              Save Profile Preferences
            </Button>
            {(avatarUrl ?? '') !== '' ? (
              <>
                <Text mt="sm" size="sm" c="dimmed">
                  Avatar Preview
                </Text>
                <img
                  src={avatarUrl.startsWith('http') ? avatarUrl : `${getBaseApiUrl()}/${avatarUrl}`}
                  alt="Avatar preview"
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 9999,
                    objectFit: getAvatarObjectFit(avatarFitMode, avatarUrl, favoriteCardImageUrl),
                    objectPosition: getAvatarObjectPosition(avatarUrl, favoriteCardImageUrl),
                  }}
                />
              </>
            ) : null}
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card withBorder mt="1.0rem">
              <Text fw={700}>Your Card Pool</Text>
              <Text size="xs" c="dimmed" mb="sm">
                Full owned card list across seasons
              </Text>
              <TextInput
                value={cardPoolSearchInput}
                onChange={(event) => setCardPoolSearchInput(event.currentTarget.value)}
                placeholder="Search card name, variant, set, or id"
              />
              {swrCardPoolSummaryResponse.isLoading ? (
                <Text size="xs" c="dimmed" mt={6}>
                  Loading card pool...
                </Text>
              ) : null}
              <ScrollArea h={460} mt="sm">
                <Group gap={6} mb="xs">
                  <Badge variant="light">{userCardPoolRows.length} cards</Badge>
                </Group>
                <div>
                  {userCardPoolRows.map((row: any) => {
                    const name = String(row?.name ?? row?.card_id ?? '').trim();
                    const variant = String(row?.character_variant ?? '').trim();
                    const setCode = String(row?.set_code ?? '').trim().toUpperCase();
                    return (
                      <Group key={String(row.card_id)} justify="space-between" py={6} wrap="nowrap">
                        <div>
                          <Text size="sm" lineClamp={1}>
                            {name}
                            {variant !== '' ? ` - ${variant}` : ''}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {setCode !== '' ? `${setCode} | ` : ''}
                            {String(row.card_id)}
                          </Text>
                        </div>
                        <Badge>{row.quantity ?? 0}</Badge>
                      </Group>
                    );
                  })}
                  {userCardPoolRows.length < 1 ? (
                    <Text size="sm" c="dimmed" mt="sm">
                      No cards found.
                    </Text>
                  ) : null}
                </div>
              </ScrollArea>
            </Card>
          </Grid.Col>
        </Grid>
      </Tabs.Panel>
      <Tabs.Panel value="password" pt="xs">
        <form
          onSubmit={password_form.onSubmit(async (values) => {
            if (user != null) {
              const response = await updatePassword(user.id, values.password);
              if (response == null) return;
              password_form.setFieldValue('password', '');
              showNotification({
                color: 'green',
                title: 'Password updated',
                message: '',
              });
            }
          })}
        >
          <PasswordStrength form={password_form} />
          <Button fullWidth style={{ marginTop: 20 }} color="green" type="submit">
            {t('save_button')}
          </Button>
        </form>
      </Tabs.Panel>
      <Tabs.Panel value="language" pt="xs">
        <Select
          allowDeselect={false}
          value={i18n.language}
          label={t('language')}
          data={locales}
          onChange={async (lng) => changeLanguage(lng)}
        />
      </Tabs.Panel>
    </Tabs>
  );
}
