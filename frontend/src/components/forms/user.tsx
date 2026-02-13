import { Button, FileInput, Image, Select, Tabs, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { BiGlobe } from '@react-icons/all-files/bi/BiGlobe';
import { IconHash, IconLogout, IconUser } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { PasswordStrength } from '@components/utils/password';
import { UserPublic } from '@openapi';
import { performLogoutAndRedirect } from '@services/local_storage';
import { getBaseApiUrl, getUserCardCatalog } from '@services/adapter';
import { updatePassword, updateUser, updateUserPreferences, uploadUserAvatar } from '@services/user';

const FAVORITE_MEDIA_OPTIONS = [
  { value: 'Movies', label: 'Movies' },
  { value: 'Live-Action Series', label: 'Live-Action Series' },
  { value: 'Animated Series', label: 'Animated Series' },
  { value: 'Books', label: 'Books' },
  { value: 'Comics', label: 'Comics' },
  { value: 'Video Games', label: 'Video Games' },
  { value: 'Neither', label: 'Neither' },
];

export default function UserForm({ user, t, i18n }: { user: UserPublic; t: any; i18n: any }) {
  const navigate = useNavigate();
  const [favoriteCardSearch, setFavoriteCardSearch] = useState('');
  const [favoriteCardId, setFavoriteCardId] = useState<string | null>((user as any).favorite_card_id ?? null);
  const [favoriteCardName, setFavoriteCardName] = useState<string | null>(
    (user as any).favorite_card_name ?? null
  );
  const [favoriteCardImageUrl, setFavoriteCardImageUrl] = useState<string | null>(
    (user as any).favorite_card_image_url ?? null
  );
  const [favoriteMedia, setFavoriteMedia] = useState<string | null>(
    (user as any).favorite_media ?? null
  );
  const [avatarUrl, setAvatarUrl] = useState<string>((user as any).avatar_url ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const swrCardCatalogResponse = getUserCardCatalog(favoriteCardSearch, 120);
  const cardCatalog = swrCardCatalogResponse.data?.data ?? [];
  const details_form = useForm({
    initialValues: {
      name: user != null ? user.name : '',
      email: user != null ? user.email : '',
      password: '',
    },

    validate: {
      name: (value) => (value !== '' ? null : t('empty_name_validation')),
      email: (value) => (value !== '' ? null : t('empty_email_validation')),
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
    setFavoriteMedia((user as any).favorite_media ?? null);
    setAvatarUrl((user as any).avatar_url ?? '');
  }, [user]);

  const favoriteCardOptions = useMemo(
    () =>
      cardCatalog.map((card: any) => ({
        value: card.card_id,
        label: `${card.name}${card.character_variant ? ` - ${card.character_variant}` : ''} (${String(card.set_code || '').toUpperCase()})`,
      })),
    [cardCatalog]
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
    i18n.changeLanguage(newLocale);
    navigate(`/user?lng=${newLocale}`);
  };

  return (
    <Tabs defaultValue="details">
      <Tabs.List>
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
            if (user != null) await updateUser(user.id, values);
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
        <TextInput
          mt="1.0rem"
          label="Favorite Card Search"
          value={favoriteCardSearch}
          onChange={(event) => setFavoriteCardSearch(event.currentTarget.value)}
          placeholder="Search by card name"
        />
        <Select
          mt="1.0rem"
          searchable
          clearable
          label="Favorite Card"
          value={favoriteCardId}
          onChange={(value) => {
            setFavoriteCardId(value);
            const selected = cardCatalog.find((card: any) => card.card_id === value);
            setFavoriteCardName(selected?.name ?? null);
            setFavoriteCardImageUrl(selected?.image_url ?? null);
          }}
          data={favoriteCardOptions}
        />
        {favoriteCardImageUrl != null && favoriteCardImageUrl !== '' ? (
          <Image src={favoriteCardImageUrl} mt="sm" w={120} radius="sm" />
        ) : null}
        <Button
          mt="sm"
          variant="outline"
          onClick={() => {
            if (favoriteCardImageUrl != null && favoriteCardImageUrl !== '') {
              setAvatarUrl(favoriteCardImageUrl);
            }
          }}
        >
          Use Favorite Card Image As Avatar
        </Button>

        <Select
          mt="1.0rem"
          label="Favorite Star Wars Media"
          value={favoriteMedia}
          onChange={setFavoriteMedia}
          data={FAVORITE_MEDIA_OPTIONS}
          searchable
          clearable
        />

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
        <Button
          mt="sm"
          variant="light"
          onClick={async () => {
            if (avatarFile == null || user == null) return;
            const response = await uploadUserAvatar(user.id, avatarFile);
            const uploadedAvatarUrl = response?.data?.data?.avatar_url ?? '';
            setAvatarUrl(uploadedAvatarUrl);
            setAvatarFile(null);
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
            await updateUserPreferences(user.id, {
              avatar_url: avatarUrl === '' ? null : avatarUrl,
              favorite_card_id: favoriteCardId,
              favorite_card_name: favoriteCardName,
              favorite_card_image_url: favoriteCardImageUrl,
              favorite_media: favoriteMedia,
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
            <Image
              src={avatarUrl.startsWith('http') ? avatarUrl : `${getBaseApiUrl()}/${avatarUrl}`}
              w={120}
              radius="xl"
            />
          </>
        ) : null}
      </Tabs.Panel>
      <Tabs.Panel value="password" pt="xs">
        <form
          onSubmit={password_form.onSubmit(async (values) => {
            if (user != null) await updatePassword(user.id, values.password);
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
