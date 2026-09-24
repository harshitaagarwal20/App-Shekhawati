import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Field, TextInput } from '../components/ui.jsx';

const schema = z.object({
  username: z.string().trim().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } });

  async function onSubmit(values) {
    setServerError('');
    try {
      const user = await login(values);
      const target = user.mustChangePassword
        ? '/change-password'
        : (location.state?.from?.pathname ?? '/');
      navigate(target, { replace: true });
    } catch (err) {
      setServerError(err.message || 'Unable to sign in');
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <h1>Sekawati Impex ERP</h1>
        <p className="sub">Sign in to continue</p>

        <Alert kind="error">{serverError}</Alert>

        <Field label="Username" required error={errors.username?.message} htmlFor="username">
          <TextInput
            id="username"
            autoComplete="username"
            autoFocus
            error={errors.username}
            {...register('username')}
          />
        </Field>

        <Field label="Password" required error={errors.password?.message} htmlFor="password">
          <TextInput
            id="password"
            type="password"
            autoComplete="current-password"
            error={errors.password}
            {...register('password')}
          />
        </Field>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 8 }}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>

        <p className="faint" style={{ fontSize: 11.5, marginTop: 16, marginBottom: 0 }}>
          Access is granted by role. If a screen is missing, your role does not include it - ask the
          administrator rather than sharing an account.
        </p>
      </form>
    </div>
  );
}
