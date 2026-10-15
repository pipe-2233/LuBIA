import { Router } from "express";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "../config/env.js";

// PROTOTIPO: persistencia en JSON local para validar flujo y pantallas.
// La versión real sincronizará con LubTracker y usará el NAS como fuente de verdad.
const router = Router();
const FILE = join(DATA_DIR, "muestras.json");

export const ESTADOS = [
  { id: "registrada", nombre: "Registrada", dueno: "INGELUBSA", sistema: "Lub-IA" },
  { id: "asignada", nombre: "Asignada a cliente", dueno: "INGELUBSA", sistema: "Lub-IA" },
  { id: "despachada", nombre: "Despachada", dueno: "INGELUBSA", sistema: "Lub-IA" },
  { id: "en_cliente", nombre: "En poder del cliente", dueno: "Responsable del cliente", sistema: "LubTracker" },
  { id: "pendiente_toma", nombre: "Pendiente de toma", dueno: "Automático o ingeniero INGELUBSA", sistema: "Lub-IA" },
  { id: "toma_realizada", nombre: "Toma realizada", dueno: "Responsable del cliente", sistema: "LubTracker" },
  { id: "envio_lab", nombre: "Envío a laboratorio", dueno: "Por definir", sistema: "Por definir" },
  { id: "en_analisis", nombre: "En análisis", dueno: "INGELUBSA", sistema: "Lub-IA" },
  { id: "resultado", nombre: "Resultado emitido", dueno: "Automático por correo", sistema: "Lub-IA" },
  { id: "anulada", nombre: "Anulada", dueno: "INGELUBSA", sistema: "Lub-IA" },
];
const ORDEN = ESTADOS.filter((e) => e.id !== "anulada").map((e) => e.id);

const CLIENTES = [
  { id: "palmeiras", nombre: "Palmeiras" },
  { id: "san-benito", nombre: "Ladrillera San Benito" },
];
// Jerarquía de ejemplo (en real se lee del Archivo Maestro de LubTracker)
const PUNTOS = {
  palmeiras: ["Planta 1 › Molino 2 › Reductor principal › Caja", "Planta 1 › Extrusora › Motorreductor › Caja", "Planta 1 › Compresor 1 › Cárter"],
  "san-benito": ["Hornos › Ventilador 3 › Rodamiento lado motor", "Prensa › Hidráulico › Tanque", "Trituración › Reductor 1 › Caja"],
};

function ahora(offsetDias = 0) {
  return new Date(Date.now() + offsetDias * 864e5).toISOString();
}
function ev(estado, who, nota, d = 0) {
  return { fecha: ahora(d), estado, responsable: who, nota: nota || "" };
}

function seed() {
  const m = [];
  const mk = (n, estado, extra = {}) => {
    const id = `26230P0${3860 + n}`;
    const idx = ORDEN.indexOf(estado);
    const hist = [ev("registrada", "Admin INGELUBSA", "Lote inicial", -20)];
    for (let i = 1; i <= idx; i++) hist.push(ev(ORDEN[i], i <= 2 || ORDEN[i] === "pendiente_toma" || ORDEN[i] === "en_analisis" || ORDEN[i] === "resultado" ? "Admin INGELUBSA" : "Cliente", "", -20 + i * 2));
    if (estado === "anulada") hist.push(ev("anulada", "Admin INGELUBSA", extra.motivo, -1));
    return { id, componentId: id, estado, cliente: null, punto: null, programacion: null, foto: false, historial: hist, ...extra };
  };
  m.push(mk(1, "resultado", { cliente: "palmeiras", punto: PUNTOS.palmeiras[0], foto: true }));
  m.push(mk(2, "en_analisis", { cliente: "palmeiras", punto: PUNTOS.palmeiras[1], foto: true }));
  m.push(mk(3, "envio_lab", { cliente: "san-benito", punto: PUNTOS["san-benito"][0], foto: true }));
  m.push(mk(4, "toma_realizada", { cliente: "san-benito", punto: PUNTOS["san-benito"][1], foto: true }));
  m.push(mk(5, "pendiente_toma", { cliente: "palmeiras", punto: PUNTOS.palmeiras[2], programacion: { cada: 3, unidad: "meses", proxima: ahora(-2) } }));
  m.push(mk(6, "en_cliente", { cliente: "san-benito" }));
  m.push(mk(7, "despachada", { cliente: "palmeiras" }));
  m.push(mk(8, "asignada", { cliente: "palmeiras" }));
  m.push(mk(9, "registrada"));
  m.push(mk(10, "anulada", { cliente: "san-benito", motivo: "Frasco dañado en el despacho" }));
  return m;
}

