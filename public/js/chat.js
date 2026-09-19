import { esc } from "./api.js";
import { currentProject, currentSedeId } from "./projects.js";

export let chatMessages = [];
export let chatAttachments = [];
export let atPickerFiles = [];
let atSelIdx = 0;

export function chatKey() {
  if (!currentProject) return "chat_global";
  return currentSedeId ? `chat_${currentProject.id}_${currentSedeId}` : `chat_${currentProject.id}`;
}

export function loadChat() {
  try {
    chatMessages = JSON.parse(localStorage.getItem(chatKey()) || "[]");
  } catch {
    chatMessages = [];
  }
  chatAttachments = [];
  renderChat();
  const attachEl = document.getElementById("chat-attach");
  if (attachEl) attachEl.innerHTML = "";
}

export function renderChat() {
  const el = document.getElementById("chat-msgs");
  if (!el) return;

  if (chatMessages.length === 0) {
    el.innerHTML =
      '<div class="chat-msg assistant">🤖 Hola, soy LUBIA. Pregúntame sobre este proyecto. Escribe <b>@</b> para citar un archivo.</div>';
    return;
  }

  el.innerHTML = chatMessages
    .map((m) => {
      let at = "";
      if (m.attachments?.length) {
        at = '<div class="attach">';
        for (const a of m.attachments) {
          at += `📎 ${esc(a.name)} `;
        }
        at += "</div>";
      }
      return `<div class="chat-msg ${m.role}">${m.role === "assistant" && m.content.includes("spinner") ? m.content : esc(m.content)}${at}</div>`;
    })
    .join("");

  el.scrollTop = el.scrollHeight;
}

export function saveChat() {
  try {
    localStorage.setItem(chatKey(), JSON.stringify(chatMessages));
  } catch {}
}

export function toggleChat() {
  const p = document.getElementById("chat-panel");
  if (!p) return;
  p.style.display = p.style.display === "flex" ? "none" : "flex";
  if (p.style.display === "flex") {
    loadChat();
    document.getElementById("chat-input")?.focus();
  }
}

export function handleChatKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    sendChat();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    navigateAtPicker(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Escape") {
    hideAtPicker();
  }
}

export function handleAtInput() {
  const inp = document.getElementById("chat-input");
  if (!inp) return;
  const val = inp.value;
  const pos = inp.selectionStart;
  const lastAt = val.lastIndexOf("@", pos - 1);
  if (lastAt >= 0 && (lastAt === 0 || val[lastAt - 1] === " " || val[lastAt - 1] === "\n")) {
    const q = val.slice(lastAt + 1, pos).toLowerCase();
    showAtPicker(q);
  } else {
    hideAtPicker();
  }
}

export async function showAtPicker(q) {
  if (!currentProject) return;
  try {
    const r = await fetch(`/api/projects/${currentProject.id}/files`);
    const d = await r.json();
    const allFiles = [];

    function addFiles(files, path) {
      for (const f of files) allFiles.push({ ...f, path: path + f.name });
    }
    function walk(folders, files, path, parentId) {
      const subs = folders.filter((x) => x.parent_id === parentId || x.parentId === parentId);
      for (const f of subs) {
        const fp = path + f.name + "/";
        addFiles(files.filter((x) => (x.folder_id || x.folderId) === f.id), fp);
        walk(folders, files, fp, f.id);
      }
    }

    addFiles(d.files.filter((x) => !x.folder_id && !x.folderId), "/");
    walk(d.folders || [], d.files || [], "/", null);

    atPickerFiles = q ? allFiles.filter((x) => x.name.toLowerCase().includes(q)) : allFiles;
    const el = document.getElementById("at-picker");
    if (!el) return;

    if (atPickerFiles.length === 0) {
      el.style.display = "none";
      return;
    }

    atSelIdx = 0;
    el.innerHTML = atPickerFiles
      .map(
        (f, i) => `
      <div class="at-item${i === 0 ? " sel" : ""}" data-idx="${i}">
        📄 ${esc(f.name)}
        <span style="color:#9CA3AF;margin-left:auto;font-size:11px">${esc(f.path)}</span>
      </div>`
      )
      .join("");
    el.style.display = "block";
  } catch (err) {
    console.error("Picker error:", err);
    hideAtPicker();
  }
}

export function hideAtPicker() {
  const el = document.getElementById("at-picker");
  if (el) el.style.display = "none";
}

export function navigateAtPicker(dir) {
  const el = document.getElementById("at-picker");
  if (!el || el.style.display === "none") return;
  const items = el.querySelectorAll(".at-item");
  items.forEach((i) => i.classList.remove("sel"));
  atSelIdx = Math.max(0, Math.min(items.length - 1, atSelIdx + dir));
  const s = items[atSelIdx];
  if (s) {
    s.classList.add("sel");
    s.scrollIntoView({ block: "nearest" });
  }
}

export function selectAtFile(idx) {
  const f = atPickerFiles[idx];
  if (!f) return;
  addChatAttachment(f);
  const inp = document.getElementById("chat-input");
  if (!inp) return;
  const val = inp.value;
  const pos = inp.selectionStart;
  const lastAt = val.lastIndexOf("@", pos - 1);
  if (lastAt >= 0) {
    inp.value = val.slice(0, lastAt) + val.slice(pos);
  }
  hideAtPicker();
  inp.focus();
}

export function addChatAttachment(f) {
  if (chatAttachments.find((x) => x.id === f.id)) return;
  chatAttachments.push(f);
  renderChatAttachments();
}

export function removeAttachment(id) {
  chatAttachments = chatAttachments.filter((x) => x.id !== id);
  renderChatAttachments();
}

function renderChatAttachments() {
  const el = document.getElementById("chat-attach");
  if (!el) return;
  el.innerHTML = chatAttachments
    .map(
      (a) => `
    <span class="chat-chip">📎 ${esc(a.name)} <span class="remove" onclick="window.LuBIA.removeAttachment('${a.id}')">×</span></span>`
    )
    .join("");
}

export function sendChat() {
  const inp = document.getElementById("chat-input");
  if (!inp) return;
  const txt = inp.value.trim();
  if (!txt && chatAttachments.length === 0) return;

  const msg = { role: "user", content: txt, attachments: [...chatAttachments] };
  chatMessages.push(msg);
  inp.value = "";
  chatAttachments = [];
  renderChatAttachments();
  renderChat();
  saveChat();
  fetchChatResponse(txt);
}

export async function fetchChatResponse(userMsg) {
  const loading = { role: "assistant", content: '<span class="spinner"></span> Pensando...' };
  chatMessages.push(loading);
  renderChat();
  saveChat();

  try {
    let ctx = "";
    if (currentProject) {
      try {
        const r = await fetch(`/api/projects/${currentProject.id}/files`);
        const d = await r.json();
        const allFiles = [...(d.files || [])];
        const names = allFiles.map((f) => f.name).join(", ");
        if (names) ctx = `Archivos del proyecto: ${names}. `;
      } catch {}
    }

    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMsg, projectId: currentProject?.id, context: ctx }),
    });
    const d = await r.json();
    chatMessages.pop();

    if (d.error) {
      chatMessages.push({ role: "assistant", content: "❌ " + d.error });
    } else {
      chatMessages.push({ role: "assistant", content: d.reply || "(sin respuesta)" });
    }
  } catch (e) {
    chatMessages.pop();
    chatMessages.push({ role: "assistant", content: "❌ Error: " + e.message });
  }

  renderChat();
  saveChat();
}
