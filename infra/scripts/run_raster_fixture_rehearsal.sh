#!/usr/bin/env bash
# Ensaio local descartável: GeoTIFF sintético -> COG EPSG:4674 -> comparação temporal.
# Não usa banco, storage, dados reais, Docker ou serviços de produção.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${1:-$(mktemp -d /tmp/arqueo-raster-rehearsal.XXXXXX)}"
PYTHON_BIN="${PYTHON_BIN:-/usr/bin/python3}"

# O GDAL instalado por pacote do sistema usa o NumPy distribuído pelo sistema.
# O sandbox também possui NumPy global mais novo; esta função evita misturá-los.
gdal_python() {
  env -u PYTHONPATH PYTHONNOUSERSITE=1 PYTHONPATH=/usr/lib/python3/dist-packages "$PYTHON_BIN" "$@"
}

cleanup() {
  if [[ "${KEEP_ARTIFACTS:-0}" != "1" ]]; then
    rm -rf "$OUTPUT_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"
gdal_python "$ROOT/infra/raster/generate_synthetic_rasters.py" --output-dir "$OUTPUT_DIR/raw"

gdal_python "$ROOT/infra/raster/process_to_cog.py" \
  --input "$OUTPUT_DIR/raw/before_raw_epsg4326.tif" \
  --output "$OUTPUT_DIR/cog/before_epsg4674.cog.tif" \
  --asset-id "synthetic-before-2026-01-01" \
  --datetime "2026-01-01T12:00:00Z" \
  --source "fixture-sintética-local; sem dados externos" \
  --target-crs "EPSG:4674" --nodata 0 --resampling cubic

gdal_python "$ROOT/infra/raster/process_to_cog.py" \
  --input "$OUTPUT_DIR/raw/after_raw_epsg4326.tif" \
  --output "$OUTPUT_DIR/cog/after_epsg4674.cog.tif" \
  --asset-id "synthetic-after-2026-02-01" \
  --datetime "2026-02-01T12:00:00Z" \
  --source "fixture-sintética-local; sem dados externos" \
  --target-crs "EPSG:4674" --nodata 0 --resampling cubic

gdal_python "$ROOT/infra/raster/compare_temporal.py" \
  --before "$OUTPUT_DIR/cog/before_epsg4674.cog.tif" \
  --after "$OUTPUT_DIR/cog/after_epsg4674.cog.tif" \
  --output "$OUTPUT_DIR/cog/change_mask_epsg4674.cog.tif" \
  --threshold 30 \
  --report "$OUTPUT_DIR/cog/temporal_comparison.json"

gdal_python - "$OUTPUT_DIR" <<'PY'
import json, sys
from pathlib import Path
from osgeo import gdal, osr

root = Path(sys.argv[1])
for filename in ["before_epsg4674.cog.tif", "after_epsg4674.cog.tif", "change_mask_epsg4674.cog.tif"]:
    ds = gdal.Open(str(root / "cog" / filename))
    assert ds, f"arquivo ausente: {filename}"
    srs = osr.SpatialReference(); srs.ImportFromWkt(ds.GetProjection()); srs.AutoIdentifyEPSG()
    assert srs.GetAuthorityCode(None) == "4674", f"CRS inesperado em {filename}"
    assert (ds.GetMetadata("IMAGE_STRUCTURE") or {}).get("LAYOUT") == "COG", f"layout COG ausente em {filename}"
    assert ds.GetRasterBand(1).GetOverviewCount() >= 1, f"pirâmide ausente em {filename}"
    assert ds.GetRasterBand(1).GetNoDataValue() == 0.0, f"NoData inesperado em {filename}"

before_manifest = json.loads((root / "cog" / "before_epsg4674.cog.stac-item.json").read_text())
assert before_manifest["properties"]["proj:epsg"] == 4674
assert before_manifest["assets"]["cog"]["file:checksum"].startswith("sha256:")
comparison = json.loads((root / "cog" / "temporal_comparison.json").read_text())
assert comparison["changedPixels"] > 0, "mudança sintética não foi detectada"
assert comparison["changedPercent"] > 0, "percentual de mudança inválido"
print(json.dumps({
    "status": "passed",
    "outputDir": str(root),
    "changedPixels": comparison["changedPixels"],
    "changedPercent": comparison["changedPercent"],
    "meanAbsoluteDelta": comparison["meanAbsoluteDelta"],
    "files": sorted(str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()),
}, ensure_ascii=False))
PY

if [[ "${KEEP_ARTIFACTS:-0}" == "1" ]]; then
  echo "Artefatos preservados em: $OUTPUT_DIR"
fi
