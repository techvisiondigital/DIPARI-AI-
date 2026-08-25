import { Controller, Get, Post, Delete, Body, Query, HttpException, HttpStatus, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { IntegrationsService } from './integrations.service';

@Controller('meta')
export class MetaController {
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
    @Res() res: Response,
  ) {
    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    if (error) {
      return res.redirect(`${frontendBase}/connect-meta?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontendBase}/connect-meta?error=missing_params`);
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
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('channels')
  async getChannels(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaChannels(businessId);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Failed to fetch channels', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('pages')
  async getPages(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaPages(businessId);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('ad-accounts')
  async getAdAccounts(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaAdAccounts(businessId);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('instagram-accounts')
  async getInstagramAccounts(@Query('businessId') businessId: string, @Query('pageId') pageId: string) {
    if (!businessId || !pageId) throw new HttpException('Missing businessId or pageId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaInstagramAccounts(businessId, pageId);
    } catch (error: any) {
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
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('disconnect')
  async disconnect(@Body('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.disconnectMeta(businessId);
    } catch (error: any) {
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
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('leads/forms')
  async listLeadForms(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.listLeadForms(businessId);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('leads')
  async getLeads(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaLeads(businessId);
    } catch (error: any) {
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
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('campaigns')
  async getCampaigns(@Query('businessId') businessId: string) {
    if (!businessId) throw new HttpException('Missing businessId', HttpStatus.BAD_REQUEST);
    try {
      return await this.integrationsService.getMetaCampaigns(businessId);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Unknown error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────────

  @Get('webhooks/leads')
  @Header('Content-Type', 'text/plain')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'campaignai_webhook_secret';
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return challenge;
    }
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }

  @Post('webhooks/leads')
  async handleWebhook(@Body() body: any) {
    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        await this.integrationsService.processLeadWebhook(entry);
      }
      return 'EVENT_RECEIVED';
    }
    throw new HttpException('Not Found', HttpStatus.NOT_FOUND);
  }

  @Post('launch-campaign')
  async launchCampaign(@Body() body: { businessId: string; [key: string]: any }) {
    if (!body.businessId) {
      throw new HttpException('Missing businessId in request payload', HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.integrationsService.launchMetaAdCampaign(body.businessId, body);
    } catch (error: any) {
      throw new HttpException(error?.message || 'Failed to launch Meta campaign', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

/**
 * Controller mapping for /api/meta
 */
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
      throw new HttpException(error?.message || 'Failed to launch Meta campaign', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}