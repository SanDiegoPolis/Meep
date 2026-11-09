import { $, el, iconButton } from "./ui.js";

const center = { x: .5, y: .5 };
const world = { ...center, zoom: 1 };
const latitudeSpan = 360 * 420 / 1000;
const maxZoom = 48;
const zoomStep = 1.5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (value) => ((value % 1) + 1) % 1;
const longitudeX = (longitude) => (longitude + 180) / 360;
const latitudeY = (latitude) => (84 - latitude) / latitudeSpan;

export function countryCamera(country) {
  if (!country) return world;
  const { west, east, south, north } = country;
  const width = (east - west) / 360;
  const height = (north - south) / latitudeSpan;
  const zoom = clamp(1 / (1.24 * Math.max(width, height)), 1, 16);
  return cameraAt(longitudeX((west + east) / 2), latitudeY((south + north) / 2), zoom);
}

export function moveCamera(camera, zoom, from = center, to = from) {
  const nextZoom = clamp(zoom, 1, maxZoom);
  return cameraAt(
    camera.x + (from.x - .5) / camera.zoom - (to.x - .5) / nextZoom,
    camera.y + (from.y - .5) / camera.zoom - (to.y - .5) / nextZoom,
    nextZoom,
  );
}

export function screenPoint(camera, { lat, lon }) {
  const x = longitudeX(lon);
  const offset = camera.zoom === 1 ? x - .5 : wrap(x - camera.x + .5) - .5;
  return { x: .5 + offset * camera.zoom, y: .5 + (latitudeY(lat) - camera.y) * camera.zoom };
}

function cameraAt(x, y, zoom) {
  if (zoom === 1) return world;
  const halfHeight = .5 / zoom;
  return { x: wrap(x), y: clamp(y, halfHeight, 1 - halfHeight), zoom };
}

export function mountMapView(stage, country, onChange, signal) {
  const surface = $(".map-surface", stage);
  const caption = $(".map-view-label", stage);
  const actions = el("div", "map-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "地图控制");
  const zoomIn = iconButton("放大地图", "plus");
  const zoomOut = iconButton("缩小地图", "minus");
  const showWorld = iconButton("切回世界视图", "globe");
  actions.append(zoomIn, zoomOut, showWorld);
  const home = countryCamera(country);
  let camera = home;
  let label = country?.name ?? "";
  if (country) {
    const showCountry = iconButton("返回" + country.name + "视图", "pin");
    showCountry.addEventListener("click", () => show(home, country.name), { signal });
    actions.append(showCountry);
  }
  stage.insertBefore(actions, $(".map-pins", stage));

  const pointers = new Map();
  let gesture;
  let dragging = false;
  let frame = null;
  const observer = new ResizeObserver(queueDraw);
  observer.observe(stage);
  queueDraw();

  zoomIn.addEventListener("click", () => show(moveCamera(camera, camera.zoom * zoomStep)), { signal });
  zoomOut.addEventListener("click", () => show(moveCamera(camera, camera.zoom / zoomStep)), { signal });
  showWorld.addEventListener("click", () => show(world), { signal });
  stage.addEventListener("wheel", (event) => {
    if (event.target.closest(".login-card")) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    const factor = Math.exp(-clamp(event.deltaY * unit, -300, 300) * .0025);
    const zoom = clamp(camera.zoom * factor, 1, maxZoom);
    if (zoom === camera.zoom && !event.ctrlKey) return;
    event.preventDefault();
    show(moveCamera(camera, zoom, relativePoint(event.clientX, event.clientY)));
  }, { passive: false, signal });
  stage.addEventListener("keydown", (event) => {
    if (event.target !== stage || event.ctrlKey || event.altKey || event.metaKey) return;
    const directions = {
      ArrowLeft: { x: .35, y: .5 }, ArrowRight: { x: .65, y: .5 },
      ArrowUp: { x: .5, y: .35 }, ArrowDown: { x: .5, y: .65 },
    };
    if (event.key === "+" || event.key === "=") show(moveCamera(camera, camera.zoom * zoomStep));
    else if (event.key === "-") show(moveCamera(camera, camera.zoom / zoomStep));
    else if (camera.zoom > 1 && directions[event.key]) {
      show(moveCamera(camera, camera.zoom, directions[event.key], center));
    } else return;
    event.preventDefault();
  }, { signal });
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointers.size >= 2 || event.target.closest(".map-actions, .login-card")) return;
    if (event.pointerType === "mouse" && event.target.closest(".map-pin")) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture = sampleGesture();
    if (pointers.size === 2) startDrag();
    else if (!event.target.closest(".map-pin")) stage.setPointerCapture(event.pointerId);
  }, { signal });
  stage.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const next = sampleGesture();
    if (!dragging && Math.hypot(next.x - gesture.x, next.y - gesture.y) < 4) return;
    if (!dragging) startDrag();
    const factor = gesture.distance > 0 && next.distance > 0 ? next.distance / gesture.distance : 1;
    show(moveCamera(camera, camera.zoom * factor, relativePoint(gesture.x, gesture.y), relativePoint(next.x, next.y)));
    gesture = next;
  }, { signal });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    stage.addEventListener(eventName, (event) => {
      if (event.type === "lostpointercapture" && event.target !== stage) return;
      if (!pointers.delete(event.pointerId)) return;
      if (pointers.size) gesture = sampleGesture();
      else {
        dragging = false;
        stage.classList.remove("dragging");
      }
    }, { signal });
  }
  signal.addEventListener("abort", () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  }, { once: true });

  return { point: (city) => screenPoint(camera, city) };

  function relativePoint(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  }

  function sampleGesture() {
    const [first, second] = pointers.values();
    if (!second) return { ...first, distance: 0 };
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  }

  function startDrag() {
    dragging = true;
    stage.classList.add("dragging");
    for (const id of pointers.keys()) stage.setPointerCapture(id);
  }

  function show(next, nextLabel = "") {
    if (camera.x === next.x && camera.y === next.y && camera.zoom === next.zoom && label === nextLabel) return;
    camera = next;
    label = nextLabel;
    queueDraw();
  }

  function queueDraw() {
    if (frame !== null || signal.aborted) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const { clientWidth: width, clientHeight: height } = stage;
      const { x, y, zoom } = camera;
      surface.style.backgroundSize = (width * zoom) + "px " + (height * zoom) + "px";
      surface.style.backgroundPosition = (width * (.5 - x * zoom)) + "px " + (height * (.5 - y * zoom)) + "px";
      caption.textContent = zoom === 1 ? "世界视图"
        : [label, zoom.toLocaleString("zh-CN", { maximumFractionDigits: 1 }) + "×"].filter(Boolean).join(" · ");
      stage.classList.toggle("zoomed", zoom > 1);
      zoomOut.disabled = zoom === 1;
      zoomIn.disabled = zoom === maxZoom;
      onChange();
    });
  }
}
