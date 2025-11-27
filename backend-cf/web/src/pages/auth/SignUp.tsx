import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { authClient } from '@/lib/auth-client';

export function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    // Basic validation
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      setLoading(false);
      return;
    }

    try {
      const { error: signUpError } = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (signUpError) {
        if (signUpError.code === 'USER_ALREADY_EXISTS') {
          setError('An account with this email already exists');
        } else if (signUpError.status === 429) {
          setError('Too many requests. Please wait a moment and try again');
        } else {
          setError(signUpError.message || 'Sign up failed. Please try again');
        }
        setLoading(false);
        return;
      }

      // Show success message and redirect
      setSuccess('Account created! Check your email to verify your account.');
      setTimeout(() => {
        navigate('/sign-in', { replace: true });
      }, 2000);
    } catch {
      setError('An unexpected error occurred. Please try again');
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create account" subtitle="Get started with Sokuji">
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <Input
          label="Name"
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          disabled={loading}
          autoComplete="name"
        />

        <Input
          label="Email"
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={loading}
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          required
          disabled={loading}
          autoComplete="new-password"
          hint="Password must be at least 8 characters"
        />

        <div className="auth-form__actions">
          <Button type="submit" fullWidth loading={loading}>
            Create Account
          </Button>
        </div>

        <p className="auth-form__link">
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
