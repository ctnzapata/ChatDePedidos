import { STATUS_LABELS } from "../domain/order-status.ts";

// Panel mínimo sin dependencias. Todo el contenido dinámico se inserta con textContent (sin innerHTML).

export const PANEL_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel de pedidos</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#1d2433; --muted:#667085; --border:#e4e7ec; --accent:#0f766e; --danger:#b42318; --warn:#b54708; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1115; --card:#181b22; --text:#e6e8ee; --muted:#98a2b3; --border:#2a2f3a; --accent:#2dd4bf; --danger:#f97066; --warn:#fdb022; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); }
  header { position:sticky; top:0; z-index:1; display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; padding:12px 16px; background:var(--card); border-bottom:1px solid var(--border); }
  header h1 { font-size:18px; margin:0; flex:1 1 auto; }
  nav { display:flex; gap:6px; padding:12px 16px 0; flex-wrap:wrap; }
  button, select { font:inherit; border-radius:8px; border:1px solid var(--border); background:var(--card); color:var(--text); padding:8px 12px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.danger { color:var(--danger); border-color:var(--danger); }
  nav button[aria-pressed="true"] { background:var(--accent); color:#fff; border-color:var(--accent); }
  main { padding:16px; max-width:1200px; margin:0 auto; }
  .grid { display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px; }
  .card h3 { margin:0 0 4px; font-size:16px; display:flex; justify-content:space-between; gap:8px; }
  .badge { font-size:12px; padding:2px 8px; border-radius:999px; border:1px solid currentColor; white-space:nowrap; }
  .PENDING { color:var(--warn); }
  .muted { color:var(--muted); font-size:13px; }
  ul { padding-left:18px; margin:8px 0; }
  .actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
  .row { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--border); }
  .row:last-child { border-bottom:0; }
  .empty { color:var(--muted); padding:24px 0; text-align:center; }
  #toast { position:fixed; bottom:16px; left:16px; right:16px; max-width:420px; margin:auto; padding:12px; border-radius:8px; background:var(--text); color:var(--bg); display:none; }
  label.switch { display:flex; gap:6px; align-items:center; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<header>
  <h1>🍔 Panel de pedidos</h1>
  <select id="restaurant" aria-label="Restaurante"></select>
  <label class="switch"><input type="checkbox" id="accepting"> Recibiendo pedidos</label>
  <button id="sound">🔔 Activar sonido</button>
</header>
<nav>
  <button data-tab="orders" aria-pressed="true">Pedidos</button>
  <button data-tab="menu" aria-pressed="false">Menú</button>
  <button data-tab="human" aria-pressed="false">Atención humana <span id="humanCount"></span></button>
</nav>
<main>
  <section id="tab-orders">
    <label class="switch muted"><input type="checkbox" id="includeClosed"> Mostrar pedidos finalizados</label>
    <div id="orders" class="grid" style="margin-top:12px"></div>
  </section>
  <section id="tab-menu" hidden><div id="menu" class="card"></div></section>
  <section id="tab-human" hidden><div id="human" class="card"></div></section>
</main>
<div id="toast" role="status"></div>
<script src="/panel/app.js"></script>
</body>
</html>`;

export const PANEL_JS = String.raw`"use strict";
const LABELS = ${JSON.stringify(STATUS_LABELS)};
const ACTIONS = { ACCEPTED: "Aceptar", REJECTED: "Rechazar", PREPARING: "En preparación", READY: "Listo para recoger",
  OUT_FOR_DELIVERY: "Enviar (en camino)", DELIVERED: "Entregado", CANCELLED: "Cancelar" };
const DESTRUCTIVE = ["REJECTED", "CANCELLED"];
const PAYMENTS = { CASH: "Efectivo", TRANSFER: "Transferencia" };
const REFRESH_MS = 10000;
const state = { restaurantId: null, seenPending: null, soundOn: false };

const $ = (id) => document.getElementById(id);
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child));
  return node;
}
const cop = (n) => "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const time = (iso) => new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 3500);
}

async function api(path, options) {
  const response = await fetch("/panel/api" + path, Object.assign({ credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "panel" } }, options));
  const body = await response.json().catch(() => ({ success: false, error: "Respuesta inválida del servidor" }));
  if (!body.success) throw new Error(body.error || "Error");
  return body.data;
}
const post = (path, payload) => api(path, { method: "POST", body: JSON.stringify(payload) });
const base = () => "/restaurants/" + encodeURIComponent(state.restaurantId);

function beep() {
  if (!state.soundOn) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 500);
  } catch (e) { /* el navegador no permite audio */ }
}

async function changeStatus(order, status) {
  if (DESTRUCTIVE.includes(status) && !confirm(ACTIONS[status] + " el pedido #" + order.number + "?")) return;
  try {
    await post(base() + "/orders/" + encodeURIComponent(order.id) + "/status", { status });
    toast("Pedido #" + order.number + ": " + LABELS[status]);
    await refresh();
  } catch (error) { toast(error.message); }
}

