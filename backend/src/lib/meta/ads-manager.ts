import axios from 'axios';
import { GRAPH_API_BASE } from './graph-version';

export interface MetaCampaignLaunchInput {
  adAccountId: string;
  pageId: string;
  accessToken: string;
  campaignName: string;
  objective?: string; // 'OUTCOME_SALES' | 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC' | etc.
  dailyBudget: number; // e.g. 500 (will be converted to cents: 50000)
  targeting: {
    locations?: string[];
    ageMin?: number;
    ageMax?: number;
    gender?: string;
    interests?: string[];
    flexibleSpecInterests?: string[];
    countries?: string[];
  };
  primaryText: string;
  headline: string;
  description?: string;
  ctaType?: string; // 'LEARN_MORE' | 'SHOP_NOW' | 'SIGN_UP' | etc.
  imageUrl?: string;
  status?: 'PAUSED' | 'ACTIVE';
  isMock?: boolean;
  /**
   * Instant Form to open when someone taps the ad. REQUIRED for a lead
   * campaign: without it Meta serves an ordinary link ad, the person never
   * sees a form, and no lead is ever generated.
   */
  leadGenFormId?: string;
  /** Instagram Business account, so the ad is eligible for Instagram placements. */
  instagramActorId?: string;
  /** Where the ad may appear. Defaults to Facebook + Instagram. */
  publisherPlatforms?: string[];
}

export interface MetaCampaignLaunchResult {
  success: boolean;
  metaCampaignId: string;
  metaAdSetId: string;
  metaCreativeId: string;
  metaAdId: string;
  imageHash?: string;
  leadGenFormId?: string;
  status: string;
  error?: string;
}

/**
 * Normalizes an Ad Account ID to ensure it is prefixed with 'act_'.
 */
