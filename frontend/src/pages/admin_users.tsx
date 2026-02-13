import {
  Alert,
  Button,
  Group,
  PasswordInput,
  Select,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';

import RequestErrorAlert from '@components/utils/error_alert';
import { checkForAuthError, getUsersAdmin } from '@services/adapter';
import { updatePassword, updateUser, updateUserAccountType } from '@services/user';
import Layout from './_layout';

type UserItem = {
  id: number;
  name: string;
  email: string;
  account_type: 'REGULAR' | 'DEMO';
};

export default function AdminUsersPage() {
  const swrUsersResponse = getUsersAdmin();
  checkForAuthError(swrUsersResponse);

  const users: UserItem[] = useMemo(
    () => swrUsersResponse.data?.data ?? [],
    [swrUsersResponse.data]
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accountType, setAccountType] = useState<'REGULAR' | 'DEMO'>('REGULAR');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    if (users.length > 0 && selectedUserId == null) {
      setSelectedUserId(String(users[0].id));
    }
  }, [users, selectedUserId]);

  useEffect(() => {
    const selected = users.find((user) => String(user.id) === selectedUserId);
    if (selected != null) {
      setName(selected.name);
      setEmail(selected.email);
      setAccountType(selected.account_type);
      setNewPassword('');
    }
  }, [users, selectedUserId]);

  const selected = users.find((user) => String(user.id) === selectedUserId);
  const isUnauthorized = swrUsersResponse.error?.response?.status === 401;

  async function refreshUsers() {
    await swrUsersResponse.mutate();
  }

  return (
    <Layout>
      <Title>Admin Users</Title>
      {swrUsersResponse.error && <RequestErrorAlert error={swrUsersResponse.error} />}

      {isUnauthorized && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Admin access required"
          color="red"
          mt="md"
        >
          This page is only available to the configured admin account.
        </Alert>
      )}

      {!isUnauthorized && (
        <Stack style={{ maxWidth: '44rem' }} mt="md">
          <Select
            label="User"
            value={selectedUserId}
            onChange={setSelectedUserId}
            data={users.map((user) => ({
              value: String(user.id),
              label: `${user.name} (${user.email})`,
            }))}
            allowDeselect={false}
          />

          <TextInput
            label="Name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <TextInput
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <Select
            label="Account Type"
            value={accountType}
            onChange={(value) => setAccountType((value as 'REGULAR' | 'DEMO') ?? 'REGULAR')}
            data={[
              { value: 'REGULAR', label: 'REGULAR' },
              { value: 'DEMO', label: 'DEMO' },
            ]}
            allowDeselect={false}
          />
          <PasswordInput
            label="Reset Password"
            description="Leave empty to keep current password."
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
          />

          <Group>
            <Button
              disabled={selected == null}
              onClick={async () => {
                if (selected == null) return;
                await updateUser(selected.id, { name, email });
                await refreshUsers();
              }}
            >
              Save Profile
            </Button>
            <Button
              disabled={selected == null}
              variant="light"
              onClick={async () => {
                if (selected == null) return;
                await updateUserAccountType(selected.id, accountType);
                await refreshUsers();
              }}
            >
              Save Account Type
            </Button>
            <Button
              disabled={selected == null || newPassword.length < 8}
              color="red"
              variant="light"
              onClick={async () => {
                if (selected == null || newPassword.length < 8) return;
                await updatePassword(selected.id, newPassword);
                setNewPassword('');
              }}
            >
              Reset Password
            </Button>
          </Group>
        </Stack>
      )}
    </Layout>
  );
}
