#!/usr/bin/env python3
"""Renderizador local de Atlas a partir de COGs processados e overlays vetoriais autorizados.

O worker resolve todos os paths no volume fechado antes desta chamada. O script nunca
faz HTTP, não recebe URL externa e só desenha GeoJSON já limitado pelo servidor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A0, A1, A3, A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

SIZES = {"A4": A4, "A3": A3, "A1": A1, "A0": A0}
MAX_RENDER_PIXELS = 24_000_000


def cmd(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def hex_color(value: Any, fallback: str = "#1d4ed8") -> HexColor:
    text = str(value or fallback)
    if len(text) == 7 and text.startswith("#"):
        try:
            return HexColor(text)
        except ValueError:
            pass
    return HexColor(fallback)


def map_point(point: list[float], bounds: dict[str, float], x: float, y: float, width: float, height: float) -> tuple[float, float]:
    lon, lat = float(point[0]), float(point[1])
    px = x + (lon - bounds["west"]) / (bounds["east"] - bounds["west"]) * width
    py = y + (lat - bounds["south"]) / (bounds["north"] - bounds["south"]) * height
    return px, py


def draw_line(pdf: canvas.Canvas, points: list[list[float]], bounds: dict[str, float], x: float, y: float, width: float, height: float) -> None:
    if len(points) < 2:
        return
    path = pdf.beginPath()
    first = map_point(points[0], bounds, x, y, width, height)
    path.moveTo(*first)
    for point in points[1:]:
        path.lineTo(*map_point(point, bounds, x, y, width, height))
    pdf.drawPath(path, stroke=1, fill=0)


def draw_polygon(pdf: canvas.Canvas, rings: list[list[list[float]]], bounds: dict[str, float], x: float, y: float, width: float, height: float) -> None:
    for ring in rings:
        if len(ring) < 3:
            continue
        path = pdf.beginPath()
        path.moveTo(*map_point(ring[0], bounds, x, y, width, height))
        for point in ring[1:]:
            path.lineTo(*map_point(point, bounds, x, y, width, height))
        path.close()
        pdf.drawPath(path, stroke=1, fill=1)


def draw_geometry(pdf: canvas.Canvas, geometry: dict[str, Any], bounds: dict[str, float], x: float, y: float, width: float, height: float) -> None:
    geo_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geo_type == "Point" and isinstance(coordinates, list) and len(coordinates) >= 2:
        px, py = map_point(coordinates, bounds, x, y, width, height)
        pdf.circle(px, py, 2.4, stroke=1, fill=1)
    elif geo_type == "MultiPoint" and isinstance(coordinates, list):
        for point in coordinates:
            draw_geometry(pdf, {"type": "Point", "coordinates": point}, bounds, x, y, width, height)
    elif geo_type == "LineString" and isinstance(coordinates, list):
        draw_line(pdf, coordinates, bounds, x, y, width, height)
    elif geo_type == "MultiLineString" and isinstance(coordinates, list):
        for line in coordinates:
            draw_line(pdf, line, bounds, x, y, width, height)
    elif geo_type == "Polygon" and isinstance(coordinates, list):
        draw_polygon(pdf, coordinates, bounds, x, y, width, height)
    elif geo_type == "MultiPolygon" and isinstance(coordinates, list):
        for polygon in coordinates:
            draw_polygon(pdf, polygon, bounds, x, y, width, height)


def draw_overlays(pdf: canvas.Canvas, overlays: list[dict[str, Any]], bounds: dict[str, float], x: float, y: float, width: float, height: float) -> int:
    features = 0
    for overlay in overlays:
        color = hex_color(overlay.get("color"))
        pdf.setStrokeColor(color)
        pdf.setFillColor(Color(color.red, color.green, color.blue, alpha=max(0.0, min(0.85, float(overlay.get("fillOpacity", 0.2))))))
        pdf.setLineWidth(max(0.5, min(4.0, float(overlay.get("weight", 2)) * 0.6)))
        collection = overlay.get("data") or {}
        for feature in collection.get("features", []):
            geometry = feature.get("geometry") if isinstance(feature, dict) else None
            if isinstance(geometry, dict):
                draw_geometry(pdf, geometry, bounds, x, y, width, height)
                features += 1
    return features


def nice_distance(value: float) -> float:
    if value <= 0:
        return 1.0
    power = 10 ** math.floor(math.log10(value))
    scaled = value / power
    if scaled >= 5:
        return 5 * power
    if scaled >= 2:
        return 2 * power
    return power


def draw_scale(pdf: canvas.Canvas, bounds: dict[str, float], x: float, y: float, width: float) -> None:
    latitude = (bounds["north"] + bounds["south"]) / 2
    width_m = (bounds["east"] - bounds["west"]) * 111_320 * max(0.1, math.cos(math.radians(latitude)))
    distance_m = nice_distance(width_m / 4)
    length = max(20, min(width * 0.34, width * distance_m / max(width_m, 1)))
    base_y = y + 10 * mm
    pdf.setStrokeColor(HexColor("#111827"))
    pdf.setFillColor(HexColor("#111827"))
    pdf.setLineWidth(1)
    pdf.line(x + 8 * mm, base_y, x + 8 * mm + length, base_y)
    pdf.line(x + 8 * mm, base_y - 2 * mm, x + 8 * mm, base_y + 2 * mm)
    pdf.line(x + 8 * mm + length, base_y - 2 * mm, x + 8 * mm + length, base_y + 2 * mm)
    label = f"{distance_m / 1000:g} km" if distance_m >= 1000 else f"{distance_m:g} m"
    pdf.setFont("Helvetica", 6.5)
    pdf.drawCentredString(x + 8 * mm + length / 2, base_y + 3 * mm, label)


def draw_legend(pdf: canvas.Canvas, overlays: list[dict[str, Any]], x: float, y: float, width: float, height: float) -> None:
    items = [item for item in overlays if item.get("includeInLegend")]
    if not items:
        return
    row = 5.5 * mm
    box_h = min(height * 0.35, (len(items) + 1) * row + 6 * mm)
    box_w = min(width * 0.34, 65 * mm)
    box_x = x + width - box_w - 4 * mm
    box_y = y + height - box_h - 4 * mm
    pdf.setFillColor(Color(1, 1, 1, alpha=0.88))
    pdf.setStrokeColor(HexColor("#4b5563"))
    pdf.roundRect(box_x, box_y, box_w, box_h, 2 * mm, fill=1, stroke=1)
    pdf.setFillColor(HexColor("#111827"))
    pdf.setFont("Helvetica-Bold", 7)
    pdf.drawString(box_x + 3 * mm, box_y + box_h - 5 * mm, "Legenda")
    for index, item in enumerate(items[:20]):
        line_y = box_y + box_h - (index + 2) * row
        pdf.setFillColor(hex_color(item.get("color")))
        pdf.rect(box_x + 3 * mm, line_y, 4 * mm, 2.5 * mm, fill=1, stroke=1)
        pdf.setFillColor(HexColor("#1f2937"))
        pdf.setFont("Helvetica", 6.5)
        pdf.drawString(box_x + 9 * mm, line_y + 0.2 * mm, str(item.get("name") or "Camada")[:45])


def draw_index_page(pdf: canvas.Canvas, pages: list[dict[str, Any]], title: str, crs: str, page_w: float, page_h: float) -> None:
    margin = 18 * mm
    header = 28 * mm
    pdf.setFillColorRGB(0.06, 0.12, 0.20)
    pdf.rect(0, page_h - header, page_w, header, fill=1, stroke=0)
    pdf.setFillColorRGB(1, 1, 1)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(margin, page_h - 12 * mm, title[:120])
    pdf.setFont("Helvetica", 8)
    pdf.drawString(margin, page_h - 20 * mm, f"Índice de folhas · CRS {crs}")
    grid_x, grid_y = margin, margin + 20 * mm
    grid_w, grid_h = page_w - margin * 2, page_h - header - margin * 2 - 20 * mm
    west = min(page["bounds"]["west"] for page in pages)
    east = max(page["bounds"]["east"] for page in pages)
    south = min(page["bounds"]["south"] for page in pages)
    north = max(page["bounds"]["north"] for page in pages)
    pdf.setStrokeColor(HexColor("#374151"))
    pdf.rect(grid_x, grid_y, grid_w, grid_h, fill=0, stroke=1)
    for index, page in enumerate(pages, 1):
        bounds = page["bounds"]
        x = grid_x + (bounds["west"] - west) / (east - west) * grid_w
        y = grid_y + (bounds["south"] - south) / (north - south) * grid_h
        w = (bounds["east"] - bounds["west"]) / (east - west) * grid_w
        h = (bounds["north"] - bounds["south"]) / (north - south) * grid_h
        pdf.setFillColor(Color(0.12, 0.35, 0.55, alpha=0.18))
        pdf.setStrokeColor(HexColor("#1d4ed8"))
        pdf.rect(x, y, w, h, fill=1, stroke=1)
        pdf.setFillColor(HexColor("#111827"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawCentredString(x + w / 2, y + h / 2, str(index))
    pdf.setFont("Helvetica", 7)
    pdf.setFillColor(HexColor("#374151"))
    pdf.drawString(margin, 12 * mm, f"{len(pages)} folha(s) · Índice gerado localmente a partir da área de cobertura")
    pdf.showPage()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pages-json", required=True)
    parser.add_argument("--overlays-json", required=True)
    parser.add_argument("--page-size", choices=SIZES.keys(), default="A4")
    parser.add_argument("--orientation", choices=["portrait", "landscape"], default="landscape")
    parser.add_argument("--title", required=True)
    parser.add_argument("--crs", default="EPSG:4674")
    parser.add_argument("--scale", type=int, required=True)
    parser.add_argument("--raster-width", type=int, required=True)
    parser.add_argument("--raster-height", type=int, required=True)
    parser.add_argument("--show-north", choices=["0", "1"], default="1")
    parser.add_argument("--show-frame", choices=["0", "1"], default="1")
    parser.add_argument("--show-legend", choices=["0", "1"], default="1")
    parser.add_argument("--show-scale", choices=["0", "1"], default="1")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    pages = json.loads(Path(args.pages_json).read_text(encoding="utf-8"))
    overlays = json.loads(Path(args.overlays_json).read_text(encoding="utf-8"))
    if not isinstance(pages, list) or not pages or len(pages) > 50:
        raise ValueError("Lista de páginas inválida")
    if not isinstance(overlays, list) or len(overlays) > 20:
        raise ValueError("Overlays vetoriais inválidos")
    if not input_path.is_file():
        raise ValueError("COG de entrada não encontrado")
    if args.raster_width < 512 or args.raster_height < 512 or args.raster_width * args.raster_height > MAX_RENDER_PIXELS:
        raise ValueError("Perfil de resolução excede o orçamento de pixels")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    size = SIZES[args.page_size]
    page_w, page_h = (size if args.orientation == "portrait" else (size[1], size[0]))
    pdf = canvas.Canvas(str(output_path), pagesize=(page_w, page_h))
    draw_index_page(pdf, pages, args.title, args.crs, page_w, page_h)
    evidence: list[dict[str, Any]] = []

    for index, page in enumerate(pages, 1):
        bounds = page.get("bounds", {})
        required = ("west", "south", "east", "north")
        if not all(isinstance(bounds.get(key), (int, float)) for key in required):
            raise ValueError("Bounds inválidos")
        west, south, east, north = (float(bounds[key]) for key in required)
        if not west < east or not south < north:
            raise ValueError("Bounds sem extensão positiva")
        numeric_bounds = {"west": west, "south": south, "east": east, "north": north}
        png = output_path.parent / f"folha-{index:03d}.png"
        cmd("gdal_translate", "-q", "-projwin", str(west), str(north), str(east), str(south), "-outsize", str(args.raster_width), str(args.raster_height), "-of", "PNG", str(input_path), str(png))

        margin = 14 * mm
        header = 22 * mm
        footer = 16 * mm
        map_x, map_y = margin, margin + footer
        map_w, map_h = page_w - margin * 2, page_h - margin * 2 - header - footer
        pdf.setFillColorRGB(0.06, 0.12, 0.20)
        pdf.rect(0, page_h - header, page_w, header, fill=1, stroke=0)
        pdf.setFillColorRGB(1, 1, 1)
        pdf.setFont("Helvetica-Bold", 13)
        pdf.drawString(margin, page_h - 10 * mm, args.title[:120])
        pdf.setFont("Helvetica", 8)
        pdf.drawRightString(page_w - margin, page_h - 10 * mm, f"Folha {index:02d}/{len(pages):02d}")
        pdf.drawImage(str(png), map_x, map_y, width=map_w, height=map_h, preserveAspectRatio=True, anchor="c")
        overlay_features = draw_overlays(pdf, overlays, numeric_bounds, map_x, map_y, map_w, map_h)
        if args.show_frame == "1":
            pdf.setStrokeColorRGB(0.15, 0.15, 0.15)
            pdf.rect(map_x, map_y, map_w, map_h, fill=0, stroke=1)
        if args.show_legend == "1":
            draw_legend(pdf, overlays, map_x, map_y, map_w, map_h)
        if args.show_scale == "1":
            draw_scale(pdf, numeric_bounds, map_x, map_y, map_w)
        pdf.setFillColorRGB(0.1, 0.1, 0.1)
        pdf.setFont("Helvetica", 7)
        pdf.drawString(margin, 9 * mm, f"CRS: {args.crs} · Escala nominal 1:{args.scale:,}".replace(",", "."))
        pdf.drawRightString(page_w - margin, 9 * mm, f"BBOX {west:.6f}, {south:.6f}, {east:.6f}, {north:.6f}")
        if args.show_north == "1":
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawRightString(page_w - margin - 4 * mm, page_h - header - 5 * mm, "N ↑")
        pdf.showPage()
        evidence.append({"page": index, "bounds": bounds, "png": png.name, "sha256": hashlib.sha256(png.read_bytes()).hexdigest(), "bytes": png.stat().st_size, "overlayFeatures": overlay_features})

    pdf.save()
    pdf_bytes = output_path.read_bytes()
    print(json.dumps({"indexPage": True, "pages": evidence, "pdf": {"path": output_path.name, "sha256": hashlib.sha256(pdf_bytes).hexdigest(), "bytes": len(pdf_bytes)}, "profile": {"pageSize": args.page_size, "width": args.raster_width, "height": args.raster_height, "pixels": args.raster_width * args.raster_height}, "overlays": len(overlays)}))


if __name__ == "__main__":
    main()
