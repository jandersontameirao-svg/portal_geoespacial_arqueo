import { describe, expect, it } from "vitest";
import {
  classifyEndpointFingerprintMatch,
  fingerprintOgcEndpoint,
  MAX_OGC_ENDPOINT_LENGTH,
  ogcEndpointInputSchema,
} from "./ogcEndpointIdentity";

function endpointOfLength(length: number): string {
  const prefix = "https://ogc.invalid/";
  return prefix + "a".repeat(length - prefix.length);
}

describe("ogc endpoint identity", () => {
  it.each([500, 501, MAX_OGC_ENDPOINT_LENGTH])("aceita URL OGC de %s caracteres sem truncamento", (length) => {
    const endpoint = endpointOfLength(length);
    const result = ogcEndpointInputSchema.safeParse(endpoint);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(length);
  });

  it("rejeita URL OGC acima do contrato de 1.000 caracteres", () => {
    expect(ogcEndpointInputSchema.safeParse(endpointOfLength(MAX_OGC_ENDPOINT_LENGTH + 1)).success).toBe(false);
  });

  it("produz a mesma identidade para o mesmo endpoint integral", () => {
    const endpoint = endpointOfLength(1000);
    expect(fingerprintOgcEndpoint(endpoint)).toBe(fingerprintOgcEndpoint(endpoint));
  });

  it("distingue URLs diferentes e classifica colisão sem sobrescrever", () => {
    const current = endpointOfLength(501);
    const requested = endpointOfLength(500);
    expect(fingerprintOgcEndpoint(current)).not.toBe(fingerprintOgcEndpoint(requested));
    expect(classifyEndpointFingerprintMatch(current, current)).toBe("duplicate");
    expect(classifyEndpointFingerprintMatch(current, requested)).toBe("collision");
  });
});
