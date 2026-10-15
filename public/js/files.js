import { esc, showBanner, hideBanner } from "./api.js";
import { currentProject, currentSedeId } from "./projects.js";

export let selectedFileId = null;
export let currentFolderId = null;
let dragFileId = null;

export function resetSelectedFile() {
  selectedFileId = null;
  currentFolderId = null;
  const pc = document.getElementById("preview-content");
  const pt = document.getElementById("preview-transcribe");
  const ph = document.getElementById("file-preview")?.querySelector("p");
  // Vaciar el contenido detiene audio/iframes y evita que quede el archivo anterior
  if (pc) { pc.style.display = "none"; pc.innerHTML = ""; }
  if (pt) pt.style.display = "none";
  for (const id of ["transcript-box", "extract-section", "missing-alert"]) {
    const e = document.getElementById(id);
    if (e) e.style.display = "none";
  }
  const bn = document.getElementById("banner");
  if (bn) bn.className = "banner";
  if (ph) ph.style.display = "block";
  document.querySelectorAll("#file-table .tree-item.selected").forEach((e) => e.classList.remove("selected"));
}

// Clic en un espacio vacío de la tabla = deja de seleccionar el archivo
export function initPreviewClearing() {
  const el = document.getElementById("file-table");
  if (!el) return;
  el.addEventListener("click", (e) => {
    if (!e.target.closest(".tree-item")) resetSelectedFile();
  });
}

const MIME_ICONS = {
  audio: /audio|mp3|wav|webm|m4a|ogg/,
  image: /image/,
  pdf: /pdf/,
  word: /word|doc|docx/,
  excel: /excel|xls|xlsx/,
  video: /video|mp4|mov/,
};

export function getFileIcon(mime) {
  for (const [k, regex] of Object.entries(MIME_ICONS)) {
    if (regex.test(mime || "")) {
      return {
        audio: "🎵",
        image: "🖼️",
        pdf: "📄",
        word: "📝",
        excel: "📊",
        video: "🎬",
      }[k];
    }
  }
  return "📎";
}

export async function loadProjectFiles() {
  if (!currentProject || !currentSedeId) return;
  const el = document.getElementById("file-table");
  if (!el) return;

  try {
    const r = await fetch(`/api/projects/${currentProject.id}/files?sede_id=${currentSedeId}`);
    const d = await r.json();
    const folders = d.folders || [];
    const files = d.files || [];

    // Si el archivo previsualizado ya no está en la lista, limpiar la vista previa
    if (selectedFileId && !files.some((f) => f.id === selectedFileId)) resetSelectedFile();

    if (folders.length === 0 && files.length === 0) {
      el.innerHTML = '<p style="padding:30px;color:#9CA3AF;text-align:center">Sede vacía. Sube archivos o crea carpetas.</p>';
      return;
    }

    let h = "";
    // Archivos en la raíz de la sede
    const rootFiles = files.filter((f) => !f.folder_id);
    for (const f of rootFiles) {
      h += fileRow(f);
    }

    // Carpetas con sus archivos
    for (const fld of folders) {
      const subFiles = files.filter((f) => f.folder_id === fld.id);
      h += `
      <div class="tree-item folder-drop" style="background:#F9FAFB;font-weight:600;border-bottom:2px solid #E5E7EB;cursor:pointer" 
           ondragover="window.LuBIA.dragOver(event)" ondragleave="window.LuBIA.dragLeave(event)" ondrop="window.LuBIA.dropOnFolder(event,'${fld.id}')" onclick="window.LuBIA.toggleFolderFiles('f-${fld.id}')">
        <span class="icon" id="ico-f-${fld.id}">▼</span>
        <span class="icon">📂</span>
        <span class="name">${esc(fld.name)}</span>
        <span style="width:100px;font-size:12px;color:#6B7280">${new Date(fld.created_at).toLocaleDateString("es-CO")}</span>
        <span style="width:80px;font-size:12px;color:#6B7280">Carpeta</span>
        <span style="width:70px;font-size:12px;color:#6B7280">${subFiles.length} arch.</span>
        <button class="btn btn-xs btn-red" onclick="event.stopPropagation();window.LuBIA.delFolder('${fld.id}')">✕</button>
      </div>
      <div id="f-${fld.id}" class="folder-children">
        ${subFiles.map((f) => `<div style="padding-left:24px">${fileRow(f)}</div>`).join("")}
      </div>`;
    }

    el.innerHTML = h || '<p style="padding:30px;color:#9CA3AF;text-align:center">Carpeta vacía. Sube archivos.</p>';
    const selectAll = document.getElementById("select-all");
    if (selectAll) selectAll.checked = false;
    updateBulkBar();
  } catch (err) {
    console.error("[Files] Error:", err);
    el.innerHTML = `<p style="padding:30px;color:#EF4444;text-align:center">Error cargando archivos: ${esc(err.message)}</p>`;
  }
}

