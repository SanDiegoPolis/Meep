import { randomInt, timingSafeEqual } from "node:crypto";
import { loginIdentifier } from "./password.js";
import { HttpError } from "./profile.js";
import { nonce } from "./store.js";

const minute = 60_000;
const hour = 60 * minute;

export function createVerification(delivery = {}, preview = false, clock = Date.now) {
  const enabled = { email: preview || Boolean(delivery.email), phone: preview || Boolean(delivery.phone) };
  const resendWait = preview ? 3000 : minute;
  const requests = new Map();
  const budgets = new Map();
  let sweepAt = 0;

  function validIdentifier(channel, value) {
    if (channel !== "email" && channel !== "phone") throw new HttpError(400, "请选择登录方式。");
    if (!enabled[channel]) throw new HttpError(503, "本站尚未开通此渠道的验证码登录。");
    const identifier = loginIdentifier(value);
    if (!identifier || identifier.includes("@") !== (channel === "email")) {
      throw new HttpError(400, channel === "email" ? "请填写有效的邮箱地址。" : "请填写有效的手机号。");
    }
    return identifier;
  }

  return {
    enabled, preview,
    async send({ channel, identifier: input }, bindSession = null) {
      const identifier = validIdentifier(channel, input);
      const now = clock();
      if (now >= sweepAt) {
        for (const [key, request] of requests) {
          if (request.until <= now && !request.pending) requests.delete(key);
        }
        sweepAt = now + minute;
      }
      const prior = requests.get(identifier);
      const request = prior?.until > now ? prior : { until: now + hour, count: 0, nextSend: 0 };
      const window = Math.floor(now / minute);
      const current = budgets.get(channel);
      const budget = current?.window === window ? current : { window, count: 0 };
      if (prior?.pending || request.nextSend > now || request.count >= 5 || budget.count >= 30) {
        throw new HttpError(429, "验证码发送太频繁，请稍后再试。");
      }
      request.count++;
      request.nextSend = now + resendWait;
      request.pending = true;
      budget.count++;
      requests.set(identifier, request);
      budgets.set(channel, budget);

      const code = randomInt(1_000_000).toString().padStart(6, "0");
      const challenge = nonce();
      try {
        if (!preview) await delivery[channel](identifier, code);
      } catch {
        throw new HttpError(502, "验证码发送失败，请稍后重试。");
      } finally {
        request.pending = false;
      }
      request.verification = { code, challenge, bindSession, expires: clock() + 5 * minute, attempts: 0 };
      return preview ? { challenge, previewCode: code } : { challenge };
    },
    verify({ channel, identifier: input, challenge, code }, bindSession = null) {
      const identifier = validIdentifier(channel, input);
      const request = requests.get(identifier);
      const verification = request?.verification;
      if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw new HttpError(400, "请输入六位验证码。");
      if (!verification || verification.challenge !== challenge || verification.bindSession !== bindSession
          || verification.expires <= clock()) {
        throw new HttpError(401, "验证码已失效，请重新获取。");
      }
      if (++verification.attempts >= 5) delete request.verification;
      if (!timingSafeEqual(Buffer.from(verification.code), Buffer.from(code))) {
        throw new HttpError(401, "验证码不正确，请检查后重试。");
      }
      delete request.verification;
      return identifier;
    },
  };
}
