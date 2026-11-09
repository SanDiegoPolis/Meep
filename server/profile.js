import { isDay, isMonthDay } from "./location.js";

export const fields = [
  { key: "nickname", label: "昵称", maxLength: 32, defaultPublic: true },
  { key: "school", label: "学校", maxLength: 80, defaultPublic: true },
  { key: "bio", label: "个人简介", maxLength: 400, defaultPublic: true },
  { key: "qq", label: "QQ 号", maxLength: 24, defaultPublic: false },
  { key: "wechat", label: "微信号", maxLength: 64, defaultPublic: false },
  { key: "clubRole", label: "在社团的职务", maxLength: 120, defaultPublic: true },
  { key: "pastRole", label: "历史职务", maxLength: 120, defaultPublic: true },
  { key: "mcRole", label: "在高校 MC 社区的职务", maxLength: 120, defaultPublic: true },
];

export const defaultSettings = {
  visibility: Object.fromEntries(fields.map(({ key, defaultPublic }) => [key, defaultPublic])),
  overrideDays: 2,
};

const alwaysEditableKeys = ["avatar", "home", "residence"];
const personalKeys = [...alwaysEditableKeys, ...fields.map(({ key }) => key)];

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
  for (const { key, label, maxLength } of fields) {
    profile[key] = settings.visibility[key] && Object.hasOwn(payload, key)
      ? field(payload[key], label, maxLength)
      : previousProfile[key] ?? "";
  }
  if (!Array.isArray(payload.rules) || payload.rules.length > 40) {
    throw new HttpError(400, "最多可保存 40 个地点时段。");
  }
  profile.rules = payload.rules.map((rule, index) => {
    const label = "时段 " + (index + 1) + " ";
    if (!rule || !["home", "residence", "trip"].includes(rule.kind) || typeof rule.annual !== "boolean") {
      throw new HttpError(400, label + "请选择有效的地点类型和重复方式。");
    }
    const { kind, annual, start, end } = rule;
    if (kind === "trip" && annual) throw new HttpError(400, label + "临时外出需要具体日期。");
    const validateDate = annual ? isMonthDay : isDay;
    if (!validateDate(start) || !validateDate(end) || (!annual && start > end)) {
      throw new HttpError(400, label + "请输入有效的起止日期。");
    }
    const city = kind === "trip" ? optionalCity(rule.city, cities) : profile[kind];
    if (!city) throw new HttpError(400, label + "请选择对应城市。");
    return kind === "trip" ? { kind, annual, start, end, city } : { kind, annual, start, end };
  });
  return profile;
}

function field(value, label, maxLength) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(400, label + "最多 " + maxLength + " 个字符。");
  }
  return value.trim();
}

function optionalCity(id, cities) {
  if (id == null) return null;
  if (!Number.isSafeInteger(id) || !cities.get(id)) {
    throw new HttpError(400, "请从城市搜索结果中选择地点。");
  }
  return id;
}

export function publicFields(profile, settings, cities, avatar) {
  const values = {
    avatar,
    home: cities.get(profile.home),
    residence: cities.get(profile.residence),
    ...Object.fromEntries(fields.filter(({ key }) => settings.visibility[key] && profile[key])
      .map(({ key }) => [key, profile[key]])),
  };
  return {
    status: profile.status,
    ...Object.fromEntries(Object.entries(values).filter(([key]) => profile.visibility?.[key] !== false)),
  };
}

export function validateSettings(payload) {
  if (!payload?.visibility || fields.some(({ key }) => typeof payload.visibility[key] !== "boolean")
      || !Number.isInteger(payload.overrideDays) || payload.overrideDays < 1 || payload.overrideDays > 30) {
    throw new HttpError(400, "请设置各资料项的显示开关，并填写 1 至 30 天的临时地点时长。");
  }
  return {
    visibility: Object.fromEntries(fields.map(({ key }) => [key, payload.visibility[key]])),
    overrideDays: payload.overrideDays,
  };
}
