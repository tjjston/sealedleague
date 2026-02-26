import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import RequestErrorAlert from '@components/utils/error_alert';
import { checkForAuthError, getUser } from '@services/adapter';
import { getLogin, performLogout, tokenPresent } from '@services/local_storage';
import { updatePassword } from '@services/user';

export default function PasswordResetPage() {
  const navigate = useNavigate();
  const hasToken = tokenPresent();
  const swrUserResponse = getUser();
  if (hasToken) {
    checkForAuthError(swrUserResponse);
  }

  const user = swrUserResponse.data?.data ?? null;
  const login = getLogin();
  const requiresPasswordUpdate = Boolean(login?.must_update_password);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const validationError = useMemo(() => {
    if (password.trim().length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (password !== confirmPassword) {
      return 'Passwords do not match.';
    }
    return null;
  }, [confirmPassword, password]);

  if (!hasToken) {
    return (
      <Container size={520} my={60}>
        <Paper withBorder shadow="md" p={30} radius="md">
          <Stack>
            <Title order={3}>Reset Password</Title>
            <Text c="dimmed">Sign in first, then update your password from this page.</Text>
            <Group>
              <Button onClick={() => navigate('/login')}>Go to Login</Button>
            </Group>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size={520} my={60}>
      <Paper withBorder shadow="md" p={30} radius="md">
        <Stack>
          <Title order={3}>Set New Password</Title>
          {requiresPasswordUpdate ? (
            <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light">
              Your password was reset by an admin. Set a new password to continue.
            </Alert>
          ) : (
            <Text c="dimmed">Update your account password.</Text>
          )}

          {swrUserResponse.error != null ? <RequestErrorAlert error={swrUserResponse.error} /> : null}

          <PasswordInput
            label="New Password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          <PasswordInput
            label="Confirm New Password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
          />
          {validationError != null ? (
            <Text size="sm" c="red">
              {validationError}
            </Text>
          ) : null}

          <Group>
            <Button
              disabled={user == null || validationError != null}
              onClick={async () => {
                if (user == null || validationError != null) return;
                await updatePassword(Number(user.id), password);
                const currentLogin = getLogin();
                localStorage.setItem(
                  'login',
                  JSON.stringify({
                    ...currentLogin,
                    must_update_password: false,
                  })
                );
                showNotification({
                  color: 'green',
                  title: 'Password updated',
                  message: 'Your new password has been saved.',
                });
                navigate('/');
              }}
            >
              Save New Password
            </Button>
            {requiresPasswordUpdate ? (
              <Anchor
                component="button"
                type="button"
                onClick={() => {
                  performLogout();
                  navigate('/login');
                }}
              >
                Logout
              </Anchor>
            ) : null}
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
