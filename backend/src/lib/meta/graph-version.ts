/**
 * Single source of truth for the Meta Graph API version.
 *
 * Meta expires each Graph API version roughly two years after release, and
 * calls to an expired version stop behaving predictably. This used to be
 * hardcoded as `v19.0` in 55 places, which meant a version bump was a
 * find-and-replace across four files and easy to do incompletely.
 *
 * v19.0 expired 21 May 2026. v20.0 expires 24 September 2026, so it is not a
 * useful target. v23.0 runs to October 2027.
 *
 * Override with META_GRAPH_API_VERSION to roll forward without a code change.
 * Check https://developers.facebook.com/docs/graph-api/changelog/versions
 * before bumping.
 */
export const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';

/** Base URL for Graph API data calls, e.g. `${GRAPH_API_BASE}/me/permissions`. */
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Base URL for the OAuth dialog the browser is redirected to. */
export const FACEBOOK_DIALOG_BASE = `https://www.facebook.com/${GRAPH_API_VERSION}`;
