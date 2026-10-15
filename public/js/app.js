import { esc, toggleModal, showBanner, hideBanner } from "./api.js";
import {
  projects,
  currentProject,
  currentSedeId,
  currentSedeName,
  loadProjects,
  renderHome,
  renderWsProjects,
  crearProyecto,
  openProject,
  goHome,
  loadSedes,
  newSede,
  selectSede,
} from "./projects.js";
import {
  loadProjectFiles,
  selectFile,
  selectFolder,
  toggleFolderFiles,
  newFolderInSede,
  delFolder,
  delProjectFile,
  renameFile,
  uploadMultiple,
  updateBulkBar,
  toggleSelectAll,
  clearSelection,
  bulkDelete,
  dragFile,
  dragEnd,
  dragOver,
  dragLeave,
  dropOnFolder,
  initPreviewClearing,
} from "./files.js";
import {
  transcribeProjectFile,
  extraerDatos,
  addComponentRow,
  generarExcel,
} from "./ai-extract.js";
import {
  loadChat,
  renderChat,
  sendChat,
  handleChatKey,
  handleAtInput,
  showAtPicker,
  hideAtPicker,
  navigateAtPicker,
  selectAtFile,
  addChatAttachment,
  removeAttachment,
  toggleChat,
} from "./chat.js";
import {
  loadTemplates,
  showTemplateModal,
  editTemplate,
  saveTemplate,
  delTemplate,
  uploadTemplateFile,
  showImportModal,
  loadImportTemplates,
  importTemplate,
} from "./templates.js";
import {
  browseCorreos,
  previewCorreo,
  archivarCorreos,
} from "./correos.js";
import * as MU from "./muestras.js";

// ── Objeto global LuBIA para compatibilidad completa con HTML ─────
window.LuBIA = {
  openTemplates, closeTemplates,
  muLoad: MU.muLoad, muRender: MU.muRender, muFiltroEstado: MU.muFiltroEstado, muSelect: MU.muSelect,
  muAsignar: MU.muAsignar, muAvanzar: MU.muAvanzar, muVincular: MU.muVincular, muAnular: MU.muAnular,
  muLote: MU.muLote, muReiniciar: MU.muReiniciar,
  // Proyectos y sedes
  loadProjects,
  renderHome,
  renderWsProjects,
  crearProyecto,
  openProject,
  goHome,
  loadSedes,
  newSede,
  selectSede,

  // Archivos y carpetas
  loadProjectFiles,
  selectFile,
  selectFolder,
  toggleFolderFiles,
  newFolderInSede,
  delFolder,
  delProjectFile,
  renameFile,
  uploadMultiple,
  updateBulkBar,
  toggleSelectAll,
  clearSelection,
  bulkDelete,
  dragFile,
  dragEnd,
  dragOver,
  dragLeave,
  dropOnFolder,

  // IA y Excel
  transcribeProjectFile,
  extraerDatos,
  addComponentRow,
  generarExcel,

  // Chat
  loadChat,
  renderChat,
  sendChat,
  handleChatKey,
  handleAtInput,
  showAtPicker,
  hideAtPicker,
  navigateAtPicker,
  selectAtFile,
  addChatAttachment,
  removeAttachment,
  toggleChat,

  // Plantillas
  loadTemplates,
  showTemplateModal,
  editTemplate,
  saveTemplate,
  delTemplate,
  uploadTemplateFile,
  showImportModal,
  loadImportTemplates,
  importTemplate,

  // Correos
  browseCorreos,
  previewCorreo,
  archivarCorreos,

  // Layout y navegación
  showSection,
  railNav,
  railActive,
  setLayout,
  renderCrumbs,
  toggleModal,
  loadSettings,
  saveSettings,
};

