import { useState } from 'react';
import { ChevronRight, Cpu, Award, Zap, BarChart2, Send, X } from 'lucide-react';
import { api } from '../services/api';

interface CampaignGeneratorProps {
  businessId: string;
  addToast: (title: string, message: string, type: 'success' | 'alert' | 'info') => void;
  onDraftGenerated: (draftId: string, strategy: any) => void;
}

export default function CampaignGenerator({ businessId, addToast, onDraftGenerated }: CampaignGeneratorProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [draftId, setDraftId] = useState('');

  // Step 1: Basic Business details
  const [basicDetails, setBasicDetails] = useState({
    name: '',
    objective: 'CONVERSIONS',
    dailyBudget: '100',
    businessName: '',
    website: '',
    industry: '',
    product: '',
    targetCountry: 'United States',
    goal: 'Sales conversions',
    festivalTheme: ''
  });

  // Step 2: Strategy Review
  // Step 2: Strategy Review
  const [generatedStrategy, setGeneratedStrategy] = useState<any>(null);
  const [isPostingModalOpen, setIsPostingModalOpen] = useState(false);
  const [paymentPlan, setPaymentPlan] = useState<string | null>(null);

  const handlePlanPurchase = async (plan: 'PRO' | 'ENTERPRISE', planName: string) => {
    setPaymentPlan(plan);
    try {
      const result = await api.business.upgradePlan(businessId, plan);
      if (!result?.paymentUrl) {
        throw new Error('The payment link could not be created. Please try again.');
      }

      addToast('Opening secure checkout', `${planName} payment is ready.`, 'info');
      setIsPostingModalOpen(false);
      // A top-level navigation is reliable after an async API call and avoids popup blockers.
      window.location.assign(result.paymentUrl);
    } catch (err: any) {
      addToast('Payment setup failed', err.message || 'Could not start checkout.', 'alert');
    } finally {
      setPaymentPlan(null);
    }
  };

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Required field guard (Website URL is intentionally optional)
    const requiredFields: { key: keyof typeof basicDetails; label: string }[] = [
      { key: 'name', label: 'Campaign Name' },
      { key: 'objective', label: 'Objective' },
      { key: 'dailyBudget', label: 'Daily Budget' },
      { key: 'businessName', label: 'Business Name' },
      { key: 'industry', label: 'Industry' },
      { key: 'festivalTheme', label: 'Festival / Event Theme' },
      { key: 'targetCountry', label: 'Target Country' },
    ];
    const missing = requiredFields.find(f => !String(basicDetails[f.key]).trim());
    if (missing) {
      addToast('Required field missing', `Please fill in: ${missing.label}`, 'alert');
      return;
    }

    setLoading(true);
    addToast('Analyzing inputs', 'Generating AI strategy based on your theme...', 'info');
    try {
      const payload = { ...basicDetails };
      const draft = await api.campaigns.createDraft(businessId, payload);
      setDraftId(draft.id);
      const strategy = await api.campaigns.generateDraftStrategy(businessId, draft.id);
      setGeneratedStrategy(strategy);
      setStep(2);
      addToast('AI Strategy Generated', 'Review estimated ROAS, target specs, and visual prompts.', 'success');
    } catch (err: any) {
      addToast('Strategy Build Failed', err.message, 'alert');
    } finally {
      setLoading(false);
    }
  };

  const handleProceedToLibrary = () => {
    onDraftGenerated(draftId, generatedStrategy);
  };

  return (
    <div style={{ padding: '40px 8%', display: 'flex', flexDirection: 'column', gap: 32 }}>

      {/* Page Header */}
      <div>
        <h1 style={{ fontSize: '2.2rem', fontFamily: 'var(--font-display)', marginBottom: 8 }}>AI Campaign Generator</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>Describe your target audience and get high-converting strategies in seconds.</p>
      </div>

      {/* Step Indicators */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        {['1. Business Context & Theme', '2. AI Strategy Summary'].map((title, idx) => (
          <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              height: 4,
              borderRadius: 2,
              background: step > idx ? 'var(--color-primary)' : 'rgba(255,255,255,0.06)',
              transition: 'background 0.3s'
            }}></div>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: step === idx + 1 ? 'var(--color-text-main)' : 'var(--color-text-muted)' }}>
              {title}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Form */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: 40, maxWidth: 680, margin: '0 auto', width: '100%' }}>
          <form onSubmit={handleStep1Submit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <h3 style={{ fontSize: '1.4rem', borderBottom: '1px solid var(--color-border)', paddingBottom: 16 }}>Basic Campaign details</h3>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Campaign Name</label>
              <input
                className="form-input"
                placeholder="e.g. Summer Linen Organic Launch"
                value={basicDetails.name}
                onChange={e => setBasicDetails({ ...basicDetails, name: e.target.value })}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Objective <span style={{ color: '#f87171' }}>*</span></label>
                <select
                  className="form-input"
                  value={basicDetails.objective}
                  onChange={e => setBasicDetails({ ...basicDetails, objective: e.target.value })}
                  style={{ background: 'rgba(15,23,42,0.1)' }}
                  required
                >
                  <option value="CONVERSIONS">Conversions (Sales)</option>
                  <option value="LEAD_GEN">Lead Generation</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Daily Budget (₹)</label>
                <input
                  className="form-input"
                  type="number"
                  value={basicDetails.dailyBudget}
                  onChange={e => setBasicDetails({ ...basicDetails, dailyBudget: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Business Name</label>
                <input
                  className="form-input"
                  placeholder="Omni Retail Inc."
                  value={basicDetails.businessName}
                  onChange={e => setBasicDetails({ ...basicDetails, businessName: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                  Website URL <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://omni-retail.com"
                  value={basicDetails.website}
                  onChange={e => setBasicDetails({ ...basicDetails, website: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Industry</label>
                <input
                  className="form-input"
                  placeholder="D2C Sustainable Fashion"
                  value={basicDetails.industry}
                  onChange={e => setBasicDetails({ ...basicDetails, industry: e.target.value })}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Festival / Event Theme <span style={{ color: '#f87171' }}>*</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. Diwali, Black Friday, Christmas"
                  value={basicDetails.festivalTheme}
                  onChange={e => setBasicDetails({ ...basicDetails, festivalTheme: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Target Country</label>
                <input
                  className="form-input"
                  placeholder="United States"
                  value={basicDetails.targetCountry}
                  onChange={e => setBasicDetails({ ...basicDetails, targetCountry: e.target.value })}
                  required
                />
              </div>
            </div>

            <button className="btn-primary" type="submit" style={{ justifyContent: 'center', marginTop: 10 }} disabled={loading}>
              {loading ? <Cpu className="animate-spin" size={16} /> : <ChevronRight size={16} />}
              {loading ? ' Generating AI Strategy...' : ' Generate Strategy'}
            </button>
          </form>
        </div>
      )}

      {/* Step 2: Strategy Review Dashboard */}
      {step === 2 && generatedStrategy && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* Estimated Metrics cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>EXPECTED ROAS</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-accent)' }}>{generatedStrategy.expectedROAS}x</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Estimated return conversion</span>
            </div>
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>EXPECTED CTR</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary)' }}>{generatedStrategy.expectedCTR}%</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Benchmark: 1.2% in category</span>
            </div>
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>EXPECTED CPC</span>
              <span style={{ fontSize: '2rem', fontWeight: 800 }}>₹{generatedStrategy.expectedCPC}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Refined target parameters</span>
            </div>
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>HEALTH PREDICTION</span>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-secondary)' }}>{generatedStrategy.campaignHealthPrediction}%</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Daily optimization sync</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 24 }}>

            {/* Left panels: Copy Deck & Strategy Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              <div className="glass-panel" style={{ padding: 28 }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Award size={18} style={{ color: 'var(--color-primary)' }} /> Marketing Strategy Summary
                </h3>
                <p style={{ color: 'var(--color-text-main)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: 20 }}>
                  {generatedStrategy.marketingStrategySummary}
                </p>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, border: '1px solid var(--color-border)', fontSize: '0.85rem' }}>
                  <strong>Creative guidelines recommendation:</strong> {generatedStrategy.creativeIdeas}
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 28 }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: 20 }}>Generated Copy Deck (Variations)</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>TOP PERFORMANCE HEADLINES (10)</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {generatedStrategy.headlines?.map((h: string, idx: number) => (
                        <div key={idx} style={{ display: 'flex', gap: 10, fontSize: '0.85rem', background: 'rgba(255,255,255,0.01)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
                          <span style={{ color: 'var(--color-primary)' }}>{idx + 1}.</span> {h}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>TOP PRIMARY TEXTS (10)</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {generatedStrategy.primaryTexts?.map((t: string, idx: number) => (
                        <div key={idx} style={{ display: 'flex', gap: 10, fontSize: '0.85rem', background: 'rgba(255,255,255,0.01)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--color-border)', lineHeight: 1.4 }}>
                          <span style={{ color: 'var(--color-primary)' }}>{idx + 1}.</span> {t}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>AI GENERATED VISUAL IDEAS</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {generatedStrategy.imagePrompts?.map((prompt: string, idx: number) => (
                        <div key={idx} style={{
                          display: 'flex', flexDirection: 'column', gap: 10,
                          background: 'rgba(0,0,0,0.2)', padding: '12px',
                          borderRadius: 12, border: '1px solid var(--color-border)'
                        }}>
                          <div style={{
                            width: '100%', height: 140, borderRadius: 8,
                            background: `linear-gradient(45deg, var(--color-primary), var(--color-secondary))`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontWeight: 600, fontSize: '0.9rem', textAlign: 'center', padding: 20
                          }}>
                            {/* Mock generated image using css gradient */}
                            <span style={{ opacity: 0.8 }}>[ AI Visual Variant {idx + 1} ]</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                            <strong>Midjourney Prompt:</strong> {prompt}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>

            </div>

            {/* Right panels: Targeting specs & Placements */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Zap size={16} style={{ color: 'var(--color-secondary)' }} /> Targeting Specifications
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '0.85rem' }}>
                  <div>
                    <strong>Audience:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.audience}</div>
                  </div>
                  <div>
                    <strong>Interest Tags:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.interestTargeting}</div>
                  </div>
                  <div>
                    <strong>Behaviors:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.behaviors}</div>
                  </div>
                  <div>
                    <strong>Lookalike Segment Suggestion:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.lookalikeSuggestions}</div>
                  </div>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BarChart2 size={16} style={{ color: 'var(--color-primary)' }} /> Placements & Bidding
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '0.85rem' }}>
                  <div>
                    <strong>Placements:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.placements}</div>
                  </div>
                  <div>
                    <strong>Optimization Goal:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.optimizationGoal}</div>
                  </div>
                  <div>
                    <strong>Budget Recommendation:</strong>
                    <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>{generatedStrategy.budgetRecommendation}</div>
                  </div>
                </div>
              </div>

              {/* Meta Ads Posting Options Card */}
              <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, border: '1px solid var(--color-primary-light)', marginBottom: 20 }}>
                <h3 style={{ fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Send size={18} style={{ color: 'var(--color-primary)' }} /> Meta Ads Posting Plans
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  Publish your generated visual copies and scheduling strategies using our standard posting tier budgets.
                </p>
                <button
                  className="btn-primary"
                  style={{ padding: '12px 20px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', justifyContent: 'center' }}
                  onClick={() => setIsPostingModalOpen(true)}
                >
                  Select Posting Plan & Budget
                </button>
              </div>

              {/* Action Button */}
              <button
                className="btn-primary"
                style={{ padding: 16, justifyContent: 'center', fontSize: '1rem', width: '100%' }}
                onClick={handleProceedToLibrary}
              >
                Proceed to Creative Library & Previews <ChevronRight size={16} />
              </button>

            </div>

          </div>

        </div>
      )}


      {/* POSTING PLANS MODAL POPUP */}
      {isPostingModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ background: '#0b1329', border: '1px solid #1e293b', borderRadius: '24px', width: '100%', maxWidth: '1100px', maxHeight: '90vh', overflowY: 'auto', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', color: '#ffffff', display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative' }}>

            {/* Close Button */}
            <button
              onClick={() => setIsPostingModalOpen(false)}
              style={{ position: 'absolute', top: '24px', right: '24px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '50%' }}
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 8px 0', background: 'linear-gradient(135deg, #a5b4fc, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Select Posting & Meta Ad Plan
              </h2>
              <p style={{ fontSize: '0.9rem', color: '#94a3b8', margin: 0 }}>
                Launch your campaigns directly on Facebook & Instagram with structured budget pacing plans.
              </p>
            </div>

            {/* Tiles Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginTop: '12px' }}>

              {/* Tile 1: Basic */}
              <div style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid #334155', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#818cf8', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Free Plan</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 12px 0' }}>Basic (Free 7 days trial)</h3>
                  <div style={{ fontSize: '1.75rem', fontWeight: '900', margin: '16px 0' }}>Free</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem', color: '#cbd5e1', flex: 1 }}>
                  <div>✓ 3 post (2 standard, 1 carrousal) / week</div>
                  <div>✓ graphics regenaration 3 times</div>
                  <div>✓ No Ad campaign</div>
                  <div>✓ Experience the next generation Marketing</div>
                </div>
                <button
                  onClick={() => { addToast('Trial Activated', 'Your 7-day basic posting trial has been successfully registered.', 'success'); setIsPostingModalOpen(false); }}
                  style={{ width: '100%', padding: '10px', background: '#334155', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Start Free Trial
                </button>
              </div>

              {/* Tile 2: Advance */}
              <div style={{ background: 'rgba(99, 102, 241, 0.05)', border: '2px solid #6366f1', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative', boxShadow: '0 0 20px rgba(99, 102, 241, 0.1)' }}>
                <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', background: '#6366f1', color: '#ffffff', fontSize: '0.65rem', fontWeight: 'bold', padding: '4px 12px', borderRadius: '9999px', textTransform: 'uppercase' }}>
                  Popular Choice
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#818cf8', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Pro Campaign</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 12px 0' }}>Advance</h3>
                  <div style={{ fontSize: '1.75rem', fontWeight: '900', margin: '16px 0', color: '#a5b4fc' }}>₹5,000</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem', color: '#cbd5e1', flex: 1 }}>
                  <div>✓ 3 post (2 standard, 1 carrousal) / week</div>
                  <div>✓ graphics regenaration 3 times</div>
                  <div>✓ 15 days Ad campaign</div>
                  <div>✓ 24X7 support</div>
                  <div>✓ Visible growth in sales in 1 week</div>
                </div>
                <button
                  onClick={() => handlePlanPurchase('PRO', 'Advance')}
                  disabled={paymentPlan !== null}
                  style={{ width: '100%', padding: '10px', background: '#6366f1', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem', cursor: paymentPlan ? 'wait' : 'pointer', opacity: paymentPlan && paymentPlan !== 'PRO' ? 0.6 : 1 }}
                >
                  {paymentPlan === 'PRO' ? 'Preparing checkout…' : 'Choose Advance (₹5,000)'}
                </button>
              </div>

              {/* Tile 3: Premium */}
              <div style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid #334155', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#818cf8', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Enterprise Scale</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 12px 0' }}>Premium</h3>
                  <div style={{ fontSize: '1.75rem', fontWeight: '900', margin: '16px 0' }}>₹10,000</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem', color: '#cbd5e1', flex: 1 }}>
                  <div>✓ 5 post (2 standard, 1 carrousal) / week</div>
                  <div>✓ graphics regenaration 3 times</div>
                  <div>✓ 30 days Ad campaign</div>
                  <div>✓ 24X7 support</div>
                  <div>✓ Visible growth in sales in 1 week</div>
                </div>
                <button
                  onClick={() => handlePlanPurchase('ENTERPRISE', 'Premium')}
                  disabled={paymentPlan !== null}
                  style={{ width: '100%', padding: '10px', background: '#4f46e5', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem', cursor: paymentPlan ? 'wait' : 'pointer', opacity: paymentPlan && paymentPlan !== 'ENTERPRISE' ? 0.6 : 1 }}
                >
                  {paymentPlan === 'ENTERPRISE' ? 'Preparing checkout…' : 'Choose Premium (₹10,000)'}
                </button>
              </div>

              {/* Tile 4: Customized */}
              <div style={{ background: 'rgba(30, 41, 59, 0.4)', border: '1px solid #334155', borderRadius: '16px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#818cf8', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Flexible Budget</span>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 12px 0' }}>Customized</h3>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '16px 0', color: '#94a3b8' }}>Contact us</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem', color: '#cbd5e1', flex: 1 }}>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    want to create a customized plan as per your budget then please contact us
                  </p>
                </div>
                <button
                  onClick={() => { addToast('Request Submitted', 'Our customization team will reach out to you shortly.', 'success'); setIsPostingModalOpen(false); }}
                  style={{ width: '100%', padding: '10px', background: '#22c55e', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}
                >
                  Contact Us
                </button>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  );
}

