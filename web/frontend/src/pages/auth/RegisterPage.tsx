import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { Notice } from '@/components/ui/states';
import { useApiErrorMessage, useServerValidation } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { AuthShell } from './AuthShell';

/** Mirrors `registerSchema` in `backend/src/routes/auth.js`, bound for bound. */
const schema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().min(1).email().max(254),
  password: z.string().min(8).max(200),
});

type RegisterValues = z.infer<typeof schema>;

const FIELDS = ['name', 'email', 'password'] as const;

export default function RegisterPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { register: createAccount } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const toMessage = useApiErrorMessage();
  const applyServerValidation = useServerValidation<RegisterValues>();

  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // The language currently on screen becomes the account's language: it is
      // the only chance to record it, since the API exposes no user-update
      // route (see i18n/LanguageContext.tsx).
      await createAccount({ ...values, language });
      // `/`, not `/onboarding`: the landing resolver there decides from the
      // account's data. Naming `/onboarding` directly used to race the
      // authenticated-guard redirect, and lost.
      navigate('/', { replace: true });
    } catch (error) {
      const placed = applyServerValidation(error, setError, FIELDS);
      if (placed.length === 0) setFormError(toMessage(error));
    }
  });

  return (
    <AuthShell
      title={t('auth:registerTitle')}
      subtitle={t('auth:registerSubtitle')}
      panelMessage={t('auth:registerPanelMessage')}
      footer={
        <>
          {t('auth:haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-brand-700 underline">
            {t('auth:goToLogin')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="register-form">
        {formError && (
          <Notice tone="danger" data-testid="register-error">
            {formError}
          </Notice>
        )}

        <TextField
          label={t('auth:nameLabel')}
          autoComplete="name"
          placeholder={t('auth:namePlaceholder')}
          required
          data-testid="name-input"
          error={
            errors.name &&
            (errors.name.message && errors.name.type === 'server'
              ? errors.name.message
              : t('common:validation.min', { min: 2 }))
          }
          {...register('name')}
        />

        {/*
          The design's inline language row. The choice itself still lives in
          `LanguageContext` (the same toggle sits in the header above), this is
          only a second, more visible place to make it — the language the
          account is created in matters enough that the reference gives it its
          own row rather than leaving it to the corner toggle alone.
        */}
        <div>
          <p className="mb-1.5 block text-sm font-medium text-ink-700">
            {t('auth:languagePrompt')}
          </p>
          <LanguageToggle />
        </div>

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
          autoComplete="new-password"
          required
          hint={t('auth:passwordHint')}
          data-testid="password-input"
          error={errors.password && t('common:validation.min', { min: 8 })}
          {...register('password')}
        />

        <Button
          type="submit"
          fullWidth
          size="lg"
          isLoading={isSubmitting}
          data-testid="register-submit"
        >
          {isSubmitting ? t('auth:registering') : t('auth:registerCta')}
        </Button>
      </form>
    </AuthShell>
  );
}
