import { esc } from "./api.js";

export async function browseCorreos(path = "") {
  const tree = document.getElementById("correos-tree");
  const searchInput = document.getElementById("correos-search");
  const search = searchInput ? searchInput.value : "";
  const sp = document.getElementById("correos-path");
  if (!tree) return;

  try {
    const r = await fetch(`/api/correos/browse?path=${encodeURIComponent(path)}&search=${encodeURIComponent(search)}`);
    const d = await r.json();
    if (d.error) {
      tree.innerHTML = `<p style="padding:20px;color:#EF4444">${esc(d.error)}</p>`;
      return;
    }

    if (sp) sp.textContent = d.path || "/";

    let h = "";
    if (path) {
      const parent = path.split("/").slice(0, -1).join("/");
      h += `
      <div class="tree-item" onclick="window.LuBIA.browseCorreos('${parent}')">
        <span class="icon">📁</span>
        <span class="name">.. (subir nivel)</span>
      </div>`;
    }

    for (const f of d.folders || []) {
      h += `
      <div class="tree-item" onclick="window.LuBIA.browseCorreos('${f.path}')">
        <span class="icon">📂</span>
        <span class="name">${esc(f.name)}</span>
        <span class="meta">${f.count} 📧</span>
      </div>`;
    }

    for (const f of d.files || []) {
      const filePath = f.path ? `${f.path}/${f.name}` : f.name;
      h += `
      <div class="tree-item" onclick="window.LuBIA.previewCorreo('${encodeURIComponent(filePath)}')">
        <span class="icon">📧</span>
        <span class="name">${esc(f.asunto || f.name)}</span>
        <span class="meta">${f.fecha} · ${f.sizeKB} KB</span>
      </div>`;
    }

    tree.innerHTML = h || '<p style="padding:20px;color:#9CA3AF;text-align:center">Carpeta vacía</p>';
  } catch (e) {
    tree.innerHTML = `<p style="padding:20px;color:#EF4444">Error: ${esc(e.message)}</p>`;
  }
}

export async function previewCorreo(file) {
  const el = document.getElementById("correos-preview");
  if (!el) return;
  el.innerHTML = '<p style="color:#6B7280;text-align:center;padding:40px 0"><span class="spinner"></span> Cargando correo...</p>';

  try {
    const r = await fetch(`/api/correos/read?file=${encodeURIComponent(file)}`);
    const d = await r.json();
    if (d.error) {
      el.innerHTML = `<p style="color:#EF4444">${esc(d.error)}</p>`;
      return;
    }

    el.innerHTML = `
      <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #E5E7EB">
        <div class="correos-meta"><strong>De:</strong> ${esc(d.from)}</div>
        <div class="correos-meta"><strong>Para:</strong> ${esc(d.to)}</div>
        <div class="correos-meta"><strong>Asunto:</strong> ${esc(d.subject)}</div>
        <div class="correos-meta"><strong>Fecha:</strong> ${esc(d.date)}</div>
      </div>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.6;color:#374151">${esc(d.body)}</div>`;
  } catch (e) {
    el.innerHTML = `<p style="color:#EF4444">Error: ${esc(e.message)}</p>`;
  }
}

export async function archivarCorreos() {
  const btn = document.getElementById("btn-archivar");
  const el = document.getElementById("correos-result");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Archivando...";
  }
  if (el) {
    el.className = "banner processing";
    el.innerHTML = '<span class="spinner"></span> Conectando con servidor IMAP...';
  }

  try {
    const r = await fetch("/api/correos/archivar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imapHost: document.getElementById("imap-host")?.value.trim(),
        imapUser: document.getElementById("imap-user")?.value.trim(),
        imapPass: document.getElementById("imap-pass")?.value,
        antiguedad: parseInt(document.getElementById("imap-antiguedad")?.value) || 12,
        borrarDespues: document.getElementById("imap-borrar")?.checked || false,
      }),
    });
    const d = await r.json();

    if (d.error) {
      if (el) {
        el.className = "banner error";
        el.innerHTML = esc(d.error);
      }
    } else {
      if (el) {
        el.className = "banner success";
        el.innerHTML = `✅ ${d.totalArchivados} correos archivados (${d.espacioEstimadoMB} MB)`;
      }
      setTimeout(() => browseCorreos(), 1200);
    }
  } catch (e) {
    if (el) {
      el.className = "banner error";
      el.innerHTML = "Error: " + esc(e.message);
    }
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "📥 Ejecutar Archivo";
  }
}
