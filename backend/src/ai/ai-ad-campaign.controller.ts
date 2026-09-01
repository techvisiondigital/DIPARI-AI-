import { Controller, Post, Body, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BusinessAccessGuard } from '../auth/business-access.guard';
import { AiAdCampaignService, GenerateAdCampaignDto, GenerateContentDto } from './ai-ad-campaign.service';

@UseGuards(JwtAuthGuard, BusinessAccessGuard)
@Controller('api/ai')
export class ApiAiAdCampaignController {
  constructor(private readonly aiAdCampaignService: AiAdCampaignService) {}

  @Post('generate-ad-campaign')
  async generateAdCampaign(@Body() body: GenerateAdCampaignDto) {
    try {
      return await this.aiAdCampaignService.generateAdCampaign(body);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to generate ad campaign strategy',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate-content')
  async generateContent(@Body() body: GenerateContentDto) {
    try {
      const result = await this.aiAdCampaignService.generateContent({
        niche: body.niche || 'General Niche',
        targetAudience: body.targetAudience || 'General Audience',
        brandTone: body.brandTone || 'Professional & Engaging',
        currentOffer: body.currentOffer || 'Special Promotion',
        workspaceId: body.workspaceId,
        businessId: body.businessId,
      });
      return { success: true, data: result };
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to generate content', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

@UseGuards(JwtAuthGuard, BusinessAccessGuard)
@Controller('ai')
export class AiAdCampaignController {
  constructor(private readonly aiAdCampaignService: AiAdCampaignService) {}

  @Post('generate-ad-campaign')
  async generateAdCampaign(@Body() body: GenerateAdCampaignDto) {
    try {
      return await this.aiAdCampaignService.generateAdCampaign(body);
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to generate ad campaign strategy',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('generate-content')
  async generateContent(@Body() body: GenerateContentDto) {
    try {
      const result = await this.aiAdCampaignService.generateContent({
        niche: body.niche || 'General Niche',
        targetAudience: body.targetAudience || 'General Audience',
        brandTone: body.brandTone || 'Professional & Engaging',
        currentOffer: body.currentOffer || 'Special Promotion',
        workspaceId: body.workspaceId,
        businessId: body.businessId,
      });
      return { success: true, data: result };
    } catch (error: any) {
      throw new HttpException(error.message || 'Failed to generate content', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
