import { describe, expect, it } from "vitest";
import { buildInitialFileVersion } from "./fileVersioning";

const sha256 = "a".repeat(64);

const validInput = {
  fileId: 14,
  s3Key: "projects/7/files/abc-demo.kml",
  s3Url: "https://example.invalid/object",
  fileSize: 345,
  mimeType: "application/vnd.google-earth.kml+xml",
  sha256,
  uploadedBy: 9,
  originalName: "demo.kml",
  fileType: "kml",
  source: "upload" as const,
};

describe("versão inicial de arquivo", () => {
  it("cria referência imutável aos bytes já enviados", () => {
    expect(buildInitialFileVersion(validInput)).toMatchObject({
      fileId: 14,
      version: 1,
      sha256,
      metadata: { kind: "initial-upload", immutableReference: true, source: "upload" },
    });
  });

  it("rejeita hash inválido antes de acessar o banco", () => {
    expect(() => buildInitialFileVersion({ ...validInput, sha256: "invalido" })).toThrow("SHA-256 inválido");
  });
});
