import { Controller, Get, Post, Delete, Body, Query, HttpException, HttpStatus, Res, Header, Logger, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { IntegrationsService } from './integrations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BusinessAccessGuard } from '../auth/business-access.guard';

/**
 * Endpoints Meta itself calls, which therefore cannot carry a user token:
 * the browser OAuth redirect and the lead webhook. They live in their own
 * controller so that the guards on MetaController below apply to everything
 * else by default — a route added there is authenticated unless someone
 * deliberately moves it here.
 */
@Controller('meta')
export class MetaPublicController {
  private readonly logger = new Logger(MetaPublicController.name);

  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('auth-url')
  getAuthUrl(
    @Query('businessId') businessId: string,
    @Query('redirectUri') redirectUri?: string,
  ) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    return { url: this.integrationsService.getMetaAuthUrl(businessId, redirectUri) };
  }

  /**
   * Facebook OAuth callback — called by Facebook via browser redirect.
   * This is a GET endpoint that:
   *   - Receives `code` and `state` from Facebook
   *   - Decodes businessId from state
   *   - Exchanges code for token
   *   - Redirects browser to frontend with result
   */
  @Get('callback')
  async handleOAuthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_code') errorCode: string,
    @Query('error_message') errorMessage: string,
    @Query('error_reason') errorReason: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

    // Facebook does not always send `error`. A rejected permission request
    // arrives as error_code + error_message (e.g. "Invalid Scopes: ...") with
    // no `error` at all, which previously fell through to the generic
    // "missing_params" branch and hid the actual reason.
    const failure = [errorMessage, errorDescription, errorReason, error]
      .map((v) => (v || '').trim())
      .find(Boolean);

    if (failure || errorCode) {
      const detail = failure || `Meta returned error code ${errorCode}`;
      this.logger.error(
        `[Meta OAuth callback] code=${errorCode || 'n/a'} reason=${errorReason || 'n/a'} message=${detail}`,
      );
      return res.redirect(`${frontendBase}/connect-meta?error=${encodeURIComponent(detail)}`);
    }

    if (!code || !state) {
      return res.redirect(
        `${frontendBase}/connect-meta?error=${encodeURIComponent(
          'Meta redirected back without an authorization code. Please start the connection again.',
        )}`,
      );
    }

    try {
      // Decode state to get businessId
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      const businessId = stateData.businessId;

      if (!businessId) {
        return res.redirect(`${frontendBase}/connect-meta?error=invalid_state`);
      }

      // Exchange code for token
      const result = await this.integrationsService.connectMeta(code, businessId);

      if (result.success) {
        return res.redirect(`${frontendBase}/connect-meta?meta_connected=true`);
      } else {
        return res.redirect(`${frontendBase}/connect-meta?error=${encodeURIComponent(result.message || 'Connection failed')}`);
      }
    } catch (err: any) {
      return res.redirect(`${frontendBase}/connect-meta?error=${encodeURIComponent(err.message || 'OAuth exchange failed')}`);
    }
  }

  // ─── Webhooks (called by Meta's servers, no user token) ──────────────────────

  @Get('webhooks/leads')
  @Header('Content-Type', 'text/plain')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!VERIFY_TOKEN) {
      // No hardcoded fallback: an attacker who read the repo could otherwise
      // register themselves as this app's webhook and inject fabricated leads.
      this.logger.error('META_WEBHOOK_VERIFY_TOKEN is not set — refusing webhook verification.');
      throw new HttpException('Webhook not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return challenge;
    }
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }

  @Post('webhooks/leads')
  async handleWebhook(@Body() body: any) {
    // Every delivery is logged. Without this the endpoint was completely
    // silent, so there was no way to tell a webhook Meta never sent from one
    // that arrived and was dropped — which is exactly the question you need
    // answered when leads are not showing up.
    const fields = (body?.entry || [])
      .flatMap((e: any) => (e?.changes || []).map((c: any) => c?.field))
      .filter(Boolean);
    this.logger.log(
      `[Meta webhook] Received object=${body?.object} entries=${(body?.entry || []).length} fields=[${fields.join(', ')}]`,
    );

    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        await this.integrationsService.processLeadWebhook(entry);
      }
      return 'EVENT_RECEIVED';
    }

    this.logger.warn(`[Meta webhook] Ignoring delivery for object="${body?.object}" (expected "page")`);
    throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
  }
}

/**
 * Everything a signed-in user does with their own Meta connection.
 *
 * JwtAuthGuard proves who the caller is; BusinessAccessGuard proves the
 * businessId in the query or body actually belongs to them. Without the
 * second guard, any authenticated user could pass another business's id and
 * read their leads or spend their ad budget.
 */
