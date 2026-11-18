"""Terrain fetcher (cartes.gouv.fr / IGN): pure geometry and the whole fetch against mocked services."""

import math
from array import array

import aiohttp
import pytest

from custom_components.house_view import ign

LAT, LON = 43.6045, 1.4440  # Place du Capitole, Toulouse (a public place, not a home)


def params(**kw):
    d = {"lat": LAT, "lon": LON, "center": [10, -5], "north": 15, "size": 20}
    d.update(kw)
    return ign.FetchParams.from_json(d)


def bil(px, value=150.0, swap=False):
    a = array("f", [value + (i % px) * 0.01 for i in range(px * px)])
    if swap:
        a.byteswap()
    return a.tobytes()


def square(lon, lat, half_m):
    """Closed Web Mercator square around (lon, lat)."""
    x, y = ign.merc(lon, lat)
    h = half_m / math.cos(math.radians(lat))
    return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]]


def feature(geom_type, coords, **props):
    return {"type": "Feature", "geometry": {"type": geom_type, "coordinates": coords}, "properties": props}


async def run_sync(fn, *args):
    return fn(*args)


# ---------------------------------------------------------------------------- pure functions


def test_lonlat_roundtrip_and_mercator():
    lon, lat = ign.to_lonlat(12.0, -7.0, LAT, LON, 30)
    assert ign.from_lonlat(lon, lat, LAT, LON, 30, (100, 200)) == pytest.approx([112.0, 193.0], abs=0.02)
    assert ign.unmerc(*ign.merc(LON, LAT)) == pytest.approx((LON, LAT))
    x0, y0, x1, y1 = ign.merc_bbox(LAT, LON, 50)
    assert (x1 - x0) * math.cos(math.radians(LAT)) == pytest.approx(100)
    assert y1 > y0


def test_rings_point_in_ring_centroid():
    sq = [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]
    assert ign.rings({"type": "Polygon", "coordinates": [sq, [[1, 1]]]}) == [sq]
    assert ign.rings({"type": "MultiPolygon", "coordinates": [[sq], [sq]]}) == [sq, sq]
    assert ign.rings({"type": "LineString", "coordinates": sq}) == [sq]
    assert ign.rings({"type": "MultiLineString", "coordinates": [sq]}) == [sq]
    assert ign.rings({"type": "Point", "coordinates": [0, 0]}) == []
    assert ign.rings(None) == []
    assert ign.point_in_ring(1, 1, sq)
    assert not ign.point_in_ring(5, 1, sq)
    assert ign.centroid(sq) == pytest.approx((2, 1))
    assert ign.centroid([[0, 0], [2, 0], [4, 0]]) == pytest.approx((2, 0))  # degenerate: vertex mean


def test_pick_building():
    x, y = ign.merc(LON, LAT)
    inside = feature("Polygon", [square(LON, LAT, 5)])
    near = feature("Polygon", [[[x + 20, y], [x + 24, y], [x + 24, y + 4], [x + 20, y]]])
    far = feature("Polygon", [[[x + 500, y], [x + 504, y], [x + 504, y + 4], [x + 500, y]]])
    tiny = feature("LineString", [[x, y], [x + 1, y]])
    assert ign.pick_building([tiny, far, inside], x, y) == pytest.approx((x, y))
    c = ign.pick_building([near, far], x, y)
    assert c[0] > x + 20
    assert ign.pick_building([far], x, y) is None


def test_decode_bil_and_sample():
    assert ign.decode_bil(b"\0" * 10, 4) is None
    vals = ign.decode_bil(bil(4, 200.0, swap=True), 4)  # foreign byte order is detected
    assert vals[0] == pytest.approx(200.0)
    assert ign.decode_bil(array("f", [9e9] * 16).tobytes(), 4) is None  # implausible either way
    bbox = ign.merc_bbox(LAT, LON, 10)
    flat = [123.0] * 16
    assert ign.sample(bbox, 4, flat, LON, LAT) == pytest.approx(123.0)
    assert ign.sample(bbox, 4, flat, LON + 1, LAT + 1) == pytest.approx(123.0)  # clamped to the edge


