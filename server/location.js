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

export function scheduledCity(profile, day) {
  const applicable = profile.rules.filter((rule) => matches(rule, day));
  const rule = applicable.findLast((item) => item.kind === "trip")
    ?? applicable.findLast((item) => !item.annual)
    ?? applicable.at(-1);
  if (!rule) return null;
  return rule.kind === "trip" ? rule.city : profile[rule.kind];
}

export function activeOverride(account, now) {
  if (account.override_until > now) {
    return { city: account.override_city, expiresAt: account.override_until };
  }
  return null;
}

export function mapCity(account, day, now) {
  return activeOverride(account, now)?.city
    ?? scheduledCity(account.profile, day)
    ?? account.last_login_city
    ?? account.profile.residence
    ?? account.profile.home;
}
