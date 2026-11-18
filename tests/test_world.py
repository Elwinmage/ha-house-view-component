"""Worldwide terrain fetcher (Mapterhorn / Terrain Tiles + OpenStreetMap) and the choice of the provider."""

import io
import math
import re

import aiohttp
import pytest
from PIL import Image

from custom_components.house_view import ign, sources, world
from custom_components.house_view.validate import VALIDATORS

LAT, LON = 52.3731, 4.8926  # Dam square, Amsterdam (a public place, not a home)
MAPTERHORN, AWS = world.TILE_SOURCES[0][1], world.TILE_SOURCES[1][1]
ANY_MAPTERHORN = re.compile(r"https://tiles\.mapterhorn\.com/.*")
ANY_AWS = re.compile(r"https://s3\.amazonaws\.com/elevation-tiles-prod/.*")


def params(**kw):
    d = {"lat": LAT, "lon": LON, "center": [10, -5], "north": 15, "size": 40}
    d.update(kw)
    return ign.FetchParams.from_json(d)


def tile(px=32, base=200.0, slope=0.0, fmt="WEBP"):
    """Terrarium tile: altitude = base + slope * column."""
    img = Image.new("RGB", (px, px))
    pixels = []
    for _row in range(px):
        for col in range(px):
            v = base + slope * col + 32768
            pixels.append((int(v // 256), int(v % 256), int((v % 1) * 256)))
    img.putdata(pixels)
    buf = io.BytesIO()
    img.save(buf, fmt, lossless=True)
    return buf.getvalue()


def window(half_m=30.0, lat=LAT, lon=LON):
    return ign.merc_bbox(lat, lon, half_m)


def mock_tiles(mock, url, z, win, content=None, **kw):
    """Register every tile of the block covering the window; returns the block."""
    x0, y0, n = block = world.tile_block(win, z)
    for j in range(n):
        for i in range(n):
            mock.get(url.format(z=z, x=x0 + i, y=y0 + j), content=content, **kw)
    return block


def way(tags, points, kind="way"):
    return {"type": kind, "id": 1, "tags": tags, "geometry": [{"lon": lon, "lat": lat} for lon, lat in points]}


def box(lon, lat, half_m=5.0):
    """Closed lon/lat square of 2 * half_m meters."""
    dlat = half_m / ign.M_PER_DEG
    dlon = dlat / math.cos(math.radians(lat))
    return [
        (lon - dlon, lat - dlat),
        (lon + dlon, lat - dlat),
        (lon + dlon, lat + dlat),
        (lon - dlon, lat + dlat),
        (lon - dlon, lat - dlat),
    ]


def east(meters, lat=LAT):
    return meters / (ign.M_PER_DEG * math.cos(math.radians(lat)))


async def run_sync(fn, *args):
    return fn(*args)


# ---------------------------------------------------------------------------- tiles (pure)


def test_tile_block():
    span = 2 * world.MERC_HALF / 2**17
    x, y = ign.merc(LON, LAT)
    tx, ty = int((x + world.MERC_HALF) // span), int((world.MERC_HALF - y) // span)
    west, north = tx * span - world.MERC_HALF, world.MERC_HALF - ty * span
    inside = (west + 10, north - 60, west + 60, north - 10)
    assert world.tile_block(inside, 17) == (tx, ty, 1)
    # same tile as the usual "slippy map" formulas, written independently
    phi = math.radians(LAT)
    assert tx == int((LON + 180) / 360 * 2**17)
    assert ty == int((1 - math.log(math.tan(phi) + 1 / math.cos(phi)) / math.pi) / 2 * 2**17)
    # across a tile edge on one axis only: the block stays square
    assert world.tile_block((west - 10, north - 60, west + 40, north - 10), 17) == (tx - 1, ty, 2)
    assert world.tile_block((west + 10, north - 20, west + 60, north + 30), 17) == (tx, ty - 1, 2)
    # in the last column of the world, a block of two is pushed back inside
    last = 2**17 - 1
    assert world.tile_block((world.MERC_HALF - 80, north - 30, world.MERC_HALF - 10, north + 30), 17) == (
        last - 1,
        ty - 1,
        2,
    )
    # a window that sticks out of the world is clamped
    assert world.tile_block((-world.MERC_HALF - 500, north - 60, -world.MERC_HALF + 10, north - 10), 17) == (0, ty, 1)


def test_decode_tile_and_terrarium():
    img = world.decode_tile(tile(8, base=123.5, slope=0.25))
    assert img.size == (8, 8)
    vals = world.terrarium(img)
    assert len(vals) == 64
    assert vals[0] == pytest.approx(123.5)
    assert vals[3] == pytest.approx(124.25)
    assert world.terrarium(world.decode_tile(tile(4, base=-12.0, fmt="PNG")))[0] == pytest.approx(-12.0)
    assert world.decode_tile(b"<html>not found</html>") is None
    whole = tile(16, slope=0.37, fmt="PNG")
    assert world.decode_tile(whole[: len(whole) // 2]) is None  # truncated
    wide = io.BytesIO()
    Image.new("RGB", (8, 4)).save(wide, "PNG")
    assert world.decode_tile(wide.getvalue()) is None


def test_mosaic_crops_the_window():
    z, px = 17, 32
    span = 2 * world.MERC_HALF / 2**z
    block = (1000, 2000, 2)
    west, north = 1000 * span - world.MERC_HALF, world.MERC_HALF - 2000 * span
    tiles = [tile(px, 100.0), tile(px, 200.0), tile(px, 300.0), tile(px, 400.0)]  # NW, NE, SW, SE
    win = (west + 0.9 * span, north - 1.1 * span, west + 1.1 * span, north - 0.9 * span)  # around the block center
    bbox, side, vals = world.mosaic(tiles, block, z, win)
    assert bbox[0] <= win[0]
    assert bbox[1] <= win[1]
    assert bbox[2] >= win[2]
    assert bbox[3] >= win[3]
    assert side < 2 * px  # cropped: only the window is decoded
    assert len(vals) == side * side
    assert vals[0] == pytest.approx(100.0)  # north-west corner
    assert vals[side - 1] == pytest.approx(200.0)
    assert vals[-side] == pytest.approx(300.0)
    assert vals[-1] == pytest.approx(400.0)
    lon, lat = ign.unmerc(west + 1.05 * span, north - 1.05 * span)
    assert ign.sample(bbox, side, vals, lon, lat) == pytest.approx(400.0)

    # a window wider than the block is cut to the block
    bbox, side, _ = world.mosaic(tiles, block, z, (west - span, north - 3 * span, west + 3 * span, north + span))
    assert side == 2 * px
    assert bbox == pytest.approx((west, north - 2 * span, west + 2 * span, north))
    # a tiny window still gives a raster that can be interpolated
    assert world.mosaic(tiles, block, z, (west + 1, north - 2, west + 2, north - 1))[1] == 2

    assert world.mosaic([tile(px), b"junk", tile(px), tile(px)], block, z, win) is None
    assert world.mosaic([tile(px), tile(16), tile(px), tile(px)], block, z, win) is None  # sizes differ
    assert world.mosaic([tile(px, -32768.0)] * 4, block, z, win) is None  # no data: black tiles


def test_grid_step():
    assert world.grid_step(0.4) == 0.5
    assert world.grid_step(0.85) == 1.0
    assert world.grid_step(1.7) == 2.0
    assert world.grid_step(13.0) == 2.0


# ---------------------------------------------------------------------------- OpenStreetMap (pure)


def test_tag_values():
    assert world.number("7.5") == 7.5
    assert world.number(" 7,5 m") == 7.5
    assert world.number(3) == 3.0
    assert world.number("wide") is None
    assert world.number(None) is None
    assert world.building_height({"height": "8.25 m"}) == 8.2
    assert world.building_height({"building:levels": "2"}) == 6.0
    assert world.building_height({"height": "0.5"}) is None  # not plausible
    assert world.building_height({"building:levels": "0"}) is None
    assert world.building_height({}) is None
    assert world.road_width({"highway": "residential"}) == 5.0
    assert world.road_width({"highway": "primary_link"}) == 7.0
    assert world.road_width({"highway": "service", "width": "3,2 m"}) == 3.2
    assert world.road_width({"highway": "service", "width": "120"}) == 3.5  # absurd width: class default
    assert world.road_width({"highway": "residential", "tunnel": "yes"}) is None
    assert world.road_width({"highway": "residential", "tunnel": "no"}) == 5.0
    assert world.road_width({"highway": "pedestrian", "area": "yes"}) is None
    assert world.road_width({"highway": "proposed"}) is None
    assert world.road_width({}) is None


def test_osm_shapes(monkeypatch):
    house = box(LON, LAT)
    open_line = house[:3]
    elements = [
        way({"building": "house", "height": "7"}, house),
        way({"building": "yes"}, open_line),  # not closed: ignored
        way({"building": "no"}, house),
        {
            "type": "relation",
            "tags": {"building": "apartments", "building:levels": "4"},
            "members": [
                {"role": "outer", "geometry": [{"lon": lon, "lat": lat} for lon, lat in house]},
                {"role": "inner", "geometry": [{"lon": lon, "lat": lat} for lon, lat in house]},
                {"role": "outer", "geometry": [{"lon": lon, "lat": lat} for lon, lat in open_line]},
                {"role": "outer"},
            ],
        },
        way({"highway": "residential", "name": "Dam"}, [(LON, LAT), (LON + 1e-4, LAT)]),
        {"type": "way", "tags": {"highway": "footway"}, "geometry": [None, {"lon": LON, "lat": LAT}]},  # one point
        way({"highway": "motorway", "tunnel": "yes"}, [(LON, LAT), (LON + 1e-4, LAT)]),
        {"type": "relation", "tags": {"highway": "residential"}, "members": []},  # route relation: not a road to draw
        {"type": "node", "id": 5},
    ]
    shapes = world.osm_shapes(elements)
    assert [b["h"] for b in shapes["buildings"]] == [7.0, 12.0]
    assert shapes["buildings"][0]["ring"] == house
    assert shapes["roads"] == [{"line": [(LON, LAT), (LON + 1e-4, LAT)], "w": 5.0, "nature": "residential"}]
    monkeypatch.setattr(world, "MAX_SHAPES", 1)
    assert len(world.osm_shapes(elements)["buildings"]) == 1


def test_locate_house_and_plan_vectors():
    p = params()
    shapes = {
        "buildings": [
            {"ring": box(LON + east(12), LAT, 5), "h": 6.0},
            {"ring": box(LON - east(30), LAT, 5), "h": None},
        ],
        "roads": [{"line": [(LON, LAT), (LON + east(20), LAT)], "w": 5.0, "nature": "residential"}],
    }
    assert world.locate_house(p, shapes["buildings"]) == pytest.approx(12.0, abs=0.05)
    assert p.lon == pytest.approx(LON + east(12), abs=1e-6)
    assert p.lat == pytest.approx(LAT, abs=1e-6)
    assert world.locate_house(p, shapes["buildings"]) == pytest.approx(0.0, abs=0.05)  # under the point now
    far = params()
    assert world.locate_house(far, [{"ring": box(LON + east(80), LAT, 5), "h": None}]) is None
    assert (far.lat, far.lon) == (LAT, LON)

    vec = world.plan_vectors(shapes, p)
    assert vec["parcels"] == []
    assert vec["buildings"][0]["h"] == 6.0
    xs = [x for x, _ in vec["buildings"][0]["poly"]]
    zs = [z for _, z in vec["buildings"][0]["poly"]]
    assert (min(xs) + max(xs)) / 2 == pytest.approx(p.center[0], abs=0.1)  # the house sits on the plan center
    assert (min(zs) + max(zs)) / 2 == pytest.approx(p.center[1], abs=0.1)
    assert vec["roads"][0]["w"] == 5.0
    assert len(vec["roads"][0]["pts"]) == 2


def test_overpass_query():
    q = world.overpass_query(params(), 100)
    assert q.startswith("[out:json]")
    assert q.endswith("out tags geom;")
    south, west, north, east_ = (float(v) for v in re.search(r"\(([-\d.,]+)\)", q).group(1).split(","))
    assert (north - south) * ign.M_PER_DEG == pytest.approx(200, abs=0.5)
    assert south < LAT < north
    assert west < LON < east_
    for wanted in ('way["building"]', 'relation["building"]', 'way["highway"]'):
        assert wanted in q


# ---------------------------------------------------------------------------- network


async def test_fetch_tile_and_mosaic(hass, aioclient_mock, monkeypatch):
    session = aioclient_mock.create_session(hass.loop)
    aioclient_mock.get("https://t/ok", content=b"abc")
    aioclient_mock.get("https://t/missing", status=404, content=b"nope")
    aioclient_mock.get("https://t/empty", content=b"")
    aioclient_mock.get("https://t/down", exc=aiohttp.ClientError())
    assert await world.fetch_tile(session, "https://t/ok") == b"abc"
    for name in ("missing", "empty", "down"):
        assert await world.fetch_tile(session, f"https://t/{name}") is None

    span = 2 * world.MERC_HALF / 2**17
    x, y = ign.merc(LON, LAT)
    corner = (x // span * span, y // span * span)  # a tile corner: the window around it needs four tiles
    win = (corner[0] - 20, corner[1] - 20, corner[0] + 20, corner[1] + 20)
    x0, y0, n = world.tile_block(win, 17)
    assert n == 2
    mock_tiles(aioclient_mock, MAPTERHORN, 17, win, content=tile(16, 3.0))
    _, side, vals = await world.fetch_mosaic(session, MAPTERHORN, 17, win, run_sync)
    assert vals[0] == pytest.approx(3.0)
    assert side <= 32

    aioclient_mock.clear_requests()
    aioclient_mock.get(MAPTERHORN.format(z=17, x=x0, y=y0), status=404)
    assert await world.fetch_mosaic(session, MAPTERHORN, 17, win, run_sync) is None  # nothing at this zoom here
    assert aioclient_mock.call_count == 1  # the first tile was enough to know

    aioclient_mock.clear_requests()
    aioclient_mock.get(MAPTERHORN.format(z=17, x=x0 + 1, y=y0 + 1), status=404)  # edge of the coverage
    mock_tiles(aioclient_mock, MAPTERHORN, 17, win, content=tile(16, 3.0))
    assert await world.fetch_mosaic(session, MAPTERHORN, 17, win, run_sync) is None

    monkeypatch.setattr(world, "MAX_TILES", 1)
    aioclient_mock.clear_requests()
    assert await world.fetch_mosaic(session, MAPTERHORN, 17, win, run_sync) is None  # too many tiles: not even asked
    assert aioclient_mock.call_count == 0
    await session.close()


async def test_fetch_dtm_takes_the_finest_zoom_then_the_fallback(hass, aioclient_mock, monkeypatch):
    session = aioclient_mock.create_session(hass.loop)
    p = params()
    win = ign.merc_bbox(p.lat, p.lon, 30)
    mock_tiles(aioclient_mock, MAPTERHORN, 16, win, content=tile(64, 12.0))
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    raster, name, pixel_m = await world.fetch_dtm(session, p, 30, run_sync)
    assert name == world.MAPTERHORN
    assert raster[2][0] == pytest.approx(12.0)
    span16 = 2 * world.MERC_HALF / 2**16 * math.cos(math.radians(LAT))
    assert pixel_m == pytest.approx(span16 / 64, rel=1e-3)

    aioclient_mock.clear_requests()
    aioclient_mock.get(ANY_MAPTERHORN, exc=TimeoutError())
    mock_tiles(aioclient_mock, AWS, 15, win, content=tile(64, 7.0, fmt="PNG"))
    raster, name, _ = await world.fetch_dtm(session, p, 30, run_sync)
    assert name == world.TERRAIN_TILES
    assert raster[2][0] == pytest.approx(7.0)

    aioclient_mock.clear_requests()
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    aioclient_mock.get(ANY_AWS, status=403)
    assert await world.fetch_dtm(session, p, 30, run_sync) is None

    # a Pillow without WebP: Mapterhorn is not even asked
    monkeypatch.setattr(world.features, "check", lambda _name: False)
    aioclient_mock.clear_requests()
    mock_tiles(aioclient_mock, AWS, 15, win, content=tile(64, 7.0, fmt="PNG"))
    assert (await world.fetch_dtm(session, p, 30, run_sync))[1] == world.TERRAIN_TILES
    assert all("mapterhorn" not in str(call[1]) for call in aioclient_mock.mock_calls)
    await session.close()


async def test_fetch_osm(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    p = params()
    aioclient_mock.post(world.OVERPASS, json={"elements": [{"type": "node"}]})
    assert await world.fetch_osm(session, p, 100) == [{"type": "node"}]
    assert "building" in aioclient_mock.mock_calls[0][2]["data"]
    for kw in (
        {"status": 429, "json": {"elements": []}},
        {"text": "<html>busy</html>"},
        {"json": {"remark": "runtime error"}},
        {"json": {"elements": 3}},
        {"exc": aiohttp.ClientError()},
    ):
        aioclient_mock.clear_requests()
        aioclient_mock.post(world.OVERPASS, **kw)
        assert await world.fetch_osm(session, p, 100) is None
    await session.close()


async def test_fetch_all(hass, aioclient_mock):
    session = aioclient_mock.create_session(hass.loop)
    p = params()
    house = box(LON + east(8), LAT, 5)
    elements = [way({"building": "house"}, house), way({"highway": "residential"}, [(LON, LAT), (LON + east(25), LAT)])]
    aioclient_mock.post(world.OVERPASS, json={"elements": elements})
    wide = ign.merc_bbox(LAT, LON, 60)  # also covers the window once the point has moved onto the house
    for z, px in ((17, 256), (16, 128)):
        mock_tiles(aioclient_mock, MAPTERHORN, z, wide, content=tile(px, 3.0, slope=0.01))
    steps = []
    terrain, photo, notes = await world.fetch_all(session, p, run_sync, steps.append)
    assert steps == ["locate", "dtm", "vectors"]
    assert photo is None
    VALIDATORS["terrain"](terrain)
    assert terrain["source"].startswith("Mapterhorn, 0.")
    assert terrain["step"] in (0.5, 1.0)
    assert terrain["lon"] == pytest.approx(LON + east(8), abs=1e-6)  # snapped on the building
    assert min(terrain["z"]) >= 3.0
    assert max(terrain["z"]) < 6.0
    assert "s" not in terrain
    assert len(terrain["buildings"]) == 1
    assert len(terrain["roads"]) == 1
    assert terrain["parcels"] == []
    assert "Mapterhorn" in terrain["attribution"]
    assert "OpenStreetMap" in terrain["attribution"]
    assert any("located on an OpenStreetMap building (8.0 m away)" in n for n in notes)
    assert "1 buildings, 1 roads (OpenStreetMap)" in notes
    assert p.lon != LON  # the caller's parameters follow the house

    # same place without moving the point: vectors only
    steps = []
    terrain, _, notes = await world.fetch_all(session, params(locate=False), run_sync, steps.append)
    assert steps == ["vectors", "dtm", "vectors"]
    assert terrain["lon"] == LON
    assert len(terrain["buildings"]) == 1
    assert not any("located" in n for n in notes)

    # OpenStreetMap down: the terrain still comes, from the fallback tiles here
    aioclient_mock.clear_requests()
    aioclient_mock.post(world.OVERPASS, status=504)
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    mock_tiles(aioclient_mock, AWS, 15, wide, content=tile(64, 3.0, fmt="PNG"))
    steps = []
    terrain, _, notes = await world.fetch_all(session, params(locate=False), run_sync, steps.append)
    assert steps == ["vectors", "dtm"]
    assert "buildings" not in terrain
    assert terrain["step"] == 2.0  # coarse model: no need for a fine grid
    assert terrain["attribution"] == world.ATTRIBUTION[world.TERRAIN_TILES]
    assert any("OpenStreetMap did not answer" in n for n in notes)
    assert "Mapterhorn had nothing usable here: coarser model used" in notes

    # no building near the point, vectors not wanted
    aioclient_mock.clear_requests()
    aioclient_mock.post(world.OVERPASS, json={"elements": []})
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    mock_tiles(aioclient_mock, AWS, 15, wide, content=tile(64, 3.0, fmt="PNG"))
    terrain, _, notes = await world.fetch_all(session, params(vectors=False), run_sync, lambda s: None)
    assert "no OpenStreetMap building found near the point" in notes
    assert "roads" not in terrain

    # nothing asked from OpenStreetMap; no tiles at all
    aioclient_mock.clear_requests()
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    mock_tiles(aioclient_mock, AWS, 15, wide, content=tile(64, 3.0, fmt="PNG"))
    steps = []
    await world.fetch_all(session, params(locate=False, vectors=False), run_sync, steps.append)
    assert steps == ["dtm"]
    aioclient_mock.clear_requests()
    aioclient_mock.get(ANY_MAPTERHORN, status=404)
    aioclient_mock.get(ANY_AWS, exc=aiohttp.ClientError())
    with pytest.raises(ign.FetchError, match="No elevation data"):
        await world.fetch_all(session, params(locate=False, vectors=False), run_sync, lambda s: None)
    await session.close()


# ---------------------------------------------------------------------------- choice of the provider


def test_provider_order():
    assert sources.order("ign", "US", 0, 0) == ["ign"]
    assert sources.order("world", "FR", 43.6, 1.4) == ["world"]
    assert sources.order("auto", "FR", 43.6, 1.4) == ["ign", "world"]
    assert sources.order("auto", "re", -21.1, 55.5) == ["ign", "world"]  # La Réunion
    assert sources.order("auto", "NL", LAT, LON) == ["world"]
    assert sources.order("auto", "CH", 46.2, 6.1) == ["world"]  # Geneva: inside the box, but the country is known
    assert sources.order("auto", None, 43.6, 1.4) == ["ign", "world"]
    assert sources.order("auto", None, LAT, LON) == ["world"]
    with pytest.raises(ValueError, match="provider"):
        params(provider="mars")
    assert params(provider="world").provider == "world"
    assert params().provider == "auto"


async def test_provider_fallback(monkeypatch):
    calls = []

    def provider(name, result):
        async def fetch_all(session, p, run_sync, progress):
            calls.append((name, p.lat))
            p.lat += 1  # a provider moves the point onto the house: the next one must start from the original
            if isinstance(result, Exception):
                raise result
            return {"from": name}, None, [f"{name} ok"]

        return fetch_all

    async def run(country, **kw):
        calls.clear()
        return await sources.fetch_all(None, params(**kw), country, run_sync, lambda s: None)

    monkeypatch.setattr(ign, "fetch_all", provider("ign", None))
    monkeypatch.setattr(world, "fetch_all", provider("world", None))
    assert await run("FR") == ({"from": "ign"}, None, ["ign ok"])
    assert calls == [("ign", LAT)]
    assert (await run("NL"))[0] == {"from": "world"}
    assert (await run("FR", provider="world"))[0] == {"from": "world"}

    monkeypatch.setattr(ign, "fetch_all", provider("ign", ign.FetchError("no data here")))
    terrain, _, notes = await run("FR")
    assert terrain == {"from": "world"}
    assert notes == ["French services: no data here; worldwide sources used instead", "world ok"]
    assert calls == [("ign", LAT), ("world", LAT)]
    with pytest.raises(ign.FetchError, match="no data here"):
        await run("FR", provider="ign")

    monkeypatch.setattr(world, "fetch_all", provider("world", ign.FetchError("tiles down")))
    with pytest.raises(ign.FetchError, match="tiles down"):
        await run("FR")
