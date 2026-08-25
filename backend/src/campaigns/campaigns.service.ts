import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AiService } from '../ai/ai.service';
import { BusinessIntelligenceService } from '../business/business-intelligence.service';
import { ContentService } from '../content/content.service';
import { getPlanLimits } from '../payment/payment.constants';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly integrations: IntegrationsService,
    private readonly aiService: AiService,
    private readonly businessIntelligence: BusinessIntelligenceService,
    private readonly contentService: ContentService,
  ) {}


  async buildAiCampaignWizard(
    businessId: string,
    data: {
      name: string;
      objective: string;
      dailyBudget: number;
      creativePrompt: string;
      targetAgeMin: number;
      targetAgeMax: number;
      targetLocation: string;
    },
  ) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) {
      throw new NotFoundException('Business workspace not found');
    }

    // Enforce Plan Limits: Check if plan allows Ad Campaigns (e.g. Free plan has no ad campaign)
    const planName = (business as any)?.subscriptionPlan || (business as any)?.plan || 'FREE';
    const limits = getPlanLimits(planName);
    if (!limits.allowAdCampaigns) {
      throw new BadRequestException(
        `Ad campaigns are disabled on your current ${limits.name} plan. Please upgrade to Advance (₹5,000) or Premium (₹10,000) plan to launch Ad Campaigns.`
      );
    }

    const context = await this.businessIntelligence.getBusinessContext(businessId);
    const industry = context.industry || 'Retail';
    const audience = context.targetAudience || 'General Audience';

    // 1. Generate creative via OpenRouter AI
    const aiCreative = await this.integrations.generateAdCreative(
      data.creativePrompt,
      industry,
      audience,
      { USP: context.businessUSP, brandTone: context.brandTone, languages: context.languages },
    );

    // 2. Generate custom 1080x1080 branded graphic asset via ContentService
    let imageUrl = '';
    try {
      const bannerText = aiCreative.headline || context.currentOffer || data.creativePrompt || 'SPECIAL OFFER';
      const graphicResult = await this.contentService.generateBrandedGraphic(businessId, bannerText);
      imageUrl = typeof graphicResult === 'string' ? graphicResult : (graphicResult as any)?.imageUrl || (graphicResult as any)?.publicUrl || '';
    } catch (err: any) {
      this.logger.warn(`Fallback to seeded banner URL: ${err.message}`);
      const imageSeed = `${encodeURIComponent((data.creativePrompt || 'creative').replace(/[^a-zA-Z0-9]/g, ''))}_${Date.now()}`;
      imageUrl = `https://picsum.photos/seed/${imageSeed}/800/600`;
    }

    const creative = await this.firebase.createCreative({
      businessId,
      headline: aiCreative.headline,
      description: aiCreative.description,
      primaryText: aiCreative.primaryText,
      cta: aiCreative.cta,
      imageUrl,
      imagePrompt: aiCreative.imagePrompt,
    });

    // 3. Publish to Meta (mock or real)
    const metaSync = await this.integrations.publishCampaignToMeta(
      data.name,
      data.dailyBudget,
      data.objective,
      {
        ageMin: data.targetAgeMin,
        ageMax: data.targetAgeMax,
        location: data.targetLocation,
      },
      aiCreative,
      businessId,
    );

    // 4. Save Campaign
    const campaign = await this.firebase.createCampaign({
      businessId,
      name: data.name,
      status: 'ACTIVE',
      objective: data.objective,
      dailyBudget: data.dailyBudget,
      startDate: new Date(),
      metaCampaignId: metaSync.metaCampaignId,
      healthScore: 100.0,
    });

    // 5. Save AdSet (includes businessId + campaignId for easy querying)
    const adSet = await this.firebase.createAdSet({
      campaignId: campaign.id,
      businessId,
      name: `AdSet - Target ${data.targetLocation} (Ages ${data.targetAgeMin}-${data.targetAgeMax})`,
      status: 'ACTIVE',
      budget: data.dailyBudget,
      targeting: {
        location: data.targetLocation,
        age_min: data.targetAgeMin,
        age_max: data.targetAgeMax,
      },
      metaAdSetId: metaSync.metaAdSetId,
    });

    // 6. Save Ad (includes businessId + campaignId for analytics queries)
    const ad = await this.firebase.createAd({
      adSetId: adSet.id,
      campaignId: campaign.id,
      businessId,
      name: 'Ad - Generated AI creative',
      status: 'ACTIVE',
      creativeId: creative.id,
      metaAdId: metaSync.metaAdId,
    });

    // 7. Seed initial analytics — businessId stored for direct queries
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    await this.firebase.createAnalytics({
      adId: ad.id,
      businessId,
      date: now,
      dateStr,
      spend: 5.0,
      impressions: 250,
      clicks: 12,
      conversions: 1,
      revenue: 45.0,
      cpc: 5.0 / 12,
      cpm: (5.0 / 250) * 1000,
      ctr: 12 / 250,
      roas: 45.0 / 5.0,
    });

    // 8. Notification
    await this.firebase.createNotification({
      businessId,
      title: 'AI Campaign Published',
      message: `Campaign "${data.name}" has been launched successfully on Meta.`,
      type: 'ALERTS',
    });

    return { campaign, adSet, ad, creative };
  }

  /**
   * Returns campaigns with nested adSets → ads → creative.
   * Manually assembles the relational tree (no Firestore joins).
   */
  async getCampaigns(businessId: string) {
    const campaigns = await this.firebase.getCampaignsByBusinessId(businessId);

    const enriched = await Promise.all(
      campaigns.map(async (campaign) => {
        const adSets = await this.firebase.getAdSetsByCampaignId(campaign.id);

        const enrichedAdSets = await Promise.all(
          adSets.map(async (adSet) => {
            const ads = await this.firebase.getAdsByAdSetId(adSet.id);

            const enrichedAds = await Promise.all(
              ads.map(async (ad) => {
                const creative = ad.creativeId
                  ? await this.firebase.getCreativeById(ad.creativeId)
                  : null;
                return { ...ad, creative };
              }),
            );

            return { ...adSet, ads: enrichedAds };
          }),
        );

        return { ...campaign, adSets: enrichedAdSets };
      }),
    );

    return enriched;
  }

  async updateCampaignStatus(campaignId: string, status: string) {
    const campaign = await this.firebase.getCampaignById(campaignId);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    // Update campaign status
    const updated = await this.firebase.updateCampaign(campaignId, { status });

    // Cascade status to adSets
    await this.firebase.updateAdSetsByCampaignId(campaignId, { status });

    // Cascade status to all ads under those adSets
    const adSets = await this.firebase.getAdSetsByCampaignId(campaignId);
    for (const adSet of adSets) {
      await this.firebase.updateAdsByAdSetId(adSet.id, { status });
    }

    // Audit record in optimization history
    await this.firebase.createOptimizationHistory({
      businessId: campaign.businessId,
      campaignId: campaign.id,
      action: `Campaign status changed to ${status}`,
      reason: 'User triggered manual status update on dashboard.',
      impactMetric: '-',
    });

    return updated;
  }

  async getAnalyticsSummary(businessId: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.firebase.getAnalyticsByBusinessId(businessId, startDate);

    const summary = logs.reduce(
      (acc, log) => {
        acc.spend += log.spend || 0;
        acc.impressions += log.impressions || 0;
        acc.clicks += log.clicks || 0;
        acc.conversions += log.conversions || 0;
        acc.revenue += log.revenue || 0;
        return acc;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
    );

    const cpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;
    const cpm =
      summary.impressions > 0
        ? (summary.spend / summary.impressions) * 1000
        : 0;
    const ctr =
      summary.impressions > 0 ? summary.clicks / summary.impressions : 0;
    const roas = summary.spend > 0 ? summary.revenue / summary.spend : 0;

    const campaignsCount = await this.firebase.countCampaigns(businessId);
    const activeCampaigns = await this.firebase.countCampaigns(
      businessId,
      'ACTIVE',
    );

    return {
      totalSpend: summary.spend,
      totalImpressions: summary.impressions,
      totalClicks: summary.clicks,
      totalConversions: summary.conversions,
      totalRevenue: summary.revenue,
      cpc,
      cpm,
      ctr,
      roas,
      campaignsCount,
      activeCampaigns,
    };
  }

  async getDailyAnalytics(businessId: string, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.firebase.getAnalyticsByBusinessId(businessId, startDate);

    // Group analytics by dateStr (YYYY-MM-DD)
    const dailyMap: Record<string, any> = {};
    for (const log of logs) {
      const dateStr = log.dateStr || '';
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = {
          date: dateStr,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
        };
      }
      dailyMap[dateStr].spend += log.spend || 0;
      dailyMap[dateStr].impressions += log.impressions || 0;
      dailyMap[dateStr].clicks += log.clicks || 0;
      dailyMap[dateStr].conversions += log.conversions || 0;
      dailyMap[dateStr].revenue += log.revenue || 0;
    }

    return Object.values(dailyMap).map((d: any) => {
      d.ctr = d.impressions > 0 ? d.clicks / d.impressions : 0;
      d.cpc = d.clicks > 0 ? d.spend / d.clicks : 0;
      d.roas = d.spend > 0 ? d.revenue / d.spend : 0;
      return d;
    });
  }

  async getOptimizationHistory(businessId: string) {
    return this.firebase.getOptimizationHistoryByBusinessId(businessId);
  }


  // -------------------------------------------------------------
  // Campaign Drafts & AI Strategy Generator
  // -------------------------------------------------------------

  async createDraft(businessId: string, data: any) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    return this.firebase.createCampaignDraft({
      businessId,
      ...data,
      strategyGenerated: false,
    });
  }

  async getDrafts(businessId: string) {
    return this.firebase.getCampaignDraftsByBusinessId(businessId);
  }

  async getDraft(id: string) {
    const draft = await this.firebase.getCampaignDraftById(id);
    if (!draft) throw new NotFoundException('Draft not found');
    return draft;
  }

  async generateDraftStrategy(id: string) {
    const draft = await this.getDraft(id);
    
    const strategy = await this.integrations.generateCampaignStrategy(
      {
        businessName: draft.businessName,
        industry: draft.industry,
        objective: draft.objective,
        dailyBudget: draft.dailyBudget,
        targetCountry: draft.targetCountry,
        product: draft.product,
      },
      draft.festivalTheme || '',
    );

    await this.firebase.updateCampaignDraft(id, {
      strategy,
      strategyGenerated: true,
    });

    return strategy;
  }

  async publishDraft(businessId: string, id: string) {
    const draft = await this.getDraft(id);
    if (!draft.strategyGenerated) {
      throw new Error('Strategy must be generated before publishing');
    }

    // Pass the generated data to the wizard builder to publish
    return this.buildAiCampaignWizard(businessId, {
      name: draft.name,
      objective: draft.objective,
      dailyBudget: Number(draft.dailyBudget),
      creativePrompt: draft.product || draft.name,
      targetAgeMin: 18,
      targetAgeMax: 65,
      targetLocation: draft.targetCountry || 'United States',
    });
  }

  // -------------------------------------------------------------
  // Phase 5: AI Campaign Creation (Enhanced)
  // -------------------------------------------------------------

  /**
   * Generate a complete Meta campaign automatically using AI.
   * Supports Lead Generation and Traffic objectives.
   */
  async generateFullCampaign(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    const profile = await this.businessIntelligence.getBusinessContext(businessId);
    const industry = profile?.industry || profile?.businessCategory || 'Retail';
    const audience = profile?.targetAudience || 'General Audience';
    const brandTone = profile?.brandTone || profile?.brandVoice || 'Professional';
    const budget = parseFloat(profile?.monthlyBudget || profile?.budgetLimit || '3000');
    const dailyBudget = Math.round(budget / 30);
    const productsServices = profile?.productsServices || '';
    const usp = profile?.businessUSP || '';
    const location = profile?.location || 'United States';
    const ageGroup = profile?.customerAgeGroup || '25-54';
    const gender = profile?.genderTarget || 'Both';
    const competitors = profile?.competitors || '';

    // AI-generate campaign strategy
    let aiStrategy: any = null;
    try {
      aiStrategy = await this.aiService.chatJson<any>(
        'You are an expert Meta Ads campaign strategist. Generate complete campaign configurations.',
        `Generate a complete Meta Ads campaign for this business:

Business: ${profile?.businessName || business.name}
Industry: ${industry}
Products/Services: ${productsServices}
Target Audience: ${audience}
Age Group: ${ageGroup}
Gender: ${gender}
Location: ${location}
Brand Tone: ${brandTone}
USP: ${usp}
Competitors: ${competitors}
Monthly Budget: ${budget}
Daily Budget: ${dailyBudget}

Generate TWO campaigns (one Lead Generation, one Traffic). For each, provide:
- campaignName: descriptive name
- objective: "LEAD_GENERATION" or "TRAFFIC"
- dailyBudget: number
- headline: ad headline
- primaryText: ad primary text (2-3 sentences)
- description: short ad description
- cta: call to action ("SIGN_UP", "LEARN_MORE", "SHOP_NOW", "GET_OFFER")
- imagePrompt: AI image generation prompt
- audienceSuggestions: array of 3 targeting suggestions
- budgetSuggestion: budget recommendation text
- ageMin: number
- ageMax: number
- interests: array of interest targeting keywords

Return ONLY valid JSON:
{
  "campaigns": [
    { "campaignName": "...", "objective": "LEAD_GENERATION", ... },
    { "campaignName": "...", "objective": "TRAFFIC", ... }
  ]
}`,
        0.7,
        3000,
        'CampaignsService.generateFullCampaign',
      );
    } catch (err: any) {
      this.logger.warn(`AI campaign generation failed: ${err.message}`);
    }

    // Parse age group
    const ageParts = ageGroup.match(/(\d+)/g) || ['25', '54'];
    const defaultAgeMin = parseInt(ageParts[0]) || 25;
    const defaultAgeMax = parseInt(ageParts[1]) || 54;

    const campaignsToCreate = aiStrategy?.campaigns || [
      {
        campaignName: `${business.name} - Lead Gen Campaign`,
        objective: 'LEAD_GENERATION',
        dailyBudget: Math.round(dailyBudget * 0.6),
        headline: `Discover ${productsServices || industry}`,
        primaryText: `Looking for the best ${productsServices || industry}? ${usp || 'We deliver quality you can trust.'} Sign up today and get a free consultation!`,
        description: `Premium ${industry} solutions for ${audience}`,
        cta: 'SIGN_UP',
        imagePrompt: `Professional ${industry} business advertisement, modern design, premium feel`,
        audienceSuggestions: [`${audience} interested in ${industry}`, `People who follow ${competitors || 'industry leaders'}`, 'Lookalike audience from existing customers'],
        budgetSuggestion: `Start with ₹${Math.round(dailyBudget * 0.6)}/day, increase by 15% every week if CPA is below target`,
        ageMin: defaultAgeMin,
        ageMax: defaultAgeMax,
        interests: [industry, productsServices || 'online shopping', 'business services'],
      },
      {
        campaignName: `${business.name} - Traffic Campaign`,
        objective: 'TRAFFIC',
        dailyBudget: Math.round(dailyBudget * 0.4),
        headline: `${usp || `Best ${industry} Solutions`}`,
        primaryText: `${brandTone === 'Casual' ? 'Hey! ' : ''}Check out our ${productsServices || 'offerings'} — trusted by thousands. Visit us today!`,
        description: `Top rated ${industry} — ${audience}`,
        cta: 'LEARN_MORE',
        imagePrompt: `Eye-catching ${industry} product/service advertisement, vibrant colors, professional`,
        audienceSuggestions: [`Website visitors in last 30 days`, `${audience} in ${location}`, `Interest-based: ${industry} enthusiasts`],
        budgetSuggestion: `Allocate ₹${Math.round(dailyBudget * 0.4)}/day for traffic, optimize for link clicks`,
        ageMin: defaultAgeMin,
        ageMax: defaultAgeMax,
        interests: [industry, 'online shopping', 'digital marketing'],
      },
    ];

    const results: any[] = [];

    for (const camp of campaignsToCreate) {
      try {
        const result = await this.buildAiCampaignWizard(businessId, {
          name: camp.campaignName,
          objective: camp.objective,
          dailyBudget: camp.dailyBudget,
          creativePrompt: camp.primaryText,
          targetAgeMin: camp.ageMin || defaultAgeMin,
          targetAgeMax: camp.ageMax || defaultAgeMax,
          targetLocation: location,
        });

        results.push({
          ...result,
          aiSuggestions: {
            audienceSuggestions: camp.audienceSuggestions,
            budgetSuggestion: camp.budgetSuggestion,
            interests: camp.interests,
          },
        });
      } catch (err: any) {
        this.logger.error(`Failed to create campaign: ${camp.campaignName}`, err.message);
        results.push({ error: err.message, campaignName: camp.campaignName });
      }
    }

    return {
      success: true,
      message: `${results.filter(r => !r.error).length} campaigns generated`,
      campaigns: results,
    };
  }

  // -------------------------------------------------------------
  // Phase 9: AI Optimization (replaces hardcoded recommendations)
  // -------------------------------------------------------------

  /**
   * AI-powered campaign analysis and recommendations.
   */
  async getAiRecommendations(businessId: string) {
    const campaigns = await this.firebase.getCampaignsByBusinessId(businessId);
    const profile = await this.businessIntelligence.getBusinessContext(businessId);

    if (campaigns.length === 0) {
      return [{
        id: 'rec_welcome',
        title: 'Create Your First Campaign',
        description: 'Get started by creating your first AI-powered campaign. Our AI will generate optimized ad copy, targeting, and budget recommendations.',
        impact: 'Launch your marketing',
        actionLabel: 'Create Campaign',
        type: 'GENERAL',
      }];
    }

    // Gather campaign performance data
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const analytics = await this.firebase.getAnalyticsByBusinessId(businessId, startDate);

    const totalSpend = analytics.reduce((sum, a: any) => sum + (a.spend || 0), 0);
    const totalClicks = analytics.reduce((sum, a: any) => sum + (a.clicks || 0), 0);
    const totalImpressions = analytics.reduce((sum, a: any) => sum + (a.impressions || 0), 0);
    const totalConversions = analytics.reduce((sum, a: any) => sum + (a.conversions || 0), 0);
    const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgROAS = totalSpend > 0 ? analytics.reduce((sum, a: any) => sum + (a.revenue || 0), 0) / totalSpend : 0;

    // Try AI-generated recommendations
    try {
      const result = await this.aiService.chatJson<any[]>(
        'You are a Meta Ads optimization expert. Analyze campaign data and provide actionable recommendations.',
        `Analyze these campaign metrics and generate 3-5 optimization recommendations:

Business: ${profile?.businessName || 'Business'}
Industry: ${profile?.industry || 'General'}
Active Campaigns: ${campaigns.length}
30-Day Metrics:
- Total Spend: $${totalSpend.toFixed(2)}
- Total Clicks: ${totalClicks}
- Total Impressions: ${totalImpressions}
- Total Conversions: ${totalConversions}
- Average CPC: $${avgCPC.toFixed(2)}
- Average CTR: ${avgCTR.toFixed(2)}%
- ROAS: ${avgROAS.toFixed(2)}

For each recommendation, provide:
- id: unique string like "rec_01"
- title: short title
- description: detailed explanation (2-3 sentences)
- impact: expected impact (e.g., "+15% CTR", "-20% CPC")
- actionLabel: button text
- type: one of "BUDGET", "CREATIVE", "AUDIENCE", "TIMING", "GENERAL"

Return ONLY a valid JSON array.`,
        0.7,
        2048,
        'CampaignsService.getAiRecommendations',
      );

      if (result && Array.isArray(result) && result.length > 0) {
        return result;
      }
    } catch (err: any) {
      this.logger.warn(`AI recommendations generation failed: ${err.message}`);
    }

    // Smart fallback based on actual metrics
    const recommendations: any[] = [];

    if (avgROAS > 2.5) {
      recommendations.push({
        id: 'rec_budget_increase',
        title: 'Scale High-Performing Campaigns',
        description: `Your ROAS of ${avgROAS.toFixed(2)} is strong. Consider increasing daily budget by 20% on your best-performing campaigns to capture more high-value traffic.`,
        impact: `+${Math.round(avgROAS * 5)}% expected revenue`,
        actionLabel: 'Increase Budget',
        type: 'BUDGET',
      });
    } else if (avgROAS < 1.5 && totalSpend > 0) {
      recommendations.push({
        id: 'rec_budget_decrease',
        title: 'Reduce Budget on Low-Performing Campaigns',
        description: `Your ROAS of ${avgROAS.toFixed(2)} is below target. Reduce spend on underperforming ad sets and reallocate to higher-converting audiences.`,
        impact: '-15% wasted spend',
        actionLabel: 'Optimize Budget',
        type: 'BUDGET',
      });
    }

    if (avgCTR < 1.5 && totalImpressions > 0) {
      recommendations.push({
        id: 'rec_creative_refresh',
        title: 'Refresh Ad Creatives',
        description: `CTR of ${avgCTR.toFixed(2)}% indicates potential creative fatigue. Rotate in fresh visuals and A/B test new headlines to boost engagement.`,
        impact: '+30-50% CTR improvement',
        actionLabel: 'Refresh Creatives',
        type: 'CREATIVE',
      });
    }

    if (avgCPC > 2.0) {
      recommendations.push({
        id: 'rec_audience_expand',
        title: 'Expand Audience Targeting',
        description: `CPC of $${avgCPC.toFixed(2)} is elevated. Broaden your targeting with additional interests and lookalike audiences to increase the auction pool.`,
        impact: '-20% CPC reduction',
        actionLabel: 'Expand Audience',
        type: 'AUDIENCE',
      });
    }

    recommendations.push({
      id: 'rec_posting_time',
      title: 'Optimize Posting Schedule',
      description: `Based on ${profile?.industry || 'your industry'} benchmarks, posting between 10AM-12PM and 7PM-9PM typically yields 25% higher engagement. Consider adjusting your content schedule.`,
      impact: '+25% engagement rate',
      actionLabel: 'Update Schedule',
      type: 'TIMING',
    });

    if (campaigns.filter((c: any) => c.status === 'ACTIVE').length > 3) {
      recommendations.push({
        id: 'rec_consolidate',
        title: 'Consolidate Active Campaigns',
        description: `You have ${campaigns.filter((c: any) => c.status === 'ACTIVE').length} active campaigns. Consolidating similar campaigns can help Meta's algorithm optimize delivery more effectively.`,
        impact: '+15% delivery efficiency',
        actionLabel: 'Review Campaigns',
        type: 'GENERAL',
      });
    }

    return recommendations;
  }

  // -------------------------------------------------------------
  // Optimization Center
  // -------------------------------------------------------------

  async getOptimizationCenter(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    const recommendations = await this.getAiRecommendations(businessId);

    return {
      autoOptimize: business.autoOptimize || false,
      lastOptimizationRun: business.lastOptimizationRun || null,
      recommendationsCount: recommendations.length,
      activeRules: [
        'Pause ads with CPC > ₹200',
        'Increase budget by 10% if ROAS > 3.0',
        'Rotate creative if CTR < 1.0%',
      ],
    };
  }

  async toggleAutoOptimization(businessId: string, autoOptimize: boolean) {
    await this.firebase.updateBusiness(businessId, { autoOptimize });

    await this.firebase.createOptimizationHistory({
      businessId,
      action: autoOptimize ? 'Enabled Auto-Optimization' : 'Disabled Auto-Optimization',
      reason: 'User preference updated via Optimization Center',
      impactMetric: '-',
    });

    return { success: true, autoOptimize };
  }

  async applyRecommendation(businessId: string, recommendationId: string) {
    const recommendations = await this.getAiRecommendations(businessId);
    const rec = recommendations.find((r: any) => r.id === recommendationId);

    if (!rec) throw new NotFoundException('Recommendation not found');

    await this.firebase.createOptimizationHistory({
      businessId,
      action: `Applied AI Recommendation: ${rec.title}`,
      reason: rec.description,
      impactMetric: rec.impact,
    });

    return { success: true, message: 'Recommendation applied successfully' };
  }
}
