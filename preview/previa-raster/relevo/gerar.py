"""Gera as camadas de visualização do Copernicus GLO-30 para o recorte da LT."""
from pathlib import Path

from osgeo import gdal, ogr, osr

gdal.UseExceptions()
ogr.UseExceptions()
folder = Path(__file__).resolve().parent
names = [
    f"Copernicus_DSM_COG_10_S{lat:02d}_00_W{lon:03d}_00_DEM.tif"
    for lat in (5, 6) for lon in (37, 38)
]
bounds = (-37.85, -5.75, -36.38, -4.75)
paths = [str(folder / name) for name in names]
if not all(Path(path).is_file() for path in paths):
    raise FileNotFoundError("Baixe os quatro GeoTIFFs GLO-30 antes de gerar o recorte.")
vrt = gdal.BuildVRT("", paths, strict=True)
metric = gdal.Warp("", vrt, format="MEM", dstSRS="EPSG:32724",
                   outputBounds=bounds, outputBoundsSRS="EPSG:4326",
                   xRes=30, yRes=30, resampleAlg="bilinear")
mercator = osr.SpatialReference()
mercator.ImportFromEPSG(3857)
wgs = osr.SpatialReference()
wgs.ImportFromEPSG(4326)
wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
transform = osr.CoordinateTransformation(wgs, mercator)
west, south, _ = transform.TransformPoint(*bounds[:2])
east, north, _ = transform.TransformPoint(*bounds[2:])
options = dict(format="MEM", dstSRS="EPSG:3857", outputBounds=(west, south, east, north),
               width=1800, height=1230, resampleAlg="bilinear")
for name, data, palette in [
    ("sombreado", gdal.DEMProcessing("", metric, "hillshade", format="MEM", computeEdges=True), None),
    ("elevacao", metric, "0 37 105 67\n100 123 177 83\n250 240 215 130\n500 172 105 55\n800 110 66 52\n1200 244 244 244\n"),
    ("declividade", gdal.DEMProcessing("", metric, "slope", format="MEM", computeEdges=True),
     "0 232 248 226\n5 124 199 120\n15 254 207 91\n30 233 108 56\n45 150 36 53\n90 83 19 51\n"),
]:
    projected = gdal.Warp("", data, **options)
    if palette:
        gdal.FileFromMemBuffer("/vsimem/glo30-colors", palette.encode())
        projected = gdal.DEMProcessing("", projected, "color-relief", format="MEM",
                                       colorFilename="/vsimem/glo30-colors")
    gdal.Translate(str(folder / f"{name}.png"), projected)

# Curvas em metros calculadas no raster de 30 m e convertidas para longitude/latitude.
contours = ogr.GetDriverByName("Memory").CreateDataSource("")
utm = osr.SpatialReference()
utm.ImportFromEPSG(32724)
lines = contours.CreateLayer("curvas", utm, ogr.wkbLineString)
lines.CreateField(ogr.FieldDefn("cota_m", ogr.OFTReal))
gdal.ContourGenerate(metric.GetRasterBand(1), 20, 0, [], 0, 0, lines, -1, 0)
# Remove subpixel vertices for the interactive preview while retaining the 20 m interval.
for feature in lines:
    simplified = feature.GetGeometryRef().Simplify(15)
    if simplified and not simplified.IsEmpty():
        feature.SetGeometry(simplified)
        lines.SetFeature(feature)
lines.ResetReading()
projected_lines = gdal.VectorTranslate("", contours, format="Memory", dstSRS="EPSG:3857")
canvas = gdal.GetDriverByName("MEM").Create("", 2400, 1640, 4, gdal.GDT_Byte)
canvas.SetProjection(mercator.ExportToWkt())
canvas.SetGeoTransform((west, (east - west) / 2400, 0, north, 0, (south - north) / 1640))
canvas.GetRasterBand(4).SetColorInterpretation(gdal.GCI_AlphaBand)
gdal.RasterizeLayer(canvas, [1, 2, 3, 4], projected_lines.GetLayer(), burn_values=[133, 77, 14, 255])
gdal.Translate(str(folder / "curvas.png"), canvas)
print(f"{lines.GetFeatureCount()} curvas · equidistância de 20 m")
