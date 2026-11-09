import { $, api, avatar, cityLabel, el, heading, icon, iconButton, statusPill } from "./ui.js";
import { mountMapView } from "./map-view.js";

const collator = new Intl.Collator("zh-CN");
const nickname = (member) => member.nickname || "社区成员";

export function mountMap(main, session, onDemoLogin, onSessionExpired) {
  main.replaceChildren(heading("世界地图", "看看同好们此刻在哪座城市。"));

  const layout = el("div", "map-layout");
  layout.innerHTML = `
    <section class="map-card" aria-label="世界地图">
      <div class="map-stage" role="group" tabindex="0" aria-label="地图视角，用方向键平移，用加减键缩放">
        <div class="map-surface" role="img" aria-label="世界地图底图"></div>
        <div class="map-chrome">${icon("globe")}<span class="map-view-label"></span></div>
        <div class="map-pins" aria-label="成员地图标记"></div>
        <div class="map-mask empty" hidden><p class="map-empty"></p></div>
      </div>
      <div class="map-footer">
        <span>${icon("pin")} 城市级定位</span>
        <span class="map-count"></span>
      </div>
    </section>
    <aside class="panel ${session.viewer ? "roster" : ""}" aria-label="地图成员"></aside>`;
  main.append(layout);

  const stage = $(".map-stage", layout);
  const pins = $(".map-pins", layout);
  const empty = $(".map-mask", layout);
  const count = $(".map-count", layout);
  const roster = $(".panel", layout);
  const controls = new AbortController();
  const { signal } = controls;
  const popover = createPopover(session.fields, signal);
  let members = [];
  let signature = null;
  let query = "";
  let loading = Boolean(session.viewer);
  let message = "";
  let fetching = false;
  let queued = false;
  const view = mountMapView(stage, session.mapCountry, renderPins, signal);

  if (session.viewer) {
    roster.innerHTML = `
      <div class="panel-heading"><h2>地图成员</h2><span class="badge" id="roster-count">—</span></div>
      <label class="searchbox">${icon("search")}<input type="search" maxlength="80" placeholder="搜索昵称或城市" aria-label="搜索地图成员"></label>
      <div class="roster-list"></div>`;
    $("input", roster).addEventListener("input", (event) => {
      query = event.target.value.trim().toLocaleLowerCase();
      redraw();
    });
    redraw();
    void refresh();
  } else {
    roster.innerHTML = `
      <div class="panel-heading"><h2>如何使用地图</h2></div>
      <ul class="guide-list">
        <li>${icon("pin")}<div><strong>城市级位置</strong>地图上的位置以城市为单位。</div></li>
        <li>${icon("calendar")}<div><strong>设置地点时段</strong>为老家、常驻地和临时外出安排日期。</div></li>
        <li>${icon("shield")}<div><strong>控制地图可见性</strong>设置可约状态，或选择隐身。</div></li>
      </ul>`;
    const login = el("div", "map-mask");
    login.innerHTML = `
      <section class="login-card" id="login">
        <h2>登录查看地图成员</h2>
        <p>${session.demo ? "使用本机演示账号体验成员地图。" : "使用 QQ 或 Minecraft 高校联盟账号继续。"}</p>
        <div class="login-actions"></div>
      </section>`;
    stage.append(login);
    const actions = $(".login-actions", login);
    if (session.demo) {
      for (const [account, label, type] of [
        ["member", "体验成员", "primary"], ["admin", "体验管理员", "secondary"],
      ]) {
        const control = el("button", "button " + type, label);
        control.type = "button";
        control.addEventListener("click", () => onDemoLogin(account, actions));
        actions.append(control);
      }
    } else {
      for (const [provider, label] of [["qq", "QQ 登录"], ["mua", "MUA 登录"]]) {
        const enabled = session.providers[provider];
        const control = el(enabled ? "a" : "button", "button " + (provider === "qq" ? "primary" : "secondary"), label);
        if (enabled) control.href = "/auth/" + provider + "/start";
        else control.disabled = true;
        actions.append(control);
      }
      if (!session.providers.qq || !session.providers.mua) {
        $(".login-card", login).append(el("p", "hint", "灰色入口等待站点管理员配置。"));
      }
    }
    count.textContent = "登录后显示成员";
  }

  return { refresh, dispose };

  function visibleMembers() {
    if (!query) return members;
    return members.filter((member) => [member.nickname, cityLabel(member.city)].some(
      (value) => value?.toLocaleLowerCase().includes(query),
    ));
  }

  function redraw() {
    popover.close();
    renderPins();
    const visible = visibleMembers();
    $("#roster-count", roster).textContent = visible.length + " 人";
    const list = $(".roster-list", roster);
    list.replaceChildren();
    if (!visible.length) {
      list.append(el("p", "roster-empty", message || (loading ? "正在加载成员…" : query ? "没有匹配的成员。" : "暂无公开位置的成员。")));
    }
    for (const member of visible) {
      const row = memberRow(member);
      popover.bind(row, [member], { preview: false });
      list.append(row);
    }
    const cities = new Set(members.map((member) => member.city.id)).size;
    count.textContent = loading ? "正在加载…" : members.length + " 位成员 · " + cities + " 座城市";
    empty.hidden = Boolean(visible.length);
    $(".map-empty", empty).textContent = message || (loading ? "正在加载地图…" : query ? "没有匹配的位置" : "还没有成员显示在地图上");
  }

  function renderPins() {
    if (!session.viewer) return;
    popover.close();
    const groups = cluster(visibleMembers(), view.point, stage.clientWidth, stage.clientHeight);
    const nodes = groups.map((group) => {
      const member = group.members[0];
      const pin = el("button", "map-pin" + (!member.nickname && group.members.length === 1 ? " only-avatar" : ""));
      if (group.x < .045) pin.classList.add("edge-left");
      if (group.x > .955) pin.classList.add("edge-right");
      pin.type = "button";
      pin.style.left = group.x * 100 + "%";
      pin.style.top = group.y * 100 + "%";
      pin.append(avatar(member, "pin-avatar"));
      if (member.nickname) pin.append(el("span", "pin-name", member.nickname));
      if (group.members.length > 1) pin.append(el("span", "pin-count", "+" + (group.members.length - 1)));
      pin.setAttribute("aria-label", group.members.length > 1
        ? group.members.length + " 位相邻成员"
        : member.city.name + " · " + nickname(member));
      popover.bind(pin, group.members);
      return pin;
    });
    pins.replaceChildren(...nodes);
  }

  async function refresh() {
    if (!session.viewer || signal.aborted) return;
    if (fetching) {
      queued = true;
      return;
    }
    fetching = true;
    try {
      const data = await api("/api/map", "GET", undefined, signal);
      if (signal.aborted) return;
      const next = JSON.stringify(data.members);
      if (signature === next && !message) return;
      signature = next;
      members = data.members.sort((a, b) => collator.compare(a.city.name, b.city.name) || collator.compare(nickname(a), nickname(b)));
      loading = false;
      message = "";
      redraw();
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 401) {
        onSessionExpired();
        return;
      }
      // Avoid leaving previously visible profiles on screen when refresh fails.
      members = [];
      signature = null;
      loading = false;
      message = "地图加载失败，稍后自动重试。";
      redraw();
    } finally {
      fetching = false;
      if (queued) {
        queued = false;
        void refresh();
      }
    }
  }

  function dispose() {
    controls.abort();
    popover.close();
  }
}

