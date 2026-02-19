import { Button, Group, Stack, Title } from '@mantine/core';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import UserForm from '@components/forms/user';
import RequestErrorAlert from '@components/utils/error_alert';
import { TableSkeletonSingleColumn } from '@components/utils/skeletons';
import { checkForAuthError, getUser } from '@services/adapter';
import Layout from './_layout';

export default function UserPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const swrUserResponse = getUser();
  checkForAuthError(swrUserResponse);
  const user = swrUserResponse.data != null ? swrUserResponse.data.data : null;
  const currentLeader =
    (user as any)?.current_leader_name ??
    (user as any)?.current_leader_card_id ??
    'No deck leader selected';

  let content = user != null ? <UserForm user={user} i18n={i18n} t={t} /> : null;

  if (swrUserResponse.isLoading) {
    content = (
      <Group maw="40rem">
        <TableSkeletonSingleColumn />
      </Group>
    );
  }

  return (
    <Layout>
      <Group align="end" justify="space-between" wrap="wrap">
        <Title>{t('edit_profile_title')}</Title>
        {user != null ? (
          <Title order={5} lineClamp={1}>
            {user.name} | Leader: {currentLeader}
          </Title>
        ) : null}
      </Group>
      {user?.account_type === 'ADMIN' ? (
        <Button mt="sm" mb="sm" variant="light" onClick={() => navigate('/admin/users')}>
          Admin Users
        </Button>
      ) : null}
      {swrUserResponse.error && <RequestErrorAlert error={swrUserResponse.error} />}
      <Stack style={{ width: '100%' }}>{content}</Stack>
    </Layout>
  );
}
