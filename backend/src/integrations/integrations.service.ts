import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as dotenv from 'dotenv';
import axios from 'axios';
import { FirebaseService } from '../firebase/firebase.service';
import { AiService } from '../ai/ai.service';
import { launchFullMetaCampaignHierarchy, describeMetaError } from '../lib/meta/ads-manager';
import { GRAPH_API_BASE, FACEBOOK_DIALOG_BASE } from '../lib/meta/graph-version';

/** Window during which a completed Meta OAuth exchange is replayed. */
const META_OAUTH_REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** How long saving the account selection will wait for the webhook subscription. */
const META_SUBSCRIBE_DEADLINE_MS = 12_000;

dotenv.config();

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  /**
   * Meta authorization codes can only be exchanged once. Coalesce duplicate
   * callback requests that arrive while the original exchange is in progress.
   */
  private readonly metaOAuthExchanges = new Map<string, Promise<any>>();
  // How long a completed OAuth exchange is replayed for, so a refreshed or
  // re-delivered callback does not present the same code to Meta twice.
  /**
   * Live Meta calls are only enabled when explicitly requested and both app
   * credentials are usable.  This keeps local development functional when a
   * developer has not created a Meta app yet.
   */
  public readonly isMock: boolean;

  constructor(
    private readonly firebase: FirebaseService,
    private readonly aiService: AiService,
  ) {
    const configuredMockMode = (process.env.MOCK_MODE || process.env.MOCK_INTEGRATION || '').trim().toLowerCase();
    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    const isPlaceholder = (value?: string) => !value || /^(your_|replace_|change_|placeholder)/i.test(value);

    this.isMock = ['true', '1', 'yes'].includes(configuredMockMode)
      || isPlaceholder(appId)
      || isPlaceholder(appSecret);
  }

  onModuleInit() {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      this.logger.log(`Meta integration credentials loaded. App ID: ${appId.slice(0, 6)}... Mock: ${this.isMock}`);
    } else {
      this.logger.warn('Meta integration credentials (META_APP_ID / META_APP_SECRET) are missing.');
    }
  }

  // ─── OpenRouter AI Integration ─────────────────────────────────────────────

  /**
   * Generate a business strategy (SWOT + competitor analysis) using OpenRouter.
   */
  async generateBusinessStrategy(
    industry: string,
    targetAudience: string,
    brandVoice: string,
    additionalContext?: Record<string, string>,
  ) {
    this.logger.log(`Generating Strategy. Industry: ${industry}. Mock: ${this.isMock}`);

    const preferredLanguage = additionalContext?.preferredLanguage || 'English';
    let languageInstruction = '';
    if (preferredLanguage !== 'English') {
      if (preferredLanguage.toLowerCase() === 'hinglish') {
        languageInstruction = `\nIMPORTANT: The user has selected 'Hinglish' (Hindi written in the English script/alphabet, e.g. 'Aapki strategy bohot acchi hai'). You MUST write all the SWOT strengths/weaknesses/opportunities/threats and competitor strengths/strategies in Hinglish (Hindi written using the English/Latin alphabet). Do NOT use Devanagari script.`;
      } else {
        languageInstruction = `\nIMPORTANT: The user has selected '${preferredLanguage}' as their preferred language. You MUST write all the SWOT strengths/weaknesses/opportunities/threats and competitor strengths/strategies in '${preferredLanguage}' language. Use the standard script/writing system of '${preferredLanguage}' (e.g. Devanagari for Hindi, Bengali script for Bengali, etc.).`;
      }
    }

    const result = await this.aiService.chatJson<{
      swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
      competitors: { competitors: { name: string; strength: string; strategy: string }[] };
    }>(
      'You are an expert Meta Ads strategist. Return ONLY valid JSON.',
      `Generate a comprehensive SWOT analysis and competitor strategy for:
Industry: ${industry}
Target Audience: ${targetAudience}
Brand Voice: ${brandVoice}
Additional Context: ${JSON.stringify(additionalContext || {})}${languageInstruction}

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "swot": {
    "strengths": ["...", "...", "..."],
    "weaknesses": ["...", "...", "..."],
    "opportunities": ["...", "...", "..."],
    "threats": ["...", "...", "..."]
  },
  "competitors": {
    "competitors": [
      {"name": "...", "strength": "...", "strategy": "..."},
      {"name": "...", "strength": "...", "strategy": "..."}
    ]
  }
}`,
      0.7,
      2048,
      'IntegrationsService.generateBusinessStrategy',
    );

    if (result) return result;

    // Intelligent fallback if OpenRouter is unavailable
    return {
      swot: {
        strengths: [
          `Strong brand alignment with ${brandVoice} positioning`,
          `Niche authority within ${industry}`,
          'Direct-to-consumer relationship model',
        ],
        weaknesses: [
          'Limited initial organic reach',
          'Competitive auction rates in this vertical',
          'Budget constraint sensitivity',
        ],
        opportunities: [
          `Hyper-targeted Meta Ads to ${targetAudience}`,
          'Dynamic product catalog retargeting',
          'Lookalike audience expansion from pixel data',
        ],
        threats: [
          'Creative fatigue in short conversion windows',
          'Competitor copycat campaigns',
          'Rising cost-per-click (CPC) trends',
        ],
      },
      competitors: {
        competitors: [
          {
            name: 'Established Market Leader',
            strength: 'Large ad budget + brand recall',
            strategy: 'Differentiate with authenticity and social proof (UGC)',
          },
          {
            name: 'Emerging DTC Brand',
            strength: 'Strong community following',
            strategy: 'Emphasize faster delivery, better pricing, superior support',
          },
        ],
      },
    };
  }

  /**
   * Generate ad creative (headline, description, primary text, CTA) using OpenRouter.
   */
  async generateAdCreative(
    promptText: string,
    industry: string,
    targetAudience: string,
    extraContext?: Record<string, any>,
  ) {
    this.logger.log(`Generating Ad Creative. Prompt: ${promptText}. Mock: ${this.isMock}`);

    const result = await this.aiService.chatJson<{
      headline: string;
      description: string;
      primaryText: string;
      cta: string;
      imagePrompt: string;
      hashtags: string[];
    }>(
      'You are a Meta Ads copywriter. Return ONLY valid JSON.',
      `Generate high-converting ad creative for:
Product/Prompt: ${promptText}
Industry: ${industry}
Target Audience: ${targetAudience}
Additional Context: ${JSON.stringify(extraContext || {})}

Return ONLY valid JSON (no markdown, no code fences):
{
  "headline": "...",
  "description": "...",
  "primaryText": "...",
  "cta": "SHOP_NOW",
  "imagePrompt": "...",
  "hashtags": ["#tag1", "#tag2"]
}`,
      0.8,
      1024,
      'IntegrationsService.generateAdCreative',
    );

    if (result) return result;

    // Intelligent fallback
    return {
      headline: `The New Standard in ${industry}`,
      description: `Premium quality, crafted for ${targetAudience}.`,
      primaryText: `Tired of settling for less? Our ${promptText} delivers exactly what ${targetAudience} deserve. Built with care, backed by results. Try it today — free returns on your first order.`,
      cta: 'SHOP_NOW',
      imagePrompt: `Premium ${industry} product flat lay, studio lighting, clean white background, professional commercial photography, high-end editorial style`,
      hashtags: [`#${industry.replace(/\s+/g, '')}`, '#MetaAds', '#ShopNow'],
    };
  }

  /**
   * Generate full campaign strategy using OpenRouter.
   */
  async generateCampaignStrategy(
    businessDetails: Record<string, any>,
    festivalTheme: string = '',
  ) {
    this.logger.log(`Generating full campaign strategy. Mock: ${this.isMock}`);

    const themeContext = festivalTheme ? `FESTIVAL / EVENT THEME: ${festivalTheme}` : 'No specific theme (Evergreen campaign)';

    const result = await this.aiService.chatJson<{
      marketingStrategySummary: string;
      creativeIdeas: string;
      expectedROAS: number;
      expectedCTR: number;
      expectedCPC: number;
      campaignHealthPrediction: number;
      audience: string;
      interestTargeting: string;
      behaviors: string;
      lookalikeSuggestions: string;
      placements: string;
      optimizationGoal: string;
      budgetRecommendation: string;
      headlines: string[];
      primaryTexts: string[];
      contentCalendar: { day: string; type: string; caption: string; hashtags: string[] }[];
      imagePrompts: string[];
    }>(
      'You are an elite Meta Ads campaign strategist. Return ONLY valid JSON.',
      `Based on the following business brief and event theme, generate a comprehensive campaign strategy.

BUSINESS DETAILS:
${JSON.stringify(businessDetails, null, 2)}

${themeContext}

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "marketingStrategySummary": "2-3 sentence strategy overview",
  "creativeIdeas": "specific creative recommendations, highly tailored to the festival/event theme",
  "expectedROAS": 3.2,
  "expectedCTR": 2.1,
  "expectedCPC": 0.85,
  "campaignHealthPrediction": 82,
  "audience": "detailed audience description tailored to the theme",
  "interestTargeting": "comma-separated interest categories",
  "behaviors": "specific behavioral targeting",
  "lookalikeSuggestions": "lookalike audience recommendations",
  "placements": "recommended ad placements",
  "optimizationGoal": "optimization event",
  "budgetRecommendation": "budget strategy",
  "headlines": ["headline 1", "headline 2", "headline 3"],
  "primaryTexts": ["text 1", "text 2", "text 3"],
  "imagePrompts": ["A highly detailed AI image prompt describing a festival-themed ad visual for midjourney/dalle", "Another detailed image prompt for a different variant"],
  "contentCalendar": [
    {"day": "Monday", "type": "Educational", "caption": "...", "hashtags": ["#tag"]},
    {"day": "Tuesday", "type": "Product Showcase", "caption": "...", "hashtags": ["#tag"]},
    {"day": "Wednesday", "type": "Social Proof", "caption": "...", "hashtags": ["#tag"]},
    {"day": "Thursday", "type": "Engagement", "caption": "...", "hashtags": ["#tag"]},
    {"day": "Friday", "type": "Offer/CTA", "caption": "...", "hashtags": ["#tag"]}
  ]
}`,
      0.7,
      4096,
      'IntegrationsService.generateCampaignStrategy',
    );

    if (result) {
      this.logger.log('AI campaign strategy generated successfully');
      return result;
    }

    // Intelligent fallback
    const industry = businessDetails.industry || 'Retail';
    const budget = businessDetails.dailyBudget || 100;
    return {
      marketingStrategySummary: `For ${businessDetails.businessName || 'your business'} in ${industry}, we recommend a conversion-focused Meta Ads strategy combining Advantage+ Shopping Campaigns with manual interest targeting tailored for ${festivalTheme || 'your upcoming campaign'} to achieve optimal cost-per-acquisition.`,
      creativeIdeas: `Use lifestyle imagery with real customers, short video testimonials, and festive visuals related to ${festivalTheme || 'the season'}.`,
      expectedROAS: 3.2,
      expectedCTR: 1.8,
      expectedCPC: parseFloat((budget / 150).toFixed(2)),
      campaignHealthPrediction: 78,
      audience: `All genders, 25-45 years interested in ${industry} and ${festivalTheme || 'shopping'}`,
      interestTargeting: 'Shopping, Online retail, Brand awareness, Special events',
      behaviors: 'Engaged shoppers, Online buyers, Credit card holders',
      lookalikeSuggestions: 'Upload customer email list to create 1-2% Lookalike, then scale to 3-5%',
      placements: 'Facebook Feed, Instagram Feed, Instagram Reels, Stories',
      optimizationGoal: businessDetails.objective === 'LEAD_GEN' ? 'Lead generation' : 'Purchase conversions',
      budgetRecommendation: `Start with ₹${budget}/day, scale by 20% every 3 days when ROAS exceeds target.`,
      headlines: [
        `Shop ${industry} — ${festivalTheme ? festivalTheme + ' Special' : 'Free Delivery'}`,
        `Limited Time: ${festivalTheme || 'Premium'} Quality at Best Price`,
        `Best Choice for Modern Buyers`,
        `Celebrate ${festivalTheme || 'Today'} with Exclusive Deals`,
      ],
      primaryTexts: [
        `Looking for the best in ${industry}? We've got exactly what you need. Shop our ${festivalTheme || 'premium'} collection and experience quality that speaks for itself. Free returns guaranteed.`,
        `Why settle for ordinary when extraordinary is just a click away? Our ${industry} products are perfect for ${festivalTheme || 'you'}. Order today and see the difference.`,
      ],
      imagePrompts: [
        `High-quality commercial photography for ${industry} featuring a ${festivalTheme || 'beautiful'} theme, vibrant colors, premium lighting, 4k`,
        `Clean, minimalist ${industry} flatlay with subtle ${festivalTheme || 'seasonal'} props, professional studio lighting, 8k resolution`
      ],
      contentCalendar: [
        { day: 'Monday', type: 'Educational', caption: `Did you know? Our product can transform your daily routine. Here's how → #MondayMotivation #${industry.replace(/\s/g, '')}`, hashtags: ['#MondayMotivation', '#Tips'] },
        { day: 'Tuesday', type: 'Product Showcase', caption: `Introducing our bestseller. Perfect for ${festivalTheme || 'everyone'}. Shop link in bio! 🛒 #NewArrival`, hashtags: ['#NewArrival', '#ProductLaunch'] },
        { day: 'Wednesday', type: 'Social Proof', caption: `"This changed everything for me!" ⭐⭐⭐⭐⭐ — Real review from a happy customer. Read more stories at our link. #CustomerLove`, hashtags: ['#CustomerReview', '#Testimonial'] },
        { day: 'Thursday', type: 'Engagement', caption: `Quick question for our community 👇 Which feature matters most to you? Comment below! Your answer shapes our next launch. #CommunityFirst`, hashtags: ['#Community', '#Question'] },
        { day: 'Friday', type: 'Offer/CTA', caption: `Friday Flash Sale! 🔥 Limited hours only. Use code FRIDAY15 for 15% off your order. Link in bio. Don't wait — stocks are limited! #FridayOffer`, hashtags: ['#FlashSale', '#FridayDeal'] },
      ],
    };
  }

  // ─── Meta Auth & Connection Layer ─────────────────────────────────────────────

  getMetaAuthUrl(businessId: string, customRedirectUri?: string): string {
    const appId = process.env.META_APP_ID;
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const redirectUri = customRedirectUri || process.env.META_REDIRECT_URI || `${frontendUrl}/meta/callback`;
    const state = Buffer.from(JSON.stringify({ businessId, ts: Date.now() })).toString('base64');
    
    if (this.isMock) {
      return `${redirectUri}?code=mock_oauth_code_12345&state=${state}`;
    }
    // Verified against the live Graph API: without pages_manage_posts a Page
    // publish is rejected, and reading lead forms returns
    // "(#200) Requires pages_manage_ads permission to manage the object".
    const defaultScopes = [
      'ads_management',
      'ads_read',
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',   // required to publish to a Facebook Page
      'pages_manage_ads',     // required to read the Page's lead forms
      'leads_retrieval',      // required to read the leads themselves
      'instagram_basic',
      'instagram_content_publish',
    ];
    const scopesStr = process.env.META_SCOPES || defaultScopes.join(',');
    return `${FACEBOOK_DIALOG_BASE}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopesStr}&response_type=code&state=${state}&auth_type=rerequest`;
  }

  async connectMeta(code: string, businessId: string, customRedirectUri?: string) {
    const exchangeKey = `${businessId}:${code}`;
    const existingExchange = this.metaOAuthExchanges.get(exchangeKey);
    if (existingExchange) {
      this.logger.warn(`Ignoring duplicate Meta OAuth callback for business ${businessId}`);
      return existingExchange;
    }

    const exchange = this.connectMetaOnce(code, businessId, customRedirectUri);
    this.metaOAuthExchanges.set(exchangeKey, exchange);

    try {
      const result = await exchange;

      // Meta rejects an authorization code the second time it is presented
      // ("This authorization code has been used"). The entry used to be
      // dropped as soon as the exchange settled, so a page refresh on
      // /meta/callback — or any second delivery of the same code — replayed it
      // and surfaced that error even though the account had connected fine.
      // Hold a successful result briefly and replay it instead of Meta.
      setTimeout(
        () => this.metaOAuthExchanges.delete(exchangeKey),
        META_OAUTH_REPLAY_WINDOW_MS,
      ).unref?.();

      return result;
    } catch (err) {
      // A genuine failure must stay retryable, so forget it immediately.
      this.metaOAuthExchanges.delete(exchangeKey);
      throw err;
    }
  }

  private async connectMetaOnce(code: string, businessId: string, customRedirectUri?: string) {
    if (this.isMock || code.startsWith('mock_') || code.startsWith('oauth_code_test_')) {
      this.logger.log(`[MOCK] Connecting Meta for business ${businessId}`);
      const mockMetaUser = 'mock_meta_user_123';
      const mockIgId = 'mock_ig_business_123';
      const mockToken = 'mock_long_lived_user_access_token_60days';

      await this.firebase.updateBusiness(businessId, {
        metaUserId: mockMetaUser,
        facebookUserName: 'Mock Angel Rajput',
        metaPageId: 'page_mock_123',
        metaPageName: 'Mock Page',
        metaIgBusinessAccountId: mockIgId,
        metaAdAccountId: 'act_mock_123456',
        metaAccessToken: mockToken,
        metaTokenExpiry: new Date(Date.now() + 60 * 86400 * 1000),
      });
      return { success: true, message: 'Meta account connected (Mock mode)' };
    }

    try {
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const redirectUri = customRedirectUri || process.env.META_REDIRECT_URI || `${frontendUrl}/meta/callback`;

      if (!appId || !appSecret) {
        throw new HttpException('META_APP_ID or META_APP_SECRET missing in backend environment', HttpStatus.BAD_REQUEST);
      }

      // 1. Exchange code for short-lived user token
      this.logger.log(`Exchanging OAuth code for Meta access token for business ${businessId}`);
      const tokenRes = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
        params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
      });
      let accessToken = tokenRes.data.access_token;

      // 2. Exchange short-lived token for long-lived user token (~60 days)
      const longLivedRes = await axios.get(
        `${GRAPH_API_BASE}/oauth/access_token`,
        { params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: accessToken } },
      );
      accessToken = longLivedRes.data.access_token;
      const expiry = longLivedRes.data.expires_in
        ? new Date(Date.now() + longLivedRes.data.expires_in * 1000)
        : null;

      // 3. Get user profile
      const userRes = await axios.get(
        `${GRAPH_API_BASE}/me`,
        { params: { fields: 'id,name,email', access_token: accessToken } },
      );
      const metaUserId = userRes.data.id;
      const facebookUserName = userRes.data.name;

      // 3.5 Developer Mode Debug Logging: Query granted permissions
      try {
        const permRes = await axios.get(`${GRAPH_API_BASE}/me/permissions`, {
          params: { access_token: accessToken },
        });
        const permissionsData: { permission: string; status: string }[] = permRes.data?.data || [];
        const granted = permissionsData.filter(p => p.status === 'granted').map(p => p.permission);
        const declinedOrMissing = permissionsData.filter(p => p.status !== 'granted').map(p => `${p.permission} (${p.status})`);

        this.logger.log(`[Meta OAuth Debug] Active Granted Permissions (${granted.length}): ${granted.join(', ')}`);
        if (declinedOrMissing.length > 0) {
          this.logger.warn(`[Meta OAuth Debug] Declined/Missing Permissions (${declinedOrMissing.length}): ${declinedOrMissing.join(', ')}`);
        }

        const requiredPermissions = [
          'ads_management',
          'ads_read',
          'business_management',
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'leads_retrieval',
          'instagram_basic',
          'instagram_content_publish',
        ];
        const missingRequired = requiredPermissions.filter(req => !granted.includes(req));
        if (missingRequired.length > 0) {
          this.logger.warn(`[Meta OAuth Developer Mode Gap] Missing required scope(s): ${missingRequired.join(', ')}. Reconnect with auth_type=rerequest and ensure the user is an app Administrator.`);
        }
        const missingAdsPermissions = ['ads_management', 'ads_read'].filter(permission => !granted.includes(permission));
        if (missingAdsPermissions.length > 0) {
          this.logger.warn(`[Meta Marketing API setup required] Missing ${missingAdsPermissions.join(', ')}. In developers.facebook.com, add the Marketing API product to this Business app, add the user under App Roles > Administrators, then reconnect and grant the requested permissions.`);
        }
      } catch (permErr: any) {
        this.logger.warn(`[Meta OAuth Debug] Could not fetch /me/permissions: ${permErr.response?.data?.error?.message || permErr.message}`);
      }

      // 4. Fetch Pages and Instagram Accounts
      const { pages, instagramAccounts } = await this.fetchAllMetaPagesAndInstagramAccounts(accessToken);
      const adAccounts = await this.fetchAllMetaAdAccounts(accessToken);

      // These used to fall back to hardcoded demo IDs ('page_987654321',
      // 'ig_554433221', 'act_10158291038471') when the Graph API returned
      // nothing. A connection that found no Page still reported success and
      // wrote unusable IDs to Firestore, so the UI showed "Connected" while
      // every later publish, lead fetch and campaign call silently targeted
      // objects that do not exist. Fail here, where the cause is obvious.
      const firstPage = pages[0];
      if (!firstPage?.id) {
        throw new HttpException(
          'Signed in to Meta, but no Facebook Page came back for this account. ' +
            'Check that you granted Page access during login and that your Facebook account manages at least one Page, then reconnect.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const metaPageId = firstPage.id;
      const metaPageName = firstPage.name || 'Untitled Page';
      const metaPageAccessToken = firstPage.accessToken || accessToken;

      // Instagram and ad accounts are genuinely optional at connect time — a
      // business may not have linked one yet. Store null rather than a fake id
      // so the features that need them can report the real reason.
      const metaIgBusinessAccountId =
        instagramAccounts[0]?.id || firstPage.instagram_business_account?.id || null;
      const metaAdAccountId = adAccounts[0]?.id || null;

      if (!metaIgBusinessAccountId) {
        this.logger.warn(
          `[Meta Connect] No Instagram business account linked for business ${businessId}. Instagram publishing will be unavailable until one is connected to the Page.`,
        );
      }
      if (!metaAdAccountId) {
        this.logger.warn(
          `[Meta Connect] No ad account returned for business ${businessId}. Paid campaign features will be unavailable until an ad account is granted to this app.`,
        );
      }

      // Save everything to Firestore
      await this.firebase.updateBusiness(businessId, {
        metaUserId,
        facebookUserName,
        metaPageId,
        metaPageName,
        metaIgBusinessAccountId,
        metaAdAccountId,
        metaAccessToken: accessToken,
        metaPageAccessToken,
        metaTokenExpiry: expiry,
        selectedAdAccountId: metaAdAccountId,
        selectedPageId: metaPageId,
        selectedInstagramAccountId: metaIgBusinessAccountId,
      });

      // Store in workspace document via WorkspacesDao
      if (this.firebase.workspacesDao) {
        try {
          await this.firebase.workspacesDao.update(businessId, {
            metaPageId,
            metaPageName,
            metaIgBusinessAccountId,
            metaAdAccountId,
            metaAccessToken: accessToken,
            metaPageAccessToken,
            metaTokenExpiry: expiry,
          });
        } catch (e: any) {
          this.logger.warn(`Could not update workspace via WorkspacesDao: ${e.message}`);
        }
      }

      // Also store in User's Firestore Profile via UsersDao if owner ID exists
      const workspaceDoc = (await this.firebase.workspacesDao?.findById(businessId)) || (await this.firebase.getBusinessById(businessId));
      const liveOwnerId = workspaceDoc?.ownerId || (workspaceDoc as any)?.memberIds?.[0];
      if (liveOwnerId && this.firebase.usersDao) {
        try {
          await this.firebase.usersDao.update(liveOwnerId, {
            metaAccessToken: accessToken,
            metaIgBusinessAccountId,
            updatedAt: new Date(),
          } as any);
        } catch (e: any) {
          this.logger.warn(`Could not update user profile via UsersDao: ${e.message}`);
        }
      }

      // Also store in dedicated metaAccounts collection
      await this.firebase.upsertMetaAccount(businessId, {
        metaUserId,
        facebookUserName,
        accessToken,
        tokenExpiry: expiry,
        pages,
        adAccounts,
      });

      return {
        success: true,
        message: 'Meta connected successfully',
        facebookUserName,
        pagesCount: pages.length,
        adAccountsCount: adAccounts.length,
      };
    } catch (error: any) {
      const metaError = error.response?.data?.error;
      if ([10, 200].includes(Number(metaError?.code))) {
        this.logger.error(
          `[Meta Marketing API permission error ${metaError.code}] ${metaError.message}. Add the Marketing API product in developers.facebook.com, verify the app type is Business, add the Facebook user under App Roles > Administrators, then reconnect and approve ads_management and ads_read.`,
        );
      }
      this.logger.error('Failed to connect Meta', error.response?.data || error.message);
      throw new HttpException(
        error.response?.data?.error?.message || 'Failed to authenticate with Meta',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async getMetaStatus(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    return {
      connected: !!business.metaAccessToken,
      facebookUserName: business.facebookUserName || null,
      facebookUserId: business.metaUserId || null,
      pageName: business.metaPageName || null,
      pageId: business.metaPageId || null,
      adAccountId: business.metaAdAccountId || null,
      igBusinessAccountId: business.metaIgBusinessAccountId || null,
      selectedAdAccountId: business.selectedAdAccountId || null,
      selectedPageId: business.selectedPageId || null,
      selectedInstagramAccountId: business.selectedInstagramAccountId || null,
    };
  }

  async getMetaPages(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'mock_page_123', name: 'My Demo Business Page', category: 'Retail', followers: 1250 },
        { id: 'mock_page_456', name: 'Brand Showcase Page', category: 'E-commerce', followers: 890 },
      ];
    }

    if (!business.metaAccessToken) {
      throw new HttpException(
        'Meta is not connected for this business. Open Connect Meta and authorise your Facebook account.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const res = await axios.get(
        `${GRAPH_API_BASE}/me/accounts`,
        {
          params: {
            access_token: business.metaAccessToken,
            fields: 'id,name,category,followers_count,access_token,instagram_business_account',
          },
        },
      );
      const data = res.data.data || [];

      // Never return the Page access_token to a client. This endpoint has no
      // auth guard, so echoing Meta's raw payload handed anyone who knew a
      // businessId a working Facebook Page token. The frontend only needs the
      // id and name to populate its dropdown.
      return data.map((p: any) => ({
        id: p.id,
        name: p.name || 'Facebook Page',
        category: p.category || 'General',
        followers_count: p.followers_count ?? 0,
        instagram_business_account: p.instagram_business_account
          ? { id: p.instagram_business_account.id }
          : undefined,
      }));
    } catch (err: any) {
      // Returning a placeholder "Brand Facebook Page" here put a page that does
      // not exist into the user's dropdown.
      const detail = describeMetaError(err);
      this.logger.error(`Failed to fetch Meta pages for business ${businessId}: ${detail}`);
      throw new HttpException(`Could not load your Facebook Pages: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  private async fetchAllMetaAdAccounts(accessToken: string): Promise<any[]> {
    const accountsMap = new Map<string, any>();
    const fields = 'id,name,currency,account_status';

    if (process.env.USE_MOCK_META === 'true') {
      return [
        { id: 'act_122106351009402042', name: 'Primary Ad Account (Active)', currency: 'INR', account_status: 1, isMockFallback: true },
      ];
    }

    // 1. Fetch personally owned ad accounts
    try {
      const res = await axios.get(`${GRAPH_API_BASE}/me/adaccounts`, {
        params: { access_token: accessToken, fields },
      });
      const data = res.data?.data || [];
      for (const acc of data) accountsMap.set(acc.id, acc);
    } catch (err: any) {
      this.logger.warn('Failed fetching /me/adaccounts (OAuthException/Permissions error): ' + (err.response?.data?.error?.message || err.message));
    }

    // 2. Fetch businesses
    let businesses: any[] = [];
    try {
      const res = await axios.get(`${GRAPH_API_BASE}/me/businesses`, {
        params: { access_token: accessToken, fields: 'id,name' },
      });
      businesses = res.data?.data || [];
    } catch (err: any) {
      this.logger.warn('Failed fetching /me/businesses (OAuthException/Permissions error): ' + (err.response?.data?.error?.message || err.message));
    }

    // 3. Fetch ad accounts for each business
    for (const biz of businesses) {
      try {
        const ownedRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/owned_ad_accounts`, {
          params: { access_token: accessToken, fields },
        });
        const owned = ownedRes.data?.data || [];
        for (const acc of owned) accountsMap.set(acc.id, acc);

        const clientRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/client_ad_accounts`, {
          params: { access_token: accessToken, fields },
        });
        const client = clientRes.data?.data || [];
        for (const acc of client) accountsMap.set(acc.id, acc);
      } catch (err: any) {
        this.logger.warn(`Failed fetching ad accounts for business ${biz.id}: ` + (err.response?.data?.error?.message || err.message));
      }
    }

    const accountsList = Array.from(accountsMap.values());
    if (accountsList.length === 0) {
      // An empty list is a real answer: the user has granted no ad account, or
      // ads_management was not approved. Injecting a fabricated account here
      // put an ad account the user does not own into the picker, and selecting
      // it wrote that fake id into their record permanently.
      this.logger.warn('[Meta] No ad accounts returned. The user may not have granted ads_management, or owns no ad account.');
    }

    return accountsList;
  }

  async getMetaAdAccounts(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'act_122106351009402042', name: 'Primary Ad Account (Active)', currency: 'INR', account_status: 1, isMockFallback: true },
      ];
    }

    if (!business.metaAccessToken) {
      throw new HttpException(
        'Meta is not connected for this workspace. Connect a Meta account first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.fetchAllMetaAdAccounts(business.metaAccessToken);
    } catch (err: any) {
      // Previously returned a fabricated ad account here, so a permissions or
      // network failure looked like a successful list. Surface the real error.
      this.logger.error(`[Meta] Failed to list ad accounts for ${businessId}: ${describeMetaError(err)}`);
      throw new HttpException(
        `Could not load your Meta ad accounts: ${describeMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private async fetchAllMetaPagesAndInstagramAccounts(accessToken: string): Promise<{ pages: any[]; instagramAccounts: any[] }> {
    const pagesMap = new Map<string, any>();
    const igAccountsMap = new Map<string, any>();
    const fields = 'id,name,access_token,category';

    if (process.env.USE_MOCK_META === 'true') {
      return {
        pages: [{ id: 'page_1009827341', name: 'Brand Facebook Page', accessToken: 'mock_token', category: 'Brand', isMockFallback: true }],
        instagramAccounts: [{ id: 'ig_7766554433', username: 'brand_official', name: 'Brand Official', pageId: 'page_1009827341', isMockFallback: true }],
      };
    }

    // 1. Fetch personal pages (/me/accounts)
    try {
      const res = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
        params: { access_token: accessToken, fields },
      });
      const data = res.data?.data || [];
      for (const p of data) pagesMap.set(p.id, p);
    } catch (err: any) {
      this.logger.warn('Failed fetching /me/accounts (OAuthException/Permissions error): ' + (err.response?.data?.error?.message || err.message));
    }

    // 2. Fetch businesses (/me/businesses)
    let businesses: any[] = [];
    try {
      const res = await axios.get(`${GRAPH_API_BASE}/me/businesses`, {
        params: { access_token: accessToken, fields: 'id,name' },
      });
      businesses = res.data?.data || [];
    } catch (err: any) {
      this.logger.warn('Failed fetching /me/businesses (OAuthException/Permissions error): ' + (err.response?.data?.error?.message || err.message));
    }

    // 3. Fetch owned_pages, client_pages, and instagram_accounts for each business portfolio
    for (const biz of businesses) {
      try {
        const ownedRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/owned_pages`, {
          params: { access_token: accessToken, fields },
        });
        const owned = ownedRes.data?.data || [];
        for (const p of owned) pagesMap.set(p.id, p);
      } catch (err: any) {
        this.logger.warn(`Failed fetching owned_pages for business ${biz.id}: ${err.message}`);
      }

      try {
        const clientRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/client_pages`, {
          params: { access_token: accessToken, fields },
        });
        const client = clientRes.data?.data || [];
        for (const p of client) pagesMap.set(p.id, p);
      } catch (err: any) {
        this.logger.warn(`Failed fetching client_pages for business ${biz.id}: ${err.message}`);
      }

      try {
        const igRes = await axios.get(`${GRAPH_API_BASE}/${biz.id}/instagram_accounts`, {
          params: { access_token: accessToken, fields: 'id,username,name,profile_picture_url' },
        });
        const bizIgs = igRes.data?.data || [];
        for (const ig of bizIgs) {
          igAccountsMap.set(ig.id, {
            id: ig.id,
            username: ig.username || ig.name || `@ig_${ig.id}`,
            name: ig.name || ig.username || 'Instagram Account',
            profilePictureUrl: ig.profile_picture_url || '',
            pageId: '',
          });
        }
      } catch (err: any) {
        this.logger.warn(`Failed fetching instagram_accounts for business ${biz.id}: ${err.message}`);
      }
    }

    // 4. Extract linked Instagram accounts from pages
    const pageList = Array.from(pagesMap.values());
    for (const p of pageList) {
      let ig = p.instagram_business_account || p.connected_instagram_account;
      if (!ig) {
        try {
          const pageToken = p.access_token || accessToken;
          const directRes = await axios.get(`${GRAPH_API_BASE}/${p.id}`, {
            params: {
              access_token: pageToken,
              fields: 'instagram_business_account{id,username,name,profile_picture_url},connected_instagram_account{id,username,name}',
            },
          });
          ig = directRes.data?.instagram_business_account || directRes.data?.connected_instagram_account;
        } catch (e: any) {
          // Silent fallback
        }
      }

      if (ig) {
        igAccountsMap.set(ig.id, {
          id: ig.id,
          username: ig.username || ig.name || `@ig_${ig.id}`,
          name: ig.name || p.name,
          profilePictureUrl: ig.profile_picture_url || '',
          pageId: p.id,
        });
      }
    }

    // No access token in the response — see the note in getMetaPages. This
    // endpoint is unauthenticated, so a token here is a credential leak.
    let pages: any[] = pageList.map(p => ({
      id: p.id,
      name: p.name || 'Facebook Page',
      category: p.category || 'General',
      isMockFallback: !!p.isMockFallback,
    }));

    let instagramAccounts = Array.from(igAccountsMap.values()).map(i => ({
      ...i,
      isMockFallback: !!i.isMockFallback,
    }));

    // Empty lists are returned as-is. Injecting a fake Page or IG profile here
    // meant a user with no granted Page still saw one to pick, and publishing
    // then targeted an object that does not exist.
    if (pages.length === 0) {
      this.logger.warn('[Meta] No Pages returned — the user may not have granted pages_show_list, or manages no Page.');
    }
    if (instagramAccounts.length === 0) {
      this.logger.warn('[Meta] No Instagram business accounts returned — none linked to the connected Page(s).');
    }

    return { pages, instagramAccounts };
  }

  async getMetaChannels(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    // Local mock-mode only. Never served on a live connection.
    const mockChannels = {
      isMockFallback: true,
      adAccounts: [
        { id: 'act_122106351009402042', name: 'Primary Ad Account (Active)', currency: 'INR', account_status: 1, isMockFallback: true },
      ],
      pages: [
        { id: 'page_1009827341', name: 'Brand Facebook Page', accessToken: 'mock_token', category: 'Brand', isMockFallback: true },
      ],
      instagramAccounts: [
        { id: 'ig_7766554433', username: 'brand_official', name: 'Brand Official', pageId: 'page_1009827341', isMockFallback: true },
      ],
    };

    if (this.isMock) {
      return mockChannels;
    }

    if (!business.metaAccessToken) {
      // Serving the demo bundle here told the UI a disconnected workspace had
      // live Meta assets. Report the real state instead.
      return { isMockFallback: false, connected: false, adAccounts: [], pages: [], instagramAccounts: [] };
    }

    const accessToken = business.metaAccessToken;

    try {
      const [adAccountsResult, channelsResult] = await Promise.allSettled([
        this.fetchAllMetaAdAccounts(accessToken),
        this.fetchAllMetaPagesAndInstagramAccounts(accessToken),
      ]);

      let adAccounts: any[] = [];
      if (adAccountsResult.status === 'fulfilled') {
        adAccounts = adAccountsResult.value || [];
      }

      let pages: any[] = [];
      let instagramAccounts: any[] = [];
      if (channelsResult.status === 'fulfilled') {
        pages = channelsResult.value.pages || [];
        instagramAccounts = channelsResult.value.instagramAccounts || [];
      }

      // Empty lists are reported honestly. Substituting the demo bundle here
      // showed a user assets they do not own; selecting one wrote a fabricated
      // id into their record and every later Meta call targeted nothing.
      if (adAccountsResult.status === 'rejected') {
        this.logger.error(`[Meta] Ad account fetch failed for ${businessId}: ${describeMetaError(adAccountsResult.reason)}`);
      }
      if (channelsResult.status === 'rejected') {
        this.logger.error(`[Meta] Page/Instagram fetch failed for ${businessId}: ${describeMetaError(channelsResult.reason)}`);
      }

      const isMockFallback = adAccounts.some(a => a.isMockFallback) || pages.some(p => p.isMockFallback) || instagramAccounts.some(i => i.isMockFallback);

      return {
        isMockFallback: !!isMockFallback,
        adAccounts: adAccounts.map(a => ({
          id: a.id,
          name: a.name || `Ad Account (${a.id})`,
          currency: a.currency || 'INR',
          account_status: a.account_status || 1,
          isMockFallback: !!a.isMockFallback,
        })),
        // No access token in the response — the browser never needs it, and
        // shipping one puts a live credential into client memory and logs.
        pages: pages.map(p => ({
          id: p.id,
          name: p.name || 'Facebook Page',
          category: p.category || '',
          isMockFallback: !!p.isMockFallback,
        })),
        instagramAccounts: instagramAccounts.map(i => ({
          id: i.id,
          username: i.username || `@ig_${i.id}`,
          name: i.name || '',
          pageId: i.pageId || '',
          isMockFallback: !!i.isMockFallback,
        })),
      };
    } catch (err: any) {
      // Was returning the demo bundle, so an outage looked like a healthy
      // account list. Fail loudly instead.
      this.logger.error(`[Meta] Error fetching channels for ${businessId}: ${describeMetaError(err)}`);
      throw new HttpException(
        `Could not load your Meta accounts: ${describeMetaError(err)}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Publishes a post to Instagram via the 2-step Instagram Graph API container workflow:
   *   Step 1: POST /{ig_user_id}/media -> creates media container, returns creation_id
   *   Step 2: POST /{ig_user_id}/media_publish -> publishes container, returns instagram_post_id
   */
  /**
   * Meta fetches the image from the URL we hand it — it never receives the
   * bytes. So any URL that only resolves on our own machine fails on Meta's
   * side with an unhelpful error. Instagram additionally refuses data: URIs
   * and requires a publicly reachable https link.
   *
   * Returns an explanatory message when the URL cannot work, or null when fine.
   */
  private describeUnreachableImage(imageUrl?: string | null): string | null {
    if (!imageUrl) return null;

    if (imageUrl.startsWith('data:')) {
      return 'This post uses an inline image preview, which Meta cannot download. Regenerate the image so it is saved to a public URL first.';
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\//i.test(imageUrl)) {
      return 'This post\'s image is stored at a local address that Meta cannot reach. Regenerate the image, then publish again.';
    }
    if (imageUrl.startsWith('http://')) {
      return 'This post\'s image uses an insecure http link. Meta requires https. Regenerate the image, then publish again.';
    }
    return null;
  }

  async publishInstagramPost(
    businessId: string,
    caption: string,
    imageUrl?: string,
  ): Promise<{ success: boolean; instagramPostId?: string; containerId?: string; error?: string }> {
    this.logger.log(`[IntegrationsService] Publishing to Instagram for business ${businessId}`);

    // Fetch workspace and user documents from Firestore
    const workspace = (await this.firebase.workspacesDao?.findById(businessId)) || (await this.firebase.getBusinessById(businessId));
    if (!workspace) {
      throw new HttpException(`Workspace ${businessId} not found in Firestore`, HttpStatus.NOT_FOUND);
    }

    const ownerId = workspace.ownerId || (workspace as any)?.memberIds?.[0];
    const userDoc = ownerId && this.firebase.usersDao ? await this.firebase.usersDao.findById(ownerId) : null;

    const accessToken = workspace.metaAccessToken || userDoc?.metaAccessToken;
    // Honour the account the user actually selected first.
    const igAccountId = workspace.selectedInstagramAccountId || workspace.metaIgBusinessAccountId || userDoc?.metaIgBusinessAccountId;

    if (!this.isMock) {
      // A missing token used to fall into the mock branch below and report a
      // successful publish that never happened.
      if (!accessToken || accessToken.startsWith('mock_')) {
        return {
          success: false,
          error: 'Meta is not connected for this business. Open Connect Meta and authorise your Facebook account.',
        };
      }
      if (!igAccountId) {
        return {
          success: false,
          error: 'No Instagram Business account selected. Pick one on the Connect Meta screen.',
        };
      }
      const unreachableIg = this.describeUnreachableImage(imageUrl);
      if (unreachableIg) {
        return { success: false, error: unreachableIg };
      }
    }

    if (this.isMock || !accessToken || accessToken.startsWith('mock_')) {
      this.logger.log(`[MOCK] Simulated Instagram 2-step publish for business ${businessId}`);
      return {
        success: true,
        containerId: `mock_container_id_${Date.now()}`,
        instagramPostId: `mock_ig_post_${Date.now()}`,
      };
    }

    if (!igAccountId) {
      throw new HttpException('Instagram Business Account ID not connected or found in Firestore profile', HttpStatus.BAD_REQUEST);
    }

    if (!imageUrl) {
      throw new HttpException('Image URL (Firebase Storage) is required for Instagram Graph API post creation', HttpStatus.BAD_REQUEST);
    }

    try {
      // Step 1: POST /{ig_user_id}/media (Container Upload)
      const containerRes = await axios.post(
        `${GRAPH_API_BASE}/${igAccountId}/media`,
        null,
        {
          params: {
            image_url: imageUrl,
            caption,
            access_token: accessToken,
          },
        },
      );

      const containerId = containerRes.data?.id;
      if (!containerId) {
        throw new Error('Failed to obtain container creation_id from Instagram Graph API /media');
      }

      this.logger.log(`[Instagram Publishing] Media container created successfully: ${containerId}`);

      // Step 2: POST /{ig_user_id}/media_publish (Container Publish)
      const publishRes = await axios.post(
        `${GRAPH_API_BASE}/${igAccountId}/media_publish`,
        null,
        {
          params: {
            creation_id: containerId,
            access_token: accessToken,
          },
        },
      );

      const instagramPostId = publishRes.data?.id;
      this.logger.log(`[Instagram Publishing] Media published successfully! Instagram Post ID: ${instagramPostId}`);

      return {
        success: true,
        containerId,
        instagramPostId,
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.error?.message || error.message;
      this.logger.error(`[Instagram Publishing Failure] ${errorMsg}`, error.response?.data);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Publishes a post to Facebook Page.
   */
  async publishPagePost(
    businessId: string,
    caption: string,
    imageUrl?: string,
  ): Promise<{ success: boolean; pagePostId?: string; error?: string }> {
    const workspace = (await this.firebase.workspacesDao?.findById(businessId)) || (await this.firebase.getBusinessById(businessId));
    const accessToken = workspace?.metaPageAccessToken || workspace?.metaAccessToken;
    // The page the user explicitly picked wins over whatever was captured at
    // OAuth time, otherwise changing the selection had no effect.
    const pageId = workspace?.selectedPageId || workspace?.metaPageId;

    if (this.isMock) {
      return { success: true, pagePostId: `mock_fb_post_${Date.now()}` };
    }

    // Previously a missing token also returned a fake success, so the UI
    // reported "Posted!" while nothing had been published anywhere.
    if (!accessToken || accessToken.startsWith('mock_')) {
      return {
        success: false,
        error: 'Meta is not connected for this business. Open Connect Meta and authorise your Facebook account.',
      };
    }

    if (!pageId) {
      return { success: false, error: 'No Facebook Page selected. Choose a Page on the Connect Meta screen.' };
    }

    const unreachable = this.describeUnreachableImage(imageUrl);
    if (unreachable) {
      return { success: false, error: unreachable };
    }

    try {
      const endpoint = imageUrl
        ? `${GRAPH_API_BASE}/${pageId}/photos`
        : `${GRAPH_API_BASE}/${pageId}/feed`;

      const params: any = { access_token: accessToken, message: caption };
      if (imageUrl) params.url = imageUrl;

      const res = await axios.post(endpoint, null, { params });
      return { success: true, pagePostId: res.data?.id || res.data?.post_id };
    } catch (error: any) {
      return { success: false, error: error.response?.data?.error?.message || error.message };
    }
  }

  async getMetaInstagramAccounts(businessId: string, pageId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'mock_ig_123', username: '@mybrand_official', followers: 5200, profile_picture_url: '' },
      ];
    }

    if (!business.metaAccessToken) {
      throw new HttpException('Meta account not connected', HttpStatus.UNAUTHORIZED);
    }

    try {
      const res = await axios.get(
        `${GRAPH_API_BASE}/${pageId}`,
        {
          params: {
            access_token: business.metaAccessToken,
            fields: 'instagram_business_account{id,username,followers_count,profile_picture_url}',
          },
        },
      );
      const igAccount = res.data.instagram_business_account;
      return igAccount ? [igAccount] : [];
    } catch (err: any) {
      this.logger.warn('Failed to fetch IG accounts: ' + err.message);
      return [];
    }
  }

  async selectMetaAccounts(
    businessId: string,
    data: {
      adAccountId: string;
      adAccountName: string;
      pageId: string;
      pageName: string;
      instagramAccountId?: string;
      instagramAccountName?: string;
    },
  ) {
    const selection = {
      selectedAdAccountId: data.adAccountId,
      metaAdAccountId: data.adAccountId,
      selectedAdAccountName: data.adAccountName,
      selectedPageId: data.pageId,
      metaPageId: data.pageId,
      metaPageName: data.pageName,
      selectedInstagramAccountId: data.instagramAccountId || null,
      selectedInstagramAccountName: data.instagramAccountName || null,
      metaIgBusinessAccountId: data.instagramAccountId || null,
    };

    await this.firebase.updateBusiness(businessId, selection);

    // Meta credentials live in BOTH `businesses` and `workspaces`, and every
    // publish path reads `workspaces` first. Writing the selection only to
    // `businesses` meant changing your Page silently did nothing — posts kept
    // going to whichever Page was auto-picked at connect time, forever.
    // Keep the two in step.
    if (this.firebase.workspacesDao) {
      try {
        await this.firebase.workspacesDao.update(businessId, selection as any);
      } catch (err: any) {
        this.logger.error(
          `[Meta] Selection saved to business ${businessId} but the workspace copy failed: ${err.message}. ` +
            'Publishing would keep using the previous Page — failing the request so the user can retry.',
        );
        throw new HttpException(
          'Could not save your account selection. Please try again.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    // Meta only delivers leadgen webhooks for a Page that the app has actually
    // subscribed. Without this the whole lead pipeline is silently dead: the
    // webhook handler, the CRM and the lead-assistant were all built and wired,
    // but Meta was never told to send anything, so no lead ever arrived.
    //
    // Saving the selection must never wait on Meta, though. Awaiting this
    // directly left the Save button spinning with no feedback whenever the
    // Graph API was slow. Race it against a short deadline: the common case
    // reports a real result, and a slow call carries on in the background
    // instead of holding up the user.
    const subscription = await Promise.race([
      this.subscribePageToLeadgen(businessId, data.pageId),
      new Promise<{ subscribed: boolean; error?: string; pending?: boolean }>((resolve) =>
        setTimeout(
          () => resolve({ subscribed: false, pending: true, error: 'Still being set up.' }),
          META_SUBSCRIBE_DEADLINE_MS,
        ).unref?.(),
      ),
    ]);

    return {
      success: true,
      message: 'Meta accounts configured successfully',
      leadWebhookSubscribed: subscription.subscribed,
      leadWebhookPending: (subscription as any).pending || false,
      leadWebhookError: subscription.error,
    };
  }

  /**
   * Subscribes the app to this Page's `leadgen` webhook field, so Meta pushes
   * new lead-form submissions to our webhook endpoint.
   *
   * Requires a PAGE access token (a user token is rejected), which is read
   * from /me/accounts for the Page the user just selected.
   *
   * A failure here is reported but not thrown: the rest of the connection —
   * publishing, insights — works regardless, and the user can retry from the
   * dashboard. Leads simply will not arrive until this succeeds.
   */
  /** Reads the stored Meta selection so the controller can resolve the Page. */
  async getBusinessForLeadSubscription(businessId: string): Promise<any> {
    return this.firebase.getBusinessById(businessId);
  }

  async subscribePageToLeadgen(
    businessId: string,
    pageId: string,
  ): Promise<{ subscribed: boolean; error?: string }> {
    if (this.isMock) return { subscribed: true };

    try {
      const business = await this.firebase.getBusinessById(businessId);
      const userToken = business?.metaAccessToken;
      if (!userToken || String(userToken).startsWith('mock_')) {
        return { subscribed: false, error: 'No Meta access token stored for this business.' };
      }

      // A Page subscription must be made with that Page's own token.
      const pagesRes = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
        params: { access_token: userToken, fields: 'id,access_token', limit: 200 },
        timeout: 15_000,
      });
      const page = (pagesRes.data?.data || []).find((p: any) => String(p.id) === String(pageId));
      const pageToken = page?.access_token;

      if (!pageToken) {
        return {
          subscribed: false,
          error: `No Page access token available for Page ${pageId}. Reconnect Meta and grant access to this Page.`,
        };
      }

      const res = await axios.post(
        `${GRAPH_API_BASE}/${pageId}/subscribed_apps`,
        null,
        {
          params: { subscribed_fields: 'leadgen', access_token: pageToken },
          timeout: 15_000,
        },
      );

      if (res.data?.success) {
        this.logger.log(`[Meta] Subscribed to leadgen webhooks for Page ${pageId} (business ${businessId})`);
        await this.firebase
          .updateBusiness(businessId, { leadWebhookSubscribedAt: new Date() })
          .catch(() => undefined);
        return { subscribed: true };
      }

      return { subscribed: false, error: 'Meta did not confirm the webhook subscription.' };
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message || err.message;
      this.logger.error(`[Meta] Could not subscribe Page ${pageId} to leadgen webhooks: ${detail}`);
      return { subscribed: false, error: detail };
    }
  }

  async disconnectMeta(businessId: string) {
    await this.firebase.updateBusiness(businessId, {
      metaUserId: null,
      facebookUserName: null,
      metaPageId: null,
      metaPageName: null,
      metaIgBusinessAccountId: null,
      metaAdAccountId: null,
      metaAccessToken: null,
      metaTokenExpiry: null,
      selectedAdAccountId: null,
      selectedAdAccountName: null,
      selectedPageId: null,
      selectedInstagramAccountId: null,
      selectedInstagramAccountName: null,
    });
    return { success: true, message: 'Meta integration disconnected successfully' };
  }

  // ─── Meta Campaign Publishing ─────────────────────────────────────────────────

  /**
   * Map our app objective to Meta API objective.
   * Supported: LEAD_GENERATION -> OUTCOME_LEADS, TRAFFIC -> OUTCOME_TRAFFIC, CONVERSIONS -> OUTCOME_SALES
   */
  private mapMetaObjective(objective: string): string {
    switch (objective) {
      case 'LEAD_GENERATION': return 'OUTCOME_LEADS';
      case 'TRAFFIC': return 'OUTCOME_TRAFFIC';
      case 'CONVERSIONS': return 'OUTCOME_SALES';
      default: return 'OUTCOME_LEADS';
    }
  }

  /**
   * Map our app objective to Meta optimization goal.
   */
  private mapOptimizationGoal(objective: string): string {
    switch (objective) {
      case 'LEAD_GENERATION': return 'LEAD_GENERATION';
      case 'TRAFFIC': return 'LINK_CLICKS';
      case 'CONVERSIONS': return 'OFFSITE_CONVERSIONS';
      default: return 'LEAD_GENERATION';
    }
  }

  async publishCampaignToMeta(
    campaignName: string,
    budget: number,
    objective: string,
    targeting: any,
    creative: any,
    businessId?: string,
  ) {
    this.logger.log(`Publishing Campaign to Meta. Objective: ${objective}. Mock: ${this.isMock}`);

    if (!this.isMock) {
      try {
        let business: any = null;
        if (businessId) {
          business = await this.firebase.getBusinessById(businessId);
        }
        // Always use THIS business's own credentials. Falling back to the
        // global env token silently ran one tenant's campaigns against another
        // account's ad account, and that env token is long expired anyway.
        const accessToken = business?.metaAccessToken;
        const adAccountId = business?.selectedAdAccountId || business?.metaAdAccountId;
        const pageId = business?.selectedPageId || business?.metaPageId;

        if (!accessToken || !adAccountId || !pageId) {
          throw new Error(
            'Meta is not connected for this business. Open Connect Meta, authorise your Facebook account, then select an Ad Account and Page.',
          );
        }

        const metaObjective = this.mapMetaObjective(objective);

        // 1. Create Campaign
        this.logger.log(`Creating campaign: ${campaignName} with objective ${metaObjective}`);
        const campaignRes = await axios.post(
          `${GRAPH_API_BASE}/${adAccountId}/campaigns`,
          {
            name: campaignName,
            objective: metaObjective,
            status: 'PAUSED',
            special_ad_categories: [],
          },
          { params: { access_token: accessToken } },
        );
        const metaCampaignId = campaignRes.data.id;
        this.logger.log(`Campaign created: ${metaCampaignId}`);

        // 2. Create Ad Set
        const billingEvent = objective === 'TRAFFIC' ? 'IMPRESSIONS' : 'IMPRESSIONS';
        const optimizationGoal = this.mapOptimizationGoal(objective);
        
        const adSetPayload: any = {
          name: `${campaignName} - Ad Set`,
          campaign_id: metaCampaignId,
          daily_budget: Math.round(budget * 100),
          billing_event: billingEvent,
          optimization_goal: optimizationGoal,
          targeting: {
            age_min: targeting.ageMin || 18,
            age_max: targeting.ageMax || 65,
            geo_locations: {
              countries: targeting.countries || ['US'],
            },
          },
          status: 'PAUSED',
        };

        // Add promoted_object for LEAD_GENERATION
        if (objective === 'LEAD_GENERATION') {
          adSetPayload.promoted_object = {
            page_id: pageId,
          };
        }

        this.logger.log(`Creating ad set for campaign ${metaCampaignId}`);
        const adSetRes = await axios.post(
          `${GRAPH_API_BASE}/${adAccountId}/adsets`,
          adSetPayload,
          { params: { access_token: accessToken } },
        );
        const metaAdSetId = adSetRes.data.id;
        this.logger.log(`Ad set created: ${metaAdSetId}`);

        // 3. Create Ad Creative
        const headline = creative?.headline || campaignName;
        const primaryText = creative?.primaryText || creative?.description || `Check out ${campaignName}`;
        const description = creative?.description || '';
        const cta = objective === 'LEAD_GENERATION' ? 'SIGN_UP' : 'LEARN_MORE';

        const creativePayload: any = {
          name: `${campaignName} - Creative`,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              link: 'https://www.example.com',
              message: primaryText,
              name: headline,
              description: description,
              call_to_action: {
                type: cta,
              },
            },
          },
        };

        this.logger.log(`Creating ad creative for ad set ${metaAdSetId}`);
        const creativeRes = await axios.post(
          `${GRAPH_API_BASE}/${adAccountId}/adcreatives`,
          creativePayload,
          { params: { access_token: accessToken } },
        );
        const metaCreativeId = creativeRes.data.id;
        this.logger.log(`Ad creative created: ${metaCreativeId}`);

        // 4. Create Ad
        this.logger.log(`Creating ad for ad set ${metaAdSetId} with creative ${metaCreativeId}`);
        const adRes = await axios.post(
          `${GRAPH_API_BASE}/${adAccountId}/ads`,
          {
            name: `${campaignName} - Ad`,
            adset_id: metaAdSetId,
            creative: { creative_id: metaCreativeId },
            status: 'PAUSED',
          },
          { params: { access_token: accessToken } },
        );
        const metaAdId = adRes.data.id;
        this.logger.log(`Ad created: ${metaAdId}`);

        return {
          success: true,
          metaCampaignId,
          metaAdSetId,
          metaCreativeId,
          metaAdId,
          syncStatus: 'CREATED_PAUSED',
        };
      } catch (err: any) {
        this.logger.error('Meta API publish error', err.response?.data || err.message);
        throw new HttpException(
          err.response?.data?.error?.message || 'Failed to publish campaign to Meta',
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    // Mock fallback
    return {
      success: true,
      metaCampaignId: `cmp_${Math.floor(100000000 + Math.random() * 900000000)}`,
      metaAdSetId: `as_${Math.floor(100000000 + Math.random() * 900000000)}`,
      metaCreativeId: `cr_${Math.floor(100000000 + Math.random() * 900000000)}`,
      metaAdId: `ad_${Math.floor(100000000 + Math.random() * 900000000)}`,
      syncStatus: 'SYNCHRONIZED',
    };
  }

  async launchMetaAdCampaign(businessId: string, campaignPayload: any) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business && !this.isMock) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    const accessToken = business?.metaAccessToken || 'mock_token';
    const adAccountId = business?.selectedAdAccountId || business?.metaAdAccountId || 'act_mock_12345';
    const pageId = business?.selectedPageId || business?.metaPageId || 'mock_page_123';

    if (!business?.metaAccessToken) {
      throw new HttpException(
        'Meta account is not connected. Open Connect Meta and authorise your Facebook account before launching a campaign.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    let launchResult: Awaited<ReturnType<typeof launchFullMetaCampaignHierarchy>>;
    try {
      launchResult = await launchFullMetaCampaignHierarchy({
      adAccountId,
      pageId,
      accessToken,
      campaignName: campaignPayload.campaignName || campaignPayload.name || 'AI Generated Meta Campaign',
      objective: campaignPayload.objective || 'OUTCOME_SALES',
      dailyBudget: campaignPayload.dailyBudget || campaignPayload.budget || 500,
      targeting: campaignPayload.targeting || {},
      primaryText: campaignPayload.primaryText || campaignPayload.copy || '',
      headline: campaignPayload.headline || '',
      description: campaignPayload.description || '',
      ctaType: campaignPayload.ctaType || 'LEARN_MORE',
      imageUrl: campaignPayload.bannerUrl || campaignPayload.imageUrl || null,
      status: campaignPayload.status || 'PAUSED',
      isMock: this.isMock || !accessToken || accessToken.startsWith('mock_'),
      });
    } catch (err: any) {
      // Report exactly what Meta rejected — "Request failed with status code 400"
      // gives the user nothing to act on.
      const detail = describeMetaError(err);
      this.logger.error(`Meta campaign launch failed for business ${businessId}: ${detail}`);
      throw new HttpException(`Meta rejected the campaign: ${detail}`, HttpStatus.BAD_GATEWAY);
    }

    // Save created campaign hierarchy to Firestore
    const campaignDoc = await this.firebase.createCampaign({
      businessId,
      name: campaignPayload.campaignName || 'AI Meta Campaign',
      status: launchResult.status || 'PAUSED',
      objective: campaignPayload.objective || 'OUTCOME_SALES',
      dailyBudget: campaignPayload.dailyBudget || 500,
      startDate: new Date(),
      metaCampaignId: launchResult.metaCampaignId,
      metaAdSetId: launchResult.metaAdSetId,
      metaCreativeId: launchResult.metaCreativeId,
      metaAdId: launchResult.metaAdId,
      imageHash: launchResult.imageHash,
      healthScore: 100.0,
    } as any);

    return {
      success: true,
      businessId,
      campaignDocId: campaignDoc.id,
      campaignId: launchResult.metaCampaignId,
      adSetId: launchResult.metaAdSetId,
      creativeId: launchResult.metaCreativeId,
      adId: launchResult.metaAdId,
      ...launchResult,
    };
  }

  // ─── Meta Business Managers ───────────────────────────────────────────────────

  async getMetaBusinessManagers(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'mock_bm_123', name: 'My Business Manager', business_id: '123456789' },
      ];
    }

    if (!business.metaAccessToken) {
      throw new HttpException('Meta account not connected', HttpStatus.UNAUTHORIZED);
    }

    try {
      const res = await axios.get(
        `${GRAPH_API_BASE}/me/businesses`,
        { params: { access_token: business.metaAccessToken } },
      );
      return res.data.data || [];
    } catch (err: any) {
      this.logger.error('Failed to fetch business managers', err.response?.data || err.message);
      throw new HttpException('Failed to fetch business managers from Meta API', HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Meta Campaign Listing ────────────────────────────────────────────────────

  async getMetaCampaigns(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'cmp_mock_1', name: 'Mock Campaign 1', status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: 5000 },
        { id: 'cmp_mock_2', name: 'Mock Campaign 2', status: 'PAUSED', objective: 'OUTCOME_SALES', daily_budget: 10000 },
      ];
    }

    if (!business.metaAccessToken) {
      throw new HttpException('Meta account not connected', HttpStatus.UNAUTHORIZED);
    }

    const adAccountId = business.selectedAdAccountId || business.metaAdAccountId;
    if (!adAccountId) {
      throw new HttpException('Ad Account not selected', HttpStatus.BAD_REQUEST);
    }

    try {
      const res = await axios.get(
        `${GRAPH_API_BASE}/${adAccountId}/campaigns`,
        {
          params: {
            access_token: business.metaAccessToken,
            fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time',
            limit: 50,
          },
        },
      );
      return res.data.data || [];
    } catch (err: any) {
      this.logger.error('Failed to fetch Meta campaigns', err.response?.data || err.message);
      throw new HttpException('Failed to fetch campaigns from Meta API', HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Meta Analytics / Insights ────────────────────────────────────────────────

  async getMetaAnalytics(businessId: string, campaignId?: string, datePreset?: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    // This business's own credentials only — never a shared env token or the
    // hardcoded ad account that used to sit in this fallback chain.
    const metaAccessToken = business.metaAccessToken;
    const adAccountId = business.selectedAdAccountId || business.metaAdAccountId;

    if (!this.isMock && (!metaAccessToken || !adAccountId)) {
      throw new HttpException(
        'Meta is not connected for this business. Connect Meta and select an Ad Account to view live analytics.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (this.isMock || !metaAccessToken) {
      const budgetVal = parseInt((business?.profile?.monthlyBudget || '40000').replace(/[^0-9]/g, '')) || 40000;
      const spend = Math.round(budgetVal * 0.95);
      const clicks = Math.round(spend / 3.58);
      const impressions = Math.round(clicks * 30.5);
      const reach = Math.round(impressions * 0.81);

      return {
        reach,
        impressions,
        spend,
        ctr: 3.28,
        cpc: 3.58,
        cpm: 117.65,
        clicks,
        conversions: Math.round(clicks * 0.043),
        leads: Math.round(clicks * 0.015),
        campaignStatus: 'ACTIVE',
        datePreset: datePreset || 'last_30d',
      };
    }

    try {
      const insightLevel = campaignId ? `/${campaignId}` : `/${adAccountId}/campaigns`;
      const effectivePreset = datePreset || 'last_30d';

      const res = await axios.get(
        `${GRAPH_API_BASE}${insightLevel}/insights`,
        {
          params: {
            access_token: metaAccessToken,
            fields: 'reach,impressions,spend,ctr,cpc,cpm,clicks,actions,action_values',
            date_preset: effectivePreset,
            level: campaignId ? 'campaign' : 'account',
            limit: 50,
          },
        },
      );

      const data = res.data.data?.[0];
      if (!data) {
        return {
          reach: 0, impressions: 0, spend: 0, ctr: 0, cpc: 0, cpm: 0,
          clicks: 0, conversions: 0, leads: 0, campaignStatus: 'NO_DATA',
        };
      }

      const leads = data.actions?.find((a: any) => a.action_type === 'lead')?.value || 0;
      const conversions = data.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0;
      const spend = parseFloat(data.spend || 0);

      return {
        reach: parseInt(data.reach || 0),
        impressions: parseInt(data.impressions || 0),
        spend,
        ctr: parseFloat(data.ctr || 0),
        cpc: parseFloat(data.cpc || 0),
        cpm: parseFloat(data.cpm || 0),
        clicks: parseInt(data.clicks || 0),
        conversions: parseInt(conversions),
        leads: parseInt(leads),
        campaignStatus: data.campaign_status || 'UNKNOWN',
      };
    } catch (err: any) {
      // Report what Meta actually said — a generic sentence gives the user
      // nothing to act on (the leads endpoint proved how useful the real
      // message is: it named the exact missing permission).
      const detail = describeMetaError(err);
      this.logger.error(`Failed to fetch Meta analytics for business ${businessId}: ${detail}`);
      throw new HttpException(`Could not load Meta analytics: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Meta Lead Forms & Leads ─────────────────────────────────────────────────

  /**
   * List all lead forms for the selected page.
   */
  async listLeadForms(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'form_mock_1', name: 'Newsletter Signup', status: 'ACTIVE', question_count: 3 },
        { id: 'form_mock_2', name: 'Free Consultation', status: 'ACTIVE', question_count: 5 },
      ];
    }

    const pageId = business.selectedPageId || business.metaPageId;
    if (!pageId || !business.metaAccessToken) {
      throw new HttpException('Page not connected', HttpStatus.UNAUTHORIZED);
    }

    try {
      const res = await axios.get(
        `${GRAPH_API_BASE}/${pageId}/leadgen_forms`,
        {
          params: {
            access_token: business.metaAccessToken,
            fields: 'id,name,status,question_count,created_time',
            limit: 50,
          },
        },
      );
      return res.data.data || [];
    } catch (err: any) {
      this.logger.error('Failed to list lead forms', err.response?.data || err.message);
      throw new HttpException('Failed to list lead forms from Meta API', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Fetch leads from Meta API for a business.
   */
  async getMetaLeads(businessId: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    if (this.isMock) {
      return [
        { id: 'lead_mock_1', field_data: [{ name: 'full_name', values: ['John Doe'] }, { name: 'email', values: ['john@example.com'] }], created_time: '2024-01-15T10:00:00+0000' },
        { id: 'lead_mock_2', field_data: [{ name: 'full_name', values: ['Jane Smith'] }, { name: 'email', values: ['jane@example.com'] }], created_time: '2024-01-16T11:00:00+0000' },
      ];
    }

    const pageId = business.selectedPageId || business.metaPageId;
    if (!pageId || !business.metaAccessToken) {
      throw new HttpException('Page not connected', HttpStatus.UNAUTHORIZED);
    }

    try {
      const formsRes = await axios.get(
        `${GRAPH_API_BASE}/${pageId}/leadgen_forms`,
        {
          params: {
            access_token: business.metaAccessToken,
            fields: 'id,name',
            limit: 10,
          },
        },
      );

      const forms = formsRes.data.data || [];
      const allLeads: any[] = [];

      for (const form of forms) {
        try {
          const leadsRes = await axios.get(
            `${GRAPH_API_BASE}/${form.id}/leads`,
            {
              params: {
                access_token: business.metaAccessToken,
                fields: 'id,field_data,created_time,ad_id,ad_name',
                limit: 100,
              },
            },
          );
          const formLeads = leadsRes.data.data || [];
          allLeads.push(...formLeads.map((l: any) => ({
            ...l,
            form_name: form.name,
            form_id: form.id,
          })));
        } catch (formErr: any) {
          this.logger.warn(`Failed to fetch leads for form ${form.id}: ${formErr.message}`);
        }
      }

      return allLeads;
    } catch (err: any) {
      const detail = describeMetaError(err);
      this.logger.error(`Failed to fetch Meta leads for business ${businessId}: ${detail}`);
      throw new HttpException(`Could not fetch leads from Meta: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Meta Lead Ads ────────────────────────────────────────────────────────────

  async createLeadForm(businessId: string, formName: string, questions: any[]) {
    this.logger.log(`Creating Lead Form: ${formName}. Mock: ${this.isMock}`);

    if (!this.isMock && businessId) {
      try {
        const business = await this.firebase.getBusinessById(businessId);
        const accessToken = business?.metaAccessToken;
        const pageId = business?.selectedPageId || business?.metaPageId;

        if (!accessToken || !pageId) {
          throw new Error('Meta Access Token or Page ID not configured.');
        }

        const res = await axios.post(
          `${GRAPH_API_BASE}/${pageId}/leadgen_forms`,
          {
            name: formName,
            questions: questions.map(q => ({
              type: q.type,
              key: q.key,
              label: q.label,
            })),
            privacy_policy: {
              url: 'https://example.com/privacy',
            },
            follow_up_action_url: 'https://example.com/thanks',
          },
          { params: { access_token: accessToken } },
        );
        return { success: true, formId: res.data.id };
      } catch (err: any) {
        this.logger.error('Failed to create lead form', err.response?.data || err.message);
        throw new HttpException(
          err.response?.data?.error?.message || 'Failed to create lead form on Meta',
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    return { success: true, formId: `form_${Math.floor(1000000 + Math.random() * 9000000)}` };
  }

  async processLeadWebhook(entry: any) {
    if (!entry || !entry.changes || entry.changes.length === 0) return;

    for (const change of entry.changes) {
      if (change.field === 'leadgen') {
        const leadgenData = change.value;
        const leadgenId = leadgenData.leadgen_id;
        const pageId = leadgenData.page_id;

        // 1. Find the business by pageId with an indexed query. Loading every
        // business and scanning in JS both cost a read per business and, once
        // the listing is bounded, silently dropped leads for any business
        // outside the fetched window.
        const matchedBusiness = await this.firebase.getBusinessByMetaPageId(pageId);

        if (!matchedBusiness) {
          this.logger.warn(`Received lead for unknown page ID: ${pageId}`);
          continue;
        }

        const businessId = matchedBusiness.id;
        const accessToken = matchedBusiness.metaAccessToken;

        // Ignore Meta retries for the same lead.
        const existingLead = await this.firebase
          .col('leads')
          .where('metaLeadId', '==', leadgenId)
          .limit(1)
          .get();
        if (!existingLead.empty) {
          this.logger.log(`Lead ${leadgenId} already exists; ignoring duplicate webhook delivery`);
          continue;
        }

        // 2. Fetch lead details from Meta using leadgen_id. In mock mode, use
        // field_data included in the webhook test payload instead.
        try {
          let fieldData = Array.isArray(leadgenData.field_data) ? leadgenData.field_data : [];
          if (!this.isMock && accessToken) {
            const leadRes = await axios.get(
              `${GRAPH_API_BASE}/${leadgenId}`,
              { params: { access_token: accessToken } }
            );

            fieldData = leadRes.data.field_data || [];
          }

          const parsedData: Record<string, string> = {};
          fieldData.forEach((field: any) => {
            const value = Array.isArray(field?.values) ? field.values[0] : field?.value;
            if (field?.name && value !== undefined && value !== null) {
              parsedData[String(field.name).toLowerCase()] = String(value);
            }
          });

          const readField = (...names: string[]) => {
            for (const name of names) {
              const value = parsedData[name.toLowerCase()];
              if (value) return value;
            }
            return '';
          };

          // Save fields both in normalized columns (used by the CRM UI/search)
          // and in `data` (preserves custom Meta form questions).
          await this.firebase.createLead({
            businessId,
            name: readField('full_name', 'name', 'first_name'),
            email: readField('email', 'email_address'),
            phone: readField('phone_number', 'phone', 'mobile_phone'),
            requirement: readField('requirement', 'message', 'interest', 'product'),
            source: 'META_LEAD_AD',
            campaign: leadgenData.campaign_name || leadgenData.ad_name || '',
            metaLeadId: leadgenId,
            metaFormId: leadgenData.form_id,
            metaAdId: leadgenData.ad_id,
            data: parsedData,
            status: 'NEW',
          });

          this.logger.log(`Successfully processed lead ${leadgenId} for business ${businessId}`);
        } catch (err: any) {
          this.logger.error(`Failed to fetch lead details for ${leadgenId}`, err.message);
        }
      }
    }
  }

  async syncMetaInsights(metaCampaignId: string, businessId?: string) {
    this.logger.log(`Syncing Insights for Campaign ${metaCampaignId}. Mock: ${this.isMock}`);

    if (!this.isMock && businessId) {
      try {
        const business = await this.firebase.getBusinessById(businessId);
        const accessToken = business?.metaAccessToken;

        if (accessToken) {
          const insightsRes = await axios.get(
            `${GRAPH_API_BASE}/${metaCampaignId}/insights`,
            {
              params: {
                access_token: accessToken,
                fields: 'impressions,clicks,spend,reach,ctr,cpc,cpm,actions,action_values',
                date_preset: 'last_30d',
              },
            },
          );

          const data = insightsRes.data.data?.[0];
          if (data) {
            const conversions = data.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0;
            const revenue = data.action_values?.find((a: any) => a.action_type === 'purchase')?.value || 0;
            const spend = parseFloat(data.spend || 0);
            return {
              impressions: parseInt(data.impressions || 0),
              clicks: parseInt(data.clicks || 0),
              spend,
              conversions: parseInt(conversions),
              revenue: parseFloat(revenue),
              ctr: parseFloat(data.ctr || 0),
              cpc: parseFloat(data.cpc || 0),
              cpm: parseFloat(data.cpm || 0),
              roas: spend > 0 ? parseFloat(revenue) / spend : 0,
            };
          }
        }
      } catch (err: any) {
        this.logger.error('Meta API insights error', err.message);
      }
    }

    // Realistic mock insights
    const impressions = Math.floor(5000 + Math.random() * 10000);
    const clicks = Math.floor(impressions * (0.015 + Math.random() * 0.02));
    const spend = clicks * (0.4 + Math.random() * 0.8);
    const conversions = Math.floor(clicks * (0.05 + Math.random() * 0.1));
    const revenue = conversions * 59.99;

    return {
      impressions,
      clicks,
      spend,
      conversions,
      revenue,
      ctr: clicks / impressions,
      cpc: spend / clicks,
      cpm: (spend / impressions) * 1000,
      roas: revenue / spend,
    };
  }

  // ─── Phase 10: Enhanced Analytics with Demographics ─────────────────────────

  /**
   * Get detailed analytics with demographic breakdowns.
   */
  async getDetailedAnalytics(businessId: string, datePreset?: string) {
    const business = await this.firebase.getBusinessById(businessId);
    if (!business) throw new HttpException('Business not found', HttpStatus.NOT_FOUND);

    const effectivePreset = datePreset || 'last_30d';

    if (this.isMock) {
      return {
        reach: 24500,
        impressions: 45200,
        spend: 850.75,
        ctr: 2.35,
        cpc: 0.72,
        cpm: 18.82,
        clicks: 1180,
        conversions: 65,
        leads: 28,
        campaignStatus: 'ACTIVE',
        datePreset: effectivePreset,
        demographics: {
          gender: { male: 45, female: 52, unknown: 3 },
          ageDistribution: [
            { range: '18-24', percentage: 18 },
            { range: '25-34', percentage: 35 },
            { range: '35-44', percentage: 25 },
            { range: '45-54', percentage: 14 },
            { range: '55-64', percentage: 6 },
            { range: '65+', percentage: 2 },
          ],
          platformPerformance: {
            facebook: { reach: 14500, clicks: 680, spend: 490.50, ctr: 2.1 },
            instagram: { reach: 10000, clicks: 500, spend: 360.25, ctr: 2.8 },
          },
        },
        campaigns: [
          { id: 'cmp_1', name: 'Lead Gen - Q3', status: 'ACTIVE', spend: 450, leads: 18 },
          { id: 'cmp_2', name: 'Traffic - Summer', status: 'ACTIVE', spend: 300, clicks: 780 },
          { id: 'cmp_3', name: 'Brand Awareness', status: 'PAUSED', spend: 100, reach: 8500 },
        ],
      };
    }

    // This business's own credentials only — see note in getMetaAnalytics.
    const metaAccessToken = business.metaAccessToken;
    const adAccountId = business.selectedAdAccountId || business.metaAdAccountId;

    if (!metaAccessToken || !adAccountId) {
      throw new HttpException(
        'Meta is not connected for this business. Connect Meta and select an Ad Account to view live campaigns.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // (The unreachable simulated-analytics block that used to sit here was
    // removed — the guard above already rejects a missing token.)

    try {
      const cleanAdAccountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      // Main insights
      const insightsRes = await axios.get(
        `${GRAPH_API_BASE}/${cleanAdAccountId}/insights`,
        {
          params: {
            access_token: metaAccessToken,
            fields: 'reach,impressions,spend,ctr,cpc,cpm,clicks,actions,action_values',
            date_preset: effectivePreset,
            level: 'account',
          },
        },
      );

      const data = insightsRes.data.data?.[0] || {};
      const leads = data.actions?.find((a: any) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped')?.value || 0;
      const conversions = data.actions?.find((a: any) => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || 0;
      const purchaseValue = data.action_values?.find((a: any) => a.action_type === 'purchase')?.value || 0;

      const spend = parseFloat(data.spend || 0);
      const reach = parseInt(data.reach || 0);
      const impressions = parseInt(data.impressions || 0);
      const clicks = parseInt(data.clicks || 0);
      const ctr = parseFloat(data.ctr || 0);
      const cpc = parseFloat(data.cpc || 0);
      // 0, not an invented 3.84, when there is no purchase value to divide by.
      const roas = spend > 0 && purchaseValue > 0 ? parseFloat((purchaseValue / spend).toFixed(2)) : 0;

      // Gender + Age breakdown.  This used to be seeded with hardcoded
      // percentages (58/42 and a fixed age spread) that were returned as real
      // data whenever the breakdown call below failed or came back empty.
      // It now stays null until Meta actually provides numbers.
      let demographics: { femalePct: number; malePct: number } | null = null;

      try {
        const demoRes = await axios.get(
          `${GRAPH_API_BASE}/${cleanAdAccountId}/insights`,
          {
            params: {
              access_token: metaAccessToken,
              fields: 'reach,impressions,spend,clicks',
              date_preset: effectivePreset,
              breakdowns: 'gender,age',
              level: 'account',
              limit: 100,
            },
          },
        );
        const demoData = demoRes.data.data || [];
        if (demoData.length > 0) {
          const genderTotals: any = { male: 0, female: 0 };
          for (const row of demoData) {
            const g = (row.gender || '').toLowerCase();
            if (g === 'male' || g === 'female') genderTotals[g] += parseInt(row.reach || 0);
          }
          const tot = genderTotals.male + genderTotals.female;
          if (tot > 0) {
            const femalePct = Math.round((genderTotals.female / tot) * 100);
            demographics = { femalePct, malePct: 100 - femalePct };
          }
        }
      } catch (demoErr: any) {
        this.logger.warn('Failed to fetch demographic data from Meta:', demoErr.message);
      }

      let fbReach = 2;
      let igReach = 1;
      let profileVisits = 0;
      let newFollowers = 0;
      let engagement = 0;

      // Attempt to query live Facebook Page & IG Insights
      try {
        const pagesRes = await axios.get(
          `${GRAPH_API_BASE}/me/accounts`,
          { params: { access_token: metaAccessToken } }
        );
        const pages = pagesRes.data.data || [];
        if (pages.length > 0) {
          const pageId = pages[0].id;
          const pageToken = pages[0].access_token || metaAccessToken;
          
          const pageInsightsRes = await axios.get(
            `${GRAPH_API_BASE}/${pageId}/insights`,
            {
              params: {
                access_token: pageToken,
                metric: 'page_impressions_unique,page_post_engagements,page_views_total',
                period: 'day',
              }
            }
          ).catch(() => null);

          if (pageInsightsRes?.data?.data) {
            const metrics = pageInsightsRes.data.data;
            const reachMetric = metrics.find((m: any) => m.name === 'page_impressions_unique');
            if (reachMetric?.values?.length > 0) {
              const latestVal = reachMetric.values[reachMetric.values.length - 1].value;
              if (typeof latestVal === 'number') fbReach = latestVal;
            }
            const engMetric = metrics.find((m: any) => m.name === 'page_post_engagements');
            if (engMetric?.values?.length > 0) {
              const latestVal = engMetric.values[engMetric.values.length - 1].value;
              if (typeof latestVal === 'number') engagement = latestVal;
            }
            const viewsMetric = metrics.find((m: any) => m.name === 'page_views_total');
            if (viewsMetric?.values?.length > 0) {
              const latestVal = viewsMetric.values[viewsMetric.values.length - 1].value;
              if (typeof latestVal === 'number') profileVisits = latestVal;
            }
          }
        }
      } catch (pageErr: any) {
        this.logger.log(`Page Insights fetch notice: ${pageErr.message}`);
      }

      return {
        totalSpend: spend,
        impressions,
        reach: reach > 0 ? reach : (fbReach + igReach),
        clicks,
        ctr,
        cpc,
        cpl: leads > 0 ? parseFloat((spend / leads).toFixed(2)) : 0,
        conversions: parseInt(conversions) || parseInt(leads) || 0,
        roas,
        fbReach,
        igReach,
        profileVisits,
        newFollowers,
        engagement,
        isLiveMeta: true,
        adAccountId: cleanAdAccountId,
        datePreset: effectivePreset,
        demographics,
      };
    } catch (err: any) {
      // This catch used to invent analytics — spend derived from the monthly
      // budget, plus fixed CTR/CPC/ROAS and demographic percentages — and
      // return them as if they were real.  Reporting fabricated ad performance
      // is worse than reporting nothing, so surface the actual Meta failure.
      const detail = describeMetaError(err);
      this.logger.error(`Meta insights call failed for business ${businessId}: ${detail}`);
      throw new HttpException(`Could not load Meta analytics: ${detail}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