function cluster(members, point, width, height) {
  const cities = new Map();
  for (const member of members) {
    const { id } = member.city;
    if (!cities.has(id)) {
      const position = point(member.city);
      if (position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) continue;
      cities.set(id, { ...position, members: [] });
    }
    cities.get(id).members.push(member);
  }
  const groups = [];
  for (const city of [...cities.values()].sort((a, b) => b.members.length - a.members.length)) {
    const near = groups.find((group) => Math.abs(group.x - city.x) * width < (pinWidth(group) + pinWidth(city)) / 2 + 5
      && Math.abs(group.y - city.y) * height < 34);
    if (near) near.members.push(...city.members);
    else groups.push(city);
  }
  return groups;

  function pinWidth(group) {
    const nameLength = Array.from(group.members[0].nickname || "").length;
    const nameWidth = nameLength ? Math.min(75, nameLength * 12) + 9 : 0;
    return 33 + nameWidth + (group.members.length > 1 ? 24 : 0);
  }
}

function memberRow(member) {
  const row = el("button", "roster-row");
  row.type = "button";
  row.append(avatar(member, "tiny-avatar"), el("span", "row-name", nickname(member)), el("span", "row-city", member.city.name));
  row.insertAdjacentHTML("beforeend", icon("chevron"));
  return row;
}

