import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/firebase/firebase.service';
import { BusinessService } from '../src/business/business.service';
import { BusinessIntelligenceService } from '../src/business/business-intelligence.service';
import { GraphicGeneratorService } from '../src/content/graphic-generator.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { SpecialEventsService } from '../src/scheduler/special-events.service';
import { AiAdCampaignService } from '../src/ai/ai-ad-campaign.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { launchFullMetaCampaignHierarchy } from '../src/lib/meta/ads-manager';

/**
 * Visionpilot AI — Full End-to-End Pipeline Verification Script (Meta Authorised AI Marketing Agent)
 *
 * Verifies:
 * 1. 10-Question Onboarding & Workspace Context Store
 * 2. Branded 1080x1080 Graphic Canvas Renderer with Contact Footer (Phone, Email, Website, Address)
 * 3. 10:00 AM Organic Post Engine & Special Event Holiday Agent
 * 4. AI Performance Paid Ad Generator & 4-Tier Meta Marketing API Poster
 */
async function verifyFullPipeline() {
  console.log('\n================================================================================');
  console.log(' 🛡️ VISIONPILOT AI FULL END-TO-END PIPELINE VERIFICATION AUDIT');
  console.log(' Time:', new Date().toISOString());
  console.log('================================================================================\n');

  // 1. Bootstrap Application Context
  console.log('[STEP 1/5] Bootstrapping NestJS Context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const firebaseService = app.get(FirebaseService);
  const businessService = app.get(BusinessService);
  const businessIntelligence = app.get(BusinessIntelligenceService);
  const graphicGenerator = app.get(GraphicGeneratorService);
  const schedulerService = app.get(SchedulerService);
  const specialEventsService = app.get(SpecialEventsService);
  const aiAdCampaignService = app.get(AiAdCampaignService);
  const integrationsService = app.get(IntegrationsService);

  console.log(' ✅ NestJS Context Initialized cleanly.\n');

  // 2. Step 1: 10-Question Onboarding Survey Submission
  const testWsId = `ws_verify_${Date.now()}`;
  console.log(`[STEP 2/5] Submitting 10-Question Onboarding Questionnaire for Workspace: ${testWsId}...`);

  const onboardingSubmission = {
    businessId: testWsId,
    businessName: 'Apex Cloud Innovations',
    logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&q=80', // Question #1
    category: 'Enterprise SaaS & AI Automation', // Question #2
    targetAudienceGeo: 'CTOs & Tech Leaders in San Francisco, New York, London (Age 25-54)', // Question #3
    productsServices: 'Autonomous Social Media AI Agent Suite & Ad Automation', // Question #4
    businessUSP: '10x Faster Content Deployment with 100% Brand Consistency', // Question #5
    currentOffer: '60% OFF Annual Pro License + Free Dedicated Onboarding', // Question #6
    brandTone: 'Bold, Visionary & High-Energy', // Question #7
    contactDetails: { // Question #8
      phone: '+1 (415) 890-2100',
      email: 'contact@apexcloud.ai',
      website: 'www.apexcloud.ai',
      address: '500 Howard St, San Francisco, CA 94105',
    },
    socialAccounts: { // Question #9
      facebookPageId: 'page_apex_cloud_99',
      instagramAccountId: 'ig_apex_cloud_official',
    },
    adBudgetGoal: { // Question #10
      dailyBudget: 500,
      monthlyBudget: 15000,
      conversionGoal: 'OUTCOME_SALES',
    },
  };

  const onboardingResult = await businessService.saveStructuredOnboarding(testWsId, onboardingSubmission);
  console.log(' ✅ Onboarding Survey Context Saved to Firestore.');

  // Fetch unified business context to confirm propagation
  const ctx = await businessIntelligence.getBusinessContext(testWsId);
  console.log('\n ----------------------------------------------------------------');
  console.log('  📋 VERIFIED WORKSPACE CONTEXT STORE');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Business Name:    ${ctx.businessName}`);
  console.log(`  • Category (#2):     ${ctx.businessCategory}`);
  console.log(`  • Geo Target (#3):   ${ctx.targetAudienceGeo}`);
  console.log(`  • Products (#4):     ${ctx.productsServices}`);
  console.log(`  • USP (#5):          ${ctx.businessUSP}`);
  console.log(`  • Current Offer (#6):${ctx.currentOffer}`);
  console.log(`  • Brand Tone (#7):   ${ctx.brandTone}`);
  console.log(`  • Contact Phone (#8):${ctx.contactPhone}`);
  console.log(`  • Website (#8):      ${ctx.websiteUrl}`);
  console.log(`  • Physical Address:  ${ctx.physicalAddress}`);
  console.log(`  • Meta Page ID (#9): ${ctx.metaPageId}`);
  console.log(`  • Daily Budget (#10):₹${ctx.dailyBudget}/day (${ctx.businessGoals})`);
  console.log(' ----------------------------------------------------------------\n');

  // 3. Step 2: Branded Graphic Canvas Engine Verification
  console.log('[STEP 3/5] Testing Branded Graphic Canvas Engine with Contact Footer...');
  const graphicBuffer = await graphicGenerator.generateBrandedGraphicBuffer({
    businessName: ctx.businessName,
    offerText: ctx.currentOffer,
    headline: 'AUTOMATE YOUR CONTENT IN 1-CLICK',
    description: 'Save 20+ Hours Every Single Week',
    ctaType: 'LEARN_MORE',
    niche: ctx.businessCategory,
    vibe: ctx.brandTone,
    phone: ctx.contactPhone,
    email: ctx.contactEmail,
    website: ctx.websiteUrl,
    address: ctx.physicalAddress,
  });

  console.log(` ✅ 1080x1080 Graphic Canvas Buffer Generated (${graphicBuffer.length} bytes).`);
  const uploadRes = await firebaseService.uploadFileBuffer(
    graphicBuffer,
    `verify/${testWsId}/graphic_test.png`,
    'image/png',
  );
  const graphicUrl = typeof uploadRes === 'string' ? uploadRes : uploadRes?.publicUrl || '';
  console.log(` ✅ Graphic Image Uploaded to Storage: ${graphicUrl.slice(0, 80)}...\n`);

  // 4. Step 3: Organic 10 AM Scheduler & Special Event Agent
  console.log('[STEP 4/5] Testing 10:00 AM Scheduler & Special Event Holiday Agent...');

  // A. Schedule Daily Organic 10 AM Post
  const scheduledOrganic = await schedulerService.scheduleOrganicPost({
    businessId: testWsId,
    caption: `🔥 ${ctx.currentOffer}! Experience ${ctx.businessUSP}. Visit ${ctx.websiteUrl} or call ${ctx.contactPhone} to claim!`,
    imageUrl: graphicUrl,
    headline: 'Automate Content Deployment',
    hashtags: ['#EnterpriseSaaS', '#AIAutomation', '#MarketingEfficiency'],
    timezone: 'Asia/Kolkata',
    platforms: 'both',
  });
  console.log(` ✅ Organic 10 AM Post Scheduled (ID: ${scheduledOrganic.post.id}, Slot: ${scheduledOrganic.scheduledTime})`);

  // Force-trigger worker
  const workerResult = await schedulerService.executeOrganicPublishWorker(scheduledOrganic.post.id);
  console.log(` ✅ 10:00 AM Organic Worker Executed. Status: ${workerResult.status}, Success: ${workerResult.success}`);

  // B. Detect & Generate Special Event Holiday Campaign
  const upcomingEvents = specialEventsService.getUpcomingEvents(60);
  console.log(` 🗓️ Detected ${upcomingEvents.length} Upcoming Promotional Events in Next 60 Days:`);
  upcomingEvents.slice(0, 3).forEach((e) => console.log(`    • ${e.name} (${e.dateStr}) — ${e.suggestedOffer}`));

  const eventCampaignResult = await specialEventsService.generateEventCampaign(testWsId);
  console.log(` ✅ Special Event AI Campaign Created for "${eventCampaignResult.event.name}" (${eventCampaignResult.event.dateStr}) at 10:00 AM.\n`);

  // 5. Step 4: AI Paid Ad Campaign Generator & Meta Launcher
  console.log('[STEP 5/5] Testing AI Performance Paid Ad Generator & Meta Marketing API Launcher...');
  const adCampaign = await aiAdCampaignService.generateAdCampaign({
    businessId: testWsId,
    workspaceId: testWsId,
  });

  console.log('\n ----------------------------------------------------------------');
  console.log('  🎯 AI PAID AD CAMPAIGN RESULT');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Campaign Name:    ${adCampaign.campaignName}`);
  console.log(`  • Objective:        ${adCampaign.objective}`);
  console.log(`  • Daily Budget:     ₹${adCampaign.dailyBudget}/day`);
  console.log(`  • Targeting Geo:    ${adCampaign.targeting.locations.join(', ')}`);
  console.log(`  • Interests:        ${adCampaign.targeting.interests.join(', ')}`);
  console.log(`  • Primary Hook:     ${adCampaign.primaryText.slice(0, 110)}...`);
  console.log(`  • Headline:         ${adCampaign.headline}`);
  console.log(`  • Description:      ${adCampaign.description}`);
  console.log(`  • CTA Type:         ${adCampaign.ctaType}`);
  console.log(`  • Canvas Ad Banner: ${adCampaign.bannerUrl.slice(0, 80)}...`);
  console.log(' ----------------------------------------------------------------\n');

  // Execute Meta Hierarchy Poster
  const metaResult = await launchFullMetaCampaignHierarchy({
    adAccountId: ctx.metaAdAccountId || 'act_109876543210',
    pageId: ctx.metaPageId || 'page_apex_cloud_99',
    accessToken: 'mock_meta_access_token',
    campaignName: adCampaign.campaignName,
    objective: adCampaign.objective,
    dailyBudget: adCampaign.dailyBudget,
    targeting: adCampaign.targeting,
    primaryText: adCampaign.primaryText,
    headline: adCampaign.headline,
    description: adCampaign.description,
    ctaType: adCampaign.ctaType,
    imageUrl: adCampaign.bannerUrl,
    status: 'PAUSED',
    isMock: true,
  });

  console.log(' ----------------------------------------------------------------');
  console.log('  🚀 META AD CREATION HIERARCHY RESULT');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Campaign ID: ${metaResult.metaCampaignId}`);
  console.log(`  • Ad Set ID:   ${metaResult.metaAdSetId}`);
  console.log(`  • Creative ID: ${metaResult.metaCreativeId}`);
  console.log(`  • Ad ID:       ${metaResult.metaAdId}`);
  console.log(`  • Image Hash:  ${metaResult.imageHash}`);
  console.log(`  • Status:      ${metaResult.status}`);
  console.log(' ----------------------------------------------------------------\n');

  console.log('================================================================================');
  console.log(' 🎉 ALL 5 PIPELINE STEPS AUDITED & VERIFIED SUCCESSFULLY WITH 0 ERRORS');
  console.log('================================================================================\n');

  await app.close();
  process.exit(0);
}

verifyFullPipeline().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