function load() {
  if (!existsSync(FILE)) save(seed());
  return JSON.parse(readFileSync(FILE, "utf8"));
}
function save(d) {
  writeFileSync(FILE, JSON.stringify(d, null, 2));
}

router.get("/muestras/meta", (_req, res) => res.json({ estados: ESTADOS, clientes: CLIENTES, puntos: PUNTOS }));

router.get("/muestras", (_req, res) => res.json(load()));

// Registrar lote de etiquetas por rango de consecutivos
router.post("/muestras/lote", (req, res) => {
  const { prefijo = "26230P", desde, hasta, responsable = "Admin INGELUBSA" } = req.body;
  const a = Number(desde), b = Number(hasta);
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 500)
    return res.status(400).json({ error: "Rango inválido (máx. 500 etiquetas)" });
  const datos = load();
  const existentes = new Set(datos.map((x) => x.componentId));
  const ancho = String(desde).length;
  let creadas = 0;
  for (let n = a; n <= b; n++) {
    const id = `${prefijo}${String(n).padStart(ancho, "0")}`;
    if (existentes.has(id)) continue;
    datos.push({ id, componentId: id, estado: "registrada", cliente: null, punto: null, programacion: null, foto: false, historial: [ev("registrada", responsable, "Registro de lote")] });
    creadas++;
  }
  save(datos);
  res.json({ creadas });
});

// Avanzar, asignar o anular
router.post("/muestras/:id/accion", (req, res) => {
  const datos = load();
  const m = datos.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: "Muestra no encontrada" });
  const { tipo, cliente, punto, motivo, responsable = "Admin INGELUBSA", programacion } = req.body;

  if (m.estado === "anulada" || m.estado === "resultado")
    return res.status(409).json({ error: "La muestra ya está cerrada" });

  if (tipo === "anular") {
    if (!motivo?.trim()) return res.status(400).json({ error: "La anulación requiere un motivo" });
    m.estado = "anulada";
    m.historial.push(ev("anulada", responsable, motivo));
  } else if (tipo === "asignar") {
    if (m.estado !== "registrada") return res.status(409).json({ error: "Solo se asigna una muestra registrada" });
    if (!CLIENTES.some((c) => c.id === cliente)) return res.status(400).json({ error: "Cliente inválido" });
    m.cliente = cliente;
    m.estado = "asignada";
    m.historial.push(ev("asignada", responsable, `Cliente: ${cliente}`));
  } else if (tipo === "avanzar") {
    const i = ORDEN.indexOf(m.estado);
    const sig = ORDEN[i + 1];
    if (m.estado === "asignada" && !m.cliente) return res.status(409).json({ error: "Falta cliente" });
    if (sig === "toma_realizada" || m.estado === "pendiente_toma") {
      // simulación de LubTracker: la toma la hace el responsable del cliente
      m.foto = true;
    }
    if (punto) m.punto = punto;
    if (programacion) m.programacion = programacion;
    m.estado = sig;
    m.historial.push(ev(sig, responsable, req.body.nota || ""));
  } else return res.status(400).json({ error: "Acción desconocida" });

  save(datos);
  res.json(m);
});

router.post("/muestras/reiniciar-demo", (_req, res) => {
  save(seed());
  res.json({ ok: true });
});

export default router;
