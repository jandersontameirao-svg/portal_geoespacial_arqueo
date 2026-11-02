#!/usr/bin/env python3
"""Prepara tiles XYZ PNG locais a partir de um COG já aprovado.

Executa somente sobre paths locais fornecidos pelo processo servidor. Não faz rede,
não recebe URL, não serve arquivos e não acessa banco/storage remoto.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from osgeo import gdal, osr

gdal.UseExceptions()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def epsg(dataset: gdal.Dataset) -> int | None:
    srs = osr.SpatialReference()
    srs.ImportFromWkt(dataset.GetProjection())
    srs.AutoIdentifyEPSG()
    code = srs.GetAuthorityCode(None)
    return int(code) if code else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--tiles", required=True, type=Path)
    parser.add_argument("--min-zoom", required=True, type=int)
    parser.add_argument("--max-zoom", required=True, type=int)
    parser.add_argument("--expected-crs", default="EPSG:4674")
    parser.add_argument("--require-nodata", action="store_true")
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    if not args.input.is_file(): raise SystemExit("COG de entrada não encontrado")
    if not 0 <= args.min_zoom <= args.max_zoom <= 22: raise SystemExit("Faixa de zoom inválida")
    ds = gdal.Open(str(args.input), gdal.GA_ReadOnly)
    if ds is None: raise SystemExit("GDAL não abriu o COG")
    layout = (ds.GetMetadata("IMAGE_STRUCTURE") or {}).get("LAYOUT")
    expected_epsg = int(args.expected_crs.split(":", 1)[1])
    source_epsg = epsg(ds)
    nodata = [ds.GetRasterBand(i).GetNoDataValue() for i in range(1, ds.RasterCount + 1)]
    if layout != "COG": raise SystemExit("A fonte deve ser Cloud Optimized GeoTIFF")
    if source_epsg != expected_epsg: raise SystemExit(f"CRS inesperado: EPSG:{source_epsg}; esperado {args.expected_crs}")
    if args.require_nodata and any(value is None for value in nodata): raise SystemExit("Todas as bandas precisam declarar NoData")
    if min(ds.GetRasterBand(i).GetOverviewCount() for i in range(1, ds.RasterCount + 1)) < 1: raise SystemExit("COG sem pirâmide interna")
    ds = None
    if args.tiles.exists(): shutil.rmtree(args.tiles)
    args.tiles.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "/usr/bin/gdal2tiles.py", "--xyz", "--profile=mercator", "--resampling=cubic",
        "--tilesize=256", f"--zoom={args.min_zoom}-{args.max_zoom}",
        str(args.input), str(args.tiles),
    ]
    subprocess.run(command, check=True, text=True)
    tiles = sorted(args.tiles.glob("*/*/*.png"))
    if not tiles: raise SystemExit("gdal2tiles não produziu PNGs")
    manifest = {
        "kind": "local-raster-xyz",
        "source": {"filename": args.input.name, "sha256": sha256(args.input), "crs": args.expected_crs, "nodata": nodata},
        "tiles": {"scheme": "xyz", "crs": "EPSG:3857", "tileSize": 256, "minZoom": args.min_zoom, "maxZoom": args.max_zoom, "count": len(tiles)},
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
