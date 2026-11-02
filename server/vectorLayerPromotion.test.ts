import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { processGeospatialFile } from "./fileProcessing";
import { createImportedVectorLayer, isPromotableVectorLayer, vectorFeaturesFromLayer } from "./vectorLayerPromotion";

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Ponto arqueológico</name><Point><coordinates>-47.91,-15.79,0</coordinates></Point></Placemark>
  <Placemark><name>ADA</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-47.93,-15.81,0 -47.90,-15.81,0 -47.90,-15.78,0 -47.93,-15.81,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;

const file = {
  id: 19,
  projectId: 7,
  name: "ada_validada.kmz",
  fileType: "kmz",
  crs: "EPSG:4326",
  bounds: null,
};

describe("promoção de arquivo vetorial para camada", () => {
  it("converte KML em GeoJSON e mantém feature count/bounds", async () => {
    const result = await processGeospatialFile(Buffer.from(kml), "ada.kml");
    expect(result.isGeospatial).toBe(true);
    expect(result.crs).toBe("EPSG:4326");
    expect(result.featureCount).toBe(2);
    expect(isPromotableVectorLayer(result.layerData)).toBe(true);
    expect(result.bounds).toMatchObject({ west: -47.93, east: -47.9 });
  });

  it("extrai o KML interno de KMZ e gera camada desativada com proveniência", async () => {
    const zip = new JSZip();
    zip.file("doc.kml", kml);
    const result = await processGeospatialFile(await zip.generateAsync({ type: "nodebuffer" }), "ada_validada.kmz");
    const layer = createImportedVectorLayer({ file, processing: result, createdBy: 3 });

    expect(layer).not.toBeNull();
    expect(layer).toMatchObject({ projectId: 7, fileId: 19, layerType: "vector", isVisible: false, isPublic: false, crs: "EPSG:4326" });
    expect(layer?.metadata).toMatchObject({ kind: "file-vector-import", sourceFileId: 19, sourceFileName: "ada_validada.kmz", conversion: "kml_or_kmz_to_geojson" });
    expect(vectorFeaturesFromLayer(layer?.layerData)).toHaveLength(2);
  });

  it("recusa promoção quando o processador não produz uma FeatureCollection utilizável", () => {
    const layer = createImportedVectorLayer({
      file,
      processing: { isGeospatial: true, crs: "EPSG:4326", layerData: { type: "FeatureCollection", features: [] } },
      createdBy: 3,
    });
    expect(layer).toBeNull();
    expect(vectorFeaturesFromLayer({ type: "FeatureCollection", features: [] })).toEqual([]);
  });
});
