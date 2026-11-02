export const COOKIE_NAME = "webdev_app_session";
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

export type OAuthState = {
  redirectUri: string;
  nonce: string;
};

function isValidOAuthState(value: unknown): value is OAuthState {
  if (!value || typeof value !== "object") return false;
  const { redirectUri, nonce } = value as Partial<OAuthState>;
  if (typeof redirectUri !== "string" || typeof nonce !== "string") return false;
  if (!nonce || nonce.length < 16 || nonce.length > 128) return false;

  try {
    const parsed = new URL(redirectUri);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/**
 * Encodes the redirect URI and browser-bound nonce as opaque OAuth state.
 * The callback must compare the nonce to OAUTH_STATE_COOKIE before redeeming
 * an authorization code. Never use decoded state as an unrestricted redirect.
 */
export function encodeOAuthState(state: OAuthState): string {
  if (!isValidOAuthState(state)) {
    throw new Error("Invalid OAuth state payload");
  }
  return btoa(JSON.stringify(state));
}

/**
 * Safely decodes untrusted callback state. Malformed state fails closed.
 */
export function decodeOAuthState(state: string | undefined | null): OAuthState | null {
  if (!state || typeof state !== "string") return null;
  try {
    const decoded = JSON.parse(atob(state)) as unknown;
    return isValidOAuthState(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
