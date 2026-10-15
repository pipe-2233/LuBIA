import { esc } from "./api.js";

let token = null, carpeta = "INBOX", pagina = 1, busqueda = "", seleccion = null, vista = "principal";
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
const PALETA = ["#B45309", "#0E7490", "#4D7C0F", "#7C3AED", "#BE123C", "#1D4ED8", "#475569", "#A16207"];
const color = (t) => { let h = 0; for (const c of t || "?") h = (h * 31 + c.charCodeAt(0)) | 0; return PALETA[Math.abs(h) % PALETA.length]; };
const iniciales = (n) => (n || "?").replace(/[<>"@.]/g, " ").trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "?";
const avatar = (n, c, big) => `<span class="mail-av ${big ? "big" : ""}" style="background:${color(c || n)}">${esc(iniciales(n))}</span>`;
const iconoArchivo = (n, t) => /pdf/i.test(t + n) ? ["picture_as_pdf", "#DC2626"] : /sheet|excel|xls|csv/i.test(t + n) ? ["table_chart", "#16A34A"] : /image/i.test(t) ? ["image", "#0891B2"] : /word|doc/i.test(t + n) ? ["description", "#2563EB"] : /zip|rar/i.test(t + n) ? ["folder_zip", "#CA8A04"] : ["attach_file", "#64748B"];
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
  $("mail-reader").innerHTML = '<div class="mail-empty"><span class="ms">drafts</span><p>Selecciona un correo para leerlo</p></div>';
  try {
    if (!carpetas) carpetas = (await api("/api/mail/folders")).carpetas;
    pintarCarpetas(carpetas);
  } catch { return; }
  cargarLista(true);
}

function pintarCarpetas(lista) {
  window.__mailCarpetas = lista;
  const peso = (f) => (f.path.toUpperCase() === "INBOX" ? 0 : f.especial === "\\Sent" ? 1 : f.especial === "\\Drafts" ? 2 : f.especial === "\\Junk" ? 4 : f.especial === "\\Trash" ? 5 : 3);
  const orden = [...lista].sort((a, b) => peso(a) - peso(b) || a.name.localeCompare(b.name));
  $("mail-folders").innerHTML = '<div class="mail-folders-t">Carpetas</div>' + orden.map((f) => {
    const inbox = f.path.toUpperCase() === "INBOX";
    const nombre = inbox ? "Bandeja de entrada" : NOMBRES[f.especial] || f.name;
    const ico = inbox ? "inbox" : ICONOS[f.especial] || "folder";
    return `<button class="mail-folder ${f.path === carpeta ? "on" : ""} ${f.especial === "\\Junk" ? "spam" : ""}" data-path="${esc(f.path)}"><span class="ms">${ico}</span><span class="n">${esc(nombre)}</span>${f.sinLeer ? `<b>${f.sinLeer}</b>` : ""}</button>`;
  }).join("");
  $("mail-folders").querySelectorAll(".mail-folder").forEach((b) => b.addEventListener("click", () => {
    carpeta = b.dataset.path; pagina = 1; busqueda = ""; vista = "principal"; $("mail-q").value = ""; seleccion = null;
    $("mail-reader").innerHTML = vacioLector();
    pintarCarpetas(window.__mailCarpetas);
    cargarLista(true);
  }));
}

const vacioLector = () => '<div class="mail-empty"><span class="ms">drafts</span><p>Selecciona un correo para leerlo</p></div>';
const esCarpetaSpam = () => (window.__mailCarpetas || []).find((f) => f.path === carpeta)?.especial === "\\Junk";

let mensajes = [];

async function cargarLista(reset) {
  const el = $("mail-list");
  if (reset) { mensajes = []; el.innerHTML = '<div class="mail-empty"><span class="spinner"></span><p>Cargando correos...</p></div>'; }
  try {
    const d = await api(`/api/mail/messages?folder=${encodeURIComponent(carpeta)}&page=${pagina}&q=${encodeURIComponent(busqueda)}`);
    mensajes = mensajes.concat(d.mensajes);
    hayMas = d.pagina * d.porPagina < d.total;
    pintarLista();
  } catch (e) {
    el.innerHTML = `<div class="mail-empty"><span class="ms" style="color:#EF4444">error</span><p style="color:#EF4444">${esc(e.message)}</p></div>`;
  }
}
let hayMas = false;

function pintarLista() {
  const el = $("mail-list");
  const enSpam = esCarpetaSpam();
  const nSpam = enSpam ? 0 : mensajes.filter((m) => m.spam).length;
  const nPrin = mensajes.length - nSpam;
  const visibles = enSpam ? mensajes : mensajes.filter((m) => (vista === "spam" ? m.spam : !m.spam));
  const chips = enSpam ? "" : `<div class="mail-views">
      <button class="${vista === "principal" ? "on" : ""}" data-v="principal"><span class="ms">inbox</span>Principal<b>${nPrin}</b></button>
      <button class="${vista === "spam" ? "on" : ""}" data-v="spam"><span class="ms">report</span>Spam<b>${nSpam}</b></button>
    </div>`;
  const filas = visibles.map((m) => `
    <div class="mail-item ${m.leido ? "" : "nuevo"} ${m.spam ? "es-spam" : ""} ${seleccion === m.uid ? "on" : ""}" data-uid="${m.uid}">
      ${avatar(m.nombre, m.correo)}
      <div class="mi-body">
        <div class="r1"><span class="de">${esc(m.nombre)}</span><span class="fe">${fmtFecha(m.fecha)}</span></div>
        <div class="as">${esc(m.asunto)}</div>
        <div class="tags">${m.leido ? "" : '<i class="dot" title="Sin leer"></i>'}${m.adjuntos ? '<span class="ms" title="Tiene adjuntos">attach_file</span>' : ""}${m.spam && !enSpam ? '<span class="tag-spam">SPAM</span>' : ""}</div>
      </div>
    </div>`).join("");
  el.innerHTML = chips + (filas || `<div class="mail-empty"><span class="ms">${vista === "spam" ? "verified_user" : "mark_email_read"}</span><p>${vista === "spam" ? "No hay spam en lo cargado" : "No hay correos"}</p></div>`);
  el.querySelectorAll(".mail-views button").forEach((b) => b.addEventListener("click", () => { vista = b.dataset.v; pintarLista(); }));
  el.querySelectorAll(".mail-item").forEach((it) => it.addEventListener("click", () => abrirMensaje(Number(it.dataset.uid))));
  $("mail-more").style.display = hayMas ? "inline-flex" : "none";
}

export function mailMas() { pagina++; cargarLista(false); }
export function mailBuscar() { busqueda = $("mail-q").value.trim(); pagina = 1; cargarLista(true); }
export function mailRefrescar() { pagina = 1; cargarLista(true); }

async function abrirMensaje(uid) {
  seleccion = uid;
  document.querySelectorAll(".mail-item").forEach((i) => { i.classList.toggle("on", Number(i.dataset.uid) === uid); });
  const el = $("mail-reader");
  el.innerHTML = '<div class="mail-empty"><span class="spinner"></span><p>Abriendo...</p></div>';
  try {
    const m = await api(`/api/mail/message?folder=${encodeURIComponent(carpeta)}&uid=${uid}`);
    const adj = m.adjuntos.map((a) => { const [ic, col] = iconoArchivo(a.nombre, a.tipo || ""); return `<button data-i="${a.i}" data-n="${esc(a.nombre)}" title="Descargar"><span class="ms" style="color:${col}">${ic}</span><span class="an">${esc(a.nombre)}</span><small>${fmtKB(a.tamano)}</small><span class="ms dl">download</span></button>`; }).join("");
    el.innerHTML = `
      <div class="rd-head">
        ${avatar(m.nombre, m.correo, true)}
        <div class="rd-who">
          <h3>${esc(m.asunto)}</h3>
          <div class="rd-from"><b>${esc(m.nombre)}</b> <span>&lt;${esc(m.correo)}&gt;</span></div>
          <div class="rd-meta"><span class="ms">schedule</span>${m.fecha ? new Date(m.fecha).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" }) : ""}</div>
        </div>
      </div>
      ${m.spam ? '<div class="rd-warn"><span class="ms">report</span>Este correo fue marcado como spam. Ten cuidado con enlaces y adjuntos.</div>' : ""}
      <details class="rd-det"><summary>Detalles</summary>
        <div class="correos-meta"><strong>Para:</strong> ${esc(m.para)}</div>
        ${m.cc ? `<div class="correos-meta"><strong>CC:</strong> ${esc(m.cc)}</div>` : ""}
      </details>
      ${adj ? `<div class="mail-adj">${adj}</div>` : ""}
      <iframe class="mail-frame" sandbox referrerpolicy="no-referrer"></iframe>
      ${m.html ? '<div class="mail-note"><span class="ms">shield</span>Las imágenes externas están bloqueadas por seguridad.</div>' : ""}`;
    const cuerpo = m.html
      ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;margin:14px;word-wrap:break-word}</style>${m.html}`
      : `<style>body{font-family:Arial,sans-serif;font-size:14px;margin:14px;white-space:pre-wrap}</style>${esc(m.texto)}`;
    el.querySelector("iframe").srcdoc = cuerpo;
    el.querySelectorAll(".mail-adj button").forEach((b) => b.addEventListener("click", () => bajarAdjunto(uid, b.dataset.i, b.dataset.n)));
  } catch (e) {
    el.innerHTML = `<div class="mail-empty"><span class="ms" style="color:#EF4444">error</span><p style="color:#EF4444">${esc(e.message)}</p></div>`;
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
