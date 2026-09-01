import React, { useState } from 'react';
import { Tag, IndianRupee, Globe, Check, Palette, MapPin, Search, Link2, AtSign, Building2, Plus, Lightbulb } from 'lucide-react';

interface SmartInputControlsProps {
  currentField: string;
  value: string;
  onSelectOption: (optionText: string) => void;
}

/* ────────────────────────────────────────────────────────────────
   Comma-separated value helpers.

   Answers are stored as one comma-separated string. These helpers
   treat that string as a list of tokens so multi-select toggling is
   exact — the previous `value.includes(x)` substring test could match
   a fragment of an unrelated answer.
   ──────────────────────────────────────────────────────────────── */
const csvList = (v: string): string[] =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean);

const csvHas = (v: string, item: string): boolean =>
  csvList(v).some((x) => x.toLowerCase() === item.toLowerCase());

const csvToggle = (v: string, item: string): string => {
  const list = csvList(v);
  const i = list.findIndex((x) => x.toLowerCase() === item.toLowerCase());
  if (i >= 0) list.splice(i, 1);
  else list.push(item);
  return list.join(', ');
};

const csvAdd = (v: string, item: string): string => {
  if (!item.trim()) return v;
  if (csvHas(v, item)) return v;
  return [...csvList(v), item.trim()].join(', ');
};

/** Reads a `Label: value` token out of the answer. */
const getLabeled = (v: string, label: string): string => {
  const hit = csvList(v).find((x) => x.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  return hit ? hit.slice(label.length + 1).trim() : '';
};

/** Sets (replacing any existing) a `Label: value` token in the answer. */
const setLabeled = (v: string, label: string, val: string): string => {
  const list = csvList(v).filter((x) => !x.toLowerCase().startsWith(`${label.toLowerCase()}:`));
  list.push(`${label}: ${val}`);
  return list.join(', ');
};

/* ────────────────────────────────────────────────────────────────
   Shared styling
   ──────────────────────────────────────────────────────────────── */
const chipStyle = (isSelected: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 20,
  fontSize: '0.8rem',
  border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
  background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
  color: isSelected ? '#818cf8' : 'var(--color-text)',
  cursor: 'pointer',
  transition: 'all 0.2s',
});

const hintStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--color-text-muted)',
  marginBottom: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const miniInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--color-text)',
  fontSize: '0.82rem',
  outline: 'none',
};

/**
 * Multi-select chip row. Clicking a chip adds it to the answer;
 * clicking again removes it. Users can pick as many as they like.
 */
const ChipMulti: React.FC<{
  label: React.ReactNode;
  options: string[];
  value: string;
  onSelectOption: (v: string) => void;
}> = ({ label, options, value, onSelectOption }) => (
  <div style={{ marginTop: 12 }}>
    <div style={hintStyle}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const isSelected = csvHas(value, opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelectOption(csvToggle(value, opt))}
            style={chipStyle(isSelected)}
          >
            {isSelected ? <Check size={12} style={{ display: 'inline', marginRight: 4 }} /> : '+ '}
            {opt}
          </button>
        );
      })}
    </div>
  </div>
);

/** Single-choice chip row, for answers where only one value is meaningful. */
const ChipSingle: React.FC<{
  label: React.ReactNode;
  options: string[];
  value: string;
  onSelectOption: (v: string) => void;
}> = ({ label, options, value, onSelectOption }) => (
  <div style={{ marginTop: 12 }}>
    <div style={hintStyle}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const isSelected = (value || '').trim().toLowerCase() === opt.toLowerCase();
        return (
          <button key={opt} type="button" onClick={() => onSelectOption(opt)} style={chipStyle(isSelected)}>
            {opt}
          </button>
        );
      })}
    </div>
  </div>
);

/* ────────────────────────────────────────────────────────────────
   Option data
   ──────────────────────────────────────────────────────────────── */
const BUSINESS_CATEGORIES = [
  'E-commerce & Retail', 'SaaS & Software', 'Restaurant & Food', 'Fashion & Apparel',
  'Healthcare & Wellness', 'Education & EdTech', 'Real Estate & Property', 'Fitness & Gym',
  'Beauty & Cosmetics', 'Finance & Insurance', 'Digital Marketing Agency', 'Agency & Services',
  'Local Small Business', 'Travel & Hospitality', 'Automotive', 'Event Management',
  'Interior Design & Architecture', 'Legal Services', 'Logistics & Delivery', 'Manufacturing',
];

// 55+ replaced with 55-65+, and the "All Age Groups" catch-all removed.
const AGE_GROUPS = ['18-24 (Gen Z)', '25-34 (Millennials)', '35-44', '45-54', '55-65+'];

const GENDERS = ['Both / All Genders', 'Female', 'Male'];

