"""Terrain around the house from the French national geodata services (IGN Géoplateforme, cartes.gouv.fr).

Port of the prototype script `tools/fetch_terrain.py`, run inside Home Assistant:
  - ground model (DTM): LiDAR HD 0.5 m, falling back to RGE ALTI 1 m, both through WMS as raw 32-bit floats;
  - surface model (DSM, roofs and trees): LiDAR HD MNS, used by the card to register the plan and find the trees;
  - vectors (WFS): BD TOPO buildings and roads, cadastral parcels (API Carto as a fallback);
  - ground texture: aerial photo or IGN map (WMS image, Web Mercator) draped by the card on the terrain.

The grid is expressed in the plan frame (meters, x east / z south of the plan, rotated by the plan compass), centered on
the plan center that sits at (lat, lon). Network calls are async (aiohttp); the number crunching is pure and synchronous
so it can run in an executor.
"""

from __future__ import annotations

import base64
import json
import math
import re
from array import array
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import aiohttp

WMS = "https://data.geopf.fr/wms-r"
WFS = "https://data.geopf.fr/wfs/ows"
APICARTO_PARCELS = "https://apicarto.ign.fr/api/cadastre/parcelle"
LIDAR_MNT = "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"  # LiDAR HD ground, 0.5 m
LIDAR_MNS = "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"  # LiDAR HD surface, 0.5 m
RGE_ALTI = "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES"  # RGE ALTI ground, 1 m (where LiDAR HD is not out yet)
PHOTO_LAYERS = {  # layer names to try in turn, format
    "ortho": (("ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO", "ORTHOIMAGERY.ORTHOPHOTOS"), "image/jpeg"),
    "plan": (("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",), "image/png"),
}
L_BUILD = "BDTOPO_V3:batiment"
L_ROAD = "BDTOPO_V3:troncon_de_route"
L_PARCEL = "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle"
M_PER_DEG = 111320.0
R_MERC = 6378137.0
NODATA = (-500.0, 5000.0)  # plausible altitudes; anything else is "no data"
TIMEOUT = aiohttp.ClientTimeout(total=120)
HEADERS = {"User-Agent": "home-assistant-house-view (+https://github.com/elwinmage/ha-house-view-component)"}
PROVIDERS = ("auto", "ign", "world")
ATTRIBUTION = "IGN, Géoplateforme cartes.gouv.fr (Licence Ouverte 2.0)"


class FetchError(Exception):
    """The terrain could not be fetched (message shown to the user)."""


# ---------------------------------------------------------------------------- geometry (pure)


def to_lonlat(dx: float, dz: float, lat0: float, lon0: float, north_deg: float) -> tuple[float, float]:
    """Plan offset (m, x east / z south of the plan) -> (lon, lat). north_deg: clockwise angle from plan up to north."""
    a = math.radians(north_deg)
    east = dx * math.cos(a) + dz * math.sin(a)
    nrth = dx * math.sin(a) - dz * math.cos(a)
    return lon0 + east / (M_PER_DEG * math.cos(math.radians(lat0))), lat0 + nrth / M_PER_DEG


def from_lonlat(  # noqa: PLR0913 - mirror of to_lonlat plus the plan center
    lon: float, lat: float, lat0: float, lon0: float, north_deg: float, center: Sequence[float]
) -> list[float]:
    """Inverse of to_lonlat, plus the plan center: (lon, lat) -> plan point [x, z]."""
    a = math.radians(north_deg)
    east = (lon - lon0) * M_PER_DEG * math.cos(math.radians(lat0))
    nrth = (lat - lat0) * M_PER_DEG
    return [
        round(center[0] + east * math.cos(a) + nrth * math.sin(a), 2),
        round(center[1] + east * math.sin(a) - nrth * math.cos(a), 2),
    ]


def merc(lon: float, lat: float) -> tuple[float, float]:
    """WGS84 -> Web Mercator (EPSG:3857)."""
    return math.radians(lon) * R_MERC, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R_MERC


def unmerc(x: float, y: float) -> tuple[float, float]:
    """Web Mercator -> (lon, lat)."""
    return math.degrees(x / R_MERC), math.degrees(2 * math.atan(math.exp(y / R_MERC)) - math.pi / 2)


