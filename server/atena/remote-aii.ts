import { createHash } from "node:crypto";
import bbox from "@turf/bbox";
import area from "@turf/area";
import booleanIntersects from "./predicates";
import intersect from "@turf/intersect";
import { featureCollection } from "@turf/helpers";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { queryRemoteSource } from "../official/remote-client";

type MunicipalGeometry = Polygon | MultiPolygon;
type MunicipalFeature = Feature<MunicipalGeometry, Record<string, unknown>>;

type RemoteProvenance = {
  institutionId: string;
  endpoint: string;
  serviceVersion: string;
  edition: string;
  geometryComplete: boolean;
  queriedAt: string;
  cacheExpiresAt: string;
  cacheHit: boolean;
  license: string;
  crs: string;
};

export type RemoteAiiScope = { userId: number; projectId?: number };

export type RemoteOfficialAii = {
  featureCollection: FeatureCollection<MunicipalGeometry, Record<string, unknown>>;
  municipalities: Array<{ code: string; name: string; year: number }>;
  review: Array<{ code: string; name: string }>;
  year: 2025;
  edition: string;
  sha256: string;
  source: string;
  coverage: "consulta remota";
  coveredFraction: number;
  provenance: RemoteProvenance;
  queriedAt: string;
};

const CODE_FIELDS = [
  "CD_MUN",
  "cd_mun",
  "CD_GEOCMU",
  "cd_geocmu",
  "codigo_municipio",
  "codigoMunicipio",
  "municipalityCode",
  "code",
] as const;
const NAME_FIELDS = [
  "NM_MUN",
  "nm_mun",
  "NM_MUNICIP",
  "nm_municip",
  "municipalityName",
  "name",
] as const;

function propertyValue(properties: Record<string, unknown>, fields: readonly string[]) {
  for (const field of fields) {
    const value = properties[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return null;
}

function confirmed2025(edition: string) {
  return edition.trim() === "2025";
}

function block(reason: string): never {
  throw new Error(`AII bloqueada: ${reason}`);
}

/**
 * Seleciona municípios inteiros a partir da consulta oficial remota.
 * Este módulo deliberadamente não conhece nem carrega o cache local legado.
 */
export async function selectRemoteOfficialAii(
  ada: Feature<Polygon | MultiPolygon>,
  includeTouchCodes: string[] = [],
  scope: RemoteAiiScope,
): Promise<RemoteOfficialAii> {
  const [west, south, east, north] = bbox(ada);
  const response = await queryRemoteSource(
    "ibge-municipal-2025",
    { bbox: { west, south, east, north }, limit: 200 },
    scope,
  );

  const provenance = response.provenance;
  if (!provenance || !confirmed2025(provenance.edition)) {
    block(`edição remota não confirmada como 2025 (${provenance?.edition || "ausente"}).`);
  }
  if (provenance.geometryComplete !== true) {
    block("a consulta remota não confirmou geometrias completas.");
  }
  if (!response.geojson || response.geojson.type !== "FeatureCollection" || !Array.isArray(response.geojson.features)) {
    block("a resposta remota não é uma FeatureCollection válida.");
  }
  if (response.complete !== true) {
    block("a consulta remota foi truncada ou está incompleta.");
  }
  if (response.matched != null && response.matched > response.geojson.features.length) {
    block(`a consulta remota foi truncada (${response.geojson.features.length} de ${response.matched} feições).`);
  }

  const candidates: MunicipalFeature[] = [];
  for (const feature of response.geojson.features) {
    if (!feature || !feature.geometry || (feature.geometry.type !== "Polygon" && feature.geometry.type !== "MultiPolygon")) {
      block("a consulta remota retornou geometria municipal diferente de Polygon/MultiPolygon.");
    }
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const code = propertyValue(properties, CODE_FIELDS);
    const name = propertyValue(properties, NAME_FIELDS);
    if (!code || !name) {
      block("a consulta remota não trouxe código e nome municipal oficiais.");
    }
    candidates.push(feature as MunicipalFeature);
  }

  const adaArea = area(ada);
  if (!adaArea || !Number.isFinite(adaArea)) block("a ADA é inválida ou sem área.");
  const [adaWest, adaSouth, adaEast, adaNorth] = [west, south, east, north];
  const selected: MunicipalFeature[] = [];
  const review: Array<{ code: string; name: string; feature: MunicipalFeature }> = [];
  let coveredArea = 0;

  for (const municipality of candidates) {
    const [mw, ms, me, mn] = bbox(municipality);
    if (me < adaWest || mw > adaEast || mn < adaSouth || ms > adaNorth) continue;
    if (!booleanIntersects(ada, municipality)) continue;
    const overlap = intersect(featureCollection([ada, municipality]));
    const overlapArea = overlap ? area(overlap) : 0;
    if (overlapArea > 0) {
      selected.push(municipality);
      coveredArea += overlapArea;
    } else {
      const properties = municipality.properties;
      review.push({
        code: propertyValue(properties, CODE_FIELDS)!,
        name: propertyValue(properties, NAME_FIELDS)!,
        feature: municipality,
      });
    }
  }

  const coveredFraction = coveredArea / adaArea;
  if (coveredFraction > 1.000001) block("interseção municipal numericamente inconsistente; cobertura maior que a ADA.");
  if (coveredFraction < 0.999) {
    block(`cobertura municipal remota incompleta para a ADA (${coveredFraction.toFixed(6)}; mínimo 0.999).`);
  }

  for (const code of includeTouchCodes) {
    const touch = review.find(row => row.code === code);
    if (!touch) block("código de contato não corresponde à revisão de fronteira desta ADA.");
    if (!selected.some(feature => propertyValue(feature.properties, CODE_FIELDS) === code)) selected.push(touch.feature);
  }

  const commonProperties = {
    role: "AII",
    meshYear: 2025,
    edition: provenance.edition,
    source: provenance.endpoint,
    provenance,
    queriedAt: provenance.queriedAt,
    method: "município inteiro; sem recorte ou buffer",
  };
  const municipalityRows = selected.map(feature => {
    const properties = feature.properties;
    const code = propertyValue(properties, CODE_FIELDS)!;
    const name = propertyValue(properties, NAME_FIELDS)!;
    return { code, name, year: 2025 as const };
  });
  const resultFeatures = selected.map(feature => {
    const municipality = municipalityRows.find(row => row.code === propertyValue(feature.properties, CODE_FIELDS))!;
    return {
      ...feature,
      properties: {
        ...feature.properties,
        ...commonProperties,
        municipalityCode: municipality.code,
        municipalityName: municipality.name,
      },
    } as MunicipalFeature;
  });
  const resultCollection = featureCollection(resultFeatures) as FeatureCollection<MunicipalGeometry, Record<string, unknown>>;
  const sha256 = createHash("sha256").update(JSON.stringify(resultCollection)).digest("hex");

  return {
    featureCollection: resultCollection,
    municipalities: municipalityRows,
    review: review.map(({ code, name }) => ({ code, name })),
    year: 2025,
    edition: provenance.edition,
    sha256,
    source: provenance.endpoint,
    coverage: "consulta remota",
    coveredFraction,
    provenance,
    queriedAt: provenance.queriedAt,
  };
}
