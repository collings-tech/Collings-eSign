import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useAuth } from '../auth/AuthContext.jsx';
import collingsLogo from '../assets/collings-logo-1.png';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password flow
  const [forgotStep, setForgotStep] = useState(0); // 0 = off, 1 = email, 2 = otp, 3 = new password, 4 = success
  const [forgotEmail, setForgotEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [retypePassword, setRetypePassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.post('/auth/login', { email, password });
      login(res.data.token, res.data.user);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPasswordClick = () => {
    setForgotStep(1);
    setForgotEmail('');
    setOtp('');
    setNewPassword('');
    setRetypePassword('');
    setError('');
    setSuccessMessage('');
  };

  const handleForgotSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password-send-otp', { email: forgotEmail.trim() });
      setForgotStep(2);
      setOtp('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotResendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password-send-otp', { email: forgotEmail.trim() });
      setOtp('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password-verify-otp', {
        email: forgotEmail.trim(),
        otp: otp.trim(),
      });
      setForgotStep(3);
      setOtp('');
      setNewPassword('');
      setRetypePassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== retypePassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/auth/forgot-password-reset', {
        email: forgotEmail.trim(),
        password: newPassword,
        retypePassword,
      });
      setSuccessMessage('Your password has been reset successfully. You can now sign in.');
      setForgotStep(4);
      setTimeout(() => {
        setForgotStep(0);
        setSuccessMessage('');
        setForgotEmail('');
        setNewPassword('');
        setRetypePassword('');
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotBack = () => {
    setError('');
    if (forgotStep === 1) {
      setForgotStep(0);
      setForgotEmail('');
    } else {
      setForgotStep((s) => s - 1);
    }
  };

  const handleForgotClose = () => {
    setForgotStep(0);
    setForgotEmail('');
    setOtp('');
    setNewPassword('');
    setRetypePassword('');
    setError('');
    setSuccessMessage('');
  };

  // Forgot password flow UI
  if (forgotStep > 0) {
    const titles = {
      1: 'Forgot password',
      2: 'Enter verification code',
      3: 'Create new password',
      4: 'Password reset successful',
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
          <h1>{titles[forgotStep]}</h1>
          {error && <div className="auth-error">{error}</div>}
          {successMessage && <div className="auth-success">{successMessage}</div>}

          {forgotStep === 1 && (
            <form onSubmit={handleForgotSendOtp} className="auth-form">
              <p className="auth-step-hint">Enter the email for your account and we&apos;ll send you a verification code.</p>
              <label>
                Email
                <input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </label>
              <button type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send verification code'}
              </button>
              <button type="button" className="auth-link-btn" onClick={handleForgotClose} disabled={loading}>
                ← Back to sign in
              </button>
            </form>
          )}

          {forgotStep === 2 && (
            <form onSubmit={handleForgotVerifyOtp} className="auth-form">
              <p className="auth-step-hint">We sent a 6-digit code to {forgotEmail}</p>
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
                <button type="button" className="auth-link-btn" onClick={handleForgotResendOtp} disabled={loading}>
                  Resend code
                </button>
                <button type="button" className="auth-link-btn" onClick={handleForgotBack} disabled={loading}>
                  ← Change email
                </button>
              </div>
            </form>
          )}

          {forgotStep === 3 && (
            <form onSubmit={handleForgotResetPassword} className="auth-form">
              <p className="auth-step-hint">Create a new password for {forgotEmail}</p>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
                {loading ? 'Resetting…' : 'Reset password'}
              </button>
              <button type="button" className="auth-link-btn" onClick={handleForgotBack} disabled={loading}>
                ← Back
              </button>
            </form>
          )}

          {forgotStep === 4 && (
            <div className="auth-form">
              <p className="auth-step-hint">{successMessage}</p>
              <p className="auth-step-hint">Redirecting you to sign in…</p>
              <button type="button" className="auth-link-btn" onClick={handleForgotClose}>
                Sign in now
              </button>
            </div>
          )}

          <p className="auth-switch">
            Remember your password? <button type="button" className="auth-link-btn" onClick={handleForgotClose}>Sign in</button>
          </p>
        </div>
      </div>
    );
  }

  // Normal login
  return (
    <div className="auth-container">
      <div className="auth-card">
        <span className="auth-brand">
          <span className="top-brand-text">
            <img src={collingsLogo} alt="Collings" className="top-brand-logo" />
            <span className="top-brand-esign">eSign</span>
          </span>
        </span>
        <h1>Sign in</h1>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="auth-forgot">
            <button type="button" className="auth-link-btn" onClick={handleForgotPasswordClick}>
              Forgot password?
            </button>
          </p>
        </form>
        <p className="auth-switch">
          Don&apos;t have an account? <Link to="/signup">Create one</Link>
        </p>
      </div>
    </div>
  );
}

