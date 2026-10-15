import { esc, apiRequest, toggleModal, showBanner } from "./api.js";

let meta = null, muestras = [], sel = null;
const fmt = (d) => new Date(d).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
const estadoNombre = (id) => meta.estados.find((e) => e.id === id)?.nombre || id;
const clienteNombre = (id) => meta.clientes.find((c) => c.id === id)?.nombre || "—";

export async function muLoad() {
  if (!meta) {
    meta = await apiRequest("/api/muestras/meta");
    const fc = document.getElementById("mu-f-cliente"), fe = document.getElementById("mu-f-estado");
    meta.clientes.forEach((c) => fc.insertAdjacentHTML("beforeend", `<option value="${c.id}">${esc(c.nombre)}</option>`));
    meta.estados.forEach((e) => fe.insertAdjacentHTML("beforeend", `<option value="${e.id}">${esc(e.nombre)}</option>`));
  }
  muestras = await apiRequest("/api/muestras");
  muRender();
  muDetail();
}

export function muRender() {
  if (!meta) return;
  const c = document.getElementById("mu-f-cliente").value, e = document.getElementById("mu-f-estado").value;
  const q = document.getElementById("mu-f-q").value.trim().toLowerCase();

  const counts = {};
  muestras.forEach((m) => (counts[m.estado] = (counts[m.estado] || 0) + 1));
  document.getElementById("mu-flow").innerHTML = meta.estados.map((s) =>
    `<button class="mu-step ${e === s.id ? "on" : ""} st-${s.id}" onclick="window.LuBIA.muFiltroEstado('${s.id}')"><b>${counts[s.id] || 0}</b><span>${esc(s.nombre)}</span></button>`).join("");

  const rows = muestras.filter((m) => (!c || m.cliente === c) && (!e || m.estado === e) && (!q || m.componentId.toLowerCase().includes(q)));
  document.getElementById("mu-body").innerHTML = rows.map((m) => `
    <tr class="${sel === m.id ? "sel" : ""}" onclick="window.LuBIA.muSelect('${m.id}')">
      <td class="mono">${esc(m.componentId)}</td>
      <td>${esc(clienteNombre(m.cliente))}</td>
      <td>${esc(m.punto || "—")}</td>
      <td><span class="mu-chip st-${m.estado}">${esc(estadoNombre(m.estado))}</span></td>
      <td>${m.foto ? '<span class="ms" style="color:#16a34a;font-size:18px">photo_camera</span>' : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="mu-empty">Sin resultados</td></tr>`;
}

export function muFiltroEstado(id) {
  const f = document.getElementById("mu-f-estado");
  f.value = f.value === id ? "" : id;
  muRender();
}

export function muSelect(id) { sel = id; muRender(); muDetail(); }

function muDetail() {
  const el = document.getElementById("mu-detail");
  const m = muestras.find((x) => x.id === sel);
  if (!m) { el.innerHTML = '<p class="mu-empty">Selecciona una muestra para ver su detalle y auditoría</p>'; return; }
  const est = meta.estados.find((s) => s.id === m.estado);
  const cerrada = m.estado === "anulada" || m.estado === "resultado";
  const idx = meta.estados.findIndex((s) => s.id === m.estado);
  const sig = !cerrada ? meta.estados[idx + 1] : null;

  let acciones = "";
  if (m.estado === "registrada") {
    acciones = `<select id="mu-asig">${meta.clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select>
      <button class="btn btn-primary btn-sm" onclick="window.LuBIA.muAsignar('${m.id}')">Asignar a cliente</button>`;
  } else if (m.estado === "en_cliente") {
    const pts = meta.puntos[m.cliente] || [];
    acciones = `<label class="mu-lbl">Vincular a punto de muestreo (LubTracker)</label>
      <select id="mu-punto">${pts.map((p) => `<option>${esc(p)}</option>`).join("")}</select>
      <label class="mu-lbl">Periodicidad (meses)</label><input id="mu-per" type="number" min="1" value="3">
      <button class="btn btn-primary btn-sm" onclick="window.LuBIA.muVincular('${m.id}')">Vincular y programar</button>`;
  } else if (sig) {
    acciones = `<button class="btn btn-primary btn-sm" onclick="window.LuBIA.muAvanzar('${m.id}')">Avanzar a «${esc(sig.nombre)}»</button>`;
  }
  if (!cerrada) acciones += `<button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="window.LuBIA.muAnular('${m.id}')">Anular con motivo</button>`;

  const simulado = est && est.sistema === "LubTracker" ? `<div class="mu-note">En producción este paso lo hace el responsable del cliente desde LubTracker. Aquí se simula para ver el flujo.</div>` : "";

  el.innerHTML = `
    <h3 class="mono">${esc(m.componentId)}</h3>
    <span class="mu-chip st-${m.estado}">${esc(estadoNombre(m.estado))}</span>
    <dl class="mu-dl">
      <dt>Cliente</dt><dd>${esc(clienteNombre(m.cliente))}</dd>
      <dt>Punto de muestreo</dt><dd>${esc(m.punto || "—")}</dd>
      <dt>Responsable del estado</dt><dd>${esc(est?.dueno || "")} · ${esc(est?.sistema || "")}</dd>
      <dt>Próxima toma</dt><dd>${m.programacion ? `cada ${m.programacion.cada} ${m.programacion.unidad} · ${fmt(m.programacion.proxima)}` : "—"}</dd>
      <dt>Foto del formulario</dt><dd>${m.foto ? "Adjunta (evidencia)" : "Pendiente"}</dd>
    </dl>
    ${simulado}
    <div class="mu-acts">${acciones}</div>
    <h4>Auditoría</h4>
    <ol class="mu-hist">${[...m.historial].reverse().map((h) => `
      <li><b>${esc(estadoNombre(h.estado))}</b><span>${fmt(h.fecha)} · ${esc(h.responsable)}</span>${h.nota ? `<em>${esc(h.nota)}</em>` : ""}</li>`).join("")}</ol>`;
}

async function accion(id, body) {
  try {
    await apiRequest(`/api/muestras/${encodeURIComponent(id)}/accion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await muLoad();
  } catch (e) { alert(e.message); }
}

export const muAsignar = (id) => accion(id, { tipo: "asignar", cliente: document.getElementById("mu-asig").value });
export const muAvanzar = (id) => accion(id, { tipo: "avanzar" });
export const muVincular = (id) => accion(id, {
  tipo: "avanzar", punto: document.getElementById("mu-punto").value, nota: "Vinculada al punto desde LubTracker",
  programacion: { cada: Number(document.getElementById("mu-per").value) || 3, unidad: "meses", proxima: new Date(Date.now() + 90 * 864e5).toISOString() },
});
export function muAnular(id) {
  const motivo = prompt("Motivo de la anulación (obligatorio):");
  if (motivo) accion(id, { tipo: "anular", motivo });
}
export async function muLote() {
  try {
    const r = await apiRequest("/api/muestras/lote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      prefijo: document.getElementById("lote-prefijo").value, desde: document.getElementById("lote-desde").value, hasta: document.getElementById("lote-hasta").value }) });
    toggleModal("modal-lote");
    await muLoad();
    showBanner(`${r.creadas} etiquetas registradas`, "success");
    setTimeout(() => document.getElementById("banner") && (document.getElementById("banner").className = "banner"), 2500);
  } catch (e) { alert(e.message); }
}
export async function muReiniciar() {
  await apiRequest("/api/muestras/reiniciar-demo", { method: "POST" });
  sel = null; await muLoad();
}
