import { createHmac } from "node:crypto";
import { digest } from "./store.js";

const json = "application/json; charset=utf-8";
const smsHost = "sms.tencentcloudapi.com";
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

export function createAuthDelivery(env, request = fetch, clock = Date.now) {
  const delivery = {};
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    delivery.email = async (identifier, code) => {
      const response = await post("https://api.resend.com/emails", {
        from: env.EMAIL_FROM,
        to: [identifier],
        subject: "面基地图登录验证码",
        text: "你的面基地图登录验证码为 " + code + "，五分钟内有效。",
      }, { Authorization: "Bearer " + env.RESEND_API_KEY });
      if (!response.id) throw new Error("Resend did not accept the email.");
    };
  }

  const {
    TENCENT_SMS_SECRET_ID: secretId,
    TENCENT_SMS_SECRET_KEY: secretKey,
    TENCENT_SMS_APP_ID: appId,
    TENCENT_SMS_SIGN_NAME: signName,
    TENCENT_SMS_TEMPLATE_ID: templateId,
    TENCENT_SMS_REGION: region = "ap-guangzhou",
  } = env;
  if (secretId && secretKey && appId && signName && templateId) {
    delivery.phone = async (identifier, code) => {
      const timestamp = Math.floor(clock() / 1000);
      const payload = {
        PhoneNumberSet: [identifier], SmsSdkAppId: appId, SignName: signName,
        TemplateId: templateId, TemplateParamSet: [code],
      };
      const response = await post("https://" + smsHost + "/", payload, {
        Authorization: smsAuthorization(secretId, secretKey, timestamp, JSON.stringify(payload)),
        "X-TC-Action": "SendSms",
        "X-TC-Version": "2021-01-11",
        "X-TC-Timestamp": String(timestamp),
        "X-TC-Region": region || "ap-guangzhou",
      });
      if (response.Response?.SendStatusSet?.[0]?.Code !== "Ok") throw new Error("Tencent Cloud did not accept the SMS.");
    };
  }
  return delivery;

  async function post(url, payload, headers) {
    const response = await request(url, {
      method: "POST", headers: { "Content-Type": json, ...headers },
      body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Delivery request failed.");
    }
    return response.json();
  }
}

function smsAuthorization(secretId, secretKey, timestamp, payload) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = date + "/sms/tc3_request";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalHeaders = "content-type:" + json + "\nhost:" + smsHost + "\nx-tc-action:sendsms\n";
  const canonical = ["POST", "/", "", canonicalHeaders, signedHeaders, digest(payload)].join("\n");
  const toSign = ["TC3-HMAC-SHA256", timestamp, scope, digest(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac("TC3" + secretKey, date), "sms"), "tc3_request");
  const signature = hmac(signingKey, toSign).toString("hex");
  return "TC3-HMAC-SHA256 Credential=" + secretId + "/" + scope
    + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
}
