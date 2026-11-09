import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const countries = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function key(value) {
  return value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function cityKey(value) {
  return key(value).replace(/市$/, "");
}

export function loadCities() {
  const rows = JSON.parse(gunzipSync(readFileSync(new URL("./data/cities.json.gz", import.meta.url))));
  const index = rows.map(([id, name, local, cc, region, codes, lat, lon, population, aliases]) => {
    const country = countries.of(cc);
    const city = { id, name: local || name, region, country, cc, lat, lon };
    const primary = [name, local].filter(Boolean).map(cityKey);
    const names = [...new Set([...primary, ...aliases.map(cityKey)])];
    const locationKey = key([city.name, region, country].filter(Boolean).join(" "));
    return { city, names, primary, locationKey, regionKeys: new Set([region, ...codes].map(key)), population };
  }).sort((a, b) => b.population - a.population);
  const byId = new Map(index.map(({ city }) => [city.id, city]));
  const byCountry = new Map();
  for (const entry of index) {
    if (!byCountry.has(entry.city.cc)) byCountry.set(entry.city.cc, []);
    byCountry.get(entry.city.cc).push(entry);
  }
  const countryViews = new Map();
  const timeZones = JSON.parse(readFileSync(new URL("./data/timezones.json", import.meta.url), "utf8"));
  const zoneAliases = new Map();
  for (const [zone, country] of Object.entries(timeZones)) {
    try {
      const alias = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
      zoneAliases.set(alias, !zoneAliases.has(alias) || zoneAliases.get(alias) === country ? country : null);
    } catch {
      // Keep the catalog name if this runtime's time zone data does not know it yet.
    }
  }

  return {
    get: (id) => byId.get(id) ?? null,
    countryAtTimeZone(zone) {
      return (Object.hasOwn(timeZones, zone) ? timeZones[zone] : zoneAliases.get(zone)) ?? null;
    },
    countryView(code) {
      const entries = byCountry.get(code);
      if (!entries) return null;
      if (!countryViews.has(code)) countryViews.set(code, boundsForCountry(code, entries));
      return countryViews.get(code);
    },
    search(query) {
      const needle = cityKey(query);
      if (!needle) return [];
      const exact = [];
      const alternate = [];
      const starts = [];
      const contains = [];
      for (const entry of index) {
        if (entry.primary.includes(needle)) exact.push(entry.city);
        else if (entry.names.includes(needle)) alternate.push(entry.city);
        else if (entry.names.some((name) => name.startsWith(needle))) starts.push(entry.city);
        else if (entry.locationKey.includes(needle)) contains.push(entry.city);
        if (exact.length === 12) break;
      }
      return [...exact, ...alternate, ...starts, ...contains].slice(0, 12);
    },
    detect(name, countryCode, region = "") {
      if (!name || !countryCode) return null;
      const candidates = byCountry.get(countryCode.toUpperCase()) ?? [];
      const needle = cityKey(name);
      const matches = candidates.filter((entry) => entry.names.includes(needle));
      const regionKey = key(region);
      const regional = matches.filter((entry) => regionKey && entry.regionKeys.has(regionKey));
      const pool = regional.length ? regional : matches;
      const primary = pool.filter((entry) => entry.primary.includes(needle));
      if (primary.length === 1) return primary[0].city.id;
      return pool.length === 1 ? pool[0].city.id : null;
    },
  };
}

function boundsForCountry(code, entries) {
  let south = Infinity;
  let north = -Infinity;
  const longitudes = [];
  for (const { city } of entries) {
    south = Math.min(south, city.lat);
    north = Math.max(north, city.lat);
    longitudes.push(city.lon);
  }
  longitudes.sort((a, b) => a - b);
  let largestGap = -1;
  let west;
  // Exclude the largest empty arc so countries at the date line have a local view.
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[i + 1] ?? longitudes[0] + 360;
    const gap = next - longitudes[i];
    if (gap <= largestGap) continue;
    largestGap = gap;
    west = longitudes[(i + 1) % longitudes.length];
  }
  return { code, name: countries.of(code), west, east: west + (360 - largestGap), south, north };
}
