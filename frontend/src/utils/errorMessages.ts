/**
 * Translates raw error codes from Firebase Auth and the backend into wording a
 * non-technical user can act on.  Without this, users see strings like
 * "Firebase: Error (auth/email-already-in-use)." straight from the SDK.
 */

const FIREBASE_AUTH_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use':
    'An account with this email already exists. Try signing in instead, or use "Forgot password" to recover it.',
  'auth/invalid-email': 'That email address does not look right. Please check it and try again.',
  'auth/user-disabled': 'This account has been disabled. Please contact support for help.',
  'auth/user-not-found': 'No account found with this email. Please check the address or create a new account.',
  'auth/wrong-password': 'Incorrect email or password. Please try again.',
  'auth/invalid-credential': 'Incorrect email or password. Please try again.',
  'auth/invalid-login-credentials': 'Incorrect email or password. Please try again.',
  'auth/weak-password': 'Please choose a stronger password — at least 8 characters with a number and a symbol.',
  'auth/too-many-requests':
    'Too many attempts. Please wait a few minutes before trying again, or reset your password.',
  'auth/network-request-failed': 'Network problem. Please check your internet connection and try again.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled. Please try again when you are ready.',
  'auth/cancelled-popup-request': 'Sign-in was cancelled. Please try again.',
  'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups for this site and try again.',
  'auth/account-exists-with-different-credential':
    'This email is already registered using a different sign-in method. Try signing in with Google.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
  'auth/requires-recent-login': 'For security, please sign in again before making this change.',
  'auth/expired-action-code': 'This link has expired. Please request a new one.',
  'auth/invalid-action-code': 'This link is invalid or has already been used. Please request a new one.',
};

const GENERIC_MESSAGES: Record<string, string> = {
  'Internal server error': 'Something went wrong on our side. Please try again in a moment.',
  'Failed to fetch': 'Could not reach the server. Please check your connection and try again.',
  'Load failed': 'Could not reach the server. Please check your connection and try again.',
};

/** Pulls the `auth/...` code out of whatever shape the error arrives in. */
function extractAuthCode(error: any): string | null {
  if (!error) return null;
  if (typeof error.code === 'string' && error.code.startsWith('auth/')) return error.code;

  const text = typeof error === 'string' ? error : error.message || '';
  const match = text.match(/\(?(auth\/[a-z0-9-]+)\)?/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Returns a friendly, user-facing message for any error.
 * Falls back to the original message when it is already readable, and to a
 * generic line when it is not.
 */
export function friendlyError(error: any, fallback = 'Something went wrong. Please try again.'): string {
  if (!error) return fallback;

  const code = extractAuthCode(error);
  if (code && FIREBASE_AUTH_MESSAGES[code]) return FIREBASE_AUTH_MESSAGES[code];

  const raw = (typeof error === 'string' ? error : error.message || '').trim();
  if (!raw) return fallback;

  if (GENERIC_MESSAGES[raw]) return GENERIC_MESSAGES[raw];

  // Never surface an unmapped SDK code or a raw "Firebase:" prefix to the user.
  if (/^firebase:/i.test(raw) || /auth\/[a-z0-9-]+/i.test(raw)) return fallback;

  return raw;
}
