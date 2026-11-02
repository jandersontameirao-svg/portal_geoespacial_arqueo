import {
  COOKIE_NAME,
  encodeOAuthState,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  ONE_YEAR_MS,
} from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS };

/**
 * Starts Manus OAuth only at an explicit navigation event. The host-only cookie
 * binds the state nonce to the browser that initiated the login.
 */
export const startLogin = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const nonce = crypto.randomUUID();

  document.cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(nonce)}; Path=/; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}; SameSite=None; Secure`;

  const state = encodeOAuthState({ redirectUri, nonce });
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.assign(url.toString());
};
