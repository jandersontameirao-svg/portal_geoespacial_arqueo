import json
from pathlib import Path

from osgeo import ogr

folder = Path(__file__).resolve().parent
ogr.UseExceptions()
source = ogr.Open(f"/vsizip/{folder.as_posix()}/BR_Municipios.zip/BR_Municipios_2024.shp")
features = []
for row in source.GetLayer():
    geometry = row.GetGeometryRef()
    display = geometry.SimplifyPreserveTopology(0.003)
    if display is None or display.IsEmpty():
        display = geometry
    anchor = display.PointOnSurface()
    features.append({
        "type": "Feature",
        "geometry": json.loads(display.ExportToJson()),
        "properties": {
            **{field: row[field] for field in ("CD_MUN", "NM_MUN", "SIGLA_UF")},
            "ROT_LON": anchor.GetX(),
            "ROT_LAT": anchor.GetY(),
        },
    })

assert len(features) >= 5570
assert len({f["properties"]["SIGLA_UF"] for f in features}) == 27
(folder / "municipios-BR.geojson").write_text(
    json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
print(len(features), "feições municipais")
