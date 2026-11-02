/** Predicados planares sobre coordenadas geográficas: contato conta como interseção.
 * Não calcula distâncias/áreas. Validade poligonal é responsabilidade da validação compartilhada.
 * Substitui imports Turf não declarados no baseline, sem recorrer a caminhos internos de dependências.
 */
import type { Feature, Geometry, Position } from "geojson";
import { validateClosedPolygonCoordinates } from "../../shared/geometry-coordinates";
const EPS = 1e-12;
function orient(a: Position, b: Position, c: Position) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function onSegment(p: Position, a: Position, b: Position) {
  return Math.abs(orient(a,b,p)) <= EPS && p[0] >= Math.min(a[0],b[0])-EPS && p[0] <= Math.max(a[0],b[0])+EPS && p[1] >= Math.min(a[1],b[1])-EPS && p[1] <= Math.max(a[1],b[1])+EPS;
}
function segmentsTouch(a: Position, b: Position, c: Position, d: Position) {
  if (onSegment(a,c,d)||onSegment(b,c,d)||onSegment(c,a,b)||onSegment(d,a,b)) return true;
  return orient(a,b,c)*orient(a,b,d)<0 && orient(c,d,a)*orient(c,d,b)<0;
}
function inRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i];
    if (onSegment(p,a,b)) return true;
    if ((a[1]>p[1])!==(b[1]>p[1]) && p[0] < (b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
function onRing(p:Position,ring:Position[]) { return ring.some((value,index)=>index>0 && onSegment(p,ring[index-1],value)); }
function inPolygon(p:Position,rings:Position[][]) {
  if (rings.some(ring=>onRing(p,ring))) return true;
  return inRing(p,rings[0]) && !rings.slice(1).some(ring=>inRing(p,ring));
}
function atomic(geometry:Geometry): Geometry[] {
  if(geometry.type==="GeometryCollection") return geometry.geometries.flatMap(atomic);
  if(geometry.type==="MultiPolygon") return geometry.coordinates.map(coordinates=>({type:"Polygon",coordinates}));
  if(geometry.type==="MultiLineString") return geometry.coordinates.map(coordinates=>({type:"LineString",coordinates}));
  if(geometry.type==="MultiPoint") return geometry.coordinates.map(coordinates=>({type:"Point",coordinates}));
  return [geometry];
}
function points(geometry:Geometry):Position[] {
  if(geometry.type==="Point")return [geometry.coordinates];
  if(geometry.type==="LineString")return geometry.coordinates;
  if(geometry.type==="Polygon")return geometry.coordinates.flat();
  throw new Error("Predicado exige geometria atômica.");
}
function segments(geometry:Geometry):[Position,Position][] {
  const lines = geometry.type==="Polygon" ? geometry.coordinates : geometry.type==="LineString" ? [geometry.coordinates] : [];
  return lines.flatMap(line=>line.slice(1).map((value,index)=>[line[index],value] as [Position,Position]));
}
function contains(geometry:Geometry,p:Position) {
  if(geometry.type==="Point") return Math.abs(geometry.coordinates[0]-p[0])<=EPS && Math.abs(geometry.coordinates[1]-p[1])<=EPS;
  if(geometry.type==="Polygon")return inPolygon(p,geometry.coordinates);
  return segments(geometry).some(([a,b])=>onSegment(p,a,b));
}
export function booleanIntersects(left:Feature|Geometry,right:Feature|Geometry):boolean {
  const a="geometry" in left?left.geometry:left,b="geometry" in right?right.geometry:right;
  return atomic(a).some(x=>atomic(b).some(y=> {
    if(segments(x).some(([p,q])=>segments(y).some(([r,s])=>segmentsTouch(p,q,r,s))))return true;
    return points(x).some(p=>contains(y,p)) || points(y).some(p=>contains(x,p));
  }));
}
export default booleanIntersects;
export function validPolygon(geometry:unknown):boolean {
  try {
    const value=geometry as {type:string;coordinates:unknown};
    if(!value || !["Polygon","MultiPolygon"].includes(value.type))return false;
    validateClosedPolygonCoordinates(value.coordinates,"geojson-lng-lat");
    return true;
  }catch{return false;}
}
