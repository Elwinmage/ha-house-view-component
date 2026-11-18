"""Validation of the uploaded documents (pure functions, no Home Assistant dependency)."""

from __future__ import annotations

from numbers import Real
from typing import Any

MAX_TERRAIN_POINTS = 1_000_000  # e.g. 1000 x 1000 cells


def _is_num(v: Any) -> bool:
    return isinstance(v, Real) and not isinstance(v, bool)


def validate_scene(doc: Any) -> None:
    """Raise ValueError when `doc` is not a usable scene."""
    if not isinstance(doc, dict):
        raise ValueError("scene must be an object")
    levels = doc.get("levels")
    if not isinstance(levels, list) or not levels:
        raise ValueError("scene.levels must be a non-empty list")
    for i, lv in enumerate(levels):
        if not isinstance(lv, dict):
            raise ValueError(f"scene.levels[{i}] must be an object")
        if "id" not in lv or not _is_num(lv.get("elevation")):
            raise ValueError(f"scene.levels[{i}] needs an id and a numeric elevation")
        if not isinstance(lv.get("rooms", []), list):
            raise ValueError(f"scene.levels[{i}].rooms must be a list")
    for key in ("openings", "lights", "furniture", "vegetation", "outdoor"):
        if key in doc and not isinstance(doc[key], list):
            raise ValueError(f"scene.{key} must be a list")


def validate_terrain(doc: Any) -> None:
    """Raise ValueError when `doc` is not a version 1 terrain grid."""
    if not isinstance(doc, dict) or doc.get("version") != 1:
        raise ValueError("terrain must be an object with version 1")
    nx, nz, step = doc.get("nx"), doc.get("nz"), doc.get("step")
    if not (isinstance(nx, int) and isinstance(nz, int) and nx >= 2 and nz >= 2):
        raise ValueError("terrain.nx / nz must be integers >= 2")
    if nx * nz > MAX_TERRAIN_POINTS:
        raise ValueError("terrain grid too large")
    if not (_is_num(step) and step > 0):
        raise ValueError("terrain.step must be a positive number")
    for key in ("origin", "center"):
        v = doc.get(key)
        if not (isinstance(v, list) and len(v) == 2 and all(_is_num(x) for x in v)):
            raise ValueError(f"terrain.{key} must be [x, z]")
    for key in ("z", "s"):
        if key in doc:
            arr = doc[key]
            if not isinstance(arr, list) or len(arr) != nx * nz:
                raise ValueError(f"terrain.{key} must have nx * nz = {nx * nz} values")
            if not all(_is_num(x) for x in arr):
                raise ValueError(f"terrain.{key} must only contain numbers")
    if "z" not in doc:
        raise ValueError("terrain.z is required")


def validate_edits(doc: Any) -> None:
    """Raise ValueError when `doc` is not an edits document."""
    if not isinstance(doc, dict):
        raise ValueError("edits must be an object")
    if "terrain" in doc and not isinstance(doc["terrain"], list):
        raise ValueError("edits.terrain must be a list")
    if "outdoor" in doc and not isinstance(doc["outdoor"], dict):
        raise ValueError("edits.outdoor must be an object")
    if "views" in doc and not isinstance(doc["views"], list):
        raise ValueError("edits.views must be a list")
    if "registration" in doc and not isinstance(doc["registration"], dict):
        raise ValueError("edits.registration must be an object")


VALIDATORS = {
    "scene": validate_scene,
    "terrain": validate_terrain,
    "edits": validate_edits,
}
