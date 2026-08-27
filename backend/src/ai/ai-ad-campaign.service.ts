import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { AiService } from './ai.service';
import { FirebaseService } from '../firebase/firebase.service';
import { GraphicGeneratorService } from '../content/graphic-generator.service';

export interface GenerateAdCampaignDto {
  category?: string;
  targetLocation?: string;
  dailyBudget?: number | string;
  monthlyBudget?: number | string;
  goal?: string;
  campaignGoal?: string;
  usp?: string;
  currentOffer?: string;
  gender?: string;
  workspaceId?: string;
  businessId?: string;
}

export interface GenerateContentDto {
  niche: string;
  targetAudience: string;
  brandTone: string;
  currentOffer: string;
  workspaceId?: string;
  businessId?: string;
}

export interface GeneratedContentResult {
  caption: string;
  hashtags: string[];
  primaryText: string;
  headline: string;
  description: string;
  imagePrompt: string;
  imageUrl: string;
}

export interface TargetingSpec {
  locations: string[];
  ageMin: number;
  ageMax: number;
  gender: string;
  interests: string[];
  flexibleSpecInterests?: string[];
}

export interface GenerateAdCampaignResult {
  campaignName: string;
  objective: string;
  dailyBudget: number;
  targeting: TargetingSpec;
  primaryText: string;
  headline: string;
  description: string;
  ctaType: string;
  adBannerPrompt: string;
  bannerUrl: string;
  generatedAt: string;
  model: string;
}

import { BusinessIntelligenceService } from '../business/business-intelligence.service';

@Injectable()
export class AiAdCampaignService {
  private readonly logger = new Logger(AiAdCampaignService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly firebaseService: FirebaseService,
    private readonly graphicGeneratorService: GraphicGeneratorService,
    private readonly businessIntelligence: BusinessIntelligenceService,
  ) {}

