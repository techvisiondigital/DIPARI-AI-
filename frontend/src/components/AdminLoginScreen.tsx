import React, { useState, useRef } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Cpu, ArrowRight, Shield, KeyRound, CheckCircle } from 'lucide-react';
import { api } from '../services/api';

interface AdminLoginScreenProps {
  onAuthSuccess: (user: any) => void;
  addToast: (title: string, message: string, type: 'success' | 'alert' | 'info') => void;
  onBackToUserLogin: () => void;
}

/**
 * AdminLoginScreen — Separate login portal for ADMIN users only.
 * Featuring TechVision Digital (#0b2240 Navy and #0076a3 Cyan) design system
 * and integrated simulated Two-Factor Authentication (2FA).
 */
export function AdminLoginScreen({ onAuthSuccess, addToast, onBackToUserLogin }: AdminLoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const authenticatedUser = null;

  // 2FA login states
  const [loginStep, setLoginStep] = useState<'credentials' | '2fa'>('credentials');
  const [twoFactorCode, setTwoFactorCode] = useState<string[]>(Array(6).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const validateEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // Handle first phase: Credentials validation
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!validateEmail(email)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      // Authenticate with backend API
      const res = await api.auth.adminLogin(email, password);

      if (res.user?.role !== 'ADMIN') {
        setErrorMessage('Access Denied: Only Administrator accounts can access the Admin Portal.');
        addToast('Access Denied', 'You do not have ADMIN privileges.', 'alert');
        return;
      }

      addToast('Admin Authenticated', 'Launching the Admin Console.', 'success');
      onAuthSuccess(res.user);
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid administrator credentials.');
      addToast('Login Failed', err.message || 'Authentication failed', 'alert');
    } finally {
      setLoading(false);
    }
  };

  // Handle second phase: 2FA validation
  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = twoFactorCode.join('');
    setErrorMessage(null);

    if (code.length < 6) {
      setErrorMessage('Please enter the full 6-digit authentication code.');
      return;
    }

    setLoading(true);
    // Simulate verification
    setTimeout(() => {
      // Accept '123456' as the mock passcode or any code for testing
      if (code === '123456') {
        addToast('2FA Verified', 'Security authorization successful. Launching Admin Console...', 'success');
        onAuthSuccess(authenticatedUser);
      } else {
        setErrorMessage('Security code is invalid or has expired. Try again.');
        addToast('Security Failure', 'Invalid 2FA code.', 'alert');
        setLoading(false);
      }
    }, 1000);
  };

  // Handle input values inside 2FA digit blocks
  const handle2FAChange = (index: number, val: string) => {
    if (isNaN(Number(val))) return; // only numbers allowed

    const newCode = [...twoFactorCode];
    newCode[index] = val.slice(-1); // only keep last digit
    setTwoFactorCode(newCode);

    // Auto-focus next input field
    if (val && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !twoFactorCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  // Reset states to retry credentials login
  const handleBackToCredentials = () => {
    setLoginStep('credentials');
    setTwoFactorCode(Array(6).fill(''));
    setErrorMessage(null);
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      background: 'radial-gradient(circle at 10% 20%, #081225 0%, #0b2240 100%)',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      padding: '40px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glowing circles matching TechVision's Navy & Cyan theme */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '-10%',
        width: '600px',
        height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0, 118, 163, 0.15) 0%, transparent 60%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-15%',
        right: '-5%',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, transparent 60%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
      }} />

      <div style={{ maxWidth: 440, width: '100%', display: 'flex', flexDirection: 'column', gap: 28, zIndex: 10 }}>

        {/* Brand Header */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '24px',
            background: 'linear-gradient(135deg, rgba(0, 118, 163, 0.25) 0%, rgba(11, 34, 64, 0.5) 100%)',
            border: '2px solid rgba(0, 118, 163, 0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(0, 118, 163, 0.3)',
            animation: 'pulse 3s infinite ease-in-out',
          }}>
            <Shield size={32} style={{ color: '#0076a3' }} />
          </div>
          <div style={{ marginTop: 4 }}>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '2rem',
              fontWeight: 800,
              letterSpacing: '-0.04em',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'center'
            }}>
              TechVision <span style={{ color: '#0076a3' }}>Admin</span>
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: 4, fontWeight: 500 }}>
              Authorized Agency Control Room & Automated Hub
            </p>
          </div>
        </div>

        {/* Error Alert Box */}
        {errorMessage && (
          <div style={{
            display: 'flex', gap: 12, padding: '14px 18px', borderRadius: 14,
            borderLeft: '4px solid #ef4444', background: 'rgba(239, 68, 68, 0.08)',
            fontSize: '0.85rem', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.15)',
            boxShadow: '0 4px 12px rgba(239, 68, 68, 0.05)'
          }}>
            <AlertCircle size={18} style={{ color: '#f87171', flexShrink: 0 }} />
            <div>{errorMessage}</div>
          </div>
        )}

        {/* Primary Glass Panel Card */}
        <div className="glass-panel" style={{
          padding: 36,
          background: 'rgba(11, 34, 64, 0.4)',
          border: '1px solid rgba(0, 118, 163, 0.25)',
          borderRadius: 24,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
          backdropFilter: 'blur(16px)',
        }}>
          {loginStep === 'credentials' ? (
            /* --- STEP 1: CREDENTIALS FORM --- */
            <form onSubmit={handleCredentialsSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ marginBottom: 4 }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#ffffff' }}>Sign In</h3>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 2 }}>Enter your agency login credentials.</p>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Admin Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#0076a3', opacity: 0.8 }} />
                  <input
                    className="form-input"
                    style={{
                      paddingLeft: 42,
                      background: 'rgba(8, 18, 37, 0.6)',
                      border: '1px solid rgba(0, 118, 163, 0.2)',
                      color: '#ffffff',
                    }}
                    type="email"
                    placeholder="name@techvision.digital"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.8rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Security Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#0076a3', opacity: 0.8 }} />
                  <input
                    className="form-input"
                    style={{
                      paddingLeft: 42,
                      paddingRight: 42,
                      background: 'rgba(8, 18, 37, 0.6)',
                      border: '1px solid rgba(0, 118, 163, 0.2)',
                      color: '#ffffff',
                    }}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                className="btn-primary"
                type="submit"
                disabled={loading}
                style={{
                  justifyContent: 'center',
                  padding: '14px',
                  marginTop: 10,
                  background: 'linear-gradient(135deg, #0076a3 0%, #094775 100%)',
                  boxShadow: '0 4px 20px rgba(0, 118, 163, 0.35)',
                  border: '1px solid rgba(0, 118, 163, 0.3)',
                  borderRadius: 14,
                  fontSize: '0.95rem',
                  fontWeight: 600,
                }}
              >
                {loading ? <Cpu className="animate-spin" size={18} /> : <span>Verify Account</span>}
                {!loading && <ArrowRight size={18} style={{ marginLeft: 8 }} />}
              </button>
            </form>
          ) : (
            /* --- STEP 2: TWO-FACTOR AUTHENTICATION FORM --- */
            <form onSubmit={handle2FASubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(0, 118, 163, 0.15)', border: '1px solid rgba(0, 118, 163, 0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <KeyRound size={20} style={{ color: '#0076a3' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ffffff' }}>Identity Verification</h3>
                  <p style={{ fontSize: '0.75rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                    <CheckCircle size={12} /> Credentials accepted
                  </p>
                </div>
              </div>

              <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4 }}>
                A simulated verification code has been dispatched to your Authenticator app. Enter the code below to complete authorization.
              </p>

              {/* 2FA Digit Input Blocks */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', margin: '8px 0' }}>
                {twoFactorCode.map((val, idx) => (
                  <input
                    key={idx}
                    ref={el => inputRefs.current[idx] = el}
                    type="text"
                    maxLength={1}
                    value={val}
                    onChange={e => handle2FAChange(idx, e.target.value)}
                    onKeyDown={e => handleKeyDown(idx, e)}
                    style={{
                      width: '46px',
                      height: '52px',
                      borderRadius: '12px',
                      border: val ? '2px solid #0076a3' : '1px solid rgba(0, 118, 163, 0.25)',
                      background: 'rgba(8, 18, 37, 0.7)',
                      textAlign: 'center',
                      fontSize: '1.4rem',
                      fontWeight: 700,
                      color: '#ffffff',
                      boxShadow: val ? '0 0 10px rgba(0, 118, 163, 0.2)' : 'none',
                      outline: 'none',
                    }}
                  />
                ))}
              </div>

              <div 
                onClick={() => setTwoFactorCode(['1', '2', '3', '4', '5', '6'])}
                style={{
                  background: 'rgba(0, 118, 163, 0.08)',
                  border: '1px solid rgba(0, 118, 163, 0.15)',
                  padding: '12px 14px',
                  borderRadius: 12,
                  fontSize: '0.75rem',
                  color: '#93c5fd',
                  lineHeight: 1.4,
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 118, 163, 0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'rgba(0, 118, 163, 0.08)'}
              >
                <strong>Developer Notice:</strong> Click here to autofill test token <strong>123456</strong> to proceed.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  className="btn-primary"
                  type="submit"
                  disabled={loading}
                  style={{
                    justifyContent: 'center',
                    padding: '14px',
                    background: 'linear-gradient(135deg, #0076a3 0%, #094775 100%)',
                    boxShadow: '0 4px 20px rgba(0, 118, 163, 0.35)',
                    border: '1px solid rgba(0, 118, 163, 0.3)',
                    borderRadius: 14,
                    fontSize: '0.95rem',
                    fontWeight: 600,
                  }}
                >
                  {loading ? <Cpu className="animate-spin" size={18} /> : <span>Verify & Authorize</span>}
                </button>

                <button
                  type="button"
                  onClick={handleBackToCredentials}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    textAlign: 'center',
                    marginTop: 4,
                    textDecoration: 'underline'
                  }}
                >
                  Back to Credentials
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Back to main client login link */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={onBackToUserLogin}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'color 0.2s',
            }}
          >
            ← Back to Client Portal
          </button>
        </div>

        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#64748b', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>Restricted Access — TechVision Digital Security Core v2.4</div>
          <div style={{ opacity: 0.6 }}>IP Logging is active. Unauthorized actions will be recorded.</div>
        </div>
      </div>
    </div>
  );
}
