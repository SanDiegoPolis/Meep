import { $, api, avatar, button, cityLabel, el, heading, icon, iconButton, notify, statusLabels, statusPill } from "./ui.js";
import { bindingCodeForm } from "./login.js";

const clubRolePresets = ["社团创始人", "社长", "副社长", "团支书", "社团骨干", "社员", "部长"];

export function renderProfile(main, data, session, onSaved) {
  const form = el("form");
  form.id = "profile-form";
  const { header, submit, errorLine } = saveHeader(form.id, "保存资料",
    heading("个人资料", "设置你的地图状态、城市时段和成员资料。"));
  form.innerHTML = `
    <div class="form-layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-heading"><h2>成员资料</h2><span class="badge">均为选填</span></div>
          <p class="hint">逐项选择是否向其他成员公开。</p>
          <div class="form-grid personal-fields"></div>
        </section>
        <section class="panel">
          <div class="panel-heading"><h2>地点与时段</h2></div>
          <p class="hint">临时外出优先。同一优先级重叠时，后添加的优先。</p>
          <div class="form-grid base-cities"></div>
          <section class="trip-schedules" aria-labelledby="trip-schedules-heading">
            <h3 id="trip-schedules-heading">临时外出</h3>
          </section>
        </section>
      </div>
      <aside class="panel">
        <h2>地图状态</h2>
        <div class="status-options" role="radiogroup" aria-label="地图状态"></div>
        <p class="hint">隐身时，其他成员看不到你的地图位置或资料卡。</p>
        <div class="current-location"></div>
      </aside>
    </div>`;

  const { profile, settings } = data;
  const editableFields = session.fields.filter(({ key }) => settings.visibility[key]);
  const roles = editableFields.filter(({ key }) => key === "clubRole" || key === "pastRole");
  const roleGroup = el("div", "field");
  const roleHeader = el("div", "label role-header");
  const roleEditors = new Map();
  let selectedRole = roles.find(({ key }) => key === profile.roleKind)?.key ?? roles[0]?.key;
  let roleEdited = false;
  if (roles.length > 1) {
    const choices = el("div", "role-choices");
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-label", "职务类型");
    for (const { key, label } of roles) {
      const choice = el("label", "role-choice");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "roleKind";
      radio.value = key;
      radio.checked = key === selectedRole;
      radio.addEventListener("change", () => {
        selectedRole = key;
        showRoleEditor();
      });
      choice.append(radio, el("span", "", label));
      choices.append(choice);
    }
    roleHeader.append(choices);
    roleGroup.append(roleHeader);
  }
  const visibilityControls = new Map();
  const details = $(".personal-fields", form);
  const photo = el("div", "field field-wide");
  const photoHeader = el("div", "label");
  photoHeader.append(el("span", "", "头像"), visibilityControl("avatar", "头像"));
  const preview = el("div", "avatar-preview");
  showAvatar(data.avatar);
  const choose = button("上传头像", "button secondary small");
  const sync = button("同步 QQ 头像", "button secondary small");
  const canSync = session.providers.qq && !session.codeLogin.preview;
  sync.disabled = !canSync;
  const file = el("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp";
  file.hidden = true;
  file.setAttribute("aria-label", "上传头像");
  const avatarRow = el("div", "avatar-row");
  avatarRow.append(preview, choose, sync, file);
  const avatarError = el("p", "error");
  avatarError.setAttribute("role", "alert");
  photo.append(photoHeader, avatarRow, el("p", "hint", "支持 5 MB 以内的 JPG、PNG 或 WebP，点击保存资料后生效。"),
    el("p", "hint", canSync ? "同步会跳转到 QQ 授权，请先保存其他编辑。"
      : session.codeLogin.preview ? "预览环境仅使用模拟 QQ 账号。" : "本站启用 QQ 登录后可同步 QQ 头像。"),
    avatarError);
  details.append(photo);
  for (const { key, label, maxLength } of editableFields) {
    const input = el(key === "bio" ? "textarea" : "input");
    input.name = key;
    input.maxLength = maxLength;
    input.value = profile[key] || "";
    input.placeholder = "选填";
    if (key === "qq") input.inputMode = "numeric";
    input.id = "profile-" + key;
    const name = el("label", "", label);
    name.htmlFor = input.id;
    const header = el("div", "label");
    const visibility = visibilityControl(key, label);
    header.append(name, visibility);
    const field = el("div", "field");
    if (key === "clubRole" || key === "pastRole") {
      if (roles.length > 1) {
        input.setAttribute("aria-label", label);
        roleHeader.append(visibility);
      } else {
        field.append(header);
      }
      const options = clubRolePresets.map((role) => {
        const value = key === "pastRole" && role !== "社团创始人" ? "前" + role : role;
        return [value, value];
      });
      const preset = select([["", "选择预设"], ...options], "");
      preset.setAttribute("aria-label", label + "预设选项");
      preset.title = "选择预设";
      preset.options[0].disabled = true;
      input.addEventListener("input", () => { roleEdited = true; });
      visibilityControls.get(key).addEventListener("change", () => { roleEdited = true; });
      preset.addEventListener("change", () => {
        input.value = preset.value;
        preset.value = "";
        roleEdited = true;
      });
      const presetArea = el("span", "role-preset");
      const presetLabel = el("span", "", "预设");
      presetLabel.setAttribute("aria-hidden", "true");
      presetArea.append(presetLabel);
      presetArea.insertAdjacentHTML("beforeend", icon("chevron"));
      presetArea.append(preset);
      const controls = el("div", "role-controls");
      controls.append(input, presetArea);
      field.append(controls);
      roleEditors.set(key, { field, visibility });
      if (!roleGroup.parentNode) details.append(roleGroup);
      roleGroup.append(field);
    } else {
      field.append(header, input);
      if (key === "bio") field.classList.add("field-wide");
      details.append(field);
    }
  }
  showRoleEditor();

  const home = cityPicker("老家", profile.home, { useLocation: true });
  const residence = cityPicker("常驻地", profile.residence, { useLocation: true });
  $(".label", home.node).append(visibilityControl("home", "老家"));
  $(".label", residence.node).append(visibilityControl("residence", "常驻地"));
  const calendar = monthDayPicker(session.day);
  const rules = [];
  const scheduleGroups = {
    home: scheduleGroup("home", "添加老家时段", home.node),
    residence: scheduleGroup("residence", "添加常驻地时段", residence.node),
    trip: scheduleGroup("trip", "添加外出时段"),
  };
  $(".base-cities", form).append(scheduleGroups.home.node, scheduleGroups.residence.node);
  $(".trip-schedules", form).append(scheduleGroups.trip.node);
  profile.rules.forEach(appendRule);

  const statuses = $(".status-options", form);
  for (const key of Object.keys(statusLabels)) {
    const choice = el("label", "status-choice");
    const control = el("input");
    control.type = "radio";
    control.name = "status";
    control.value = key;
    control.checked = key === profile.status;
    choice.append(control, statusPill(key));
    statuses.append(choice);
  }

  const current = $(".current-location", form);
  updateCurrent(data);
  let avatarUpload;
  choose.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const selected = file.files[0];
    if (!selected) return;
    file.value = "";
    setBusy(true);
    avatarError.textContent = "";
    try {
      const image = await prepareAvatar(selected);
      avatarUpload = image.slice(image.indexOf(",") + 1);
      showAvatar(image);
    } catch (error) {
      avatarError.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  sync.addEventListener("click", async () => {
    setBusy(true);
    avatarError.textContent = "";
    try {
      const { url } = await api("/api/avatar/qq/start", "POST");
      location.assign(url);
    } catch (error) {
      avatarError.textContent = error.message;
      setBusy(false);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    setBusy(true);
    errorLine.textContent = "";
    try {
      const values = Object.fromEntries(new FormData(form));
      const roleKind = roles.length > 1 || roleEdited ? selectedRole : undefined;
      const visibility = Object.fromEntries([...visibilityControls].filter(([, control]) => !control.disabled)
        .map(([key, control]) => [key, control.checked]));
      const saved = await api("/api/profile", "PUT", {
        ...values, roleKind, home: home.value(), residence: residence.value(), rules: rules.map((rule) => rule.value()),
        visibility, avatarUpload,
      });
      avatarUpload = undefined;
      avatarError.textContent = "";
      showAvatar(saved.avatar);
      updateCurrent(saved);
      onSaved(saved);
    } catch (error) {
      errorLine.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  const account = el("p", "hint account-key", "账号标识 " + data.accountKey);
  main.replaceChildren(header, accountBindings(data.bindings, session), form, account, calendar.dialog);

  function scheduleGroup(kind, label, city) {
    const node = el("div", "schedule-group");
    const list = el("div");
    const add = button(label, "button secondary small");
    add.insertAdjacentHTML("afterbegin", icon("plus"));
    const actions = el("div", "form-actions");
    actions.append(add);
    if (city) node.append(city);
    const warning = city ? el("p", "hint", "编辑旧时段时，请只保留一条。") : null;
    if (warning) {
      warning.hidden = true;
      node.append(warning);
    }
    node.append(list, actions);
    add.addEventListener("click", () => appendRule({ kind }).firstControl.focus());
    return { node, list, add, actions, warning };
  }

  function appendRule(initial) {
    const group = scheduleGroups[initial.kind];
    const rule = scheduleRow(initial, session.day, calendar.open, () => {
      rules.splice(rules.indexOf(rule), 1);
      rule.node.remove();
      updateScheduleControls();
      (group.actions.hidden ? $("button", group.list) : group.add)?.focus();
    });
    rules.push(rule);
    group.list.append(rule.node);
    updateScheduleControls();
    return rule;
  }

  function updateScheduleControls() {
    const counts = { home: 0, residence: 0, trip: 0 };
    for (const rule of rules) {
      counts[rule.kind]++;
      if (rule.title) rule.title.textContent = "临时外出时段 " + counts[rule.kind];
    }
    for (const [kind, group] of Object.entries(scheduleGroups)) {
      group.actions.hidden = kind !== "trip" && counts[kind] > 0;
      if (group.warning) group.warning.hidden = counts[kind] < 2;
      group.add.disabled = rules.length >= 40;
    }
  }

  function showRoleEditor() {
    for (const [key, { field, visibility }] of roleEditors) {
      const hidden = key !== selectedRole;
      field.hidden = visibility.hidden = hidden;
      visibilityControls.get(key).disabled = hidden;
      for (const control of field.querySelectorAll("input, select")) control.disabled = hidden;
    }
  }

  function showAvatar(url) {
    preview.replaceChildren(avatar({ ...session.viewer, avatar: url }, "profile-avatar"));
  }

  function setBusy(busy) {
    submit.disabled = choose.disabled = busy;
    sync.disabled = busy || !canSync;
  }

  function visibilityControl(key, label) {
    const control = el("input");
    control.type = "checkbox";
    control.checked = profile.visibility[key];
    control.setAttribute("aria-label", "公开" + label);
    visibilityControls.set(key, control);
    const option = el("label", "profile-visibility");
    option.append(control, el("span", "", "允许公开"));
    return option;
  }

  function updateCurrent(value) {
    current.replaceChildren(el("strong", "", value.profile.status === "hidden" ? "隐身中的城市" : "当前地图城市"),
      el("p", "hint", cityLabel(value.current) || "还没有可显示的城市"));
    if (!value.override) return;
    const time = new Intl.DateTimeFormat("zh-CN", {
      timeZone: session.timeZone, dateStyle: "medium", timeStyle: "short",
    }).format(value.override.expiresAt);
    current.append(el("p", "hint", "临时更新至 " + time));
    const end = button("结束临时更新", "button quiet small");
    end.addEventListener("click", async () => {
      end.disabled = true;
      try {
        await api("/api/override", "DELETE");
        updateCurrent(await api("/api/profile"));
        notify("已恢复按资料显示地点");
      } catch (error) {
        notify(error.message, true);
        end.disabled = false;
      }
    });
    current.append(end);
  }
}

function accountBindings(bindings, session) {
  const section = el("section", "panel account-bindings");
  section.innerHTML = `
    <div class="panel-heading"><h2>账号绑定</h2></div>
    <p class="hint">绑定后可用任一已绑定方式登录这份资料。绑定信息仅你可见。</p>
    <div class="binding-grid"></div>
    <div id="binding-form" hidden></div>
    <p class="error binding-error" role="alert"></p>`;
  const grid = $(".binding-grid", section);
  const container = $("#binding-form", section);
  const error = $(".binding-error", section);
  const canonical = location.origin === session.codeLogin.origin;
  render();
  return section;

  function render(focusChannel) {
    grid.replaceChildren();
    container.replaceChildren();
    container.hidden = true;
    for (const [channel, label] of [["email", "邮箱"], ["phone", "手机号"], ["qq", "QQ"], ["mua", "MUA"]]) {
      const contact = channel === "email" || channel === "phone";
      const enabled = canonical && (contact ? session.codeLogin[channel] : session.providers[channel]);
      const value = bindings[channel];
      const row = el("div", "binding-row");
      const info = el("div", "binding-info");
      info.append(el("strong", "", label), el("span", "hint", typeof value === "string" ? value
        : value ? "已绑定" : enabled ? "未绑定" : "暂未开通"));
      row.append(info);
      if (value && focusChannel === channel) row.setAttribute("tabindex", "-1");
      if (!value) {
        const bind = button("绑定" + label, "button secondary small");
        bind.disabled = !enabled;
        if (contact) {
          bind.setAttribute("aria-controls", container.id);
          bind.setAttribute("aria-expanded", "false");
        }
        bind.addEventListener("click", async () => {
          error.textContent = "";
          if (contact) {
            const open = bind.getAttribute("aria-expanded") !== "true";
            for (const control of grid.querySelectorAll("[aria-expanded]")) {
              control.setAttribute("aria-expanded", String(open && control === bind));
            }
            container.hidden = !open;
            container.replaceChildren();
            if (open) {
              container.append(bindingCodeForm(channel, label, async (path, payload) => {
                const result = await api(path, "POST", payload);
                bindings = result.bindings;
                render(channel);
                notify(label + "已绑定");
              }));
              $("input", container).focus();
            }
            return;
          }
          bind.disabled = true;
          try {
            const { url } = await api("/api/bindings/" + channel + "/start", "POST");
            location.assign(url);
          } catch (failure) {
            error.textContent = failure.message;
            bind.disabled = false;
          }
        });
        row.append(bind);
      }
      grid.append(row);
      if (focusChannel === channel) row.focus({ preventScroll: true });
    }
  }
}

async function prepareAvatar(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error("请选择 5 MB 以内的 JPG、PNG 或 WebP 图片。");
  }
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取这张图片，请重新选择。");
  }
  try {
    const canvas = el("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d", { alpha: false });
    const side = Math.min(image.width, image.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    image.close();
  }
}

export function renderAdmin(main, data, fields) {
  const form = el("form");
  form.id = "admin-form";
  const { header, submit, errorLine } = saveHeader(form.id, "保存设置",
    heading("管理面板", "设置个人资料显示的项目和临时地点的有效期。"));
  form.innerHTML = `
    <div class="form-layout">
      <section class="panel">
        <div class="panel-heading"><h2>资料项显示</h2></div>
        <p class="hint">开启的项目会出现在所有成员的个人资料页。</p>
        <div class="switches"></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>临时地点有效期</h2></div>
        <p class="hint">成员登录时若不在当前时段设定的城市，确认切换后，地图会按这里设置的天数显示临时地点。</p>
        <label class="day-control"><input class="day-input" type="number" min="1" max="30" step="1" required aria-label="临时地点持续天数"> 天</label>
      </section>
    </div>`;
  const list = $(".switches", form);
  for (const { key, label } of fields) {
    const row = el("label", "switch-row", label);
    const control = el("input");
    control.type = "checkbox";
    control.name = key;
    control.checked = data.visibility[key];
    control.setAttribute("role", "switch");
    row.append(control);
    list.append(row);
  }
  const days = $(".day-input", form);
  days.value = data.overrideDays;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    errorLine.textContent = "";
    try {
      const visibility = Object.fromEntries(fields.map(({ key }) => [key, form.elements[key].checked]));
      await api("/api/admin", "PUT", { visibility, overrideDays: days.valueAsNumber });
      notify("管理设置已保存");
    } catch (error) {
      errorLine.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  main.replaceChildren(header, form);
}

function saveHeader(formId, label, title) {
  const submit = button(label, "button primary");
  submit.type = "submit";
  submit.setAttribute("form", formId);
  const errorLine = el("p", "error save-error");
  errorLine.setAttribute("role", "alert");
  const header = el("header", "form-heading");
  header.append(title, submit, errorLine);
  return { header, submit, errorLine };
}

function labeled(label, control) {
  const field = el("label", "field");
  const name = el("span", "label", label);
  field.append(name, control);
  return field;
}

function select(options, value) {
  const control = el("select");
  for (const [key, label] of options) {
    const option = el("option", "", label);
    option.value = key;
    control.append(option);
  }
  control.value = value;
  return control;
}

function scheduleRow(initial, day, openCalendar, remove) {
  const { kind } = initial;
  const trip = kind === "trip";
  const annual = !trip && initial.annual !== false;
  const date = annual ? day.slice(5) : day;
  const node = el("section", trip ? "schedule" : "schedule base-schedule");
  const title = trip ? el("h4") : null;
  const close = iconButton("删除此时段", "close");
  close.addEventListener("click", remove);
  const grid = el("div", "form-grid");
  const start = dateField("开始日期", initial.start ?? date);
  const end = dateField("结束日期", initial.end ?? date);
  const city = trip ? cityPicker("外出城市", initial.city) : null;
  if (city) {
    const rowHeading = el("div", "panel-heading");
    rowHeading.append(title, close);
    node.append(rowHeading);
    city.node.classList.add("field-wide");
    grid.append(city.node);
  } else {
    const mode = el("div", "base-schedule-mode field-wide field");
    mode.append(el("p", "hint", annual
      ? "每年重复。按月日填写，如 12-20 到 01-10（跨年）。"
      : "旧单次时段，删除后可重新设置为每年重复。"), close);
    grid.append(mode);
  }
  grid.append(start.field, end.field);
  node.append(grid);
  return {
    node, title, kind, firstControl: (city && $("input", city.node)) || start.input,
    value: () => ({
      kind, annual, start: start.input.value.trim(), end: end.input.value.trim(),
      ...(city ? { city: city.value(title.textContent) } : {}),
    }),
  };

  function dateField(label, value) {
    const input = el("input");
    input.type = annual ? "text" : "date";
    input.value = value;
    input.required = true;
    input.readOnly = !trip && !annual;
    if (annual) {
      input.placeholder = "MM-DD";
      input.pattern = "[0-9]{2}-[0-9]{2}";
      input.maxLength = 5;
    }
    const field = labeled(label, input);
    if (!annual) return { field, input };

    const wrapper = el("div", "month-day-field");
    const calendar = iconButton("选择" + label, "calendar");
    calendar.classList.add("month-day-button");
    calendar.setAttribute("aria-haspopup", "dialog");
    calendar.addEventListener("click", () => openCalendar(input, label));
    wrapper.append(field, calendar);
    return { field: wrapper, input };
  }
}

function monthDayPicker(day) {
  const dialog = el("dialog", "location-dialog month-day-dialog");
  const title = el("h2");
  title.id = "month-day-title";
  dialog.setAttribute("aria-labelledby", title.id);
  const close = iconButton("关闭日历", "close");
  close.addEventListener("click", () => dialog.close());
  const header = el("div", "month-day-header");
  header.append(title, close);
  const month = select(Array.from({ length: 12 }, (_, index) => [String(index + 1), (index + 1) + " 月"]), "");
  const days = el("div", "month-day-grid");
  dialog.append(header, labeled("月份", month), days);
  month.addEventListener("change", renderDays);
  let target;

  days.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = Array.prototype.indexOf.call(days.children, event.target);
    days.children[index + step]?.focus();
  });

  return {
    dialog,
    open(input, label) {
      target = input;
      title.textContent = "选择" + label;
      const current = Number(input.value.slice(0, 2));
      month.value = String(current >= 1 && current <= 12 ? current : Number(day.slice(5, 7)));
      renderDays();
      dialog.showModal();
      month.focus();
    },
  };

  function renderDays() {
    const current = Number(month.value);
    const count = new Date(Date.UTC(2000, current, 0)).getUTCDate();
    const prefix = String(current).padStart(2, "0") + "-";
    days.replaceChildren(...Array.from({ length: count }, (_, index) => {
      const date = index + 1;
      const value = prefix + String(date).padStart(2, "0");
      const choice = button(String(date), "button quiet small");
      choice.setAttribute("aria-label", current + "月" + date + "日");
      if (target.value === value) choice.setAttribute("aria-current", "date");
      choice.addEventListener("click", () => {
        target.value = value;
        dialog.close();
      });
      return choice;
    }));
  }
}

function cityPicker(label, initial, { useLocation = false } = {}) {
  const node = el("div", "field city-picker");
  const content = el("div");
  node.append(el("span", "label", label), content);
  let selected = initial || null;
  let input;
  let pending;
  let timer;
  let locationRequest;
  const locationStatus = useLocation ? el("p", "hint city-location-status") : null;
  if (useLocation) {
    const locate = button("使用当前定位", "button secondary small");
    locate.setAttribute("aria-label", "使用当前定位填写" + label);
    locate.insertAdjacentHTML("afterbegin", icon("pin"));
    locationStatus.setAttribute("role", "status");
    const actions = el("div", "city-location-actions");
    actions.append(locate, locationStatus);
    node.append(actions);
    locate.addEventListener("click", async () => {
      const request = new AbortController();
      locationRequest = request;
      locate.disabled = true;
      locationStatus.textContent = "正在识别城市…";
      try {
        const { city } = await api("/api/cities/detected", "GET", undefined, request.signal);
        if (request.signal.aborted || !node.isConnected) return;
        if (!city) {
          locationStatus.textContent = "未能识别到城市，请手动搜索。";
          return;
        }
        selected = city;
        showChoice();
        locationStatus.textContent = "已填入当前城市。";
      } catch (error) {
        if (!request.signal.aborted) locationStatus.textContent = error.status === 401
          ? error.message : "定位查询失败，请重试或手动搜索。";
      } finally {
        if (locationRequest === request) locationRequest = null;
        locate.disabled = false;
      }
    });
  }
  if (selected) showChoice();
  else showSearch();
  return {
    node,
    value(context = label) {
      if (locationRequest && !locationRequest.signal.aborted) {
        throw new Error("「" + label + "」正在获取定位，请稍候。");
      }
      if (input?.isConnected && input.value.trim()) throw new Error("请为「" + context + "」选择一个搜索结果。");
      return selected?.id ?? null;
    },
  };

  function showChoice(focus = false) {
    clearTimeout(timer);
    pending?.abort();
    content.onfocusout = null;
    const box = el("div", "city-picked");
    box.innerHTML = icon("pin");
    const change = button("更换", "button quiet small");
    change.setAttribute("aria-label", "更换" + label);
    const clear = iconButton("清空" + label, "close");
    change.addEventListener("click", () => {
      cancelLocation();
      showSearch(true);
    });
    clear.addEventListener("click", () => {
      cancelLocation();
      selected = null;
      showSearch(true);
    });
    box.append(el("span", "", cityLabel(selected)), change, clear);
    content.replaceChildren(box);
    if (focus) change.focus();
  }

  function cancelLocation() {
    locationRequest?.abort();
    if (locationStatus) locationStatus.textContent = "";
  }

  function showSearch(focus = false) {
    const search = el("input");
    input = search;
    search.type = "search";
    search.autocomplete = "off";
    search.maxLength = 80;
    search.placeholder = "搜索城市，如南京、London";
    search.setAttribute("aria-label", label);
    const options = el("div", "city-options");
    options.hidden = true;
    content.replaceChildren(search, options);
    if (focus) search.focus();
    search.addEventListener("input", () => {
      cancelLocation();
      clearTimeout(timer);
      pending?.abort();
      options.hidden = true;
      options.replaceChildren();
      const query = search.value.trim();
      if (query) timer = setTimeout(() => searchCities(query), 180);
    });
    search.addEventListener("focus", () => { if (options.childElementCount && search.value.trim()) options.hidden = false; });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && !options.hidden) {
        event.preventDefault();
        $("button", options)?.focus();
      }
      if (event.key === "Enter" && search.value.trim()) event.preventDefault();
      if (event.key === "Escape") {
        clearTimeout(timer);
        pending?.abort();
        if (selected) showChoice(true);
        else options.hidden = true;
      }
    });
    content.onfocusout = (event) => {
      if (!content.contains(event.relatedTarget)) options.hidden = true;
    };
    options.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        search.focus();
        options.hidden = true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? event.target.nextElementSibling : event.target.previousElementSibling;
        (next || search).focus();
      }
    });

    async function searchCities(query) {
      pending = new AbortController();
      const { signal } = pending;
      try {
        const { cities } = await api("/api/cities?q=" + encodeURIComponent(query), "GET", undefined, signal);
        if (signal.aborted || !search.isConnected) return;
        const choices = cities.map((city) => {
          const choice = button(cityLabel(city), "city-option");
          choice.addEventListener("click", () => {
            cancelLocation();
            selected = city;
            showChoice(true);
          });
          return choice;
        });
        options.replaceChildren(...(choices.length ? choices : [el("p", "roster-empty", "未找到城市，请换个名称。")]));
        options.hidden = !content.contains(document.activeElement);
      } catch {
        if (signal.aborted) return;
        options.replaceChildren(el("p", "roster-empty", "城市查询失败，请重试。"));
        options.hidden = !content.contains(document.activeElement);
      }
    }
  }

}
