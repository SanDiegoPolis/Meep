import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";
import { createAuthDelivery } from "../server/auth-delivery.js";
import { loadCities } from "../server/cities.js";
import { previewProviders } from "../server/demo.js";
import { openStore } from "../server/store.js";

async function loginServer(t, options) {
  const store = openStore(":memory:");
  const server = createApp({
    store, cities: loadCities(), providers: {}, admins: new Set(), timeZone: "Asia/Shanghai",
    geo: { city: async () => null, country: async () => null }, ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const get = (path, cookie) => fetch(base + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const session = async (cookie) => (await get("/api/session", cookie)).json();
  const write = (method, path, body, headers) => fetch(base + "/api/" + path, {
    method, body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: options.origin, "X-Forwarded-Proto": "https", ...headers },
  });
  return {
    store, get, session,
    post: (path, body, headers) => write("POST", path, body, headers),
    put: (path, body, headers) => write("PUT", path, body, headers),
  };
}

const cookie = (response) => response.headers.get("set-cookie").split(";")[0];

test("Loopback delivery testing uses the configured sender without exposing the code", async (t) => {
  const sent = [];
  const origin = "http://127.0.0.1:4180";
  const delivery = { email: async (identifier, code) => sent.push({ identifier, code }) };
  const { session, post } = await loginServer(t, { origin, delivery, liveTest: true });
  assert.deepEqual((await session()).codeLogin, { email: true, phone: false, preview: false, liveTest: true, origin });
  const email = { channel: "email", identifier: "meep@example.test" };
  assert.equal((await post("login/code/request", email, { Origin: "http://localhost:4180" })).status, 403);
  assert.equal((await post("login/code/request", { channel: "phone", identifier: "13800138000" })).status, 503);
  const requested = await post("login/code/request", email);
  assert.equal(requested.status, 200);
  const { challenge, previewCode } = await requested.json();
  assert.equal(previewCode, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].identifier, email.identifier);
  const signedIn = await post("login/code/verify", { ...email, challenge, code: sent[0].code });
  assert.equal(signedIn.status, 200);
  assert.match(cookie(signedIn), /^mianji_session_live_test_4180=/);

  const ordinary = await loginServer(t, { origin, delivery });
  assert.equal((await ordinary.post("login/code/request", email)).status, 503);
  assert.equal(sent.length, 1);
});

test("Separate email and phone verification register accounts and sign back into each original account", async (t) => {
  let now = Date.now();
  const { session, post } = await loginServer(t, {
    origin: "http://127.0.0.1:4180", preview: true, clock: () => now,
  });
  assert.equal((await session()).viewer, null);
  assert.equal((await post("login/code/request", { channel: "email", identifier: "13800138000" })).status, 400);
  const ids = [];
  for (const [channel, identifier, normalized] of [
    ["email", "Test@example.test", "test@example.test"],
    ["phone", "13800138000", "+8613800138000"],
  ]) {
    const first = { channel, identifier };
    const requested = await post("login/code/request", first);
    assert.equal(requested.status, 200);
    const { challenge, previewCode: code } = await requested.json();
    assert.match(code, /^\d{6}$/);
    assert.equal((await post("login/code/request", first)).status, 429);
    assert.equal((await session()).viewer, null);
    const verification = { channel, identifier: normalized, challenge, code };
    assert.equal((await post("login/code/verify", { ...verification, challenge: "wrong" })).status, 401);
    const wrongCode = code === "000000" ? "000001" : "000000";
    assert.equal((await post("login/code/verify", { ...verification, code: wrongCode })).status, 401);
    const login = await post("login/code/verify", verification);
    assert.equal(login.status, 200);
    const memberCookie = cookie(login);
    assert.match(memberCookie, /^mianji_session_preview_4180=/);
    const { viewer } = await session(memberCookie);
    assert.equal(viewer.nickname, "");
    ids.push(viewer.id);
    assert.equal((await post("login/code/verify", verification)).status, 401);
    assert.equal((await post("logout", {}, { Cookie: memberCookie })).status, 200);
    assert.equal((await session(memberCookie)).viewer, null);

    now += 5000;
    const next = await post("login/code/request", first);
    assert.equal(next.status, 200);
    const nextCode = await next.json();
    const again = await post("login/code/verify", {
      ...first, challenge: nextCode.challenge, code: nextCode.previewCode,
    });
    assert.equal(again.status, 200);
    assert.equal((await session(cookie(again))).viewer.id, viewer.id);
  }
  assert.notEqual(ids[0], ids[1]);
});

test("Public verification sends through configured services and preserves a member's password account", async (t) => {
  const sent = [];
  let now = Date.UTC(2026, 10, 21);
  const delivery = createAuthDelivery({
    RESEND_API_KEY: "test-token", EMAIL_FROM: "no-reply@example.test",
    TENCENT_SMS_SECRET_ID: "test-id", TENCENT_SMS_SECRET_KEY: "test-key",
    TENCENT_SMS_APP_ID: "12345", TENCENT_SMS_SIGN_NAME: "test-sign", TENCENT_SMS_TEMPLATE_ID: "67890",
  }, async (url, options) => {
    sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return Response.json(url.includes("resend.com") ? { id: "email-test" }
      : { Response: { SendStatusSet: [{ Code: "Ok" }] } });
  }, () => now);
  const { store, session, post } = await loginServer(t, {
    origin: "https://map.example.test", delivery, preview: true, clock: () => now,
  });
  assert.equal((await session()).codeLogin.preview, false);
  const email = "member@example.test";
  const phone = "+8613800138000";
  const id = store.createPasswordAccount([email, phone], "unused-password-hash");
  const emailLogin = { channel: "email", identifier: email };
  assert.equal((await post("login/code/request", emailLogin, { "X-Forwarded-Proto": "http" })).status, 403);
  assert.equal((await post("login/code/request", emailLogin, { Origin: "https://another.example.test" })).status, 403);
  assert.equal(sent.length, 0);

  const emailRequest = await post("login/code/request", emailLogin);
  assert.equal(emailRequest.status, 200);
  const emailResult = await emailRequest.json();
  assert.equal(emailResult.previewCode, undefined);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.deepEqual(sent[0].body.to, [email]);
  const emailCode = /\d{6}/.exec(sent[0].body.text)[0];
  const signedIn = await post("login/code/verify", { ...emailLogin, challenge: emailResult.challenge, code: emailCode });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.headers.get("set-cookie"), /^__Host-mianji_session=.*; Secure$/);
  assert.equal((await session(cookie(signedIn))).viewer.id, id);

  const phoneLogin = { channel: "phone", identifier: phone };
  const smsRequest = await post("login/code/request", phoneLogin);
  assert.equal(smsRequest.status, 200);
  const smsResult = await smsRequest.json();
  assert.equal(smsResult.previewCode, undefined);
  assert.equal(sent[1].url, "https://sms.tencentcloudapi.com/");
  assert.equal(sent[1].headers["X-TC-Action"], "SendSms");
  assert.match(sent[1].headers.Authorization, /Credential=test-id\/2026-11-21\/sms\/tc3_request.*Signature=[a-f0-9]{64}$/);
  assert.deepEqual(sent[1].body.PhoneNumberSet, [phone]);
  const [smsCode] = sent[1].body.TemplateParamSet;
  const smsLogin = await post("login/code/verify", { ...phoneLogin, challenge: smsResult.challenge, code: smsCode });
  assert.equal(smsLogin.status, 200);
  assert.equal((await session(cookie(smsLogin))).viewer.id, id);

  now += 60_000;
  const reissue = await post("login/code/request", phoneLogin);
  assert.equal(reissue.status, 200);
  const { challenge } = await reissue.json();
  now += 5 * 60_000;
  assert.equal((await post("login/code/verify", {
    ...phoneLogin, challenge, code: sent[2].body.TemplateParamSet[0],
  })).status, 401);
});

