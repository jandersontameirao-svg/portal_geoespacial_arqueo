declare module "@mapbox/togeojson" {
  import type { FeatureCollection, Geometry } from "geojson";

  const toGeoJSON: {
    kml(document: unknown, options?: { styles?: boolean }): FeatureCollection<Geometry>;
    gpx(document: unknown): FeatureCollection<Geometry>;
  };

  export default toGeoJSON;
}
