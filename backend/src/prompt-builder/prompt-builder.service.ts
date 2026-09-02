import { Injectable, Logger } from '@nestjs/common';
import { BusinessIntelligenceService } from '../business/business-intelligence.service';

/**
 * PromptBuilderService
 *
 * Centralised, reusable prompt engineering for all AI calls in the application.
 * Every service that makes an OpenRouter call must use this service to build
 * its system-prompt context — no duplicated prompt engineering across the codebase.
 *
 * Usage flow:
 *   AnyService → PromptBuilderService → BusinessIntelligenceService.getBusinessContext()
 *              → structured prompt string → OpenRouter
 */
@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  constructor(
    private readonly businessIntelligence: BusinessIntelligenceService,
  ) {}

  // ─── Business Prompt ──────────────────────────────────────────────────────

  /**
   * Builds a structured business-context system prompt string.
   * Consumed by AssistantService, ContentService, and any AI module that needs
   * full business context injected into its system prompt.
   */
  async buildBusinessPrompt(businessId: string): Promise<string> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);

    return `=== CAMPAIGN AI BUSINESS CONTEXT ===
Business Name: ${ctx.businessName}
Category / Industry: ${ctx.businessCategory}
Products / Services: ${ctx.productsServices}
Unique Selling Proposition (USP): ${ctx.businessUSP}

Target Demographic:
- Audience Persona: ${ctx.targetAudience}
- Age Range: ${ctx.customerAgeGroup}
- Gender Target: ${ctx.genderTarget}
- Geographic Location: ${ctx.location}

Marketing Strategy & Positioning:
- Primary Business Goals: ${ctx.businessGoals}
- Monthly Budget: ${ctx.monthlyBudget}
- Key Competitors: ${ctx.competitors}
- Brand Voice & Tone: ${ctx.brandVoice}
- Brand Visual Theme: ${ctx.brandVisualTheme}
- Brand Colors: ${JSON.stringify(ctx.brandColors)}
- Preferred Languages: ${ctx.languages}

AI Blueprint Insights:
- Executive Summary: ${ctx.executiveSummary}
- SWOT Strengths: ${JSON.stringify(ctx.swotAnalysis?.strengths || [])}
- Customer Pain Points: ${JSON.stringify(ctx.customerPainPoints || [])}
- Buying Triggers: ${JSON.stringify(ctx.buyingTriggers || [])}
- Content Pillars: ${JSON.stringify(ctx.contentPillars || [])}
- Recommended Channels: ${JSON.stringify(ctx.recommendedChannels || [])}
======================================`;
  }

  // ─── Content Prompt ───────────────────────────────────────────────────────

  /**
   * Builds a content-generation system prompt using the business context.
   * Used by ContentService for weekly calendar and individual post generation.
   */
  async buildContentPrompt(
    businessId: string,
    options?: { week?: number; totalWeeks?: number; selectedDays?: string[] },
  ): Promise<string> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);

    const weekInfo = options?.week && options?.totalWeeks
      ? `Week ${options.week} of ${options.totalWeeks}`
      : 'Content';

    return `You are an expert social media content strategist for CampaignAI.

${weekInfo} for:
Business: ${ctx.businessName}
Industry: ${ctx.businessCategory}
Products/Services: ${ctx.productsServices}
Target Audience: ${ctx.targetAudience}
Brand Tone: ${ctx.brandVoice}
USP: ${ctx.businessUSP}
Language: ${ctx.languages}
Content Pillars: ${JSON.stringify(ctx.contentPillars)}
Posting Days: ${options?.selectedDays?.join(', ') || 'All weekdays'}

Generate diverse, engaging content that reflects the brand voice and addresses customer pain points.
Return ONLY valid JSON array (no markdown, no code fences).`;
  }

  // ─── Monthly Strategy Prompt ──────────────────────────────────────────────

  /**
   * Builds prompt for generating 4-week themes, objectives, frequency, platforms, and campaign focus.
   */
  async buildMonthlyStrategyPrompt(businessId: string): Promise<{ systemPrompt: string; userPrompt: string }> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);

    const systemPrompt = `You are a Chief Content Strategist for CampaignAI.
Generate a comprehensive 30-day Monthly Content Strategy for the specified business.
Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "monthlyMarketingStrategy": "Clear 3-4 sentence high-level content strategy for the month.",
  "monthlyCampaignFocus": "Core thematic focus of the month (e.g., Brand Authority & Product Trial)",
  "recommendedPostingFrequency": "Recommended frequency (e.g. 5 posts/week, total 20 posts/month)",
  "recommendedPlatforms": ["Instagram", "Facebook", "LinkedIn"],
  "weeklyThemes": [
    {
      "weekNumber": 1,
      "theme": "Week 1 Theme Name",
      "objective": "Week 1 Primary Objective (e.g. Build Awareness & Educate)"
    },
    {
      "weekNumber": 2,
      "theme": "Week 2 Theme Name",
      "objective": "Week 2 Primary Objective (e.g. Highlight USP & Social Proof)"
    },
    {
      "weekNumber": 3,
      "theme": "Week 3 Theme Name",
      "objective": "Week 3 Primary Objective (e.g. Customer Stories & Overcome Objections)"
    },
    {
      "weekNumber": 4,
      "theme": "Week 4 Theme Name",
      "objective": "Week 4 Primary Objective (e.g. Conversions & Promotional Offer)"
    }
  ]
}`;

    const userPrompt = `Business Context:
Name: ${ctx.businessName}
Industry: ${ctx.businessCategory}
Products/Services: ${ctx.productsServices}
Target Audience: ${ctx.targetAudience}
Demographics: Age ${ctx.customerAgeGroup}, ${ctx.genderTarget}, ${ctx.location}
USP: ${ctx.businessUSP}
Brand Tone: ${ctx.brandVoice}
Language: ${ctx.languages}
Content Pillars: ${JSON.stringify(ctx.contentPillars)}
Competitors: ${ctx.competitors}
Goals: ${ctx.businessGoals}`;

    return { systemPrompt, userPrompt };
  }

  // ─── Monthly Calendar Prompt ──────────────────────────────────────────────

  /**
   * Builds prompt for generating a week's posts balancing all required content categories and types.
   */
  async buildMonthlyCalendarPrompt(
    businessId: string,
    strategy: any,
    weekNumber: number,
    selectedDays: string[] = ['Monday', 'Wednesday', 'Friday'],
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);
    const weekTheme = strategy?.weeklyThemes?.find((w: any) => w.weekNumber === weekNumber) || {
      theme: `Week ${weekNumber} Engagement`,
      objective: 'Brand Awareness & Growth',
    };

    const categories = [
      'Educational', 'Promotional', 'Brand Awareness', 'Customer Story',
      'Testimonials', 'Behind the Scenes', 'Industry Tips', 'FAQs', 'Offers',
      'Seasonal Content', 'Festival Content', 'Reels', 'Carousel Ideas'
    ];

    const platforms = strategy?.recommendedPlatforms?.length ? strategy.recommendedPlatforms : ['Instagram', 'Facebook'];

    const systemPrompt = `You are an expert social media content writer for CampaignAI.
Generate exactly 1 post for each of these days: ${selectedDays.join(', ')} for Week ${weekNumber}.

Requirements:
1. Ensure complete balance across content categories: ${categories.join(', ')}.
2. Ensure platforms vary across: ${platforms.join(', ')}.
3. Avoid repetitive headlines, captions, image prompts, hooks, and calls to action. Each post must have a clearly different angle.
4. Language: ${ctx.languages}. If Hinglish, write Hindi using Latin script.
5. Write a complete, catchy, platform-ready caption: a scroll-stopping hook, 2-4 short value-led lines, and one clear CTA. Do not put hashtags inside the caption field.
6. Return 8-12 unique, relevant hashtags for EVERY post. Every hashtag must start with #, be appropriate for this business and post, and must not be a generic repeated list.

Return ONLY a valid JSON array of post objects:
[
  {
    "dayName": "Monday",
    "platform": "Instagram",
    "postType": "Reel | Carousel | Image | Video | Story",
    "category": "Educational | Promotional | Brand Awareness | Customer Story | Testimonials | Behind the Scenes | Industry Tips | FAQs | Offers | Seasonal | Festival",
    "objective": "Lead Generation | Engagement | Brand Recall | Traffic | Direct Sale",
    "headline": "Catchy post title / hook",
    "caption": "Full engaging caption with call-to-action text",
    "cta": "Shop Now | Learn More | Sign Up | Save Post | Comment Below | DM Us",
    "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "graphicPrompt": "Detailed AI image or video generation prompt for Midjourney / DALL-E",
    "bestPostingTime": "10:00 AM | 12:30 PM | 06:00 PM | 08:30 PM"
  }
]`;

    const userPrompt = `Business Context:
Name: ${ctx.businessName}
Industry: ${ctx.businessCategory}
Products/Services: ${ctx.productsServices}
USP: ${ctx.businessUSP}
Brand Tone: ${ctx.brandVoice}
Target Audience: ${ctx.targetAudience}

Week ${weekNumber} Strategy:
Theme: ${weekTheme.theme}
Objective: ${weekTheme.objective}
Monthly Focus: ${strategy?.monthlyCampaignFocus || 'Growth'}`;

    return { systemPrompt, userPrompt };
  }

  // ─── Campaign Prompt ──────────────────────────────────────────────────────

  /**
   * Builds a campaign-generation system prompt using the business context.
   * Used by CampaignsService for AI campaign creation.
   */
  async buildCampaignPrompt(businessId: string): Promise<string> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);

    return `You are an expert Meta Ads campaign strategist for CampaignAI.

Business Intelligence:
Business: ${ctx.businessName}
Industry: ${ctx.businessCategory}
Products/Services: ${ctx.productsServices}
Target Audience: ${ctx.targetAudience}
Age Group: ${ctx.customerAgeGroup}
Gender: ${ctx.genderTarget}
Location: ${ctx.location}
Brand Tone: ${ctx.brandVoice}
USP: ${ctx.businessUSP}
Monthly Budget: ${ctx.monthlyBudget}
Recommended Channels: ${JSON.stringify(ctx.recommendedChannels)}
Campaign Strategy: ${JSON.stringify(ctx.campaignStrategy)}

Generate complete, high-converting Meta Ads campaign configurations.
Return ONLY valid JSON (no markdown, no code fences).`;
  }

  // ─── Assistant Prompt ─────────────────────────────────────────────────────

  /**
   * Builds an assistant system prompt with optional business context injection.
   * Used by AssistantService for the RAG-based help bot.
   */
  async buildAssistantPrompt(businessId?: string): Promise<string> {
    let businessSection = '';

    if (businessId) {
      try {
        businessSection = await this.buildBusinessPrompt(businessId);
      } catch {
        this.logger.warn(`PromptBuilderService: Could not fetch business context for ${businessId}`);
      }
    }

    return businessSection;
  }

  // ─── Image Generation Prompt ──────────────────────────────────────────────

  /**
   * Builds a structured, highly personalized AI image prompt based on complete Business Context.
   * Incorporates business products/services, industry, target audience demographics,
   * brand colors, tone, USP, and post-specific visual concept.
   */
  async buildStructuredImagePrompt(
    businessId: string,
    postDetails?: {
      headline?: string;
      topic?: string;
      category?: string;
      postType?: string;
      objective?: string;
      offer?: string;
      cta?: string;
      graphicPrompt?: string;
      aspect_ratio?: string;
      aspectRatio?: string;
    },
  ): Promise<{ prompt: string; ctx: any }> {
    const ctx = await this.businessIntelligence.getBusinessContext(businessId);

    const headline = postDetails?.headline || postDetails?.topic || ctx.productsServices || 'Special Offer';
    const category = postDetails?.category || 'Promotional';
    const offer = postDetails?.offer || ctx.currentOffer || ctx.businessUSP;
    const catLower = category.toLowerCase();
    const colorsStr = this.formatBrandColorsForPrompt(ctx.brandColors, ctx.brandTone);

    // Build specific visual concept tailored to post and business
    let visualScene = '';
    if (postDetails?.graphicPrompt && postDetails.graphicPrompt.length > 15) {
      visualScene = postDetails.graphicPrompt.replace(/[\r\n]+/g, ' ').trim();
    } else {
      if (catLower.includes('educational') || catLower.includes('tips') || catLower.includes('faq')) {
        visualScene = `Clean informative visual setting showcasing ${ctx.productsServices}, organized arrangement with subtle aesthetic props highlighting key features and expert insights for ${ctx.businessCategory}`;
      } else if (catLower.includes('testimonial') || catLower.includes('customer') || catLower.includes('story')) {
        visualScene = `Authentic happy customer matching ${ctx.targetAudience} (Age ${ctx.customerAgeGroup}, ${ctx.genderTarget}) delightfully experiencing ${ctx.productsServices} in ${ctx.location}`;
      } else if (catLower.includes('behind') || catLower.includes('craft')) {
        visualScene = `Authentic behind-the-scenes artisanal craft setting showing the quality ingredients, precision process, and creation of ${ctx.productsServices} for ${ctx.businessName}`;
      } else if (catLower.includes('festival') || catLower.includes('seasonal')) {
        visualScene = `Festive celebration ambiance with warm atmospheric lighting, festive elements, and ${ctx.productsServices} prominently displayed`;
      } else {
        visualScene = `High-impact commercial advertising hero shot of ${ctx.productsServices} highlighting "${offer}" and USP "${ctx.businessUSP}"`;
      }
    }

    const productStr = (ctx.productsServices || ctx.businessName).substring(0, 180);
    const audienceStr = (ctx.targetAudience || 'customers').substring(0, 60);
    const locStr = (ctx.location || 'modern setting').substring(0, 30);
    const sceneStr = visualScene.substring(0, 280);
    const subjectGuidance = this.getImageSubjectGuidance(ctx.businessCategory, ctx.productsServices);

    // High quality continuous natural language prompt for image generation engines
    const prompt = `Create a highly specific commercial advertising image for ${ctx.businessName}. Business category: ${ctx.businessCategory}. Exact products or services being advertised: ${productStr}. The image must make that offering the unmistakable main subject; do not replace it with a generic business, showroom, model, office, or lifestyle scene. Visual concept: ${sceneStr}. ${subjectGuidance} Target audience: ${audienceStr}. Location context: ${locStr}. Brand style: ${ctx.brandVoice}. Brand colors: ${colorsStr}. Photorealistic professional advertising photography, clear composition, realistic proportions, useful product detail, no readable text, no watermark, no unrelated objects.`;

    this.logger.log(`[PromptBuilderService] Built personalized image prompt for ${ctx.businessName} (${category}): "${prompt.substring(0, 90)}..."`);
    return { prompt, ctx };
  }

  private getImageSubjectGuidance(category: string, productsServices: string): string {
    const businessText = `${category} ${productsServices}`.toLowerCase();

    if (/saas|software|app|platform|ai|automation|digital|technology|tech/.test(businessText)) {
      return 'This is a digital product or service: show the actual software experience, dashboard, workflow, device screen, or people using the described tool. Do not show clothing, fashion models, retail racks, food, drinks, or unrelated physical products.';
    }
    if (/real estate|property|properties|construction|builder|architect/.test(businessText)) {
      return 'Show the exact property or real-estate service: an attractive but realistic property, floor plan, site, or buyer consultation. Do not show clothing, fashion models, retail racks, food, or unrelated products.';
    }
    if (/restaurant|food|cafe|bakery|drink|beverage|bar/.test(businessText)) {
      return 'Show the exact food, dish, drink, or dining experience described by the onboarding answers. Do not show clothing, fashion models, retail racks, software dashboards, or unrelated products.';
    }
    if (/fashion|apparel|clothing|garment|boutique|dress|shirt|jewelry|accessor/.test(businessText)) {
      return 'Show the exact clothing, apparel, accessory, or fashion product described by the onboarding answers. Use a model only when it helps display that exact product; do not turn the image into an empty showroom or generic fashion studio.';
    }
    return 'Show the exact product or service described by the onboarding answers in use or being delivered. Do not invent a different industry or substitute generic stock imagery.';
  }

  private formatBrandColorsForPrompt(colors: any, tone: string): string {
    if (!colors) return 'harmonious brand tones';
    const colorMap: Record<string, string> = {
      '#065F46': 'emerald green',
      '#064E3B': 'forest green',
      '#10B981': 'sage green',
      '#D97706': 'warm gold',
      '#F59E0B': 'golden amber',
      '#1E3A8A': 'navy blue',
      '#3B82F6': 'electric blue',
      '#06B6D4': 'cyan blue',
      '#991B1B': 'crimson red',
      '#F97316': 'warm orange',
      '#18181B': 'sleek dark onyx',
      '#4F46E5': 'indigo violet',
      '#7C3AED': 'rich purple',
      '#EF4444': 'energetic red',
      '#6366F1': 'deep violet',
    };

    if (Array.isArray(colors)) {
      const names = colors.map((c) => colorMap[c.toUpperCase()] || c.replace('#', '')).filter(Boolean);
      return names.length > 0 ? names.join(' and ') : 'harmonious brand tones';
    }
    if (typeof colors === 'string') {
      return colorMap[colors.toUpperCase()] || colors.replace('#', '');
    }
    return 'harmonious brand tones';
  }
}
