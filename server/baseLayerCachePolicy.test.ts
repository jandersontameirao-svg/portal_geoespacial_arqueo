import { describe, expect, it } from "vitest";
import { canRefreshBaseLayer, classifyBaseLayerCache, computeRetryAfter } from "./baseLayerCachePolicy";

const now = new Date("2026-10-29T12:00:00.000Z");

describe("política de cache de camadas-base", () => {
  it("classifica cache atual, antigo e refresh em andamento", () => {
    expect(classifyBaseLayerCache({ dataUrl: "https://cached", downloadStatus: "completed", cacheExpiresAt: "2026-10-30T12:00:00.000Z" }, now)).toBe("fresh");
    expect(classifyBaseLayerCache({ dataUrl: "https://cached", downloadStatus: "completed", cacheExpiresAt: "2026-10-28T12:00:00.000Z" }, now)).toBe("stale");
    expect(classifyBaseLayerCache({ dataUrl: "https://cached", downloadStatus: "downloading" }, now)).toBe("refreshing");
  });

  it("mantém cache antigo disponível enquanto aplica backoff após falha", () => {
    const retryAfter = computeRetryAfter(2, now);
    const record = { dataUrl: "https://cached", downloadStatus: "failed" as const, refreshFailureCount: 2, retryAfter };
    expect(classifyBaseLayerCache(record, now)).toBe("backoff");
    expect(canRefreshBaseLayer(record, false, now)).toMatchObject({ allowed: false, retryAfter });
    expect(canRefreshBaseLayer(record, true, now)).toMatchObject({ allowed: true });
  });

  it("limita o crescimento do backoff", () => {
    expect(computeRetryAfter(1, now).getTime() - now.getTime()).toBe(60_000);
    expect(computeRetryAfter(20, now).getTime() - now.getTime()).toBe(6 * 60 * 60 * 1000);
  });
});
