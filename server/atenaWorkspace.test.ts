import { describe, expect, it } from "vitest";
import type { Feature, Polygon, MultiPolygon, Point, LineString } from "geojson";
import { rowsFromLayerData, selectLayerRows, featureFromStored, resultMetadata, collectionBounds } from "./atena/workspace";
import { parseRow, localProjection, ringAreaM2, toStoredPolygons } from "./atena/geo";
import booleanIntersects, { validPolygon } from "./atena/predicates";
import { generateProspectionUnits } from "./atena/prospect-grid";

const ring = (x: number, y: number, dx = 0.01, dy = 0.01) => [[x,y],[x+dx,y],[x+dx,y+dy],[x,y+dy],[x,y]];
const polygon: Feature<Polygon> = { type: "Feature", properties: { name: "Original" }, geometry: { type: "Polygon", coordinates: [ring(-46.6,-23.5), ring(-46.598,-23.498,0.002,0.002)] } };
const layer = { id: 17, name: "Resultado GIS existente", layerData: { type: "FeatureCollection", features: [polygon] }, metadata: { kind: "gis-analysis-result" } };
const point = (x:number,y:number):Feature<Point>=>({type:"Feature",properties:{},geometry:{type:"Point",coordinates:[x,y]}});
const poly = (x:number,y:number):Feature<Polygon>=>({type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[ring(x,y)]}});

describe("ponte explícita workspace↔Atena", () => {
  it("converte FC em leitura, preserva furo e não modifica dados de origem", () => {
    const before = JSON.stringify(layer);
    const rows = rowsFromLayerData(layer);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeLessThan(0);
    expect(rows[0].layerId).toBe(17);
    const parsed = parseRow(rows[0]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.issue.message);
    expect(parsed.value.feature.geometry).toEqual(polygon.geometry);
    expect(featureFromStored(rows[0]).geometry).toEqual(polygon.geometry);
    expect(JSON.stringify(layer)).toBe(before);
    expect(rowsFromLayerData(layer)[0].id).toBe(rows[0].id);
  });
  it("usa apenas geometries associadas quando FC e mirror estão presentes", () => {
    const rows = [{...rowsFromLayerData(layer)[0], id: 91}];
    expect(selectLayerRows(layer, rows)).toEqual(rows);
    expect(selectLayerRows(layer, rows)).toHaveLength(1);
    expect(selectLayerRows(layer, [{...rows[0],layerId:999}])[0].id).toBeLessThan(0);
  });
  it("MultiPolygon mantém componentes e furos no roundtrip", () => {
    const geometry:MultiPolygon={type:"MultiPolygon",coordinates:[polygon.geometry.coordinates,[ring(-46.57,-23.5)]]};
    const multi={...layer,layerData:{type:"FeatureCollection",features:[{...polygon,geometry}]}};
    const rows=rowsFromLayerData(multi);
    expect(rows).toHaveLength(1);
    expect(featureFromStored(rows[0]).geometry).toEqual(geometry);
    const parsed=parseRow(rows[0]);
    if(!parsed.ok)throw new Error(parsed.issue.message);
    expect(parsed.value.type).toBe("MultiPolygon");
    expect(toStoredPolygons(geometry)).toHaveLength(2);
    const proj=localProjection([parsed.value]);
    expect(ringAreaM2(geometry,proj)).toBeGreaterThan(0);
  });
  it("recusa fechamento/topologia inválidos, não os corrige na FC", () => {
    const bad=structuredClone(layer);
    bad.layerData.features[0].geometry.coordinates[0].pop();
    const before=JSON.stringify(bad);
    expect(()=>rowsFromLayerData(bad)).toThrow(/fechado/);
    expect(JSON.stringify(bad)).toBe(before);
  });
  it("não descarta silenciosamente GeometryCollection ou feição nula",()=>{
    expect(()=>rowsFromLayerData({...layer,layerData:{type:"FeatureCollection",features:[{type:"Feature",geometry:null}]}})).toThrow(/sem geometria/);
    expect(()=>rowsFromLayerData({...layer,layerData:{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"GeometryCollection",geometries:[]}}]}})).toThrow(/GeometryCollection/);
  });
  it("publica proveniência compatível sem alterar a classificação GIS",()=>{
    expect(resultMetadata({operation:"vector.buffer",runId:4,sourceLayerIds:[17]})).toMatchObject({kind:"gis-analysis-result",storageBridge:"geometry-mirror-v1",provenance:{engine:"atena",runId:4}});
    expect(collectionBounds({type:"FeatureCollection",features:[polygon]})).toEqual({west:-46.6,south:-23.5,east:-46.59,north:-23.49});
  });
});

describe("predicado de interseção sem dependência ausente",()=>{
  it("distingue sobreposição, disjunção, toque de fronteira e furos",()=>{
    expect(booleanIntersects(polygon,poly(-46.595,-23.495))).toBe(true);
    expect(booleanIntersects(polygon,poly(-46.5,-23.4))).toBe(false);
    expect(booleanIntersects(polygon,poly(-46.59,-23.5))).toBe(true);
    expect(booleanIntersects(polygon,point(-46.597,-23.497))).toBe(false);
    expect(booleanIntersects(polygon,point(-46.598,-23.497))).toBe(true);
    expect(booleanIntersects(polygon,point(-46.599,-23.499))).toBe(true);
  });
  it("identifica linha cruzando, ponto em linha, MultiPolygon e GeometryCollection",()=>{
    const line:Feature<LineString>={type:"Feature",properties:{},geometry:{type:"LineString",coordinates:[[-46.61,-23.495],[-46.58,-23.495]]}};
    expect(booleanIntersects(polygon,line)).toBe(true);
    expect(booleanIntersects(line,point(-46.6,-23.495))).toBe(true);
    expect(booleanIntersects({type:"MultiPolygon",coordinates:[polygon.geometry.coordinates]},point(-46.599,-23.499))).toBe(true);
    expect(booleanIntersects({type:"GeometryCollection",geometries:[polygon.geometry]},line)).toBe(true);
  });
  it("valida todos os furos e componentes, além de auto-interseção",()=>{
    expect(validPolygon(polygon.geometry)).toBe(true);
    expect(validPolygon({type:"Polygon",coordinates:[ring(-46.6,-23.5),ring(-46.5,-23.4)]})).toBe(false);
    expect(validPolygon({type:"MultiPolygon",coordinates:[polygon.geometry.coordinates,[ring(-46.599,-23.499)]]})).toBe(false);
  });
});

describe("prospecção pura preserva insumos e limites",()=>{
  it("gera unidades fora dos furos e exporta coordenadas GeoJSON",()=>{
    const before=JSON.stringify(polygon);
    const generated=generateProspectionUnits(polygon,{spacing:100,maxUnits:5000});
    expect(generated.count).toBeGreaterThan(0);
    expect(generated.geojson.features).toHaveLength(generated.count);
    for(const unit of generated.units) {
      expect(booleanIntersects(polygon,unit.geometry)).toBe(true);
      expect(unit.coordinates[0]).toBeLessThan(-40);
    }
    expect(JSON.stringify(polygon)).toBe(before);
  });
  it("limita grade densa antes de iterar",()=>{
    expect(()=>generateProspectionUnits(polygon,{spacing:0.001,maxUnits:2})).toThrow(/limite/);
  });
});
