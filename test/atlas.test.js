import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { countryCamera, moveCamera, screenPoint } from "../public/map-view.js";
import { createApp } from "../server/app.js";
import { loadCities } from "../server/cities.js";
import { createGeoDetector } from "../server/geoip.js";
import { calendar, isDay, mapCity, scheduledCity } from "../server/location.js";
import { createProviders } from "../server/oauth.js";
import { fields } from "../server/profile.js";
import { openStore } from "../server/store.js";

const cities = loadCities();
const shanghai = 1796236;
const nanjing = 1799962;
const hangzhou = 1808926;
const beijing = 1816670;
const day = 24 * 60 * 60 * 1000;

test("city lookup prefers the city over another locality's alias", () => {
  assert.equal(cities.detect("Shanghai", "CN", "SH"), shanghai);
  assert.equal(cities.search("南京")[0].id, nanjing);
  assert.equal(cities.detect("Springfield", "US"), null);
  assert.equal(cities.detect("Springfield", "US", "IL"), 4250542);
});

test("location headers are accepted only from a configured proxy and do not require a city for the map view", async () => {
  const geo = createGeoDetector({ TRUST_PROXY: "127.0.0.1" }, cities);
  const headers = { "cf-ipcity": "Shanghai", "cf-ipcountry": "CN", "cf-region-code": "SH" };
  const untrusted = { socket: { remoteAddress: "203.0.113.42" }, headers };
  const trusted = { socket: { remoteAddress: "::ffff:127.0.0.1" }, headers };
  assert.equal(await geo.city(untrusted), null);
  assert.equal(await geo.country(untrusted), null);
  assert.equal(await geo.city(trusted), shanghai);
  assert.equal(await geo.country({ ...trusted, headers: { "cf-ipcountry": "JP" } }), "JP");
});

test("zoom keeps its anchor and a country's view can span the date line", () => {
  const camera = countryCamera(cities.countryView("CN"));
  const city = cities.get(shanghai);
  const anchor = screenPoint(camera, city);
  const zoomed = moveCamera(camera, camera.zoom * 2, anchor);
  const point = screenPoint(zoomed, city);
  assert.ok(camera.zoom > 1 && zoomed.zoom > camera.zoom);
  assert.ok(Math.abs(point.x - anchor.x) < 1e-9 && Math.abs(point.y - anchor.y) < 1e-9);

  const fiji = countryCamera(cities.countryView("FJ"));
  const west = screenPoint(fiji, { lat: -17.7, lon: 179 });
  const east = screenPoint(fiji, { lat: -17.7, lon: -179 });
  assert.ok(west.x > 0 && west.x < east.x && east.x < 1);
});

test("trip, specific dates, annual ranges and login cities have deterministic precedence", () => {
  const profile = {
    home: beijing, residence: shanghai,
    rules: [
      { kind: "home", annual: true, start: "12-20", end: "01-10" },
      { kind: "residence", annual: false, start: "2026-12-24", end: "2026-12-26" },
      { kind: "trip", annual: false, start: "2026-12-25", end: "2026-12-25", city: hangzhou },
      { kind: "trip", annual: false, start: "2026-12-25", end: "2026-12-25", city: nanjing },
    ],
  };
  assert.equal(calendar("Asia/Shanghai")(Date.parse("2026-12-19T16:00:00Z")), "2026-12-20");
  assert.equal(isDay("2026-02-29"), false);
  assert.equal(scheduledCity(profile, "2026-12-19"), null);
  assert.equal(scheduledCity(profile, "2026-12-20"), beijing);
  assert.equal(scheduledCity(profile, "2026-12-25"), nanjing);
  assert.equal(scheduledCity(profile, "2026-12-26"), shanghai);
  assert.equal(scheduledCity(profile, "2027-01-10"), beijing);
  assert.equal(scheduledCity(profile, "2027-01-11"), null);
  assert.equal(mapCity({ profile, last_login_city: hangzhou }, "2027-01-11", 0), hangzhou);
});