def merc_bbox(lat0: float, lon0: float, half_m: float) -> tuple[float, float, float, float]:
    """Square Web Mercator window of +/- half_m ground meters (Mercator meters are 1/cos(lat) longer)."""
    cx, cy = merc(lon0, lat0)
    half = half_m / math.cos(math.radians(lat0))
    return cx - half, cy - half, cx + half, cy + half


def rings(geom: dict[str, Any] | None) -> list[list[list[float]]]:
    """Outer rings of a (Multi)Polygon or the lines of a (Multi)LineString."""
    if not geom:
        return []
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Polygon":
        return [c[0]]
    if t == "MultiPolygon":
        return [poly[0] for poly in c]
    if t == "LineString":
        return [c]
    if t == "MultiLineString":
        return list(c)
    return []


def point_in_ring(x: float, y: float, ring: Sequence[Sequence[float]]) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[i - 1][0], ring[i - 1][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def centroid(ring: Sequence[Sequence[float]]) -> tuple[float, float]:
    """Area centroid of a ring (vertex mean for degenerate rings)."""
    a = cx = cy = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i - 1][0], ring[i - 1][1]
        x2, y2 = ring[i][0], ring[i][1]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return cx / (3 * a), cy / (3 * a)


def pick_building(features: list[dict[str, Any]], x: float, y: float) -> tuple[float, float] | None:
    """Web Mercator centroid of the building under (x, y), else of the nearest one (within 40 Mercator meters)."""
    best: tuple[float, float] | None = None
    best_d = 40.0
    for f in features:
        for ring in rings(f.get("geometry")):
            if len(ring) < 3:
                continue
            c = centroid(ring)
            if point_in_ring(x, y, ring):
                return c
            d = math.hypot(c[0] - x, c[1] - y)
            if d < best_d:
                best, best_d = c, d
    return best


