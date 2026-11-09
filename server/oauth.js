import { createHash } from "node:crypto";
import { HttpError } from "./profile.js";
import { nonce } from "./store.js";

const qqBase = "https://graph.qq.com";
const muaBase = "https://skin.mualliance.ltd/api/union/oauth2";

export function createProviders(env, request = fetch) {
  const providers = {};
  if (env.QQ_CLIENT_ID && env.QQ_CLIENT_SECRET) {
    const clientId = env.QQ_CLIENT_ID;
    providers.qq = {
      start: (redirectUri, state) => ({
        url: addParams(qqBase + "/oauth2.0/authorize", {
          response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: "get_user_info",
        }),
        verifier: null,
      }),
      async complete(redirectUri, code) {
        const token = await qqRequest("/oauth2.0/token", {
          grant_type: "authorization_code", client_id: clientId, client_secret: env.QQ_CLIENT_SECRET,
          redirect_uri: redirectUri, code, fmt: "json",
        });
        const accessToken = requireText(token.access_token);
        const identity = await qqRequest("/oauth2.0/me", { access_token: accessToken, fmt: "json" });
        if (String(identity.client_id) !== clientId) throw new HttpError(502, "QQ 返回了不同应用的账号标识。");
        const subject = requireSubject(identity.openid);
        const profile = await qqRequest("/user/get_user_info", {
          access_token: accessToken, oauth_consumer_key: clientId, openid: subject,
        });
        if (Number(profile.ret) !== 0) throw new HttpError(502, "QQ 用户资料读取失败。");
        const qqAvatar = qqImage(profile.figureurl_qq_2) ?? qqImage(profile.figureurl_qq_1);
        return {
          provider: "qq", subject, nickname: nickname(profile.nickname),
          avatar: qqAvatar ?? qqImage(profile.figureurl_2), qqAvatar,
        };
      },
    };
  }

  if (env.MUA_CLIENT_ID && env.MUA_CLIENT_SECRET) {
    const clientId = env.MUA_CLIENT_ID;
    providers.mua = {
      start(redirectUri, state) {
        const verifier = env.MUA_PKCE === "1" ? nonce() : null;
        const params = { response_type: "code", client_id: clientId, redirect_uri: redirectUri, state };
        if (env.MUA_SCOPE) params.scope = env.MUA_SCOPE;
        if (verifier) {
          params.code_challenge = createHash("sha256").update(verifier).digest("base64url");
          params.code_challenge_method = "S256";
        }
        return { url: addParams(muaBase + "/authorize", params), verifier };
      },
      async complete(redirectUri, code, verifier) {
        const form = new URLSearchParams({
          grant_type: "authorization_code", client_id: clientId, client_secret: env.MUA_CLIENT_SECRET,
          redirect_uri: redirectUri, code,
        });
        if (verifier) form.set("code_verifier", verifier);
        const token = JSON.parse(await upstream(muaBase + "/token", { method: "POST", body: form }));
        const accessToken = requireText(token.access_token);
        const profile = JSON.parse(await upstream(muaBase + "/user", {
          headers: { Authorization: "Bearer " + accessToken },
        }));
        const subject = requireSubject(readField(profile, env.MUA_ID_FIELD || "sub"));
        const name = readField(profile, env.MUA_NAME_FIELD || "nickname");
        const avatar = env.MUA_AVATAR_FIELD ? readField(profile, env.MUA_AVATAR_FIELD) : null;
        return {
          provider: "mua", subject, nickname: nickname(name),
          avatar: avatarUrl(avatar, new URL(muaBase).origin),
        };
      },
    };
  }
  return providers;

  async function upstream(url, options = {}) {
    const response = await request(url, {
      ...options, redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json", ...options.headers },
    });
    if (!response.ok) throw new HttpError(502, "身份提供方拒绝了这次登录，请检查授权配置或重试。");
    return response.text();
  }

  async function qqRequest(path, params) {
    const raw = (await upstream(addParams(qqBase + path, params))).trim();
    const wrapped = /^callback\s*\(([\s\S]+)\)\s*;?$/.exec(raw);
    if (wrapped) return JSON.parse(wrapped[1]);
    if (raw.startsWith("{")) return JSON.parse(raw);
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function addParams(base, params) {
  const url = new URL(base);
  url.search = new URLSearchParams(params).toString();
  return url.href;
}

function readField(value, path) {
  for (const key of path.split(".")) {
    if (!value || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

function requireText(value) {
  if (typeof value === "string" && value && value.length <= 8192 && !/[\r\n]/.test(value)) return value;
  throw new HttpError(502, "身份提供方没有返回有效的登录凭据。");
}

function requireSubject(value) {
  if (Number.isSafeInteger(value)) value = String(value);
  if (typeof value === "string" && value.trim() && value.length <= 255) return value;
  throw new HttpError(502, "身份提供方没有返回稳定的账号标识，请检查资料字段配置。");
}

function nickname(value) {
  return typeof value === "string" ? value.trim().slice(0, 32) : "";
}

function avatarUrl(value, base) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function qqImage(value) {
  if (typeof value === "string" && /^http:\/\/(?:[a-z0-9-]+\.)*qlogo\.cn\//i.test(value)) {
    value = "https:" + value.slice(5);
  }
  return avatarUrl(value);
}
