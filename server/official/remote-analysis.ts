import bbox from "@turf/bbox";
import booleanIntersects from "../atena/predicates";
import intersect from "@turf/intersect";
import area from "@turf/area";
import {featureCollection} from "@turf/helpers";
import type {Feature, Polygon, MultiPolygon} from "geojson";
import {queryRemoteSource} from "./remote-client";
import type {QueryScope, RemoteQueryResult} from "./remote-types";

export function analyzeRemoteFeatures(ada:Feature<Polygon|MultiPolygon>,response:RemoteQueryResult) {
  if(!response.complete)throw new Error("Recorte remoto incompleto; reduza a área antes da análise. Não há fallback local.");
  if(!response.provenance.geometryComplete)throw new Error("Fonte não fornece geometria vetorial completa; tabela/WMS não sustentam interseção espacial.");
  const selected=response.geojson.features.filter(feature=>booleanIntersects(ada,feature));
  const adaArea=area(ada);
  const overlaps=selected.map(feature=>{
    const isPolygon=feature.geometry.type==="Polygon"||feature.geometry.type==="MultiPolygon";
    const overlap=isPolygon?intersect(featureCollection([ada,feature as Feature<Polygon|MultiPolygon>])):null;
    const areaM2=overlap?area(overlap):0;
    if(areaM2>adaArea*(1+1e-8))throw new Error("Interseção numericamente inconsistente; resultado não será apresentado como válido.");
    return {id:feature.id??null,attributes:feature.properties,intersects:true,intersection:overlap,areaM2};
  });
  return {officialFeatures:featureCollection(selected),overlaps,totalIntersected:selected.length,queriedFeatures:response.geojson.features.length,provenance:response.provenance,notes:["Geometrias oficiais originais preservadas; interseções são resultados próprios do estudo.","Áreas geodésicas aproximadas em m²; pontos/linhas registram interseção, sem área poligonal fictícia."]};
}

export async function analyzeRemoteAda(institutionId:string,ada:Feature<Polygon|MultiPolygon>,scope:QueryScope) {
  const [west,south,east,north]=bbox(ada);
  const response=await queryRemoteSource(institutionId,{bbox:{west,south,east,north},limit:200},scope);
  return analyzeRemoteFeatures(ada,response);
}
