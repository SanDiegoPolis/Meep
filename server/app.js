import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { avatarBase64Limit, decodeAvatar } from "./avatar.js";
import { activeOverride, calendar, mapCity } from "./location.js";
import { fields, HttpError, personalVisibility, publicFields, selectedClubRole, validateProfile, validateSettings } from "./profile.js";
import { nonce, validNonce } from "./store.js";
import { demoLogins, previewAuthorization } from "./demo.js";
import { passwordLogin } from "./password.js";
import { createVerification } from "./verification.js";

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/ui.js": ["ui.js", "text/javascript; charset=utf-8"],
  "/map.js": ["map.js", "text/javascript; charset=utf-8"],
  "/login.js": ["login.js", "text/javascript; charset=utf-8"],
  "/map-view.js": ["map-view.js", "text/javascript; charset=utf-8"],
  "/forms.js": ["forms.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/world.svg": ["world.svg", "image/svg+xml"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};

export function createApp({
  store, cities, providers, geo, origin, timeZone, admins, delivery,
  preview = false, liveTest = false, demo = false, clock = Date.now,
}) {
  const today = calendar(timeZone);
  const secure = origin.startsWith("https:");
  const checkPassword = passwordLogin(store);
  const appUrl = new URL(origin);
  const local = appUrl.protocol === "http:" && appUrl.hostname === "127.0.0.1";
  const localPreview = local && preview;
  const localLiveTest = local && liveTest && !localPreview;
  const verification = createVerification(secure || localLiveTest ? delivery : {}, localPreview, clock);
  const cookieSuffix = localPreview || localLiveTest ? (localPreview ? "_preview_" : "_live_test_") + (appUrl.port || "80") : "";
  const cookiePrefix = secure ? "__Host-" : "";
  const sessionCookie = cookiePrefix + "mianji_session" + cookieSuffix;
  const oauthCookie = cookiePrefix + "mianji_oauth" + cookieSuffix;
  const assets = new Map(Object.entries(staticFiles).map(([path, [file, type]]) => [
    path, { type, data: readFileSync(new URL("../public/" + file, import.meta.url)) },
  ]));

  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    res.setHeader("Content-Security-Policy",
      "default-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new HttpError(400, "请求地址无效。");
      const path = url.pathname;
      const method = req.method;
      if (assets.has(path) && (method === "GET" || method === "HEAD")) {
        const asset = assets.get(path);
        res.writeHead(200, { "Content-Type": asset.type });
        return res.end(method === "HEAD" ? undefined : asset.data);
      }

      const token = cookieValue(req, sessionCookie);
      const now = clock();
      const day = today(now);
      const auth = /^\/auth\/(qq|mua)\/(start|callback)$/.exec(path);
      if (method === "GET" && auth) return await oauth(req, res, url, auth[1], auth[2], token, now);
      const testAuth = /^\/auth\/preview\/(qq|mua)$/.exec(path);
      if (verification.preview && method === "GET" && testAuth) {
        const state = url.searchParams.get("state");
        if (!validNonce(state)) throw new HttpError(400, "演示授权地址无效。");
        return previewAuthorization(res, testAuth[1], state);
      }

      if (path.startsWith("/api/") && method !== "GET" && req.headers.origin !== origin) {
        throw new HttpError(403, "请从本站页面提交请求。");
      }
      if (demo && method === "POST" && path === "/api/demo") {
        const { account } = await body(req);
        if (typeof account !== "string" || !Object.hasOwn(demoLogins, account)) {
          throw new HttpError(400, "请选择演示账号。");
        }
        setSession(res, store.signIn({
          provider: "demo", subject: account, nickname: "", avatar: null,
        }, demoLogins[account].city, now, day, token));
        return json(res, { ok: true });
      }
      if (method === "POST" && (path === "/api/login/code/request" || path === "/api/login/code/verify")) {
        if (secure && req.headers["x-forwarded-proto"] !== "https") {
          throw new HttpError(403, "请通过 HTTPS 登录。");
        }
        const payload = await body(req, 4096);
        if (path.endsWith("/request")) return json(res, await verification.send(payload));

        const identifier = verification.verify(payload);
        const city = await geo.city(req);
        const signedAt = clock();
        setSession(res, store.signInVerified(identifier, city, signedAt, today(signedAt), token));
        return json(res, { ok: true });
      }
      if (method === "POST" && path === "/api/login/password") {
        if (demo || !store.hasPasswordAccounts()) throw new HttpError(404, "还未开通邮箱或手机号登录。");
        if (secure && req.headers["x-forwarded-proto"] !== "https") {
          throw new HttpError(403, "请通过 HTTPS 登录。");
        }
        const credentials = await body(req, 4096);
        const identity = await checkPassword(credentials, clock());
        const city = await geo.city(req);
        const signedAt = clock();
        setSession(res, store.signIn(identity, city, signedAt, today(signedAt), token));
        return json(res, { ok: true });
      }

      const context = store.getSession(token, now);
      const account = context?.account;
      const admin = account && (admins.has(accountKey(account)) || (demo && account.subject === "admin"));
      if (method === "GET" && path === "/api/session") {
        const ipCountry = await geo.country(req);
        const ownCity = account && displayedCity(account, day, now);
        const mapCountry = cities.countryView(ipCountry) ?? cities.countryView(ownCity?.cc)
          ?? cities.countryView(cities.countryAtTimeZone(url.searchParams.get("zone")));
        const pending = context && store.prompt(context, day, now);
        return json(res, {
          demo, providers: { qq: Boolean(providers.qq), mua: Boolean(providers.mua) },
          passwordLoginOrigin: !demo && store.hasPasswordAccounts() ? origin : null,
          codeLogin: { ...verification.enabled, preview: verification.preview, liveTest: localLiveTest, origin },
          fields, day, timeZone, mapCountry,
          viewer: account ? {
            id: account.id, nickname: account.profile.nickname, avatar: account.display_avatar,
            status: account.profile.status, admin: Boolean(admin),
          } : null,
          prompt: pending ? {
            observed: cities.get(pending.observed), expected: cities.get(pending.expected),
            days: store.settings().overrideDays,
          } : null,
        });
      }
      if (!path.startsWith("/api/")) throw new HttpError(404, "页面不存在。");
      if (!context) throw new HttpError(401, "请先登录。");

      if (method === "POST" && path === "/api/logout") {
        store.signOut(token);
        res.setHeader("Set-Cookie", cookie(sessionCookie, "", 0));
        return json(res, { ok: true });
      }
      if (method === "POST" && path === "/api/avatar/qq/start") {
        if (!providers.qq) throw new HttpError(503, "本站还未启用 QQ 授权。");
        return json(res, { url: startOAuth(req, res, "qq", now, { avatarSession: context.session.token_hash }) });
      }
      const bindingProvider = /^\/api\/bindings\/(qq|mua)\/start$/.exec(path)?.[1];
      if (method === "POST" && (bindingProvider || path === "/api/bindings/code/request" || path === "/api/bindings/code/verify")) {
        if (secure && req.headers["x-forwarded-proto"] !== "https") {
          throw new HttpError(403, "请通过 HTTPS 绑定账号。");
        }
        if (bindingProvider) {
          if (!providers[bindingProvider]) throw new HttpError(503, "本站尚未开通此登录方式。");
          return json(res, {
            url: startOAuth(req, res, bindingProvider, now, { bindSession: context.session.token_hash }),
          });
        }
        const payload = await body(req, 4096);
        const current = store.getSession(token, clock());
        if (!current) throw new HttpError(401, "请重新登录后再绑定。");
        const bindSession = current.session.token_hash;
        if (path.endsWith("/request")) return json(res, await verification.send(payload, bindSession));
        const identifier = verification.verify(payload, bindSession);
        return json(res, { bindings: store.bindContact(current.account, payload.channel, identifier) });
      }
      const avatar = /^\/api\/avatars\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/.exec(path);
      if (method === "GET" && avatar) {
        const owner = store.uploadedAvatar(avatar[1], avatar[2]);
        if (!owner || (account.id !== owner.id && (
          owner.profile.status === "hidden" || !personalVisibility(owner.profile).avatar
          || !displayedCity(owner, day, now)
        ))) throw new HttpError(404, "头像不存在。");
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cross-Origin-Resource-Policy": "same-origin" });
        return res.end(owner.image);
      }
      if (method === "GET" && path === "/api/map") {
        const settings = store.settings();
        const members = store.visibleAccounts().flatMap((user) => {
          const city = displayedCity(user, day, now);
          if (!city) return [];
          return [{
            id: user.id, city,
            ...publicFields(user.profile, settings, cities, user.display_avatar),
          }];
        });
        return json(res, { members });
      }
      if (method === "GET" && path === "/api/cities") {
        const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
        return json(res, { cities: query ? cities.search(query) : [] });
      }
      if (method === "GET" && path === "/api/cities/detected") {
        const detected = demo ? demoLogins[account.subject]?.city : await geo.city(req);
        return json(res, { city: cities.get(detected) ?? null });
      }
      if (path === "/api/profile") {
        if (method === "GET") return json(res, ownProfile(account, day, now));
        if (method === "PUT") {
          const payload = await body(req, 48 * 1024 + avatarBase64Limit);
          const savedAt = clock();
          const current = store.getSession(token, savedAt)?.account;
          if (!current) throw new HttpError(401, "请先登录。");
          const profile = validateProfile(payload, cities, current.profile, store.settings());
          const savedDay = today(savedAt);
          const saved = store.saveProfile(current.id, profile, savedDay, decodeAvatar(payload.avatarUpload));
          return json(res, ownProfile(saved, savedDay, savedAt));
        }
      }
      if (method === "POST" && path === "/api/prompt") {
        const { accepted } = await body(req);
        if (typeof accepted !== "boolean") throw new HttpError(400, "请选择是否更新地点。");
        const answeredAt = clock();
        store.answerPrompt(token, accepted, today(answeredAt), answeredAt);
        return json(res, { ok: true });
      }
      if (method === "DELETE" && path === "/api/override") {
        store.endOverride(account.id);
        return json(res, { ok: true });
      }
      if (path === "/api/admin" && ["GET", "PUT"].includes(method)) {
        if (!admin) throw new HttpError(403, "需要管理员权限。");
        if (method === "PUT") {
          const payload = await body(req);
          if (!store.getSession(token, clock())) throw new HttpError(401, "请先登录。");
          store.saveSettings(validateSettings(payload, store.settings()));
        }
        return json(res, store.settings());
      }
      throw new HttpError(404, "请求的功能不存在。");
    } catch (error) {
      if (error instanceof HttpError) return json(res, { error: error.message }, error.status);
      console.error("面基地图处理请求失败", error.name, error.code ?? "");
      return json(res, { error: "请求处理失败，请稍后再试。" }, 500);
    }
  });

  function displayedCity(account, day, now) {
    return cities.get(mapCity(account, day, now, cities.get));
  }

  function ownProfile(account, day, now) {
    const override = activeOverride(account, now, cities.get);
    return {
      profile: {
        ...account.profile,
        roleKind: selectedClubRole(account.profile),
        visibility: personalVisibility(account.profile),
        home: cities.get(account.profile.home),
        residence: cities.get(account.profile.residence),
        rules: account.profile.rules.map((rule) => rule.kind === "trip"
          ? { ...rule, city: cities.get(rule.city) } : rule),
      },
      accountKey: accountKey(account),
      bindings: store.bindings(account),
      avatar: account.display_avatar,
      current: displayedCity(account, day, now),
      override: override ? { city: cities.get(override.city), expiresAt: override.expiresAt } : null,
      settings: store.settings(),
    };
  }

  function cookie(key, value, age) {
    return key + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + age + (secure ? "; Secure" : "");
  }

  function setSession(res, token) {
    res.setHeader("Set-Cookie", cookie(sessionCookie, token, 30 * 24 * 60 * 60));
  }

  function startOAuth(req, res, name, now, intent) {
    const redirectUri = origin + "/auth/" + name + "/callback";
    const existing = cookieValue(req, oauthCookie);
    const browser = validNonce(existing) ? existing : nonce();
    const state = nonce();
    const { url: target, verifier } = providers[name].start(redirectUri, state);
    store.rememberOAuth(state, browser, name, verifier, now, intent);
    res.setHeader("Set-Cookie", cookie(oauthCookie, browser, 600));
    return target;
  }

  async function oauth(req, res, url, name, action, previousToken, now) {
    const provider = providers[name];
    if (!provider) return redirect(res, "/?login=unavailable");
    if (action === "start") return redirect(res, startOAuth(req, res, name, now));
    const redirectUri = origin + "/auth/" + name + "/callback";
    const browser = cookieValue(req, oauthCookie);
    const flow = store.takeOAuth(url.searchParams.get("state"), browser, name, now);
    if (!flow) return redirect(res, "/?login=expired");
    const syncing = Boolean(flow.avatar_session_hash);
    const binding = Boolean(flow.bind_session_hash);
    const expectedSession = flow.bind_session_hash ?? flow.avatar_session_hash;
    const result = (status) => redirect(res, binding ? "/?binding=" + status + "#profile"
      : syncing ? "/?qqAvatar=" + status + "#profile" : "/?login=" + status);
    if (expectedSession && store.getSession(previousToken, now)?.session.token_hash !== expectedSession) {
      return result("expired");
    }
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096 || url.searchParams.has("error")) return result("denied");
    try {
      const identity = await provider.complete(redirectUri, code, flow.verifier);
      if (expectedSession) {
        const current = store.getSession(previousToken, clock());
        if (current?.session.token_hash !== expectedSession) return result("expired");
        if (binding) {
          store.bindOAuth(current.account, identity);
          return result("ok");
        }
        const linkedQQ = store.oauthSubject(current.account, "qq");
        if (linkedQQ && linkedQQ !== identity.subject) return result("mismatch");
        if (!identity.qqAvatar) return result("missing");
        store.syncQQAvatar(current.account.id, identity.qqAvatar);
        return result("ok");
      }
      const city = await geo.city(req);
      const signedAt = clock();
      setSession(res, store.signIn(identity, city, signedAt, today(signedAt), previousToken));
      return redirect(res, "/");
    } catch (error) {
      if (binding && error instanceof HttpError && error.status === 409) return result("conflict");
      console.warn("OAuth 登录失败", name, error instanceof HttpError ? error.message : error.name);
      return result("failed");
    }
  }
}

function accountKey(account) {
  return account.provider + ":" + account.subject;
}

function cookieValue(req, key) {
  const raw = req.headers.cookie ?? "";
  for (const pair of raw.split(";")) {
    const [name, value] = pair.trim().split("=", 2);
    if (name === key) return value;
  }
  return null;
}

async function body(req, limit = 48 * 1024) {
  const mediaType = req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new HttpError(415, "请求需要 JSON 数据。");
  }
  if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "提交内容过长。");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, "提交内容过长。");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Respond with the same message for invalid JSON and unexpected shapes.
  }
  throw new HttpError(400, "提交的 JSON 格式有误。");
}

function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
