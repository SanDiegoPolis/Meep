import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { loadCities } from "./cities.js";
import { seedDemo } from "./demo.js";
import { createGeoDetector } from "./geoip.js";
import { createProviders } from "./oauth.js";
import { openStore } from "./store.js";

const demo = process.argv.includes("--demo");
const host = demo ? "127.0.0.1" : process.env.HOST || "127.0.0.1";
const port = Number((demo ? process.env.DEMO_PORT : process.env.PORT) || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口需要是 1 到 65535 之间的整数。");
const localOrigin = "http://127.0.0.1:" + port;
const url = new URL(demo ? localOrigin : process.env.APP_ORIGIN || localOrigin);
const local = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
  throw new Error("APP_ORIGIN 需要完整的 HTTPS 源地址，本机调试可用 HTTP。");
}

const cities = loadCities();
const file = demo ? ":memory:" : resolve(process.env.DATABASE_PATH || "data/mianji.sqlite");
if (!demo) mkdirSync(dirname(file), { recursive: true });
const store = openStore(file);
if (demo) seedDemo(store);
const server = createApp({
  store, cities, demo, origin: url.origin,
  timeZone: process.env.SITE_TIME_ZONE || "Asia/Shanghai",
  providers: demo ? {} : createProviders(process.env),
  geo: createGeoDetector(demo ? {} : process.env, cities),
  admins: new Set((process.env.ADMIN_ACCOUNTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
});
server.once("close", store.close);
server.listen(port, host, () => {
  console.log((demo ? "面基地图演示" : "面基地图") + " · " + url.origin);
});
