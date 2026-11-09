import { $, api, avatar, button, cityLabel, el, icon, notify } from "./ui.js";
import { mountMap } from "./map.js";
import { renderAdmin, renderProfile } from "./forms.js";

const main = $("#main");
const dialog = $("#location-dialog");
let session;
let map;
let renderId = 0;

window.addEventListener("hashchange", () => {
  if (session && location.hash !== "#main") void renderPage();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) void map?.refresh(); });
setInterval(() => { if (!document.hidden) void map?.refresh(); }, 20000);

void boot();

async function boot() {
  try {
    session = await readSession();
    await renderPage();
    showAuthResult();
    showLocationPrompt();
  } catch {
    main.replaceChildren(el("p", "notice", "页面加载失败，请刷新后重试。"));
  }
}

async function renderPage() {
  const id = ++renderId;
  map?.dispose();
  map = null;
  const requested = location.hash.slice(1);
  const view = session.viewer && requested === "profile" ? "profile"
    : session.viewer?.admin && requested === "admin" ? "admin" : "map";
  renderHeader(view);
  window.scrollTo(0, 0);
  document.title = "面基地图 · " + ({ map: "世界地图", profile: "个人资料", admin: "管理面板" })[view];
  if (view === "map") {
    map = mountMap(main, session, loginDemo, resetSession);
    return;
  }
  main.replaceChildren(el("p", "loading", "正在加载…"));
  try {
    const data = await api("/api/" + view);
    if (id !== renderId) return;
    if (view === "profile") renderProfile(main, data, session, (saved) => {
      session.viewer.nickname = saved.profile.nickname;
      session.viewer.avatar = saved.avatar;
      session.viewer.status = saved.profile.status;
      if (id === renderId) renderHeader("profile");
    });
    else renderAdmin(main, data, session.fields);
  } catch (error) {
    if (id !== renderId) return;
    if (error.status === 401) return resetSession();
    main.replaceChildren(el("p", "notice", error.message));
  }
}

function renderHeader(view) {
  const viewer = session.viewer;
  for (const link of document.querySelectorAll("[data-view]")) {
    const target = link.dataset.view;
    link.hidden = (target === "profile" && !viewer) || (target === "admin" && !viewer?.admin);
    if (target === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const account = $("#account");
  account.replaceChildren();
  if (session.demo) account.append(el("span", "demo-tag", "本机演示"));
  if (viewer) {
    const label = el("a", "account");
    label.href = "#profile";
    label.append(avatar(viewer, "tiny-avatar"), el("span", "account-name", viewer.nickname || "我的资料"));
    const logout = button("退出", "button quiet small");
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      try {
        await api("/api/logout", "POST");
        await resetSession();
      } catch (error) {
        if (error.status === 401) await resetSession();
        else notify(error.message, true);
      } finally {
        logout.disabled = false;
      }
    });
    account.append(label, logout);
  } else {
    const login = button("成员登录", "button secondary small");
    login.addEventListener("click", () => {
      $("#login")?.scrollIntoView({ block: "center" });
      $("#login .button:not(:disabled)")?.focus({ preventScroll: true });
    });
    account.append(login);
  }
}

async function loginDemo(account, actions) {
  const buttons = [...actions.querySelectorAll("button")];
  buttons.forEach((control) => control.disabled = true);
  try {
    await api("/api/demo", "POST", { account });
    await resetSession();
    showLocationPrompt();
  } catch (error) {
    notify(error.message, true);
  } finally {
    buttons.forEach((control) => control.disabled = false);
  }
}

async function resetSession() {
  session = await readSession();
  history.replaceState(null, "", "/#map");
  await renderPage();
}

function readSession() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return api("/api/session?zone=" + encodeURIComponent(zone));
}

function showAuthResult() {
  const query = new URLSearchParams(location.search);
  const sync = query.get("qqAvatar");
  const code = sync || query.get("login");
  if (!code) return;
  const messages = sync ? {
    ok: "QQ 头像已同步",
    expired: "同步授权已过期，请重新发起。",
    denied: "QQ 授权未完成，头像未更新。",
    failed: "同步 QQ 头像失败，请稍后重试。",
    mismatch: "请授权登录本站时使用的 QQ 账号。",
    missing: "QQ 没有返回可用的头像。",
  } : {
    expired: "这次授权已过期，请从本站重新登录。",
    denied: "授权未完成，请重新登录。",
    failed: "身份提供方登录失败，请重试或联系站点管理员。",
    unavailable: "该登录方式尚未配置。",
  };
  if (Object.hasOwn(messages, code)) notify(messages[code], code !== "ok");
  history.replaceState(null, "", location.pathname + location.hash);
}

function showLocationPrompt() {
  const pending = session.prompt;
  if (!pending?.observed || !pending.expected || dialog.open) return;
  dialog.innerHTML = `
    <div class="eyebrow">${icon("pin")} 登录地点提醒</div>
    <h2 id="dialog-title">临时更新地图地点？</h2>
    <p class="prompt-cities"></p>
    <p class="hint prompt-duration"></p>
    <div class="dialog-actions">
      <button type="button" class="button secondary" autofocus>保持原地</button>
      <button type="button" class="button primary">更新地点</button>
    </div>`;
  $(".prompt-cities", dialog).textContent =
    "本次登录识别为 " + cityLabel(pending.observed) + "，今天的地点时段设在 " + cityLabel(pending.expected) + "。";
  $(".prompt-duration", dialog).textContent = "确认后立即切换，" + pending.days + " 天后恢复按资料显示。";
  const keep = $(".secondary", dialog);
  const accept = $(".primary", dialog);
  keep.addEventListener("click", () => answer(false));
  accept.addEventListener("click", () => answer(true));
  dialog.oncancel = (event) => { event.preventDefault(); void answer(false); };
  dialog.showModal();

  async function answer(accepted) {
    if (accept.disabled) return;
    keep.disabled = accept.disabled = true;
    try {
      await api("/api/prompt", "POST", { accepted });
      session.prompt = null;
      dialog.close();
      if (accepted) {
        notify("地图地点已临时更新到 " + pending.observed.name);
        if (map) await map.refresh();
        else await renderPage();
      }
    } catch (error) {
      if (error.status === 409) dialog.close();
      notify(error.message, true);
    } finally {
      keep.disabled = accept.disabled = false;
    }
  }
}
