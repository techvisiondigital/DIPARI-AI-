import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  NotImplementedException,
} from '@nestjs/common';
import axios from 'axios';
import { FirebaseService } from '../firebase/firebase.service';
import { AiService } from '../ai/ai.service';
import { BusinessIntelligenceService } from '../business/business-intelligence.service';
import { PromptBuilderService } from '../prompt-builder/prompt-builder.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { getPlanLimits } from '../payment/payment.constants';
import {
  decodeDataUri,
  extensionForContentType,
  inlineImageIfSmallEnough,
} from '../utils/image-storage';

/**
 * Which weekdays a plan posts on, keyed by the plan's postsPerWeek allowance.
 * Three posts a week means Monday / Wednesday / Friday — even gaps across the
 * working week, and the pattern the product spec calls for.
 */
export const POSTING_DAY_PATTERNS: Record<number, string[]> = {
  1: ['Wednesday'],
  2: ['Tuesday', 'Thursday'],
  3: ['Monday', 'Wednesday', 'Friday'],
  4: ['Monday', 'Wednesday', 'Friday', 'Saturday'],
  5: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  6: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  7: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

/** The weekdays used whenever no explicit day selection is supplied. */
export const DEFAULT_POSTING_DAYS = POSTING_DAY_PATTERNS[3];

/**
 * Weeks generated the first time a business gets a calendar. Two weeks on the
 * default three-posts-a-week plan is six posts.
 */
export const INITIAL_CALENDAR_WEEKS = 2;

export interface ContentStrategyData {
  monthlyMarketingStrategy: string;
  monthlyCampaignFocus: string;
  recommendedPostingFrequency: string;
  recommendedPlatforms: string[];
  weeklyThemes: { weekNumber: number; theme: string; objective: string }[];
}

export interface CalendarFilterOptions {
  page?: number;
  limit?: number;
  month?: string;
  status?: string;
  platform?: string;
  category?: string;
  search?: string;
}

/**
 * ContentService — Handles Content Strategy, Calendar Generation, and Content Operations.
 *
 * All business context is sourced from BusinessIntelligenceService.getBusinessContext(businessId).
 * All AI calls flow through PromptBuilderService → AiService → OpenRouter.
 */
import { GraphicGeneratorService } from './graphic-generator.service';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  /** Businesses whose deferred creatives are being produced right now. */
  private readonly imageBackfillsInFlight = new Set<string>();

  constructor(
    private readonly firebase: FirebaseService,
    private readonly aiService: AiService,
    private readonly businessIntelligence: BusinessIntelligenceService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly graphicGenerator: GraphicGeneratorService,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * Generates a 1080x1080 pixel branded social graphic customized to the business vibe,
  /**
   * Helper: Builds structured prompt, generates AI visual background scene,
   * composites with GraphicGeneratorService (real logo, copy, CTA, contact bar, brand colors),
   * uploads PNG buffer to Firebase Storage, and returns permanent public URL.
   */
  private async generateAndCompositeImage(
    businessId: string,
    postDetails: {
      headline?: string;
      topic?: string;
      category?: string;
      postType?: string;
      objective?: string;
      offer?: string;
      cta?: string;
      caption?: string;
      graphicPrompt?: string;
      aspectRatio?: '1:1' | '4:5' | '9:16';
    } = {},
  ): Promise<string> {
    const startedAt = Date.now();
    this.logger.log(`[ContentService] Initiating Image Generation & Compositing for business: ${businessId}`);

    // Kept outside the try so the failure path can still fall back to a
    // brand-relevant prompt instead of a generic one.
    let brandPrompt = '';

    try {
      // 1. Build structured image prompt from BusinessIntelligenceService single source of truth
      const promptData = await this.promptBuilder.buildStructuredImagePrompt(businessId, postDetails);
      const ctx = promptData.ctx;
      brandPrompt = promptData.prompt;

      // 2. Determine aspect ratio from post type if not explicit
      let aspectRatio: '1:1' | '4:5' | '9:16' = postDetails.aspectRatio || '1:1';
      const pType = (postDetails.postType || '').toLowerCase();
      if (pType.includes('story') || pType.includes('reel')) {
        aspectRatio = '9:16';
      }

      // 3. Call AI image provider for high-res visual scene background
      let bgImageUrl = '';
      try {
        const imageResult = await this.aiService.generateImage(promptData.prompt, { aspect_ratio: aspectRatio });
        if (imageResult?.imageUrl) {
          bgImageUrl = imageResult.imageUrl;
        }
      } catch (imgErr: any) {
        this.logger.warn(`[ContentService] AI Image generation warning for ${businessId}: ${imgErr.message}`);
      }

      // 4. Composite AI visual + Real Logo + Typography + CTA + Contact details using Canvas
      const headlineText = postDetails.headline || postDetails.topic || ctx.productsServices || 'Special Offer';
      const offerText = postDetails.offer || ctx.currentOffer || ctx.businessUSP || 'Special Offer';
      const ctaType = postDetails.cta || 'Shop Now';
      const categoryName = postDetails.category || postDetails.postType || ctx.businessCategory || 'Promotional';

      const pngBuffer = await this.graphicGenerator.generateBrandedGraphicBuffer({
        businessName: ctx.businessName,
        offerText,
        headline: headlineText,
        description: postDetails.caption?.substring(0, 100) || ctx.businessUSP,
        ctaType,
        niche: categoryName,
        vibe: ctx.brandTone,
        logoUrl: ctx.logoUrl,
        brandColors: ctx.brandColors,
        bgImageUrl,
        // Makes each post's artwork distinct when no AI background is available.
        variantSeed: `${postDetails.headline || ''}|${postDetails.category || ''}|${postDetails.topic || ''}`,
        phone: ctx.contactPhone,
        email: ctx.contactEmail,
        website: ctx.websiteUrl,
        address: ctx.physicalAddress,
        aspectRatio,
      });

      // 5. Upload composited PNG buffer to permanent storage.
      const timestamp = Date.now();
      const destinationPath = `creatives/${businessId}/${timestamp}_creative.png`;
      const uploadResult = await this.firebase.uploadFileBuffer(pngBuffer, destinationPath, 'image/png');

      // The stored URL is handed straight to a browser <img> and to Meta, so it
      // has to be a URL that serves bytes immediately. It used to fall back to
      // `bgImageUrl` — a Pollinations *generation* URL that re-renders the image
      // on every single request, takes 20-60s, and frequently times out. That is
      // what turned calendar thumbnails into "Retry" buttons. If the upload did
      // not produce a hosted URL, inline the bytes instead: a data: URI always
      // renders.
      const finalUrl =
        uploadResult?.publicUrl || inlineImageIfSmallEnough(pngBuffer, 'image/png');
      const durationMs = Date.now() - startedAt;

      if (!uploadResult?.publicUrl) {
        this.logger.warn(
          `[ContentService] Creative for ${businessId} could not be uploaded to storage. Configure CLOUDINARY_* or Firebase Storage credentials.`,
        );
      }

      this.logger.log(
        `[ContentService] Successfully generated & composited creative for ${ctx.businessName} in ${durationMs}ms`,
      );
      return finalUrl;
    } catch (err: any) {
      this.logger.error(`[ContentService] Image generation & compositing error for ${businessId}: ${err.message}`);

      // Fall back to a still brand-relevant image.  Previously this prompt was
      // built from the raw businessId ("...for business abc123"), which carries
      // no product or brand signal at all and is why unrelated stock-style
      // images appeared whenever compositing failed.
      if (!brandPrompt) {
        try {
          const recovery = await this.promptBuilder.buildStructuredImagePrompt(businessId, postDetails);
          brandPrompt = recovery.prompt;
        } catch {
          const ctx = await this.businessIntelligence.getBusinessContext(businessId).catch(() => null);
          brandPrompt = ctx
            ? `Professional commercial advertising photograph for ${ctx.businessName}, showing ${ctx.productsServices || ctx.businessCategory} as the main subject, ${ctx.brandTone || 'clean modern'} style, no text, no watermark`
            : 'Professional commercial advertising photograph, clean modern product presentation, no text, no watermark';
        }
      }

      // Render the fallback ONCE here, server-side, and store the resulting
      // bytes. Returning the Pollinations generation URL itself meant every
      // browser that later displayed the post re-triggered a 20-60s render,
      // which is why these thumbnails showed "Retry" instead of a picture.
      const persisted = await this.renderAndPersistFallbackImage(businessId, brandPrompt);
      if (persisted) return persisted;

      // Nothing renderable could be produced. An empty string makes the
      // calendar show "No image" (with a working Regenerate button) rather
      // than a broken <img> that errors in the browser.
      this.logger.error(
        `[ContentService] No creative could be produced for ${businessId}; storing an empty imageUrl.`,
      );
      return '';
    }
  }

  /**
   * Renders the fallback prompt to actual image bytes and uploads them, so the
   * value stored on the post is a URL that serves an image instantly instead of
   * one that regenerates on every view.
   */
  private async renderAndPersistFallbackImage(
    businessId: string,
    brandPrompt: string,
  ): Promise<string> {
    let buffer: Buffer | null = null;
    let contentType = 'image/png';

    // Preferred: the normal provider cascade (Cloudflare -> Together -> HF ->
    // Pollinations). It may hand back a data: URI or a hosted URL.
    try {
      const result = await this.aiService.generateImage(brandPrompt, { aspect_ratio: '1:1' });
      const url = result?.imageUrl || '';
      const decoded = decodeDataUri(url);
      if (decoded) {
        buffer = decoded.buffer;
        contentType = decoded.contentType;
      } else if (url) {
        const fetched = await this.fetchImageBytes(url);
        if (fetched) {
          buffer = fetched.buffer;
          contentType = fetched.contentType;
        }
      }
    } catch (err: any) {
      this.logger.warn(
        `[ContentService] Fallback image provider failed for ${businessId}: ${err.message}`,
      );
    }

    if (!buffer || buffer.length === 0) return '';

    try {
      const ext = extensionForContentType(contentType);
      const destinationPath = `creatives/${businessId}/${Date.now()}_fallback.${ext}`;
      const uploaded = await this.firebase.uploadFileBuffer(buffer, destinationPath, contentType);
      if (uploaded?.publicUrl) return uploaded.publicUrl;
    } catch (err: any) {
      this.logger.warn(
        `[ContentService] Could not upload fallback creative for ${businessId}: ${err.message}`,
      );
    }

    // Storage unavailable — inline the bytes if they are small enough to store.
    return inlineImageIfSmallEnough(buffer, contentType);
  }

  /**
   * Downloads image bytes with a server-side timeout generous enough for
   * on-demand generators (Pollinations can take up to a minute on a cold
   * prompt), which a browser would never wait for.
   */
  private async fetchImageBytes(
    url: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 90_000,
          maxContentLength: 25 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 300,
        });
        const buffer = Buffer.from(res.data);
        if (buffer.length > 0) {
          const contentType = String(res.headers?.['content-type'] || 'image/png').split(';')[0];
          return { buffer, contentType };
        }
      } catch (err: any) {
        this.logger.warn(
          `[ContentService] Image download attempt ${attempt} failed for ${url.substring(0, 90)}: ${err.message}`,
        );
      }
    }
    return null;
  }

  /**
   * Generates a 1080x1080 pixel branded social graphic customized to the business vibe,
   * overlays business name & offer text, uploads PNG buffer to Firebase Storage,
   * and returns the public download URL.
   */
  async generateBrandedGraphic(
    businessId: string,
    offerTextOverride?: string,
  ) {
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    const context = await this.businessIntelligence.getBusinessContext(businessId);
    const offerText = offerTextOverride || context.currentOffer || context.businessUSP;

    const publicUrl = await this.generateAndCompositeImage(businessId, {
      offer: offerText,
      category: 'Promotional',
      headline: `${context.businessName} Special Offer`,
    });

    return {
      success: true,
      publicUrl,
      businessId,
      businessName: context.businessName,
      vibe: context.brandTone,
      niche: context.businessCategory,
      offerText,
      dimensions: '1080x1080',
    };
  }

  /**
   * Generates Instagram-ready content (caption + 15 hashtags) by pulling
   * business context directly from BusinessIntelligenceService single source of truth.
   */
  async generateInstagramPost(
    businessId: string,
    topic?: string,
    offerOverride?: string,
  ) {
    if (!businessId) {
      throw new BadRequestException('businessId is required');
    }

    const context = await this.businessIntelligence.getBusinessContext(businessId);

    this.logger.log(`Generating Instagram post with Business Intelligence context for ${context.businessName} (${context.businessCategory})`);

    // 1. Generate text copy via Gemini/OpenRouter AI
    const result = await this.aiService.generateInstagramContent(context, {
      topic,
      offer: offerOverride,
    });

    // 2. Generate composited AI creative image
    const imageUrl = await this.generateAndCompositeImage(businessId, {
      topic,
      offer: offerOverride,
      caption: result.caption,
      category: 'Social Post',
    });

    // 3. Save post draft to Firestore social_posts collection
    let savedPost: any = null;
    if (this.firebase.socialPostsDao) {
      try {
        savedPost = await this.firebase.socialPostsDao.create({
          workspaceId: businessId,
          authorId: 'system',
          caption: `${result.caption}\n\n${result.hashtags.join(' ')}`,
          imageUrl,
          scheduleTime: new Date(Date.now() + 24 * 3600 * 1000),
          status: 'DRAFT',
        });
      } catch (e: any) {
        this.logger.warn(`Could not save post draft to social_posts: ${e.message}`);
      }
    }

    return {
      caption: result.caption,
      hashtags: result.hashtags,
      imageUrl,
      businessId,
      workspaceName: context.businessName,
      niche: context.businessCategory,
      vibe: context.brandTone,
      postId: savedPost?.id || null,
    };
  }

  // ─── Validation Helpers ───────────────────────────────────────────────────

  /**
   * Validates that the business workspace exists, business context is available,
   * and the Business Blueprint is approved.
   */
  async validateBusinessAndBlueprint(businessId: string) {
    if (!businessId) {
      throw new BadRequestException('Business ID is required');
    }

    const business = await this.firebase.getBusinessById(businessId);
    if (!business) {
      throw new NotFoundException(`Business workspace ${businessId} not found`);
    }

    const context = await this.businessIntelligence.getBusinessContext(businessId);
    if (!context) {
      throw new NotFoundException(`Business context for ${businessId} not found`);
    }

    if (!context.blueprintApproved) {
      throw new BadRequestException(
        'Business Blueprint must be approved before generating content strategy or content calendar',
      );
    }

    return { business, context };
  }

  /**
   * Enforces valid status transitions for content calendar posts.
   */
  private validateStatusTransition(currentStatus: string, targetStatus: string) {
    const validTransitions: Record<string, string[]> = {
      PENDING: ['SCHEDULED', 'DRAFT', 'PENDING'],
      DRAFT: ['APPROVED', 'REJECTED', 'DRAFT'],
      REJECTED: ['DRAFT', 'APPROVED', 'REJECTED'],
      APPROVED: ['SCHEDULED', 'DRAFT', 'REJECTED', 'APPROVED'],
      SCHEDULED: ['PUBLISHED', 'FAILED', 'APPROVED', 'DRAFT', 'SCHEDULED'],
      PUBLISHED: ['PUBLISHED'],
      FAILED: ['DRAFT', 'SCHEDULED', 'FAILED', 'PUBLISHED'],
      CANCELLED: ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'CANCELLED'],
    };

    const allowed = validTransitions[currentStatus?.toUpperCase()] || [];
    if (!allowed.includes(targetStatus.toUpperCase())) {
      throw new BadRequestException(
        `Invalid status transition from '${currentStatus}' to '${targetStatus}'`,
      );
    }
  }

  // ─── Step 1: Monthly Content Strategy ─────────────────────────────────────

  /**
   * Generates a structured 30-day Monthly Content Strategy using the approved Business Context.
   */
  async generateMonthlyStrategy(businessId: string): Promise<any> {
    this.logger.log(`Generating Monthly Content Strategy for business: ${businessId}`);
    await this.validateBusinessAndBlueprint(businessId);

    const prompts = await this.promptBuilder.buildMonthlyStrategyPrompt(businessId);

    let strategyData: ContentStrategyData | null = null;
    try {
      const response = await this.aiService.generateStructuredJson<ContentStrategyData>(
        prompts.systemPrompt,
        prompts.userPrompt,
        { temperature: 0.7, maxTokens: 2048 },
        'ContentService.generateMonthlyStrategy',
      );
      strategyData = response.data;
    } catch (err: any) {
      this.logger.warn(`AI strategy generation error: ${err.message}`);
    }

    // Fallback if AI call failed
    if (!strategyData || !strategyData.weeklyThemes?.length) {
      const context = await this.businessIntelligence.getBusinessContext(businessId);
      strategyData = {
        monthlyMarketingStrategy: `Drive brand authority and acquisition for ${context.businessName} across digital channels.`,
        monthlyCampaignFocus: `${context.businessCategory || 'Product'} Launch & Brand Positioning`,
        recommendedPostingFrequency: '3 posts per week (12 posts per month)',
        recommendedPlatforms: ['Instagram', 'Facebook', 'LinkedIn'],
        weeklyThemes: [
          { weekNumber: 1, theme: 'Brand Foundations & Value Prop', objective: 'Educate audience on core offering & USP' },
          { weekNumber: 2, theme: 'Customer Pain Points & Solutions', objective: 'Highlight key customer problems and how we solve them' },
          { weekNumber: 3, theme: 'Social Proof & Community', objective: 'Build trust with testimonials, reviews, and behind-the-scenes' },
          { weekNumber: 4, theme: 'Conversion & Promotional Offers', objective: 'Drive lead generation and direct sales with strong CTAs' },
        ],
      };
    }

    const savedStrategy = await this.firebase.upsertContentStrategy(businessId, strategyData);
    this.logger.log(`Monthly Content Strategy saved (${savedStrategy.version}) for business: ${businessId}`);
    return savedStrategy;
  }

  /**
   * Fetches the current active Monthly Content Strategy for a business.
   */
  async getMonthlyStrategy(businessId: string) {
    if (!businessId) throw new BadRequestException('Business ID is required');
    const strategy = await this.firebase.getContentStrategyByBusinessId(businessId);
    if (!strategy) {
      throw new NotFoundException(`No monthly strategy found for business ${businessId}`);
    }
    return strategy;
  }

  // ─── Step 2 & 3: Monthly Content Calendar Generation ─────────────────────

  /**
   * Generates a complete 30-day (or multi-week) content calendar balancing all content types.
   */
  async generateMonthlyCalendar(
    businessId: string,
    options: {
      selectedDays?: string[];
      durationWeeks?: number;
      industry?: string;
      /**
       * Save the posts first and produce their images afterwards, in the
       * background. Each creative takes 20-60s to generate, so a six-post plan
       * built inline keeps one HTTP request open for minutes and is killed by
       * the host's request timeout long before it finishes — which is why an
       * auto-generated calendar could come back empty.
       */
      deferImages?: boolean;
    } = {},
  ) {
    // Default: 4-week calendar with 3 posts per week (Monday, Wednesday, Friday) = 12 posts
    const selectedDays =
      options.selectedDays && options.selectedDays.length > 0
        ? options.selectedDays
        : DEFAULT_POSTING_DAYS;
    const durationWeeks = options.durationWeeks || 4;

    this.logger.log(
      `Generating Content Calendar | Business: ${businessId} | Days: ${selectedDays.join(', ')} | Weeks: ${durationWeeks}`,
    );

    const { context } = await this.validateBusinessAndBlueprint(businessId);

    // Get or auto-generate monthly strategy
    let strategy = await this.firebase.getContentStrategyByBusinessId(businessId);
    if (!strategy) {
      strategy = await this.generateMonthlyStrategy(businessId);
    }

    // Start date calculation: Next Monday at 10:00 AM
    const now = new Date();
    const startMonday = new Date(now);
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    startMonday.setDate(now.getDate() + daysToMonday);
    startMonday.setHours(10, 0, 0, 0);

    const daysOffsetMap: Record<string, number> = {
      Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6,
    };

    const createdEntries: any[] = [];

    // Dates that already hold a post for this business. Generating a plan used
    // to append blindly, so running it twice stacked a second post onto every
    // date that already had one — which is why a "3 posts a week" calendar
    // showed two posts on the same day.
    const existingForBusiness = await this.firebase.getContentCalendarByBusinessId(businessId);
    const occupiedDates = new Set<string>(
      (existingForBusiness || [])
        .map((e: any) => {
          const d = e.scheduledTime?.toDate?.() || new Date(e.scheduledTime);
          return Number.isNaN(d?.getTime?.()) ? null : d.toDateString();
        })
        .filter(Boolean) as string[],
    );

    const postTypesList = ['Reel', 'Carousel', 'Image', 'Video', 'Story'];
    const categoriesList = [
      'Educational', 'Promotional', 'Brand Awareness', 'Customer Story',
      'Testimonials', 'Behind the Scenes', 'Industry Tips', 'FAQs', 'Offers',
      'Seasonal Content', 'Festival Content',
    ];

    for (let week = 1; week <= durationWeeks; week++) {
      this.logger.log(`Generating Week ${week}/${durationWeeks} calendar posts...`);

      const promptInfo = await this.promptBuilder.buildMonthlyCalendarPrompt(
        businessId,
        strategy,
        week,
        selectedDays,
      );

      let weekPosts: any[] = [];
      try {
        const response = await this.aiService.generateStructuredJson<any[]>(
          promptInfo.systemPrompt,
          promptInfo.userPrompt,
          { temperature: 0.8, maxTokens: 3000 },
          `ContentService.generateMonthlyCalendar.week${week}`,
        );
        if (response.data && Array.isArray(response.data)) {
          weekPosts = response.data;
        }
      } catch (err: any) {
        this.logger.error(`Failed AI generation for Week ${week}: ${err.message}`);
      }

      // Fallback for missing or failed week generation
      if (!weekPosts.length) {
        weekPosts = selectedDays.map((day, idx) => {
          const onboardingBlueprints = [
            { tag: 'Product Spotlight', template: `Discover the premium quality of ${context.productsServices || context.businessName}. Designed specially for ${context.targetAudience || 'our valued customers'}.`, overlay: `Best of ${context.businessName}` },
            { tag: 'Customer Benefit', template: `Why choose ${context.businessName}? ${context.businessUSP || 'Unmatched quality, exceptional service, and direct value.'} Perfect for ${context.targetAudience || 'everyone'}.`, overlay: `Why ${context.businessName}?` },
            { tag: 'Industry Advice', template: `A pro tip from ${context.businessName} in ${context.industry || 'your industry'}: focus on quality details that elevate your experience every single day.`, overlay: `${context.industry || 'Pro'} Tip` },
            { tag: 'Behind The Craft', template: `Take a look behind the scenes at ${context.businessName}. We take pride in delivering top-notch products for ${context.location || 'our community'}.`, overlay: `Behind the Craft` },
            { tag: 'Special Announcement', template: `Exciting updates from ${context.businessName}! Achieving your goal of ${context.businessGoals || 'growth'} starts with choosing the right partner.`, overlay: `Special Update` },
            { tag: 'Weekly Highlight', template: `Elevate your lifestyle with ${context.businessName}. Tailored for ${context.targetAudience || 'fashion enthusiasts'} looking for standard excellence.`, overlay: `Weekly Highlight` },
            { tag: 'FAQ & Insights', template: `Have questions about ${context.productsServices || context.businessName}? Our team is here to support your journey with ${context.brandTone || 'friendly'} expertise.`, overlay: `Top FAQ Answered` },
          ];
          const bp = onboardingBlueprints[idx % onboardingBlueprints.length];
          return {
            dayName: day,
            platform: idx % 3 === 0 ? 'Facebook' : idx % 3 === 1 ? 'Instagram' : 'Both (FB & IG)',
            postType: postTypesList[idx % postTypesList.length],
            category: categoriesList[idx % categoriesList.length],
            objective: 'Brand Awareness',
            headline: `${bp.tag}: ${context.businessName}`,
            caption: `${bp.template} Share your thoughts below! 👇`,
            imageOverlayText: bp.overlay,
            cta: 'Shop Now',
            hashtags: [`#${(context.businessName || 'Brand').replace(/\s+/g, '')}`, `#${(context.industry || 'Industry').replace(/\s+/g, '')}`, '#QualityFirst', '#Trending'],
            graphicPrompt: `Professional social media graphic for ${context.businessName} showcasing ${context.productsServices || 'products'}, modern ${context.brandTone || 'sleek'} aesthetic`,
            bestPostingTime: '10:00 AM',
          };
        });
      }

      // Models can repeat a requested weekday. Enforce exactly one post per
      // selected day so a three-post week always has three distinct dates.
      const scheduledWeekPosts = weekPosts.slice(0, selectedDays.length);

      // Save each post entry into Firestore contentCalendar collection
      for (const [postIdx, post] of scheduledWeekPosts.entries()) {
        const scheduledDayName = selectedDays[postIdx];
        const dayOffset = daysOffsetMap[scheduledDayName] ?? 0;
        const scheduledTime = new Date(startMonday);
        scheduledTime.setDate(startMonday.getDate() + (week - 1) * 7 + dayOffset);

        // Parse posting time string (e.g. "06:00 PM") if present
        if (post.bestPostingTime) {
          const match = post.bestPostingTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (match) {
            let hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const ampm = match[3]?.toUpperCase();
            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
            scheduledTime.setHours(hours, minutes, 0, 0);
          }
        }

        if (occupiedDates.has(scheduledTime.toDateString())) {
          this.logger.log(
            `[ContentService] ${scheduledTime.toDateString()} already has a post for ${businessId}; skipping to keep one post per day.`,
          );
          continue;
        }
        occupiedDates.add(scheduledTime.toDateString());

        let generatedImageUrl = '';
        if (!options.deferImages) {
          // Small delay between creative generation to respect provider rate limits
          if (createdEntries.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }

          // Generate personalized, composited AI marketing creative for this post
          generatedImageUrl = await this.generateAndCompositeImage(businessId, {
            headline: post.headline,
            caption: post.caption,
            cta: post.cta,
            category: post.category,
            postType: post.postType,
            objective: post.objective,
            graphicPrompt: post.graphicPrompt,
            topic: post.headline,
          });
        }

        const entryPayload = {
          businessId,
          dayName: scheduledDayName,
          platform: post.platform || 'Instagram',
          postType: post.postType || 'Image',
          category: post.category || 'Educational',
          objective: post.objective || 'Brand Awareness',
          headline: post.headline || `Highlight for ${context.businessName}`,
          caption: post.caption || `Discover what makes ${context.businessName} unique in ${context.industry}.`,
          imageOverlayText: post.imageOverlayText || post.headline || `Meet ${context.businessName}`,
          imageUrl: generatedImageUrl,
          // Lets the calendar show "generating..." instead of an empty slot, and
          // lets the background pass find the rows that still need a creative.
          imagePending: !!options.deferImages,
          cta: post.cta || 'Learn More',
          hashtags: Array.isArray(post.hashtags) ? post.hashtags : [`#${(context.businessName || 'Brand').replace(/\s+/g, '')}`],
          graphicPrompt: post.graphicPrompt || `Creative promo visual for ${context.businessName}`,
          bestPostingTime: post.bestPostingTime || '10:00 AM',
          scheduledTime,
          status: 'DRAFT',
          version: strategy.version || 'v1',
          createdAt: new Date(),
        };

        const createdDoc = await this.firebase.createContentCalendarEntry(entryPayload);
        createdEntries.push(createdDoc);
      }
    }

    // Record generation audit trail
    await this.firebase.createCalendarAuditTrail({
      action: 'CALENDAR_GENERATED',
      previousValue: null,
      newValue: { count: createdEntries.length, durationWeeks, strategyVersion: strategy.version },
      businessId,
      calendarEntryId: 'ALL',
      user: 'System/AI',
    });

    this.logger.log(`Calendar generated with ${createdEntries.length} posts for business ${businessId}`);
    return {
      success: true,
      message: `Generated ${createdEntries.length} calendar posts across ${durationWeeks} weeks`,
      businessId,
      strategy,
      entries: createdEntries,
    };
  }

  /**
   * Creates the first week's plan when a business connects Meta.  Keeping this
   * idempotent is important because OAuth callbacks and reconnects can occur
   * more than once.
   */
  async ensureInitialWeeklyCalendar(businessId: string) {
    const existingEntries = await this.firebase.getContentCalendarByBusinessId(businessId);
    const now = Date.now();
    const upcomingEntries = existingEntries.filter((entry: any) => {
      const scheduled = entry.scheduledTime?.toDate?.() || new Date(entry.scheduledTime);
      return !Number.isNaN(scheduled?.getTime?.()) && scheduled.getTime() >= now;
    });

    if (upcomingEntries.length > 0) {
      // Images may still be filling in from an earlier run that was cut short.
      this.startImageBackfill(businessId);
      return {
        success: true,
        created: false,
        message: 'An upcoming content calendar already exists.',
        entries: upcomingEntries,
      };
    }

    const selectedDays = await this.getPlanPostingDays(businessId);

    // Two weeks, so a three-post plan opens with six posts rather than three.
    // Images are deferred: the posts are saved and returned straight away, and
    // the creatives are produced in the background afterwards.
    const result = await this.generateMonthlyCalendar(businessId, {
      selectedDays,
      durationWeeks: INITIAL_CALENDAR_WEEKS,
      deferImages: true,
    });

    this.startImageBackfill(businessId);

    return { ...result, created: true, selectedDays };
  }

  /**
   * Produces the creatives for calendar rows saved without one, one at a time,
   * without holding an HTTP request open. Fire-and-forget on purpose: the
   * caller gets its posts immediately and each image appears as it is ready.
   *
   * Only one pass per business runs at a time, so repeated calendar opens
   * cannot stack up duplicate image generation.
   */
  startImageBackfill(businessId: string): void {
    if (!businessId || this.imageBackfillsInFlight.has(businessId)) return;
    this.imageBackfillsInFlight.add(businessId);

    void this.backfillCalendarImages(businessId)
      .catch((err: any) =>
        this.logger.error(
          `[ContentService] Image backfill failed for ${businessId}: ${err.message}`,
        ),
      )
      .finally(() => this.imageBackfillsInFlight.delete(businessId));
  }

  private async backfillCalendarImages(businessId: string): Promise<void> {
    const entries = await this.firebase.getContentCalendarByBusinessId(businessId);
    const pending = (entries || []).filter((e: any) => !e?.imageUrl);

    if (!pending.length) return;
    this.logger.log(
      `[ContentService] Backfilling ${pending.length} calendar creative(s) for ${businessId}`,
    );

    for (const entry of pending) {
      try {
        const imageUrl = await this.generateAndCompositeImage(businessId, {
          headline: entry.headline,
          caption: entry.caption,
          cta: entry.cta,
          category: entry.category,
          postType: entry.postType,
          objective: entry.objective,
          graphicPrompt: entry.graphicPrompt,
          topic: entry.headline,
        });

        await this.firebase.updateContentCalendarEntry(entry.id, {
          imageUrl,
          imagePending: false,
        });
      } catch (err: any) {
        // One failed creative must not stop the rest of the plan.
        this.logger.warn(
          `[ContentService] Could not backfill creative for entry ${entry.id}: ${err.message}`,
        );
        await this.firebase
          .updateContentCalendarEntry(entry.id, { imagePending: false })
          .catch(() => undefined);
      }

      // Space the provider calls out so a six-post plan does not trip rate limits.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    this.logger.log(`[ContentService] Image backfill complete for ${businessId}`);
  }

  /**
   * Resolves the weekdays this business should post on from its active
   * subscription.  FREE / STARTER / ADVANCE allow 3 posts a week
   * (Monday, Wednesday, Friday), PREMIUM allows 5, demo plans allow 7.
   */
  async getPlanPostingDays(businessId: string): Promise<string[]> {
    let postsPerWeek = 3;

    try {
      const subscriptions = await this.firebase.getSubscriptionsByBusinessId(businessId);
      const activeSub =
        (subscriptions || []).find((s: any) => s.status === 'ACTIVE') || (subscriptions || [])[0];
      postsPerWeek = getPlanLimits(activeSub?.plan).postsPerWeek;
    } catch (err: any) {
      this.logger.warn(
        `Could not resolve plan for business ${businessId} (${err.message}). Defaulting to 3 posts/week.`,
      );
    }

    const clamped = Math.min(7, Math.max(1, Number(postsPerWeek) || 3));
    return POSTING_DAY_PATTERNS[clamped] || POSTING_DAY_PATTERNS[3];
  }

  /** Alias method for backward compatibility */
  async generateContentPlan(
    businessId: string,
    selectedDays: string[] = DEFAULT_POSTING_DAYS,
    durationWeeks = 4,
    industry?: string,
  ) {
    return this.generateMonthlyCalendar(businessId, { selectedDays, durationWeeks, industry });
  }

  // ─── Step 4 & 5: Pagination, Filtering & Content Retrieval ────────────────

  /**
   * Retrieves content calendar entries with filtering (month, status, platform, category, search)
   * and pagination (page, limit).
   */
  async getContentCalendar(businessId: string, filters: CalendarFilterOptions = {}) {
    if (!businessId) throw new BadRequestException('Business ID is required');

    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));

    let allEntries = await this.firebase.getContentCalendarByBusinessId(businessId);

    // Filter by Status
    if (filters.status && filters.status !== 'ALL') {
      const targetStatus = filters.status.toUpperCase();
      allEntries = allEntries.filter((e: any) => e.status?.toUpperCase() === targetStatus);
    }

    // Filter by Platform
    if (filters.platform && filters.platform !== 'ALL') {
      const targetPlatform = filters.platform.toLowerCase();
      allEntries = allEntries.filter((e: any) => e.platform?.toLowerCase() === targetPlatform);
    }

    // Filter by Category
    if (filters.category && filters.category !== 'ALL') {
      const targetCategory = filters.category.toLowerCase();
      allEntries = allEntries.filter((e: any) => e.category?.toLowerCase() === targetCategory);
    }

    // Filter by Month (format YYYY-MM)
    if (filters.month) {
      allEntries = allEntries.filter((e: any) => {
        if (!e.scheduledTime) return false;
        const dateObj = new Date(e.scheduledTime?.toDate ? e.scheduledTime.toDate() : e.scheduledTime);
        const yearMonth = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        return yearMonth === filters.month;
      });
    }

    // Search term filter
    if (filters.search?.trim()) {
      const term = filters.search.trim().toLowerCase();
      allEntries = allEntries.filter((e: any) => {
        const headline = (e.headline || e.contentIdea || '').toLowerCase();
        const caption = (e.caption || e.contentDescription || '').toLowerCase();
        const tags = Array.isArray(e.hashtags) ? e.hashtags.join(' ').toLowerCase() : '';
        return headline.includes(term) || caption.includes(term) || tags.includes(term);
      });
    }

    const total = allEntries.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedEntries = allEntries.slice(startIndex, startIndex + limit);

    return {
      total,
      page,
      limit,
      totalPages,
      entries: paginatedEntries,
    };
  }

  async getGeneratedContent(businessId: string) {
    const content = await this.firebase.getGeneratedContentByBusinessId(businessId);
    return { total: content.length, content };
  }

  // ─── Step 4: Approval Workflow & Content Operations (Firestore Transactions) ──

  /**
   * Approves a calendar post. Uses Firestore transaction to prevent partial write.
   */
  async approvePost(id: string, approvedBy = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) throw new NotFoundException(`Calendar entry ${id} not found`);

    this.validateStatusTransition(entry.status || 'DRAFT', 'APPROVED');

    const now = new Date();
    const updated = await this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(id);
      const updatePayload = {
        status: 'APPROVED',
        approvedAt: now,
        approvedBy,
        updatedAt: now,
      };
      await tx.update(docRef, updatePayload);
      return { ...entry, ...updatePayload };
    });

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_APPROVED',
      previousValue: { status: entry.status },
      newValue: { status: 'APPROVED', approvedBy, approvedAt: now },
      user: approvedBy,
      businessId: entry.businessId,
      calendarEntryId: id,
    });

    this.logger.log(`Post ${id} approved by ${approvedBy}`);
    return { success: true, entry: updated };
  }

  /**
   * Rejects a calendar post with reason. Uses Firestore transaction.
   */
  async rejectPost(id: string, reason?: string, user = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) throw new NotFoundException(`Calendar entry ${id} not found`);

    this.validateStatusTransition(entry.status || 'DRAFT', 'REJECTED');

    const now = new Date();
    const updated = await this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(id);
      const updatePayload = {
        status: 'REJECTED',
        rejectionReason: reason || 'User rejected post',
        rejectedAt: now,
        updatedAt: now,
      };
      await tx.update(docRef, updatePayload);
      return { ...entry, ...updatePayload };
    });

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_REJECTED',
      previousValue: { status: entry.status },
      newValue: { status: 'REJECTED', reason },
      user,
      businessId: entry.businessId,
      calendarEntryId: id,
    });

    this.logger.log(`Post ${id} rejected`);
    return { success: true, entry: updated };
  }

  /**
   * Bulk approves multiple calendar posts atomically using a Firestore transaction.
   */
  async bulkApprovePosts(ids: string[], approvedBy = 'User') {
    if (!ids || !ids.length) {
      throw new BadRequestException('Array of post IDs is required for bulk approval');
    }

    const now = new Date();
    const updatedEntries = await this.firebase.runTransaction(async (tx) => {
      const results: any[] = [];
      for (const id of ids) {
        const docRef = this.firebase.col('contentCalendar').doc(id);
        const doc = await tx.get(docRef);
        if (doc.exists) {
          const updatePayload = {
            status: 'APPROVED',
            approvedAt: now,
            approvedBy,
            updatedAt: now,
          };
          await tx.update(docRef, updatePayload);
          results.push({ id, ...doc.data(), ...updatePayload });
        }
      }
      return results;
    });

    for (const item of updatedEntries) {
      await this.firebase.createCalendarAuditTrail({
        action: 'POST_BULK_APPROVED',
        previousValue: { status: item.status },
        newValue: { status: 'APPROVED', approvedBy },
        user: approvedBy,
        businessId: item.businessId,
        calendarEntryId: item.id,
      });
    }

    return {
      success: true,
      message: `Successfully approved ${updatedEntries.length} post(s)`,
      count: updatedEntries.length,
      entries: updatedEntries,
    };
  }

  /**
   * Edits a calendar post entry. Uses Firestore transaction.
   */
  async editPost(id: string, updateData: any, user = 'User') {
    let entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) {
      this.logger.log(`Calendar entry ${id} not found in contentCalendar collection — auto-upserting entry...`);
      const now = new Date();
      const upsertPayload = {
        id,
        businessId: updateData.businessId || 'default',
        headline: updateData.headline || 'Scheduled Post',
        caption: updateData.caption || '',
        platform: updateData.platform || 'Instagram',
        status: updateData.status || 'SCHEDULED',
        updatedAt: now,
        createdAt: now,
        ...updateData,
      };
      await this.firebase.col('contentCalendar').doc(id).set(upsertPayload, { merge: true });
      return { success: true, entry: upsertPayload };
    }

    if (updateData.status && updateData.status !== entry.status) {
      this.validateStatusTransition(entry.status, updateData.status);
    }

    const now = new Date();
    const updated = await this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(id);
      const updatePayload = {
        ...updateData,
        updatedAt: now,
      };
      await tx.update(docRef, updatePayload);
      return { ...entry, ...updatePayload };
    });

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_EDITED',
      previousValue: entry,
      newValue: updated,
      user,
      businessId: entry.businessId,
      calendarEntryId: id,
    });

    return { success: true, entry: updated };
  }

  /** Legacy edit alias */
  async updateCalendarEntry(id: string, data: any) {
    return this.editPost(id, data);
  }

  /**
   * Duplicates a post entry. Uses Firestore transaction.
   */
  async duplicatePost(id: string, user = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) throw new NotFoundException(`Calendar entry ${id} not found`);

    const newId = this.firebase.generateId();
    const now = new Date();
    const newEntry = {
      ...entry,
      id: newId,
      headline: `(Copy) ${entry.headline || entry.contentIdea || 'Post'}`,
      status: 'DRAFT',
      approvedAt: null,
      approvedBy: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(newId);
      await tx.set(docRef, newEntry);
    });

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_DUPLICATED',
      previousValue: { originalId: id },
      newValue: { newId, headline: newEntry.headline },
      user,
      businessId: entry.businessId,
      calendarEntryId: newId,
    });

    return { success: true, entry: newEntry };
  }

  /**
   * Deletes a calendar post. Uses Firestore transaction.
   */
  async deletePost(id: string, user = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    try {
      await this.firebase.col('contentCalendar').doc(id).delete();
      await this.firebase.col('scheduledPosts').doc(id).delete();
    } catch (err: any) {
      this.logger.warn(`Could not delete doc ${id}: ${err.message}`);
    }

    if (entry?.businessId) {
      await this.firebase.createCalendarAuditTrail({
        action: 'POST_DELETED',
        previousValue: entry,
        newValue: null,
        user,
        businessId: entry.businessId,
        calendarEntryId: id,
      });
    }

    return { success: true, id };
  }

  async deleteCalendarEntry(id: string) {
    return this.deletePost(id);
  }

  /**
   * Reschedules a calendar post to a new date/time. Uses Firestore transaction.
   */
  async reschedulePost(id: string, newScheduledTime: string | Date, user = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) throw new NotFoundException(`Calendar entry ${id} not found`);

    const parsedDate = new Date(newScheduledTime);
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`Invalid scheduledTime date string: ${newScheduledTime}`);
    }

    const now = new Date();
    const updated = await this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(id);
      const updatePayload = {
        scheduledTime: parsedDate,
        updatedAt: now,
      };
      await tx.update(docRef, updatePayload);
      return { ...entry, ...updatePayload };
    });

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_RESCHEDULED',
      previousValue: { scheduledTime: entry.scheduledTime },
      newValue: { scheduledTime: parsedDate },
      user,
      businessId: entry.businessId,
      calendarEntryId: id,
    });

    return { success: true, entry: updated };
  }

  /**
   * Regenerates creative content for a single post using AI.
   */
  async regenerateSinglePost(id: string, user = 'User') {
    let entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) {
      this.logger.log(`Entry ${id} not pre-saved in database — creating fallback entry context for AI regeneration...`);
      entry = {
        id,
        businessId: 'default',
        postType: 'Image',
        category: 'Educational',
        headline: 'Dynamic Post',
        caption: 'Original post content',
        regenerateCount: 0,
      };
    }

    // Enforce 2-regeneration limit
    const currentRegenCount = entry.regenerateCount || 0;
    if (currentRegenCount >= 2) {
      throw new BadRequestException('Regeneration limit reached. You can only regenerate each post 2 times.');
    }

    const context = await this.businessIntelligence.getBusinessContext(entry.businessId);

    const prompt = `You are an expert social media marketing writer for Visionpilot AI (Meta authorised AI marketing agent).
Regenerate creative content for a single post:
Business: ${context.businessName}
Industry: ${context.businessCategory}
Target Audience: ${context.targetAudience}
Brand Tone: ${context.brandVoice}
Original Post Type: ${entry.postType || 'Image'}
Original Category: ${entry.category || 'Educational'}

Generate eye-catching, scroll-stopping content perfectly tailored to this business.
Return ONLY valid JSON (no markdown, no code fences):
{
  "headline": "New compelling hook",
  "caption": "Fresh engaging caption with strong call to action and emojis",
  "cta": "Shop Now",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "graphicPrompt": "Detailed AI image prompt: vibrant, professional social media creative for this business"
}`;

    let result: any = null;
    try {
      const response = await this.aiService.generateStructuredJson<any>(
        'You are an expert social media copywriter. Return valid JSON.',
        prompt,
        { temperature: 0.9, maxTokens: 1500 },
        'ContentService.regenerateSinglePost',
      );
      result = response.data;
    } catch (err: any) {
      this.logger.error(`Single post regeneration error: ${err.message}`);
    }

    if (!result) {
      result = {
        headline: `Fresh Focus: ${context.businessName}`,
        caption: `✨ Experience quality with ${context.businessName}. Crafted specifically for ${context.targetAudience}. Click the link in bio to discover more! 👇`,
        cta: 'Discover More',
        hashtags: ['#Quality', '#Brand', '#Innovation', '#Trending', '#MustHave'],
        graphicPrompt: `Modern professional social media creative for ${context.businessName}, vibrant colors, eye-catching design`,
      };
    }

    // Regenerate personalized AI creative image & overlay
    let newImageUrl = entry.imageUrl;
    try {
      newImageUrl = await this.generateAndCompositeImage(entry.businessId, {
        headline: result.headline || entry.headline,
        caption: result.caption || entry.caption,
        cta: result.cta || entry.cta,
        category: entry.category,
        postType: entry.postType,
        graphicPrompt: result.graphicPrompt,
        topic: result.headline || entry.headline,
      });
    } catch (imgErr: any) {
      this.logger.warn(`Image regeneration failed, keeping existing image: ${imgErr.message}`);
    }

    const updated = await this.editPost(
      id,
      {
        headline: result.headline || entry.headline,
        caption: result.caption || entry.caption,
        cta: result.cta || entry.cta,
        hashtags: result.hashtags || entry.hashtags,
        graphicPrompt: result.graphicPrompt || entry.graphicPrompt,
        imageUrl: newImageUrl,
        regenerateCount: currentRegenCount + 1,
      },
      user,
    );

    await this.firebase.createCalendarAuditTrail({
      action: 'POST_REGENERATED',
      previousValue: { headline: entry.headline },
      newValue: { headline: result.headline },
      user,
      businessId: entry.businessId,
      calendarEntryId: id,
    });

    return updated;
  }

  /**
   * Immediately publishes a calendar entry to Facebook and/or Instagram via Meta Graph API.
   * Platform: 'facebook' | 'instagram' | 'both'
   */
  async postNow(id: string, platform = 'both', user = 'User') {
    const entry = await this.firebase.getContentCalendarEntryById(id);
    if (!entry) throw new NotFoundException(`Calendar entry ${id} not found`);

    const businessId = entry.businessId;
    const fullCaption = entry.hashtags?.length
      ? `${entry.caption}\n\n${Array.isArray(entry.hashtags) ? entry.hashtags.join(' ') : entry.hashtags}`
      : entry.caption || '';
    const imageUrl = entry.imageUrl || null;

    const results: any = {};

    // Publish to Facebook
    if (platform === 'facebook' || platform === 'both') {
      try {
        const fbResult = await this.integrations.publishPagePost(businessId, fullCaption, imageUrl);
        results.facebook = fbResult;
        this.logger.log(`[postNow] Facebook result for entry ${id}: ${JSON.stringify(fbResult)}`);
      } catch (err: any) {
        results.facebook = { success: false, error: err.message };
        this.logger.error(`[postNow] Facebook publish failed for entry ${id}: ${err.message}`);
      }
    }

    // Publish to Instagram
    if (platform === 'instagram' || platform === 'both') {
      try {
        const igResult = await this.integrations.publishInstagramPost(businessId, fullCaption, imageUrl);
        results.instagram = igResult;
        this.logger.log(`[postNow] Instagram result for entry ${id}: ${JSON.stringify(igResult)}`);
      } catch (err: any) {
        results.instagram = { success: false, error: err.message };
        this.logger.error(`[postNow] Instagram publish failed for entry ${id}: ${err.message}`);
      }
    }

    // Determine overall success
    const isSuccess = Object.values(results).some((r: any) => r?.success !== false);

    // Update entry status to PUBLISHED. This intentionally bypasses
    // editPost/validateStatusTransition: that guard protects manual edits
    // from illegal jumps (e.g. someone directly setting DRAFT -> PUBLISHED
    // with nothing actually posted), but "Post Now" is meant to work from
    // any status — including DRAFT — and by this point Meta has already
    // confirmed the post went out. Routing through the generic transition
    // check meant a perfectly successful Facebook/Instagram publish still
    // threw "Invalid status transition from 'DRAFT' to 'PUBLISHED'", the
    // entry stayed stuck on its old status, and the UI showed "Post Failed"
    // for a post that was, in fact, already live — inviting a retry that
    // would have posted the same caption to the Page a second time.
    if (isSuccess) {
      await this.markCalendarEntryPublishedNow(id, entry);
    }

    await this.firebase.createCalendarAuditTrail({
      action: isSuccess ? 'POST_PUBLISHED_NOW' : 'POST_PUBLISH_FAILED',
      previousValue: { status: entry.status },
      newValue: { status: isSuccess ? 'PUBLISHED' : entry.status, platform, results },
      user,
      businessId,
      calendarEntryId: id,
    });

    return {
      success: isSuccess,
      entryId: id,
      platform,
      results,
    };
  }

  /**
   * Flips a calendar entry straight to PUBLISHED once Meta has confirmed the
   * post actually went out — see the comment in postNow for why this skips
   * validateStatusTransition rather than going through editPost.
   */
  private async markCalendarEntryPublishedNow(id: string, entry: any) {
    const now = new Date();
    return this.firebase.runTransaction(async (tx) => {
      const docRef = this.firebase.col('contentCalendar').doc(id);
      const updatePayload = { status: 'PUBLISHED', publishedAt: now, updatedAt: now };
      await tx.update(docRef, updatePayload);
      return { ...entry, ...updatePayload };
    });
  }

  async regenerateCalendarEntry(id: string) {
    return this.regenerateSinglePost(id);
  }

  // ─── Deferred Operations (Return HTTP 501) ────────────────────────────────

  async regenerateWeek(businessId: string, weekNumber: number) {
    this.logger.log(`Deferred endpoint called: regenerateWeek business=${businessId} week=${weekNumber}`);
    throw new NotImplementedException('Regenerate week functionality is deferred until required by frontend.');
  }

  async regenerateMonth(businessId: string) {
    this.logger.log(`Deferred endpoint called: regenerateMonth business=${businessId}`);
    throw new NotImplementedException('Regenerate month functionality is deferred until required by frontend.');
  }

  async markPublished(calendarEntryId: string) {
    return this.editPost(calendarEntryId, { status: 'PUBLISHED', publishedAt: new Date() });
  }

  async createCalendarEntry(data: any) {
    const entry = await this.firebase.createContentCalendarEntry({
      ...data,
      scheduledTime: data.scheduledTime ? new Date(data.scheduledTime) : new Date(),
    });
    return { success: true, entry };
  }
}