@UseGuards(JwtAuthGuard, BusinessAccessGuard)
@Controller('meta')
export class MetaController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  /**
   * SPA callback handler — called by the frontend React app when it receives the OAuth code.
   */
  @Post('callback')
  async handleCallbackPost(
    @Body() body: { code: string; businessId: string; redirectUri?: string },
  ) {
    if (!body.code || !body.businessId) {
      throw new HttpException('Missing code or businessId', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.integrationsService.connectMeta(body.code, body.businessId, body.redirectUri);
      return result;
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Failed to connect Meta', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('status')
  async getStatus(@Query('businessId') businessId: string) {
    if (!businessId) {
       throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.getMetaStatus(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('channels')
  async getChannels(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaChannels(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Failed to fetch channels', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('pages')
  async getPages(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaPages(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('ad-accounts')
  async getAdAccounts(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaAdAccounts(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('instagram-accounts')
  async getInstagramAccounts(@Query('businessId') businessId: string, @Query('pageId') pageId: string) {
    if (!businessId || !pageId) throw new HttpException('Missing businessId or pageId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaInstagramAccounts(businessId, pageId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('select-accounts')
  async selectAccounts(@Body() body: {
    businessId: string;
    adAccountId: string;
    adAccountName: string;
    pageId: string;
    pageName: string;
    instagramAccountId?: string;
    instagramAccountName?: string;
  }) {
    if (!body.businessId || !body.adAccountId || !body.pageId) {
      throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.selectMetaAccounts(body.businessId, body);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * POST /meta/subscribe-leads — (re)subscribes the connected Page to leadgen
   * webhooks. Connecting Meta does this automatically; this endpoint exists so
   * a business already connected before the subscription was added — or one
   * whose subscription failed — can be fixed without disconnecting first.
   */
  @Post('subscribe-leads')
  async subscribeLeads(@Body() body: { businessId: string; pageId?: string }) {
    if (!body?.businessId) {
      throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    }
    const business = await this.integrationsService.getBusinessForLeadSubscription(body.businessId);
    const pageId = body.pageId || business?.selectedPageId || business?.metaPageId;
    if (!pageId) {
      throw new HttpException(
        'No Facebook Page is connected for this business. Connect Meta and select a Page first.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.integrationsService.subscribePageToLeadgen(body.businessId, pageId);
    if (!result.subscribed) {
      throw new HttpException(
        result.error || 'Could not subscribe this Page to lead notifications.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return { success: true, pageId, message: 'This Page will now deliver new leads to your CRM.' };
  }

  @Post('disconnect')
  async disconnect(@Body('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.disconnectMeta(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── Business Managers ────────────────────────────────────────────────────────

  @Get('business-managers')
  async getBusinessManagers(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaBusinessManagers(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── Lead Ads ─────────────────────────────────────────────────────────────────

  @Post('leads/forms')
  async createLeadForm(
    @Body() body: { businessId: string; formName: string; questions: any[] },
  ) {
    if (!body.businessId || !body.formName || !body.questions) {
      throw new HttpException('Missing required fields', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.createLeadForm(body.businessId, body.formName, body.questions);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('leads/forms')
  async listLeadForms(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.listLeadForms(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('leads')
  async getLeads(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaLeads(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── Analytics / Insights ─────────────────────────────────────────────────────

  @Get('analytics')
  async getAnalytics(
    @Query('businessId') businessId: string,
    @Query('campaignId') campaignId?: string,
    @Query('datePreset') datePreset?: string,
  ) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaAnalytics(businessId, campaignId, datePreset);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Phase 10: Detailed analytics with demographics */
  @Get('analytics/detailed')
  async getDetailedAnalytics(
    @Query('businessId') businessId: string,
    @Query('datePreset') datePreset?: string,
  ) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getDetailedAnalytics(businessId, datePreset);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('campaigns')
  async getCampaigns(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaCampaigns(businessId);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('launch-campaign')
  async launchCampaign(@Body() body: { businessId: string; [key: string]: any }) {
    if (!body.businessId) {
      throw new HttpException('Missing businessId in request payload', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.launchMetaAdCampaign(body.businessId, body);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Failed to launch Meta campaign', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

/**
 * Controller mapping for /api/meta
 */
@UseGuards(JwtAuthGuard, BusinessAccessGuard)
@Controller('api/meta')
export class ApiMetaController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post('launch-campaign')
  async launchCampaign(@Body() body: { businessId: string; [key: string]: any }) {
    if (!body.businessId) {
      throw new HttpException('Missing businessId in request payload', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.launchMetaAdCampaign(body.businessId, body);
    } catch (error: any) {
      // Preserve the specific status and message the service already chose
      // (e.g. the real Meta rejection reason) instead of flattening to a 500.
      if (error instanceof HttpException) throw error;
      throw new HttpException(error?.message || 'Failed to launch Meta campaign', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}