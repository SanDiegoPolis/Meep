import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { activeOverride, scheduledCity } from "./location.js";
import { defaultSettings, HttpError, initialProfile } from "./profile.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROMPT_MS = 10 * 60 * 1000;

export const nonce = () => randomBytes(32).toString("base64url");
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const validNonce = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      avatar TEXT,
      profile TEXT NOT NULL,
      last_login_city INTEGER,
      last_login_session TEXT,
      override_city INTEGER,
      override_until INTEGER,
      UNIQUE (provider, subject)
    );
    CREATE TABLE IF NOT EXISTS profile_avatars (
      user_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      revision TEXT NOT NULL,
      image BLOB,
      qq_url TEXT,
      CHECK ((image IS NULL) <> (qq_url IS NULL))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      observed_city INTEGER,
      expected_city INTEGER,
      prompt_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      browser_hash TEXT NOT NULL,
      provider TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      verifier TEXT,
      avatar_session_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      settings TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO site_settings VALUES (1, ?)").run(JSON.stringify(defaultSettings));

  function transaction(operation) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function account(row) {
    return row ? { ...row, profile: JSON.parse(row.profile) } : null;
  }

  transaction(() => {
    if (!db.prepare("PRAGMA table_info(oauth_states)").all().some(({ name }) => name === "avatar_session_hash")) {
      db.exec("ALTER TABLE oauth_states ADD COLUMN avatar_session_hash TEXT");
    }
  });

  const accountsWithAvatars = `
    SELECT accounts.*, COALESCE(qq_url, '/api/avatars/' || user_id || '/' || revision, accounts.avatar) AS display_avatar
    FROM accounts LEFT JOIN profile_avatars ON profile_avatars.user_id = accounts.id
  `;
  const accountById = db.prepare(accountsWithAvatars + " WHERE accounts.id = ?");
  const setAvatar = db.prepare(`
    INSERT INTO profile_avatars (user_id, revision, image, qq_url) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, image = excluded.image, qq_url = excluded.qq_url
  `);

  function settings() {
    return JSON.parse(db.prepare("SELECT settings FROM site_settings WHERE id = 1").get().settings);
  }

  function getSession(token, now) {
    if (!validNonce(token)) return null;
    const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?").get(digest(token), now);
    if (!session) return null;
    return { session, account: account(accountById.get(session.user_id)) };
  }

  function prompt(context, day, now) {
    const { account: user, session } = context;
    if (session.token_hash !== user.last_login_session || session.prompt_until <= now) return null;
    if (scheduledCity(user.profile, day) !== session.expected_city) return null;
    return { observed: session.observed_city, expected: session.expected_city };
  }

  const insertAccount = db.prepare(`
    INSERT INTO accounts (id, provider, subject, avatar, profile, last_login_city)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, subject) DO NOTHING
  `);

  function signIn(identity, observedCity, now, day, previousToken) {
    const token = nonce();
    const tokenHash = digest(token);
    transaction(() => {
      insertAccount.run(randomUUID(), identity.provider, identity.subject, identity.avatar,
        JSON.stringify(initialProfile(identity.nickname)), null);
      const user = account(db.prepare("SELECT * FROM accounts WHERE provider = ? AND subject = ?")
        .get(identity.provider, identity.subject));
      const expected = scheduledCity(user.profile, day);
      const needsPrompt = observedCity && expected && observedCity !== expected
        && activeOverride(user, now)?.city !== observedCity;
      db.prepare(`
        UPDATE accounts SET last_login_city = COALESCE(?, last_login_city),
          last_login_session = ?, avatar = COALESCE(?, avatar) WHERE id = ?
      `).run(observedCity, tokenHash, identity.avatar, user.id);
      db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      if (validNonce(previousToken)) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(previousToken));
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)").run(
        tokenHash, user.id, now + 30 * DAY_MS,
        needsPrompt ? observedCity : null, needsPrompt ? expected : null, needsPrompt ? now + PROMPT_MS : null,
      );
    });
    return token;
  }

  return {
    settings,
    signIn,
    getSession,
    prompt,
    close: () => db.close(),
    rememberOAuth(state, browser, provider, verifier, now, avatarSessionHash = null) {
      db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
      db.prepare(`
        INSERT INTO oauth_states (state_hash, browser_hash, provider, expires_at, verifier, avatar_session_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(digest(state), digest(browser), provider, now + PROMPT_MS, verifier, avatarSessionHash);
    },
    takeOAuth(state, browser, provider, now) {
      if (!validNonce(state) || !validNonce(browser)) return null;
      return db.prepare(`
        DELETE FROM oauth_states WHERE state_hash = ? AND browser_hash = ?
          AND provider = ? AND expires_at > ? RETURNING verifier, avatar_session_hash
      `).get(digest(state), digest(browser), provider, now);
    },
    signOut(token) {
      if (validNonce(token)) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
    },
    visibleAccounts() {
      return db.prepare(accountsWithAvatars + " WHERE json_extract(profile, '$.status') != 'hidden'")
        .all().map(account);
    },
    uploadedAvatar(id, revision) {
      return account(db.prepare(`
        SELECT accounts.*, image FROM profile_avatars JOIN accounts ON accounts.id = profile_avatars.user_id
        WHERE user_id = ? AND revision = ? AND image IS NOT NULL
      `).get(id, revision));
    },
    syncQQAvatar(id, url) {
      setAvatar.run(id, randomUUID(), null, url);
    },
    saveProfile(id, profile, day, image) {
      return transaction(() => {
        db.prepare("UPDATE accounts SET profile = ? WHERE id = ?").run(JSON.stringify(profile), id);
        if (image) setAvatar.run(id, randomUUID(), image, null);
        db.prepare(`
          UPDATE sessions SET observed_city = NULL, expected_city = NULL, prompt_until = NULL
          WHERE user_id = ? AND expected_city IS NOT ?
        `).run(id, scheduledCity(profile, day));
        return account(accountById.get(id));
      });
    },
    saveSettings(value) {
      db.prepare("UPDATE site_settings SET settings = ? WHERE id = 1").run(JSON.stringify(value));
    },
    answerPrompt(token, accepted, day, now) {
      transaction(() => {
        const context = getSession(token, now);
        const pending = context && prompt(context, day, now);
        if (!pending) throw new HttpError(409, "这条地点提示已处理或已过期。");
        if (accepted) {
          db.prepare("UPDATE accounts SET override_city = ?, override_until = ? WHERE id = ?")
            .run(pending.observed, now + settings().overrideDays * DAY_MS, context.account.id);
        }
        db.prepare(`
          UPDATE sessions SET observed_city = NULL, expected_city = NULL, prompt_until = NULL
          WHERE token_hash = ?
        `).run(context.session.token_hash);
      });
    },
    endOverride(id) {
      db.prepare("UPDATE accounts SET override_city = NULL, override_until = NULL WHERE id = ?").run(id);
    },
    seedDemo(subject, profile, city) {
      insertAccount.run(randomUUID(), "demo", subject, null, JSON.stringify(profile), city);
    },
  };
}
