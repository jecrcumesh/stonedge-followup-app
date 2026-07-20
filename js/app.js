/* app.js — wires everything together */

const state = {
  token: null,
  userName: null,
  customers: [],
  meta: { firms: [], statuses: [], periodLabel: "", lastUpdated: null, updatedBy: null },
  sha: null,
  dirty: false,
  fileExisted: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ---------------- Persistence of login (token/name only) ---------------- */
const STORAGE_KEY = "stonedge_followup_auth";

function saveAuth(token, name, remember) {
  const payload = JSON.stringify({ token, name });
  sessionStorage.setItem(STORAGE_KEY, payload);
  if (remember) localStorage.setItem(STORAGE_KEY, payload);
  else localStorage.removeItem(STORAGE_KEY);
}
function loadAuth() {
  const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function clearAuth() {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function showToast(msg, isError) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

/* ---------------- Login flow ---------------- */
async function attemptLogin(token, name, remember, silent) {
  const errEl = $("#login-error");
  errEl.hidden = true;
  const btn = $("#login-btn");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    await GitHubAPI.verifyAccess(token, APP_CONFIG.dataOwner, APP_CONFIG.dataRepo);
    const { data, sha } = await GitHubAPI.getJSON(
      token, APP_CONFIG.dataOwner, APP_CONFIG.dataRepo, APP_CONFIG.dataPath, APP_CONFIG.dataBranch
    );
    state.token = token;
    state.userName = name;
    state.sha = sha;
    state.fileExisted = !!data;
    if (data) {
      state.customers = data.customers || [];
      state.meta = { ...state.meta, ...data.meta };
    } else {
      state.customers = [];
      state.meta = {
        firms: ["Stonedge Private Limited", "Stonedge"],
        statuses: ["Pending Follow-up", "Payment Expected", "Partial Received", "No Response", "Disputed", "Settled"],
        periodLabel: "",
        lastUpdated: null,
        updatedBy: null,
      };
    }
    saveAuth(token, name, remember);
    showApp();
  } catch (e) {
    if (!silent) {
      errEl.textContent = e.message || "Couldn't connect. Check your token and try again.";
      errEl.hidden = false;
    }
    clearAuth();
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect";
  }
}

$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const token = $("#pat-input").value.trim();
  const name = $("#name-input").value.trim();
  const remember = $("#remember-input").checked;
  if (!token || !name) return;
  attemptLogin(token, name, remember, false);
});

function showApp() {
  $("#login-screen").hidden = true;
  $("#app-screen").hidden = false;
  populateFilterOptions();
  renderAll();
}

$("#logout-btn").addEventListener("click", () => {
  if (state.dirty && !confirm("You have unsaved changes that will be lost. Sign out anyway?")) return;
  clearAuth();
  Object.assign(state, { token: null, userName: null, customers: [], sha: null, dirty: false, fileExisted: false });
  $("#app-screen").hidden = true;
  $("#login-screen").hidden = false;
  $("#pat-input").value = "";
});

/* ---------------- Tabs ---------------- */
$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#${view}-view`).classList.add("active");
  });
});

/* ---------------- Dirty state ---------------- */
function markDirty() {
  state.dirty = true;
  $("#save-btn").disabled = false;
  $("#sync-status").textContent = "Unsaved changes";
  $("#sync-status").classList.add("dirty");
}
function clearDirty() {
  state.dirty = false;
  $("#save-btn").disabled = true;
  const when = state.meta.lastUpdated ? new Date(state.meta.lastUpdated).toLocaleString("en-IN") : "";
  $("#sync-status").textContent = when ? `Saved · ${when}` : "";
  $("#sync-status").classList.remove("dirty");
}
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------------- Rendering: Dashboard ---------------- */
function computeMetrics() {
  const rows = state.customers;
  const totalOutstanding = rows.reduce((s, c) => s + (Number(c.amountOutstanding) || 0), 0);
  const byFirm = {};
  state.meta.firms.forEach((f) => (byFirm[f] = 0));
  rows.forEach((c) => (byFirm[c.firm] = (byFirm[c.firm] || 0) + (Number(c.amountOutstanding) || 0)));
  const pending = rows.filter((c) => c.status === "Pending Follow-up").length;
  const settled = rows.filter((c) => c.status === "Settled").length;
  return { totalOutstanding, byFirm, totalCustomers: rows.length, pending, settled };
}