def decode_bil(raw: bytes, px: int) -> list[float] | None:
    """Raw 32-bit float raster: the byte order is not documented, keep the one that gives plausible altitudes."""
    if len(raw) != px * px * 4:
        return None
    for swap in (False, True):
        vals = array("f")
        vals.frombytes(raw)
        if swap:
            vals.byteswap()
        probe = vals[:: max(1, len(vals) // 2000)]
        # the wrong byte order gives denormal "altitudes" (~1e-41) that look plausible: reject them too
        if sum(1 for v in probe if NODATA[0] < v < NODATA[1] and (v == 0 or abs(v) > 1e-6)) > 0.3 * len(probe):
            return vals.tolist()
    return None


def sample(bbox: Sequence[float], px: int, vals: Sequence[float], lon: float, lat: float) -> float:
    """Bilinear sample of a north-up Web Mercator raster (row 0 = north edge)."""
    x, y = merc(lon, lat)
    fx = min(max((x - bbox[0]) / (bbox[2] - bbox[0]) * px - 0.5, 0), px - 1.001)
    fy = min(max((bbox[3] - y) / (bbox[3] - bbox[1]) * px - 0.5, 0), px - 1.001)
    i, j = int(fx), int(fy)
    u, v = fx - i, fy - j
    k = j * px + i
    top = vals[k] * (1 - u) + vals[k + 1] * u
    bot = vals[k + px] * (1 - u) + vals[k + px + 1] * u
    return top * (1 - v) + bot * v


@dataclass
class FetchParams:
    """What the card asks for (see the setup panel)."""

    lat: float
    lon: float
    center: tuple[float, float]  # plan coordinates (m) of the point at (lat, lon): the plan center
    north: float = 0.0  # plan compass (degrees)
    size: float = 120.0  # grid side (m)
    step: float = 0.5  # grid resolution (m)
    mns: bool = True
    vectors: bool = True
    locate: bool = True  # snap (lat, lon) to the building under / nearest to the point
    photo: str = "ortho"  # ortho | plan | none
    provider: str = "auto"  # auto | ign | world (see sources.py)

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> FetchParams:
        try:
            p = cls(
                lat=float(d["lat"]),
                lon=float(d["lon"]),
                center=(float(d["center"][0]), float(d["center"][1])),
                north=float(d.get("north", 0)),
                size=float(d.get("size", 120)),
                mns=bool(d.get("mns", True)),
                vectors=bool(d.get("vectors", True)),
                locate=bool(d.get("locate", True)),
                photo=str(d.get("photo", "ortho")),
                provider=str(d.get("provider", "auto")),
            )
        except (KeyError, TypeError, ValueError, IndexError) as err:
            raise ValueError(f"invalid fetch parameters: {err}") from err
        if not (-90 <= p.lat <= 90 and -180 <= p.lon <= 180):
            raise ValueError("lat / lon out of range")
        if not 20 <= p.size <= 300:
            raise ValueError("size must be between 20 and 300 m")
        if p.photo not in (*PHOTO_LAYERS, "none"):
            raise ValueError("photo must be ortho, plan or none")
        if p.provider not in PROVIDERS:
            raise ValueError("provider must be auto, ign or world")
        return p


@dataclass
class Grid:
    """Grid points (plan frame) and their lon/lat."""

    origin: tuple[float, float]
    n: int
    lonlat: list[tuple[float, float]] = field(default_factory=list)


def make_grid(p: FetchParams) -> Grid:
    n = round(p.size / p.step) + 1
    x0, z0 = p.center[0] - p.size / 2, p.center[1] - p.size / 2
    ll = [
        to_lonlat(x0 + i * p.step - p.center[0], z0 + j * p.step - p.center[1], p.lat, p.lon, p.north)
        for j in range(n)
        for i in range(n)
    ]
    return Grid((x0, z0), n, ll)


def sample_grid(grid: Grid, raster: tuple[Sequence[float], int, Sequence[float]]) -> list[float | None]:
    bbox, px, vals = raster
    out: list[float | None] = []
    for lon, lat in grid.lonlat:
        z = sample(bbox, px, vals, lon, lat)
        out.append(round(z, 2) if NODATA[0] < z < NODATA[1] else None)
    return out


def fill_nodata(zs: list[float | None]) -> list[float]:
    valid = [z for z in zs if z is not None]
    if not valid:
        raise FetchError("No valid altitude at this place")
    mean = round(sum(valid) / len(valid), 2)
    return [mean if z is None else z for z in zs]


def vector_layers(
    raw: dict[str, list[dict[str, Any]]], p: FetchParams, apicarto: bool
) -> dict[str, list[dict[str, Any]]]:
    """WFS features (Web Mercator, or lon/lat for API Carto parcels) -> plan-frame polygons and lines."""

    def conv(ring: list[list[float]], lonlat: bool = False) -> list[list[float]]:
        return [
            from_lonlat(*((x, y) if lonlat else unmerc(x, y)), p.lat, p.lon, p.north, p.center) for x, y, *_ in ring
        ]

    out: dict[str, list[dict[str, Any]]] = {"buildings": [], "roads": [], "parcels": []}
    for f in raw.get("buildings", []):
        for r in rings(f.get("geometry")):
            out["buildings"].append({"poly": conv(r), "h": (f.get("properties") or {}).get("hauteur")})
    for f in raw.get("roads", []):
        pr = f.get("properties") or {}
        for r in rings(f.get("geometry")):
            out["roads"].append({"pts": conv(r), "w": pr.get("largeur_de_chaussee") or 4, "nature": pr.get("nature")})
    for f in raw.get("parcels", []):
        pr = f.get("properties") or {}
        for r in rings(f.get("geometry")):
            out["parcels"].append(
                {"poly": conv(r, lonlat=apicarto), "id": f"{pr.get('section', '')}{pr.get('numero', '')}"}
            )
    return out


def build_terrain(
    p: FetchParams,
    grid: Grid,
    mnt: tuple[Sequence[float], int, Sequence[float]],
    mns: tuple[Sequence[float], int, Sequence[float]] | None,
    source: str,
) -> dict[str, Any]:
    """Terrain document (version 1) understood by the card."""
    zs = fill_nodata(sample_grid(grid, mnt))
    doc: dict[str, Any] = {
        "version": 1,
        "origin": list(grid.origin),
        "step": p.step,
        "nx": grid.n,
        "nz": grid.n,
        "z": zs,
        "center": list(p.center),
        "source": source,
        "lat": p.lat,
        "lon": p.lon,
        "north": p.north,
    }
    if mns:
        doc["s"] = [z if s is None else round(max(s, z), 2) for s, z in zip(sample_grid(grid, mns), zs, strict=True)]
    return doc


# ---------------------------------------------------------------------------- network


async def _get(session: aiohttp.ClientSession, url: str, params: dict[str, Any]) -> tuple[int, bytes]:
    async with session.get(url, params=params, headers=HEADERS, timeout=TIMEOUT) as r:
        return r.status, await r.read()


async def fetch_raster(
    session: aiohttp.ClientSession, layer: str, p: FetchParams, half_m: float, res: float
) -> tuple[tuple[float, float, float, float], int, list[float]] | None:
    """One WMS GetMap of raw floats around the house, or None when the layer has nothing usable here."""
    bbox = merc_bbox(p.lat, p.lon, half_m)
    px = round(2 * half_m / res)
    q = {
        "SERVICE": "WMS",
        "VERSION": "1.3.0",
        "REQUEST": "GetMap",
        "LAYERS": layer,
        "STYLES": "",
        "CRS": "EPSG:3857",
        "BBOX": ",".join(f"{v:.3f}" for v in bbox),
        "WIDTH": px,
        "HEIGHT": px,
        "FORMAT": "image/x-bil;bits=32",
    }
    try:
        status, raw = await _get(session, WMS, q)
    except (aiohttp.ClientError, TimeoutError):
        return None
    vals = decode_bil(raw, px) if status == 200 else None
    return (bbox, px, vals) if vals else None


async def fetch_image(
    session: aiohttp.ClientSession, kind: str, p: FetchParams, half_m: float, errors: list[str] | None = None
) -> dict[str, Any] | None:
    """Aerial photo or IGN map over the same window, as a texture document for the card.

    Each layer is tried at full size, then at a smaller one (some layers refuse large images); the reason of the
    last refusal goes into errors, so that the user sees why the ground has no texture.
    """
    layers, mime = PHOTO_LAYERS[kind]
    bbox = merc_bbox(p.lat, p.lon, half_m)
    sizes = (2048, 1024) if half_m > 100 else (1536, 1024)
    raw = b""
    reason = ""
    for layer in layers:
        for px in sizes:
            q = {
                "SERVICE": "WMS",
                "VERSION": "1.3.0",
                "REQUEST": "GetMap",
                "LAYERS": layer,
                "STYLES": "",
                "CRS": "EPSG:3857",
                "BBOX": ",".join(f"{v:.3f}" for v in bbox),
                "WIDTH": px,
                "HEIGHT": px,
                "FORMAT": mime,
            }
            try:
                status, raw = await _get(session, WMS, q)
            except (aiohttp.ClientError, TimeoutError) as err:
                reason = f"{layer}: {type(err).__name__}"
                continue
            if status == 200 and raw.startswith((b"\xff\xd8", b"\x89PNG")):  # an XML error page otherwise
                break
            reason = f"{layer}: HTTP {status} {_wms_error(raw)}".rstrip()
        else:
            continue
        break
    else:
        if errors is not None and reason:
            errors.append(reason)
        return None
    return {
        "version": 1,
        "kind": kind,
        "mime": mime,
        "bbox": list(bbox),
        "lat": p.lat,
        "lon": p.lon,
        "north": p.north,
        "center": list(p.center),
        "data": base64.b64encode(raw).decode("ascii"),
    }


def _wms_error(raw: bytes) -> str:
    """Text of a WMS ServiceException (or the start of whatever came back), on one short line."""
    text = raw[:2000].decode("utf-8", "replace")
    m = re.search(r"<(?:\w+:)?ServiceException\b[^>]*>(.*?)</", text, re.S)
    msg = re.sub(r"<[^>]+>", " ", m.group(1) if m else text)
    return " ".join(msg.split())[:160]


async def fetch_wfs(
    session: aiohttp.ClientSession, layer: str, bbox: Sequence[float], count: int = 300
) -> list[dict[str, Any]]:
    q = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": layer,
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:3857",
        "BBOX": ",".join(f"{v:.3f}" for v in bbox) + ",EPSG:3857",
        "COUNT": count,
    }
    try:
        status, raw = await _get(session, WFS, q)
        return json.loads(raw)["features"] if status == 200 else []
    except (aiohttp.ClientError, TimeoutError, ValueError, KeyError, TypeError):
        return []


async def fetch_apicarto_parcels(session: aiohttp.ClientSession, p: FetchParams, half_m: float) -> list[dict[str, Any]]:
    """Fallback for parcels: API Carto cadastre (GeoJSON in lon/lat)."""
    dlat = half_m / M_PER_DEG
    dlon = half_m / (M_PER_DEG * math.cos(math.radians(p.lat)))
    box = [
        [p.lon - dlon, p.lat - dlat],
        [p.lon + dlon, p.lat - dlat],
        [p.lon + dlon, p.lat + dlat],
        [p.lon - dlon, p.lat + dlat],
    ]
    geom = {"type": "Polygon", "coordinates": [[*box, box[0]]]}
    try:
        status, raw = await _get(session, APICARTO_PARCELS, {"geom": json.dumps(geom), "_limit": 500})
        return json.loads(raw).get("features", []) if status == 200 else []
    except (aiohttp.ClientError, TimeoutError, ValueError, AttributeError):
        return []


async def locate_house(session: aiohttp.ClientSession, p: FetchParams) -> float | None:
    """Snap (lat, lon) to the centroid of the building under / nearest to it; returns the move (m) or None."""
    x, y = merc(p.lon, p.lat)
    half = 40 / math.cos(math.radians(p.lat))
    found = pick_building(await fetch_wfs(session, L_BUILD, (x - half, y - half, x + half, y + half), 50), x, y)
    if not found:
        return None
    lon, lat = unmerc(*found)
    moved = math.hypot((lon - p.lon) * M_PER_DEG * math.cos(math.radians(p.lat)), (lat - p.lat) * M_PER_DEG)
    p.lat, p.lon = round(lat, 7), round(lon, 7)
    return moved


Progress = Callable[[str], None]


async def fetch_all(
    session: aiohttp.ClientSession,
    p: FetchParams,
    run_sync: Callable[..., Any],
    progress: Progress,
) -> tuple[dict[str, Any], dict[str, Any] | None, list[str]]:
    """Everything the card needs: (terrain document, texture document or None, notes for the user).

    run_sync(fn, *args) runs CPU work off the event loop (hass.async_add_executor_job).
    """
    notes: list[str] = []
    if p.locate:
        progress("locate")
        moved = await locate_house(session, p)
        notes.append(
            f"house located on a BD TOPO building ({moved:.1f} m away)"
            if moved is not None
            else "no building found near the point"
        )
    half = p.size * 0.75  # raster window: covers the corners of the rotated grid
    progress("dtm")
    mnt = await fetch_raster(session, LIDAR_MNT, p, half, 0.5)
    source = "IGN LiDAR HD MNT 0.5 m"
    if mnt is not None and sum(1 for v in mnt[2][::97] if NODATA[0] < v < NODATA[1]) < 0.8 * len(mnt[2][::97]):
        mnt = None  # LiDAR HD not published here yet: mostly no-data
    if mnt is None:
        p.step = max(p.step, 1.0)
        mnt = await fetch_raster(session, RGE_ALTI, p, half, 1.0)
        source = "IGN RGE ALTI 1 m"
    if mnt is None:
        raise FetchError("No elevation data for this place (only metropolitan France is covered)")
    notes.append(source)
    mns = None
    if p.mns:
        progress("dsm")
        mns = await fetch_raster(session, LIDAR_MNS, p, half, 0.5)
        if mns is None:
            notes.append("no surface model (DSM) here")
    grid = await run_sync(make_grid, p)
    terrain = await run_sync(build_terrain, p, grid, mnt, mns, source)
    terrain["attribution"] = ATTRIBUTION
    if p.vectors:
        progress("vectors")
        bbox = merc_bbox(p.lat, p.lon, half)
        raw = {
            "buildings": await fetch_wfs(session, L_BUILD, bbox),
            "roads": await fetch_wfs(session, L_ROAD, bbox),
            "parcels": await fetch_wfs(session, L_PARCEL, bbox),
        }
        apicarto = False
        if not raw["parcels"]:
            raw["parcels"] = await fetch_apicarto_parcels(session, p, half)
            apicarto = True
        vec = vector_layers(raw, p, apicarto)
        terrain.update(vec)
        notes.append(f"{len(vec['buildings'])} buildings, {len(vec['roads'])} roads, {len(vec['parcels'])} parcels")
    photo = None
    if p.photo != "none":
        progress("photo")
        errors: list[str] = []
        photo = await fetch_image(session, p.photo, p, half, errors)
        if photo is None:
            notes.append("ground texture unavailable" + (f" ({errors[0]})" if errors else ""))
    return terrain, photo, notes
