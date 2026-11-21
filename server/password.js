import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError } from "./profile.js";

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const dummyHash = randomBytes(64).toString("hex");

export function loginIdentifier(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const input = value.trim();
  if (/^[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(input)) return input.toLowerCase();
  const phone = input.replace(/[ ()-]/g, "");
  if (/^1[3-9]\d{9}$/.test(phone)) return "+86" + phone;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export async function hashPassword(password) {
  const salt = randomBytes(32);
  const hash = await derive(password, salt, 32, options);
  return salt.toString("hex") + hash.toString("hex");
}

export function passwordLogin(store) {
  const attempts = new Map();
  let sweepAt = 0;
  let availableAt = 0;
  let remaining = 0;
  let running = 0;

  return async ({ identifier, password }, now) => {
    const login = loginIdentifier(identifier);
    if (!login || typeof password !== "string" || !password || Buffer.byteLength(password) > 256) {
      throw new HttpError(400, "请填写有效的邮箱或手机号和密码。");
    }

    const credential = store.passwordCredential(login);
    const key = credential?.subject ?? login;
    if (now >= sweepAt) {
      for (const [id, attempt] of attempts) {
        if (attempt.until <= now) attempts.delete(id);
      }
      sweepAt = now + 60_000;
    }
    const prior = attempts.get(key);
    const attempt = prior?.until > now ? prior : { count: 0, until: now + 15 * 60_000 };
    if (now >= availableAt) {
      remaining = 120;
      availableAt = now + 60_000;
    }
    if (attempt.count >= 8 || remaining <= 0 || running >= 3) {
      throw new HttpError(429, "登录尝试过多，请稍后再试。");
    }
    remaining--;
    attempt.count++;
    attempts.set(key, attempt);

    const stored = Buffer.from(credential?.hash ?? dummyHash, "hex");
    running++;
    let derived;
    try {
      derived = await derive(password, stored.subarray(0, 32), 32, options);
    } finally {
      running--;
    }
    if (!timingSafeEqual(derived, stored.subarray(32)) || !credential) {
      throw new HttpError(401, "邮箱、手机号或密码不正确。");
    }
    attempts.delete(key);
    return { provider: "password", subject: credential.subject, passwordHash: credential.hash };
  };
}
