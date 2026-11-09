import { initialProfile } from "./profile.js";

export const demoLogins = {
  member: { city: 1796236 },
  admin: { city: 1808926 },
};

export function seedDemo(store) {
  const members = [
    ["admin", "小满", 1796236, "available", "上海交通大学", "社团负责人", "一起造城，也一起约饭。"],
    ["member", "林间", 1799962, "available", "南京大学", "建筑组成员", "最近在做校园复原，有空来服务器逛逛。"],
    ["yu", "小雨", 1796236, "busy", "同济大学", "活动策划", "喜欢下雨天和雨后的方块世界。"],
    ["he", "青禾", 1816670, "available", "北京大学", "", "生存档和红石装置。"],
    ["mian", "棉花", 1815286, "available", "四川大学", "建筑组成员", ""],
    ["star", "星野", 1850147, "busy", "", "", "今年在东京交换。"],
    ["lu", "白露", 1880252, "available", "", "", "周末有空，欢迎约面。"],
    ["mai", "麦田", 2643743, "available", "", "", "日落时喜欢散步。"],
    ["cheng", "橙子", 6167865, "busy", "", "", ""],
    ["sea", "阿屿", 5391959, "available", "", "", "最近在找一起联机的朋友。"],
    ["nan", "南风", 2158177, "available", "", "", ""],
  ];
  for (const [subject, nickname, city, status, school, clubRole, bio] of members) {
    const profile = { ...initialProfile(nickname), status, school, clubRole, bio, residence: city };
    if (Object.hasOwn(demoLogins, subject)) {
      profile.home = subject === "admin" ? 1799962 : 1808926;
      profile.rules = [{ kind: "residence", annual: true, start: "01-01", end: "12-31" }];
    }
    store.seedDemo(subject, profile, city);
  }
}
