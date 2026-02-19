import {
  Alert,
  Button,
  Divider,
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
import { checkForAuthError, getUser, getUsersAdmin } from '@services/adapter';
import {
  createAdminUser,
  deleteUserAsAdmin,
  updatePassword,
  updateUser,
  updateUserAccountType,
} from '@services/user';
import Layout from './_layout';

type UserItem = {
  id: number;
  name: string;
  email: string;
  account_type: string;
};

export default function AdminUsersPage() {
  const swrUsersResponse = getUsersAdmin();
  const swrCurrentUserResponse = getUser();
  checkForAuthError(swrUsersResponse);
  checkForAuthError(swrCurrentUserResponse);

  const users: UserItem[] = useMemo(
    () => swrUsersResponse.data?.data ?? [],
    [swrUsersResponse.data]
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [accountType, setAccountType] = useState<'REGULAR' | 'ADMIN'>('REGULAR');
  const [newPassword, setNewPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserAccountType, setNewUserAccountType] = useState<'REGULAR' | 'ADMIN'>('REGULAR');

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
      setAccountType(selected.account_type === 'ADMIN' ? 'ADMIN' : 'REGULAR');
      setNewPassword('');
    }
  }, [users, selectedUserId]);

  const selected = users.find((user) => String(user.id) === selectedUserId);
  const isUnauthorized = swrCurrentUserResponse.data?.data?.account_type !== 'ADMIN';

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
          This page is only available to admin accounts.
        </Alert>
      )}

      {!isUnauthorized && (
        <Stack style={{ maxWidth: '44rem' }} mt="md">
          <Title order={4}>Create Account</Title>
          <TextInput
            label="Name"
            value={newUserName}
            onChange={(event) => setNewUserName(event.currentTarget.value)}
          />
          <TextInput
            label="Email"
            value={newUserEmail}
            onChange={(event) => setNewUserEmail(event.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            value={newUserPassword}
            onChange={(event) => setNewUserPassword(event.currentTarget.value)}
          />
          <Select
            label="Account Type"
            value={newUserAccountType}
            onChange={(value) => setNewUserAccountType((value as 'REGULAR' | 'ADMIN') ?? 'REGULAR')}
            data={[
              { value: 'REGULAR', label: 'USER' },
              { value: 'ADMIN', label: 'ADMIN' },
            ]}
            allowDeselect={false}
          />
          <Group>
            <Button
              disabled={
                newUserName.trim() === '' ||
                newUserEmail.trim() === '' ||
                newUserPassword.trim().length < 8
              }
              onClick={async () => {
                await createAdminUser({
                  name: newUserName.trim(),
                  email: newUserEmail.trim(),
                  password: newUserPassword,
                  account_type: newUserAccountType,
                });
                setNewUserName('');
                setNewUserEmail('');
                setNewUserPassword('');
                setNewUserAccountType('REGULAR');
                await refreshUsers();
              }}
            >
              Create Account
            </Button>
          </Group>

          <Divider my="xs" />
          <Title order={4}>Manage Existing Account</Title>
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
            onChange={(value) => setAccountType((value as 'REGULAR' | 'ADMIN') ?? 'REGULAR')}
            data={[
              { value: 'REGULAR', label: 'USER' },
              { value: 'ADMIN', label: 'ADMIN' },
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
            <Button
              disabled={selected == null}
              color="red"
              onClick={async () => {
                if (selected == null) return;
                if (!window.confirm(`Delete ${selected.name} (${selected.email})?`)) return;
                await deleteUserAsAdmin(selected.id);
                setSelectedUserId(null);
                await refreshUsers();
              }}
            >
              Delete Account
            </Button>
          </Group>
        </Stack>
      )}
    </Layout>
  );
}
