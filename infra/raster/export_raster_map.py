#!/usr/bin/env python3
"""Exporta recorte local de COG para PNG+worldfile+PRJ e PDF com pixels raster reais.

O processo é offline/local. Bounds, tamanhos e paths são validados pelo serviço Node
antes da chamada e novamente aqui; o script não aceita URL ou comandos arbitrários.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from osgeo import gdal, osr

gdal.UseExceptions()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def identify_epsg(dataset: gdal.Dataset) -> int | None:
    srs = osr.SpatialReference()
    srs.ImportFromWkt(dataset.GetProjection())
    srs.AutoIdentifyEPSG()
    value = srs.GetAuthorityCode(None)
    return int(value) if value else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--west", required=True, type=float)
    parser.add_argument("--south", required=True, type=float)
    parser.add_argument("--east", required=True, type=float)
    parser.add_argument("--north", required=True, type=float)
    parser.add_argument("--width", required=True, type=int)
    parser.add_argument("--height", required=True, type=int)
    parser.add_argument("--expected-crs", default="EPSG:4674")
    parser.add_argument("--require-nodata", action="store_true")
    args = parser.parse_args()
    if not args.input.is_file(): raise SystemExit("COG de entrada não encontrado")
    if not (args.west < args.east and args.south < args.north): raise SystemExit("Bounds inválidos")
    if not (256 <= args.width <= 8192 and 256 <= args.height <= 8192 and args.width * args.height <= 33_554_432): raise SystemExit("Dimensão fora do limite local")
    source = gdal.Open(str(args.input), gdal.GA_ReadOnly)
    if source is None: raise SystemExit("GDAL não abriu o COG")
    expected_epsg = int(args.expected_crs.split(":", 1)[1])
    if identify_epsg(source) != expected_epsg: raise SystemExit("CRS de COG não autorizado")
    nodata = [source.GetRasterBand(index).GetNoDataValue() for index in range(1, source.RasterCount + 1)]
    if args.require_nodata and any(value is None for value in nodata): raise SystemExit("COG sem NoData declarado")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    png = args.output_dir / "map.png"
    pdf = args.output_dir / "map.pdf"
    options = gdal.TranslateOptions(
        projWin=[args.west, args.north, args.east, args.south],
        width=args.width, height=args.height,
    )
    gdal.Translate(str(png), source, options=gdal.TranslateOptions(
        format="PNG", projWin=[args.west, args.north, args.east, args.south], width=args.width, height=args.height,
        creationOptions=["WORLDFILE=YES"],
    ))
    gdal.Translate(str(pdf), source, options=gdal.TranslateOptions(
        format="PDF", projWin=[args.west, args.north, args.east, args.south], width=args.width, height=args.height,
        creationOptions=["DPI=150"],
    ))
    source = None
    prj = args.output_dir / "map.prj"
    srs = osr.SpatialReference(); srs.ImportFromEPSG(expected_epsg)
    prj.write_text(srs.ExportToWkt() + "\n")
    worldfiles = [candidate for candidate in [args.output_dir / "map.wld", args.output_dir / "map.pgw"] if candidate.is_file()]
    if not png.is_file() or not pdf.is_file() or not prj.is_file() or not worldfiles: raise SystemExit("Exportação incompleta")
    image = gdal.Open(str(png), gdal.GA_ReadOnly)
    if image is None or image.RasterXSize != args.width or image.RasterYSize != args.height: raise SystemExit("PNG exportado não tem dimensão esperada")
    image = None
    report = {
        "kind": "raster-real-pixel-export",
        "crs": args.expected_crs,
        "nodata": nodata,
        "bounds": {"west": args.west, "south": args.south, "east": args.east, "north": args.north},
        "size": {"width": args.width, "height": args.height},
        "files": {"png": {"name": png.name, "sha256": sha256(png)}, "worldfile": {"name": worldfiles[0].name, "sha256": sha256(worldfiles[0])}, "prj": {"name": prj.name, "sha256": sha256(prj)}, "pdf": {"name": pdf.name, "sha256": sha256(pdf)}},
    }
    (args.output_dir / "export.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
