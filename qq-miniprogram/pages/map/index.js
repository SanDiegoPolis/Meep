const examples = require("../../members.js");

const statuses = { available: "随时可约", busy: "请勿打扰" };
const fields = [
  ["school", "学校"], ["bio", "个人简介"], ["qq", "QQ 号"], ["wechat", "微信号"],
  ["clubRole", "在社团的职务"], ["pastRole", "历史职务"], ["mcRole", "在高校 MC 社区的职务"],
];

const members = examples.filter((member) => member.status !== "hidden").map((member) => ({
  ...member,
  displayName: member.nickname || "社区成员",
  initial: member.nickname ? Array.from(member.nickname)[0] : "·",
  statusLabel: statuses[member.status],
  facts: fields.filter(([key]) => member[key]).map(([key, label]) => ({ label, value: member[key] })),
}));

const groups = [];
for (const member of members) {
  const x = (member.city.lon + 180) / 360 * 100;
  const y = (84 - member.city.lat) * 1000 / (360 * 420) * 100;
  const nearby = groups.find((group) => Math.abs(group.x - x) < 15 && Math.abs(group.y - y) < 13);
  if (nearby) {
    nearby.members.push(member);
  } else {
    groups.push({
      id: groups.length,
      x, y, position: "left:" + x + "%;top:" + y + "%;",
      first: member, members: [member],
    });
  }
}

Page({
  data: { members, groups, nearby: [], selected: null, testingLogin: false, loginMessage: "" },

  openGroup(event) {
    const group = groups[Number(event.currentTarget.dataset.id)];
    if (!group) return;
    const single = group.members.length === 1;
    this.setData({ nearby: single ? [] : group.members, selected: single ? group.first : null });
  },

  showMember(event) {
    const member = members.find((item) => item.id === event.currentTarget.dataset.id);
    if (member) this.setData({ selected: member });
  },

  closeDetails() {
    this.setData({ nearby: [], selected: null });
  },

  testLogin() {
    this.setData({ testingLogin: true, loginMessage: "" });
    qq.login({
      success: ({ code }) => this.setData({
        testingLogin: false,
        loginMessage: code ? "已取得 QQ 登录凭证。正式接入时由服务端换取账号标识。" : "当前环境未返回登录凭证。",
      }),
      fail: () => this.setData({
        testingLogin: false, loginMessage: "QQ 登录未完成，请检查 AppID 和开发者权限后重试。",
      }),
    });
  },
});