// Aliases para llamadas globales comunes en HTML existente
window.toggleModal = toggleModal;
window.crearProyecto = crearProyecto;
window.openProject = openProject;
window.goHome = goHome;
window.newSede = newSede;
window.selectSede = selectSede;
window.newFolderInSede = newFolderInSede;
window.uploadMultiple = uploadMultiple;
window.delProjectFile = delProjectFile;
window.renameFile = renameFile;
window.delFolder = delFolder;
window.toggleFolderFiles = toggleFolderFiles;
window.selectFolder = selectFolder;
window.selectFile = selectFile;
window.transcribeProjectFile = transcribeProjectFile;
window.extraerDatos = extraerDatos;
window.addComponentRow = addComponentRow;
window.generarExcel = generarExcel;
window.toggleChat = toggleChat;
window.sendChat = sendChat;
window.handleChatKey = handleChatKey;
window.handleAtInput = handleAtInput;
window.showTemplateModal = showTemplateModal;
window.editTemplate = editTemplate;
window.saveTemplate = saveTemplate;
window.delTemplate = delTemplate;
window.uploadTemplateFile = uploadTemplateFile;
window.showImportModal = showImportModal;
window.loadImportTemplates = loadImportTemplates;
window.importTemplate = importTemplate;
window.browseCorreos = browseCorreos;
window.previewCorreo = previewCorreo;
window.archivarCorreos = archivarCorreos;
window.saveSettings = saveSettings;
window.clearSelection = clearSelection;
window.toggleSelectAll = toggleSelectAll;
window.updateBulkBar = updateBulkBar;
window.bulkDelete = bulkDelete;
window.dragFile = dragFile;
window.dragEnd = dragEnd;
window.dragOver = dragOver;
window.dragLeave = dragLeave;
window.dropOnFolder = dropOnFolder;
window.removeAttachment = removeAttachment;
window.setLayout = setLayout;
window.railNav = railNav;

const LAST_PROJ = "lubia_last_project";

export function showSection(section) {
  document.querySelectorAll(".nav-link").forEach((l) =>
    l.classList.toggle("active", l.dataset.nav === section)
  );
  const vp = document.getElementById("view-proyectos");
  const vc = document.getElementById("view-correos");
  if (vp) vp.style.display = section === "proyectos" ? "block" : "none";
  if (vc) vc.style.display = section === "correos" ? "block" : "none";
  const vm = document.getElementById("view-muestras");
  if (vm) vm.style.display = section === "muestras" ? "block" : "none";
  if (section === "correos") browseCorreos();
  if (section === "muestras") MU.muLoad();
}

export function railActive(nav) {
  document.querySelectorAll(".rail .nav-link").forEach((l) =>
    l.classList.toggle("active", l.dataset.nav === nav)
  );
}

export function showProjectShell() {
  document.getElementById("view-home").style.display = "none";
  document.getElementById("view-project").style.display = "flex";
}

export function setLayout(v) {
  document.body.classList.toggle("lay-stack", v === "stack");
  const colsBtn = document.getElementById("lay-cols");
  const stackBtn = document.getElementById("lay-stack");
  if (colsBtn) colsBtn.classList.toggle("on", v !== "stack");
  if (stackBtn) stackBtn.classList.toggle("on", v === "stack");
  try {
    localStorage.setItem("lubia_layout", v);
  } catch {}
}

export function renderCrumbs() {
  const inProj = !!currentProject && document.getElementById("view-project")?.style.display !== "none";
  document.body.classList.toggle("in-project", inProj);
  const el = document.getElementById("crumb-sede");
  if (!el) return;

  if (inProj && currentSedeId && currentSedeName) {
    el.innerHTML = `
      <span class="ms sep">chevron_right</span>
      <span class="crumb-chip" onclick="window.LuBIA.selectSede('${currentSedeId}','${esc(currentSedeName)}')" title="Quitar la sede seleccionada">
        ${esc(currentSedeName)}<span class="ms">close</span>
      </span>`;
  } else {
    el.innerHTML = "";
  }
}

let navBeforeDrawer = "proyectos";
export function openTemplates() {
  const active = document.querySelector(".rail .nav-link.active")?.dataset.nav;
  if (active && active !== "plantillas") navBeforeDrawer = active;
  document.body.classList.add("tpl-open");
  railActive("plantillas");
  loadTemplates();
}
export function closeTemplates() {
  document.body.classList.remove("tpl-open");
  railActive(navBeforeDrawer);
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("tpl-open")) closeTemplates();
});
initPreviewClearing();

