import { timingSafeEqual } from "node:crypto";

const USED_NONCE_TTL_MS = 15 * 60 * 1000;
const MAX_TRACKED_NONCES = 10_000;
const usedNonces = new Map<string, number>();

function cleanup(now: number): void {
  for (const [nonce, expiresAt] of Array.from(usedNonces.entries())) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
  while (usedNonces.size >= MAX_TRACKED_NONCES) {
    const oldest = usedNonces.keys().next().value;
    if (!oldest) break;
    usedNonces.delete(oldest);
  }
}

export function safeNonceEqual(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Atomically marks a browser-bound OAuth nonce as consumed in this runtime.
 * Cookie clearing covers the browser; this bounded registry additionally rejects
 * replayed raw requests while the service process is running.
 */
export function consumeOAuthNonce(nonce: string, now = Date.now()): boolean {
  cleanup(now);
  if (usedNonces.has(nonce)) return false;
  usedNonces.set(nonce, now + USED_NONCE_TTL_MS);
  return true;
}

/** Test-only cleanup; never exposed through an HTTP route. */
export function resetConsumedOAuthNoncesForTest(): void {
  usedNonces.clear();
}
