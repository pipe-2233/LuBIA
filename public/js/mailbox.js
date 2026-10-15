import { esc } from "./api.js";

let token = null, carpeta = "INBOX", pagina = 1, busqueda = "", seleccion = null;
const $ = (id) => document.getElementById(id);
const ls = {
  get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k) || ""; } catch { return ""; } },
  set: (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch {} },
};

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { "x-mail-session": token } : {}) } });
  if (opts.raw) return r;
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token && !path.includes("/mail/login")) { salir(); throw new Error(d.error || "Sesión vencida"); }
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}

const NOMBRES = { "\\Sent": "Enviados", "\\Drafts": "Borradores", "\\Trash": "Papelera", "\\Junk": "Spam", "\\Archive": "Archivo", "\\All": "Todos" };
const ICONOS = { "\\Sent": "send", "\\Drafts": "draft", "\\Trash": "delete", "\\Junk": "report", "\\Archive": "inventory_2" };
const fmtFecha = (d) => {
  if (!d) return "";
  const f = new Date(d), h = new Date();
  return f.toDateString() === h.toDateString() ? f.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : f.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
};
const fmtKB = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

export function mailTab(t) {
  const live = t === "live";
  $("tab-live").classList.toggle("on", live);
  $("tab-arch").classList.toggle("on", !live);
  $("correos-live").style.display = live ? "flex" : "none";
  $("correos-archivo").style.display = live ? "none" : "grid";
  $("mail-live-tools").style.display = live && token ? "flex" : "none";
  $("correos-arch-tools").style.display = live ? "none" : "flex";
  if (!live) window.LuBIA.browseCorreos();
}

export function mailInit() {
  $("mail-host").value = ls.get("mail_host");
  $("mail-usr").value = ls.get("mail_user");
  token = ss.get("mail_token") || null;
  if (token) abrirBuzon(ss.get("mail_who"));
  mailTab("live");
}

