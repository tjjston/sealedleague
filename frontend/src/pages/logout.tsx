import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { performLogoutAndRedirect } from '@services/local_storage';

export default function LogoutPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    performLogoutAndRedirect(t, navigate);
  }, [navigate, t]);

  return null;
}
