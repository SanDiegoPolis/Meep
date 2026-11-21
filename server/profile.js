import { isDay, isMonthDay } from "./location.js";

export const fields = [
  { key: "nickname", label: "昵称", maxLength: 32, defaultPublic: true },
  { key: "school", label: "学校", maxLength: 80, defaultPublic: true },
  { key: "bio", label: "个人简介", maxLength: 400, defaultPublic: true },
  { key: "qq", label: "QQ 号", maxLength: 24, defaultPublic: false },
  { key: "wechat", label: "微信号", maxLength: 64, defaultPublic: false },
  { key: "clubName", label: "社团名称", maxLength: 120, defaultPublic: true },
  { key: "clubRole", label: "社团职务", maxLength: 120, defaultPublic: true },
  { key: "pastRole", label: "社团历史职务", maxLength: 120, defaultPublic: true },
  { key: "mcRole", label: "在社区的职务", maxLength: 120, defaultPublic: true },
];

export const defaultSettings = {
  visibility: Object.fromEntries(fields.map(({ key, defaultPublic }) => [key, defaultPublic])),
  overrideDays: 2,
};

const alwaysEditableKeys = ["avatar", "home", "residence"];
const personalKeys = [...alwaysEditableKeys, ...fields.map(({ key }) => key)];
const roleKeys = ["clubRole", "pastRole"];

export function selectedClubRole(profile) {
  return roleKeys.includes(profile.roleKind) ? profile.roleKind : roleKeys.find((key) => profile[key]) ?? null;
}

export function personalVisibility(profile) {
  return Object.fromEntries(personalKeys.map((key) => [key, profile.visibility?.[key] !== false]));
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function initialProfile(nickname = "") {
  return {
    status: "hidden", home: null, residence: null, rules: [],
    ...Object.fromEntries(fields.map(({ key }) => [key, ""])),
    nickname,
    visibility: { ...personalVisibility({}), qq: false, wechat: false },
  };
}

export function validateProfile(payload, cities, previousProfile, settings) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "资料格式有误。");
  }
  if (!["available", "busy", "hidden"].includes(payload.status)) {
    throw new HttpError(400, "请选择地图状态。");
  }
  const visibility = personalVisibility(previousProfile);
  if (payload.visibility !== undefined) {
    const submitted = payload.visibility;
    if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
      throw new HttpError(400, "可见性设置格式有误。");
    }
    for (const [key, value] of Object.entries(submitted)) {
      if (key === "status") continue; // Ignore the retired map status visibility control.
      if (!personalKeys.includes(key) || typeof value !== "boolean") {
        throw new HttpError(400, "可见性设置格式有误。");
      }
      if (alwaysEditableKeys.includes(key) || settings.visibility[key]) visibility[key] = value;
    }
  }
  const profile = {
    status: payload.status,
    home: optionalCity(payload.home, cities),
    residence: optionalCity(payload.residence, cities),
    rules: [],
    visibility,
  };
  const requestedRole = payload.roleKind;
  if (requestedRole !== undefined && !roleKeys.includes(requestedRole)) {
    throw new HttpError(400, "请选择社团职务或社团历史职务。");
  }
  const editableRole = requestedRole && settings.visibility[requestedRole] ? requestedRole : null;
  for (const { key, label, maxLength } of fields) {
    const editable = settings.visibility[key] && (requestedRole === undefined || !roleKeys.includes(key) || key === editableRole);
    profile[key] = editable && Object.hasOwn(payload, key)
      ? field(payload[key], label, maxLength)
      : previousProfile[key] ?? "";
  }
  profile.roleKind = editableRole ?? previousProfile.roleKind ?? selectedClubRole(profile);
  if (!Array.isArray(payload.rules) || payload.rules.length > 40) {
    throw new HttpError(400, "最多可保存 40 个地点时段。");
  }
  const scheduleLabels = { home: "老家时段", residence: "常驻地时段", trip: "临时外出时段" };
  let tripCount = 0;
  profile.rules = payload.rules.map((rule) => {
    if (typeof rule?.kind !== "string" || !Object.hasOwn(scheduleLabels, rule.kind)) {
      throw new HttpError(400, "请设置有效的时段地点类型。");
    }
    const { kind, annual, start, end } = rule;
    const label = kind === "trip" ? scheduleLabels.trip + " " + ++tripCount : scheduleLabels[kind];
    if (typeof annual !== "boolean") throw new HttpError(400, label + "的重复方式无效。");
    if (kind === "trip" && annual) throw new HttpError(400, label + "需要填写具体日期。");
    const validateDate = annual ? isMonthDay : isDay;
    if (!validateDate(start) || !validateDate(end) || (!annual && start > end)) {
      throw new HttpError(400, "请为「" + label + "」填写有效的起止日期。");
    }
    if (kind === "trip") {
      const message = "请为「" + label + "」选择外出城市。";
      const city = optionalCity(rule.city, cities, message);
      if (!city) throw new HttpError(400, message);
      return { kind, annual, start, end, city };
    }
    if (!profile[kind]) throw new HttpError(400, "请先为「" + label + "」选择城市。");
    return { kind, annual, start, end };
  });
  for (const [kind, label] of [["home", "老家"], ["residence", "常驻地"]]) {
    const rules = profile.rules.filter((rule) => rule.kind === kind);
    const previous = previousProfile.rules.filter((rule) => rule.kind === kind);
    if (rules.length > 1 && (rules.length !== previous.length || !rules.every((rule, index) => sameDates(rule, previous[index])))) {
      throw new HttpError(400, label + "最多设置一个时段，请保留一条或清空。");
    }
    if (rules.some((rule) => !rule.annual && !previous.some((old) => sameDates(rule, old)))) {
      throw new HttpError(400, label + "的时段每年重复，请填写月日。");
    }
  }
  return profile;
}

function sameDates(rule, other) {
  return rule.annual === other.annual && rule.start === other.start && rule.end === other.end;
}

function field(value, label, maxLength) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, label + "最多 " + maxLength + " 个字符。");
  }
  return value.trim();
}

function optionalCity(id, cities, message = "请从城市搜索结果中选择地点。") {
  if (id == null) return null;
  if (!Number.isSafeInteger(id) || !cities.get(id)) {
    throw new HttpError(400, message);
  }
  return id;
}

export function publicFields(profile, settings, cities, avatar) {
  const activeRole = selectedClubRole(profile);
  const values = {
    avatar,
    home: cities.get(profile.home),
    residence: cities.get(profile.residence),
    ...Object.fromEntries(fields.filter(({ key }) => settings.visibility[key] && profile[key]
      && (!roleKeys.includes(key) || key === activeRole))
      .map(({ key }) => [key, profile[key]])),
  };
  return {
    status: profile.status,
    ...Object.fromEntries(Object.entries(values).filter(([key]) => profile.visibility?.[key] !== false)),
  };
}

export function validateSettings(payload, previousSettings = defaultSettings) {
  const visibility = { ...payload?.visibility };
  if (!Object.hasOwn(visibility, "clubName")) visibility.clubName = previousSettings.visibility.clubName;
  if (!payload?.visibility || fields.some(({ key }) => typeof visibility[key] !== "boolean")
      || !Number.isInteger(payload.overrideDays) || payload.overrideDays < 1 || payload.overrideDays > 30) {
    throw new HttpError(400, "请设置各资料项的显示开关，并填写 1 至 30 天的临时地点时长。");
  }
  return {
    visibility: Object.fromEntries(fields.map(({ key }) => [key, visibility[key]])),
    overrideDays: payload.overrideDays,
  };
}
