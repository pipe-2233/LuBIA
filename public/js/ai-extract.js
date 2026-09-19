import { esc, showBanner, hideBanner } from "./api.js";
import { selectedFileId } from "./files.js";
import { currentProject } from "./projects.js";

export let currentTranscription = null;
export let currentData = null;

export async function transcribeProjectFile() {
  if (!selectedFileId) return;
  showBanner("Transcribiendo con Deepgram Nova-3...", "processing");

  try {
    const r = await fetch(`/api/transcribe-file/${selectedFileId}`, { method: "POST" });
    const d = await r.json();
    if (d.error) {
      showBanner(d.error, "error");
      return;
    }

    currentTranscription = d.transcription;
    const tb = document.getElementById("transcript-box");
    if (tb) {
      tb.textContent = d.transcription;
      tb.style.display = "block";
    }

    const pt = document.getElementById("preview-transcribe");
    if (pt) pt.style.display = "block";

    let be = document.getElementById("btn-extract");
    if (!be && tb) {
      be = document.createElement("button");
      be.id = "btn-extract";
      be.className = "btn btn-primary btn-sm";
      be.textContent = "⚡ Extraer datos con IA";
      be.onclick = extraerDatos;
      tb.after(be);
    }
    if (be) be.style.display = "inline-flex";
    hideBanner();
  } catch (err) {
    showBanner("Error de conexión al transcribir", "error");
  }
}

export async function extraerDatos() {
  if (!currentTranscription) return;
  showBanner("Claude analizando...", "processing");

  let templates = [];
  try {
    const r = await fetch(`/api/projects/${currentProject.id}/templates`);
    templates = await r.json();
  } catch {}

  try {
    const r = await fetch("/api/extraer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcription: currentTranscription, templates }),
    });
    currentData = await r.json();
    if (currentData.error) {
      showBanner(currentData.error, "error");
      return;
    }

    const fldActivo = document.getElementById("fld-activo");
    if (fldActivo) fldActivo.value = currentData.activo || "";

    const tb = document.getElementById("comp-tbody");
    if (tb) {
      tb.innerHTML = "";
      (currentData.componentes || []).forEach((c) =>
        addComponentRow(c.nombre || "", c.cantidad || "", c.lubricante || "", c.frecuencia || "", c.ubicacion || "")
      );
    }

    const fa = currentData.faltantes || [];
    const pr = currentData.preguntas || [];
    const md = document.getElementById("missing-alert");
    if (md) {
      if (fa.length || pr.length) {
        md.style.display = "block";
        md.innerHTML = `
          <h4>⚠️ Datos faltantes</h4>
          ${fa.map((f) => `<li>${esc(f)}</li>`).join("")}
          ${pr.length ? `<p style="margin-top:8px;font-weight:600">Preguntas:</p>` : ""}
          ${pr.map((q) => `<li style="color:#991B1B">${esc(q)}</li>`).join("")}`;
      } else {
        md.style.display = "none";
      }
    }

    const es = document.getElementById("extract-section");
    if (es) es.style.display = "block";

    const pt = document.getElementById("preview-transcribe");
    if (pt) pt.style.display = "block";

    const btnExtract = document.getElementById("btn-extract");
    if (btnExtract) btnExtract.disabled = false;

    hideBanner();
  } catch (err) {
    showBanner("Error al extraer datos: " + err.message, "error");
  }
}

export function addComponentRow(n = "", c = "", l = "", f = "", u = "") {
  const t = document.getElementById("comp-tbody");
  if (!t) return;
  const r = t.insertRow();
  r.innerHTML = `
    <td><input value="${esc(n)}" placeholder="Nombre"></td>
    <td><input value="${esc(c)}" style="width:70px"></td>
    <td><input value="${esc(l)}" placeholder="VG EP 2..."></td>
    <td><input value="${esc(f)}" placeholder="C/30 días..."></td>
    <td><input value="${esc(u)}" placeholder="Nave 3..."></td>`;
}

export async function generarExcel() {
  const a = document.getElementById("fld-activo")?.value || "";
  const obs = document.getElementById("fld-obs")?.value || "";
  const comps = [];
  const rows = document.getElementById("comp-tbody")?.rows || [];

  for (const r of rows) {
    const c = r.querySelectorAll("input");
    if (c[0] && c[0].value.trim()) {
      comps.push({
        nombre: c[0].value,
        cantidad: c[1].value,
        lubricante: c[2].value,
        frecuencia: c[3].value,
        ubicacion: c[4].value,
      });
    }
  }

  showBanner("Generando Excel...", "processing");
  try {
    const res = await fetch("/api/generar-excel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { activo: a, componentes: comps, observaciones: obs } }),
    });

    if (!res.ok) {
      const er = await res.json();
      showBanner(er.error || "Error", "error");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const dl = document.createElement("a");
    dl.href = url;
    dl.download = `lubia_${a || "ruta"}_${Date.now()}.xlsx`;
    dl.click();
    URL.revokeObjectURL(url);
    showBanner("✅ Excel descargado", "success");
  } catch (err) {
    showBanner("Error generando Excel: " + err.message, "error");
  }
}
