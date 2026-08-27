import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  User as UserIcon,
  Building,
  Eye,
  EyeOff,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  Shield,
  Cpu,
} from 'lucide-react';
import { api } from '../services/api';
import { auth } from '../services/firebase';
import { sendEmailVerification } from 'firebase/auth';
import { friendlyError } from '../utils/errorMessages';

interface AuthScreensProps {
  defaultView?: 'login' | 'register';
  onAuthSuccess: (user: any) => void;
  addToast: (title: string, message: string, type: 'success' | 'alert' | 'info') => void;
  onBackToHome?: () => void;
}

type AuthView = 'login' | 'register' | 'forgot' | 'verify';

export function AuthScreens({ defaultView, onAuthSuccess, addToast, onBackToHome }: AuthScreensProps) {
  const [view, setView] = useState<AuthView>(defaultView || 'login');
  
  useEffect(() => {
    if (defaultView) {
      setView(defaultView);
    }
  }, [defaultView]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [preferredLanguage, setPreferredLanguage] = useState('English');

  // States
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [firebaseConfigured, setFirebaseConfigured] = useState(true);

  // Strength checks
  const [strength, setStrength] = useState({ score: 0, text: 'Too Weak', color: '#ef4444' });

  useEffect(() => {
    setFirebaseConfigured(!!auth);
  }, []);

  // Password strength logic
  useEffect(() => {
    if (!password) {
      setStrength({ score: 0, text: 'Too Weak', color: '#ef4444' });
      return;
    }
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    let text = 'Weak';
    let color = '#ef4444';
    if (score === 2) { text = 'Fair'; color = '#f59e0b'; }
    else if (score === 3) { text = 'Good'; color = '#3b82f6'; }
    else if (score === 4) { text = 'Strong'; color = '#10b981'; }
    setStrength({ score, text, color });
  }, [password]);

  const validateEmail = (emailStr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!validateEmail(email)) { setErrorMessage('Please enter a valid email address.'); return; }
    if (password !== confirmPassword) { setErrorMessage('Passwords do not match.'); return; }
    if (strength.score < 2) { setErrorMessage('Please use a stronger password.'); return; }

    setLoading(true);
    try {
      await api.auth.register(email, name, password, businessName, preferredLanguage);
      setSuccessMessage('Account created! A verification email has been sent. Please check your inbox.');
      addToast('Registration Successful', 'Verification link sent to ' + email, 'success');
      setView('verify');
    } catch (err: any) {
      const message = friendlyError(err, 'Registration failed. Please try again.');
      setErrorMessage(message);
      addToast('Registration Failed', message, 'alert');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!validateEmail(email)) { setErrorMessage('Please enter a valid email address.'); return; }

    setLoading(true);
    try {
      const res = await api.auth.login(email, password);
      addToast('Welcome Back', `Logged in as ${res.user.name}`, 'success');
      onAuthSuccess(res.user);
    } catch (err: any) {
      if (err.message === 'Please verify your email before continuing.') {
        setView('verify');
      } else {
        const message = friendlyError(err, 'Incorrect email or password. Please try again.');
        setErrorMessage(message);
        addToast('Login Failed', message, 'alert');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (!firebaseConfigured) {
      addToast('Firebase Unavailable', 'Firebase configuration is missing. Check frontend/.env', 'alert');
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      const res = await api.auth.loginWithGoogle();
      addToast('Google Sign-In Successful', `Welcome, ${res.user.name}!`, 'success');
      onAuthSuccess(res.user);
    } catch (err: any) {
      const message = friendlyError(err, 'Google sign-in failed. Please try again.');
      setErrorMessage(message);
      addToast('Sign-In Failed', message, 'alert');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!validateEmail(email)) { setErrorMessage('Please enter a valid email address.'); return; }

    setLoading(true);
    try {
      await api.auth.sendPasswordReset(email);
      setSuccessMessage('If this email is registered, a password reset link has been dispatched.');
      addToast('Reset Sent', 'Reset details sent to ' + email, 'success');
    } catch (err: any) {
      setErrorMessage(friendlyError(err, 'Failed to request password reset link.'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(true);
    try {
      const currentUser = auth?.currentUser;
      if (currentUser) {
        await sendEmailVerification(currentUser);
        setSuccessMessage('Verification email resent successfully. Check your inbox and spam folder.');
        addToast('Email Resent', 'Check your inbox for a new link', 'success');
      } else {
        setErrorMessage('Session expired. Please sign in with your email/password, then check for a verification prompt.');
      }
    } catch (err: any) {
      setErrorMessage(friendlyError(err, 'Failed to resend verification email.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: '100vh', background: 'var(--color-bg-end)', color: 'var(--color-text)' }}>
      {/* Form Container */}
      <div style={{
        flex: 1.2,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px 20px',
        position: 'relative'
      }}>
        {/* Back to Home Button */}
        {onBackToHome && (
          <button
            type="button"
            onClick={onBackToHome}
            style={{
              position: 'absolute',
              top: 24,
              left: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255, 255, 255, 0.85)',
              border: '1px solid var(--color-border)',
              padding: '10px 18px',
              borderRadius: 12,
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'var(--color-text-main)',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-soft)',
              transition: 'all 0.2s ease',
              zIndex: 10
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateX(-3px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'none'}
          >
            <ArrowLeft size={18} />
            <span>Back to Home</span>
          </button>
        )}

        <div style={{ maxWidth: 460, width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Header */}
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '2.5rem' }}>🚀</span>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.04em', margin: 0 }}>
              Visionpilot <span className="text-gradient">AI</span>
            </h2>
            <p style={{ color: 'var(--color-primary)', fontSize: '0.88rem', fontWeight: 600, margin: 0 }}>
              (Meta authorised Ai marketing agent)
            </p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.82rem', margin: 0 }}>
              Autonomous Meta advertising channels powered by intelligence
            </p>
          </div>

          {/* Auth Method Tabs — shown on login/register */}
          {(view === 'login' || view === 'register') && (
            <div style={{ display: 'flex', gap: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
              <button
                type="button"
                onClick={() => { setView('login'); setErrorMessage(null); }}
                style={{
                  flex: 1, padding: '10px 0', background: view === 'login' ? 'rgba(99,102,241,0.15)' : 'transparent',
                  border: 'none', color: view === 'login' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.2s'
                }}
              >Sign In</button>
              <button
                type="button"
                onClick={() => { setView('register'); setErrorMessage(null); }}
                style={{
                  flex: 1, padding: '10px 0', background: view === 'register' ? 'rgba(99,102,241,0.15)' : 'transparent',
                  border: 'none', borderLeft: '1px solid var(--color-border)',
                  color: view === 'register' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.2s'
                }}
              >Register</button>
            </div>
          )}

          {/* Alerts */}
          {errorMessage && (
            <div className="glass-panel" style={{
              display: 'flex', gap: 12, padding: '14px 18px', borderRadius: 12,
              borderLeft: '4px solid var(--color-danger)', background: 'rgba(239, 68, 68, 0.05)', fontSize: '0.85rem'
            }}>
              <AlertCircle size={18} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
              <div>{errorMessage}</div>
            </div>
          )}

          {successMessage && (
            <div className="glass-panel" style={{
              display: 'flex', gap: 12, padding: '14px 18px', borderRadius: 12,
              borderLeft: '4px solid var(--color-success)', background: 'rgba(16, 185, 129, 0.05)', fontSize: '0.85rem'
            }}>
              <CheckCircle size={18} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              <div>{successMessage}</div>
            </div>
          )}

          {/* ── LOGIN VIEW ─────────────────────────────────────────── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Business Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    className="form-input"
                    style={{ paddingLeft: 42, background: '#ffffff', color: '#0f172a', border: '1.5px solid #cbd5e1', borderRadius: 10, fontSize: '0.9rem' }}
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Password</label>
                  <span onClick={() => setView('forgot')} style={{ fontSize: '0.8rem', color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}>
                    Forgot Password?
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    className="form-input"
                    style={{ paddingLeft: 42, paddingRight: 42, background: '#ffffff', color: '#0f172a', border: '1.5px solid #cbd5e1', borderRadius: 10, fontSize: '0.9rem' }}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'flex' }}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem', marginTop: 2 }}>
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ width: 16, height: 16, borderRadius: 4, accentColor: '#6366f1', cursor: 'pointer', margin: 0 }}
                />
                <label htmlFor="rememberMe" style={{ cursor: 'pointer', color: '#475569', fontWeight: 500, userSelect: 'none' }}>Remember Me</label>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '13px 20px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  border: 'none',
                  borderRadius: 12,
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: loading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                  marginTop: 8,
                  transition: 'all 0.2s ease'
                }}
              >
                {loading ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          )}
          {/* ── REGISTER VIEW ──────────────────────────────────────── */}
          {view === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Full Name</label>
                <div style={{ position: 'relative' }}>
                  <UserIcon size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40 }} placeholder="Alex Carter" value={name} onChange={e => setName(e.target.value)} required />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Business Name</label>
                <div style={{ position: 'relative' }}>
                  <Building size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40 }} placeholder="Acme Retail Ltd." value={businessName} onChange={e => setBusinessName(e.target.value)} required />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Business Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40 }} type="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40, paddingRight: 40 }} type={showPassword ? 'text' : 'password'} placeholder="Minimum 8 characters" value={password} onChange={e => setPassword(e.target.value)} required />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, display: 'flex' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>Strength:</span>
                      <span style={{ color: strength.color, fontWeight: 600 }}>{strength.text}</span>
                    </div>
                    <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: strength.color, width: `${(strength.score / 4) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Confirm Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40 }} type="password" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Preferred Onboarding Language</label>
                <div style={{ position: 'relative' }}>
                  <select
                    className="form-input"
                    value={preferredLanguage}
                    onChange={e => setPreferredLanguage(e.target.value)}
                    style={{ paddingLeft: 14, appearance: 'auto', background: 'var(--color-input-bg)', width: '100%' }}
                  >
                    {['English', 'Hindi', 'Hinglish', 'Bengali', 'Marathi', 'Telugu', 'Tamil', 'Gujarati', 'Urdu', 'Kannada', 'Malayalam', 'Punjabi'].map(lang => (
                      <option key={lang} value={lang} style={{ background: 'var(--color-card-bg)', color: 'var(--color-text)' }}>{lang}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '13px 20px',
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  border: 'none',
                  borderRadius: 12,
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: loading ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                  marginTop: 8,
                  transition: 'all 0.2s ease'
                }}
              >
                {loading ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          )}

          {/* ── FORGOT PASSWORD VIEW ───────────────────────────────── */}
          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Reset Password</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
                  Enter your email address and we'll send reset instructions.
                </p>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 6, fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}>Business Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }} />
                  <input className="form-input" style={{ paddingLeft: 40 }} type="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
              </div>

              <button className="btn-primary" type="submit" disabled={loading} style={{ justifyContent: 'center', padding: '12px' }}>
                {loading ? <Cpu className="animate-spin" size={16} /> : <span>Send Reset Instructions</span>}
              </button>

              <button type="button" className="btn-secondary" onClick={() => setView('login')} style={{ justifyContent: 'center', gap: 8 }}>
                <ArrowLeft size={16} /> Back to Sign In
              </button>
            </form>
          )}

          {/* ── EMAIL VERIFICATION SCREEN ──────────────────────────── */}
          {view === 'verify' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Shield size={48} style={{ color: 'var(--color-primary)' }} />
                <h3 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Verify Your Email</h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                  A verification link was sent to <strong>{email}</strong>. Click the link to activate your account.
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                  Can't find it? Check your <strong>spam / junk folder</strong>.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn-primary" onClick={handleResendVerification} disabled={loading} style={{ justifyContent: 'center' }}>
                  {loading ? <Cpu className="animate-spin" size={16} /> : 'Resend Verification Link'}
                </button>
                <button className="btn-secondary" onClick={() => setView('login')} style={{ justifyContent: 'center', gap: 8 }}>
                  <ArrowLeft size={16} /> Return to Sign In
                </button>
              </div>
            </div>
          )}

          {/* ── GOOGLE SIGN IN BUTTON ──────────────────────────────── */}
          {(view === 'login' || view === 'register') && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Or Continue With</span>
                <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
              </div>

              <button
                type="button"
                className="btn-secondary"
                disabled={loading || !firebaseConfigured}
                onClick={handleGoogleAuth}
                style={{
                  justifyContent: 'center', padding: '12px',
                  opacity: firebaseConfigured ? 1 : 0.5,
                  cursor: firebaseConfigured ? 'pointer' : 'not-allowed'
                }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: 8 }}>
                  <path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.24h2.9c1.69-1.55 2.69-3.85 2.69-6.57z" fill="#4285F4" />
                  <path d="M9 18c2.43 0 4.47-.8 5.96-2.23l-2.91-2.24c-.8.54-1.84.87-3.05.87-2.34 0-4.33-1.58-5.03-3.7H.95v2.3C2.43 15.89 5.48 18 9 18z" fill="#34A853" />
                  <path d="M3.97 10.7c-.18-.54-.28-1.12-.28-1.7s.1-1.16.28-1.7V5H.95C.34 6.2 0 7.56 0 9s.34 2.8 1.05 4h3.02l-1.1-2.3z" fill="#FBBC05" />
                  <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47 1.05 11.43 0 9 0 5.48 0 2.43 2.11.95 5.3l3.02 2.3c.7-2.12 2.69-3.7 5.03-3.7z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>

              {!firebaseConfigured && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', textAlign: 'center', marginTop: -8 }}>
                  ⚠️ Firebase is not configured. Add real values to <code>frontend/.env</code>
                </div>
              )}

              {/* Test Credentials Helper Card */}
              <div style={{ display: 'none' }} aria-hidden="true">
                {/* Test credentials helper */}
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  fontSize: '0.8rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Shield size={12} />
                    <span>💡 TEST CREDENTIALS (CLICK TO AUTOFILL)</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div
                      onClick={() => { setEmail('demo@campaignai.com'); setPassword('password123'); }}
                      style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(99, 102, 241, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    >
                      <span>Client: <code style={{ color: '#fff' }}>demo@campaignai.com</code></span>
                      <span style={{ opacity: 0.6 }}>Pass: <code style={{ color: '#fff' }}>password123</code></span>
                    </div>
                    <div
                      onClick={() => { setEmail('admin@campaignai.com'); setPassword('password123'); }}
                      style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 118, 163, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    >
                      <span>Admin: <code style={{ color: '#fff' }}>admin@campaignai.com</code></span>
                      <span style={{ opacity: 0.6 }}>Pass: <code style={{ color: '#fff' }}>password123</code></span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Decorative Branding Panel */}
      <div className="branding-panel" style={{
        flex: 1,
        background: 'linear-gradient(135deg, var(--color-primary-light), var(--color-bg-start))',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 8%', borderLeft: '1px solid var(--color-border)',
        position: 'relative', overflow: 'hidden'
      }}>
        <div className="glow-aura" style={{ top: '30%', right: '20%' }} />
        <div style={{ position: 'relative', zIndex: 1, maxWidth: 440 }}>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1.2, marginBottom: 20 }}>
            Autonomous optimization, <br /> zero maintenance.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1rem', lineHeight: 1.6, marginBottom: 24 }}>
            Deploy targeted Meta campaigns in under 4 minutes. Our systems audit targeting overlays, test copy variations, and adjust bids autonomously to optimize ROAS.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
            <span>● Email Sign-In</span>
            <span>● Google OAuth</span>
          </div>
        </div>
      </div>
    </div>
  );
}
