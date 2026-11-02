#!/usr/bin/env python3
"""Gera dois GeoTIFFs sintéticos descartáveis para ensaios do pipeline raster.

Os arquivos representam uma cena RGB fictícia perto de Brasília, em EPSG:4326.
Não baixa, incorpora ou replica dados de terceiros.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from osgeo import gdal, osr


gdal.UseExceptions()


def create_scene(path: Path, variant: str) -> None:
    size = 2048
    driver = gdal.GetDriverByName("GTiff")
    dataset = driver.Create(
        str(path), size, size, 3, gdal.GDT_Byte,
        options=["TILED=YES", "BLOCKXSIZE=512", "BLOCKYSIZE=512", "COMPRESS=DEFLATE"],
    )
    dataset.SetGeoTransform((-48.10, 0.00012, 0, -15.60, 0, -0.00012))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    dataset.SetProjection(srs.ExportToWkt())

    y, x = np.mgrid[0:size, 0:size]
    r = ((x / size) * 180 + 35).astype(np.uint8)
    g = ((y / size) * 150 + 45).astype(np.uint8)
    b = (((x + y) / (2 * size)) * 130 + 55).astype(np.uint8)

    # Regiões sem imagem para validar propagação de NoData/máscara.
    nodata = ((x - 210) ** 2 + (y - 210) ** 2 < 115 ** 2) | ((x > 1770) & (y < 230))
    r[nodata] = 0
    g[nodata] = 0
    b[nodata] = 0

    if variant == "after":
        # Mudança sintética mensurável: uma área retangular clara e uma área circular escura.
        changed_rectangle = (x > 890) & (x < 1280) & (y > 820) & (y < 1210)
        changed_circle = (x - 1520) ** 2 + (y - 1410) ** 2 < 180 ** 2
        r[changed_rectangle] = 235
        g[changed_rectangle] = 210
        b[changed_rectangle] = 80
        r[changed_circle] = 35
        g[changed_circle] = 55
        b[changed_circle] = 175

    for index, data in enumerate((r, g, b), start=1):
        band = dataset.GetRasterBand(index)
        band.SetNoDataValue(0)
        band.WriteArray(data)
        band.FlushCache()

    dataset.SetMetadataItem("TIFFTAG_IMAGEDESCRIPTION", f"Cena sintética Grupo Arqueo: {variant}")
    dataset.FlushCache()
    dataset = None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    create_scene(args.output_dir / "before_raw_epsg4326.tif", "before")
    create_scene(args.output_dir / "after_raw_epsg4326.tif", "after")
    print(f"Rasters sintéticos criados em {args.output_dir}")


if __name__ == "__main__":
    main()
