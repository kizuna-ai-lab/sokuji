import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { authClient } from '@/lib/auth-client';

export function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        // Handle specific error codes
        if (signInError.code === 'INVALID_EMAIL_OR_PASSWORD') {
          setError('Invalid email or password');
        } else if (signInError.code === 'USER_NOT_FOUND') {
          setError('No account found with this email');
        } else if (signInError.status === 403) {
          setError('Please verify your email address before signing in');
        } else if (signInError.status === 429) {
          setError('Too many requests. Please wait a moment and try again');
        } else {
          setError(signInError.message || 'Sign in failed. Please try again');
        }
        setLoading(false);
        return;
      }

      // Navigate to dashboard on success
      navigate('/dashboard', { replace: true });
    } catch {
      setError('An unexpected error occurred. Please try again');
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your account">
      <form className="auth-form" onSubmit={handleSubmit}>
        {error && <Alert variant="error">{error}</Alert>}

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

        <div>
          <Input
            label="Password"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            disabled={loading}
            autoComplete="current-password"
          />
          <div className="auth-form__inline-link">
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
        </div>

        <div className="auth-form__actions">
          <Button type="submit" fullWidth loading={loading}>
            Sign In
          </Button>
        </div>

        <p className="auth-form__link">
          Don't have an account? <Link to="/sign-up">Sign up</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
