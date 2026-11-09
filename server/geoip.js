import { BlockList, isIP } from "node:net";

const nonPublic = new BlockList();
for (const [subnet, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16]]) {
  nonPublic.addSubnet(subnet, prefix);
}
for (const [subnet, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]]) {
  nonPublic.addSubnet(subnet, prefix, "ipv6");
}

export function createGeoDetector(env, cities, request = fetch) {
  const trusted = new Set((env.TRUST_PROXY ?? "").split(",").map((entry) => ip(entry.trim())).filter(Boolean));
  const template = env.GEOIP_URL;
  if (template) {
    const url = new URL(template.replace("{ip}", "203.0.113.1"));
    if (!template.includes("{ip}") || url.protocol !== "https:" || url.username || url.password) {
      throw new Error("GEOIP_URL 需要 HTTPS 地址和 {ip} 占位符。");
    }
  }

  return {
    city: (req) => detect(req, ({ city, country, region }) => cities.detect(city, country, region)),
    country: (req) => detect(req, ({ country }) => /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null),
  };

  async function detect(req, match) {
    const peer = ip(req.socket.remoteAddress);
    const proxy = trusted.has(peer);
    if (proxy) {
      const result = match({
        city: header(req, "cf-ipcity"),
        country: header(req, "cf-ipcountry").toUpperCase(),
        region: header(req, "cf-region-code") || header(req, "cf-region"),
      });
      if (result) return result;
    }
    if (!template) return null;
    const address = proxy ? ip(header(req, "cf-connecting-ip") || header(req, "x-real-ip")) : peer;
    if (!address || nonPublic.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")) return null;
    try {
      const response = await request(template.replace("{ip}", encodeURIComponent(address)), {
        headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(3500),
      });
      if (!response.ok) return null;
      const data = await response.json();
      return match({
        city: string(data.city),
        country: string(data.country_code).toUpperCase(),
        region: string(data.region_code || data.region),
      });
    } catch {
      return null;
    }
  }
}

function ip(value) {
  if (typeof value !== "string") return null;
  const address = value.replace(/^::ffff:(?=\d)/i, "");
  return isIP(address) ? address : null;
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function header(req, key) {
  const value = string(req.headers[key]);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
