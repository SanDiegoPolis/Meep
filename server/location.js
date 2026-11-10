export function calendar(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return (timestamp) => formatter.format(timestamp);
}

export function isDay(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isMonthDay(value) {
  return typeof value === "string" && isDay("2000-" + value);
}

function matches(rule, day) {
  if (!rule.annual) return rule.start <= day && day <= rule.end;
  const monthDay = day.slice(5);
  if (rule.start <= rule.end) return rule.start <= monthDay && monthDay <= rule.end;
  return rule.start <= monthDay || monthDay <= rule.end;
}

function ruleCity(profile, rule) {
  return rule.kind === "trip" ? rule.city : profile[rule.kind];
}

export function scheduledCity(profile, day, isAvailable = Number.isSafeInteger) {
  const applicable = profile.rules.filter((rule) => matches(rule, day) && isAvailable(ruleCity(profile, rule)));
  const rule = applicable.findLast((item) => item.kind === "trip")
    ?? applicable.findLast((item) => !item.annual)
    ?? applicable.at(-1);
  return rule ? ruleCity(profile, rule) : null;
}

export function activeOverride(account, now, isAvailable = Number.isSafeInteger) {
  if (account.override_until > now && isAvailable(account.override_city)) {
    return { city: account.override_city, expiresAt: account.override_until };
  }
  return null;
}

export function mapCity(account, day, now, isAvailable = Number.isSafeInteger) {
  const { profile } = account;
  return activeOverride(account, now, isAvailable)?.city
    ?? scheduledCity(profile, day, isAvailable)
    ?? [account.last_login_city, profile.residence, profile.home].find(isAvailable)
    ?? null;
}