const BUSINESS_GOALS = [
  'Increase Direct Sales', 'Generate Qualified Leads', 'Build Brand Awareness',
  'Drive Website Traffic', 'Boost Social Media Followers', 'Promote New Product Launch',
  'Improve Customer Retention', 'Grow Local Footfall',
];

const BUDGET_PRESETS = ['₹10,000/month', '₹25,000/month', '₹50,000/month', '₹1,00,000/month', '₹2,50,000/month'];

const BRAND_TONES = [
  'Professional & Corporate', 'Casual & Friendly', 'Bold & Energetic',
  'Luxury & Premium', 'Fun & Playful', 'Empathetic & Warm',
  'Minimal & Clean', 'Witty & Conversational',
];

const POSTING_FREQUENCIES = [
  'Daily (7 posts / week)', '5 times / week', '3 times / week (Recommended)', 'Weekly (1 post / week)',
];

const LANGUAGES = [
  'English', 'Hindi', 'Hinglish', 'Bengali', 'Marathi', 'Telugu',
  'Tamil', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Spanish',
];

const USP_SUGGESTIONS = [
  'Best Quality & Exceptional 24/7 Support',
  'Most Affordable Price Guarantee',
  'Fast Same-Day Delivery / Delivery Guarantee',
  '100% Organic, Natural & Sustainable',
  'Customized & Personalized Solutions',
  'Award-Winning & Certified Team',
  'Free Trial / Money-Back Guarantee',
  'Made in India / Locally Sourced',
  'Industry Expertise of 10+ Years',
  'End-to-End Service Under One Roof',
];

const AUDIENCE_PRESETS = [
  'Women aged 20-40 interested in fashion & beauty',
  'Young Professionals & College Students (18-30)',
  'Small Business Owners & Entrepreneurs',
  'Fitness Enthusiasts & Health Conscious Individuals',
  'Parents with young children & families',
  'Tech-savvy consumers & digital buyers',
  'Senior citizens & retirees',
  'Corporate / B2B decision makers',
];

const PRODUCT_PRESETS = [
  'Apparel, Handbags & Fashion Accessories',
  'Skincare, Serums & Beauty Care Products',
  'Organic Food, Snacks & Healthy Beverages',
  'Digital Software, SaaS Apps & Automation Tools',
  'Consulting, Marketing & Design Services',
  'Home Decor & Furniture',
  'Health Supplements & Wellness Products',
  'Courses, Coaching & Training Programs',
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi (NCT)', 'Jammu & Kashmir', 'Ladakh',
  'Puducherry', 'Chandigarh', 'Andaman & Nicobar Islands',
];

const MAJOR_CITIES = [
  'Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad',
  'Jaipur', 'Surat', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Bhopal', 'Patna',
  'Chandigarh', 'Coimbatore', 'Kochi', 'Visakhapatnam', 'Vadodara', 'Ludhiana', 'Agra', 'Nashik',
];

const COMPETITOR_TYPES = [
  'Top Online E-commerce Brands in Market',
  'Local Market Leaders & Boutiques',
  'Established International Competitors',
  'Direct D2C Brand Competitors',
];

/**
 * Typing suggestions per field. Used by TypeAheadSuggestions to offer
 * autocomplete while the user types free text.
 */
export const FIELD_SUGGESTIONS: Record<string, string[]> = {
  businessCategory: BUSINESS_CATEGORIES,
  productsServices: PRODUCT_PRESETS,
  targetAudience: AUDIENCE_PRESETS,
  customerAgeGroup: AGE_GROUPS,
  genderTarget: GENDERS,
  location: [...MAJOR_CITIES, ...INDIAN_STATES],
  businessGoals: BUSINESS_GOALS,
  monthlyBudget: BUDGET_PRESETS,
  competitors: COMPETITOR_TYPES,
  brandTone: BRAND_TONES,
  postingFrequency: POSTING_FREQUENCIES,
  languages: LANGUAGES,
  businessUSP: USP_SUGGESTIONS,
};

/**
 * Autocomplete dropdown shown while the user types.
 *
 * Matches against the text after the last comma, so it keeps working
 * once several options have already been added to the answer.
 */
