import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { createAuthDelivery } from "./auth-delivery.js";
import { loadCities } from "./cities.js";
import { previewProviders, seedDemo } from "./demo.js";
import { createGeoDetector } from "./geoip.js";
import { createProviders } from "./oauth.js";
import { openStore } from "./store.js";

const demo = process.argv.includes("--demo");
const preview = !demo && process.argv.includes("--auth-preview");
const liveTest = !demo && !preview && process.argv.includes("--auth-live-test");
const localMode = demo || preview || liveTest;
const host = localMode ? "127.0.0.1" : process.env.HOST || "127.0.0.1";
const port = Number(liveTest ? process.env.AUTH_LIVE_TEST_PORT || 4180
  : preview ? process.env.AUTH_PREVIEW_PORT || 4180
    : (demo ? process.env.DEMO_PORT : process.env.PORT) || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口需要是 1 到 65535 之间的整数。");
const localOrigin = "http://127.0.0.1:" + port;
const url = new URL(localMode ? localOrigin : process.env.APP_ORIGIN || localOrigin);
const local = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
  throw new Error("APP_ORIGIN 需要完整的 HTTPS 源地址，本机调试可用 HTTP。");
}

const delivery = demo || preview ? {} : createAuthDelivery(process.env);
if (liveTest && !delivery.email && !delivery.phone) {
  console.error("请在 .env.auth-test 中填好至少一个发送渠道的配置，再启动本机实测。");
  process.exit(1);
}

const cities = loadCities();
const file = localMode ? ":memory:" : resolve(process.env.DATABASE_PATH || "data/mianji.sqlite");
if (!localMode) mkdirSync(dirname(file), { recursive: true });
const store = openStore(file, cities.get);
if (demo) seedDemo(store);
const server = createApp({
  store, cities, demo, preview, liveTest, origin: url.origin,
  timeZone: process.env.SITE_TIME_ZONE || "Asia/Shanghai",
  providers: preview ? previewProviders(url.origin) : localMode ? {} : createProviders(process.env),
  delivery,
  geo: createGeoDetector(localMode ? {} : process.env, cities),
  admins: new Set((process.env.ADMIN_ACCOUNTS ?? "").split(",").map((value) => value.trim()).filter(Boolean)),
});
server.once("close", store.close);
server.listen(port, host, () => {
  console.log((liveTest ? "面基地图验证码投递实测" : preview ? "面基地图登录预览" : demo ? "面基地图演示" : "面基地图")
    + " · " + url.origin);
});
