"""Terrain around the house from worldwide open data, for the places the French services (ign.py) do not cover.

  - ground model (DTM): the Mapterhorn terrain tiles, which lay the open LiDAR surveys of many countries over a global
    30 m model; the Terrain Tiles of Mapzen hosted by AWS are the fallback. Both are Web Mercator tiles of altitudes
    in the Terrarium encoding, decoded with Pillow;
  - vectors: the OpenStreetMap buildings and roads, in one query to the Overpass API.

There is no surface model, cadastre or aerial photo here: those only exist country by country. The output is the
same terrain document as ign.py (grid in the plan frame), so the card does not care where it comes from.
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import re
from array import array
from collections.abc import Callable, Sequence
from typing import Any

import aiohttp
from PIL import Image, features

from .ign import (
    HEADERS,
    M_PER_DEG,
    NODATA,
    R_MERC,
    FetchError,
    FetchParams,
    Progress,
    build_terrain,
    from_lonlat,
    make_grid,
    merc_bbox,
    pick_building,
)

# (name, tile URL, zoom levels to try in turn: the finest one that exists here is kept)
MAPTERHORN = "Mapterhorn"
TERRAIN_TILES = "Terrain Tiles (Mapzen / AWS)"
TILE_SOURCES = (
    (MAPTERHORN, "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", (17, 16, 15, 14, 13, 12)),
    (TERRAIN_TILES, "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png", (15, 12)),
)
OVERPASS = "https://overpass-api.de/api/interpreter"
ATTRIBUTION = {
    MAPTERHORN: "Mapterhorn and its open-data sources (mapterhorn.com/attribution)",
    TERRAIN_TILES: "Terrain Tiles (Mapzen, registry.opendata.aws/terrain-tiles)",
    "osm": "© OpenStreetMap contributors (ODbL)",
}
MERC_HALF = math.pi * R_MERC  # half side of the Web Mercator square
MAX_TILES = 4  # tiles per side of the mosaic: more means a zoom far too fine for the window
LOCATE_REACH = 45.0  # extra window (m) so that the vectors still cover the grid once the house is located
MAX_SHAPES = 500
TILE_TIMEOUT = aiohttp.ClientTimeout(total=40)
OSM_TIMEOUT = aiohttp.ClientTimeout(total=60)
# Carriageway width (m) by OpenStreetMap road class, when the way has no usable `width` tag
ROAD_WIDTHS = {
    "motorway": 10.0,
    "trunk": 9.0,
    "primary": 7.0,
    "secondary": 6.5,
    "tertiary": 6.0,
    "unclassified": 5.0,
    "residential": 5.0,
    "living_street": 4.5,
    "pedestrian": 4.0,
    "service": 3.5,
    "track": 2.5,
    "cycleway": 2.0,
    "footway": 1.5,
    "path": 1.5,
    "bridleway": 1.5,
    "steps": 1.5,
}
Raster = tuple[tuple[float, float, float, float], int, Sequence[float]]


# ---------------------------------------------------------------------------- tiles (pure)


def tile_block(bbox: Sequence[float], z: int) -> tuple[int, int, int]:
    """Square block of tiles covering a Web Mercator window: (x of the west column, y of the north row, side)."""
    span = 2 * MERC_HALF / 2**z
    last = 2**z - 1

    def index(v: float) -> int:
        return min(max(int(v // span), 0), last)

    x0, x1 = index(bbox[0] + MERC_HALF), index(bbox[2] + MERC_HALF)
    y0, y1 = index(MERC_HALF - bbox[3]), index(MERC_HALF - bbox[1])
    n = max(x1 - x0, y1 - y0) + 1
    # the window is square, so the two ranges differ by one tile at most: widen the short one, inside the world
    return min(x0, last - n + 1), min(y0, last - n + 1), n


def decode_tile(raw: bytes) -> Image.Image | None:
    """A tile as a square RGB image, None when the bytes are not one (error page, unsupported format...)."""
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (OSError, ValueError, SyntaxError):
        return None
    return img.convert("RGB") if img.width == img.height and img.width >= 2 else None


def terrarium(img: Image.Image) -> array[float]:
    """Altitudes (m) of a Terrarium image: red * 256 + green + blue / 256 - 32768."""
    r, g, b = (band.tobytes() for band in img.split())
    return array("f", ((hi * 256 + lo + frac / 256) - 32768 for hi, lo, frac in zip(r, g, b, strict=True)))


def mosaic(tiles: Sequence[bytes], block: tuple[int, int, int], z: int, window: Sequence[float]) -> Raster | None:
    """Tiles of a block (row by row from the north-west) -> altitudes over the window, as a north-up square raster.

    None when a tile cannot be read, when the tiles differ in size or when there is mostly no data.
    """
    x0, y0, n = block
    images = [decode_tile(raw) for raw in tiles]
    if any(img is None for img in images) or len({img.width for img in images if img}) != 1:
        return None
    px = images[0].width  # type: ignore[union-attr]
    sheet = Image.new("RGB", (n * px, n * px))
    for k, img in enumerate(images):
        sheet.paste(img, ((k % n) * px, (k // n) * px))
    span = 2 * MERC_HALF / 2**z
    m = span / px  # Mercator meters per pixel
    west, north = x0 * span - MERC_HALF, MERC_HALF - y0 * span
    # square crop around the window: only what is needed gets decoded
    c0 = int((window[0] - west) // m)
    r0 = int((north - window[3]) // m)
    side = max(math.ceil((window[2] - west) / m) - c0, math.ceil((north - window[1]) / m) - r0, 2)
    side = min(side, n * px)
    c0 = min(max(c0, 0), n * px - side)
    r0 = min(max(r0, 0), n * px - side)
    vals = terrarium(sheet.crop((c0, r0, c0 + side, r0 + side)))
    probe = vals[:: max(1, len(vals) // 2000)]
    if sum(1 for v in probe if NODATA[0] < v < NODATA[1]) < 0.5 * len(probe):
        return None
    bbox = (west + c0 * m, north - (r0 + side) * m, west + (c0 + side) * m, north - r0 * m)
    return bbox, side, vals


def grid_step(pixel_m: float) -> float:
    """Grid resolution (m) worth the pixel size of the tiles: no need for a 0.5 m grid over a 30 m model."""
    if pixel_m <= 0.75:
        return 0.5
    return 1.0 if pixel_m <= 1.6 else 2.0


# ---------------------------------------------------------------------------- OpenStreetMap (pure)


def number(text: Any) -> float | None:
    """Leading number of a tag value: "7.5", "7,5 m", "2"... None when there is none."""
    found = re.match(r"\s*(\d+(?:[.,]\d+)?)", str(text))
    return float(found.group(1).replace(",", ".")) if found else None


def building_height(tags: dict[str, Any]) -> float | None:
    height = number(tags.get("height"))
    if height is None:
        levels = number(tags.get("building:levels"))
        height = levels * 3 if levels else None
    return round(height, 1) if height and 2 <= height <= 300 else None


def road_width(tags: dict[str, Any]) -> float | None:
    """Width of a road to draw, None for what is not one (tunnel, square, road under construction...)."""
    kind = str(tags.get("highway", "")).removesuffix("_link")
    if kind not in ROAD_WIDTHS or tags.get("tunnel") not in (None, "no") or tags.get("area") == "yes":
        return None
    width = number(tags.get("width"))
    return width if width and 1 <= width <= 30 else ROAD_WIDTHS[kind]


def _line(geometry: Any) -> list[tuple[float, float]]:
    return [(pt["lon"], pt["lat"]) for pt in geometry or [] if pt]


def osm_shapes(elements: Sequence[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Overpass elements (`out tags geom`) -> buildings and roads in lon/lat."""
    out: dict[str, list[dict[str, Any]]] = {"buildings": [], "roads": []}
    for el in elements:
        tags = el.get("tags") or {}
        if tags.get("building") not in (None, "no"):
            # a way is its own outline; a multipolygon relation gives it through its closed outer members
            outlines = [el.get("geometry")] if el.get("type") == "way" else []
            outlines += [m.get("geometry") for m in el.get("members") or [] if m.get("role") == "outer"]
            for outline in outlines:
                ring = _line(outline)
                if len(ring) >= 4 and ring[0] == ring[-1]:
                    out["buildings"].append({"ring": ring, "h": building_height(tags)})
        elif el.get("type") == "way" and (width := road_width(tags)) is not None:
            line = _line(el.get("geometry"))
            if len(line) >= 2:
                out["roads"].append({"line": line, "w": width, "nature": tags["highway"]})
    return {key: shapes[:MAX_SHAPES] for key, shapes in out.items()}