test("OAuth sessions, per-field visibility, and temporary city changes work through the API", async (t) => {
  const site = "https://atlas.example";
  const store = openStore(":memory:");
  let now = Date.parse("2026-11-07T02:00:00Z");
  let ipCountry = null;
  let challenge;
  let qqSubject = "mock-admin";
  const qqAvatarUrl = "https://q.qlogo.cn/qqapp/100/example/100";
  const providers = createProviders({
    QQ_CLIENT_ID: "100", QQ_CLIENT_SECRET: "test-only",
    MUA_CLIENT_ID: "200", MUA_CLIENT_SECRET: "test-only", MUA_PKCE: "1",
  }, async (input, init) => {
    const url = new URL(input);
    switch (url.pathname) {
      case "/oauth2.0/token":
        assert.equal(url.searchParams.get("redirect_uri"), site + "/auth/qq/callback");
        return new Response("access_token=qq-mock-token&expires_in=60");
      case "/oauth2.0/me":
        return new Response("callback(" + JSON.stringify({ client_id: "100", openid: qqSubject }) + ");");
      case "/user/get_user_info":
        assert.equal(url.searchParams.get("openid"), qqSubject);
        return Response.json({ ret: 0, nickname: "管理员", figureurl_qq_2: qqAvatarUrl.replace("https:", "http:") });
      case "/api/union/oauth2/token":
        assert.equal(init.method, "POST");
        assert.equal(init.body.get("redirect_uri"), site + "/auth/mua/callback");
        assert.equal(createHash("sha256").update(init.body.get("code_verifier")).digest("base64url"), challenge);
        return Response.json({ access_token: "mua-mock-token" });
      case "/api/union/oauth2/user":
        assert.equal(init.headers.Authorization, "Bearer mua-mock-token");
        return Response.json({ sub: "MUA:42", nickname: "成员", email: "member@example.test" });
      default:
        throw new Error("Unexpected mocked OAuth request");
    }
  });
  const server = createApp({
    store, cities, providers, geo: { city: async () => shanghai, country: async () => ipCountry },
    origin: site, timeZone: "Asia/Shanghai",
    admins: new Set(["qq:mock-admin"]), clock: () => now,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;

  const api = async (path, cookie, method = "GET", payload, origin = site) => {
    const headers = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + "/api/" + path, { method, headers, body: JSON.stringify(payload) });
    return { status: response.status, value: await response.json() };
  };
  const oauth = (path, cookie) => fetch(base + path, {
    redirect: "manual", headers: cookie ? { Cookie: cookie } : {},
  });
  const login = async (provider, verifyState = false) => {
    const start = await oauth("/auth/" + provider + "/start");
    const browserCookie = start.headers.getSetCookie()[0].split(";")[0];
    const target = new URL(start.headers.get("location"));
    assert.equal(target.href.split("?")[0], provider === "qq" ? "https://graph.qq.com/oauth2.0/authorize"
      : "https://skin.mualliance.ltd/api/union/oauth2/authorize");
    challenge = target.searchParams.get("code_challenge");
    const callback = "/auth/" + provider + "/callback?code=mock&state=" + target.searchParams.get("state");
    if (verifyState) assert.equal((await oauth(callback)).headers.get("location"), "/?login=expired");
    const finished = await oauth(callback, browserCookie);
    assert.equal(finished.headers.get("location"), "/");
    assert.match(finished.headers.getSetCookie()[0], /HttpOnly.*Secure/);
    if (verifyState) {
      assert.equal((await oauth(callback, browserCookie)).headers.get("location"), "/?login=expired");
    }
    return finished.headers.getSetCookie()[0].split(";")[0];
  };

  assert.equal((await api("map")).status, 401);
  assert.equal((await api("session?zone=Europe%2FParis")).value.mapCountry.code, "FR");
  assert.equal((await api("session?zone=UTC")).value.mapCountry, null);
  const admin = await login("qq", true);
  let member = await login("mua");
  assert.equal((await api("profile", member)).value.accountKey, "mua:MUA:42");
  assert.equal((await api("session", admin)).value.viewer.avatar, qqAvatarUrl);
  assert.equal((await api("session?zone=Europe%2FParis", member)).value.mapCountry.code, "CN");
  ipCountry = "JP";
  assert.equal((await api("session?zone=Europe%2FParis", member)).value.mapCountry.code, "JP");
  ipCountry = null;
  const getPin = async () => (await api("map", admin)).value.members[0];
  assert.deepEqual((await api("map", admin)).value.members, []);
  assert.equal((await api("admin", member)).status, 403);
  const originalSettings = (await api("admin", admin)).value;
  assert.equal(originalSettings.overrideDays, 2);
  originalSettings.visibility.qq = true;
  assert.equal((await api("admin", admin, "PUT", originalSettings)).status, 200);

  const profile = Object.fromEntries(fields.map(({ key }) => [key, "示例-" + key]));
  Object.assign(profile, { status: "busy", home: beijing, residence: nanjing, rules: [] });
  assert.equal((await api("profile", member, "PUT", profile, "https://other.example")).status, 403);
  assert.equal((await api("profile", member, "PUT", profile)).status, 200);
  const initial = await getPin();
  assert.equal(initial.city.id, shanghai);
  assert.equal(initial.status, "busy");
  assert.equal(initial.nickname, profile.nickname);
  assert.equal(initial.qq, undefined);
  assert.equal(initial.wechat, undefined);
  assert.equal(initial.rules, undefined);

  const avatarUpload = [
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx",
    "NDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy",
    "MjIyMjIyMjL/wAARCAAPABQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF",
    "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW",
    "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi",
    "4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC",
    "AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm",
    "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq",
    "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDZtLdJ9+4sNuMYqz/Z8X95/wAx/hVS2ufs+75N27HfFT/2j/0y/wDHv/rVy5xQ4gnjZywT",
    "fs9Le9FdFfd33ua4GplkcPFYi3PrfR935dijRRRX3B88f//Z",
  ].join("");
  assert.equal((await api("profile", member, "PUT", { ...profile, avatarUpload: "PHN2Zz4=" })).status, 400);
  const uploaded = await api("profile", member, "PUT", { ...profile, avatarUpload });
  assert.equal(uploaded.status, 200);
  const avatarPath = uploaded.value.avatar;
  const readAvatar = (cookie) => fetch(base + avatarPath, { headers: cookie ? { Cookie: cookie } : {} });
  assert.match(avatarPath, /^\/api\/avatars\//);
  assert.equal((await getPin()).avatar, avatarPath);
  const image = await readAvatar(admin);
  assert.equal(image.headers.get("content-type"), "image/jpeg");
  assert.equal(Buffer.from(await image.arrayBuffer()).toString("base64"), avatarUpload);
  assert.equal((await readAvatar()).status, 401);
  member = await login("mua");
  assert.equal((await api("session", member)).value.viewer.avatar, avatarPath);

  const visibility = { avatar: false, school: false, home: false, residence: false, status: false, qq: true };
  assert.equal((await api("profile", member, "PUT", { ...profile, visibility })).status, 200);
  const privateFields = await getPin();
  for (const key of ["avatar", "school", "home", "residence"]) {
    assert.equal(Object.hasOwn(privateFields, key), false);
  }
  assert.equal(privateFields.status, "busy");
  assert.equal(privateFields.qq, profile.qq);
  assert.equal(privateFields.nickname, profile.nickname);
  assert.equal(privateFields.city.id, shanghai);
  assert.equal((await api("profile", member)).value.profile.home.id, beijing);
  assert.equal((await readAvatar(admin)).status, 404);
  assert.equal((await readAvatar(member)).status, 200);

  const syncQQ = async (requester, callbackSession) => {
    const start = await fetch(base + "/api/avatar/qq/start", { method: "POST", headers: { Cookie: requester, Origin: site } });
    const browser = start.headers.getSetCookie()[0].split(";")[0];
    const target = new URL((await start.json()).url);
    assert.equal(target.searchParams.get("scope"), "get_user_info");
    const callback = "/auth/qq/callback?code=mock&state=" + target.searchParams.get("state");
    const response = await oauth(callback, browser + "; " + callbackSession);
    assert.deepEqual(response.headers.getSetCookie(), []);
    return response.headers.get("location");
  };
  assert.equal((await api("avatar/qq/start", member, "POST", undefined, "https://other.example")).status, 403);
  assert.equal(await syncQQ(member, admin), "/?qqAvatar=expired#profile");
  qqSubject = "another-qq";
  assert.equal(await syncQQ(admin, admin), "/?qqAvatar=mismatch#profile");
  assert.equal(await syncQQ(member, member), "/?qqAvatar=ok#profile");
  assert.equal((await api("profile", member)).value.accountKey, "mua:MUA:42");
  assert.equal((await api("profile", member)).value.avatar, qqAvatarUrl);
  assert.equal((await getPin()).avatar, undefined);
  assert.equal((await readAvatar(member)).status, 404);
  qqSubject = "mock-admin";

  const settings = { visibility: Object.fromEntries(fields.map(({ key }) => [key, false])), overrideDays: 3 };
  assert.equal((await api("admin", admin, "PUT", settings)).status, 200);
  const filtered = await getPin();
  for (const { key } of fields) assert.equal(Object.hasOwn(filtered, key), false);
  profile.rules = [{ kind: "residence", annual: true, start: "01-01", end: "12-31" }];
  const hiddenFieldEdit = { ...profile, qq: "试图覆盖隐藏的 QQ 号", visibility: { qq: false } };
  delete hiddenFieldEdit.school;
  assert.equal((await api("profile", member, "PUT", hiddenFieldEdit)).status, 200);
  assert.equal((await api("profile", member)).value.profile.qq, profile.qq);
  assert.equal((await api("profile", member)).value.profile.school, profile.school);
  assert.equal((await api("profile", member)).value.profile.visibility.school, false);
  settings.visibility.qq = true;
  assert.equal((await api("admin", admin, "PUT", settings)).status, 200);
  assert.equal((await getPin()).qq, profile.qq);
  assert.equal((await getPin()).city.id, nanjing);
  assert.equal((await api("profile", member, "PUT", { ...profile, visibility: { qq: false } })).status, 200);
  assert.equal((await getPin()).qq, undefined);
  assert.equal((await api("profile", member, "PUT", { ...profile, visibility: { qq: "true" } })).status, 400);

  member = await login("mua");
  assert.equal((await api("session", member)).value.prompt.observed.id, shanghai);
  assert.equal((await api("session", member)).value.prompt.expected.id, nanjing);
  assert.equal((await api("prompt", member, "POST", { accepted: false })).status, 200);
  assert.equal((await getPin()).city.id, nanjing);
  const older = await login("mua");
  member = await login("mua");
  assert.equal((await api("prompt", older, "POST", { accepted: true })).status, 409);
  assert.equal((await api("prompt", member, "POST", { accepted: true })).status, 200);
  assert.equal((await api("profile", member)).value.override.expiresAt, now + 3 * day);
  assert.equal((await api("prompt", member, "POST", { accepted: true })).status, 409);
  settings.overrideDays = 1;
  await api("admin", admin, "PUT", settings);
  now += 3 * day - 1;
  assert.equal((await getPin()).city.id, shanghai);
  now += 1;
  assert.equal((await getPin()).city.id, nanjing);

  settings.visibility.nickname = true;
  assert.equal((await api("admin", admin, "PUT", settings)).status, 200);
  profile.status = "hidden";
  profile.nickname = "";
  assert.equal((await api("profile", member, "PUT", profile)).status, 200);
  assert.equal((await api("profile", member)).value.profile.nickname, "");
  assert.equal(await getPin(), undefined);
});
