import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Notice } from '@/components/ui/states';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { AuthShell } from './AuthShell';

/**
 * The login schema is intentionally looser than the register one: rejecting a
 * short password here would answer 422 where a real attempt answers 401, which
 * is a free oracle for whether an account exists. The backend makes exactly
 * the same choice (`routes/auth.js`), and the client must not undo it by
 * validating harder.
 */
const schema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

type LoginValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toMessage = useApiErrorMessage();

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const intended = (location.state as { from?: string } | null)?.from;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      navigate(intended && intended !== '/login' ? intended : '/dashboard', { replace: true });
    } catch (error) {
      // One message for every failure mode — wrong password, unknown account,
      // locked out. Splitting them would enumerate accounts (ST-02).
      setFormError(toMessage(error));
    }
  });

  return (
    <AuthShell
      title={t('auth:loginTitle')}
      subtitle={t('auth:loginSubtitle')}
      footer={
        <>
          {t('auth:noAccount')}{' '}
          <Link to="/register" className="font-semibold text-brand-700 underline">
            {t('auth:goToRegister')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="login-form">
        {formError && (
          <Notice tone="danger" data-testid="login-error">
            {formError}
          </Notice>
        )}

        <TextField
          label={t('auth:emailLabel')}
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t('auth:emailPlaceholder')}
          required
          data-testid="email-input"
          error={errors.email && t('common:validation.email')}
          {...register('email')}
        />

        <TextField
          label={t('auth:passwordLabel')}
          type="password"
          autoComplete="current-password"
          required
          data-testid="password-input"
          error={errors.password && t('common:validation.required')}
          {...register('password')}
        />

        <Button type="submit" fullWidth size="lg" isLoading={isSubmitting} data-testid="login-submit">
          {isSubmitting ? t('auth:loggingIn') : t('auth:loginCta')}
        </Button>
      </form>
    </AuthShell>
  );
}