function createPopover(fields, signal) {
  const card = $("#member-card");
  const content = el("div", "member-card-content");
  card.replaceChildren(content);
  let open = null;
  let timer;
  let returningFocus = false;

  function close(restoreFocus = false) {
    clearTimeout(timer);
    if (!open) return;
    const anchor = open.anchor;
    anchor.setAttribute("aria-expanded", "false");
    open = null;
    card.hidden = true;
    content.replaceChildren();
    if (restoreFocus && anchor.isConnected) {
      returningFocus = true;
      anchor.focus({ preventScroll: true });
      returningFocus = false;
    }
  }

  function scheduleClose() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!open?.pinned && !card.matches(":hover") && !card.contains(document.activeElement)
          && open?.anchor !== document.activeElement) close();
    }, 180);
  }

  function show(anchor, members, pinned) {
    clearTimeout(timer);
    if (!pinned && open?.pinned) return;
    if (open?.anchor !== anchor) close();
    open = { anchor, members, pinned };
    anchor.setAttribute("aria-expanded", "true");
    card.hidden = false;
    render(members.length === 1 ? members[0] : null);
    if (pinned) $("button", card)?.focus({ preventScroll: true });
  }

  function render(member) {
    content.replaceChildren();
    card.classList.toggle("nearby-card", !member);
    const top = el("div", "member-heading");
    if (member) {
      const identity = el("div");
      identity.append(el("h3", "", nickname(member)), el("p", "", cityLabel(member.city)));
      top.append(avatar(member), identity);
    } else {
      top.append(el("h3", "", "附近的 " + open.members.length + " 位成员"));
    }
    const dismiss = iconButton("关闭成员资料", "close");
    dismiss.addEventListener("click", () => close(true));
    top.append(dismiss);
    if (member && open.members.length > 1) {
      const back = el("button", "button quiet small popover-back", "返回成员列表");
      back.type = "button";
      back.insertAdjacentHTML("afterbegin", icon("arrow"));
      back.addEventListener("click", () => {
        render(null);
        $("button", content)?.focus({ preventScroll: true });
      });
      content.append(back);
    }
    content.append(top);
    if (member) {
      if (member.status) content.append(statusPill(member.status));
      const details = el("dl", "member-details");
      const values = [["老家", cityLabel(member.home)], ["常驻地", cityLabel(member.residence)],
        ...fields.filter(({ key }) => key !== "nickname").map(({ label, key }) => [label, member[key]])];
      for (const [label, value] of values) {
        if (!value) continue;
        const row = el("div");
        row.append(el("dt", "", label), el("dd", "", value));
        details.append(row);
      }
      if (details.childElementCount) content.append(details);
    } else {
      for (const item of open.members) {
        const row = memberRow(item);
        row.addEventListener("click", () => {
          render(item);
          $("button", content)?.focus({ preventScroll: true });
        });
        content.append(row);
      }
    }
    content.scrollTop = 0;
    position();
  }

  function position() {
    if (!open) return;
    const anchor = open.anchor;
    const rect = anchor.getBoundingClientRect();
    const viewport = document.documentElement;
    const clip = anchor.closest(".roster-list, .map-stage")?.getBoundingClientRect();
    if (!anchor.isConnected || rect.bottom <= Math.max(0, clip?.top ?? 0)
        || rect.top >= Math.min(viewport.clientHeight, clip?.bottom ?? viewport.clientHeight)) {
      close();
      return;
    }
    const gap = 8;
    const margin = 10;
    const maxHeight = 224;
    const above = rect.top - margin - gap;
    const below = viewport.clientHeight - rect.bottom - margin - gap;
    const desired = Math.min(maxHeight, content.scrollHeight + 2);
    const opensAbove = above >= desired || above >= below;
    const room = opensAbove ? above : below;
    if (room < 26) {
      close();
      return;
    }
    card.dataset.side = opensAbove ? "above" : "below";
    card.style.setProperty("--card-height", Math.min(maxHeight, room) - 2 + "px");

    const face = $(".avatar", anchor)?.getBoundingClientRect() ?? rect;
    const center = face.left + face.width / 2;
    const width = card.offsetWidth;
    const left = Math.max(margin, Math.min(viewport.clientWidth - width - margin, center - width / 2));
    const top = opensAbove ? rect.top - gap - card.offsetHeight : rect.bottom + gap;
    card.style.setProperty("--card-arrow", Math.max(10, Math.min(width - 10, center - left)) + "px");
    card.style.left = left + window.scrollX + "px";
    card.style.top = top + window.scrollY + "px";
  }

  function bind(anchor, members, { preview = members.length === 1 } = {}) {
    anchor.setAttribute("aria-controls", card.id);
    anchor.setAttribute("aria-expanded", "false");
    if (preview) {
      anchor.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") show(anchor, members, false);
      });
      anchor.addEventListener("pointerleave", scheduleClose);
      anchor.addEventListener("focus", () => { if (!returningFocus) show(anchor, members, false); });
      anchor.addEventListener("blur", scheduleClose);
    }
    anchor.addEventListener("click", () => {
      if (open?.anchor === anchor && open.pinned) close(true);
      else show(anchor, members, true);
    });
  }

  card.addEventListener("pointerenter", () => clearTimeout(timer), { signal });
  card.addEventListener("pointerleave", scheduleClose, { signal });
  card.addEventListener("focusout", scheduleClose, { signal });
  document.addEventListener("pointerdown", (event) => {
    if (open && !card.contains(event.target) && !open.anchor.contains(event.target)) close();
  }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) close(true);
  }, { signal });
  window.addEventListener("scroll", (event) => {
    if (!(event.target instanceof Element && card.contains(event.target))) position();
  }, { signal, passive: true, capture: true });
  window.addEventListener("resize", position, { signal });
  return { bind, close };
}
