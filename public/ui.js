const glyphs = {
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 3.9 5.4 3.9 9s-1.3 6.6-3.9 9c-2.6-2.4-3.9-5.4-3.9-9S9.4 5.4 12 3Z"/>',
  pin: '<path d="M19 10c0 5.2-7 10-7 10s-7-4.8-7-10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  chevron: '<path d="m10 6 6 6-6 6"/>',
  arrow: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield: '<path d="M12 3l7 3v5c0 4.7-2.6 7.9-7 10-4.4-2.1-7-5.3-7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  calendar: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 10h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};

export function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + glyphs[name] + '</svg>';
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function el(tag, className = "", value = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

export function button(label, className = "button secondary") {
  const node = el("button", className, label);
  node.type = "button";
  return node;
}

export function iconButton(label, glyph) {
  const node = button("", "icon-button");
  node.setAttribute("aria-label", label);
  node.title = label;
  node.innerHTML = icon(glyph);
  return node;
}

export function avatar(member, size = "") {
  const tint = (member.id || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6;
  const node = el("span", "avatar a-" + tint + (size ? " " + size : ""));
  node.setAttribute("aria-hidden", "true");
  const fallback = () => {
    const initial = Array.from(member.nickname || "")[0];
    if (initial) node.textContent = initial;
    else node.innerHTML = icon("user");
  };
  if (!member.avatar) {
    fallback();
    return node;
  }
  const image = el("img");
  image.alt = "";
  image.referrerPolicy = "no-referrer";
  image.src = member.avatar;
  image.addEventListener("error", fallback, { once: true });
  node.append(image);
  return node;
}

export const statusLabels = { available: "随时可约", busy: "请勿打扰", hidden: "隐身" };

export function statusPill(status) {
  const pill = el("span", "status-pill " + status);
  pill.append(el("span", "status-dot"), statusLabels[status]);
  return pill;
}

export function cityLabel(city) {
  if (!city) return "";
  return [...new Set([city.name, city.region, city.country].filter(Boolean))].join(" · ");
}

export function heading(title, subtitle) {
  const node = el("section", "hero");
  node.append(el("h1", "", title), el("p", "", subtitle));
  return node;
}

export async function api(path, method = "GET", payload, signal) {
  const options = { method, signal, cache: "no-store" };
  if (payload !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "请求失败，请重试。");
    error.status = response.status;
    throw error;
  }
  return data;
}

let toastTimer;
export function notify(message, failure = false) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("failure", failure);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}
