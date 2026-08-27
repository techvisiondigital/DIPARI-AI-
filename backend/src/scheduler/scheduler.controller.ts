import {
  Controller, Post, Get, Patch, Body, Param, Query, Headers,
  BadRequestException, UnauthorizedException,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { calculateScheduleDetails, FrequencyRule } from '../utils/schedule-calculator';
import { CloudTasksService, ScheduledPostTask } from './cloud-tasks.service';
import { SpecialEventsService } from './special-events.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly cloudTasksService: CloudTasksService,
    private readonly specialEventsService: SpecialEventsService,
  ) {}

  /** POST /scheduler/enqueue-tasks — Enqueue array of post ID & timestamp tasks into Firebase Cloud Tasks */
  @Post('enqueue-tasks')
  async enqueueTasks(@Body() body: { tasks: ScheduledPostTask[] }) {
    if (!body?.tasks || !Array.isArray(body.tasks) || body.tasks.length === 0) {
      return { success: false, message: 'tasks array is required' };
    }
    const results = await this.cloudTasksService.enqueueScheduledPosts(body.tasks);
    return {
      success: true,
      enqueuedCount: results.filter((r) => r.success).length,
      queueSettings: this.cloudTasksService.getQueueSettings(),
      results,
    };
  }

  /** POST /scheduler/publish-task — HTTP target webhook invoked by Cloud Tasks upon scheduled execution time */
  @Post('publish-task')
  async handlePublishTaskWebhook(@Body() body: { postId: string; businessId?: string; scheduledTime?: string }) {
    if (!body?.postId) {
      return { success: false, message: 'postId is required in task payload' };
    }
    const publishResult = await this.schedulerService.publishSinglePost(body.postId);
    return {
      success: true,
      postId: body.postId,
      publishedAt: new Date().toISOString(),
      result: publishResult,
    };
  }

  /** POST /scheduler/calculate-dates — Calculate 10 exact Unix timestamps at 10:00 AM local time */
  @Post('calculate-dates')
  async calculateDates(@Body() body: {
    startDate?: string;
    frequencyRule?: FrequencyRule;
  }) {
    const startDate = body?.startDate ? new Date(body.startDate) : new Date();
    const frequencyRule = body?.frequencyRule || 'every_5_days';

    const result = calculateScheduleDetails({
      startDate,
      frequencyRule,
    });

    return {
      success: true,
      timestamps: result.timestampsMs,
      timestampsSec: result.timestampsSec,
      dates: result.formattedDates,
      isoStrings: result.isoStrings,
      frequencyRule: result.frequencyRule,
      count: result.count,
    };
  }

  /**
   * POST /scheduler/trigger — publish every post whose scheduled time has passed.
   *
   * This is the same job the internal 10-minute cron runs, exposed so an
   * external scheduler can drive it. That matters on hosts that suspend an idle
   * service: a sleeping process cannot run its own timer, so posts would sit
   * unpublished until somebody happened to visit the site.
   *
   * It publishes to real Facebook/Instagram accounts, so it is protected by a
   * shared secret. Set CRON_SECRET and send it as the x-cron-secret header (or
   * ?token=). If CRON_SECRET is unset the endpoint stays open, which keeps
   * existing setups working but is logged as a warning — anyone could otherwise
   * force-publish a business's queue.
   */
  @Post('trigger')
  async triggerScheduler(
    @Headers('x-cron-secret') headerSecret?: string,
    @Query('token') queryToken?: string,
  ) {
    const expected = process.env.CRON_SECRET?.trim();
    if (expected) {
      const provided = (headerSecret || queryToken || '').trim();
      if (provided !== expected) {
        throw new UnauthorizedException('Invalid or missing scheduler token.');
      }
    } else {
      console.warn(
        '[SchedulerController] /scheduler/trigger is publicly callable because CRON_SECRET is not set. Anyone can force-publish scheduled posts.',
      );
    }
    return this.schedulerService.triggerAutomatedPosting();
  }

  /** GET /scheduler/pending — count of SCHEDULED items waiting */
  @Get('pending')
  async getPending() {
    return this.schedulerService.getPendingCount();
  }

  /** POST /scheduler/schedule — schedule a new post */
  @Post('schedule')
  async schedulePost(@Body() body: {
    businessId: string;
    calendarEntryId?: string;
    caption: string;
    headline?: string;
    hashtags?: string[];
    imageUrl?: string;
    imageOverlayText?: string;
    profileBio?: string;
    platform: string;
    scheduledTime: string;
    postType?: string;
  }) {
    if (!body?.businessId || !body?.caption || !body?.platform || !body?.scheduledTime) {
      throw new BadRequestException('businessId, caption, platform, and scheduledTime are required');
    }
    return this.schedulerService.schedulePost(body);
  }

  /** GET /scheduler/posts?businessId=xxx — list all scheduled posts */
  @Get('posts')
  async getScheduledPosts(@Query('businessId') businessId: string) {
    return this.schedulerService.getScheduledPosts(businessId);
  }

  /** PATCH /scheduler/:id/pause — pause a scheduled post */
  @Patch(':id/pause')
  async pausePost(@Param('id') id: string) {
    return this.schedulerService.pausePost(id);
  }

  /** PATCH /scheduler/:id/resume — resume a paused post */
  @Patch(':id/resume')
  async resumePost(@Param('id') id: string) {
    return this.schedulerService.resumePost(id);
  }

  /** PATCH /scheduler/:id/cancel — cancel a post */
  @Patch(':id/cancel')
  async cancelPost(@Param('id') id: string) {
    return this.schedulerService.cancelPost(id);
  }

  /** PATCH /scheduler/:id/reschedule — reschedule a post */
  @Patch(':id/reschedule')
  async reschedulePost(
    @Param('id') id: string,
    @Body() body: { scheduledTime: string },
  ) {
    return this.schedulerService.reschedulePost(id, body.scheduledTime);
  }

  /** POST /scheduler/schedule/organic — Schedule organic post to target local timezone slot */
  @Post('schedule/organic')
  async scheduleOrganicPost(@Body() body: {
    businessId: string;
    caption: string;
    imageUrl?: string;
    headline?: string;
    hashtags?: string[];
    timezone?: string;
    platforms?: string;
  }) {
    return this.schedulerService.scheduleOrganicPost(body);
  }

  /** POST /scheduler/schedule/organic-batch — Schedule a batch of organic posts */
  @Post('schedule/organic-batch')
  async scheduleOrganicBatch(@Body() body: {
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
    if (!body?.businessId || !body?.caption) {
      return { success: false, message: 'businessId and caption are required' };
    }
    return this.schedulerService.scheduleOrganicBatch(body);
  }

  @Post('instant-week')
  async scheduleInstantWeek(@Body() body: {
    businessId: string;
    count?: number;
    daysMode?: string;
    publishTime?: string;
    platforms?: string;
    timezone?: string;
  }) {
    if (!body?.businessId) return { success: false, message: 'businessId is required' };
    return this.schedulerService.scheduleInstantWeek(body);
  }

  /** GET /scheduler/calendar?businessId=xxx — Calendar view of all posts grouped by date */
  @Get('calendar')
  async getCalendarView(@Query('businessId') businessId: string) {
    if (!businessId) {
      return { success: false, message: 'businessId query parameter is required' };
    }
    return this.schedulerService.getCalendarView(businessId);
  }

  /** POST /scheduler/worker/publish-organic — Worker endpoint */
  @Post('worker/publish-organic')
  async publishOrganicWorker(@Body() body: { postId: string }) {
    if (!body?.postId) {
      return { success: false, message: 'postId is required in worker payload' };
    }
    return this.schedulerService.executeOrganicPublishWorker(body.postId);
  }

  /** GET /scheduler/special-events/upcoming — Returns upcoming annual holidays/events */
  @Get('special-events/upcoming')
  async getUpcomingEvents(@Query('days') days?: string) {
    const daysAhead = parseInt(days || '60', 10);
    return {
      success: true,
      upcoming: this.specialEventsService.getUpcomingEvents(daysAhead),
    };
  }

  /** POST /scheduler/special-events/generate — Generates AI event campaign */
  @Post('special-events/generate')
  async generateEventCampaign(@Body() body: { businessId: string; eventName?: string }) {
    if (!body?.businessId) {
      return { success: false, message: 'businessId is required' };
    }
    return this.specialEventsService.generateEventCampaign(body.businessId, body.eventName);
  }
}

/**
 * Controller mapping for /api/schedule/organic
 */
@Controller('api/schedule')
export class ApiScheduleController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('organic')
  async scheduleOrganic(@Body() body: {
    businessId: string;
    caption: string;
    imageUrl?: string;
    headline?: string;
    hashtags?: string[];
    timezone?: string;
    platforms?: string;
  }) {
    return this.schedulerService.scheduleOrganicPost(body);
  }
}

/**
 * Controller mapping for /api/worker/publish-organic
 */
@Controller('api/worker')
export class ApiWorkerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('publish-organic')
  async publishOrganicWorker(@Body() body: { postId: string }) {
    if (!body?.postId) {
      return { success: false, message: 'postId is required in worker payload' };
    }
    return this.schedulerService.executeOrganicPublishWorker(body.postId);
  }
}
