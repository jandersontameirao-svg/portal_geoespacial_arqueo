import { describe, expect, it } from "vitest";
import { rasterIngestionAvailability } from "./rasterIngestionAdapter";

describe("adapter de ingestão raster", () => {
  it("permanece indisponível sem configuração", () => {
    expect(rasterIngestionAvailability({} as NodeJS.ProcessEnv)).toMatchObject({ available: false, mode: "unconfigured" });
  });
  it("aceita worker HTTP(S) configurado no servidor", () => {
    expect(rasterIngestionAvailability({ ARQUEO_RASTER_WORKER_URL: "http://127.0.0.1:3001" } as NodeJS.ProcessEnv)).toMatchObject({ available: true, mode: "worker" });
  });
  it("exige root absoluto para modo local explícito", () => {
    expect(rasterIngestionAvailability({ ARQUEO_RASTER_INGESTION_MODE: "direct-local", ARQUEO_LOCAL_RASTER_ROOT: "relative" } as NodeJS.ProcessEnv)).toMatchObject({ available: false, mode: "unconfigured" });
  });
});
