import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { hashPassword, loginIdentifier } from "./password.js";
import { openStore } from "./store.js";

try {
  const { values, positionals: [command, ...extra] } = parseArgs({
    options: { email: { type: "string" }, phone: { type: "string" } },
    allowPositionals: true,
  });
  const email = loginIdentifier(values.email);
  const phone = loginIdentifier(values.phone);
  const identifiers = [email, phone].filter(Boolean);

  if (extra.length || !["add", "reset"].includes(command) || !identifiers.length
    || (values.email !== undefined && !email?.includes("@"))
    || (values.phone !== undefined && !phone?.startsWith("+"))
    || (command === "reset" && identifiers.length !== 1)) {
    throw new Error("用法：server/member.js add --email 邮箱 --phone 手机号，或 reset 加其中一项。");
  }

  const file = resolve(process.env.DATABASE_PATH || "data/mianji.sqlite");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  process.umask(0o077);
  const password = randomBytes(20).toString("base64url");
  const hash = await hashPassword(password);
  const store = openStore(file);
  try {
    const id = command === "add" ? store.createPasswordAccount(identifiers, hash)
      : store.resetPassword(identifiers[0], hash);
    console.log("账号标识 password:" + id);
    console.log("登录密码 " + password);
  } finally {
    store.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
