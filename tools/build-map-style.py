"""Собирает стиль карты map/style.json из стиля OpenFreeMap «dark».

Что меняем:
- палитра под игру: тёмно-синяя вода, зелёные парки, светлые дороги (в духе карты GTA);
- подписи только по-русски (name:ru → name);
- убираем то, что игре не нужно: растровый рельеф мелких масштабов, границы, страны и регионы
  (карта открывается с zoom 12, а границы из OSM — спорная тема, в игре им не место).

Запуск: python tools/build-map-style.py   (нужен интернет: берём свежую схему слоёв)
"""

import json
import pathlib
import urllib.request

SRC = "https://tiles.openfreemap.org/styles/dark"
OUT = pathlib.Path(__file__).resolve().parent.parent / "map" / "style.json"

DROP_PREFIXES = ("boundary_", "place_country", "place_state", "aeroway")
NAME = ["coalesce", ["get", "name:ru"], ["get", "name"]]

C = {
    "land": "#1a2029",
    "residential": "#1c232c",
    "park": "#172a22",
    "water": "#0c2436",
    "water_text": "#3f7aa3",
    "building": "#242d38",
    "building_line": "#2d3845",
    "path": "#2f3946",
    "minor": "#3b4553",
    "major": "#5d6876",
    "major_casing": "#0e1318",
    "motorway": "#7a6a36",
    "rail": "#39404a",
    "road_text": "#98a4b1",
    "place_text": "#cfd7e0",
    "halo": "#0b0f14",
}

PAINT = {
    "background": {"background-color": C["land"]},
    "water": {"fill-color": C["water"]},
    "waterway": {"line-color": C["water"]},
    "landuse_residential": {"fill-color": C["residential"]},
    "landcover_wood": {"fill-color": C["park"]},
    "landuse_park": {"fill-color": C["park"]},
    "landcover_ice_shelf": {"fill-color": C["land"]},
    "landcover_glacier": {"fill-color": C["land"]},
    "building": {"fill-color": C["building"], "fill-outline-color": C["building_line"]},
    "road_area_pier": {"fill-color": C["land"]},
    "road_pier": {"line-color": C["land"]},
    "highway_path": {"line-color": C["path"]},
    "highway_minor": {"line-color": C["minor"]},
    "highway_major_casing": {"line-color": C["major_casing"]},
    "highway_major_inner": {"line-color": C["major"]},
    "highway_major_subtle": {"line-color": C["major"]},
    "highway_motorway_casing": {"line-color": C["major_casing"]},
    "highway_motorway_inner": {"line-color": C["motorway"]},
    "highway_motorway_subtle": {"line-color": C["motorway"]},
    "railway_transit": {"line-color": C["rail"]},
    "railway_minor": {"line-color": C["rail"]},
    "railway": {"line-color": C["rail"]},
    "railway_transit_dashline": {"line-color": C["land"]},
    "railway_minor_dashline": {"line-color": C["land"]},
    "railway_dashline": {"line-color": C["land"]},
    "water_name": {"text-color": C["water_text"], "text-halo-color": C["halo"]},
    "highway_name_other": {"text-color": C["road_text"], "text-halo-color": C["halo"]},
    "highway_name_motorway": {"text-color": C["road_text"], "text-halo-color": C["halo"]},
}
PLACE_PAINT = {"text-color": C["place_text"], "text-halo-color": C["halo"]}


def main():
    req = urllib.request.Request(SRC, headers={"User-Agent": "vl-fog-style-builder"})
    style = json.load(urllib.request.urlopen(req, timeout=30))

    style["name"] = "Туман Владивостока"
    style["sources"] = {
        "openmaptiles": {
            "type": "vector",
            "url": "https://tiles.openfreemap.org/planet",
            "attribution": '<a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }
    }

    layers = []
    for layer in style["layers"]:
        lid = layer["id"]
        if layer.get("source") == "ne2_shaded" or lid.startswith(DROP_PREFIXES):
            continue
        paint = layer.setdefault("paint", {})
        paint.update(PAINT.get(lid, PLACE_PAINT if lid.startswith("place_") else {}))
        lay = layer.get("layout", {})
        if "text-field" in lay and lid != "highway_name_motorway":
            lay["text-field"] = NAME
        layers.append(layer)
    style["layers"] = layers

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(style, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT}: {len(layers)} слоёв")


if __name__ == "__main__":
    main()
