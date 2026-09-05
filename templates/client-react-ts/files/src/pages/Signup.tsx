import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import Alert from '../components/Alert';
import AuthLayout from '../components/AuthLayout';
import SubmitButton from '../components/SubmitButton';
import TextField from '../components/TextField';
import { useAuth } from '../context/AuthContext';
import { ApiError, type FieldErrors } from '../lib/api';

interface SignupValues {
  name: string;
  email: string;
  password: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;
const MIN_PASSWORD_LENGTH = 8;

function validate(values: SignupValues): FieldErrors {
  const errors: Record<string, string> = {};

  if (values.name.trim() === '') errors['name'] = 'Name is required.';
  else if (values.name.trim().length < 2) errors['name'] = 'Name must be at least 2 characters.';

  if (values.email.trim() === '') errors['email'] = 'Email is required.';
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors['email'] = 'Enter a valid email address.';

  if (values.password === '') errors['password'] = 'Password is required.';
  else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors['password'] = `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }

  return errors;
}

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState<SignupValues>({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const { name, value } = event.target;

    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] === undefined ? current : { ...current, [name]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;

    const nextErrors = validate(values);
    setErrors(nextErrors);
    setFormError(null);

    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);

    try {
      await signup({
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
      });
      void navigate('/dashboard', { replace: true });
    } catch (error: unknown) {
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
      title="Create your account"
      subtitle="It takes less than a minute."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {formError !== null && <Alert title={formError.message} messages={formError.generalMessages} />}

      <form className="form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <TextField
          id="name"
          name="name"
          type="text"
          label="Name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={values.name}
          onChange={handleChange}
          error={errors['name']}
          disabled={pending}
          required
        />
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          placeholder="you@example.com"
          value={values.email}
          onChange={handleChange}
          error={errors['email']}
          disabled={pending}
          required
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          placeholder="••••••••"
          hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters.`}
          value={values.password}
          onChange={handleChange}
          error={errors['password']}
          disabled={pending}
          required
        />
        <SubmitButton pending={pending} pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
