import { $, api, avatar, button, cityLabel, el, heading, icon, iconButton, notify, statusLabels, statusPill } from "./ui.js";

export function renderProfile(main, data, session, onSaved) {
  const title = heading("个人资料", "设置你的地图状态、城市时段和成员资料。");
  const form = el("form");
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
          <p class="hint">用城市和日期安排你的地图位置。临时外出优先，同类重叠时采用下面最后一条。</p>
          <div class="form-grid base-cities"></div>
          <div class="schedules"></div>
          <div class="form-actions">
            <button type="button" class="button secondary small add-rule">${icon("plus")} 添加时段</button>
          </div>
        </section>
      </div>
      <aside class="panel">
        <h2>地图状态</h2>
        <div class="status-options" role="radiogroup" aria-label="地图状态"></div>
        <p class="hint">隐身时，其他成员看不到你的地图位置或资料卡。</p>
        <div class="current-location"></div>
      </aside>
    </div>
    <div class="form-actions">
      <button type="submit" class="button primary">保存资料</button>
      <p class="error save-error" role="alert"></p>
    </div>`;

  const { profile, settings } = data;
  const visibilityControls = new Map();
  const details = $(".personal-fields", form);
  const photo = el("div", "field field-wide");
  const photoHeader = el("div", "label");
  photoHeader.append(el("span", "", "头像"), visibilityControl("avatar", "头像"));
  const preview = el("div", "avatar-preview");
  showAvatar(data.avatar);
  const choose = button("上传头像", "button secondary small");
  const sync = button("同步 QQ 头像", "button secondary small");
  sync.disabled = !session.providers.qq;
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
    el("p", "hint", session.providers.qq ? "同步会跳转到 QQ 授权，请先保存其他编辑。" : "本站启用 QQ 登录后可同步 QQ 头像。"),
    avatarError);
  details.append(photo);
  for (const { key, label, maxLength } of session.fields.filter(({ key }) => settings.visibility[key])) {
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
    header.append(name, visibilityControl(key, label));
    const field = el("div", "field");
    field.append(header, input);
    if (key === "bio") field.classList.add("field-wide");
    details.append(field);
  }

  const home = cityPicker("老家", profile.home);
  const residence = cityPicker("常驻地", profile.residence);
  $(".label", home.node).append(visibilityControl("home", "老家"));
  $(".label", residence.node).append(visibilityControl("residence", "常驻地"));
  $(".base-cities", form).append(home.node, residence.node);
  const schedules = $(".schedules", form);
  const addRule = $(".add-rule", form);
  const rules = [];
  const renumber = () => {
    rules.forEach((rule, index) => rule.title.textContent = "时段 " + (index + 1));
    addRule.disabled = rules.length >= 40;
  };
  const appendRule = (initial) => {
    const rule = scheduleRow(initial, session.day, () => {
      rules.splice(rules.indexOf(rule), 1);
      rule.node.remove();
      renumber();
      addRule.focus();
    });
    rules.push(rule);
    schedules.append(rule.node);
    renumber();
    return rule;
  };
  profile.rules.forEach(appendRule);
  addRule.addEventListener("click", () => appendRule().node.querySelector("select").focus());

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
  const submit = $("button[type=submit]", form);
  const errorLine = $(".save-error", form);
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
      const visibility = Object.fromEntries([...visibilityControls].map(([key, control]) => [key, control.checked]));
      const saved = await api("/api/profile", "PUT", {
        ...values, home: home.value(), residence: residence.value(), rules: rules.map((rule) => rule.value()),
        visibility, avatarUpload,
      });
      avatarUpload = undefined;
      avatarError.textContent = "";
      showAvatar(saved.avatar);
      updateCurrent(saved);
      notify("资料已保存");
      onSaved(saved);
    } catch (error) {
      errorLine.textContent = error.message;
    } finally {
      setBusy(false);
    }
  });
  const account = el("p", "hint account-key", "账号标识 " + data.accountKey);
  main.replaceChildren(title, form, account);

  function showAvatar(url) {
    preview.replaceChildren(avatar({ ...session.viewer, avatar: url }, "profile-avatar"));
  }

  function setBusy(busy) {
    submit.disabled = choose.disabled = busy;
    sync.disabled = busy || !session.providers.qq;
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
  const title = heading("管理面板", "设置个人资料显示的项目和临时地点的有效期。");
  const form = el("form");
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
    </div>
    <div class="form-actions">
      <button class="button primary" type="submit">保存设置</button>
      <p class="error" role="alert"></p>
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
  const submit = $("button[type=submit]", form);
  const errorLine = $(".error", form);
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
  main.replaceChildren(title, form);
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

function scheduleRow(initial, day, remove) {
  const node = el("section", "schedule");
  const top = el("div", "panel-heading");
  const title = el("h3");
  const close = iconButton("删除此时段", "close");
  close.addEventListener("click", remove);
  top.append(title, close);
  const grid = el("div", "form-grid");
  const kind = select([["residence", "常驻地"], ["home", "老家"], ["trip", "临时外出"]], initial?.kind ?? "residence");
  const recurrence = select([["date", "指定日期"], ["annual", "每年重复"]], initial?.annual ? "annual" : "date");
  const start = el("input");
  const end = el("input");
  start.required = end.required = true;
  const city = cityPicker("外出城市", initial?.city);
  city.node.classList.add("field-wide");
  const note = el("p", "hint field-wide", "按 MM-DD 填写，例如 07-01。起始月日晚于结束月日时跨年。");
  grid.append(labeled("地点类型", kind), labeled("重复方式", recurrence),
    labeled("开始日期", start), labeled("结束日期", end), note, city.node);
  node.append(top, grid);
  updateMode(initial?.start ?? day, initial?.end ?? day);
  kind.addEventListener("change", () => updateMode());
  recurrence.addEventListener("change", () => updateMode());
  return {
    node, title,
    value: () => ({
      kind: kind.value, annual: recurrence.value === "annual", start: start.value.trim(), end: end.value.trim(),
      ...(kind.value === "trip" ? { city: city.value() } : {}),
    }),
  };

  function updateMode(from = start.value, to = end.value) {
    const trip = kind.value === "trip";
    city.node.hidden = !trip;
    recurrence.options[1].disabled = trip;
    if (trip) recurrence.value = "date";
    const annual = recurrence.value === "annual";
    note.hidden = !annual;
    for (const [control, value] of [[start, from], [end, to]]) {
      control.type = annual ? "text" : "date";
      control.placeholder = annual ? "MM-DD" : "";
      if (annual) {
        control.pattern = "[0-9]{2}-[0-9]{2}";
        control.maxLength = 5;
        control.value = value.length === 10 ? value.slice(5) : value;
      } else {
        control.removeAttribute("pattern");
        control.removeAttribute("maxlength");
        control.value = value.length === 5 ? day.slice(0, 5) + value : value;
      }
    }
  }
}

function cityPicker(label, initial) {
  const node = el("div", "field city-picker");
  const content = el("div");
  node.append(el("span", "label", label), content);
  let selected = initial || null;
  let input;
  let pending;
  let timer;
  if (selected) showChoice();
  else showSearch();
  return {
    node,
    value() {
      if (input?.isConnected && input.value.trim()) throw new Error("请为「" + label + "」选择一个搜索结果。");
      return selected?.id ?? null;
    },
  };

  function showChoice(focus = false) {
    content.onfocusout = null;
    const box = el("div", "city-picked");
    box.innerHTML = icon("pin");
    const change = button("更换", "button quiet small");
    change.setAttribute("aria-label", "更换" + label);
    const clear = iconButton("清空" + label, "close");
    change.addEventListener("click", () => showSearch(true));
    clear.addEventListener("click", () => {
      selected = null;
      showSearch(true);
    });
    box.append(el("span", "", cityLabel(selected)), change, clear);
    content.replaceChildren(box);
    if (focus) change.focus();
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
