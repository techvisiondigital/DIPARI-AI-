import { useState, useEffect } from 'react';
import { Shield, CheckCircle, RefreshCw, LogOut, Check } from 'lucide-react';
import { api } from '../services/api';

interface ConnectMetaProps {
  businessId: string;
  addToast: (title: string, message: string, type: 'success' | 'alert' | 'info') => void;
  /** Navigates to another page once channel mapping is saved. */
  onNavigate?: (page: string) => void;
}

export default function ConnectMeta({ businessId, addToast, onNavigate }: ConnectMetaProps) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<any>({ connected: false });
  
  // Selection options fetched from Meta Graph
  const [adAccounts, setAdAccounts] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [instagramAccounts, setInstagramAccounts] = useState<any[]>([]);
  
  // Selected configurations
  const [selectedAdAcc, setSelectedAdAcc] = useState('');
  const [selectedPage, setSelectedPage] = useState('');
  const [selectedIG, setSelectedIG] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadStatus();
  }, [businessId]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const connStatus = await api.meta.getStatus(businessId);
      setStatus(connStatus);
      if (connStatus.connected) {
        // Load options
        const [accs, pgs] = await Promise.all([
          api.meta.getAdAccounts(businessId),
          api.meta.getPages(businessId)
        ]);
        setAdAccounts(accs);
        setPages(pgs);

        if (connStatus.selectedAdAccountId) setSelectedAdAcc(connStatus.selectedAdAccountId);
        if (connStatus.selectedPageId) {
          setSelectedPage(connStatus.selectedPageId);
          // Load IG for this page
          const igs = await api.meta.getInstagramAccounts(businessId, connStatus.selectedPageId);
          setInstagramAccounts(igs);
        }
        if (connStatus.selectedInstagramAccountId) setSelectedIG(connStatus.selectedInstagramAccountId);
      }
    } catch (e: any) {
      console.error(e);
      addToast('Status sync error', 'Failed to fetch Meta account details', 'alert');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthConnect = async () => {
    try {
      const url = await api.meta.getAuthUrl(businessId);
      // Simulate/Trigger OAuth Redirect
      addToast('Redirecting', 'Opening Facebook Secure Authentication page...', 'info');
      window.location.href = url;
    } catch (e: any) {
      addToast('OAuth Link generation failed', e.message, 'alert');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect your Meta Ads integration? This will stop daily tracking.')) return;
    try {
      await api.meta.disconnect(businessId);
      addToast('Meta account disconnected', 'Integration tokens revoked successfully.', 'info');
      setStatus({ connected: false });
      setAdAccounts([]);
      setPages([]);
      setInstagramAccounts([]);
    } catch (e: any) {
      addToast('Disconnection failed', e.message, 'alert');
    }
  };

  const handlePageChange = async (pageId: string) => {
    setSelectedPage(pageId);
    setSelectedIG('');
    setInstagramAccounts([]);
    if (!pageId) return;
    try {
      const igs = await api.meta.getInstagramAccounts(businessId, pageId);
      setInstagramAccounts(igs);
      if (igs.length > 0) setSelectedIG(igs[0].id);
    } catch (e: any) {
      addToast('Instagram lookup failed', 'Could not retrieve IG accounts connected to page', 'alert');
    }
  };

  const handleSaveSelections = async () => {
    if (!selectedAdAcc || !selectedPage) {
      addToast('Selections incomplete', 'Please configure an active Ad Account and Facebook Page.', 'alert');
      return;
    }
    setSaving(true);
    try {
      const adAccName = adAccounts.find(a => a.id === selectedAdAcc)?.name || 'Default Account';
      const pageName = pages.find(p => p.id === selectedPage)?.name || 'Default Page';
      const igName = instagramAccounts.find(i => i.id === selectedIG)?.username || '';

      await api.meta.selectAccounts(businessId, {
        adAccountId: selectedAdAcc,
        adAccountName: adAccName,
        pageId: selectedPage,
        pageName: pageName,
        instagramAccountId: selectedIG,
        instagramAccountName: igName
      });

      addToast('Configuration Saved', 'Opening your content calendar…', 'success');
      loadStatus();

      // Channel mapping is the last setup step — take the user straight to the
      // content calendar, which is what they came here to unlock.
      if (onNavigate) {
        onNavigate('calendar');
      }
    } catch (e: any) {
      addToast('Configuration error', e.message, 'alert');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <RefreshCw className="animate-spin" style={{ color: 'var(--color-primary)', margin: '0 auto 20px auto' }} />
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Verifying authorization token status...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px 8%', display: 'flex', flexDirection: 'column', gap: 32 }}>
      
      <div>
        <h1 style={{ fontSize: '2.2rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>Meta Integration</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>Hook up your Facebook Ads credentials to manage campaigns directly.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 32, alignItems: 'start' }}>
        
        {/* Left Side: Setup Forms */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          
          {!status.connected ? (
            <div className="glass-panel" style={{ padding: 40, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
              <div className="glow-aura" style={{ top: '-10%', left: '50%', transform: 'translateX(-50%)' }}></div>
              <Shield size={48} style={{ color: 'var(--color-primary)', marginBottom: 24 }} />
              <h2 style={{ fontSize: '1.6rem', marginBottom: 12 }}>Connect Meta Ads Manager</h2>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: 450, margin: '0 auto 32px auto', lineHeight: 1.6 }}>
                Integrate your Facebook Business Manager to let our AI strategist create audiences, upload assets, and launch live campaigns directly.
              </p>
              <button className="btn-primary" style={{ padding: '14px 36px', fontSize: '1rem' }} onClick={handleOAuthConnect}>
                Login with Facebook
              </button>
            </div>
          ) : (
            <div className="glass-panel" style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 28 }}>
              
              <div>
                <h3 style={{ fontSize: '1.25rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={18} style={{ color: 'var(--color-success)' }} /> Connected to Meta Graph Engine
                </h3>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  Authenticated as <strong>{status.facebookUserName}</strong> (User ID: {status.facebookUserId}).
                </p>
              </div>

              {/* Form elements */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Ad Account</label>
                  <select 
                    className="form-input" 
                    value={selectedAdAcc} 
                    onChange={e => setSelectedAdAcc(e.target.value)}
                    style={{ background: 'rgba(15,23,42,0.1)' }}
                  >
                    <option value="">-- Choose Ad Account --</option>
                    {adAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Facebook Page</label>
                    <select 
                      className="form-input" 
                      value={selectedPage} 
                      onChange={e => handlePageChange(e.target.value)}
                      style={{ background: 'rgba(15,23,42,0.1)' }}
                    >
                      <option value="">-- Choose Page --</option>
                      {pages.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Instagram Account</label>
                    <select 
                      className="form-input" 
                      value={selectedIG} 
                      onChange={e => setSelectedIG(e.target.value)}
                      style={{ background: 'rgba(15,23,42,0.1)' }}
                    >
                      <option value="">-- Choose IG Profile --</option>
                      {instagramAccounts.map(i => (
                        <option key={i.id} value={i.id}>{i.username}</option>
                      ))}
                    </select>
                  </div>
                </div>

              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 24, marginTop: 12 }}>
                <button className="btn-secondary" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }} onClick={handleDisconnect}>
                  <LogOut size={16} /> Disconnect Account
                </button>
                <button className="btn-primary" onClick={handleSaveSelections} disabled={saving}>
                  {saving ? <RefreshCw className="animate-spin" size={16} /> : <Check size={16} />} Save
                </button>
              </div>

            </div>
          )}

        </div>

        {/* Right Side: Informative Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="glass-panel" style={{ padding: 24, background: 'rgba(99, 102, 241, 0.03)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={16} style={{ color: 'var(--color-primary)' }} /> Secure Credentials
            </h4>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
              All access keys are stored securely using AES-256-CBC token encryption block ciphers. The system automatically fetches long-lived permissions valid for 60 days and updates them silently when active.
            </p>
          </div>

          <div className="glass-panel" style={{ padding: 24 }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Integration Checklist</h4>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.8rem', listStyle: 'none', color: 'var(--color-text-muted)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--color-accent)' }}>✓</span> Facebook login connected
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: selectedAdAcc ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                  {selectedAdAcc ? '✓' : '○'}
                </span> Ad Account selected
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: selectedPage ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                  {selectedPage ? '✓' : '○'}
                </span> Facebook Page linked
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: selectedIG ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                  {selectedIG ? '✓' : '○'}
                </span> Instagram Business connected
              </li>
            </ul>
          </div>
        </div>

      </div>

    </div>
  );
}
