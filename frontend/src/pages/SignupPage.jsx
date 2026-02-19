import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext.jsx';
import collingsLogo from '../assets/collings-logo-1.png';

export default function SignupPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [retypePassword, setRetypePassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/signup-send-otp', { email: email.trim() });
      setStep(2);
      setOtp('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/signup-send-otp', { email: email.trim() });
      setError('');
      setOtp('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/signup-verify-otp', { email: email.trim(), otp: otp.trim() });
      setStep(3);
      setOtp('');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== retypePassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/signup', {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        password,
        retypePassword,
      });
      login(res.data.token, res.data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setError('');
    setStep((s) => s - 1);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <span className="auth-brand">
          <span className="top-brand-text">
            <img src={collingsLogo} alt="Collings" className="top-brand-logo" />
            <span className="top-brand-esign">eSign</span>
          </span>
        </span>
        <h1>Create account</h1>
        {error && <div className="auth-error">{error}</div>}

        {step === 1 && (
          <form onSubmit={handleSendOtp} className="auth-form">
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send verification code'}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            <p className="auth-step-hint">We sent a 6-digit code to {email}</p>
            <label>
              Verification code
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                required
                autoComplete="one-time-code"
              />
            </label>
            <button type="submit" disabled={loading || otp.length !== 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <div className="auth-step-actions">
              <button type="button" className="auth-link-btn" onClick={handleResendOtp} disabled={loading}>
                Resend code
              </button>
              <button type="button" className="auth-link-btn" onClick={handleBack} disabled={loading}>
                ← Change email
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleCompleteSignup} className="auth-form">
            <p className="auth-step-hint">Email verified: {email}</p>
            <label>
              First name
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
              />
            </label>
            <label>
              Last name
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <label>
              Retype password
              <input
                type="password"
                value={retypePassword}
                onChange={(e) => setRetypePassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create account'}
            </button>
            <button type="button" className="auth-link-btn" onClick={handleBack}>
              ← Back
            </button>
          </form>
        )}

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
