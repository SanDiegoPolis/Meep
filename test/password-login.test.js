import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../server/app.js";
import { loadCities } from "../server/cities.js";
import { hashPassword, loginIdentifier } from "../server/password.js";
import { openStore } from "../server/store.js";

test("Email and phone share an account, and a password reset invalidates existing sessions", async () => {
  const origin = "https://map.example.test";
  const store = openStore(":memory:");
  const server = createApp({
    store, cities: loadCities(), providers: {}, geo: { city: async () => null, country: async () => null },
    origin, timeZone: "Asia/Shanghai", admins: new Set(),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const session = (cookie) => fetch(base + "/api/session", { headers: cookie ? { Cookie: cookie } : {} }).then(res => res.json());
  const login = (identifier, password, protocol = "https") => fetch(base + "/api/login/password", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-Proto": protocol },
    body: JSON.stringify({ identifier, password }),
  });
  const email = "member@example.test";
  const phone = "13800138000";
  const password = "test-password-used-before-reset";

  try {
    assert.equal((await session()).passwordLoginOrigin, null);
    const hash = await hashPassword(password);
    const id = store.createPasswordAccount([email, loginIdentifier(phone)], hash);
    assert.throws(() => store.createPasswordAccount([email, "+12025550123"], hash), /已开通/);
    assert.equal(store.passwordCredential("+12025550123"), undefined);
    assert.equal((await session()).passwordLoginOrigin, origin);
    assert.equal((await login(email, password, "http")).status, 403);
    assert.equal((await login(email, "wrong-password")).status, 401);
    const byEmail = await login(email.toUpperCase(), password);
    const byPhone = await login(phone, password);
    assert.equal(byEmail.status, 200);
    assert.equal(byPhone.status, 200);
    const emailCookie = byEmail.headers.get("set-cookie");
    assert.match(emailCookie, /^__Host-mianji_session=.*; HttpOnly;.*; Secure$/);
    const first = await session(emailCookie.split(";")[0]);
    const second = await session(byPhone.headers.get("set-cookie").split(";")[0]);
    assert.equal(first.viewer.id, id);
    assert.deepEqual(first.viewer, second.viewer);
    assert.ok(!JSON.stringify(first).includes(email));
    assert.ok(!JSON.stringify(first).includes(phone));

    const nextPassword = "test-password-used-after-reset";
    store.resetPassword(loginIdentifier(phone), await hashPassword(nextPassword));
    assert.equal((await session(emailCookie.split(";")[0])).viewer, null);
    assert.equal((await login(email, password)).status, 401);
    assert.equal((await login(email, nextPassword)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