export function railNav(nav) {
  if (nav === "plantillas") {
    document.body.classList.contains("tpl-open") ? closeTemplates() : openTemplates();
    return;
  }
  if (document.body.classList.contains("tpl-open")) document.body.classList.remove("tpl-open");
  if (nav === "muestras") {
    showSection("muestras");
    railActive("muestras");
    return;
  }
  if (nav === "correos") {
    showSection("correos");
    railActive("correos");
    return;
  }
  if (nav === "proyectos") {
    showSection("proyectos");
    goHome();
    railActive("proyectos");
    return;
  }

  showSection("proyectos");
  railActive(nav);

  if (!currentProject) {
    const last = localStorage.getItem(LAST_PROJ);
    const p = (projects || []).find((x) => x.id === last) || ((projects || []).length === 1 ? projects[0] : null);
    if (p) {
      openProject(p.id);
    } else {
      showProjectShell();
      renderWsProjects();
    }
  }


  renderCrumbs();
}

// ── Settings ───────────────────────────────
export async function loadSettings() {
  try {
    const r = await fetch("/api/settings");
    const s = await r.json();
    const input = document.getElementById("set-ruta-correos");
    if (input) input.value = s.RUTA_CORREOS || "";
  } catch {}
}

export async function saveSettings() {
  const input = document.getElementById("set-ruta-correos");
  const d = { RUTA_CORREOS: input ? input.value.trim() : "" };

  try {
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    const j = await r.json();
    const m = document.getElementById("settings-msg");
    if (m) {
      if (j.ok) {
        m.textContent = "✅ Guardado";
        m.style.color = "#22C55E";
      } else {
        m.textContent = "❌ Error";
        m.style.color = "#EF4444";
      }
      setTimeout(() => {
        m.textContent = "";
      }, 3000);
    }
  } catch {
    const m = document.getElementById("settings-msg");
    if (m) {
      m.textContent = "❌ Error de conexión";
      m.style.color = "#EF4444";
    }
  }
}

// ── Iconos con Material Symbols ────────────
const ICONS = {
  "🏭": ["factory", "#A16207", 0],
  "📂": ["folder", "#EAB308", 1],
  "📁": ["folder", "#EAB308", 1],
  "📄": ["picture_as_pdf", "#DC2626", 0],
  "📊": ["table_chart", "#16A34A", 0],
  "📝": ["description", "#2563EB", 0],
  "🎵": ["graphic_eq", "#A16207", 0],
  "🖼️": ["image", "#6B7280", 0],
  "🖼": ["image", "#6B7280", 0],
  "🎬": ["movie", "#6B7280", 0],
  "📎": ["draft", "#6B7280", 0],
  "📧": ["mail", "#6B7280", 0],
  "▼": ["expand_more", "#9CA3AF", 0],
  "▶": ["chevron_right", "#9CA3AF", 0],
};

export function iconize(root) {
  (root || document).querySelectorAll(".tree-item .icon").forEach((s) => {
    const m = ICONS[s.textContent.trim()];
    if (!m) return;
    s.style.fontFamily = "'Material Symbols Outlined'";
    s.style.fontSize = "19px";
    s.style.lineHeight = "1";
    s.style.color = m[1];
    s.style.fontVariationSettings = "'wght' 300,'FILL' " + m[2];
    s.textContent = m[0];
  });
}

// ── Listeners e inicialización ─────────────
document.addEventListener("DOMContentLoaded", () => {
  setLayout(localStorage.getItem("lubia_layout") || "cols");

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSelection();
      hideAtPicker();
    }
  });

  document.addEventListener("click", (e) => {
    const c = e.target.closest(".proj-chip");
    if (c && c.dataset.pid) {
      openProject(c.dataset.pid);
    }
  });

  const atPicker = document.getElementById("at-picker");
  if (atPicker) {
    atPicker.addEventListener("click", (e) => {
      const it = e.target.closest(".at-item");
      if (!it) return;
      const idx = parseInt(it.dataset.idx, 10);
      selectAtFile(idx);
    });
  }

  ["#file-table", "#sede-list", "#template-list", "#correos-tree"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    new MutationObserver(() => iconize(el)).observe(el, { childList: true, subtree: true });
  });

  iconize();
  loadProjects();
  loadSettings();
  renderCrumbs();
});