test("The four bound login methods resolve to one profile, with session-bound proofs and ownership conflicts", async (t) => {
  const origin = "http://127.0.0.1:4181";
  let now = Date.now();
  const { get, post, put, session } = await loginServer(t, {
    origin, preview: true, providers: previewProviders(origin), clock: () => now,
  });

  async function codeProof(path, input, member) {
    const response = await post(path + "/request", input, { Cookie: member ?? "" });
    assert.equal(response.status, 200);
    const { challenge, previewCode: code } = await response.json();
    return { ...input, challenge, code };
  }

  async function signInContact(input) {
    now += 3000;
    const proof = await codeProof("login/code", input);
    const response = await post("login/code/verify", proof);
    assert.equal(response.status, 200);
    return cookie(response);
  }

  async function oauthStart(provider, member) {
    const response = member
      ? await post("bindings/" + provider + "/start", {}, { Cookie: member })
      : await get("/auth/" + provider + "/start");
    assert.equal(response.status, member ? 200 : 303);
    const target = new URL(member ? (await response.json()).url : response.headers.get("location"));
    return { browser: cookie(response), state: target.searchParams.get("state") };
  }

  const oauthFinish = (provider, { browser, state }, member = "", subject = "a") =>
    get("/auth/" + provider + "/callback?state=" + state + "&code=" + subject, browser + (member ? "; " + member : ""));
  const profile = async (member) => (await get("/api/profile", member)).json();
  const email = { channel: "email", identifier: "owner@example.test" };
  const phone = { channel: "phone", identifier: "13800138000" };
  const otherEmail = { channel: "email", identifier: "other@example.test" };
  const owner = await signInContact(email);
  const other = await signInContact(otherEmail);
  const originalId = (await session(owner)).viewer.id;
  const key = (await profile(owner)).accountKey;
  const save = await put("profile", { nickname: "保留的昵称", status: "hidden", rules: [] }, { Cookie: owner });
  assert.equal(save.status, 200);
  assert.equal((await post("bindings/code/request", phone)).status, 401);
  assert.equal((await post("bindings/qq/start", {}, { Cookie: owner, Origin: "https://other.example.test" })).status, 403);

  const phoneProof = await codeProof("bindings/code", phone, owner);
  assert.equal((await post("bindings/code/verify", phoneProof, { Cookie: other })).status, 401);
  assert.equal((await post("login/code/verify", phoneProof)).status, 401);
  assert.equal((await post("bindings/code/verify", phoneProof, { Cookie: owner })).status, 200);
  assert.equal((await post("bindings/code/verify", phoneProof, { Cookie: owner })).status, 401);

  const wrongSession = await oauthStart("qq", owner);
  assert.equal((await oauthFinish("qq", wrongSession, other)).headers.get("location"), "/?binding=expired#profile");
  for (const provider of ["qq", "mua"]) {
    const proof = await oauthStart(provider, owner);
    const bound = await oauthFinish(provider, proof, owner);
    assert.equal(bound.headers.get("location"), "/?binding=ok#profile");
    assert.deepEqual(bound.headers.getSetCookie(), []);
    const usedByOther = await oauthStart(provider, other);
    assert.equal((await oauthFinish(provider, usedByOther, other)).headers.get("location"), "/?binding=conflict#profile");
  }

  now += 3000;
  const duplicate = await codeProof("bindings/code", phone, other);
  assert.equal((await post("bindings/code/verify", duplicate, { Cookie: other })).status, 409);
  assert.equal((await post("logout", {}, { Cookie: owner })).status, 200);
  assert.equal((await session(owner)).viewer, null);

  const logins = [await signInContact(email), await signInContact(phone)];
  for (const provider of ["qq", "mua"]) {
    const signedIn = await oauthFinish(provider, await oauthStart(provider));
    assert.equal(signedIn.headers.get("location"), "/");
    logins.push(cookie(signedIn));
  }
  for (const login of logins) {
    assert.equal((await session(login)).viewer.id, originalId);
    const data = await profile(login);
    assert.equal(data.accountKey, key);
    assert.equal(data.profile.nickname, "保留的昵称");
    assert.deepEqual(data.bindings, { email: "o•••@example.test", phone: "••••8000", qq: true, mua: true });
  }
  const map = await (await get("/api/map", other)).json();
  assert.deepEqual(map.members, []);

});
