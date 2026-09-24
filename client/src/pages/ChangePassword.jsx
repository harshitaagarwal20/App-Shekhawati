import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext.jsx';
import { auth as authApi } from '../services/erp.js';
import { Alert, Field, PageHeader, TextInput } from '../components/ui.jsx';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .refine((v) => /[0-9]/.test(v), 'Password must contain a number'),
    confirmPassword: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export default function ChangePassword() {
  const { mustChangePassword, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });

  async function onSubmit(values) {
    setServerError('');
    try {
      await authApi.changePassword(values);
      await refreshUser();
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 900);
    } catch (err) {
      setServerError(err.message || 'Could not change the password');
    }
  }

  const body = (
    <div className="card" style={{ maxWidth: 480 }}>
      <form className="card-body" onSubmit={handleSubmit(onSubmit)} noValidate>
        {mustChangePassword && (
          <Alert kind="warning">
            This account is still using the password it was created with. Set your own password to
            continue - the rest of the application is locked until you do.
          </Alert>
        )}
        <Alert kind="error">{serverError}</Alert>
        {done && <Alert kind="success">Password changed. Taking you to the dashboard...</Alert>}

        <Field label="Current password" required error={errors.currentPassword?.message} htmlFor="cur">
          <TextInput
            id="cur"
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword}
            {...register('currentPassword')}
          />
        </Field>

        <Field
          label="New password"
          required
          error={errors.newPassword?.message}
          hint="At least 8 characters, including a number. An 8-digit number is fine."
          htmlFor="new"
        >
          <TextInput
            id="new"
            type="password"
            autoComplete="new-password"
            error={errors.newPassword}
            {...register('newPassword')}
          />
        </Field>

        <Field label="Confirm new password" required error={errors.confirmPassword?.message} htmlFor="conf">
          <TextInput
            id="conf"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword}
            {...register('confirmPassword')}
          />
        </Field>

        <p className="faint" style={{ fontSize: 11.5 }}>
          Changing your password signs you out everywhere else.
        </p>

        <div className="row" style={{ marginTop: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting || done}>
            {isSubmitting ? 'Saving...' : 'Change password'}
          </button>
          {mustChangePassword && (
            <button type="button" className="btn" onClick={() => logout().then(() => navigate('/login'))}>
              Sign out instead
            </button>
          )}
        </div>
      </form>
    </div>
  );

  // Before the first password change there is no app shell around this page.
  if (mustChangePassword) {
    return (
      <div className="auth-page">
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div className="auth-card">
            <h1>Set your password</h1>
            <p className="sub">Required before you can use the ERP</p>
          </div>
          <div style={{ marginTop: 12 }}>{body}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Change password" />
      {body}
    </>
  );
}
