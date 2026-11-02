#!/usr/bin/env python3
"""Compara dois COGs alinhados e cria uma máscara COG de mudanças com relatório JSON."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from osgeo import gdal


gdal.UseExceptions()


def same_grid(first: gdal.Dataset, second: gdal.Dataset) -> bool:
    return (
        first.RasterXSize == second.RasterXSize
        and first.RasterYSize == second.RasterYSize
        and first.GetProjection() == second.GetProjection()
        and tuple(round(value, 12) for value in first.GetGeoTransform()) == tuple(round(value, 12) for value in second.GetGeoTransform())
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--threshold", type=float, default=30.0, help="Diferença média RGB mínima por pixel")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    before = gdal.Open(str(args.before), gdal.GA_ReadOnly)
    after = gdal.Open(str(args.after), gdal.GA_ReadOnly)
    if before is None or after is None:
        raise SystemExit("Não foi possível abrir os dois COGs")
    if not same_grid(before, after):
        raise SystemExit("COGs não estão alinhados: reprojete-os para mesma grade antes da comparação")
    if min(before.RasterCount, after.RasterCount) < 3:
        raise SystemExit("Comparação temporal exige ao menos três bandas RGB")

    before_rgb = np.stack([before.GetRasterBand(index).ReadAsArray().astype(np.float32) for index in range(1, 4)])
    after_rgb = np.stack([after.GetRasterBand(index).ReadAsArray().astype(np.float32) for index in range(1, 4)])
    nodata = before.GetRasterBand(1).GetNoDataValue()
    valid = np.ones(before_rgb.shape[1:], dtype=bool)
    if nodata is not None:
        valid &= np.any(before_rgb != nodata, axis=0) & np.any(after_rgb != nodata, axis=0)

    mean_abs_delta = np.mean(np.abs(after_rgb - before_rgb), axis=0)
    changed = (mean_abs_delta >= args.threshold) & valid
    output = np.where(changed, 1, 0).astype(np.uint8)

    mem = gdal.GetDriverByName("MEM").Create("", before.RasterXSize, before.RasterYSize, 1, gdal.GDT_Byte)
    mem.SetProjection(before.GetProjection())
    mem.SetGeoTransform(before.GetGeoTransform())
    band = mem.GetRasterBand(1)
    band.SetNoDataValue(0)
    band.WriteArray(output)
    band.SetDescription("Máscara de mudança temporal: 1=mudança, 0=sem mudança/NoData")
    band.FlushCache()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    gdal.Translate(
        str(args.output), mem,
        format="COG",
        creationOptions=[
            "COMPRESS=DEFLATE", "LEVEL=9", "BLOCKSIZE=512", "OVERVIEWS=IGNORE_EXISTING",
            "OVERVIEW_RESAMPLING=NEAREST", "STATISTICS=YES",
        ],
    )
    result = gdal.Open(str(args.output), gdal.GA_ReadOnly)
    layout = (result.GetMetadata("IMAGE_STRUCTURE") or {}).get("LAYOUT")
    overviews = result.GetRasterBand(1).GetOverviewCount()
    if layout != "COG" or overviews < 1:
        raise SystemExit("Máscara de mudança não passou validação COG/overview")

    valid_count = int(np.count_nonzero(valid))
    changed_count = int(np.count_nonzero(changed))
    report = {
        "kind": "raster-temporal-comparison",
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "before": args.before.name,
        "after": args.after.name,
        "changeMask": args.output.name,
        "thresholdMeanAbsoluteRgb": args.threshold,
        "validPixels": valid_count,
        "changedPixels": changed_count,
        "changedPercent": round((changed_count / valid_count * 100) if valid_count else 0, 6),
        "meanAbsoluteDelta": round(float(mean_abs_delta[valid].mean()) if valid_count else 0, 6),
        "crs": result.GetProjectionRef(),
        "cog": {"layout": layout, "overviews": overviews, "nodata": 0},
        "limitations": [
            "Métrica por diferença radiométrica RGB; não substitui classificação temática ou interpretação arqueológica.",
            "Entrada deve estar co-registrada e com a mesma grade espacial.",
        ],
    }
    (args.report or args.output.with_suffix(".comparison.json")).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
