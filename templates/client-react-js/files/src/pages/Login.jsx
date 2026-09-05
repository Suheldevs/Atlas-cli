import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import Alert from '../components/Alert';
import AuthLayout from '../components/AuthLayout';
import SubmitButton from '../components/SubmitButton';
import TextField from '../components/TextField';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';

/**
 * Deliberately not RFC 5322. This catches the shapes a human gets wrong — a missing `@`, a bare
 * domain, a stray space — and leaves the question of whether the address exists to the server.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

function validate(values) {
  const errors = {};

  if (values.email.trim() === '') errors.email = 'Email is required.';
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Enter a valid email address.';

  if (values.password === '') errors.password = 'Password is required.';

  return errors;
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  // Where `ProtectedRoute` bounced them from, so signing in resumes what they were doing.
  const redirectTo = location.state?.from ?? '/dashboard';

  function handleChange(event) {
    const { name, value } = event.target;

    setValues((current) => ({ ...current, [name]: value }));
    // Clearing on edit, rather than re-validating on every keystroke, keeps the form from shouting
    // "invalid email" at somebody who has typed two characters so far.
    setErrors((current) => (current[name] === undefined ? current : { ...current, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);
    setFormError(null);

    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);

    try {
      await login({ email: values.email.trim().toLowerCase(), password: values.password });
      navigate(redirectTo, { replace: true });
    } catch (error) {
      // `ApiError` has already turned the failure envelope into a message and per-field errors.
      const apiError =
        error instanceof ApiError ? error : new ApiError('Something went wrong. Please try again.');

      setErrors(apiError.fieldErrors);
      setFormError(apiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to __PROJECT_NAME__."
      footer={
        <>
          Don&rsquo;t have an account? <Link to="/signup">Create one</Link>
        </>
      }
    >
      {formError && <Alert title={formError.message} messages={formError.generalMessages} />}

      <form className="form" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={handleChange}
          error={errors.email}
          disabled={pending}
          required
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={values.password}
          onChange={handleChange}
          error={errors.password}
          disabled={pending}
          required
        />
        <SubmitButton pending={pending} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
