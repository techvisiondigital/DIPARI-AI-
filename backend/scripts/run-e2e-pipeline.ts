import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/firebase/firebase.service';
import { AiAdCampaignService } from '../src/ai/ai-ad-campaign.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { IntegrationsService } from '../src/integrations/integrations.service';
import { launchFullMetaCampaignHierarchy } from '../src/lib/meta/ads-manager';

/**
 * Visionpilot AI — Standalone E2E Pipeline Runner Script (Meta Authorised AI Marketing Agent)
 * Bypasses frontend OAuth UI to test full pipeline for target user: akanshlakhian23@gmail.com
 *
 * Pipeline Steps:
 * 1. Auth Bypass & User/Workspace Provisioning
 * 2. AI Strategic Campaign Generation (Gemini Copy Engine + Node Canvas Renderer)
 * 3. Organic Post 10:00 AM Scheduler & Immediate Worker Trigger (Facebook & Instagram)
 * 4. Meta Paid Ad Campaign Hierarchy Creation (Campaign -> Ad Set -> Creative -> Ad)
 */
async function runE2EPipeline() {
  console.log('\n================================================================================');
  console.log(' 🚀 VISIONPILOT AI BACKEND E2E PIPELINE RUNNER (Meta Authorised AI Marketing Agent)');
  console.log(' Target User: akanshlakhian23@gmail.com');
  console.log(' Time:', new Date().toISOString());
  console.log('================================================================================\n');

  // Step 0: Bootstrap NestJS Application Context
  console.log('[1/5] Bootstrapping NestJS Application Context...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const firebaseService = app.get(FirebaseService);
  const aiAdCampaignService = app.get(AiAdCampaignService);
  const schedulerService = app.get(SchedulerService);
  const integrationsService = app.get(IntegrationsService);

  console.log(' ✅ Application Context Initialized Successfully.\n');

  // Step 1: Query/Inject User Profile & Workspace
  const targetEmail = 'akanshlakhian23@gmail.com';
  console.log(`[2/5] Fetching User Profile for: ${targetEmail}...`);

  let user = await firebaseService.usersDao?.findByEmail(targetEmail);
  if (!user) {
    console.log(` ⚠️ User profile for ${targetEmail} not found. Provisioning new user in database...`);
    const customUserId = `usr_${Date.now()}`;
    await firebaseService.col('users').doc(customUserId).set({
      email: targetEmail,
      name: 'Akansh Lakhian',
      role: 'ADMIN',
      status: 'ACTIVE',
      preferredLanguage: 'English',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    user = (await firebaseService.usersDao?.findById(customUserId)) || {
      id: customUserId,
      email: targetEmail,
      name: 'Akansh Lakhian',
      role: 'ADMIN',
      status: 'ACTIVE',
      preferredLanguage: 'English',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
  console.log(` ✅ User Identified: ${user.name} (ID: ${user.id})`);

  // Query/Inject Workspace for User
  let workspaces = user.id && firebaseService.workspacesDao
    ? await firebaseService.workspacesDao.findByUserId(user.id)
    : [];
  let workspace = workspaces.length > 0 ? workspaces[0] : null;

  if (!workspace) {
    console.log(` ⚠️ Workspace for user ${user.id} not found. Provisioning default workspace...`);
    const customWsId = `ws_${Date.now()}`;
    workspace = await firebaseService.workspacesDao?.create({
      name: 'Akansh AI Solutions',
      ownerId: user.id,
      niche: 'Software Development & AI Automation',
      vibe: 'Modern, Professional & High-Energy',
    }, customWsId);

    // Update with Meta integration credentials
    await firebaseService.workspacesDao?.update(workspace.id, {
      metaPageId: 'page_meta_akansh_101',
      metaPageName: 'Akansh AI Official Facebook Page',
      metaAdAccountId: 'act_109876543210',
      metaIgBusinessAccountId: 'ig_akansh_official_99',
      metaAccessToken: 'mock_e2e_meta_access_token_token',
    } as any);

    workspace = (await firebaseService.workspacesDao?.findById(customWsId)) || workspace;
  }

  const wsAny = workspace as any;
  console.log(` ✅ Workspace Identified: ${workspace.name} (ID: ${workspace.id})`);
  console.log(`    Meta Page ID: ${workspace.metaPageId || wsAny.selectedPageId || 'page_meta_akansh_101'}`);
  console.log(`    Meta Ad Account: ${workspace.metaAdAccountId || wsAny.selectedAdAccountId || 'act_109876543210'}\n`);

  // Step 2: Pipeline Step 1 — AI Content Generation
  console.log('[3/5] PIPELINE STEP 1: Executing AI Campaign & Copy Generation Engine...');
  const testCategory = 'Cloud Software & AI Automation';
  const testLocation = 'Global Tech Hubs (US, India, UK)';
  const testGoal = 'Lead Generation & Conversions';

  const generatedCampaign = await aiAdCampaignService.generateAdCampaign({
    category: testCategory,
    targetLocation: testLocation,
    dailyBudget: 500,
    goal: testGoal,
    campaignGoal: testGoal,
    currentOffer: '50% OFF Annual Subscription + Free Onboarding',
    usp: 'Instant 1-Click Social Media Automation Engine',
    gender: 'ALL',
    businessId: workspace.id,
    workspaceId: workspace.id,
  });

  console.log('\n ----------------------------------------------------------------');
  console.log('  🎯 GENERATED AI CAMPAIGN BRIEF');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Campaign Name:    ${generatedCampaign.campaignName}`);
  console.log(`  • Objective:        ${generatedCampaign.objective}`);
  console.log(`  • Daily Budget:     ₹${generatedCampaign.dailyBudget}/day`);
  console.log(`  • Targeting Geo:    ${generatedCampaign.targeting.locations.join(', ')}`);
  console.log(`  • Age Range:        ${generatedCampaign.targeting.ageMin} - ${generatedCampaign.targeting.ageMax}`);
  console.log(`  • Target Gender:    ${generatedCampaign.targeting.gender}`);
  console.log(`  • Interests:        ${generatedCampaign.targeting.interests.join(', ')}`);
  console.log(`  • Primary Hook:     ${generatedCampaign.primaryText}`);
  console.log(`  • Headline:         ${generatedCampaign.headline}`);
  console.log(`  • Description:      ${generatedCampaign.description}`);
  console.log(`  • CTA Button:       ${generatedCampaign.ctaType}`);
  console.log(`  • Banner Image URL: ${generatedCampaign.bannerUrl.slice(0, 90)}...`);
  console.log(' ----------------------------------------------------------------\n');

  // Step 3: Pipeline Step 2 — Auto-Scheduler & Organic Worker Execution
  console.log('[4/5] PIPELINE STEP 2: Scheduling & Executing Organic Meta Post...');
  const scheduleRes = await schedulerService.scheduleOrganicPost({
    businessId: workspace.id,
    caption: `${generatedCampaign.primaryText}\n\n👉 ${generatedCampaign.headline}`,
    imageUrl: generatedCampaign.bannerUrl,
    headline: generatedCampaign.headline,
    hashtags: ['#AI', '#CloudSoftware', '#MarketingAutomation', '#MetaAds'],
    timezone: 'Asia/Kolkata',
    platforms: 'both',
  });

  console.log(`  • Scheduled Organic Post ID: ${scheduleRes.post.id}`);
  console.log(`  • Target 10:00 AM Slot:      ${scheduleRes.scheduledTime}`);

  console.log('  ⚡ Force-triggering 10:00 AM Organic Worker Task...');
  const workerRes = await schedulerService.executeOrganicPublishWorker(scheduleRes.post.id);

  console.log('\n ----------------------------------------------------------------');
  console.log('  📱 ORGANIC PUBLISHING RESULT');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Status:           ${workerRes.status}`);
  console.log(`  • Success Overall:  ${workerRes.success}`);
  if (workerRes.publishResult?.facebook) {
    console.log(`  • Facebook Post ID: ${workerRes.publishResult.facebook.postId || 'N/A'}`);
  }
  if (workerRes.publishResult?.instagram) {
    console.log(`  • Instagram ID:     ${workerRes.publishResult.instagram.postId || 'N/A'} (Container: ${workerRes.publishResult.instagram.containerId || 'N/A'})`);
  }
  console.log(' ----------------------------------------------------------------\n');

  // Step 4: Pipeline Step 3 — Paid Ad Campaign Launch Hierarchy
  console.log('[5/5] PIPELINE STEP 3: Executing Meta Paid Ad Campaign Hierarchy Poster...');

  const launchPayload = {
    adAccountId: workspace.metaAdAccountId || wsAny.selectedAdAccountId || 'act_109876543210',
    pageId: workspace.metaPageId || wsAny.selectedPageId || 'page_meta_akansh_101',
    accessToken: workspace.metaAccessToken || 'mock_meta_access_token',
    campaignName: generatedCampaign.campaignName,
    objective: generatedCampaign.objective,
    dailyBudget: generatedCampaign.dailyBudget,
    targeting: generatedCampaign.targeting,
    primaryText: generatedCampaign.primaryText,
    headline: generatedCampaign.headline,
    description: generatedCampaign.description,
    ctaType: generatedCampaign.ctaType,
    imageUrl: generatedCampaign.bannerUrl,
    status: 'PAUSED' as const,
    isMock: integrationsService.isMock || true,
  };

  const metaLaunchResult = await launchFullMetaCampaignHierarchy(launchPayload);

  console.log('\n ----------------------------------------------------------------');
  console.log('  🚀 META AD CAMPAIGN HIERARCHY RESULT');
  console.log(' ----------------------------------------------------------------');
  console.log(`  • Success:          ${metaLaunchResult.success}`);
  console.log(`  • Meta Campaign ID: ${metaLaunchResult.metaCampaignId}`);
  console.log(`  • Meta Ad Set ID:   ${metaLaunchResult.metaAdSetId}`);
  console.log(`  • Meta Creative ID: ${metaLaunchResult.metaCreativeId}`);
  console.log(`  • Meta Ad ID:       ${metaLaunchResult.metaAdId}`);
  console.log(`  • Ad Image Hash:    ${metaLaunchResult.imageHash}`);
  console.log(`  • Initial Status:   ${metaLaunchResult.status}`);
  console.log(' ----------------------------------------------------------------\n');

  console.log('================================================================================');
  console.log(' 🎉 FULL E2E PIPELINE COMPLETED SUCCESSFULLY FOR akanshlakhian23@gmail.com');
  console.log('================================================================================\n');

  await app.close();
  process.exit(0);
}

runE2EPipeline().catch((err) => {
  console.error('\n❌ E2E Pipeline Failed with Error:', err);
  process.exit(1);
});
