"""Pure-Python tests of the document validation (run with `pytest`)."""

import importlib.util
import pathlib

import pytest

spec = importlib.util.spec_from_file_location(
    "validate", pathlib.Path(__file__).parents[1] / "custom_components" / "house_view" / "validate.py"
)
validate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate)


def terrain(n=3):
    return {"version": 1, "origin": [0, 0], "step": 1, "nx": n, "nz": n, "z": [100.0] * n * n, "center": [1, 1]}


def test_scene_ok():
    validate.validate_scene({"levels": [{"id": "l0", "elevation": 0, "rooms": []}], "lights": []})


@pytest.mark.parametrize(
    "doc",
    [
        None,
        [],
        {},
        {"levels": []},
        {"levels": [1]},
        {"levels": [{"id": "a", "elevation": 0, "rooms": {}}]},
        {"levels": [{"id": "a"}]},
        {"levels": [{"id": "a", "elevation": 0}], "lights": {}},
    ],
)
def test_scene_rejects(doc):
    with pytest.raises(ValueError):
        validate.validate_scene(doc)


def test_terrain_ok_with_surface():
    t = terrain()
    t["s"] = [101.0] * 9
    validate.validate_terrain(t)


def test_terrain_rejects():
    for mutate in (
        lambda t: t.update(version=2),
        lambda t: t.update(z=[1.0] * 4),
        lambda t: t.update(step=0),
        lambda t: t.update(nx=1),
        lambda t: t.update(center=[1]),
        lambda t: t.update(s=[1.0]),
        lambda t: t.update(z=["a"] * 9),
        lambda t: t.update(nx=2000, nz=2000, z=[]),
        lambda t: t.pop("z"),
    ):
        t = terrain()
        mutate(t)
        with pytest.raises(ValueError):
            validate.validate_terrain(t)


def test_edits():
    validate.validate_edits({"version": 1, "terrain": [], "outdoor": {}, "registration": {}})
    for bad in ({"terrain": {}}, {"outdoor": []}, {"views": {}}, {"registration": []}, [], None):
        with pytest.raises(ValueError):
            validate.validate_edits(bad)


def test_ortho_and_new_edit_lists():
    good = {"version": 1, "bbox": [0, 0, 10, 10], "lat": 43.4, "lon": 1.3, "mime": "image/jpeg", "data": "AA=="}
    validate.validate_ortho(good)
    for bad in (
        None,
        {**good, "version": 2},
        {**good, "bbox": [0, 0, 10]},
        {**good, "bbox": [10, 0, 0, 10]},
        {**good, "lat": "x"},
        {**good, "mime": "image/gif"},
        {**good, "data": ""},
    ):
        with pytest.raises(ValueError):
            validate.validate_ortho(bad)
    validate.validate_edits({"fences": [], "entities": [], "sensors": [], "panel": [], "zones": []})
    for key in ("fences", "entities", "sensors", "panel", "zones"):
        with pytest.raises(ValueError):
            validate.validate_edits({key: {}})
    validate.validate_edits(
        {"irrigation": {"lines": []}, "vacuum": {}, "room_areas": {}, "room_views": {}, "alarms": {}}
    )
    for key in ("irrigation", "vacuum", "room_areas", "room_views", "alarms"):
        with pytest.raises(ValueError):
            validate.validate_edits({key: []})