export async function mailLogin() {
  const msg = $("mail-login-msg"), btn = $("mail-login-btn");
  const host = $("mail-host").value.trim(), user = $("mail-usr").value.trim(), pass = $("mail-pass").value;
  if (!host || !user || !pass) { msg.className = "banner error"; msg.textContent = "Completa servidor, usuario y contraseña"; return; }
  btn.disabled = true;
  msg.className = "banner processing"; msg.innerHTML = '<span class="spinner"></span> Conectando...';
  try {
    const d = await api("/api/mail/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, user, pass }) });
    if ($("mail-remember").checked) { ls.set("mail_host", host); ls.set("mail_user", user); } else { ls.set("mail_host", ""); ls.set("mail_user", ""); }
    $("mail-pass").value = "";
    token = d.token; ss.set("mail_token", token); ss.set("mail_who", d.user);
    msg.className = "banner"; msg.textContent = "";
    abrirBuzon(d.user, d.carpetas);
  } catch (e) {
    msg.className = "banner error"; msg.textContent = e.message;
  }
  btn.disabled = false;
}

async function abrirBuzon(who, carpetas) {
  $("mail-login").style.display = "none";
  $("mail-box").style.display = "grid";
  $("mail-live-tools").style.display = "flex";
  $("mail-user").textContent = who || "";
  carpeta = "INBOX"; pagina = 1; busqueda = ""; seleccion = null;
  $("mail-reader").innerHTML = '<p class="mu-empty">Selecciona un correo para leerlo</p>';
  try {
    if (!carpetas) carpetas = (await api("/api/mail/folders")).carpetas;
    pintarCarpetas(carpetas);
  } catch { return; }
  cargarLista(true);
}

function pintarCarpetas(lista) {
  window.__mailCarpetas = lista;
  const orden = [...lista].sort((a, b) => (a.path.toUpperCase() === "INBOX" ? -1 : b.path.toUpperCase() === "INBOX" ? 1 : a.name.localeCompare(b.name)));
  $("mail-folders").innerHTML = orden.map((f) => {
    const inbox = f.path.toUpperCase() === "INBOX";
    const nombre = inbox ? "Bandeja de entrada" : NOMBRES[f.especial] || f.name;
    const ico = inbox ? "inbox" : ICONOS[f.especial] || "folder";
    return `<button class="mail-folder ${f.path === carpeta ? "on" : ""}" data-path="${esc(f.path)}"><span class="ms">${ico}</span>${esc(nombre)}</button>`;
  }).join("");
  $("mail-folders").querySelectorAll(".mail-folder").forEach((b) => b.addEventListener("click", () => {
    carpeta = b.dataset.path; pagina = 1; busqueda = ""; $("mail-q").value = ""; seleccion = null;
    $("mail-reader").innerHTML = '<p class="mu-empty">Selecciona un correo para leerlo</p>';
    pintarCarpetas(window.__mailCarpetas);
    cargarLista(true);
  }));
}

async function cargarLista(reset) {
  const el = $("mail-list");
  if (reset) el.innerHTML = '<p class="mu-empty"><span class="spinner"></span> Cargando correos...</p>';
  try {
    const d = await api(`/api/mail/messages?folder=${encodeURIComponent(carpeta)}&page=${pagina}&q=${encodeURIComponent(busqueda)}`);
    const filas = d.mensajes.map((m) => `
      <div class="mail-item ${m.leido ? "" : "nuevo"} ${seleccion === m.uid ? "on" : ""}" data-uid="${m.uid}">
        <div class="r1"><span class="de">${esc(m.de)}</span><span class="fe">${fmtFecha(m.fecha)}</span></div>
        <div class="as">${m.adjuntos ? '<span class="ms clip">attach_file</span>' : ""}${esc(m.asunto)}</div>
      </div>`).join("");
    if (reset) el.innerHTML = filas || '<p class="mu-empty">Sin correos</p>';
    else el.insertAdjacentHTML("beforeend", filas);
    el.querySelectorAll(".mail-item:not([data-b])").forEach((it) => { it.dataset.b = 1; it.addEventListener("click", () => abrirMensaje(Number(it.dataset.uid))); });
    $("mail-more").style.display = d.pagina * d.porPagina < d.total ? "block" : "none";
  } catch (e) {
    el.innerHTML = `<p class="mu-empty" style="color:#EF4444">${esc(e.message)}</p>`;
  }
}

export function mailMas() { pagina++; cargarLista(false); }
export function mailBuscar() { busqueda = $("mail-q").value.trim(); pagina = 1; cargarLista(true); }
export function mailRefrescar() { pagina = 1; cargarLista(true); }

async function abrirMensaje(uid) {
  seleccion = uid;
  document.querySelectorAll(".mail-item").forEach((i) => { i.classList.toggle("on", Number(i.dataset.uid) === uid); });
  const el = $("mail-reader");
  el.innerHTML = '<p class="mu-empty"><span class="spinner"></span> Abriendo...</p>';
  try {
    const m = await api(`/api/mail/message?folder=${encodeURIComponent(carpeta)}&uid=${uid}`);
    const adj = m.adjuntos.map((a) => `<button data-i="${a.i}" data-n="${esc(a.nombre)}"><span class="ms" style="font-size:16px">download</span>${esc(a.nombre)} · ${fmtKB(a.tamano)}</button>`).join("");
    el.innerHTML = `
      <h3>${esc(m.asunto)}</h3>
      <div class="correos-meta"><strong>De:</strong> ${esc(m.de)}</div>
      <div class="correos-meta"><strong>Para:</strong> ${esc(m.para)}</div>
      ${m.cc ? `<div class="correos-meta"><strong>CC:</strong> ${esc(m.cc)}</div>` : ""}
      <div class="correos-meta"><strong>Fecha:</strong> ${m.fecha ? new Date(m.fecha).toLocaleString("es-CO") : ""}</div>
      ${adj ? `<div class="mail-adj">${adj}</div>` : ""}
      <iframe class="mail-frame" sandbox referrerpolicy="no-referrer"></iframe>
      ${m.html ? '<div class="mail-note">Las imágenes externas están bloqueadas por seguridad.</div>' : ""}`;
    const cuerpo = m.html
      ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;margin:12px;word-wrap:break-word}</style>${m.html}`
      : `<style>body{font-family:Arial,sans-serif;font-size:14px;margin:12px;white-space:pre-wrap}</style>${esc(m.texto)}`;
    el.querySelector("iframe").srcdoc = cuerpo;
    el.querySelectorAll(".mail-adj button").forEach((b) => b.addEventListener("click", () => bajarAdjunto(uid, b.dataset.i, b.dataset.n)));
  } catch (e) {
    el.innerHTML = `<p class="mu-empty" style="color:#EF4444">${esc(e.message)}</p>`;
  }
}

async function bajarAdjunto(uid, i, nombre) {
  try {
    const r = await api(`/api/mail/attachment?folder=${encodeURIComponent(carpeta)}&uid=${uid}&i=${i}`, { raw: true });
    if (!r.ok) throw new Error("No se pudo descargar el adjunto");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a"); a.href = url; a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { alert(e.message); }
}

function salir() {
  token = null; ss.set("mail_token", ""); ss.set("mail_who", "");
  $("mail-box").style.display = "none";
  $("mail-login").style.display = "block";
  $("mail-live-tools").style.display = "none";
}

export async function mailLogout() {
  try { await api("/api/mail/logout", { method: "POST" }); } catch {}
  salir();
}
