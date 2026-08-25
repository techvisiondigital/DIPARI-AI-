export interface PlanPricing {
  amount: number;
  currency: string;
  description: string;
  name: string;
  allowAdCampaigns: boolean;
  postsPerWeek: number;
  graphicsRegenLimit: number;
  maxAdDays: number;
}

export const PLAN_PRICING_MAP: Record<string, PlanPricing> = {
  FREE: {
    name: 'FREE',
    amount: 0,
    currency: 'INR',
    description: 'Visionpilot AI Basic Free 7 Days Trial',
    allowAdCampaigns: false, // "No Ad campaign" on Free plan
    postsPerWeek: 3,        // "3 post (2 standard, 1 carousel) / week"
    graphicsRegenLimit: 3,  // "graphics regeneration 3 times"
    maxAdDays: 0,
  },
  BASIC: {
    name: 'FREE',
    amount: 0,
    currency: 'INR',
    description: 'Visionpilot AI Basic Free 7 Days Trial',
    allowAdCampaigns: false,
    postsPerWeek: 3,
    graphicsRegenLimit: 3,
    maxAdDays: 0,
  },
  DEMO_TEST: {
    name: 'DEMO_TEST',
    amount: 1.00,
    currency: 'INR',
    description: 'Visionpilot AI Demo Test Plan - ₹1 Checkout',
    allowAdCampaigns: true,
    postsPerWeek: 7,
    graphicsRegenLimit: 5,
    maxAdDays: 15,
  },
  DEMO_1INR: {
    name: 'DEMO_1INR',
    amount: 1.00,
    currency: 'INR',
    description: 'Visionpilot AI Demo Test Plan - ₹1 Checkout',
    allowAdCampaigns: true,
    postsPerWeek: 7,
    graphicsRegenLimit: 5,
    maxAdDays: 15,
  },
  STARTER: {
    name: 'STARTER',
    amount: 1499.00,
    currency: 'INR',
    description: 'Visionpilot AI Starter Plan',
    allowAdCampaigns: false,
    postsPerWeek: 3,
    graphicsRegenLimit: 3,
    maxAdDays: 0,
  },
  ADVANCE: {
    name: 'ADVANCE',
    amount: 5000.00,
    currency: 'INR',
    description: 'Visionpilot AI Advance Plan',
    allowAdCampaigns: true,  // "15 days Ad campaign"
    postsPerWeek: 3,         // "3 post (2 standard, 1 carrousal) / week"
    graphicsRegenLimit: 3,   // "graphics regeneration 3 times"
    maxAdDays: 15,
  },
  PRO: {
    name: 'ADVANCE',
    amount: 5000.00,
    currency: 'INR',
    description: 'Visionpilot AI Advance Plan',
    allowAdCampaigns: true,
    postsPerWeek: 3,
    graphicsRegenLimit: 3,
    maxAdDays: 15,
  },
  PREMIUM: {
    name: 'PREMIUM',
    amount: 10000.00,
    currency: 'INR',
    description: 'Visionpilot AI Premium Plan',
    allowAdCampaigns: true,  // "30 days Ad campaign"
    postsPerWeek: 5,         // "5 post (2 standard, 1 carrousal) / week"
    graphicsRegenLimit: 3,   // "graphics regeneration 3 times"
    maxAdDays: 30,
  },
  ENTERPRISE: {
    name: 'PREMIUM',
    amount: 10000.00,
    currency: 'INR',
    description: 'Visionpilot AI Premium Plan',
    allowAdCampaigns: true,
    postsPerWeek: 5,
    graphicsRegenLimit: 3,
    maxAdDays: 30,
  },
};

export function getPlanLimits(planName?: string): PlanPricing {
  const normalized = (planName || 'FREE').trim().toUpperCase();
  return PLAN_PRICING_MAP[normalized] || PLAN_PRICING_MAP.FREE;
}

export function getPlanPricing(planName: string): PlanPricing {
  const normalized = (planName || '').trim().toUpperCase();
  const pricing = PLAN_PRICING_MAP[normalized];
  if (!pricing) {
    throw new Error(`Invalid subscription plan: '${planName}'. Allowed plans: DEMO_TEST, DEMO_1INR, ADVANCE, PRO, PREMIUM, ENTERPRISE, FREE`);
  }
  return pricing;
}
