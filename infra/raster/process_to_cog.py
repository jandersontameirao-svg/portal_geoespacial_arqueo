#!/usr/bin/env python3
"""Processa GeoTIFF local para Cloud Optimized GeoTIFF com manifesto STAC-like.

Uso exclusivo de dados locais fornecidos explicitamente. O script não acessa rede,
S3, banco ou qualquer configuração do Portal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from osgeo import gdal, osr


gdal.UseExceptions()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def epsg_from_wkt(wkt: str) -> int | None:
    if not wkt:
        return None
    srs = osr.SpatialReference()
    srs.ImportFromWkt(wkt)
    srs.AutoIdentifyEPSG()
    code = srs.GetAuthorityCode(None)
    return int(code) if code else None


def bounds_from_geotransform(dataset: gdal.Dataset) -> list[float]:
    transform = dataset.GetGeoTransform()
    width, height = dataset.RasterXSize, dataset.RasterYSize
    corners = [
        (transform[0], transform[3]),
        (transform[0] + width * transform[1], transform[3] + width * transform[4]),
        (transform[0] + height * transform[2], transform[3] + height * transform[5]),
        (
            transform[0] + width * transform[1] + height * transform[2],
            transform[3] + width * transform[4] + height * transform[5],
        ),
    ]
    xs = [point[0] for point in corners]
    ys = [point[1] for point in corners]
    return [min(xs), min(ys), max(xs), max(ys)]


def run(args: list[str]) -> None:
    subprocess.run(args, check=True, text=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--datetime", required=True, help="ISO 8601 em UTC")
    parser.add_argument("--source", required=True, help="Fonte e licença documentadas pelo operador")
    parser.add_argument("--target-crs", default="EPSG:4674")
    parser.add_argument("--nodata", type=float, default=0)
    parser.add_argument("--resampling", choices=["nearest", "bilinear", "cubic", "lanczos"], default="cubic")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Arquivo de entrada não encontrado: {args.input}")
    if not args.datetime.endswith("Z"):
        raise SystemExit("--datetime deve estar em UTC e terminar com Z")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = args.manifest or args.output.with_suffix(".stac-item.json")
    warp_path = args.output.with_suffix(".warped.tif")

    # Primeiro estágio explícito preserva a semântica de NoData e torna a reprojeção auditável.
    run([
        "gdalwarp", "-overwrite", "-t_srs", args.target_crs,
        "-r", args.resampling,
        "-srcnodata", str(args.nodata), "-dstnodata", str(args.nodata),
        "-multi", "-wo", "NUM_THREADS=ALL_CPUS",
        str(args.input), str(warp_path),
    ])

    # O driver COG gera overviews internos/pirâmides; IGNORE_EXISTING força criação consistente.
    run([
        "gdal_translate", "-of", "COG",
        "-co", "COMPRESS=DEFLATE", "-co", "LEVEL=9", "-co", "PREDICTOR=YES",
        "-co", "BLOCKSIZE=512", "-co", "BIGTIFF=IF_SAFER",
        "-co", "OVERVIEWS=IGNORE_EXISTING", "-co", "OVERVIEW_RESAMPLING=" + args.resampling.upper(),
        "-co", "STATISTICS=YES",
        str(warp_path), str(args.output),
    ])
    warp_path.unlink(missing_ok=True)

    dataset = gdal.Open(str(args.output), gdal.GA_ReadOnly)
    if dataset is None:
        raise SystemExit("GDAL não conseguiu abrir o COG gerado")
    epsg = epsg_from_wkt(dataset.GetProjection())
    overview_counts = [dataset.GetRasterBand(index).GetOverviewCount() for index in range(1, dataset.RasterCount + 1)]
    nodata_values = [dataset.GetRasterBand(index).GetNoDataValue() for index in range(1, dataset.RasterCount + 1)]
    image_structure = dataset.GetMetadata("IMAGE_STRUCTURE") or {}
    bounds = bounds_from_geotransform(dataset)
    size = dataset.RasterXSize, dataset.RasterYSize
    dataset = None

    if image_structure.get("LAYOUT") != "COG":
        raise SystemExit("Saída não foi identificada pelo GDAL como COG")
    if epsg != int(args.target_crs.split(":", 1)[1]):
        raise SystemExit(f"CRS de saída inesperado: EPSG:{epsg}")
    if min(overview_counts) < 1:
        raise SystemExit("COG sem overview interno; aumente dimensão ou ajuste criação")

    item = {
        "type": "Feature",
        "stac_version": "1.0.0",
        "id": args.asset_id,
        "bbox": bounds,
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]]]],
        },
        "properties": {
            "datetime": args.datetime,
            "proj:epsg": epsg,
            "proj:shape": [size[1], size[0]],
            "raster:bands": [{"nodata": value, "data_type": "uint8"} for value in nodata_values],
            "arqueo:processing": {
                "pipeline": "gdalwarp + gdal_translate COG",
                "target_crs": args.target_crs,
                "resampling": args.resampling,
                "nodata": args.nodata,
                "overview_counts": overview_counts,
                "layout": image_structure.get("LAYOUT"),
                "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            },
            "arqueo:source": args.source,
        },
        "assets": {
            "cog": {
                "href": args.output.name,
                "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                "roles": ["data"],
                "file:size": args.output.stat().st_size,
                "file:checksum": f"sha256:{sha256(args.output)}",
            }
        },
    }
    manifest_path.write_text(json.dumps(item, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"cog": str(args.output), "manifest": str(manifest_path), "overviews": overview_counts, "epsg": epsg}, ensure_ascii=False))


if __name__ == "__main__":
    main()