export function fileRow(f) {
  const d = new Date(f.created_at || Date.now());
  const dd = d.toLocaleDateString("es-CO");
  const kb = (f.size / 1024).toFixed(1);

  return `
  <div class="tree-item" draggable="true" ondragstart="window.LuBIA.dragFile(event,'${f.id}')" ondragend="window.LuBIA.dragEnd()" onclick="window.LuBIA.selectFile('${f.id}','${esc(f.name)}','${esc(f.mimetype || "")}','${kb}','${dd}')">
    <input type="checkbox" class="file-check" style="width:15px;height:15px;cursor:pointer;margin-right:12px" onclick="event.stopPropagation()" onchange="window.LuBIA.updateBulkBar()" data-id="${f.id}">
    <span class="icon">${getFileIcon(f.mimetype)}</span>
    <span class="name">${esc(f.name)}</span>
    <span style="width:100px;font-size:12px;color:#6B7280">${dd}</span>
    <span style="width:80px;font-size:12px;color:#6B7280">${(f.mimetype || "").split("/")[1] || "archivo"}</span>
    <span style="width:70px;font-size:12px;color:#6B7280">${kb} KB</span>
    <button class="btn btn-xs btn-outline" onclick="event.stopPropagation();window.LuBIA.renameFile('${f.id}','${esc(f.name)}')" title="Renombrar" style="margin-right:2px">✎</button>
    <button class="btn btn-xs btn-red" onclick="event.stopPropagation();window.LuBIA.delProjectFile('${f.id}')">✕</button>
  </div>`;
}

export function selectFile(id, name, mime, size, date) {
  // Segundo clic sobre el mismo archivo: deja de seleccionarlo
  if (selectedFileId === id) {
    resetSelectedFile();
    return;
  }
  selectedFileId = id;
  currentFolderId = null;
  document.querySelectorAll("#file-table .tree-item").forEach((e) => e.classList.remove("selected"));
  window.event?.currentTarget?.classList.add("selected");

  const pc = document.getElementById("preview-content");
  const pt = document.getElementById("preview-transcribe");
  const placeholder = document.getElementById("file-preview")?.querySelector("p");
  if (placeholder) placeholder.style.display = "none";

  const isAudio = /audio|mp3|wav|webm|m4a/.test(mime);
  const isExcel = /excel|xlsx|xls|spreadsheet/.test(mime);
  const isImage = /image/.test(mime);
  const isPDF = /pdf/.test(mime);
  const viewUrl = `/api/projects/${currentProject.id}/files/${id}/view`;

  if (isExcel) {
    pc.style.display = "block";
    pt.style.display = "none";
    pc.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <strong>${esc(name)}</strong><br>
          <span style="font-size:12px;color:#6B7280">${size} KB · ${date}</span>
        </div>
        <div style="display:flex;gap:4px">
          <a class="btn btn-primary btn-sm" href="/editor.html?id=${id}&project=${currentProject.id}" target="_blank">✏️ Editar</a>
          <a class="btn btn-outline btn-sm" href="${viewUrl}">⬇ Descargar</a>
        </div>
      </div>
      <p style="color:#6B7280;font-size:13px;text-align:center;padding:20px">📊 El editor se abre en una pestaña nueva con tabla editable, auto-guardado y soporte para <code>/img</code>.</p>`;
  } else {
    pc.style.display = "block";
    pt.style.display = "none";
    const banner = document.getElementById("banner");
    if (banner) banner.className = "banner";
    const tb = document.getElementById("transcript-box");
    if (tb) tb.style.display = "none";
    const es = document.getElementById("extract-section");
    if (es) es.style.display = "none";

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div>
          <strong>${esc(name)}</strong><br>
          <span style="font-size:12px;color:#6B7280">${size} KB · ${date}</span>
        </div>
        <div style="display:flex;gap:4px">`;

    if (isAudio) html += `<button class="btn btn-primary btn-sm" onclick="window.LuBIA.transcribeProjectFile()">⚡ Transcribir</button>`;
    if (isImage || isPDF) html += `<a class="btn btn-outline btn-sm" href="${viewUrl}" target="_blank">🔗 Abrir</a>`;
    html += `</div></div>`;

    if (isImage) {
      html += `<img src="${viewUrl}" style="max-width:100%;max-height:300px;border-radius:8px;border:1px solid #E5E7EB">`;
    } else if (isPDF) {
      html += `<iframe src="${viewUrl}" style="width:100%;height:350px;border:1px solid #E5E7EB;border-radius:8px"></iframe>`;
    } else if (isAudio) {
      html += `<audio controls src="${viewUrl}" style="width:100%;margin-top:8px"></audio>
               <p style="font-size:12px;color:#6B7280;margin-top:8px">Usa ⚡ Transcribir para extraer datos con IA</p>`;
    } else {
      html += `<p style="color:#6B7280;font-size:13px">Vista previa no disponible. <a href="${viewUrl}" target="_blank" style="color:#EAB308">Abrir archivo →</a></p>`;
    }

    pc.innerHTML = html;
    if (isAudio && pt) pt.style.display = "block";
  }
}