def test_fill_nodata():
    assert ign.fill_nodata([1.0, None, 3.0]) == [1.0, 2.0, 3.0]
    with pytest.raises(ign.FetchError):
        ign.fill_nodata([None, None])


def test_params_validation():
    p = params()
    assert p.center == (10.0, -5.0)
    assert p.photo == "ortho"
    assert p.locate
    for bad in ({"lat": None}, {"lat": 95}, {"size": 5}, {"photo": "satellite"}, {"center": [1]}):
        with pytest.raises(ValueError):
            params(**bad)
    with pytest.raises(ValueError):
        ign.FetchParams.from_json({"lon": 1})


def test_build_terrain_and_vectors():
    p = params()
    grid = ign.make_grid(p)
    assert grid.n == 41
    assert len(grid.lonlat) == 41 * 41
    bbox = ign.merc_bbox(LAT, LON, 15)
    mnt = (bbox, 4, [150.0] * 16)
    mns = (bbox, 4, [-99999.0] * 8 + [160.0] * 8)  # half no-data: falls back to the ground
    t = ign.build_terrain(p, grid, mnt, mns, "test")
    assert t["nx"] == t["nz"] == 41
    assert t["center"] == [10.0, -5.0]
    assert set(t["s"]) <= {150.0, 160.0}
    assert "s" not in ign.build_terrain(p, grid, mnt, None, "test")
    raw = {
        "buildings": [feature("Polygon", [square(LON, LAT, 5)], hauteur=7)],
        "roads": [feature("MultiLineString", [square(LON, LAT, 9)[:2]], largeur_de_chaussee=None, nature="Route")],
        "parcels": [
            feature(
                "Polygon", [[[LON, LAT], [LON + 1e-4, LAT], [LON, LAT + 1e-4], [LON, LAT]]], section="AB", numero="12"
            )
        ],
    }
    v = ign.vector_layers(raw, p, apicarto=True)
    assert v["buildings"][0]["h"] == 7
    assert v["roads"][0]["w"] == 4
    assert v["parcels"][0]["id"] == "AB12"
    assert v["parcels"][0]["poly"][0] == pytest.approx([10, -5], abs=0.05)  # lon/lat -> plan center


# ---------------------------------------------------------------------------- whole fetch against mocked services


def wms(layer):
    return f"{ign.WMS}?LAYERS={layer}"


def wfs(layer, count=300):
    return f"{ign.WFS}?TYPENAMES={layer}&COUNT={count}"


async def test_fetch_all_lidar_photo_vectors(hass, aioclient_mock):
    p = params(photo="ortho")
    px = round(2 * p.size * 0.75 / 0.5)
    house = feature("Polygon", [square(LON + 0.00005, LAT, 6)], hauteur=6)
    aioclient_mock.get(wfs(ign.L_BUILD, 50), json={"features": [house]})
    aioclient_mock.get(wms(ign.LIDAR_MNT), content=bil(px, 150.0))
    aioclient_mock.get(wms(ign.LIDAR_MNS), content=bil(px, 158.0))
    aioclient_mock.get(wfs(ign.L_BUILD), json={"features": [house]})
    aioclient_mock.get(
        wfs(ign.L_ROAD), json={"features": [feature("LineString", square(LON, LAT, 9)[:3], largeur_de_chaussee=5)]}
    )
    aioclient_mock.get(
        wfs(ign.L_PARCEL), json={"features": [feature("Polygon", [square(LON, LAT, 12)], section="AB", numero="1")]}
    )
    aioclient_mock.get(wms("ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO"), status=400, text="<ServiceException/>")
    aioclient_mock.get(wms("ORTHOIMAGERY.ORTHOPHOTOS"), content=b"\xff\xd8jpeg")  # second name tried
    steps = []
    session = aioclient_mock.create_session(hass.loop)
    terrain, photo, notes = await ign.fetch_all(session, p, run_sync, steps.append)
    assert steps == ["locate", "dtm", "dsm", "vectors", "photo"]
    assert terrain["source"].startswith("IGN LiDAR HD")
    assert "Licence Ouverte" in terrain["attribution"]
    assert terrain["lon"] != LON  # snapped on the building
    assert min(terrain["s"]) >= 158
    assert len(terrain["roads"]) == 1
    assert terrain["parcels"][0]["id"] == "AB1"
    assert photo["kind"] == "ortho"
    assert photo["mime"] == "image/jpeg"
    assert photo["data"]
    assert any("located" in n for n in notes)
    await session.close()


