import { esc, toggleModal } from "./api.js";
import { currentProject, projects } from "./projects.js";

export async function loadTemplates() {
  if (!currentProject) return;
  const el = document.getElementById("template-list");
  if (!el) return;

  try {
    const r = await fetch(`/api/projects/${currentProject.id}/templates`);
    const data = await r.json();

    if (!data || data.length === 0) {
      el.innerHTML = '<p style="font-size:12px;color:#9CA3AF;text-align:center;padding:10px 0">Sin plantillas</p>';
    } else {
      el.innerHTML = data
        .map(
          (t) => `
        <div class="tree-item" style="font-size:12px;padding:4px 8px">
          <span class="icon">📄</span>
          <span class="name" style="font-size:12px">${esc(t.name)}</span>
          <button class="btn btn-xs btn-outline" onclick="event.stopPropagation();window.LuBIA.editTemplate('${t.id}','${esc(t.name)}','${esc(t.description || "")}','${esc((t.columns || []).join("\n"))}')" title="Editar">✎</button>
          <button class="btn btn-xs btn-red" onclick="event.stopPropagation();window.LuBIA.delTemplate('${t.id}')">✕</button>
        </div>`
        )
        .join("");
    }
  } catch (err) {
    el.innerHTML = '<p style="font-size:12px;color:#EF4444;text-align:center">Error cargando plantillas</p>';
  }
}

export function showTemplateModal(id) {
  document.getElementById("tpl-id").value = id || "";
  document.getElementById("tpl-name").value = "";
  document.getElementById("tpl-desc").value = "";
  document.getElementById("tpl-columns").value = "";
  document.getElementById("tpl-file").value = "";
  document.getElementById("template-modal-title").textContent = id ? "Editar Plantilla" : "📋 Nueva Plantilla";
  toggleModal("modal-template");
}

export function editTemplate(id, name, desc, cols) {
  document.getElementById("tpl-id").value = id;
  document.getElementById("tpl-name").value = name;
  document.getElementById("tpl-desc").value = desc || "";
  document.getElementById("tpl-columns").value = (cols || "").replace(/\\n/g, "\n");
  document.getElementById("template-modal-title").textContent = "Editar Plantilla";
  toggleModal("modal-template");
}

export async function saveTemplate() {
  if (!currentProject) return alert("Selecciona un proyecto primero");
  const id = document.getElementById("tpl-id")?.value;
  const name = document.getElementById("tpl-name")?.value.trim();
  if (!name) return alert("Nombre de la plantilla requerido");

  const desc = document.getElementById("tpl-desc")?.value.trim() || "";
  const cols = (document.getElementById("tpl-columns")?.value || "")
    .split("\n")
    .map((c) => c.trim())
    .filter(Boolean);

  const url = id
    ? `/api/projects/${currentProject.id}/templates/${id}`
    : `/api/projects/${currentProject.id}/templates`;
  const method = id ? "PUT" : "POST";

  try {
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: desc, columns: cols }),
    });
    toggleModal("modal-template");
    loadTemplates();
  } catch (err) {
    alert("Error guardando plantilla: " + err.message);
  }
}

export async function delTemplate(id) {
  if (!confirm("¿Eliminar plantilla?")) return;
  await fetch(`/api/projects/${currentProject.id}/templates/${id}`, { method: "DELETE" });
  loadTemplates();
}

export async function uploadTemplateFile(file) {
  if (!file || !currentProject) return;
  const f = new FormData();
  f.append("file", file);

  try {
    const r = await fetch(`/api/projects/${currentProject.id}/templates/upload`, { method: "POST", body: f });
    const d = await r.json();
    if (d.columns && d.columns.length) {
      document.getElementById("tpl-columns").value = d.columns.join("\n");
      const nameInput = document.getElementById("tpl-name");
      if (nameInput && !nameInput.value) {
        nameInput.value = d.name;
      }
    }
  } catch (e) {
    alert("Error leyendo archivo: " + e.message);
  }
}

export async function showImportModal() {
  const sel = document.getElementById("import-project");
  if (!sel) return;
  sel.innerHTML = '<option value="">Cargando...</option>';

  const projs = projects || [];
  sel.innerHTML =
    '<option value="">Seleccionar proyecto...</option>' +
    projs
      .filter((p) => p.id !== currentProject?.id)
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join("");

  toggleModal("modal-import");
}

export async function loadImportTemplates() {
  const pid = document.getElementById("import-project")?.value;
  const sel = document.getElementById("import-template");
  if (!sel) return;

  if (!pid) {
    sel.innerHTML = '<option value="">Primero selecciona un proyecto</option>';
    return;
  }
  sel.innerHTML = '<option value="">Cargando...</option>';

  try {
    const r = await fetch(`/api/projects/${pid}/templates`);
    const data = await r.json();
    sel.innerHTML =
      '<option value="">Seleccionar plantilla...</option>' +
      data.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  } catch {
    sel.innerHTML = '<option value="">Error cargando plantillas</option>';
  }
}

export async function importTemplate() {
  const pid = document.getElementById("import-project")?.value;
  const tid = document.getElementById("import-template")?.value;
  if (!pid || !tid) return alert("Selecciona proyecto y plantilla");

  try {
    await fetch(`/api/projects/${currentProject.id}/templates/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceProjectId: pid, sourceTemplateId: tid }),
    });
    toggleModal("modal-import");
    loadTemplates();
  } catch (err) {
    alert("Error importando plantilla: " + err.message);
  }
}