  /**
   * Generates a complete Meta Ad campaign strategy using Gemini AI,
   * renders a high-converting 1080x1080 graphic banner via Node Canvas,
   * uploads it to Firebase Storage, and returns the structured payload.
   */
  async generateAdCampaign(dto: GenerateAdCampaignDto): Promise<GenerateAdCampaignResult> {
    const workspaceId = dto.workspaceId || dto.businessId || 'default_workspace';

    let ctx: any = null;
    if (dto.businessId || dto.workspaceId) {
      try {
        ctx = await this.businessIntelligence.getBusinessContext(dto.businessId || dto.workspaceId!);
      } catch {
        ctx = null;
      }
    }

    const category = dto.category || ctx?.businessCategory || ctx?.industry || 'Retail E-commerce';
    const location = dto.targetLocation || ctx?.targetAudienceGeo || ctx?.location || 'All Target Cities';
    const goal = dto.goal || dto.campaignGoal || ctx?.businessGoals || 'Sales Conversions & Lead Generation';
    const offer = dto.currentOffer || dto.usp || ctx?.currentOffer || 'Special Limited-Time Promotion';
    const usp = dto.usp || ctx?.businessUSP || 'Top Quality Service & Unmatched Value';
    const dailyBudgetNum = Number(dto.dailyBudget || (dto.monthlyBudget ? Number(dto.monthlyBudget) / 30 : ctx?.dailyBudget || 500));
    const gender = dto.gender || ctx?.genderTarget || 'ALL';

    const contactPhone = ctx?.contactPhone || '';
    const contactEmail = ctx?.contactEmail || '';
    const websiteUrl = ctx?.websiteUrl || '';
    const physicalAddress = ctx?.physicalAddress || '';

    this.logger.log(`Generating AI Paid Ad Campaign via Gemini. Category: ${category}, Location: ${location}, Goal: ${goal}`);

    const dateStr = new Date().toISOString().split('T')[0];

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    let aiResponse: any = null;

    const prompt = `You are an elite Meta Ads campaign strategist and direct-response copywriter.
Analyze the business details below and generate a complete, high-converting Meta Ad campaign structure.

BUSINESS DETAILS:
- Category / Industry: ${category}
- Location Targeting: ${location}
- Daily Budget: ₹${dailyBudgetNum}
- Campaign Goal: ${goal}
- Unique Selling Proposition (USP): ${usp}
- Promotional Offer: ${offer}
- Target Gender: ${gender}

REQUIREMENTS:
Return ONLY valid JSON matching this exact structure (no markdown, no code fences):
{
  "campaignName": "${category} - ${goal.slice(0, 20)} (${dateStr})",
  "objective": "OUTCOME_SALES",
  "targeting": {
    "locations": ["${location}"],
    "ageMin": 21,
    "ageMax": 55,
    "gender": "${gender}",
    "interests": ["${category}", "Online shopping", "Promotional offers", "Digital Marketing"]
  },
  "primaryText": "🚨 Irresistible hook paragraph explaining why customers in ${location} choose this brand. Highlight ${usp} and ${offer} with a strong call-to-action.",
  "headline": "Punchy offer headline under 40 characters",
  "description": "Urgency/social proof text under 30 characters",
  "ctaType": "LEARN_MORE",
  "adBannerPrompt": "A 1080x1080 luxury studio lighting social media ad banner graphic for ${category} with bold modern typography featuring: ${offer}"
}`;

    if (geminiApiKey) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const result = await model.generateContent(prompt);
        const rawText = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        aiResponse = JSON.parse(rawText);
        this.logger.log('[Gemini Campaign Engine] Successfully generated campaign strategy via Gemini 1.5 Flash SDK');
      } catch (err: any) {
        this.logger.warn(`[Gemini Campaign Engine] Gemini SDK error: ${err.message}. Triggering AI fallback service.`);
      }
    }

    if (!aiResponse) {
      aiResponse = await this.aiService.chatJson(
        'You are an expert Meta Ads campaign strategist. Return ONLY valid JSON.',
        prompt,
        0.7,
        2048,
        'AiAdCampaignService.generateAdCampaign',
      );
    }

    // Fallback if AI response was null
    if (!aiResponse) {
      this.logger.warn('AI provider returned empty response. Using structured campaign fallback.');
      aiResponse = {
        campaignName: `${category} ${goal.slice(0, 15)} — ${dateStr}`,
        objective: goal.toLowerCase().includes('lead') ? 'OUTCOME_LEADS' : 'OUTCOME_SALES',
        targeting: {
          locations: [location],
          ageMin: 22,
          ageMax: 50,
          gender: gender,
          interests: [category, 'Direct-to-Consumer', 'Offers'],
        },
        primaryText: `🔥 Exclusive offer for customers in ${location}! Experience top-rated ${category}. ${usp}. Claim ${offer} today before spots fill up!`,
        headline: offer.length <= 40 ? offer : `Special Offer: ${category}`,
        description: '⭐ 4.9/5 Rated • Limited Time',
        ctaType: 'LEARN_MORE',
        adBannerPrompt: `High-converting modern 1080x1080 promo banner for ${category} in ${location}, featuring offer: ${offer}`,
      };
    }

    // 2. Render Graphic Banner via Node.js Canvas & Upload to Firebase Storage
    let bannerUrl = '';
    try {
      const headlineText = aiResponse.headline || offer;
      const descriptionText = aiResponse.description || 'Limited Time Offer';
      const ctaType = aiResponse.ctaType || 'LEARN_MORE';

      // Generate an actual photographic background. Without this the ad banner
      // was only the layout frame over a flat gradient — no product imagery at
      // all — because this path never asked the image model for anything.
      let bgImageUrl = '';
      try {
        const bannerPrompt =
          aiResponse.adBannerPrompt ||
          `Professional commercial advertising photograph for ${ctx?.businessName || category}, ` +
            `showing ${category} as the main subject, promoting "${offer}", ` +
            `photorealistic, clean composition, no text, no watermark`;
        const imgResult = await this.aiService.generateImage(bannerPrompt, { aspect_ratio: '1:1' });
        bgImageUrl = imgResult?.imageUrl || '';
      } catch (imgErr: any) {
        this.logger.warn(`Ad banner background generation failed: ${imgErr.message}. Rendering on gradient only.`);
      }

      const imageBuffer = await this.graphicGeneratorService.generateBrandedGraphicBuffer({
        businessName: ctx?.businessName || category || 'Brand Workspace',
        offerText: offer,
        headline: headlineText,
        description: descriptionText,
        ctaType: ctaType,
        niche: category,
        vibe: 'luxurious bold high-energy',
        phone: contactPhone,
        email: contactEmail,
        website: websiteUrl,
        address: physicalAddress,
        bgImageUrl,
      });

      const fileName = `ad_banner_${Date.now()}.png`;
      const destinationPath = `ad-banners/${workspaceId}/${fileName}`;

      const uploadRes = await this.firebaseService.uploadFileBuffer(
        imageBuffer,
        destinationPath,
        'image/png',
      );
      bannerUrl = typeof uploadRes === 'string' ? uploadRes : uploadRes?.publicUrl || '';

      if (!bannerUrl) {
        bannerUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      }
      this.logger.log(`Ad banner rendered and uploaded successfully to Firebase Storage: ${bannerUrl.slice(0, 80)}...`);
    } catch (err: any) {
      this.logger.warn(`Ad banner canvas rendering fallback triggered: ${err.message}`);
      bannerUrl = `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1080&q=80`;
    }

    const interestsList = Array.isArray(aiResponse.targeting?.interests)
      ? aiResponse.targeting.interests
      : Array.isArray(aiResponse.targeting?.flexibleSpecInterests)
      ? aiResponse.targeting.flexibleSpecInterests
      : [category, 'Online Shopping'];

    return {
      campaignName: aiResponse.campaignName || `${category} ${goal} - ${dateStr}`,
      objective: aiResponse.objective || (goal.toLowerCase().includes('lead') ? 'OUTCOME_LEADS' : 'OUTCOME_SALES'),
      dailyBudget: dailyBudgetNum,
      targeting: {
        locations: Array.isArray(aiResponse.targeting?.locations) ? aiResponse.targeting.locations : [location],
        ageMin: Number(aiResponse.targeting?.ageMin) || 21,
        ageMax: Number(aiResponse.targeting?.ageMax) || 55,
        gender: aiResponse.targeting?.gender || gender,
        interests: interestsList,
        flexibleSpecInterests: interestsList,
      },
      primaryText: aiResponse.primaryText || `Discover top-tier ${category} in ${location}.`,
      headline: aiResponse.headline || (offer.length <= 40 ? offer : `Exclusive ${category} Offer`),
      description: aiResponse.description || 'Claim Special Offer Today',
      ctaType: aiResponse.ctaType || 'LEARN_MORE',
      adBannerPrompt: aiResponse.adBannerPrompt || `Graphic banner for ${category}`,
      bannerUrl,
      generatedAt: new Date().toISOString(),
      model: 'gemini-1.5-flash',
    };
  }

  /**
   * Gemini AI Content Engine: Generates structured social post/ad content and visual banner graphic.
   * Endpoint: /api/ai/generate-content
   */
  async generateContent(dto: GenerateContentDto): Promise<GeneratedContentResult> {
    this.logger.log(`[Gemini Content Engine] Generating content for Niche: ${dto.niche}, Tone: ${dto.brandTone}`);

    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    let contentJson: any = null;

    if (geminiApiKey) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `You are an elite social media copywriter and ad creative strategist. Generate high-converting content for:

- Category / Niche: ${dto.niche}
- Target Audience: ${dto.targetAudience}
- Brand Tone: ${dto.brandTone}
- Current Offer: ${dto.currentOffer}

Return ONLY valid JSON matching this exact structure (no markdown, no code fences):
{
  "caption": "Engaging, high-converting social media caption with relevant emojis",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "primaryText": "Persuasive ad copy hook focusing on key benefits and current offer",
  "headline": "Punchy offer headline under 40 characters",
  "description": "Short urgency/benefit-driven description under 30 characters",
  "imagePrompt": "Detailed visual creative prompt describing a 1080x1080 high-converting promo banner graphic"
}`;

        const result = await model.generateContent(prompt);
        const rawText = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        contentJson = JSON.parse(rawText);
        this.logger.log('[Gemini Content Engine] Successfully generated content via Gemini 1.5 Flash SDK');
      } catch (err: any) {
        this.logger.warn(`[Gemini Content Engine] Gemini SDK error: ${err.message}. Triggering AI fallback service.`);
      }
    }

    if (!contentJson) {
      const prompt = `Generate structured social media ad content for:
Niche: ${dto.niche}
Target Audience: ${dto.targetAudience}
Brand Tone: ${dto.brandTone}
Offer: ${dto.currentOffer}

Return ONLY valid JSON:
{
  "caption": "Engaging caption",
  "hashtags": ["#tag1", "#tag2", "#tag3"],
  "primaryText": "Primary ad hook",
  "headline": "Headline under 40 chars",
  "description": "Benefit description",
  "imagePrompt": "Visual graphic prompt"
}`;

      contentJson = await this.aiService.chatJson(
        'You are an expert copywriter. Return ONLY valid JSON.',
        prompt,
        0.7,
        2048,
        'AiAdCampaignService.generateContent',
      );
    }

    if (!contentJson) {
      contentJson = {
        caption: `✨ Special Offer for ${dto.targetAudience}! Discover premium quality in ${dto.niche}. Take advantage of our exclusive deal: ${dto.currentOffer}!`,
        hashtags: [`#${dto.niche.replace(/\s+/g, '')}`, '#ExclusiveOffer', '#LimitedTime', '#SpecialPromotion'],
        primaryText: `Don't miss out on ${dto.currentOffer}. Designed specifically for ${dto.targetAudience}.`,
        headline: dto.currentOffer.length <= 40 ? dto.currentOffer : 'Special Limited Offer',
        description: 'Claim your offer today!',
        imagePrompt: `High quality 1080x1080 promotional graphic for ${dto.niche}, ${dto.brandTone} aesthetic, featuring offer: ${dto.currentOffer}`,
      };
    }

    // Graphic Banner Generation & Hosting/Upload
    const workspaceId = dto.workspaceId || dto.businessId || 'default_workspace';
    let imageUrl = '';

    try {
      const buffer = await this.graphicGeneratorService.generateBrandedGraphicBuffer({
        businessName: dto.niche,
        offerText: dto.currentOffer,
        niche: dto.niche,
        vibe: dto.brandTone,
      });

      const fileName = `generated_${Date.now()}.png`;
      const destinationPath = `generated-content/${workspaceId}/${fileName}`;

      const uploadRes = await this.firebaseService.uploadFileBuffer(buffer, destinationPath, 'image/png');
      imageUrl = typeof uploadRes === 'string' ? uploadRes : uploadRes?.publicUrl || '';
      if (!imageUrl) {
        imageUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch (err: any) {
      this.logger.warn(`Graphic banner fallback triggered: ${err.message}`);
      const fallbackBuffer = await this.graphicGeneratorService.generateBrandedGraphicBuffer({
        businessName: dto.niche,
        offerText: dto.currentOffer,
        niche: dto.niche,
        vibe: dto.brandTone,
      });
      imageUrl = `data:image/png;base64,${fallbackBuffer.toString('base64')}`;
    }

    return {
      caption: contentJson.caption || `Exclusive offer: ${dto.currentOffer}`,
      hashtags: Array.isArray(contentJson.hashtags) ? contentJson.hashtags : [`#${dto.niche.replace(/\s+/g, '')}`],
      primaryText: contentJson.primaryText || contentJson.caption || `Check out ${dto.currentOffer}`,
      headline: contentJson.headline || (dto.currentOffer.length <= 40 ? dto.currentOffer : 'Limited Special Offer'),
      description: contentJson.description || 'Claim your offer today!',
      imagePrompt: contentJson.imagePrompt || `Promotional graphic for ${dto.niche}`,
      imageUrl,
    };
  }
}