def locate_house(p: FetchParams, buildings: Sequence[dict[str, Any]]) -> float | None:
    """Snap (lat, lon) to the centroid of the building under / nearest to it; returns the move (m) or None."""
    k = M_PER_DEG * math.cos(math.radians(p.lat))

    def local(ring: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
        """Meters east / north of the point."""
        return [((lon - p.lon) * k, (lat - p.lat) * M_PER_DEG) for lon, lat in ring]

    features = [{"geometry": {"type": "Polygon", "coordinates": [local(b["ring"])]}} for b in buildings]
    found = pick_building(features, 0.0, 0.0)
    if found is None:
        return None
    p.lat, p.lon = round(p.lat + found[1] / M_PER_DEG, 7), round(p.lon + found[0] / k, 7)
    return math.hypot(*found)


def plan_vectors(shapes: dict[str, list[dict[str, Any]]], p: FetchParams) -> dict[str, list[dict[str, Any]]]:
    """Buildings and roads in the plan frame, as the card expects them (no cadastral parcels from OpenStreetMap)."""

    def conv(points: Sequence[tuple[float, float]]) -> list[list[float]]:
        return [from_lonlat(lon, lat, p.lat, p.lon, p.north, p.center) for lon, lat in points]

    return {
        "buildings": [{"poly": conv(b["ring"]), "h": b["h"]} for b in shapes["buildings"]],
        "roads": [{"pts": conv(r["line"]), "w": r["w"], "nature": r["nature"]} for r in shapes["roads"]],
        "parcels": [],
    }


def overpass_query(p: FetchParams, half_m: float) -> str:
    dlat = half_m / M_PER_DEG
    dlon = half_m / (M_PER_DEG * math.cos(math.radians(p.lat)))
    box = f"({p.lat - dlat:.6f},{p.lon - dlon:.6f},{p.lat + dlat:.6f},{p.lon + dlon:.6f})"
    wanted = f'way["building"]{box};relation["building"]{box};way["highway"]{box};'
    return f"[out:json][timeout:25];({wanted});out tags geom;"


# ---------------------------------------------------------------------------- network


async def fetch_tile(session: aiohttp.ClientSession, url: str) -> bytes | None:
    try:
        async with session.get(url, headers=HEADERS, timeout=TILE_TIMEOUT) as r:
            raw = await r.read()
            return raw if r.status == 200 and raw else None
    except (aiohttp.ClientError, TimeoutError):
        return None


async def fetch_mosaic(
    session: aiohttp.ClientSession, url: str, z: int, window: Sequence[float], run_sync: Callable[..., Any]
) -> Raster | None:
    """Altitudes over the window from one tile set at one zoom, None when a tile is missing or unusable."""
    x0, y0, n = block = tile_block(window, z)
    if n > MAX_TILES:
        return None
    urls = [url.format(z=z, x=x0 + i, y=y0 + j) for j in range(n) for i in range(n)]
    first = await fetch_tile(session, urls[0])  # one request tells whether this zoom exists here
    if first is None:
        return None
    rest = await asyncio.gather(*(fetch_tile(session, u) for u in urls[1:]))
    if any(raw is None for raw in rest):
        return None
    return await run_sync(mosaic, [first, *rest], block, z, window)


async def fetch_dtm(
    session: aiohttp.ClientSession, p: FetchParams, half_m: float, run_sync: Callable[..., Any]
) -> tuple[Raster, str, float] | None:
    """Finest ground model available here: (raster, name of the tile set, ground size of a pixel in meters)."""
    window = merc_bbox(p.lat, p.lon, half_m)
    for name, url, zooms in TILE_SOURCES:
        if url.endswith(".webp") and not features.check("webp"):
            continue  # this Pillow cannot read WebP images: no need to download them
        for z in zooms:
            raster = await fetch_mosaic(session, url, z, window, run_sync)
            if raster is not None:
                pixel_m = (raster[0][2] - raster[0][0]) / raster[1] * math.cos(math.radians(p.lat))
                return raster, name, pixel_m
    return None


async def fetch_osm(session: aiohttp.ClientSession, p: FetchParams, half_m: float) -> list[dict[str, Any]] | None:
    """Buildings and roads around the house, None when the Overpass API cannot answer."""
    try:
        async with session.post(
            OVERPASS, data={"data": overpass_query(p, half_m)}, headers=HEADERS, timeout=OSM_TIMEOUT
        ) as r:
            raw = await r.read()
            return list(json.loads(raw)["elements"]) if r.status == 200 else None
    except (aiohttp.ClientError, TimeoutError, ValueError, KeyError, TypeError):
        return None


async def fetch_all(
    session: aiohttp.ClientSession,
    p: FetchParams,
    run_sync: Callable[..., Any],
    progress: Progress,
) -> tuple[dict[str, Any], dict[str, Any] | None, list[str]]:
    """Same contract as ign.fetch_all: (terrain document, no texture, notes for the user)."""
    notes: list[str] = []
    half = p.size * 0.75  # raster window: covers the corners of the rotated grid
    shapes = None
    if p.locate or p.vectors:
        progress("locate" if p.locate else "vectors")
        elements = await fetch_osm(session, p, half + LOCATE_REACH)
        if elements is None:
            notes.append("OpenStreetMap did not answer: no buildings, no roads, house not located")
        else:
            shapes = await run_sync(osm_shapes, elements)
            if p.locate:
                moved = locate_house(p, shapes["buildings"])
                notes.append(
                    f"house located on an OpenStreetMap building ({moved:.1f} m away)"
                    if moved is not None
                    else "no OpenStreetMap building found near the point"
                )
    progress("dtm")
    found = await fetch_dtm(session, p, half, run_sync)
    if found is None:
        raise FetchError("No elevation data could be fetched (Mapterhorn and Terrain Tiles did not answer)")
    raster, name, pixel_m = found
    p.step = max(p.step, grid_step(pixel_m))
    source = f"{name}, {pixel_m:.1f} m per pixel"
    notes.append(source)
    if name != MAPTERHORN:
        notes.append("Mapterhorn had nothing usable here: coarser model used")
    grid = await run_sync(make_grid, p)
    terrain = await run_sync(build_terrain, p, grid, raster, None, source)
    credits = [ATTRIBUTION[name]]
    if p.vectors and shapes is not None:
        progress("vectors")
        vectors = await run_sync(plan_vectors, shapes, p)
        terrain.update(vectors)
        credits.append(ATTRIBUTION["osm"])
        notes.append(f"{len(vectors['buildings'])} buildings, {len(vectors['roads'])} roads (OpenStreetMap)")
    terrain["attribution"] = " · ".join(credits)
    notes.append("no surface model, cadastre or aerial photo from the worldwide sources")
    return terrain, None, notes