function orderCard(order) {
  const destination = order.fulfillment === "DELIVERY"
    ? "🛵 " + order.address + (order.addressNotes ? " (" + order.addressNotes + ")" : "")
    : "🏪 Recoger en el local";
  const payment = PAYMENTS[order.paymentMethod] + (order.cashAmount ? " — paga con " + cop(order.cashAmount) : "");
  const items = el("ul", {}, ...order.items.map((item) => el("li", {},
    item.quantity + " x " + item.name + (item.modifiers.length ? " + " + item.modifiers.join(", ") : "") +
    (item.notes ? " (" + item.notes + ")" : "") + " — " + cop(item.lineTotal))));
  const actions = el("div", { class: "actions" }, ...order.nextStatuses.map((status) => el("button", {
    class: DESTRUCTIVE.includes(status) ? "danger" : "primary", onclick: () => changeStatus(order, status) }, ACTIONS[status])));
  return el("article", { class: "card" },
    el("h3", {}, "#" + order.number + " · " + order.customerName, el("span", { class: "badge " + order.status }, LABELS[order.status])),
    el("div", { class: "muted" }, time(order.createdAt) + " · ", el("a", { href: "https://wa.me/" + order.customerPhone, target: "_blank", rel: "noopener" }, "+" + order.customerPhone)),
    el("div", {}, destination), el("div", { class: "muted" }, "Pago: " + payment),
    items, order.notes ? el("div", { class: "muted" }, "📝 " + order.notes) : null,
    el("div", {}, el("strong", {}, "Total: " + cop(order.total)), order.deliveryFee ? el("span", { class: "muted" }, " (incluye domicilio " + cop(order.deliveryFee) + ")") : null),
    actions);
}

async function loadOrders() {
  const includeClosed = $("includeClosed").checked ? "1" : "0";
  const orders = await api(base() + "/orders?includeClosed=" + includeClosed);
  const container = $("orders");
  container.replaceChildren(...(orders.length ? orders.map(orderCard) : [el("div", { class: "empty" }, "No hay pedidos activos.")]));
  const pending = new Set(orders.filter((o) => o.status === "PENDING").map((o) => o.id));
  if (state.seenPending && [...pending].some((id) => !state.seenPending.has(id))) { beep(); toast("¡Nuevo pedido!"); }
  state.seenPending = pending;
}

async function loadMenu() {
  const menu = await api(base() + "/menu");
  const toggle = (item) => el("label", { class: "switch" }, (() => {
    const box = el("input", { type: "checkbox" });
    box.checked = item.isAvailable;
    box.addEventListener("change", async () => {
      try { await post(base() + "/availability", { code: item.code, isAvailable: box.checked }); toast(item.name + (box.checked ? " disponible" : " agotado")); }
      catch (error) { box.checked = !box.checked; toast(error.message); }
    });
    return box;
  })(), "Disponible");
  const rows = [el("h3", {}, "Productos")].concat(menu.items.map((item) =>
    el("div", { class: "row" }, el("span", {}, item.name + " ", el("span", { class: "muted" }, item.category + " · " + cop(item.price))), toggle(item))));
  rows.push(el("h3", { style: "margin-top:16px" }, "Adiciones"));
  for (const extra of menu.extras) rows.push(el("div", { class: "row" }, el("span", {}, extra.name + " ", el("span", { class: "muted" }, "+" + cop(extra.price))), toggle(extra)));
  $("menu").replaceChildren(...rows);
}

async function loadHuman() {
  const list = await api(base() + "/conversations/human");
  $("humanCount").textContent = list.length ? "(" + list.length + ")" : "";
  const rows = list.map((c) => el("div", { class: "row" },
    el("span", {}, (c.customerName || "Cliente") + " ", el("a", { href: "https://wa.me/" + c.customerPhone, target: "_blank", rel: "noopener" }, "+" + c.customerPhone)),
    el("button", { class: "primary", onclick: async () => {
      try { await post(base() + "/conversations/" + encodeURIComponent(c.id) + "/resume", {}); toast("Asistente reactivado"); await loadHuman(); }
      catch (error) { toast(error.message); }
    } }, "Reactivar asistente")));
  $("human").replaceChildren(...(rows.length ? rows : [el("div", { class: "empty" }, "Nadie está esperando atención humana.")]));
}

async function refresh() {
  if (!state.restaurantId) return;
  try { await Promise.all([loadOrders(), loadHuman()]); }
  catch (error) { toast("No se pudo actualizar: " + error.message); }
}

async function init() {
  const restaurants = await api("/restaurants");
  const select = $("restaurant");
  select.replaceChildren(...restaurants.map((r) => el("option", { value: r.id }, r.name)));
  const selectRestaurant = () => {
    const current = restaurants.find((r) => r.id === select.value) || restaurants[0];
    if (!current) return;
    state.restaurantId = current.id;
    state.seenPending = null;
    $("accepting").checked = current.isAcceptingOrders;
    refresh();
    loadMenu().catch((error) => toast(error.message));
  };
  select.addEventListener("change", selectRestaurant);
  $("accepting").addEventListener("change", async (event) => {
    const box = event.target;
    try {
      await post(base() + "/accepting", { isAcceptingOrders: box.checked });
      const current = restaurants.find((r) => r.id === state.restaurantId);
      if (current) current.isAcceptingOrders = box.checked;
      toast(box.checked ? "Recibiendo pedidos" : "Pedidos pausados");
    } catch (error) { box.checked = !box.checked; toast(error.message); }
  });
  $("includeClosed").addEventListener("change", refresh);
  $("sound").addEventListener("click", () => { state.soundOn = true; $("sound").textContent = "🔔 Sonido activo"; beep(); });
  for (const button of document.querySelectorAll("nav button")) {
    button.addEventListener("click", () => {
      for (const other of document.querySelectorAll("nav button")) other.setAttribute("aria-pressed", String(other === button));
      for (const tab of ["orders", "menu", "human"]) $("tab-" + tab).hidden = tab !== button.dataset.tab;
    });
  }
  selectRestaurant();
  setInterval(refresh, REFRESH_MS);
}

init().catch((error) => toast("Error cargando el panel: " + error.message));
`;