export function selectFolder(id) {
  currentFolderId = id;
  selectedFileId = null;
  document.querySelectorAll("#file-table .tree-item").forEach((e) => e.classList.remove("selected"));
  window.event?.currentTarget?.classList.add("selected");
  resetSelectedFile();
}

export function toggleFolderFiles(divId) {
  const el = document.getElementById(divId);
  if (!el) return;
  const isHidden = el.style.display === "none";
  el.style.display = isHidden ? "block" : "none";
  const ico = document.getElementById("ico-" + divId);
  if (ico) ico.textContent = isHidden ? "▼" : "▶";
}

export async function newFolderInSede() {
  if (!currentSedeId) return alert("Selecciona una sede primero");
  const n = prompt("Nombre de la carpeta:");
  if (!n) return;
  await fetch(`/api/projects/${currentProject.id}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: n, sedeId: currentSedeId }),
  });
  loadProjectFiles();
}

export async function delFolder(id) {
  if (!confirm("¿Eliminar carpeta y su contenido?")) return;
  await fetch(`/api/projects/${currentProject.id}/folders/${id}`, { method: "DELETE" });
  loadProjectFiles();
}

export async function delProjectFile(id) {
  if (!confirm("¿Eliminar archivo?")) return;
  await fetch(`/api/projects/${currentProject.id}/files/${id}`, { method: "DELETE" });
  loadProjectFiles();
  resetSelectedFile();
}

export async function renameFile(id, currentName) {
  const n = prompt("Nuevo nombre:", currentName);
  if (!n || n === currentName) return;
  await fetch(`/api/projects/${currentProject.id}/files/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: n }),
  });
  loadProjectFiles();
}

export async function uploadMultiple(fileList) {
  if (!fileList || fileList.length === 0 || !currentProject) return;
  if (!currentSedeId) return alert("Selecciona una sede primero");

  const el = document.getElementById("file-table");
  el.innerHTML = `<p style="padding:30px;color:#6B7280;text-align:center"><span class="spinner"></span> Subiendo ${fileList.length} archivo(s)...</p>`;

  const formData = new FormData();
  for (const file of fileList) {
    formData.append("files", file);
  }
  formData.append("sedeId", currentSedeId);
  if (currentFolderId) formData.append("folderId", currentFolderId);

  try {
    const r = await fetch(`/api/projects/${currentProject.id}/files`, {
      method: "POST",
      body: formData,
    });
    const d = await r.json();
    if (d.error) {
      alert("Error: " + d.error);
    }
  } catch (e) {
    alert("Error de conexión: " + e.message);
  }

  const uploadInput = document.getElementById("file-upload-proj");
  if (uploadInput) uploadInput.value = "";
  loadProjectFiles();
}

// ── Bulk operations ─────────────────────────
export function updateBulkBar() {
  const checks = document.querySelectorAll("#file-table .file-check:checked");
  const bar = document.getElementById("bulk-bar");
  const n = checks.length;
  if (!bar) return;

  if (n > 0) {
    bar.style.display = "flex";
    const countEl = document.getElementById("bulk-count");
    if (countEl) countEl.textContent = n + " seleccionado" + (n > 1 ? "s" : "");
  } else {
    bar.style.display = "none";
  }

  const allChecks = document.querySelectorAll("#file-table .file-check");
  const selectAll = document.getElementById("select-all");
  if (selectAll) {
    selectAll.checked = n > 0 && n === allChecks.length;
  }
}

export function toggleSelectAll(on) {
  document.querySelectorAll("#file-table .file-check").forEach((c) => (c.checked = on));
  updateBulkBar();
}

export function clearSelection() {
  document.querySelectorAll("#file-table .file-check").forEach((c) => (c.checked = false));
  const selectAll = document.getElementById("select-all");
  if (selectAll) selectAll.checked = false;
  updateBulkBar();
}

export async function bulkDelete() {
  const ids = [];
  document.querySelectorAll("#file-table .file-check:checked").forEach((c) => ids.push(c.dataset.id));
  if (!ids.length || !confirm("¿Eliminar " + ids.length + " archivos?")) return;

  for (const id of ids) {
    await fetch(`/api/projects/${currentProject.id}/files/${id}`, { method: "DELETE" });
  }
  clearSelection();
  loadProjectFiles();
  resetSelectedFile();
}

// ── Drag & Drop ─────────────────────────────
export function dragFile(e, fileId) {
  dragFileId = fileId;
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

export function dragEnd() {
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
}

export function dragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

export function dragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

export async function dropOnFolder(e, folderId) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  dragEnd();
  if (!dragFileId || !folderId) return;

  await fetch(`/api/projects/${currentProject.id}/files/${dragFileId}/move`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
  dragFileId = null;
  loadProjectFiles();
}
