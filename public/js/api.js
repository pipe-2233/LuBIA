// ── Utilidades globales y llamadas API ──────────────────

export function esc(s) {
  if (s === null || s === undefined) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

export function showBanner(m, t) {
  const b = document.getElementById("banner");
  if (!b) return;
  b.className = `banner ${t}`;
  b.innerHTML = (t === "processing" ? '<span class="spinner"></span>' : "") + m;
}

export function hideBanner() {
  const b = document.getElementById("banner");
  if (!b) return;
  b.className = "banner";
  b.innerHTML = "";
}

export function toggleModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("active");
}

export async function apiRequest(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  }
  if (!res.ok) {
    const errorMsg = data?.error || `Error ${res.status}: ${res.statusText}`;
    throw new Error(errorMsg);
  }
  return data;
}
