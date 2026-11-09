"""Build the local world basemap and city index from the public source files."""

import argparse
import gzip
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
CN_REGIONS = {
    "01": ("安徽", "AH"), "02": ("浙江", "ZJ"), "03": ("江西", "JX"),
    "04": ("江苏", "JS"), "05": ("吉林", "JL"), "06": ("青海", "QH"),
    "07": ("福建", "FJ"), "08": ("黑龙江", "HL"), "09": ("河南", "HA"),
    "10": ("河北", "HE"), "11": ("湖南", "HN"), "12": ("湖北", "HB"),
    "13": ("新疆", "XJ"), "14": ("西藏", "XZ"), "15": ("甘肃", "GS"),
    "16": ("广西", "GX"), "18": ("贵州", "GZ"), "19": ("辽宁", "LN"),
    "20": ("内蒙古", "NM"), "21": ("宁夏", "NX"), "22": ("北京", "BJ"),
    "23": ("上海", "SH"), "24": ("山西", "SX"), "25": ("山东", "SD"),
    "26": ("陕西", "SN"), "28": ("天津", "TJ"), "29": ("云南", "YN"),
    "30": ("广东", "GD"), "31": ("海南", "HI"), "32": ("四川", "SC"),
    "33": ("重庆", "CQ"),
}
CITY_LABELS = {
    1816670: "北京", 1796236: "上海", 1799962: "南京", 1808926: "杭州",
    1815286: "成都", 1809858: "广州", 1795565: "深圳", 1814906: "重庆",
    1791247: "武汉", 1790630: "西安", 1815577: "长沙", 1880252: "新加坡",
    1850147: "东京", 2643743: "伦敦", 6167865: "多伦多", 2158177: "墨尔本",
    5391959: "旧金山", 5128581: "纽约", 2988507: "巴黎", 1835848: "首尔",
    2147714: "悉尼", 1819729: "香港", 1668341: "台北", 3067696: "布拉格",
}
HAN_NAME = re.compile(r"^[\u3400-\u9fff]{2,16}$")


def build_index(directory):
    admin_rows = (directory / "admin1CodesASCII.txt").read_text(encoding="utf-8").splitlines()
    regions = {row[0]: (row[1], row[2]) for line in admin_rows if (row := line.split("\t")) and len(row) >= 3}
    records = []
    zone_counts = defaultdict(Counter)
    with ZipFile(directory / "cities5000.zip") as archive, archive.open("cities5000.txt") as source:
        for line in source:
            row = line.decode("utf-8").rstrip("\n").split("\t")
            city_id, name, ascii_name = int(row[0]), row[1], row[2]
            country, code = row[8], row[10]
            latitude, longitude, population = float(row[4]), float(row[5]), int(row[14])
            if not re.fullmatch(r"[A-Z]{2}", country) or not -67.2 <= latitude <= 84:
                continue
            if row[17]:
                zone_counts[row[17]][country] += 1
            region, ascii_region = regions.get(country + "." + code, ("", ""))
            region_codes = [code, region, ascii_region]
            if country == "CN" and code in CN_REGIONS:
                region, iso = CN_REGIONS[code]
                region_codes.extend([iso, "CN-" + iso])
            alternatives = row[3].split(",")
            han = [entry for entry in alternatives if HAN_NAME.fullmatch(entry)]
            local = CITY_LABELS.get(city_id)
            if not local and country in {"CN", "TW", "HK", "MO"} and han:
                city_names = [entry.removesuffix("市") for entry in han if entry.endswith("市")]
                local = next(iter(city_names or han))
            latin = [entry for entry in alternatives if len(entry) <= 50 and entry
                     and "LATIN" in unicodedata.name(entry[0], "")]
            aliases = list(dict.fromkeys([ascii_name, *han[:12], *latin[:12]]))
            aliases = [entry for entry in aliases if entry and entry not in {name, local}]
            records.append([city_id, name, local or "", country, region,
                            list(dict.fromkeys(filter(None, region_codes))),
                            latitude, longitude, population, aliases])
    path = ROOT / "server/data/cities.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    path.write_bytes(gzip.compress(encoded, compresslevel=6, mtime=0))
    time_zones = {}
    for zone, counts in sorted(zone_counts.items()):
        country, count = counts.most_common(1)[0]
        if count * 10 >= counts.total() * 9:
            time_zones[zone] = country
    path.with_name("timezones.json").write_text(json.dumps(time_zones, indent=2) + "\n", encoding="utf-8")
    print(f"Indexed {len(records):,} populated places")


def project(longitude, latitude):
    return ((longitude + 180) * 1000 / 360, (84 - latitude) * 1000 / 360)


def ring_path(ring):
    projected = (project(lon, lat) for lon, lat in ring)
    return "M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in projected) + "Z"


def build_map(directory):
    source = json.loads((directory / "land.geojson").read_text(encoding="utf-8"))
    paths = []
    for feature in source["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            if max(point[1] for point in polygon[0]) < -59:
                continue
            paths.extend(ring_path(ring) for ring in polygon)
    grid = []
    for longitude in range(-150, 180, 30):
        x, _ = project(longitude, 0)
        grid.append(f"M{x:.2f} 0v420")
    for latitude in range(-60, 90, 15):
        _, y = project(0, latitude)
        grid.append(f"M0 {y:.2f}h1000")
    labels = [
        (-145, 7, "北太平洋"), (-105, -29, "南太平洋"), (-38, 21, "北大西洋"),
        (-21, -28, "南大西洋"), (77, -26, "印度洋"), (160, 4, "太平洋"),
    ]
    texts = []
    for longitude, latitude, label in labels:
        x, y = project(longitude, latitude)
        texts.append(f'<text x="{x:.1f}" y="{y:.1f}">{label}</text>')
    output = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420" preserveAspectRatio="none">
<defs>
  <linearGradient id="ocean" x2="0" y2="1">
    <stop stop-color="#172c33"/><stop offset="1" stop-color="#10232b"/>
  </linearGradient>
</defs>
<rect width="1000" height="420" fill="url(#ocean)"/>
<path d="{"".join(paths)}" fill="#2b4549" fill-rule="evenodd" stroke="#557271" stroke-width=".55"/>
<path d="{"".join(grid)}" fill="none" stroke="#a9c6bb" stroke-width=".45" opacity=".22" stroke-dasharray="2 3"/>
<g fill="#85a7a8" opacity=".75" font-size="9" letter-spacing="1.4" text-anchor="middle" font-family="sans-serif">{"".join(texts)}</g>
</svg>
"""
    path = ROOT / "public/world.svg"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    build_index(args.directory)
    build_map(args.directory)