export function formatAdAccountId(adAccountId: string): string {
  const clean = (adAccountId || '').trim();
  if (!clean) {
    // Returned 'act_mock_account' here, so a missing ad account produced a
    // campaign request aimed at a nonexistent account and a confusing Meta
    // error much further downstream.
    throw new Error(
      'No Meta ad account is selected for this workspace. Connect Meta and choose an ad account first.',
    );
  }
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

/**
 * Maps campaign objective string to official Meta Graph API objectives.
 */
export function mapMetaObjective(objective?: string): string {
  const obj = (objective || '').toUpperCase();
  if (obj.includes('SALE') || obj.includes('CONVERSION')) return 'OUTCOME_SALES';
  if (obj.includes('LEAD')) return 'OUTCOME_LEADS';
  if (obj.includes('TRAFFIC') || obj.includes('LINK')) return 'OUTCOME_TRAFFIC';
  if (obj.includes('ENGAGEMENT')) return 'OUTCOME_ENGAGEMENT';
  if (obj.includes('AWARENESS') || obj.includes('REACH')) return 'OUTCOME_AWARENESS';
  return 'OUTCOME_SALES';
}

/**
 * Uploads an ad image to Meta Ad Account images endpoint to get image_hash.
 * POST https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/adimages
 */
export async function uploadAdImageToMeta(
  adAccountId: string,
  accessToken: string,
  imageUrl: string,
  isMock?: boolean,
): Promise<string> {
  const formattedAdAcc = formatAdAccountId(adAccountId);

  if (isMock || !accessToken || accessToken.startsWith('mock_') || !imageUrl) {
    return 'mock_image_hash_9f8e7d6c5b4a';
  }

  try {
    // Download image buffer from image URL (e.g., Firebase Storage)
    const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(imageRes.data);
    const base64Image = imageBuffer.toString('base64');

    const response = await axios.post(
      `${GRAPH_API_BASE}/${formattedAdAcc}/adimages`,
      {
        bytes: base64Image,
      },
      {
        params: { access_token: accessToken },
      },
    );

    const imagesData = response.data?.images || {};
    const firstKey = Object.keys(imagesData)[0];
    const imageHash = imagesData[firstKey]?.hash || response.data?.hash;

    if (!imageHash) {
      throw new Error('Meta /adimages response did not contain an image_hash');
    }

    return imageHash;
  } catch (err: any) {
    // Previously invented 'mock_image_hash_fallback_<ts>' so the launch could
    // continue. Meta always rejects a hash it never issued, so the ad creative
    // failed anyway — but by then a real Campaign and Ad Set had been created
    // on the customer's live ad account with nothing to clean them up.
    // Fail here, before anything is created.
    throw new Error(`Could not upload the ad image to Meta: ${describeMetaError(err)}`);
  }
}

/**
 * Meta rejects an ad set whose `flexible_spec.interests[].id` is not a real
 * targeting ID.  Interest *names* (typed by a user, or produced by the AI
 * strategist) must first be resolved through the Targeting Search API — this
 * code previously synthesised IDs like `interest_0_Fashion`, which Meta always
 * rejects with "Invalid parameter".  Anything that cannot be resolved is
 * dropped rather than sent as a fabricated ID.
 */
export async function resolveAdInterestIds(
  interestNames: string[],
  accessToken: string,
): Promise<{ id: string; name: string }[]> {
  const resolved: { id: string; name: string }[] = [];

  for (const rawName of interestNames) {
    const name = String(rawName || '').trim();
    if (!name) continue;

    try {
      const res = await axios.get(`${GRAPH_API_BASE}/search`, {
        params: { type: 'adinterest', q: name, limit: 1, access_token: accessToken },
        timeout: 15_000,
      });
      const match = res.data?.data?.[0];
      if (match?.id) {
        resolved.push({ id: String(match.id), name: match.name || name });
      }
    } catch {
      // One unresolvable interest must not abort the whole campaign launch.
    }
  }

  return resolved;
}

/**
 * Surfaces the real Graph API error text. Without this, an axios failure
 * reports only "Request failed with status code 400", which tells the user
 * nothing about what Meta actually rejected.
 */
export function describeMetaError(err: any): string {
  const apiError = err?.response?.data?.error;
  if (apiError) {
    const detail = [apiError.error_user_msg, apiError.message]
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .join(' — ');
    if (detail) {
      return apiError.code ? `${detail} (Meta error code ${apiError.code})` : detail;
    }
  }
  return err?.message || 'Unknown Meta API error';
}

/**
 * Executes full 4-Step Meta Campaign Hierarchy Creation:
 * Step 0 (Image upload) -> Step A (Campaign) -> Step B (Ad Set)
 * -> Step C (Ad Creative) -> Step D (Ad)
 */
export async function launchFullMetaCampaignHierarchy(
  input: MetaCampaignLaunchInput,
): Promise<MetaCampaignLaunchResult> {
  const {
    adAccountId,
    pageId,
    accessToken,
    campaignName,
    objective,
    dailyBudget,
    targeting,
    primaryText,
    headline,
    description,
    ctaType,
    imageUrl,
    status = 'PAUSED',
    isMock = false,
    leadGenFormId,
    instagramActorId,
    publisherPlatforms,
  } = input;

  const formattedAdAccountId = formatAdAccountId(adAccountId);

  if (isMock || !accessToken || accessToken.startsWith('mock_')) {
    const timestamp = Date.now();
    return {
      success: true,
      metaCampaignId: `cmp_${timestamp}`,
      metaAdSetId: `as_${timestamp}`,
      metaCreativeId: `cr_${timestamp}`,
      metaAdId: `ad_${timestamp}`,
      imageHash: 'mock_image_hash_9f8e7d6c5b4a',
      status,
    };
  }

  const metaObjective = mapMetaObjective(objective);

  // Step 0: Upload the creative image FIRST.
  // This used to run as part of Step C, after the Campaign and Ad Set were
  // already live on the customer's ad account. A failed upload then aborted
  // the launch and left both objects stranded with nothing to clean them up.
  // Uploading first means a failure costs nothing.
  // Empty when there is no creative image. It used to default to a literal
  // 'mock_image_hash_...', which was then sent to Meta as a real image_hash
  // and rejected — after the Campaign and Ad Set had already been created.
  let imageHash = '';
  if (imageUrl) {
    imageHash = await uploadAdImageToMeta(adAccountId, accessToken, imageUrl, isMock);
  }

  // Step A: Create Campaign
  // POST https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/campaigns
  const campaignRes = await axios.post(
    `${GRAPH_API_BASE}/${formattedAdAccountId}/campaigns`,
    {
      name: campaignName,
      objective: metaObjective,
      status,
      special_ad_categories: [],
    },
    { params: { access_token: accessToken } },
  );
  const metaCampaignId = campaignRes.data.id;

  // Step B: Create Ad Set (15-Day Schedule)
  // POST https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/adsets
  const budgetInCents = Math.round((dailyBudget || 100) * 100);
  const now = new Date();
  const fifteenDaysLater = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);

  const interestList = targeting.interests || targeting.flexibleSpecInterests || [];
  const genderVal = (targeting.gender || '').toUpperCase();
  const genders = genderVal === 'MEN' || genderVal === 'MALE' ? [1] : genderVal === 'WOMEN' || genderVal === 'FEMALE' ? [2] : undefined;

  const targetingSpecObj: any = {
    age_min: targeting.ageMin || 18,
    age_max: targeting.ageMax || 65,
    geo_locations: {
      countries: targeting.countries || ['US'],
    },
  };

  if (genders) {
    targetingSpecObj.genders = genders;
  }

  // Run on Facebook and Instagram unless the caller narrows it. Leaving this
  // unset lets Meta pick placements on its own, which is why campaigns did not
  // reliably appear on Instagram.
  targetingSpecObj.publisher_platforms = publisherPlatforms?.length
    ? publisherPlatforms
    : ['facebook', 'instagram'];

  if (interestList.length > 0) {
    // Resolve names to genuine Meta targeting IDs — fabricated IDs are rejected.
    const resolvedInterests = await resolveAdInterestIds(interestList, accessToken);
    if (resolvedInterests.length > 0) {
      targetingSpecObj.flexible_spec = [{ interests: resolvedInterests }];
    }
  }

  const adSetPayload: any = {
    name: `${campaignName} - Ad Set`,
    campaign_id: metaCampaignId,
    daily_budget: budgetInCents,
    billing_event: 'IMPRESSIONS',
    optimization_goal: metaObjective === 'OUTCOME_LEADS' ? 'LEAD_GENERATION' : 'OFFSITE_CONVERSIONS',
    start_time: now.toISOString(),
    end_time: fifteenDaysLater.toISOString(),
    status,
    targeting: targetingSpecObj,
  };

  if (metaObjective === 'OUTCOME_LEADS') {
    adSetPayload.promoted_object = { page_id: pageId };
    // Tells Meta the form opens inside the ad rather than sending traffic away.
    adSetPayload.destination_type = 'ON_AD';
  }

  const adSetRes = await axios.post(
    `${GRAPH_API_BASE}/${formattedAdAccountId}/adsets`,
    adSetPayload,
    { params: { access_token: accessToken } },
  );
  const metaAdSetId = adSetRes.data.id;

  // Step C: Create Ad Creative (image already uploaded in Step 0)
  // POST https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/adcreatives
  const isLeadCampaign = metaObjective === 'OUTCOME_LEADS';

  if (isLeadCampaign && !leadGenFormId) {
    // Without a form this silently becomes a plain link ad: the campaign
    // spends budget, nobody is ever shown a form, and no lead is created.
    // Better to stop here than to hand the customer a lead campaign that
    // cannot produce leads.
    throw new Error(
      'A lead generation campaign needs an Instant Form. None could be created or found for this Page.',
    );
  }

  const callToAction: any = {
    type: isLeadCampaign ? ctaType || 'SIGN_UP' : ctaType || 'LEARN_MORE',
  };
  if (isLeadCampaign) {
    // This is what makes the form open when someone taps the ad.
    callToAction.value = { lead_gen_form_id: leadGenFormId };
  }

  const creativePayload: any = {
    name: `${campaignName} - Creative`,
    object_story_spec: {
      page_id: pageId,
      // Required for the ad to be eligible for Instagram placements.
      ...(instagramActorId ? { instagram_actor_id: instagramActorId } : {}),
      link_data: {
        // A lead ad's link is a formality — the form opens in place — but Meta
        // still requires the field.
        link: isLeadCampaign ? 'http://fb.me/' : 'https://www.facebook.com',
        message: primaryText,
        name: headline,
        description: description || '',
        // Meta rejects an empty image_hash, so omit the field entirely when
        // there is no creative image rather than sending a blank value.
        ...(imageHash ? { image_hash: imageHash } : {}),
        call_to_action: callToAction,
      },
    },
  };

  const creativeRes = await axios.post(
    `${GRAPH_API_BASE}/${formattedAdAccountId}/adcreatives`,
    creativePayload,
    { params: { access_token: accessToken } },
  );
  const metaCreativeId = creativeRes.data.id;

  // Step D: Create Ad
  // POST https://graph.facebook.com/<version>/act_<AD_ACCOUNT_ID>/ads
  const adRes = await axios.post(
    `${GRAPH_API_BASE}/${formattedAdAccountId}/ads`,
    {
      name: `${campaignName} - Ad`,
      adset_id: metaAdSetId,
      creative: { creative_id: metaCreativeId },
      status,
    },
    { params: { access_token: accessToken } },
  );
  const metaAdId = adRes.data.id;

  return {
    success: true,
    metaCampaignId,
    metaAdSetId,
    metaCreativeId,
    metaAdId,
    imageHash,
    leadGenFormId,
    status,
  };
}
