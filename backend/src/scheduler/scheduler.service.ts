import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirebaseService } from '../firebase/firebase.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AiService } from '../ai/ai.service';
import { calculateNext10AMSlot } from '../utils/timezone-scheduler';
import { publishOrganicSimultaneously } from '../lib/meta/organic-publisher';
import { generateScheduleSlots, calculateNext10AM, ScheduleRule, isValidScheduleRule } from '../lib/scheduler/time-engine';
import { PublishLogEntry } from '../firebase/firestore.schema';
import { RabbitMqService } from './rabbitmq.service';
import { getPlanLimits } from '../payment/payment.constants';

/**
 * SchedulerService — Phase 3 & 4: AI Auto Scheduler + Meta Auto Posting.
 *
 * Manages post scheduling lifecycle: SCHEDULED → PAUSED → PUBLISHING → PUBLISHED / FAILED / CANCELLED
 * Runs a cron job every 5 minutes to check for and publish due posts via Meta Graph API.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly integrations: IntegrationsService,
    private readonly rabbitmq: RabbitMqService,
    private readonly aiService: AiService,
  ) {}

  async onModuleInit() {
    await this.rabbitmq.registerPublishHandler((postId) => this.publishSinglePost(postId));
  }

  // ─── Schedule Management ──────────────────────────────────────────────────────

  /**
   * Schedule a new post for future publishing.
   */
  async schedulePost(data: {
    businessId: string;
    calendarEntryId?: string;
    caption: string;
    headline?: string;
    hashtags?: string[];
    imageUrl?: string;
    imageOverlayText?: string;
    profileBio?: string;
    platform: string; // 'Facebook' | 'Instagram'
    scheduledTime: Date | string;
    postType?: string;
  }) {
    const scheduledTime = data.scheduledTime instanceof Date
      ? data.scheduledTime
      : new Date(data.scheduledTime);

    const post = await this.firebase.createScheduledPost({
      businessId: data.businessId,
      calendarEntryId: data.calendarEntryId || null,
      caption: data.caption,
      headline: data.headline || '',
      hashtags: data.hashtags || [],
      imageUrl: data.imageUrl || null,
      imageOverlayText: data.imageOverlayText || '',
      profileBio: data.profileBio || '',
      platform: data.platform,
      scheduledTime,
      postType: data.postType || 'Image Post',
      status: 'SCHEDULED',
      publishResult: null,
    });

    this.logger.log(`Post scheduled: ${post.id} for ${scheduledTime.toISOString()} on ${data.platform}`);
    const business = await this.firebase.getBusinessById(data.businessId);
    if (business?.ownerId) {
      await this.firebase.createAuditLog({
        userId: business.ownerId,
        businessId: data.businessId,
        action: 'POST_SCHEDULED',
        details: JSON.stringify({ postId: post.id, platform: data.platform, scheduledTime: scheduledTime.toISOString() }),
      });
    }
    try {
      await this.rabbitmq.enqueueScheduledPost(post.id, scheduledTime);
    } catch (rabbitErr: any) {
      this.logger.warn(`Failed to enqueue post ${post.id} to RabbitMQ: ${rabbitErr.message}`);
    }
    return { success: true, post };
  }

  /**
   * Pause a scheduled post — prevents it from being published.
   */
  async pausePost(postId: string) {
    const post = await this.firebase.getScheduledPostById(postId);
    if (!post) throw new NotFoundException('Scheduled post not found');
    if (post.status !== 'SCHEDULED') {
      return { success: false, message: `Cannot pause a post with status: ${post.status}` };
    }

    const updated = await this.firebase.updateScheduledPost(postId, { status: 'PAUSED' });
    this.logger.log(`Post paused: ${postId}`);
    return { success: true, post: updated };
  }

  /**
   * Resume a paused post — re-enables it for publishing.
   */
  async resumePost(postId: string) {
    const post = await this.firebase.getScheduledPostById(postId);
    if (!post) throw new NotFoundException('Scheduled post not found');
    if (post.status !== 'PAUSED') {
      return { success: false, message: `Cannot resume a post with status: ${post.status}` };
    }

    const updated = await this.firebase.updateScheduledPost(postId, { status: 'SCHEDULED' });
    this.logger.log(`Post resumed: ${postId}`);
    return { success: true, post: updated };
  }

  /**
   * Cancel a scheduled or paused post.
   */
  async cancelPost(postId: string) {
    const post = await this.firebase.getScheduledPostById(postId);
    if (!post) throw new NotFoundException('Scheduled post not found');
    if (post.status === 'PUBLISHED' || post.status === 'CANCELLED') {
      return { success: false, message: `Cannot cancel a post with status: ${post.status}` };
    }

    const updated = await this.firebase.updateScheduledPost(postId, { status: 'CANCELLED' });
    this.logger.log(`Post cancelled: ${postId}`);
    return { success: true, post: updated };
  }

  /**
   * Reschedule a post to a new time.
   */
  async reschedulePost(postId: string, newScheduledTime: Date | string) {
    const post = await this.firebase.getScheduledPostById(postId);
    if (!post) throw new NotFoundException('Scheduled post not found');
    if (post.status === 'PUBLISHED' || post.status === 'CANCELLED') {
      return { success: false, message: `Cannot reschedule a post with status: ${post.status}` };
    }

    const scheduledTime = newScheduledTime instanceof Date
      ? newScheduledTime
      : new Date(newScheduledTime);

    const updated = await this.firebase.updateScheduledPost(postId, {
      scheduledTime,
      status: 'SCHEDULED',
    });
    await this.rabbitmq.enqueueScheduledPost(postId, scheduledTime);
    this.logger.log(`Post rescheduled: ${postId} to ${scheduledTime.toISOString()}`);
    return { success: true, post: updated };
  }

  /**
   * Get all scheduled posts for a business.
   */
  async getScheduledPosts(businessId: string) {
    const posts = await this.firebase.getScheduledPostsByBusinessId(businessId);
    return { total: posts.length, posts };
  }

  /**
   * Publishes a single scheduled post by document ID (invoked by Cloud Tasks HTTP webhook).
   */
  async publishSinglePost(postId: string) {
    this.logger.log(`[SchedulerService] Publishing single post ${postId} via Cloud Task webhook execution`);

    const post = (await this.firebase.getScheduledPostById(postId)) || (await this.firebase.socialPostsDao?.findById(postId));
    if (!post) {
      throw new NotFoundException(`Scheduled post ${postId} not found`);
    }

    if (post.status !== 'SCHEDULED') {
      return { success: false, postId, skipped: true, reason: `Post is ${post.status}` };
    }
    const scheduledDate = post.scheduledTime?.toDate?.() || new Date(post.scheduledTime);
    if (scheduledDate.getTime() > Date.now()) {
      await this.rabbitmq.enqueueScheduledPost(postId, scheduledDate);
      return { success: false, postId, skipped: true, reason: 'Post is not due yet' };
    }

    // Mark as PUBLISHING
    await this.firebase.updateScheduledPost(postId, { status: 'PUBLISHING' });

    let publishResult: any = null;
    try {
      publishResult = await this.publishToMeta(post);
    } catch (metaErr: any) {
      this.logger.warn(`Meta API publish failed for post ${postId}: ${metaErr.message}`);
      publishResult = { success: false, error: metaErr.message };
    }

    // Mark as PUBLISHED or FAILED based on publishResult
    const isSuccess = publishResult?.success !== false;
    const finalStatus = isSuccess ? 'PUBLISHED' : 'FAILED';

    const updatedPost = await this.firebase.updateScheduledPost(postId, {
      status: finalStatus,
      publishedAt: isSuccess ? new Date() : null,
      publishResult,
    });

    const business = await this.firebase.getBusinessById(post.businessId);
    if (business?.ownerId) {
      await this.firebase.createAuditLog({
        userId: business.ownerId,
        businessId: post.businessId,
        action: isSuccess ? 'POST_PUBLISHED' : 'POST_PUBLISH_FAILED',
        details: JSON.stringify({ postId, platform: post.platform, publishResult }),
      });
    }

    if (post.calendarEntryId && isSuccess) {
      try {
        await this.firebase.updateContentCalendarEntry(post.calendarEntryId, {
          status: 'PUBLISHED',
          publishedAt: new Date(),
        });
      } catch { /* ignore */ }
    }

    return {
      success: isSuccess,
      postId,
      status: finalStatus,
      post: updatedPost,
      publishResult,
    };
  }

  // ─── Cron Job 1: Auto Publishing (Runs Every 10 Minutes) ──────────────────────

  /**
   * Runs every 10 minutes — finds due SCHEDULED posts and executes them automatically.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCronPublishing() {
    await this.triggerAutomatedPosting();
  }

  // ─── Cron Job 2: Automated Daily AI Post Generation & Replenishment ──────────

  /**
   * Runs every night at Midnight — automatically generates fresh AI posts for all businesses.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCronAutoReplenish() {
    this.logger.log('[Cron Job] Running automated daily AI post generation & replenishment…');
    try {
      const snap = await this.firebase.col('businesses').get();
      const businesses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      for (const bus of businesses) {
        try {
          // Only the COUNT of upcoming posts matters here. Fetching every
          // scheduled post for every business just to call .length multiplied
          // Firestore reads by the size of the whole collection.
          const activeUpcomingCount = await this.firebase.countScheduledPosts(bus.id, 'SCHEDULED');

          if (activeUpcomingCount < 7) {
            this.logger.log(`[Cron Job] Business ${bus.id} (${(bus as any).name || 'Unnamed'}) has only ${activeUpcomingCount} scheduled posts. Auto-generating next week's AI posts…`);
            await this.scheduleInstantWeek({
              businessId: bus.id,
              count: 7,
              daysMode: 'everyday',
              publishTime: '10:00 AM',
            });
            this.logger.log(`[Cron Job] Successfully auto-generated 7 new AI posts for business ${bus.id}`);
          }
        } catch (bErr: any) {
          this.logger.error(`[Cron Job] Failed auto-generation for business ${bus.id}: ${bErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`[Cron Job] Failed execution of handleCronAutoReplenish: ${err.message}`);
    }
  }

  /**
   * Main publishing job — can also be triggered manually.
   */
  async triggerAutomatedPosting(): Promise<{
    success: boolean;
    processedCount: number;
    failedCount: number;
    processed: string[];
    failed: string[];
  }> {
    this.logger.log('Scheduler job started — scanning for due posts…');

    const duePosts = await this.firebase.getDueScheduledPosts();
    const processed: string[] = [];
    const failed: string[] = [];

    for (const post of duePosts) {
      try {
        await this.firebase.updateScheduledPost(post.id, { status: 'PUBLISHING' });

        let publishResult: any = null;
        try {
          publishResult = await this.publishToMeta(post);
        } catch (metaErr: any) {
          this.logger.warn(`Meta API publish failed for post ${post.id}: ${metaErr.message}`);
          publishResult = { success: false, error: metaErr.message };
        }

        const publishSucceeded = publishResult?.success !== false;
        const finalStatus = publishSucceeded ? 'PUBLISHED' : 'FAILED';

        await this.firebase.updateScheduledPost(post.id, {
          status: finalStatus,
          ...(publishSucceeded ? { publishedAt: new Date() } : {}),
          publishResult,
        });

        if (post.calendarEntryId && publishSucceeded) {
          try {
            await this.firebase.updateContentCalendarEntry(post.calendarEntryId, {
              status: 'PUBLISHED',
              publishedAt: new Date(),
            });
          } catch { /* calendar entry may not exist */ }
        }

        if (publishSucceeded) {
          processed.push(post.id);
          this.logger.log(`Published post ${post.id} on ${post.platform}`);
        } else {
          failed.push(post.id);
          this.logger.warn(`Post ${post.id} was not published on ${post.platform}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to publish post ${post.id}:`, err.message);
        await this.firebase.updateScheduledPost(post.id, {
          status: 'FAILED',
          publishResult: { error: err.message },
        });
        failed.push(post.id);
      }
    }

    const businesses = await this.firebase.getAllBusinesses();
    for (const business of businesses) {
      try {
        const entries = await this.firebase.getContentCalendarByBusinessId(business.id);
        const now = new Date();
        const due = entries.filter((e: any) => {
          if (e.status !== 'SCHEDULED') return false;
          const scheduled = e.scheduledTime instanceof Date
            ? e.scheduledTime
            : new Date(e.scheduledTime?._seconds ? e.scheduledTime._seconds * 1000 : e.scheduledTime);
          return scheduled <= now;
        });

        for (const entry of due) {
          try {
            await this.firebase.updateContentCalendarEntry(entry.id, {
              status: 'PUBLISHED',
              publishedAt: new Date(),
            });
            processed.push(entry.id);
          } catch (err: any) {
            await this.firebase.updateContentCalendarEntry(entry.id, { status: 'FAILED' });
            failed.push(entry.id);
          }
        }
      } catch (err: any) {
        this.logger.error(`Error processing business ${business.id}:`, err.message);
      }
    }

    this.logger.log(`Scheduler job complete — processed: ${processed.length}, failed: ${failed.length}`);

    return { success: true, processedCount: processed.length, failedCount: failed.length, processed, failed };
  }

  /**
   * Phase 4: Publish a post to Meta Graph API.
   */
  private async publishToMeta(post: any): Promise<any> {
    const targetWorkspaceId = post.workspaceId || post.businessId;
    const workspace = (await this.firebase.workspacesDao?.findById(targetWorkspaceId)) || (await this.firebase.getBusinessById(targetWorkspaceId));
    const ownerId = workspace?.ownerId || (workspace as any)?.memberIds?.[0];
    const userDoc = ownerId && this.firebase.usersDao ? await this.firebase.usersDao.findById(ownerId) : null;

    const accessToken = workspace?.metaAccessToken || userDoc?.metaAccessToken;

    if (!accessToken && !this.integrations.isMock) {
      return { success: false, error: 'Meta not connected' };
    }

    const fullCaption = post.hashtags?.length
      ? `${post.caption}\n\n${post.hashtags.join(' ')}`
      : post.caption;

    const platform = (post.platform || 'instagram').toLowerCase();

    const publishFacebook = async () => {
      try {
        const result = await this.integrations.publishPagePost(targetWorkspaceId, fullCaption, post.imageUrl || null);
        if (result.success === false) {
          this.logger.error(`Facebook publish returned failure: ${result.error || 'unknown Meta Page error'}`);
        }
        return { success: true, platform: 'Facebook', ...result };
      } catch (err: any) {
        this.logger.error(`Facebook publish failed: ${err.message}`);
        return { success: false, platform: 'Facebook', error: err.message };
      }
    };

    const publishInstagram = async () => {
      try {
        const result = await this.integrations.publishInstagramPost(targetWorkspaceId, fullCaption, post.imageUrl || null);
        if (result.success === false) {
          this.logger.error(`Instagram publish returned failure: ${result.error || 'unknown Meta Instagram error'}`);
        }
        return { success: true, platform: 'Instagram', ...result };
      } catch (err: any) {
        this.logger.error(`Instagram publish failed: ${err.message}`);
        return { success: false, platform: 'Instagram', error: err.message };
      }
    };

    if (platform === 'both') {
      const [facebook, instagram] = await Promise.all([publishFacebook(), publishInstagram()]);
      return { success: facebook.success && instagram.success, platform: 'both', facebook, instagram };
    }

    if (platform === 'facebook') return publishFacebook();
    if (platform === 'instagram') return publishInstagram();

    return { success: true, note: 'Post logged (no platform matched)' };
  }

  async getPendingCount(): Promise<{ pendingCount: number }> {
    const businesses = await this.firebase.getAllBusinesses();
    let count = 0;
    for (const b of businesses) {
      const entries = await this.firebase.getContentCalendarByBusinessId(b.id);
      count += entries.filter((e: any) => e.status === 'SCHEDULED').length;
      const posts = await this.firebase.getScheduledPostsByBusinessId(b.id);
      count += posts.filter((p: any) => p.status === 'SCHEDULED').length;
    }
    return { pendingCount: count };
  }

  /**
   * Schedules an organic post to target exactly 10:00 AM in the user's local timezone.
   */
  async scheduleOrganicPost(data: {
    businessId: string;
    caption: string;
    imageUrl?: string;
    headline?: string;
    hashtags?: string[];
    timezone?: string;
    platforms?: string;
  }) {
    const slotResult = calculateNext10AMSlot(data.timezone);
    const scheduledTime = slotResult.targetDate;

    const post = await this.firebase.createScheduledPost({
      businessId: data.businessId,
      caption: data.caption,
      headline: data.headline || '',
      hashtags: data.hashtags || [],
      imageUrl: data.imageUrl || null,
      platform: data.platforms || 'both',
      scheduledTime,
      postType: 'Organic 10AM Post',
      status: 'SCHEDULED',
      publishResult: null,
      timezone: data.timezone || 'local',
    } as any);

    this.logger.log(`Organic post scheduled for 10:00 AM slot: ${post.id} at ${slotResult.formattedLocal} (${slotResult.isoString})`);
    try {
      await this.rabbitmq.enqueueScheduledPost(post.id, scheduledTime);
    } catch (rabbitErr: any) {
      this.logger.warn(`Failed to enqueue organic post ${post.id} to RabbitMQ: ${rabbitErr.message}`);
    }

    return {
      success: true,
      post,
      scheduledTime: slotResult.targetDate.toISOString(),
      scheduledSlot: slotResult,
    };
  }

  /**
   * Schedules a batch of organic posts at computed 10:00 AM slots using a schedule rule.
   */
  async scheduleOrganicBatch(data: {
    businessId: string;
    caption: string;
    imageUrl?: string;
    headline?: string;
    hashtags?: string[];
    timezone?: string;
    platforms?: string;
    scheduleRule?: string;
    count?: number;
  }) {
    const rule: ScheduleRule = isValidScheduleRule(data.scheduleRule || '') 
      ? (data.scheduleRule as ScheduleRule) 
      : 'daily_10am';
    const tz = data.timezone || 'UTC';
    const count = Math.min(data.count || 10, 30);

    const batchResult = generateScheduleSlots(rule, tz, count);
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const posts: any[] = [];

    for (const slot of batchResult.slots) {
      const post = await this.firebase.createScheduledPost({
        businessId: data.businessId,
        caption: data.caption,
        headline: data.headline || '',
        hashtags: data.hashtags || [],
        imageUrl: data.imageUrl || null,
        platform: data.platforms || 'both',
        scheduledTime: slot.targetDate,
        postType: 'Organic 10AM Post',
        status: 'SCHEDULED',
        publishResult: null,
        publishLogs: [{
          timestamp: new Date().toISOString(),
          action: 'BATCH_SCHEDULED',
          details: `Slot ${slot.slotIndex + 1}/${count} via rule '${rule}' for ${slot.formattedLocal}`,
        }],
        timezone: tz,
        scheduleRule: rule,
        batchId,
      } as any);

      posts.push(post);
      try {
        await this.rabbitmq.enqueueScheduledPost(post.id, slot.targetDate);
      } catch (rabbitErr: any) {
        this.logger.warn(`Failed to enqueue organic batch post ${post.id} to RabbitMQ: ${rabbitErr.message}`);
      }
      this.logger.log(`[OrganicBatch] Post ${post.id} scheduled for slot ${slot.slotIndex + 1}: ${slot.formattedLocal}`);
    }

    return {
      success: true,
      batchId,
      rule,
      timezone: tz,
      count: posts.length,
      posts,
      slots: batchResult.slots.map((s) => ({
        index: s.slotIndex,
        scheduledTime: s.isoString,
        formattedLocal: s.formattedLocal,
        timestampMs: s.timestampMs,
      })),
    };
  }

  /** Build a distinct business-aware plan for the Instant Posts panel with AI captions and unique images. */
  async scheduleInstantWeek(data: {
    businessId: string;
    count?: number;
    daysMode?: string;
    publishTime?: string;
    platforms?: string;
    timezone?: string;
  }) {
    const business = await this.firebase.getBusinessById(data.businessId);
    const profile = await this.firebase.getBusinessProfile(data.businessId);
    if (!business && !profile) throw new NotFoundException('Business profile not found');

    const businessName = profile?.businessName || business?.name || 'Your business';
    const category = profile?.businessCategory || profile?.industry || business?.niche || 'your industry';
    const productsServices = profile?.productsServices || profile?.products || 'your products or services';
    const targetAudience = profile?.targetAudience || 'your ideal customers';
    const goal = profile?.businessGoals || 'increase sales & brand awareness';
    const usp = profile?.businessUSP || 'premium quality and 24/7 support';
    const brandTone = profile?.brandTone || profile?.brandVoice || 'clear, friendly, and engaging';
    const location = profile?.location || '';

    let targetHours = 10;
    let targetMinutes = 0;
    if (data.publishTime) {
      const timeStr = String(data.publishTime).trim().toUpperCase();
      const isPM = timeStr.includes('PM');
      const isAM = timeStr.includes('AM');
      const cleanTime = timeStr.replace(/(AM|PM)/g, '').trim();
      const parts = cleanTime.split(':');
      if (parts.length >= 1) {
        let h = parseInt(parts[0], 10);
        if (!isNaN(h)) {
          if (isPM && h < 12) h += 12;
          if (isAM && h === 12) h = 0;
          targetHours = Math.min(Math.max(h, 0), 23);
        }
      }
      if (parts.length >= 2) {
        let m = parseInt(parts[1], 10);
        if (!isNaN(m)) {
          targetMinutes = Math.min(Math.max(m, 0), 59);
        }
      }
    }

    const planName = (business as any)?.subscriptionPlan || (business as any)?.plan || (profile as any)?.subscriptionPlan || 'FREE';
    const limits = getPlanLimits(planName);

    const daysMode = data.daysMode || (Number(data.count) === 7 ? 'everyday' : 'workdays');
    const requestedCount = Number(data.count) || (daysMode === 'everyday' ? 7 : 5);
    const targetCount = Math.min(Math.max(requestedCount, 1), limits.postsPerWeek || 3);

    const existingPosts = await this.firebase.getScheduledPostsByBusinessId(data.businessId);
    const existingHeadlines = new Set((existingPosts || []).map((p: any) => (p.headline || '').trim().toLowerCase()));

    const postBlueprints = [
      { tag: 'Customer Story', headline: `Why customers choose ${businessName}`, imageTheme: `happy ${targetAudience} using or enjoying ${productsServices}, authentic customer lifestyle photography` },
      { tag: 'How It Works', headline: `How ${businessName} makes ${productsServices} easier`, imageTheme: `clear visual demonstration of ${productsServices}, human-centered commercial photography` },
      { tag: 'Behind The Scenes', headline: `Behind the scenes at ${businessName}`, imageTheme: `people creating, preparing, or delivering ${productsServices}, authentic behind-the-scenes photography` },
      { tag: 'Value Proposition', headline: `What makes ${businessName} different`, imageTheme: `hero product or service visual for ${productsServices}, premium branded commercial photography` },
      { tag: 'Tip', headline: `A useful tip for ${targetAudience}`, imageTheme: `helpful visual tip featuring ${productsServices}, clean editorial social media design` },
      { tag: 'FAQ', headline: `Your questions about ${productsServices}, answered`, imageTheme: `professional product or service consultation featuring ${productsServices}, friendly natural lighting` },
      { tag: 'Product Spotlight', headline: `Spotlight on ${productsServices}`, imageTheme: `detailed hero shot of ${productsServices}, professional product photography, brand-ready composition` },
      { tag: 'Call to Action', headline: `Ready to try ${productsServices}?`, imageTheme: `inviting ${productsServices} hero scene with clear space for text, eye-catching campaign photography` },
      { tag: 'Social Proof', headline: `Real results with ${businessName}`, imageTheme: `satisfied customer and positive outcome related to ${productsServices}, trustworthy brand photography` },
      { tag: 'Special Offer', headline: `A special moment for ${businessName} customers`, imageTheme: `attractive ${productsServices} promotional scene, celebratory commercial campaign photography` },
    ];

    const buildImageUrl = async (theme: string, postIndex: number): Promise<string> => {
      const businessText = `${category} ${productsServices}`.toLowerCase();
      const subjectRules = /saas|software|app|platform|ai|automation|digital|technology|tech/.test(businessText)
        ? 'This is a digital offering: show the described software, dashboard, workflow, device screen, or people using it; never show fashion, clothing racks, food, drinks, or unrelated physical products.'
        : /real estate|property|properties|construction|builder|architect/.test(businessText)
          ? 'Show the exact property, building, floor plan, site, or real-estate consultation; never show fashion, clothing racks, food, drinks, or unrelated products.'
          : /restaurant|food|cafe|bakery|drink|beverage|bar/.test(businessText)
            ? 'Show the exact food, dish, drink, or dining service described; never show fashion, clothing racks, software dashboards, or unrelated products.'
            : /fashion|apparel|clothing|garment|boutique|dress|shirt|jewelry|accessor/.test(businessText)
              ? 'Show the exact apparel or accessory described by the business; use a model only to display that product and avoid empty generic showrooms.'
              : 'Show only the exact product or service described by the business; do not substitute generic stock imagery or another industry.';
      const promptText = `Create a square social media advertising image for ${businessName}. Category: ${category}. Exact offering: ${productsServices}. Main visual concept: ${theme}. ${subjectRules} Brand tone: ${brandTone}. Photorealistic, polished commercial advertising photography, clear subject, no readable text, no watermark, no unrelated props.`;
      try {
        const result = await this.aiService.generateImage(promptText, { aspect_ratio: '1:1' });
        if (result?.imageUrl) return result.imageUrl;
      } catch (err: any) {
        this.logger.warn(`AI Image generation threw error in buildImageUrl: ${err.message}`);
      }
      return `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1080&height=1080&nologo=true&model=flux&seed=${Date.now()}_${postIndex}`;
    };

    const posts: any[] = [];
    const cursor = new Date();
    const batchId = `instant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let blueprintIndex = Math.floor(Math.random() * postBlueprints.length);

    for (let index = 0; posts.length < targetCount && index < 60; index++) {
      cursor.setDate(cursor.getDate() + (index === 0 ? 0 : 1));
      const dayOfWeek = cursor.getDay();

      if (daysMode === 'workdays' && (dayOfWeek === 0 || dayOfWeek === 6)) continue;
      if (daysMode === '3days' && (dayOfWeek === 0 || dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6)) continue;

      const blueprint = postBlueprints[blueprintIndex % postBlueprints.length];
      blueprintIndex++;

      let headline = blueprint.headline;
      let variantCount = 1;
      while (existingHeadlines.has(headline.toLowerCase())) {
        variantCount++;
        headline = `${blueprint.headline} (Vol. ${variantCount})`;
      }
      existingHeadlines.add(headline.toLowerCase());

      let caption = '';
      let hashtags: string[] = [];

      try {
        const systemPrompt = `You are a world-class viral social media copywriter for ${businessName}. Write complete, high-converting social media post captions.
STRICT MANDATE:
1. Every caption MUST start with a scroll-stopping VIRAL HOOK line with emojis (e.g., "🔥 Stop scrolling! Upgrade your wardrobe...", "✨ The secret to effortless everyday style just dropped...").
2. Do NOT use markdown asterisks (**) or header hashes (#). Do NOT cut off mid-sentence.
3. End with a strong Call to Action (e.g., "👉 Tap link in bio to shop now! ✨").`;

        const userPrompt = `Write an irresistible, high-converting social media caption for a "${blueprint.tag}" post.
Business Name: ${businessName}
Industry / Category: ${category}
Products / Services: ${productsServices}
Target Audience: ${targetAudience}
Brand Tone: ${brandTone}
Unique Selling Point (USP): ${usp}
Business Goal: ${goal}
${location ? `Location: ${location}` : ''}
Post Title: "${headline}"

Instructions:
- Write a COMPLETE 3-5 sentence caption (200-350 characters) starting with a scroll-stopping viral hook line (with emojis).
- Highlight ${businessName}'s USP (${usp}) in a ${brandTone} tone.
- Make the caption specific to this post and ${productsServices}; never reuse wording from another post.
- End with a strong call-to-action ("👉 Tap link in bio to shop the collection! ✨").

Format strictly as:
CAPTION: <your full complete caption with viral hook>
HASHTAGS: #tag1 #tag2 #tag3 #tag4 #tag5 #tag6 #tag7 #tag8`;

        const aiResponse = await this.aiService.chat(systemPrompt, userPrompt, 0.85, 1200, 'SchedulerService.scheduleInstantWeek');

        if (aiResponse && aiResponse.trim()) {
          const captionMatch = aiResponse.match(/CAPTION:\s*([\s\S]*?)(?=HASHTAGS:|$)/i);
          const hashtagsMatch = aiResponse.match(/HASHTAGS:\s*([\s\S]*)/i);

          if (captionMatch?.[1]?.trim()) {
            caption = captionMatch[1].trim().replace(/\*\*(.*?)\*\*/g, '$1');
          }
          if (hashtagsMatch?.[1]?.trim()) {
            const rawTags = hashtagsMatch[1].trim().split(/[\s,]+/).filter(t => t.startsWith('#'));
            hashtags = rawTags.slice(0, 10);
          }
        }
      } catch (aiErr: any) {
        this.logger.warn(`[InstantWeek] AI caption generation failed for post ${posts.length + 1}: ${aiErr.message}`);
      }

      if (!caption) {
        caption = `🔥 Upgrade your style game with ${businessName}! Discover premium quality ${productsServices} designed specifically for ${targetAudience}. Crafted with ${usp} for effortless comfort and elegance. 👉 Tap the link in bio to shop our latest collection today! ✨`;
      }
      // Keep the non-AI path business-specific and vary it by post instead of repeating one caption.
      if (!caption || /Upgrade your style game|shop our latest collection/i.test(caption)) {
        const fallbackCaptions = [
          `✨ Meet the ${productsServices} your ${targetAudience} have been looking for. ${businessName} brings ${usp} to every experience. Discover your next favourite today!`,
          `💡 Looking for a smarter way to choose ${productsServices}? ${businessName} makes it simple with ${usp}. See what makes us different and get started today.`,
          `👀 A closer look at ${businessName}: thoughtful ${productsServices}, made for ${targetAudience}. Experience ${usp} for yourself—explore now!`,
          `🚀 Ready for better ${productsServices}? Join customers who choose ${businessName} for ${usp}. Take the next step today!`,
        ];
        caption = fallbackCaptions[posts.length % fallbackCaptions.length];
      }
      if (!hashtags.length) {
        const catTag = `#${String(category).replace(/[^a-z0-9]/gi, '')}`;
        const bizTag = `#${String(businessName).replace(/[^a-z0-9]/gi, '')}`;
        const prodTag = `#${String(productsServices.split(',')[0] || 'Products').replace(/[^a-z0-9]/gi, '')}`;
        hashtags = [catTag, bizTag, prodTag, '#VisionpilotAI', '#SmallBusiness', '#SocialMedia', '#Style', '#Quality'];
      }

      const imageUrl = await buildImageUrl(blueprint.imageTheme, posts.length);

      const scheduledTime = this.getUtcDateForLocalTime(cursor, targetHours, targetMinutes, data.timezone || 'Asia/Kolkata');

      const newPost = await this.firebase.createScheduledPost({
        businessId: data.businessId,
        headline,
        contentDescription: `${blueprint.tag}: ${blueprint.imageTheme}. Tailored for ${targetAudience} and focused on ${productsServices}.`,
        caption,
        hashtags,
        imageUrl,
        platform: data.platforms || 'both',
        scheduledTime,
        postType: `${blueprint.tag} Post`,
        status: 'SCHEDULED',
        publishResult: null,
        timezone: data.timezone || 'Asia/Kolkata',
        batchId,
        batchType: 'INSTANT_WEEK',
        publishLogs: [{ timestamp: new Date().toISOString(), action: 'INSTANT_PLAN_CREATED', details: `${blueprint.tag} post ${posts.length + 1}/${targetCount} scheduled for ${scheduledTime.toISOString()}` }],
      } as any);

      posts.push(newPost);
      try {
        await this.rabbitmq.enqueueScheduledPost(newPost.id, scheduledTime);
      } catch (rabbitErr: any) {
        this.logger.warn(`Failed to enqueue scheduled post ${newPost.id} to RabbitMQ: ${rabbitErr.message}`);
      }
    }

    return { success: true, batchId, count: posts.length, posts };
  }

  /**
   * Worker handler executed at 10:00 AM: fetches post payload and calls Facebook & Instagram simultaneous endpoints using Promise.all().
   */
  async executeOrganicPublishWorker(postId: string) {
    this.logger.log(`[Organic Publish Worker] Executing 10:00 AM worker task for post: ${postId}`);
    const publishLogs: PublishLogEntry[] = [];

    publishLogs.push({
      timestamp: new Date().toISOString(),
      action: 'PUBLISH_START',
      platform: 'both',
      details: `Worker initiated for post ${postId}`,
    });

    const post = (await this.firebase.getScheduledPostById(postId)) || (await this.firebase.socialPostsDao?.findById(postId));
    if (!post) {
      throw new NotFoundException(`Organic post document ${postId} not found`);
    }

    // Mark status as PUBLISHING
    await this.firebase.updateScheduledPost(postId, {
      status: 'PUBLISHING',
      publishLogs: [...(post.publishLogs || []), ...publishLogs],
    });

    const targetWorkspaceId = post.workspaceId || post.businessId;
    const workspace = (await this.firebase.workspacesDao?.findById(targetWorkspaceId)) || (await this.firebase.getBusinessById(targetWorkspaceId));
    const ownerId = workspace?.ownerId || (workspace as any)?.memberIds?.[0];
    const userDoc = ownerId && this.firebase.usersDao ? await this.firebase.usersDao.findById(ownerId) : null;

    const pageId = workspace?.metaPageId || workspace?.selectedPageId;
    const pageAccessToken = workspace?.metaAccessToken || userDoc?.metaAccessToken;
    const instagramAccountId = workspace?.metaIgBusinessAccountId || workspace?.selectedInstagramAccountId || userDoc?.metaIgBusinessAccountId;

    const fullCaption = post.hashtags?.length
      ? `${post.caption}\n\n${post.hashtags.join(' ')}`
      : post.caption;

    const isMock = this.integrations.isMock || !pageAccessToken || pageAccessToken.startsWith('mock_');

    publishLogs.push({
      timestamp: new Date().toISOString(),
      action: 'API_CALL_START',
      platform: 'both',
      details: `Calling Meta Graph API (mock=${isMock}, pageId=${pageId || 'none'}, igId=${instagramAccountId || 'none'})`,
    });

    // Call Facebook and Instagram endpoints simultaneously using Promise.all() via publishOrganicSimultaneously
    const publishResult = await publishOrganicSimultaneously({
      pageId: pageId || 'mock_page_id',
      pageAccessToken,
      instagramAccountId: instagramAccountId || 'mock_ig_id',
      imageUrl: post.imageUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe',
      caption: fullCaption,
      isMock,
    });

    // Log per-platform results
    if (publishResult.facebook) {
      publishLogs.push({
        timestamp: new Date().toISOString(),
        action: publishResult.facebook.success ? 'FB_SUCCESS' : 'FB_FAILED',
        platform: 'facebook',
        postId: publishResult.facebook.postId || null,
        error: publishResult.facebook.error || null,
        details: `Facebook photo publish ${publishResult.facebook.success ? 'succeeded' : 'failed'}`,
      });
    }

    if (publishResult.instagram) {
      publishLogs.push({
        timestamp: new Date().toISOString(),
        action: publishResult.instagram.success ? 'IG_SUCCESS' : 'IG_FAILED',
        platform: 'instagram',
        postId: publishResult.instagram.postId || null,
        error: publishResult.instagram.error || null,
        details: `Instagram publish ${publishResult.instagram.success ? 'succeeded' : 'failed'}${publishResult.instagram.containerId ? ` (container: ${publishResult.instagram.containerId})` : ''}`,
      });
    }

    const isFbSuccess = !publishResult.facebook || publishResult.facebook.success;
    const isIgSuccess = !publishResult.instagram || publishResult.instagram.success;
    const isOverallSuccess = isFbSuccess && isIgSuccess;

    const finalStatus = isOverallSuccess ? 'PUBLISHED' : 'FAILED';

    publishLogs.push({
      timestamp: new Date().toISOString(),
      action: isOverallSuccess ? 'PUBLISH_COMPLETE' : 'PUBLISH_FAILED',
      platform: 'both',
      details: `Final status: ${finalStatus}`,
    });

    const allLogs = [...(post.publishLogs || []), ...publishLogs];

    const updatedPost = await this.firebase.updateScheduledPost(postId, {
      status: finalStatus,
      publishedAt: isOverallSuccess ? new Date() : null,
      publishResult,
      publishLogs: allLogs,
    });

    this.logger.log(`[Organic Publish Worker] Completed post ${postId} with status: ${finalStatus}`);

    return {
      success: isOverallSuccess,
      postId,
      status: finalStatus,
      publishResult,
      publishLogs: allLogs,
      post: updatedPost,
    };
  }

  /**
   * Returns all scheduled posts for a business organized by date for the calendar dashboard.
   */
  async getCalendarView(businessId: string) {
    const posts = await this.firebase.getScheduledPostsByBusinessId(businessId);

    // Group posts by date (YYYY-MM-DD)
    const byDate: Record<string, any[]> = {};
    for (const post of posts) {
      const scheduledTime = post.scheduledTime instanceof Date
        ? post.scheduledTime
        : new Date(post.scheduledTime?._seconds ? post.scheduledTime._seconds * 1000 : post.scheduledTime);

      if (!scheduledTime || isNaN(scheduledTime.getTime())) {
        this.logger.warn(`Skipping calendar entry ${post.id || 'unknown'} due to invalid scheduledTime: ${JSON.stringify(post.scheduledTime)}`);
        continue;
      }

      const dateKey = scheduledTime.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({
        ...post,
        scheduledTimeISO: scheduledTime.toISOString(),
        dateKey,
      });
    }

    // Sort dates
    const sortedDates = Object.keys(byDate).sort();
    const calendar = sortedDates.map((date) => ({
      date,
      posts: byDate[date],
      count: byDate[date].length,
      statuses: [...new Set(byDate[date].map((p: any) => p.status))],
    }));

    return {
      businessId,
      totalPosts: posts.length,
      totalDays: calendar.length,
      calendar,
    };
  }

  private getUtcDateForLocalTime(date: Date, hour: number, minute: number, timeZone: string): Date {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(date);
      const map: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
      }
      const year = parseInt(map.year, 10);
      const month = parseInt(map.month, 10);
      const day = parseInt(map.day, 10);

      const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
      const refDate = new Date(targetAsUtcMs);

      const offsetFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const offsetParts = offsetFormatter.formatToParts(refDate);
      const oMap: Record<string, string> = {};
      for (const p of offsetParts) {
        if (p.type !== 'literal') oMap[p.type] = p.value;
      }
      const oYear = parseInt(oMap.year, 10);
      const oMonth = parseInt(oMap.month, 10);
      const oDay = parseInt(oMap.day, 10);
      const oHour = parseInt(oMap.hour, 10);
      const oMinute = parseInt(oMap.minute, 10);
      const oSecond = parseInt(oMap.second, 10);

      const localAsUtc = Date.UTC(oYear, oMonth - 1, oDay, oHour, oMinute, oSecond);
      const offsetMs = localAsUtc - targetAsUtcMs;

      return new Date(targetAsUtcMs - offsetMs);
    } catch {
      const fallback = new Date(date);
      fallback.setHours(hour, minute, 0, 0);
      return fallback;
    }
  }
}
