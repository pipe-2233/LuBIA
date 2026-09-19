import { esc, toggleModal } from "./api.js";
import { loadProjectFiles, resetSelectedFile } from "./files.js";
import { loadChat } from "./chat.js";
import { loadTemplates } from "./templates.js";
import { renderCrumbs, railActive } from "./app.js";

export let projects = [];
export let currentProject = null;
export let currentSedeId = null;
export let currentSedeName = "";

export function setCurrentSede(id, name) {
  currentSedeId = id;
  currentSedeName = name;
}

export async function loadProjects() {
  try {
    const r = await fetch("/api/projects");
    projects = await r.json();
    renderHome();
    renderWsProjects();
  } catch (err) {
    console.error("[Projects] Error cargando:", err);
  }
}

export function renderHome() {
  const g = document.getElementById("project-grid");
  const e = document.getElementById("empty-state");
  if (!g || !e) return;

  if (projects.length === 0) {
    g.innerHTML = "";
    e.style.display = "block";
  } else {
    e.style.display = "none";
    g.innerHTML = projects
      .map(
        (p) => `
      <div class="card" onclick="window.LuBIA.openProject('${p.id}')">
        <div class="card-icon">🏭</div>
        <h3>${esc(p.name)}</h3>
        <div class="card-meta">Creado ${new Date(p.created_at || p.createdAt || Date.now()).toLocaleDateString("es-CO")}</div>
        <div class="card-footer"><span class="card-link">Entrar →</span></div>
      </div>`
      )
      .join("");
  }
}

export function renderWsProjects() {
  const el = document.getElementById("ws-project-list");
  if (!el) return;
  if (!projects || !projects.length) {
    el.innerHTML = '<div class="proj-empty">Sin proyectos todavía.</div>';
    return;
  }
  el.innerHTML = projects
    .map(
      (p) => `
    <span class="proj-chip${currentProject && currentProject.id === p.id ? " on" : ""}" data-pid="${p.id}">
      <span class="ms">factory</span>${esc(p.name)}
    </span>`
    )
    .join("");
}

export async function crearProyecto() {
  const input = document.getElementById("new-project-name");
  const n = input?.value.trim();
  if (!n) return alert("Ingresa un nombre para el proyecto");

  try {
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    const p = await r.json();
    if (p.error) throw new Error(p.error);

    projects.unshift(p);
    renderHome();
    renderWsProjects();
    input.value = "";
    toggleModal("modal-proyecto");
  } catch (e) {
    alert("Error creando proyecto: " + e.message);
  }
}

export function openProject(id) {
  currentProject = projects.find((p) => p.id === id);
  if (!currentProject) return;

  try {
    localStorage.setItem("lubia_last_project", currentProject.id);
  } catch {}

  document.getElementById("view-home").style.display = "none";
  document.getElementById("view-project").style.display = "flex";
  document.getElementById("project-title").textContent = currentProject.name;

  currentSedeId = null;
  currentSedeName = "";
  resetSelectedFile();

  loadSedes();
  loadChat();
  loadTemplates();
  renderWsProjects();
  renderCrumbs();
  railActive("archivos");
}

export function goHome() {
  currentProject = null;
  currentSedeId = null;
  currentSedeName = "";
  document.getElementById("view-home").style.display = "block";
  document.getElementById("view-project").style.display = "none";
  loadProjects();
  renderCrumbs();
  railActive("proyectos");
}

// ── Sedes ───────────────────────────────────
export async function loadSedes() {
  if (!currentProject) return;
  const el = document.getElementById("sede-list");
  try {
    const r = await fetch(`/api/projects/${currentProject.id}/sedes`);
    const sedes = await r.json();
    if (sedes.length === 0) {
      el.innerHTML = '<p style="font-size:12px;color:#9CA3AF;text-align:center;padding:20px 0">Sin sedes. Crea una.</p>';
    } else {
      el.innerHTML = sedes
        .map(
          (s) => `
        <div class="tree-item${currentSedeId === s.id ? " selected" : ""}" onclick="window.LuBIA.selectSede('${s.id}','${esc(s.name)}')">
          <span class="icon">🏭</span><span class="name">${esc(s.name)}</span>
        </div>`
        )
        .join("");
    }
  } catch (err) {
    el.innerHTML = `<p style="font-size:12px;color:#EF4444;text-align:center">Error cargando sedes</p>`;
  }

  const btnFolder = document.getElementById("btn-folder");
  if (btnFolder) btnFolder.disabled = !currentSedeId;
}

export async function newSede() {
  if (!currentProject) return alert("Selecciona un proyecto primero");
  const n = prompt("Nombre de la sede:");
  if (!n) return;
  await fetch(`/api/projects/${currentProject.id}/sedes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: n }),
  });
  loadSedes();
}

export async function selectSede(id, name) {
  if (currentSedeId === id) {
    currentSedeId = null;
    currentSedeName = "";
    document.getElementById("btn-folder").disabled = true;
    document.getElementById("file-table").innerHTML =
      '<p style="padding:30px;color:#9CA3AF;text-align:center">Selecciona una sede para ver sus archivos</p>';
    loadSedes();
    renderCrumbs();
    if (document.getElementById("chat-panel")?.style.display === "flex") loadChat();
    return;
  }

  currentSedeId = id;
  currentSedeName = name;
  document.getElementById("btn-folder").disabled = false;
  loadSedes();
  loadProjectFiles();
  renderCrumbs();
  if (document.getElementById("chat-panel")?.style.display === "flex") loadChat();
}
