import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { sdk } from "../../server/_core/sdk";

describe("session security claims", () => {
  it("rejects a legacy-shaped session that lacks issuer and audience", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
    const legacyToken = await new SignJWT({
      openId: "synthetic-user",
      appId: process.env.VITE_APP_ID!,
      name: "Synthetic User",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(secret);

    await expect(sdk.verifySession(legacyToken)).resolves.toBeNull();
  });

  it("accepts an app-bound session carrying the required claims", async () => {
    const token = await sdk.createSessionToken("synthetic-user", { name: "Synthetic User" });
    await expect(sdk.verifySession(token)).resolves.toMatchObject({
      openId: "synthetic-user",
      appId: process.env.VITE_APP_ID,
    });
  });
});