function fmtINR(n) {
  return "₹" + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function renderDashboard() {
  const m = computeMetrics();
  const grid = $("#metric-grid");
  grid.innerHTML = "";
  const cards = [
    { label: "Total Outstanding (both firms)", value: fmtINR(m.totalOutstanding), accent: true },
    ...state.meta.firms.map((f) => ({ label: `${f} — Outstanding`, value: fmtINR(m.byFirm[f]) })),
    { label: "Total Customers", value: m.totalCustomers },
    { label: "Pending Follow-up", value: m.pending },
    { label: "Settled", value: m.settled },
  ];
  cards.forEach((c) => {
    const div = document.createElement("div");
    div.className = "metric-card" + (c.accent ? " accent" : "");
    div.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    grid.appendChild(div);
  });

  const statusBody = $("#status-table tbody");
  statusBody.innerHTML = "";
  state.meta.statuses.forEach((s) => {
    const rows = state.customers.filter((c) => c.status === s);
    const amt = rows.reduce((sum, c) => sum + (Number(c.amountOutstanding) || 0), 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${s}</td><td class="num">${rows.length}</td><td class="num">${fmtINR(amt)}</td>`;
    statusBody.appendChild(tr);
  });

  const top5Body = $("#top5-table tbody");
  top5Body.innerHTML = "";
  [...state.customers]
    .sort((a, b) => (Number(b.amountOutstanding) || 0) - (Number(a.amountOutstanding) || 0))
    .slice(0, 5)
    .forEach((c, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(c.customerName || "")}</td><td>${escapeHtml(c.firm || "")}</td><td class="num">${fmtINR(c.amountOutstanding)}</td>`;
      top5Body.appendChild(tr);
    });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Rendering: Tracker table ---------------- */
function populateFilterOptions() {
  const firmSel = $("#firm-filter");
  const statusSel = $("#status-filter");
  firmSel.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
  statusSel.querySelectorAll("option:not(:first-child)").forEach((o) => o.remove());
  state.meta.firms.forEach((f) => firmSel.insertAdjacentHTML("beforeend", `<option>${escapeHtml(f)}</option>`));
  state.meta.statuses.forEach((s) => statusSel.insertAdjacentHTML("beforeend", `<option>${escapeHtml(s)}</option>`));
}

function getFilteredCustomers() {
  const q = $("#search-input").value.trim().toLowerCase();
  const firm = $("#firm-filter").value;
  const status = $("#status-filter").value;
  const priority = $("#priority-filter").value;
  const ageing = $("#ageing-filter").value;
  return state.customers.filter((c) => {
    if (firm && c.firm !== firm) return false;
    if (status && c.status !== status) return false;
    if (q && !`${c.customerName || ""} ${c.remark || ""}`.toLowerCase().includes(q)) return false;
    const derived = deriveFields(c);
    if (priority && derived.priority !== priority) return false;
    if (ageing && derived.ageingBucket !== ageing) return false;
    return true;
  });
}

function priorityBadgeClass(p) {
  return { Critical: "critical", High: "high", Medium: "medium", Low: "low" }[p] || "neutral";
}
function ageingBadgeClass(a) {
  if (a === "90+ Days") return "critical";
  if (a === "61-90 Days") return "high";
  if (a === "31-60 Days") return "medium";
  if (a === "0-30 Days") return "low";
  return "neutral";
}

function renderTracker() {
  const tbody = $("#tracker-tbody");
  tbody.innerHTML = "";
  const rows = getFilteredCustomers();
  $("#filter-count").textContent = `${rows.length} of ${state.customers.length} customers`;

  rows.forEach((c) => {
    const idx = state.customers.indexOf(c);
    const d = deriveFields(c);
    const tr = document.createElement("tr");
    tr.dataset.idx = idx;

    tr.innerHTML = `
      <td class="readonly">${c.srNo ?? ""}</td>
      <td>${selectHtml(state.meta.firms, c.firm, "firm")}</td>
      <td class="name-cell">${textInput(c.customerName, "customerName")}</td>
      <td>${textInput(c.mobileNo, "mobileNo")}</td>
      <td>${textInput(c.emailId, "emailId")}</td>
      <td>${numberInput(c.amountOutstanding, "amountOutstanding")}</td>
      <td>${dateInput(c.invoiceDate, "invoiceDate")}</td>
      <td>${numberInput(c.creditDays, "creditDays")}</td>
      <td class="readonly">${d.dueDate || "—"}</td>
      <td class="readonly num">${d.daysOverdue === "" ? "—" : d.daysOverdue}</td>
      <td><span class="badge badge-${ageingBadgeClass(d.ageingBucket)}">${d.ageingBucket}</span></td>
      <td>${selectHtml(state.meta.statuses, c.status, "status")}</td>
      <td><span class="badge badge-${priorityBadgeClass(d.priority)}">${d.priority}</span></td>
      <td>${dateInput(c.nextFollowupDate, "nextFollowupDate")}</td>
      <td>${dateInput(c.lastFollowupDate, "lastFollowupDate")}</td>
      <td>${textInput(c.followedUpBy, "followedUpBy")}</td>
      <td>${textareaInput(c.remark, "remark")}</td>
      <td><button class="del-btn" title="Delete customer">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function textInput(val, field) {
  return `<input type="text" data-field="${field}" value="${escapeHtml(val || "")}" />`;
}
function textareaInput(val, field) {
  return `<textarea data-field="${field}" rows="1">${escapeHtml(val || "")}</textarea>`;
}
function numberInput(val, field) {
  return `<input type="number" data-field="${field}" value="${val ?? ""}" />`;
}
function dateInput(val, field) {
  return `<input type="date" data-field="${field}" value="${val || ""}" />`;
}
function selectHtml(options, current, field) {
  return `<select data-field="${field}">${options
    .map((o) => `<option ${o === current ? "selected" : ""}>${escapeHtml(o)}</option>`)
    .join("")}</select>`;
}

/* Delegated input handling for the tracker table */
$("#tracker-tbody").addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const tr = e.target.closest("tr");
  const idx = Number(tr.dataset.idx);
  const c = state.customers[idx];
  let val = e.target.value;
  if (e.target.type === "number") val = val === "" ? "" : Number(val);
  c[field] = val;
  markDirty();
  tr.classList.add("row-dirty");
  // Live-update derived cells for this row without a full re-render (preserves focus)
  if (["invoiceDate", "creditDays", "amountOutstanding", "status"].includes(field)) {
    const d = deriveFields(c);
    tr.children[8].textContent = d.dueDate || "—";
    tr.children[9].textContent = d.daysOverdue === "" ? "—" : d.daysOverdue;
    tr.children[10].innerHTML = `<span class="badge badge-${ageingBadgeClass(d.ageingBucket)}">${d.ageingBucket}</span>`;
    tr.children[12].innerHTML = `<span class="badge badge-${priorityBadgeClass(d.priority)}">${d.priority}</span>`;
  }
  if (field === "amountOutstanding" || field === "status") renderDashboard();
});

$("#tracker-tbody").addEventListener("click", (e) => {
  if (!e.target.classList.contains("del-btn")) return;
  const tr = e.target.closest("tr");
  const idx = Number(tr.dataset.idx);
  const c = state.customers[idx];
  if (!confirm(`Remove ${c.customerName || "this customer"} from the tracker?`)) return;
  state.customers.splice(idx, 1);
  markDirty();
  renderAll();
});

/* ---------------- Filters ---------------- */
["search-input", "firm-filter", "status-filter", "priority-filter", "ageing-filter"].forEach((id) => {
  $(`#${id}`).addEventListener("input", renderTracker);
  $(`#${id}`).addEventListener("change", renderTracker);
});

/* ---------------- Add customer ---------------- */
$("#add-customer-btn").addEventListener("click", () => {
  const maxSr = state.customers.reduce((m, c) => Math.max(m, Number(c.srNo) || 0), 0);
  const name = prompt("Customer name?");
  if (!name || !name.trim()) return;
  state.customers.push({
    srNo: maxSr + 1,
    firm: state.meta.firms[0] || "",
    customerName: name.trim(),
    mobileNo: "",
    emailId: "",
    amountOutstanding: 0,
    invoiceDate: "",
    creditDays: 30,
    status: state.meta.statuses[0] || "Pending Follow-up",
    nextFollowupDate: "",
    lastFollowupDate: "",
    followedUpBy: state.userName || "",
    remark: "",
  });
  markDirty();
  renderAll();
  showToast(`Added ${name.trim()} — fill in invoice details to activate Ageing & Priority.`);
});

/* ---------------- Save ---------------- */
$("#save-btn").addEventListener("click", async () => {
  const btn = $("#save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    // Re-check the remote sha to avoid clobbering a newer save.
    const latest = await GitHubAPI.getJSON(
      state.token, APP_CONFIG.dataOwner, APP_CONFIG.dataRepo, APP_CONFIG.dataPath, APP_CONFIG.dataBranch
    );
    if (state.fileExisted && latest.sha && latest.sha !== state.sha) {
      const proceed = confirm(
        `${latest.data?.meta?.updatedBy || "Someone"} saved changes since you loaded this page ` +
        `(${latest.data?.meta?.lastUpdated ? new Date(latest.data.meta.lastUpdated).toLocaleString("en-IN") : "recently"}).\n\n` +
        `Saving now will overwrite their changes with yours. Continue anyway?`
      );
      if (!proceed) {
        showToast("Save cancelled — reload the page to see the latest data.", true);
        btn.textContent = "Save changes";
        btn.disabled = false;
        return;
      }
    }
    state.meta.lastUpdated = new Date().toISOString();
    state.meta.updatedBy = state.userName;
    const payload = { meta: state.meta, customers: state.customers };
    const newSha = await GitHubAPI.putJSON(
      state.token, APP_CONFIG.dataOwner, APP_CONFIG.dataRepo, APP_CONFIG.dataPath, APP_CONFIG.dataBranch,
      payload, latest.sha, `Update tracker — ${state.userName}`
    );
    state.sha = newSha;
    state.fileExisted = true;
    clearDirty();
    showToast("Saved to GitHub.");
  } catch (e) {
    showToast(e.message || "Save failed — check your connection and try again.", true);
  } finally {
    btn.textContent = "Save changes";
    btn.disabled = state.dirty ? false : true;
  }
});

/* ---------------- Export ---------------- */
$("#export-btn").addEventListener("click", () => {
  exportToExcel(state.customers, state.meta);
});

/* ---------------- Boot ---------------- */
function renderAll() {
  renderDashboard();
  renderTracker();
  $("#sync-status").textContent = state.meta.lastUpdated
    ? `Saved · ${new Date(state.meta.lastUpdated).toLocaleString("en-IN")}`
    : (state.fileExisted ? "" : "New file — save to create it in the data repo");
}

(function boot() {
  const saved = loadAuth();
  if (saved) {
    $("#pat-input").value = saved.token;
    $("#name-input").value = saved.name;
    attemptLogin(saved.token, saved.name, !!localStorage.getItem(STORAGE_KEY), true).then(() => {
      if (!state.token) { $("#login-screen").hidden = false; }
    });
  }
})();
