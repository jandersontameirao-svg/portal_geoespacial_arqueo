import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { encodeOAuthState, OAUTH_STATE_COOKIE } from "../../shared/const";

const db = vi.hoisted(() => ({ upsertUser: vi.fn() }));
const sdk = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  getUserInfo: vi.fn(),
  createSessionToken: vi.fn(),
}));

vi.mock("../../server/db", () => db);
vi.mock("../../server/_core/sdk", () => ({ sdk }));

import { registerOAuthRoutes } from "../../server/_core/oauth";
import { resetConsumedOAuthNoncesForTest } from "../../server/_core/oauthState";

let server: Server;
let baseUrl: string;
const nonce = "nonce-synthetic-8f2186c5-713d-4c77";
const state = encodeOAuthState({
  redirectUri: "https://geoportal.example.test/api/oauth/callback",
  nonce,
});

beforeEach(async () => {
  resetConsumedOAuthNoncesForTest();
  vi.clearAllMocks();
  sdk.exchangeCodeForToken.mockResolvedValue({ accessToken: "synthetic-token" });
  sdk.getUserInfo.mockResolvedValue({ openId: "synthetic-user", name: "Synthetic User", email: "synthetic@example.test" });
  sdk.createSessionToken.mockResolvedValue("synthetic-signed-session");
  const app = express();
  registerOAuthRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("OAuth callback state binding", () => {
  it("rejects a missing or mismatched nonce before code exchange", async () => {
    const response = await fetch(`${baseUrl}/api/oauth/callback?code=synthetic&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=different-browser-nonce-8f2186c5` },
      redirect: "manual",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid oauth state" });
    expect(sdk.exchangeCodeForToken).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(`${OAUTH_STATE_COOKIE}=;`);
  });

  it("redeems a matching state exactly once and clears the nonce cookie", async () => {
    const headers = { cookie: `${OAUTH_STATE_COOKIE}=${nonce}` };
    const first = await fetch(`${baseUrl}/api/oauth/callback?code=synthetic&state=${encodeURIComponent(state)}`, {
      headers,
      redirect: "manual",
    });
    expect(first.status).toBe(302);
    expect(first.headers.get("location")).toBe("/");
    expect(first.headers.get("set-cookie")).toContain(`${OAUTH_STATE_COOKIE}=;`);
    expect(first.headers.get("set-cookie")).toContain("webdev_app_session=synthetic-signed-session");
    expect(sdk.exchangeCodeForToken).toHaveBeenCalledTimes(1);

    const replay = await fetch(`${baseUrl}/api/oauth/callback?code=synthetic&state=${encodeURIComponent(state)}`, {
      headers,
      redirect: "manual",
    });
    expect(replay.status).toBe(403);
    expect(sdk.exchangeCodeForToken).toHaveBeenCalledTimes(1);
  });

  it("fails closed for malformed state before code exchange", async () => {
    const response = await fetch(`${baseUrl}/api/oauth/callback?code=synthetic&state=not-base64-json`, {
      headers: { cookie: `${OAUTH_STATE_COOKIE}=${nonce}` },
      redirect: "manual",
    });
    expect(response.status).toBe(403);
    expect(sdk.exchangeCodeForToken).not.toHaveBeenCalled();
  });
});
