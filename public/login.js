import { $, api, button, el } from "./ui.js";

export function mountLogin(actions, session, onLogin) {
  const { codeLogin, passwordLoginOrigin, providers } = session;
  const panels = new Map();
  let unavailable = false;

  for (const [channel, label] of [["email", "邮箱"], ["phone", "手机号"]]) {
    const origin = codeLogin[channel] ? codeLogin.origin : passwordLoginOrigin;
    if (origin && origin !== location.origin) {
      const link = el("a", "button secondary", label + "登录");
      link.href = origin + "/";
      actions.append(link);
      continue;
    }
    const control = button(label + "登录");
    control.disabled = !origin;
    unavailable ||= !origin;
    actions.append(control);
    if (!origin) continue;

    const panel = el("div", "login-panel");
    panel.id = channel + "-login";
    panel.hidden = true;
    const modes = [];
    if (codeLogin[channel]) modes.push(loginForm(channel, label, false, onLogin));
    if (passwordLoginOrigin) modes.push(loginForm(channel, label, true, onLogin));
    if (modes.length === 2) {
      const switchMode = button("使用密码登录", "button quiet small login-mode");
      modes[1].hidden = true;
      switchMode.addEventListener("click", () => {
        const usePassword = modes[1].hidden;
        modes[0].hidden = usePassword;
        modes[1].hidden = !usePassword;
        switchMode.textContent = usePassword ? "使用验证码登录" : "使用密码登录";
        $("form:not([hidden]) input", panel).focus({ preventScroll: true });
      });
      panel.append(...modes, switchMode);
    } else {
      panel.append(...modes);
    }
    actions.parentElement.append(panel);
    panels.set(control, panel);
    control.setAttribute("aria-controls", panel.id);
    control.setAttribute("aria-expanded", "false");
    control.addEventListener("click", () => {
      const open = panel.hidden;
      for (const [otherControl, otherPanel] of panels) {
        otherPanel.hidden = !open || otherPanel !== panel;
        otherControl.setAttribute("aria-expanded", String(!otherPanel.hidden));
      }
      if (open) $("form:not([hidden]) input", panel).focus({ preventScroll: true });
    });
  }

  for (const [provider, label] of [["qq", "QQ 登录"], ["mua", "MUA 登录"]]) {
    const control = providers[provider] ? el("a", "button secondary", label) : button(label);
    if (providers[provider]) control.href = "/auth/" + provider + "/start";
    else control.disabled = true;
    unavailable ||= control.disabled === true;
    actions.append(control);
  }
  if (codeLogin.preview) {
    actions.before(el("p", "", "本机预览 · 页面显示验证码，QQ 和 MUA 使用测试账号。重启会清空数据。"));
  } else if (codeLogin.liveTest) {
    actions.before(el("p", "", "本机投递实测 · 请从邮箱或短信获取验证码。账号在重启后清空。"));
  } else if (unavailable) {
    actions.before(el("p", "", "灰色的登录方式尚未开通。"));
  }
}

export function bindingCodeForm(channel, label, onVerify) {
  return loginForm(channel, label, false, onVerify, { binding: true });
}

function loginForm(channel, label, password, onLogin, { binding = false } = {}) {
  const form = el("form", "login-form");
  form.method = "post";
  const codePath = binding ? "/api/bindings/code" : "/api/login/code";
  const path = password ? "/api/login/password" : codePath + "/verify";
  form.action = path;
  const email = channel === "email";
  const inputMode = email ? "email" : "tel";
  form.innerHTML = `
    <label>${label}<input name="identifier" type="${email && password ? "text" : inputMode}" inputmode="${inputMode}"
      autocomplete="${password ? "username" : inputMode}" maxlength="${email ? 254 : 32}"
      autocapitalize="none" spellcheck="false" required></label>
    ${password ? `<label>密码<input name="password" type="password" autocomplete="current-password"
      maxlength="256" required></label>` : `
    <div class="login-code-row">
      <label>验证码<input name="code" inputmode="numeric" autocomplete="one-time-code"
        maxlength="6" pattern="[0-9]{6}" required></label>
      <button class="button secondary" type="button">获取验证码</button>
    </div>
    <p class="login-code-status" role="status"></p>
    ${binding ? "" : '<p class="hint">首次验证成功后自动注册。</p>'}`}
    <div class="login-form-error" role="alert"></div>
    <button class="button primary" type="submit">${password ? "登录" : binding ? "验证并绑定" : "验证并登录"}</button>`;
  const { identifier, code } = form.elements;
  const submit = $("button[type='submit']", form);
  const error = $(".login-form-error", form);
  const send = $("button[type='button']", form);
  const status = $(".login-code-status", form);
  let challenge;
  let sending = false;
  let submitting = false;

  if (send) {
    submit.disabled = true;
    identifier.addEventListener("input", () => {
      challenge = undefined;
      code.value = "";
      error.textContent = "";
      status.textContent = "";
      submit.disabled = true;
    });
    send.addEventListener("click", async () => {
      if (!identifier.reportValidity() || sending || submitting) return;
      sending = true;
      identifier.readOnly = true;
      send.disabled = true;
      submit.disabled = true;
      error.textContent = "";
      try {
        const result = await api(codePath + "/request", "POST", { channel, identifier: identifier.value });
        challenge = result.challenge;
        code.value = "";
        status.textContent = result.previewCode
          ? "本机测试验证码：" + result.previewCode
          : "验证码已发送，五分钟内有效。";
        if (form.checkVisibility()) code.focus({ preventScroll: true });
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        sending = false;
        identifier.readOnly = false;
        send.disabled = false;
        submit.disabled = !challenge;
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const credentials = Object.fromEntries(new FormData(form));
    submitting = true;
    submit.disabled = true;
    identifier.readOnly = true;
    if (code) code.readOnly = true;
    if (send) send.disabled = true;
    error.textContent = "";
    try {
      await onLogin(path, password ? credentials : { ...credentials, channel, challenge });
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      submitting = false;
      submit.disabled = false;
      identifier.readOnly = false;
      if (code) code.readOnly = false;
      if (send) send.disabled = false;
    }
  });
  return form;
}
