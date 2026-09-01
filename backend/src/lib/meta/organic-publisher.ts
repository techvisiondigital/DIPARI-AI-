import axios from 'axios';
import { GRAPH_API_BASE } from './graph-version';

export interface OrganicPublisherInput {
  pageId: string;
  pageAccessToken?: string;
  userAccessToken?: string;
  instagramAccountId?: string;
  imageUrl: string;
  caption: string;
  isMock?: boolean;
}

export interface PublishChannelResult {
  success: boolean;
  postId?: string;
  containerId?: string;
  error?: string;
}

export interface SimultaneousPublishResult {
  facebook?: PublishChannelResult;
  instagram?: PublishChannelResult;
  publishedAt: string;
}

/**
 * Publishes a photo post directly to a Facebook Page via Graph API.
 * POST https://graph.facebook.com/<version>/{page-id}/photos
 */
export async function publishToFacebookPage(input: {
  pageId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  isMock?: boolean;
}): Promise<PublishChannelResult> {
  const { pageId, accessToken, imageUrl, caption, isMock } = input;

  if (isMock || !accessToken || accessToken.startsWith('mock_')) {
    return {
      success: true,
      postId: `mock_fb_photo_${Date.now()}`,
    };
  }

  if (!pageId) {
    return { success: false, error: 'Missing Facebook Page ID' };
  }

  try {
    const response = await axios.post(
      `${GRAPH_API_BASE}/${pageId}/photos`,
      null,
      {
        params: {
          url: imageUrl,
          caption: caption,
          access_token: accessToken,
        },
      },
    );

    const postId = response.data?.id || response.data?.post_id;
    return {
      success: true,
      postId,
    };
  } catch (error: any) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    return {
      success: false,
      error: `Facebook Page publish failed: ${errorMsg}`,
    };
  }
}

/**
 * Publishes a photo post to an Instagram Business account via 2-step Graph API.
 * Step 1: POST https://graph.facebook.com/<version>/{ig-user-id}/media (image_url, caption) -> creation_id
 * Step 2: POST https://graph.facebook.com/<version>/{ig-user-id}/media_publish (creation_id) -> post ID
 */
export async function publishToInstagramBusiness(input: {
  instagramAccountId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
  isMock?: boolean;
}): Promise<PublishChannelResult> {
  const { instagramAccountId, accessToken, imageUrl, caption, isMock } = input;

  if (isMock || !accessToken || accessToken.startsWith('mock_')) {
    return {
      success: true,
      containerId: `mock_ig_container_${Date.now()}`,
      postId: `mock_ig_post_${Date.now()}`,
    };
  }

  if (!instagramAccountId) {
    return { success: false, error: 'Missing Instagram Business Account ID' };
  }

  try {
    // Step 1: POST /{ig-user-id}/media
    const containerRes = await axios.post(
      `${GRAPH_API_BASE}/${instagramAccountId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption: caption,
          access_token: accessToken,
        },
      },
    );

    const creationId = containerRes.data?.id;
    if (!creationId) {
      throw new Error('Failed to obtain container creation_id from Instagram Graph API');
    }

    // Step 2: POST /{ig-user-id}/media_publish
    const publishRes = await axios.post(
      `${GRAPH_API_BASE}/${instagramAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId,
          access_token: accessToken,
        },
      },
    );

    const postId = publishRes.data?.id;
    return {
      success: true,
      containerId: creationId,
      postId,
    };
  } catch (error: any) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    return {
      success: false,
      error: `Instagram Business publish failed: ${errorMsg}`,
    };
  }
}

/**
 * Publishes organic content simultaneously to Facebook Page and Instagram Business Account
 * using Promise.all().
 */
export async function publishOrganicSimultaneously(
  input: OrganicPublisherInput,
): Promise<SimultaneousPublishResult> {
  const token = input.pageAccessToken || input.userAccessToken || '';
  const isMock = input.isMock || token.startsWith('mock_');

  const tasks: Promise<[string, PublishChannelResult]>[] = [];

  if (input.pageId) {
    tasks.push(
      publishToFacebookPage({
        pageId: input.pageId,
        accessToken: token,
        imageUrl: input.imageUrl,
        caption: input.caption,
        isMock,
      }).then(res => ['facebook', res] as [string, PublishChannelResult]),
    );
  }

  if (input.instagramAccountId) {
    tasks.push(
      publishToInstagramBusiness({
        instagramAccountId: input.instagramAccountId,
        accessToken: token,
        imageUrl: input.imageUrl,
        caption: input.caption,
        isMock,
      }).then(res => ['instagram', res] as [string, PublishChannelResult]),
    );
  }

  const resultsArray = await Promise.all(tasks);

  const resultMap: Record<string, PublishChannelResult> = {};
  for (const [channel, result] of resultsArray) {
    resultMap[channel] = result;
  }

  return {
    facebook: resultMap.facebook,
    instagram: resultMap.instagram,
    publishedAt: new Date().toISOString(),
  };
}