async def test_fetch_all_fallbacks(hass, aioclient_mock):
    p = params(size=40, photo="plan")
    px = round(2 * p.size * 0.75 / 1.0)
    lidar_px = round(2 * p.size * 0.75 / 0.5)
    aioclient_mock.get(wfs(ign.L_BUILD, 50), json={"features": []})
    half_empty = array("f", [150.0 if i % 2 else -99999.0 for i in range(lidar_px * lidar_px)]).tobytes()
    aioclient_mock.get(wms(ign.LIDAR_MNT), content=half_empty)  # LiDAR HD not out yet: mostly no data
    aioclient_mock.get(wms(ign.RGE_ALTI), content=bil(px, 140.0))
    aioclient_mock.get(wms(ign.LIDAR_MNS), status=404)
    aioclient_mock.get(wfs(ign.L_BUILD), text="<xml/>")
    aioclient_mock.get(wfs(ign.L_ROAD), exc=aiohttp.ClientError())
    aioclient_mock.get(wfs(ign.L_PARCEL), json={"features": []})
    aioclient_mock.get(
        ign.APICARTO_PARCELS,
        json={
            "features": [
                feature(
                    "Polygon", [[[LON, LAT], [LON + 1e-4, LAT], [LON, LAT + 1e-4], [LON, LAT]]], section="B", numero="7"
                )
            ]
        },
    )
    aioclient_mock.get(wms("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2"), text="<ServiceException/>")
    session = aioclient_mock.create_session(hass.loop)
    terrain, photo, notes = await ign.fetch_all(session, p, run_sync, lambda s: None)
    assert terrain["source"] == "IGN RGE ALTI 1 m"
    assert terrain["step"] == 1.0
    assert "s" not in terrain
    assert terrain["parcels"][0]["id"] == "B7"
    assert terrain["buildings"] == []
    assert photo is None
    assert "no building found near the point" in notes
    assert "no surface model (DSM) here" in notes
    assert "ground texture unavailable" in notes
    await session.close()


async def test_fetch_all_minimal_and_errors(hass, aioclient_mock):
    p = params(locate=False, mns=False, vectors=False, photo="none")
    px = round(2 * p.size * 0.75 / 0.5)
    aioclient_mock.get(wms(ign.LIDAR_MNT), content=bil(px, 150.0))
    session = aioclient_mock.create_session(hass.loop)
    terrain, photo, _ = await ign.fetch_all(session, p, run_sync, lambda s: None)
    assert photo is None
    assert "parcels" not in terrain
    aioclient_mock.clear_requests()
    aioclient_mock.get(wms(ign.LIDAR_MNT), exc=TimeoutError())
    aioclient_mock.get(wms(ign.RGE_ALTI), status=500)
    with pytest.raises(ign.FetchError):
        await ign.fetch_all(session, params(locate=False), run_sync, lambda s: None)
    await session.close()


async def test_network_errors_are_soft(hass, aioclient_mock):
    p = params()
    aioclient_mock.get(ign.WMS, exc=aiohttp.ClientError())
    aioclient_mock.get(ign.APICARTO_PARCELS, text="not json")
    session = aioclient_mock.create_session(hass.loop)
    assert await ign.fetch_image(session, "ortho", p, 150) is None
    assert await ign.fetch_apicarto_parcels(session, p, 30) == []
    aioclient_mock.clear_requests()
    aioclient_mock.get(ign.APICARTO_PARCELS, exc=aiohttp.ClientError())
    assert await ign.fetch_apicarto_parcels(session, p, 30) == []
    aioclient_mock.clear_requests()
    aioclient_mock.get(ign.WFS, json={"no": "features"})
    assert await ign.fetch_wfs(session, ign.L_ROAD, (0, 0, 1, 1)) == []
    await session.close()