export const TypeAheadSuggestions: React.FC<SmartInputControlsProps> = ({
  currentField,
  value,
  onSelectOption,
}) => {
  const pool = FIELD_SUGGESTIONS[currentField];
  if (!pool || !pool.length) return null;

  const parts = (value || '').split(',');
  const typed = (parts[parts.length - 1] || '').trim();
  if (typed.length < 2) return null;

  const matches = pool
    .filter((opt) => opt.toLowerCase().includes(typed.toLowerCase()))
    .filter((opt) => !csvHas(value, opt))
    .slice(0, 6);

  if (!matches.length) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={hintStyle}>
        <Lightbulb size={12} /> Suggestions as you type:
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {matches.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => {
              // Replace the partial word being typed with the full suggestion.
              const head = parts.slice(0, -1).map((s) => s.trim()).filter(Boolean);
              onSelectOption([...head, opt].join(', '));
            }}
            style={{ ...chipStyle(false), borderStyle: 'dashed' }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
   Q7 — Location. Local area (via PIN code), City, or State only.
   ──────────────────────────────────────────────────────────────── */
type LocationMode = 'local' | 'city' | 'state';

const LocationPicker: React.FC<{ value: string; onSelectOption: (v: string) => void }> = ({
  value,
  onSelectOption,
}) => {
  const [mode, setMode] = useState<LocationMode>('local');
  const [pin, setPin] = useState('');
  const [pinAreas, setPinAreas] = useState<string[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const lookupPin = async (code: string) => {
    setPinError(null);
    setPinAreas([]);
    if (!/^\d{6}$/.test(code)) {
      setPinError('Enter a valid 6-digit PIN code.');
      return;
    }
    setPinLoading(true);
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${code}`);
      const data = await res.json();
      // The API returns an array wrapping a single result object, but tolerate
      // a bare object too rather than failing on a shape change.
      const entry = Array.isArray(data) ? data[0] : data;
      if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) {
        setPinError('No location found for that PIN code.');
        return;
      }
      const offices: any[] = entry.PostOffice;
      const district = offices[0]?.District;
      const state = offices[0]?.State;
      // Areas served by this PIN, plus its district and state as broader options.
      const areas = Array.from(
        new Set<string>([
          ...offices.map((o) => `${o.Name}, ${o.District}`),
          ...(district ? [`${district} (District)`] : []),
          ...(state ? [`${state} (State)`] : []),
        ]),
      );
      setPinAreas(areas);
    } catch {
      setPinError('Could not reach the PIN code service. Check your connection.');
    } finally {
      setPinLoading(false);
    }
  };

  const modes: { key: LocationMode; label: string }[] = [
    { key: 'local', label: 'Local Area' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <div style={hintStyle}>
        <Globe size={12} /> Which area do you serve?
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {modes.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: '0.85rem',
              border: mode === m.key ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: mode === m.key ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              color: mode === m.key ? '#818cf8' : 'var(--color-text)',
              fontWeight: mode === m.key ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'local' && (
        <div>
          <div style={hintStyle}>
            <MapPin size={12} /> Enter your PIN code to find nearby areas:
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 360 }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="e.g. 110001"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  lookupPin(pin);
                }
              }}
              style={miniInputStyle}
            />
            <button
              type="button"
              onClick={() => lookupPin(pin)}
              disabled={pinLoading}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: '0.82rem',
                border: '1px solid var(--color-primary)',
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#818cf8',
                cursor: pinLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Search size={12} /> {pinLoading ? 'Finding…' : 'Find'}
            </button>
          </div>

          {pinError && (
            <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginBottom: 8 }}>{pinError}</div>
          )}

          {pinAreas.length > 0 && (
            <ChipMulti
              label={<><MapPin size={12} /> Areas for {pin} — select all you serve:</>}
              options={pinAreas}
              value={value}
              onSelectOption={onSelectOption}
            />
          )}
        </div>
      )}

      {mode === 'city' && (
        <ChipMulti
          label={<><Building2 size={12} /> Select cities you serve:</>}
          options={MAJOR_CITIES}
          value={value}
          onSelectOption={onSelectOption}
        />
      )}

      {mode === 'state' && (
        <ChipMulti
          label={<><Globe size={12} /> Select states you serve:</>}
          options={INDIAN_STATES}
          value={value}
          onSelectOption={onSelectOption}
        />
      )}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
   Q10 — Competitors. Name, social media, or website.
   ──────────────────────────────────────────────────────────────── */
const CompetitorInput: React.FC<{ value: string; onSelectOption: (v: string) => void }> = ({
  value,
  onSelectOption,
}) => {
  const [name, setName] = useState('');
  const [social, setSocial] = useState('');
  const [site, setSite] = useState('');

  const rows: {
    key: string;
    icon: React.ReactNode;
    placeholder: string;
    val: string;
    set: (v: string) => void;
  }[] = [
    {
      key: 'name',
      icon: <Building2 size={12} />,
      placeholder: 'Competitor name — e.g. Nykaa',
      val: name,
      set: setName,
    },
    {
      key: 'social',
      icon: <AtSign size={12} />,
      placeholder: 'Social media — e.g. @nykaa or instagram.com/nykaa',
      val: social,
      set: setSocial,
    },
    {
      key: 'site',
      icon: <Link2 size={12} />,
      placeholder: 'Website — e.g. nykaa.com',
      val: site,
      set: setSite,
    },
  ];

  const add = (row: { val: string; set: (v: string) => void }) => {
    const formatted = row.val.trim();
    if (!formatted) return;
    onSelectOption(csvAdd(value, formatted));
    row.set('');
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={hintStyle}>
        <Tag size={12} /> Add competitors by name, social media, or website:
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
        {rows.map((row) => (
          <div key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--color-text-muted)', display: 'flex' }}>{row.icon}</span>
            <input
              type="text"
              placeholder={row.placeholder}
              value={row.val}
              onChange={(e) => row.set(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(row);
                }
              }}
              style={miniInputStyle}
            />
            <button
              type="button"
              onClick={() => add(row)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '0.8rem',
                border: '1px solid var(--color-border)',
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        ))}
      </div>

      <ChipMulti
        label="Or pick a competitor type:"
        options={COMPETITOR_TYPES}
        value={value}
        onSelectOption={onSelectOption}
      />
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
   Q11 — Brand tone + two colour pickers.
   ──────────────────────────────────────────────────────────────── */
const PRIMARY_LABEL = 'Brand Primary Color';
const SELECTED_LABEL = 'Select Color';

const BrandToneInput: React.FC<{ value: string; onSelectOption: (v: string) => void }> = ({
  value,
  onSelectOption,
}) => {
  const primary = getLabeled(value, PRIMARY_LABEL) || '#4F46E5';
  const secondary = getLabeled(value, SELECTED_LABEL) || '#0D9488';

  const pickers: { label: string; current: string }[] = [
    { label: PRIMARY_LABEL, current: primary },
    { label: SELECTED_LABEL, current: secondary },
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <ChipMulti label="Select Brand Tone:" options={BRAND_TONES} value={value} onSelectOption={onSelectOption} />

      <div style={{ ...hintStyle, marginTop: 14 }}>
        <Palette size={12} /> Pick your brand colours:
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {pickers.map((p) => {
          const isSet = !!getLabeled(value, p.label);
          return (
            <label
              key={p.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 10,
                border: isSet ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                background: isSet ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255,255,255,0.05)',
                cursor: 'pointer',
              }}
            >
              <input
                type="color"
                value={p.current}
                onChange={(e) => onSelectOption(setLabeled(value, p.label, e.target.value.toUpperCase()))}
                style={{
                  width: 36,
                  height: 36,
                  padding: 0,
                  border: 'none',
                  borderRadius: 8,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text)', fontWeight: 600 }}>{p.label}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                  {isSet ? p.current : 'not set — drag to choose'}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
   Main switch
   ──────────────────────────────────────────────────────────────── */
export const SmartInputControls: React.FC<SmartInputControlsProps> = ({
  currentField,
  value,
  onSelectOption,
}) => {
  switch (currentField) {
    case 'businessCategory':
      return (
        <ChipMulti
          label={<><Tag size={12} /> Suggested Categories (select one or more):</>}
          options={BUSINESS_CATEGORIES}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'productsServices':
      return (
        <ChipMulti
          label="Popular Product / Service Categories (select one or more):"
          options={PRODUCT_PRESETS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'targetAudience':
      return (
        <ChipMulti
          label={<><Tag size={12} /> Suggested Target Audiences (select one or more):</>}
          options={AUDIENCE_PRESETS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'customerAgeGroup':
      return (
        <ChipMulti
          label="Select Target Age Range (select one or more):"
          options={AGE_GROUPS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    // A single primary gender target is what the ad platforms take.
    case 'genderTarget':
      return <ChipSingle label="Select Primary Target Gender:" options={GENDERS} value={value} onSelectOption={onSelectOption} />;

    case 'location':
      return <LocationPicker value={value} onSelectOption={onSelectOption} />;

    case 'businessGoals':
      return (
        <ChipMulti
          label="Select Primary Business Goals (select one or more):"
          options={BUSINESS_GOALS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    // A budget is a single figure — multi-select would produce ambiguous input.
    case 'monthlyBudget':
      return (
        <ChipSingle
          label={<><IndianRupee size={12} /> Recommended Monthly Budget Presets:</>}
          options={BUDGET_PRESETS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'competitors':
      return <CompetitorInput value={value} onSelectOption={onSelectOption} />;

    case 'brandTone':
      return <BrandToneInput value={value} onSelectOption={onSelectOption} />;

    // One cadence per schedule.
    case 'postingFrequency':
      return (
        <ChipSingle
          label="Select Preferred Posting Frequency:"
          options={POSTING_FREQUENCIES}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'languages':
      return (
        <ChipMulti
          label="Select Preferred Marketing Languages (select one or more):"
          options={LANGUAGES}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    case 'businessUSP':
      return (
        <ChipMulti
          label="Common USP Idea Tags (select one or more):"
          options={USP_SUGGESTIONS}
          value={value}
          onSelectOption={onSelectOption}
        />
      );

    default:
      return null;
  }
};
