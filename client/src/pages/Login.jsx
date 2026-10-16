import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Field, TextInput } from '../components/ui.jsx';

/**
 * Sign-in.
 *
 * Plain state rather than react-hook-form and zod, on purpose. This screen is
 * eager - it is the first paint for anyone signed out - so whatever it imports
 * lands in the startup bundle. The two form libraries are ~80 kB minified and
 * every other form in the app is lazy, so leaving them here made every cold
 * load pay for them just to check that two boxes are not empty.
 */
function validate({ username, password }) {
  const errors = {};
  if (!username.trim()) errors.username = { message: 'Username is required' };
  if (!password) errors.password = { message: 'Password is required' };
  return errors;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState('');
  const [values, setValues] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setSubmitting] = useState(false);

  const register = (name) => ({
    name,
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    await onSubmit({ username: values.username.trim(), password: values.password });
    setSubmitting(false);
  }

  async function onSubmit(credentials) {
    setServerError('');
    try {
      const user = await login(credentials);
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
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
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
