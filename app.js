// ---------- Data ----------

const CATEGORIES = {
  ingreso: ["Sueldo Bonum", "Comisiones Bonum", "Freelance", "Hotmart", "Aporte papás", "Otros"],
  gasto: {
    "Fijos": ["Arriendo", "Internet", "Agua", "Luz", "Datos móviles", "Suscripciones digitales", "Universidad hermano", "Entrenamiento", "Seguro/salud"],
    "Variables": ["Comida/mercado", "Salidas a comer", "Gasolina", "Uber/taxi", "Compras casa", "Fútbol-cancha", "Fútbol-cervezas", "Socialización/salidas", "Peluquería", "Ropa", "Imprevistos"],
    "Ahorro/inversión": ["Ahorro/inversión"]
  }
};

const STORAGE_KEY = "finanzas_personales_v1";
const CUSTOM_CATEGORY = "__otro__";

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}

// Normalizes any previously-saved (or imported) state shape into the current
// shape, backfilling missing fields instead of discarding unknown data.
// fixedExpenses items predating the ingreso/gasto split lack a `type` field;
// those are treated as "gasto" (their only possible meaning at the time).
function migrateState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const fixedExpenses = Array.isArray(s.fixedExpenses) ? s.fixedExpenses : [];
  return {
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    debts: Array.isArray(s.debts) ? s.debts : [],
    receivables: Array.isArray(s.receivables) ? s.receivables : [],
    fixedExpenses: fixedExpenses.map(fe => ({ type: "gasto", ...fe })),
    expectedIncomes: Array.isArray(s.expectedIncomes) ? s.expectedIncomes : [],
    goals: Array.isArray(s.goals) ? s.goals : [],
    incomeAllocations: Array.isArray(s.incomeAllocations) ? s.incomeAllocations : []
  };
}

// ---------- Supabase ----------
// `state` stays the single in-memory object every render*() function reads
// from (unchanged) — only how it's populated/persisted changes. Each mutation
// still updates `state` synchronously first (instant UI), then fires the
// matching Supabase call below (not awaited, so the UI stays as snappy as it
// was with localStorage); a failed write surfaces as a toast instead of a
// silent loss, but we don't roll back the optimistic local change.

const SUPABASE_URL = "https://zyjqojchnhlpfakmnqnf.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ifdazi_w6juVTFqfp7R8aQ_j472_aKW";
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// state key -> Supabase table name
const TABLES = {
  transactions: "transactions",
  fixedExpenses: "fixed_expenses",
  debts: "debts",
  receivables: "receivables",
  expectedIncomes: "expected_incomes",
  goals: "goals",
  incomeAllocations: "income_allocations"
};

function camelToSnakeKey(k) {
  return k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}
function snakeToCamelKey(k) {
  return k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
// Empty strings (from optional date inputs left blank) become null — Postgres
// `date` columns reject "" but accept null; harmless for text columns too.
function toSnakeObj(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { out[camelToSnakeKey(k)] = v === "" ? null : v; });
  return out;
}
function toCamelObj(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { out[snakeToCamelKey(k)] = v; });
  return out;
}

async function dbInsert(entityKey, row) {
  const { error } = await sb.from(TABLES[entityKey]).insert(toSnakeObj(row));
  if (error) toast(`No se pudo guardar en la nube (${entityKey}): ${error.message}`);
}

async function dbUpdate(entityKey, id, patch) {
  const { error } = await sb.from(TABLES[entityKey]).update(toSnakeObj(patch)).eq("id", id);
  if (error) toast(`No se pudo actualizar en la nube (${entityKey}): ${error.message}`);
}

async function dbDelete(entityKey, id) {
  const { error } = await sb.from(TABLES[entityKey]).delete().eq("id", id);
  if (error) toast(`No se pudo eliminar en la nube (${entityKey}): ${error.message}`);
}

async function dbUpsertMany(entityKey, rows) {
  if (!rows || !rows.length) return;
  const { error } = await sb.from(TABLES[entityKey]).upsert(rows.map(toSnakeObj), { onConflict: "id" });
  if (error) toast(`Error subiendo ${entityKey}: ${error.message}`);
}

async function fetchTable(entityKey) {
  const { data, error } = await sb.from(TABLES[entityKey]).select("*");
  if (error) {
    toast(`Error cargando ${entityKey}: ${error.message}`);
    return [];
  }
  return (data || []).map(toCamelObj);
}

async function loadAllFromSupabase() {
  const keys = Object.keys(TABLES);
  const results = await Promise.all(keys.map(fetchTable));
  const raw = {};
  keys.forEach((k, i) => { raw[k] = results[i]; });
  return migrateState(raw);
}

let state = migrateState(null); // populated by boot() once unlocked

// ---------- Utils ----------

function fmtMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("es-EC", { style: "currency", currency: "USD" });
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

function shiftMonth(key, delta) {
  let [y, m] = key.split("-").map(Number);
  m += delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function daysRemainingInMonth(key) {
  const [y, m] = key.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (key !== currentKey) return null; // only meaningful for current month
  return lastDay - now.getDate() + 1;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function currentRealMonth() {
  return todayISO().slice(0, 7);
}

function categoryGroup(cat) {
  for (const [group, cats] of Object.entries(CATEGORIES.gasto)) {
    if (cats.includes(cat)) return group;
  }
  return null;
}

// ---------- Fijos (gastos e ingresos recurrentes) ----------
// A single fixedExpenses list backs both "Gastos fijos" and "Ingresos fijos";
// each item's `type` ("gasto" | "ingreso") decides which section it belongs to.

function isFixedConfirmed(fixedExpenseId, mKey) {
  return state.transactions.some(t => t.fixedExpenseId === fixedExpenseId && monthKey(t.date) === mKey);
}

function pendingFixedExpenses(mKey, type) {
  return state.fixedExpenses.filter(fe => fe.type === type && !isFixedConfirmed(fe.id, mKey));
}

function confirmFixedExpense(fixedExpenseId, amount) {
  const fe = state.fixedExpenses.find(f => f.id === fixedExpenseId);
  if (!fe) return;
  const amt = Number(amount) > 0 ? Number(amount) : fe.amount;
  const tx = {
    id: uid(),
    type: fe.type,
    category: fe.category,
    amount: amt,
    date: todayISO(),
    note: fe.name && fe.name !== fe.category ? fe.name : "",
    fixedExpenseId: fe.id,
    source: "fijo"
  };
  state.transactions.push(tx);
  dbInsert("transactions", tx);
}

// ---------- App state ----------

let activeTab = "dashboard";
let dashboardMonth = todayISO().slice(0, 7);
let movMonthFilter = todayISO().slice(0, 7);
let movTypeFilter = "todos";
let entryType = "gasto";
let cmpRange = 3;
let migratingFixedId = null; // fixedExpense id being moved from Gastos fijos to Deudas
let lastIncomeAssign = null; // { txId, amount, date } of the last non-fijo ingreso just saved, pending an optional split

// ---------- Rendering ----------

// Resolved once the app shell is injected into the page post-unlock (see
// mountAppShell) — null before that, but render() is never called that early.
let app = null;

function render() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  });

  if (activeTab === "dashboard") app.innerHTML = renderDashboard();
  else if (activeTab === "registro") app.innerHTML = renderRegistro();
  else if (activeTab === "fijos") app.innerHTML = renderFijosSection("gasto");
  else if (activeTab === "fijos-ingreso") app.innerHTML = renderFijosSection("ingreso");
  else if (activeTab === "movimientos") app.innerHTML = renderMovimientos();
  else if (activeTab === "deudas") app.innerHTML = renderDeudas();
  else if (activeTab === "metas") app.innerHTML = renderMetas();
  else if (activeTab === "cobrar") app.innerHTML = renderCobrar();
  else if (activeTab === "esperados") app.innerHTML = renderIngresosEsperados();
  else if (activeTab === "comparar") app.innerHTML = renderComparar();

  attachHandlers();
}

// ---------- Dashboard ----------

function computeMonthTotals(key) {
  const txs = state.transactions.filter(t => monthKey(t.date) === key);
  const ingresos = txs.filter(t => t.type === "ingreso").reduce((s, t) => s + t.amount, 0);
  const gastoTxs = txs.filter(t => t.type === "gasto");
  const gastos = gastoTxs.reduce((s, t) => s + t.amount, 0);

  const gastosFijos = gastoTxs.filter(t => t.source === "fijo" || categoryGroup(t.category) === "Fijos").reduce((s, t) => s + t.amount, 0);
  const gastosVariables = gastoTxs.filter(t => categoryGroup(t.category) === "Variables").reduce((s, t) => s + t.amount, 0);
  const gastosAhorro = gastoTxs.filter(t => categoryGroup(t.category) === "Ahorro/inversión").reduce((s, t) => s + t.amount, 0);

  const deudasComprometidas = state.debts
    .filter(d => d.remainingMonths > 0)
    .reduce((s, d) => s + d.monthlyPayment, 0);

  const saldo = ingresos - gastos - deudasComprometidas;

  // Money the user chose to set aside this month (goal contributions net of
  // withdrawals, plus extra debt paydowns) is no longer "free" — it leaves the pool.
  const allocationsThisMonth = state.incomeAllocations.filter(a => monthKey(a.date) === key);
  const goalsAllocadas = allocationsThisMonth.filter(a => a.type === "goal").reduce((s, a) => s + a.amount, 0);
  const deudasExtra = allocationsThisMonth.filter(a => a.type === "debt").reduce((s, a) => s + a.amount, 0);
  const totalAsignado = goalsAllocadas + deudasExtra;

  const disponibleLibre = ingresos - gastosFijos - deudasComprometidas - gastosVariables - totalAsignado;
  let semaforo = "red";
  if (disponibleLibre > 100) semaforo = "green";
  else if (disponibleLibre > 0) semaforo = "yellow";

  const totalComprometido = gastosFijos + deudasComprometidas;

  const gastosFijosPendientes = pendingFixedExpenses(key, "gasto").reduce((s, fe) => s + fe.amount, 0);
  const ingresosFijosPendientes = pendingFixedExpenses(key, "ingreso").reduce((s, fe) => s + fe.amount, 0);
  const ingresosEsperadosPendientes = state.expectedIncomes.filter(ei => !ei.received).reduce((s, ei) => s + ei.amount, 0);

  // Month-end projection only makes sense for the real current month (it relies
  // on "today" to split elapsed vs. remaining days) — null for any other month.
  const isCurrentMonth = key === currentRealMonth();
  let avgDailyVariable = 0;
  let projectedRemainingVariable = 0;
  let proyeccionFinDeMes = null;
  let disponibleRealFinDeMes = null;

  if (isCurrentMonth) {
    const [y, m] = key.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const now = new Date();
    const daysElapsed = now.getDate();
    const daysRemainingExclToday = Math.max(0, lastDay - daysElapsed);

    avgDailyVariable = daysElapsed > 0 ? gastosVariables / daysElapsed : 0;
    projectedRemainingVariable = avgDailyVariable * daysRemainingExclToday;

    proyeccionFinDeMes = (ingresos + ingresosFijosPendientes + ingresosEsperadosPendientes)
      - (gastosFijos + gastosFijosPendientes + deudasComprometidas + totalAsignado + projectedRemainingVariable);

    disponibleRealFinDeMes = disponibleLibre - projectedRemainingVariable;
  }

  const byCategory = {};
  gastoTxs.forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });

  return {
    ingresos, gastos, gastosFijos, gastosVariables, gastosAhorro,
    deudasComprometidas, saldo, disponibleLibre, semaforo, totalComprometido, totalAsignado,
    gastosFijosPendientes, ingresosFijosPendientes, ingresosEsperadosPendientes,
    isCurrentMonth, avgDailyVariable, projectedRemainingVariable,
    proyeccionFinDeMes, disponibleRealFinDeMes,
    byCategory, txCount: txs.length
  };
}

function statMini(label, value, variant) {
  return `
    <div class="stat-mini ${variant || ""}">
      <div class="stat-mini-value">${value}</div>
      <div class="stat-mini-label">${escapeHtml(label)}</div>
    </div>`;
}

function renderPendingFixedBanner(type, mKey) {
  const pending = pendingFixedExpenses(mKey, type);
  if (!pending.length) return "";
  const isGasto = type === "gasto";
  const sectionLabel = isGasto ? "Gastos fijos" : "Ingresos fijos";
  const itemLabel = isGasto ? "gasto(s) fijo(s)" : "ingreso(s) fijo(s)";
  const tabTarget = isGasto ? "fijos" : "fijos-ingreso";
  return `
    <div class="card alert-card">
      <h2>⚠ ${escapeHtml(sectionLabel)} pendientes — ${escapeHtml(monthLabel(mKey))}</h2>
      <p class="alert-text">Tienes ${pending.length} ${itemLabel} sin confirmar este mes.</p>
      <button class="btn" data-action="goto-fijos" data-target="${tabTarget}">Ir a ${escapeHtml(sectionLabel)}</button>
    </div>`;
}

function renderDashboard() {
  const totals = computeMonthTotals(dashboardMonth);
  const daysLeft = daysRemainingInMonth(dashboardMonth);
  const perDay = daysLeft && daysLeft > 0 ? totals.saldo / daysLeft : null;

  const catEntries = Object.entries(totals.byCategory).sort((a, b) => b[1] - a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 0;

  const catRows = catEntries.length
    ? catEntries.map(([cat, amt]) => `
        <div class="cat-row">
          <span class="name">${escapeHtml(cat)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${maxCat ? (amt / maxCat * 100) : 0}%"></div></div>
          <span class="amount">${fmtMoney(amt)}</span>
        </div>`).join("")
    : `<div class="empty-state">Sin gastos registrados este mes.</div>`;

  const activeDebts = state.debts.filter(d => d.remainingMonths > 0);
  const pendingReceivables = state.receivables.filter(r => !r.paid);

  const realMonth = currentRealMonth();
  const pendingBanner = renderPendingFixedBanner("gasto", realMonth) + renderPendingFixedBanner("ingreso", realMonth);

  const semaforoEmoji = totals.semaforo === "green" ? "🟢" : totals.semaforo === "yellow" ? "🟡" : "🔴";

  return `
    ${pendingBanner}

    <div class="card">
      <div class="month-nav">
        <button data-action="dash-prev">‹</button>
        <span class="month-label">${monthLabel(dashboardMonth)}</span>
        <button data-action="dash-next">›</button>
      </div>
      <div class="balance-hero">
        <div class="label">Saldo del mes</div>
        <div class="value" style="color:${totals.saldo >= 0 ? "var(--green)" : "var(--red)"}">${fmtMoney(totals.saldo)}</div>
        <div class="sub">${daysLeft !== null ? `${daysLeft} día(s) restantes · ${perDay !== null ? fmtMoney(perDay) : "-"} / día disponible` : "Mes ya cerrado o futuro"}</div>
      </div>
    </div>

    <div class="card">
      <h2>Semáforo de gasto libre</h2>
      <div class="semaforo-box semaforo-${totals.semaforo}">
        <span class="semaforo-dot">${semaforoEmoji}</span>
        <div>
          <div class="semaforo-amount">${fmtMoney(totals.disponibleLibre)}</div>
          <div class="semaforo-label">Disponible libre = ingresos − fijos confirmados − deudas − asignado a metas − variables</div>
        </div>
      </div>
      <div class="stat-grid">
        ${statMini("Total ingresos", fmtMoney(totals.ingresos), "positive")}
        ${statMini("Total comprometido (fijos + deudas)", fmtMoney(totals.totalComprometido), "negative")}
        ${statMini("Asignado a metas/deudas extra", fmtMoney(totals.totalAsignado), "negative")}
        ${statMini("Disponible libre", fmtMoney(totals.disponibleLibre), totals.disponibleLibre >= 0 ? "positive" : "negative")}
        ${statMini("Gastado en variables hasta hoy", fmtMoney(totals.gastosVariables), "negative")}
        ${statMini("Disponible real hasta fin de mes", totals.isCurrentMonth ? fmtMoney(totals.disponibleRealFinDeMes) : "— (solo mes actual)", "neutral")}
      </div>
    </div>

    ${totals.isCurrentMonth ? `
    <div class="card">
      <h2>Proyección a fin de mes</h2>
      <div class="balance-hero" style="padding:16px 10px;">
        <div class="label">Estimado al cierre del mes</div>
        <div class="value" style="font-size:32px;color:${totals.proyeccionFinDeMes >= 0 ? "var(--green)" : "var(--red)"}">${fmtMoney(totals.proyeccionFinDeMes)}</div>
        <div class="sub">Incluye fijos e ingresos esperados pendientes, y una proyección del gasto variable restante</div>
      </div>
      <div class="stat-grid">
        ${statMini("Ingresos recibidos", fmtMoney(totals.ingresos), "positive")}
        ${statMini("Ingresos fijos sin confirmar", fmtMoney(totals.ingresosFijosPendientes), "positive")}
        ${statMini("Ingresos esperados sin recibir", fmtMoney(totals.ingresosEsperadosPendientes), "positive")}
        ${statMini("Gastos fijos confirmados", fmtMoney(totals.gastosFijos), "negative")}
        ${statMini("Gastos fijos sin confirmar", fmtMoney(totals.gastosFijosPendientes), "negative")}
        ${statMini("Cuotas de deuda", fmtMoney(totals.deudasComprometidas), "negative")}
        ${statMini("Asignado a metas/deudas extra", fmtMoney(totals.totalAsignado), "negative")}
        ${statMini(`Variable proyectado (${fmtMoney(totals.avgDailyVariable)}/día)`, fmtMoney(totals.projectedRemainingVariable), "negative")}
      </div>
    </div>` : ""}

    <div class="grid-3">
      <div class="stat positive">
        <div class="label">Ingresos del mes</div>
        <div class="value">${fmtMoney(totals.ingresos)}</div>
      </div>
      <div class="stat negative">
        <div class="label">Gastos del mes</div>
        <div class="value">${fmtMoney(totals.gastos)}</div>
      </div>
      <div class="stat">
        <div class="label">Deudas comprometidas</div>
        <div class="value">${fmtMoney(totals.deudasComprometidas)}</div>
      </div>
    </div>

    <div class="card">
      <h2>Gastos por categoría</h2>
      ${catRows}
    </div>

    <div class="card">
      <h2>Deudas activas (${activeDebts.length})</h2>
      ${activeDebts.length
        ? activeDebts.map(d => `
          <div class="list-row">
            <div class="info">
              <div class="title">${escapeHtml(d.name)}</div>
              <div class="meta">${d.remainingMonths} cuota(s) restantes · saldo ${fmtMoney(d.totalAmount)}</div>
            </div>
            <div class="amount-tag gasto">${fmtMoney(d.monthlyPayment)}/mes</div>
          </div>`).join("")
        : `<div class="empty-state">No tienes deudas activas.</div>`}
    </div>

    <div class="card">
      <h2>Por cobrar pendiente (${pendingReceivables.length})</h2>
      ${pendingReceivables.length
        ? fmtMoney(pendingReceivables.reduce((s, r) => s + r.amount, 0)) + " en total. Ve a la pestaña 'Por cobrar' para gestionarlo."
        : `<div class="empty-state">Nada pendiente por cobrar.</div>`}
    </div>
  `;
}

// ---------- Registro rápido ----------

function renderRegistro() {
  const isGasto = entryType === "gasto";
  let categoryOptions = "";

  if (entryType === "ingreso") {
    categoryOptions = CATEGORIES.ingreso.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  } else {
    categoryOptions = Object.entries(CATEGORIES.gasto).map(([group, cats]) =>
      `<optgroup label="${escapeHtml(group)}">${cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</optgroup>`
    ).join("");
  }

  return `
    <div class="card">
      <h2>Registro rápido</h2>
      <form class="entry-form" id="entry-form">
        <div class="type-toggle">
          <button type="button" data-type="gasto" class="${isGasto ? "active" : ""}" data-action="set-entry-type">Gasto</button>
          <button type="button" data-type="ingreso" class="${!isGasto ? "active" : ""}" data-action="set-entry-type">Ingreso</button>
        </div>

        <div class="field">
          <label for="f-amount">Monto</label>
          <input type="number" step="0.01" min="0" id="f-amount" name="amount" placeholder="0.00" required>
        </div>

        <div class="field">
          <label for="f-category">Categoría</label>
          <select id="f-category" name="category" required>${categoryOptions}</select>
        </div>

        <div class="field" id="meta-field" style="display:none">
          <label for="f-meta">Meta de ahorro (ej. importadora)</label>
          <input type="text" id="f-meta" name="meta" placeholder="Nombre de la meta">
        </div>

        <div class="field" id="recurring-field" style="display:none">
          <label class="checkbox-label" for="f-recurring">
            <input type="checkbox" id="f-recurring">
            ¿Es un ${isGasto ? "gasto" : "ingreso"} fijo/recurrente?
          </label>
        </div>

        <div class="field">
          <label for="f-date">Fecha</label>
          <input type="date" id="f-date" name="date" value="${todayISO()}" required>
        </div>

        <div class="field">
          <label for="f-note">Nota (opcional)</label>
          <input type="text" id="f-note" name="note" placeholder="Detalle opcional">
        </div>

        <button type="submit" class="btn">Guardar</button>
      </form>
    </div>
    ${renderAssignIncomePanel()}
  `;
}

function renderAssignIncomePanel() {
  if (!lastIncomeAssign) return "";
  const { amount } = lastIncomeAssign;
  const goals = state.goals;
  const activeDebts = state.debts.filter(d => d.remainingMonths > 0);
  if (!goals.length && !activeDebts.length) return "";

  const goalRows = goals.map(g => `
    <div class="assign-row">
      <span class="assign-row-label">${escapeHtml(g.name)} <span class="meta">(${fmtMoney(g.savedAmount)} / ${fmtMoney(g.targetAmount)})</span></span>
      <input type="number" step="0.01" min="0" class="assign-goal-input" data-id="${g.id}" placeholder="0.00">
    </div>`).join("");

  const debtRows = activeDebts.map(d => `
    <div class="assign-row">
      <span class="assign-row-label">${escapeHtml(d.name)} <span class="meta">(abono extra)</span></span>
      <input type="number" step="0.01" min="0" class="assign-debt-input" data-id="${d.id}" placeholder="0.00">
    </div>`).join("");

  return `
    <div class="card" id="assign-income-panel">
      <h2>Asignar este ingreso (${fmtMoney(amount)})</h2>
      <p class="alert-text">Por defecto queda como disponible normal. Reparte una parte a metas o deudas si quieres.</p>
      ${goals.length ? `<div class="assign-group-title">Metas</div>${goalRows}` : ""}
      ${activeDebts.length ? `<div class="assign-group-title">Deudas (abono extra)</div>${debtRows}` : ""}
      <div class="assign-remaining" id="assign-remaining">Sin asignar: ${fmtMoney(amount)}</div>
      <div class="actions" style="margin-top:12px;">
        <button class="btn" data-action="save-assign">Guardar reparto</button>
        <button class="btn secondary" data-action="skip-assign">Omitir (dejar todo disponible)</button>
      </div>
    </div>`;
}

// ---------- Fijos (gastos e ingresos recurrentes) ----------

function renderFijosSection(type) {
  const isGasto = type === "gasto";
  const sectionLabel = isGasto ? "Gastos fijos" : "Ingresos fijos";
  const itemNoun = isGasto ? "gasto fijo" : "ingreso fijo";
  const itemNounPlural = isGasto ? "gastos fijos" : "ingresos fijos";
  const sign = isGasto ? "-" : "+";
  const amountClass = isGasto ? "gasto" : "ingreso";

  const mKey = currentRealMonth();
  const pending = pendingFixedExpenses(mKey, type);
  const confirmedTx = state.transactions.filter(t => t.source === "fijo" && t.type === type && monthKey(t.date) === mKey);
  const configuredItems = state.fixedExpenses.filter(fe => fe.type === type);

  const pendingRows = pending.length ? pending.map(fe => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(fe.name || fe.category)}</div>
        <div class="meta">${escapeHtml(fe.category)} · configurado: ${fmtMoney(fe.amount)}</div>
      </div>
      <input type="number" step="0.01" min="0" class="pending-amount-input" data-id="${fe.id}" value="${fe.amount}">
      <button class="btn small" data-action="confirm-fixed" data-id="${fe.id}">Confirmar</button>
    </div>`).join("") : `<div class="empty-state">No hay ${itemNounPlural} pendientes este mes. 🎉</div>`;

  const confirmedRows = confirmedTx.length ? confirmedTx.map(t => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(t.category)}</div>
        <div class="meta">${t.date}${t.note ? " · " + escapeHtml(t.note) : ""}</div>
      </div>
      <div class="amount-tag ${amountClass}">${sign}${fmtMoney(t.amount)}</div>
    </div>`).join("") : `<div class="empty-state">Aún no confirmas ningún ${itemNoun} este mes.</div>`;

  const configuredRows = configuredItems.length ? configuredItems.map(fe => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(fe.name || fe.category)}</div>
        <div class="meta">${escapeHtml(fe.category)}</div>
      </div>
      <div class="amount-tag ${amountClass}">${fmtMoney(fe.amount)}</div>
      <button class="btn secondary small" data-action="delete-fixed" data-id="${fe.id}">Eliminar</button>
    </div>`).join("") : `<div class="empty-state">No has configurado ${itemNounPlural} todavía.</div>`;

  const baseCategories = isGasto ? CATEGORIES.gasto["Fijos"] : CATEGORIES.ingreso;
  const categoryOptions = baseCategories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")
    + `<option value="${CUSTOM_CATEGORY}">Otro</option>`;

  const legacyCuotaCarro = isGasto ? state.fixedExpenses.find(fe => fe.type === "gasto" && fe.category === "Cuota carro") : null;
  const legacyNotice = legacyCuotaCarro ? `
    <div class="card alert-card">
      <h2>⚠ "Cuota carro" ya no es un gasto fijo</h2>
      <p class="alert-text">Una cuota de carro tiene monto total y meses restantes — eso se rastrea mejor en Deudas. Muévela cuando tengas esos datos a mano.</p>
      <button class="btn" data-action="migrate-cuota-carro" data-id="${legacyCuotaCarro.id}">Mover a Deudas</button>
    </div>` : "";

  return `
    ${legacyNotice}
    <div class="card">
      <h2>Pendientes de confirmar — ${escapeHtml(monthLabel(mKey))}</h2>
      ${pending.length ? `<button class="btn" data-action="confirm-all-fixed" data-type="${type}" style="margin-bottom:12px;">Confirmar todos</button>` : ""}
      ${pendingRows}
    </div>

    <div class="card">
      <h2>Confirmados este mes</h2>
      ${confirmedRows}
    </div>

    <div class="card">
      <h2>Nuevo ${itemNoun}</h2>
      <form id="fixed-form" class="inline-form" data-type="${type}">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. ${isGasto ? "Arriendo depto" : "Sueldo Bonum"}" required>
        </div>
        <div class="field">
          <label>Categoría</label>
          <select id="fixed-category-select" name="category" required>${categoryOptions}</select>
        </div>
        <div class="field" id="fixed-custom-field" style="display:none">
          <label>Nombre de la categoría personalizada</label>
          <input type="text" id="fixed-custom-category" placeholder="ej. ${isGasto ? "Gimnasio" : "Renta departamento"}">
        </div>
        <div class="field">
          <label>Monto</label>
          <input type="number" step="0.01" min="0" name="amount" placeholder="0.00" required>
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar ${itemNoun}</button>
      </form>
    </div>

    <div class="card">
      <h2>${escapeHtml(sectionLabel)} configurados</h2>
      ${configuredRows}
    </div>
  `;
}

// ---------- Comparador histórico ----------

function getCategoryTotalsForMonth(mKey, type) {
  const totals = {};
  state.transactions.filter(t => t.type === type && monthKey(t.date) === mKey).forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + t.amount;
  });
  return totals;
}

function computeComparison(type, rangeN) {
  const curKey = currentRealMonth();
  const pastKeys = [];
  for (let i = 1; i <= rangeN; i++) pastKeys.push(shiftMonth(curKey, -i));

  const availableKeys = pastKeys.filter(k => state.transactions.some(t => t.type === type && monthKey(t.date) === k));
  const currentTotals = getCategoryTotalsForMonth(curKey, type);

  if (availableKeys.length === 0) {
    return { insufficient: true, currentTotals, rangeN };
  }

  const sumTotals = {};
  availableKeys.forEach(k => {
    const t = getCategoryTotalsForMonth(k, type);
    Object.entries(t).forEach(([cat, amt]) => { sumTotals[cat] = (sumTotals[cat] || 0) + amt; });
  });
  const avgTotals = {};
  Object.entries(sumTotals).forEach(([cat, amt]) => { avgTotals[cat] = amt / availableKeys.length; });

  return { insufficient: false, currentTotals, avgTotals, availableCount: availableKeys.length, rangeN };
}

function renderComparisonChart(result, title) {
  if (result.insufficient) {
    return `<div class="card"><h2>${escapeHtml(title)}</h2><div class="empty-state">Aún no hay suficiente historial para comparar con los últimos ${result.rangeN} mes(es).</div></div>`;
  }
  const { currentTotals, avgTotals, availableCount, rangeN } = result;
  const categories = Array.from(new Set([...Object.keys(currentTotals), ...Object.keys(avgTotals)]))
    .sort((a, b) => (Math.max(currentTotals[b] || 0, avgTotals[b] || 0)) - (Math.max(currentTotals[a] || 0, avgTotals[a] || 0)));
  const maxVal = Math.max(1, ...categories.map(c => Math.max(currentTotals[c] || 0, avgTotals[c] || 0)));

  const note = availableCount < rangeN
    ? `<div class="meta" style="margin-bottom:10px;">Promedio calculado con ${availableCount} de ${rangeN} mes(es) con datos.</div>`
    : "";

  const rows = categories.length ? categories.map(cat => {
    const cur = currentTotals[cat] || 0;
    const avg = avgTotals[cat] || 0;
    return `
      <div class="cmp-row">
        <div class="cmp-label">${escapeHtml(cat)}</div>
        <div class="cmp-bars">
          <div class="cmp-bar-line">
            <span class="cmp-tag current">Este mes</span>
            <div class="bar-track"><div class="bar-fill current" style="width:${(cur / maxVal) * 100}%"></div></div>
            <span class="cmp-value">${fmtMoney(cur)}</span>
          </div>
          <div class="cmp-bar-line">
            <span class="cmp-tag avg">Promedio</span>
            <div class="bar-track"><div class="bar-fill avg" style="width:${(avg / maxVal) * 100}%"></div></div>
            <span class="cmp-value">${fmtMoney(avg)}</span>
          </div>
        </div>
      </div>`;
  }).join("") : `<div class="empty-state">Sin datos para mostrar.</div>`;

  return `<div class="card"><h2>${escapeHtml(title)}</h2>${note}${rows}</div>`;
}

function renderComparar() {
  const rangeOptions = Array.from({ length: 12 }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === cmpRange ? "selected" : ""}>${n} mes${n > 1 ? "es" : ""}</option>`).join("");

  const gastoResult = computeComparison("gasto", cmpRange);
  const ingresoResult = computeComparison("ingreso", cmpRange);

  return `
    <div class="card">
      <h2>Comparador histórico</h2>
      <div class="filter-row">
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;">
          Comparar mes actual vs. promedio de los últimos
          <select id="cmp-range-select">${rangeOptions}</select>
        </label>
      </div>
    </div>
    ${renderComparisonChart(gastoResult, "Gastos por categoría — mes actual vs. promedio")}
    ${renderComparisonChart(ingresoResult, "Ingresos por categoría — mes actual vs. promedio")}
  `;
}

// ---------- Movimientos ----------

function renderMovimientos() {
  const months = Array.from(new Set(state.transactions.map(t => monthKey(t.date)))).sort().reverse();
  if (!months.includes(movMonthFilter) && months.length) movMonthFilter = months[0];

  const monthOptions = months.length
    ? months.map(m => `<option value="${m}" ${m === movMonthFilter ? "selected" : ""}>${escapeHtml(monthLabel(m))}</option>`).join("")
    : `<option value="${movMonthFilter}">${escapeHtml(monthLabel(movMonthFilter))}</option>`;

  let txs = state.transactions.filter(t => monthKey(t.date) === movMonthFilter);
  if (movTypeFilter !== "todos") txs = txs.filter(t => t.type === movTypeFilter);
  txs = txs.slice().sort((a, b) => b.date.localeCompare(a.date));

  const rows = txs.length
    ? txs.map(t => `
      <div class="list-row">
        <div class="info">
          <div class="title">${escapeHtml(t.category)}</div>
          <div class="meta">${t.date}${t.note ? " · " + escapeHtml(t.note) : ""}</div>
        </div>
        <div class="amount-tag ${t.type}">${t.type === "gasto" ? "-" : "+"}${fmtMoney(t.amount)}</div>
        <button class="btn danger small" data-action="delete-tx" data-id="${t.id}">Eliminar</button>
      </div>`).join("")
    : `<div class="empty-state">No hay movimientos para este filtro.</div>`;

  return `
    <div class="card">
      <h2>Movimientos</h2>
      <div class="filter-row">
        <select id="mov-month">${monthOptions}</select>
        <select id="mov-type">
          <option value="todos" ${movTypeFilter === "todos" ? "selected" : ""}>Todos</option>
          <option value="ingreso" ${movTypeFilter === "ingreso" ? "selected" : ""}>Ingresos</option>
          <option value="gasto" ${movTypeFilter === "gasto" ? "selected" : ""}>Gastos</option>
        </select>
      </div>
      ${rows}
    </div>
  `;
}

// ---------- Deudas ----------

function renderDeudas() {
  const debts = state.debts.slice().sort((a, b) => b.remainingMonths - a.remainingMonths);
  const migratingFixed = migratingFixedId ? state.fixedExpenses.find(fe => fe.id === migratingFixedId) : null;
  if (!migratingFixed) migratingFixedId = null;

  const cards = debts.length ? debts.map(d => {
    const original = d.originalTotal || d.totalAmount;
    const paidPct = original > 0 ? Math.min(100, ((original - d.totalAmount) / original) * 100) : 100;
    const done = d.remainingMonths <= 0;
    return `
      <div class="debt-card">
        <div class="top">
          <span class="name">${escapeHtml(d.name)}${done ? " ✅" : ""}</span>
          <span class="remaining">${done ? "Pagada" : d.remainingMonths + " cuota(s) restantes"}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${paidPct}%"></div></div>
        <div class="stats-row">
          <span>Saldo: ${fmtMoney(Math.max(d.totalAmount, 0))}</span>
          <span>Cuota: ${fmtMoney(d.monthlyPayment)}/mes</span>
        </div>
        <div class="actions">
          <button class="btn small" data-action="pay-installment" data-id="${d.id}" ${done ? "disabled" : ""}>Pagar cuota</button>
          <button class="btn secondary small" data-action="delete-debt" data-id="${d.id}">Eliminar</button>
        </div>
      </div>`;
  }).join("") : `<div class="empty-state">No tienes deudas registradas.</div>`;

  return `
    <div class="card">
      <h2>${migratingFixed ? `Mover "${escapeHtml(migratingFixed.name)}" a Deudas` : "Nueva deuda"}</h2>
      ${migratingFixed ? `<p class="alert-text">Completa el monto total y los meses restantes reales — la cuota mensual ya viene precargada.</p>` : ""}
      <form id="debt-form" class="inline-form" data-migrating-id="${migratingFixed ? migratingFixed.id : ""}">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. Tarjeta X" value="${migratingFixed ? escapeHtml(migratingFixed.name) : ""}" required>
        </div>
        <div class="field">
          <label>Monto total</label>
          <input type="number" step="0.01" min="0" name="total" placeholder="0.00" required>
        </div>
        <div class="field">
          <label>Cuota mensual</label>
          <input type="number" step="0.01" min="0" name="monthly" placeholder="0.00" value="${migratingFixed ? migratingFixed.amount : ""}" required>
        </div>
        <div class="field">
          <label>Meses restantes</label>
          <input type="number" min="1" step="1" name="months" placeholder="12" required>
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">${migratingFixed ? "Crear deuda y mover" : "Agregar deuda"}</button>
        ${migratingFixed ? `<button type="button" class="btn secondary" style="grid-column: 1 / -1;" data-action="cancel-migrate-cuota">Cancelar</button>` : ""}
      </form>
    </div>
    <div class="card">
      <h2>Deudas</h2>
      ${cards}
    </div>
  `;
}

// ---------- Metas ----------

function renderMetas() {
  const goals = state.goals.slice().sort((a, b) => (b.savedAmount / (b.targetAmount || 1)) - (a.savedAmount / (a.targetAmount || 1)));

  const cards = goals.length ? goals.map(g => {
    const pct = g.targetAmount > 0 ? Math.min(100, (g.savedAmount / g.targetAmount) * 100) : 0;
    const done = g.savedAmount >= g.targetAmount && g.targetAmount > 0;
    return `
      <div class="debt-card">
        <div class="top">
          <span class="name">${escapeHtml(g.name)}${done ? " 🎉" : ""}</span>
          <span class="remaining">${fmtMoney(g.savedAmount)} / ${fmtMoney(g.targetAmount)}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="stats-row">
          <span>${pct.toFixed(0)}% completado</span>
        </div>
        <div class="actions">
          <input type="number" step="0.01" min="0" class="withdraw-input" data-id="${g.id}" placeholder="Monto a retirar" style="max-width:140px;">
          <button class="btn secondary small" data-action="withdraw-goal" data-id="${g.id}">Retirar de meta</button>
          <button class="btn secondary small" data-action="delete-goal" data-id="${g.id}">Eliminar</button>
        </div>
      </div>`;
  }).join("") : `<div class="empty-state">No tienes metas configuradas todavía.</div>`;

  return `
    <div class="card">
      <h2>Nueva meta</h2>
      <form id="goal-form" class="inline-form">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. Importadora" required>
        </div>
        <div class="field">
          <label>Monto objetivo</label>
          <input type="number" step="0.01" min="0" name="target" placeholder="0.00" required>
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar meta</button>
      </form>
    </div>
    <div class="card">
      <h2>Metas</h2>
      ${cards}
    </div>
  `;
}

// ---------- Por cobrar ----------

function renderCobrar() {
  const pending = state.receivables.filter(r => !r.paid).sort((a, b) => (a.estimatedDate || "9999").localeCompare(b.estimatedDate || "9999"));
  const paid = state.receivables.filter(r => r.paid).sort((a, b) => (b.paidDate || "").localeCompare(a.paidDate || ""));

  const today = todayISO();

  const pendingRows = pending.length ? pending.map(r => {
    const overdue = r.estimatedDate && r.estimatedDate < today;
    return `
      <div class="list-row">
        <div class="info">
          <div class="title">${escapeHtml(r.who)}</div>
          <div class="meta ${overdue ? "overdue" : ""}">${r.estimatedDate ? "Estimado: " + r.estimatedDate : "Sin fecha estimada"}${overdue ? " · Vencido" : ""}</div>
        </div>
        <div class="amount-tag ingreso">${fmtMoney(r.amount)}</div>
        <button class="btn small" data-action="mark-paid" data-id="${r.id}">Marcar pagado</button>
        <button class="btn secondary small" data-action="delete-receivable" data-id="${r.id}">Eliminar</button>
      </div>`;
  }).join("") : `<div class="empty-state">No hay cuentas por cobrar pendientes.</div>`;

  const paidRows = paid.length ? paid.map(r => `
      <div class="list-row">
        <div class="info">
          <div class="title">${escapeHtml(r.who)}</div>
          <div class="meta">Pagado el ${r.paidDate}</div>
        </div>
        <div class="amount-tag ingreso">${fmtMoney(r.amount)}</div>
      </div>`).join("") : `<div class="empty-state">Aún no hay cobros registrados.</div>`;

  return `
    <div class="card">
      <h2>Nueva cuenta por cobrar</h2>
      <form id="receivable-form" class="inline-form">
        <div class="field">
          <label>Quién debe</label>
          <input type="text" name="who" placeholder="Nombre" required>
        </div>
        <div class="field">
          <label>Monto</label>
          <input type="number" step="0.01" min="0" name="amount" placeholder="0.00" required>
        </div>
        <div class="field">
          <label>Fecha estimada (opcional)</label>
          <input type="date" name="estimatedDate">
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar</button>
      </form>
    </div>
    <div class="card">
      <h2>Pendiente</h2>
      ${pendingRows}
    </div>
    <div class="card">
      <h2>Historial de cobros</h2>
      ${paidRows}
    </div>
  `;
}

// ---------- Ingresos esperados ----------

function renderIngresosEsperados() {
  const pending = state.expectedIncomes.filter(ei => !ei.received)
    .sort((a, b) => (a.expectedDate || "9999").localeCompare(b.expectedDate || "9999"));
  const received = state.expectedIncomes.filter(ei => ei.received)
    .sort((a, b) => (b.receivedDate || "").localeCompare(a.receivedDate || ""));

  const today = todayISO();

  const pendingRows = pending.length ? pending.map(ei => {
    const overdue = ei.expectedDate && ei.expectedDate < today;
    return `
      <div class="list-row">
        <div class="info">
          <div class="title">${escapeHtml(ei.name)}</div>
          <div class="meta ${overdue ? "overdue" : ""}">${ei.expectedDate ? "Esperado: " + ei.expectedDate : "Sin fecha estimada"}${overdue ? " · Vencido" : ""}</div>
        </div>
        <div class="amount-tag ingreso">${fmtMoney(ei.amount)}</div>
        <button class="btn small" data-action="mark-received" data-id="${ei.id}">Marcar recibido</button>
        <button class="btn secondary small" data-action="delete-expected" data-id="${ei.id}">Eliminar</button>
      </div>`;
  }).join("") : `<div class="empty-state">No hay ingresos esperados pendientes.</div>`;

  const receivedRows = received.length ? received.map(ei => `
      <div class="list-row">
        <div class="info">
          <div class="title">${escapeHtml(ei.name)}</div>
          <div class="meta">Recibido el ${ei.receivedDate}</div>
        </div>
        <div class="amount-tag ingreso">${fmtMoney(ei.amount)}</div>
      </div>`).join("") : `<div class="empty-state">Aún no hay ingresos recibidos por esta vía.</div>`;

  return `
    <div class="card">
      <h2>Nuevo ingreso esperado</h2>
      <form id="expected-form" class="inline-form">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. Bono, reembolso" required>
        </div>
        <div class="field">
          <label>Monto estimado</label>
          <input type="number" step="0.01" min="0" name="amount" placeholder="0.00" required>
        </div>
        <div class="field">
          <label>Fecha esperada (opcional)</label>
          <input type="date" name="expectedDate">
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar</button>
      </form>
    </div>
    <div class="card">
      <h2>Pendiente</h2>
      ${pendingRows}
    </div>
    <div class="card">
      <h2>Historial de recibidos</h2>
      ${receivedRows}
    </div>
  `;
}

// ---------- Handlers ----------

function attachHandlers() {
  // Tabs handled globally via delegation (see below), nothing per-render needed there.

  if (activeTab === "dashboard") {
    document.querySelector('[data-action="dash-prev"]').addEventListener("click", () => {
      dashboardMonth = shiftMonth(dashboardMonth, -1);
      render();
    });
    document.querySelector('[data-action="dash-next"]').addEventListener("click", () => {
      dashboardMonth = shiftMonth(dashboardMonth, 1);
      render();
    });
    document.querySelectorAll('[data-action="goto-fijos"]').forEach(btn => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.target;
        render();
      });
    });
  }

  if (activeTab === "registro") {
    document.querySelectorAll('[data-action="set-entry-type"]').forEach(btn => {
      btn.addEventListener("click", () => {
        entryType = btn.dataset.type;
        lastIncomeAssign = null;
        render();
      });
    });

    const catSelect = document.getElementById("f-category");
    const metaField = document.getElementById("meta-field");
    const recurringField = document.getElementById("recurring-field");
    function toggleMeta() {
      metaField.style.display = catSelect.value === "Ahorro/inversión" ? "flex" : "none";
    }
    function toggleRecurring() {
      const show = entryType === "ingreso" || categoryGroup(catSelect.value) === "Fijos";
      recurringField.style.display = show ? "flex" : "none";
    }
    catSelect.addEventListener("change", () => { toggleMeta(); toggleRecurring(); });
    toggleMeta();
    toggleRecurring();

    document.getElementById("entry-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = parseFloat(fd.get("amount"));
      if (!amount || amount <= 0) { toast("Ingresa un monto válido"); return; }
      const category = fd.get("category");
      let note = (fd.get("note") || "").trim();
      const meta = (fd.get("meta") || "").trim();
      if (category === "Ahorro/inversión" && meta) {
        note = note ? `${note} [Meta: ${meta}]` : `Meta: ${meta}`;
      }

      const recurringEl = document.getElementById("f-recurring");
      const isRecurring = recurringEl && recurringEl.checked && recurringField.style.display !== "none";
      const tx = {
        id: uid(),
        type: entryType,
        category,
        amount,
        date: fd.get("date") || todayISO(),
        note
      };

      if (isRecurring) {
        const feName = note || category;
        let fe = state.fixedExpenses.find(f => f.type === entryType && f.category === category && f.name === feName);
        if (fe) {
          fe.amount = amount;
          dbUpdate("fixedExpenses", fe.id, { amount });
        } else {
          fe = { id: uid(), type: entryType, name: feName, category, amount };
          state.fixedExpenses.push(fe);
          dbInsert("fixedExpenses", fe);
        }
        tx.fixedExpenseId = fe.id;
        tx.source = "fijo";
      }

      state.transactions.push(tx);
      dbInsert("transactions", tx);
      const sectionLabel = entryType === "gasto" ? "Gastos fijos" : "Ingresos fijos";

      const canAssign = entryType === "ingreso" && !isRecurring
        && (state.goals.length > 0 || state.debts.some(d => d.remainingMonths > 0));

      if (canAssign) {
        lastIncomeAssign = { txId: tx.id, amount, date: tx.date };
        toast("Ingreso guardado");
        render();
      } else {
        lastIncomeAssign = null;
        toast(isRecurring ? `Movimiento guardado y agregado a ${sectionLabel}` : "Movimiento guardado");
        e.target.reset();
        document.getElementById("f-date").value = todayISO();
        toggleMeta();
        toggleRecurring();
      }
    });

    if (lastIncomeAssign) {
      function updateAssignRemaining() {
        const inputs = document.querySelectorAll(".assign-goal-input, .assign-debt-input");
        let assigned = 0;
        inputs.forEach(inp => { assigned += parseFloat(inp.value) || 0; });
        const remainingEl = document.getElementById("assign-remaining");
        if (remainingEl) remainingEl.textContent = `Sin asignar: ${fmtMoney(lastIncomeAssign.amount - assigned)}`;
      }
      document.querySelectorAll(".assign-goal-input, .assign-debt-input").forEach(inp => {
        inp.addEventListener("input", updateAssignRemaining);
      });

      const saveAssignBtn = document.querySelector('[data-action="save-assign"]');
      saveAssignBtn.addEventListener("click", () => {
        const goalInputs = document.querySelectorAll(".assign-goal-input");
        const debtInputs = document.querySelectorAll(".assign-debt-input");
        let totalAssigned = 0;
        const goalAllocs = [];
        const debtAllocs = [];
        goalInputs.forEach(inp => {
          const amt = parseFloat(inp.value);
          if (amt > 0) { goalAllocs.push({ id: inp.dataset.id, amount: amt }); totalAssigned += amt; }
        });
        debtInputs.forEach(inp => {
          const amt = parseFloat(inp.value);
          if (amt > 0) { debtAllocs.push({ id: inp.dataset.id, amount: amt }); totalAssigned += amt; }
        });
        if (totalAssigned - lastIncomeAssign.amount > 0.005) {
          toast("No puedes asignar más de lo que ingresaste");
          return;
        }
        goalAllocs.forEach(({ id, amount: amt }) => {
          const goal = state.goals.find(g => g.id === id);
          if (!goal) return;
          goal.savedAmount += amt;
          dbUpdate("goals", goal.id, { savedAmount: goal.savedAmount });
          const alloc = { id: uid(), type: "goal", targetId: goal.id, amount: amt, date: lastIncomeAssign.date };
          state.incomeAllocations.push(alloc);
          dbInsert("incomeAllocations", alloc);
        });
        debtAllocs.forEach(({ id, amount: amt }) => {
          const debt = state.debts.find(d => d.id === id);
          if (!debt) return;
          debt.totalAmount = Math.max(0, debt.totalAmount - amt);
          if (debt.monthlyPayment > 0) {
            debt.remainingMonths = Math.max(0, Math.ceil(debt.totalAmount / debt.monthlyPayment));
          }
          dbUpdate("debts", debt.id, { totalAmount: debt.totalAmount, remainingMonths: debt.remainingMonths });
          const alloc = { id: uid(), type: "debt", targetId: debt.id, amount: amt, date: lastIncomeAssign.date };
          state.incomeAllocations.push(alloc);
          dbInsert("incomeAllocations", alloc);
        });
        lastIncomeAssign = null;
        render();
        toast(totalAssigned > 0 ? `Repartiste ${fmtMoney(totalAssigned)}, el resto queda disponible` : "Ingreso guardado como disponible");
      });

      document.querySelector('[data-action="skip-assign"]').addEventListener("click", () => {
        lastIncomeAssign = null;
        render();
        toast("Ingreso guardado como disponible");
      });
    }
  }

  if (activeTab === "fijos" || activeTab === "fijos-ingreso") {
    const type = activeTab === "fijos" ? "gasto" : "ingreso";
    const itemLabel = type === "gasto" ? "Gasto fijo" : "Ingreso fijo";

    const fixedCatSelect = document.getElementById("fixed-category-select");
    const fixedCustomField = document.getElementById("fixed-custom-field");
    function toggleFixedCustom() {
      fixedCustomField.style.display = fixedCatSelect.value === CUSTOM_CATEGORY ? "flex" : "none";
    }
    fixedCatSelect.addEventListener("change", toggleFixedCustom);
    toggleFixedCustom();

    document.getElementById("fixed-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = parseFloat(fd.get("amount"));
      const name = fd.get("name").trim();
      let category = fd.get("category");
      if (category === CUSTOM_CATEGORY) {
        category = document.getElementById("fixed-custom-category").value.trim();
        if (!category) { toast("Escribe el nombre de la categoría personalizada"); return; }
      }
      if (!amount || amount <= 0 || !name) { toast("Completa nombre y monto"); return; }
      const fe = { id: uid(), type, name, category, amount };
      state.fixedExpenses.push(fe);
      dbInsert("fixedExpenses", fe);
      render();
      toast(`${itemLabel} agregado`);
    });

    document.querySelectorAll('[data-action="confirm-fixed"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.querySelector(`.pending-amount-input[data-id="${btn.dataset.id}"]`);
        confirmFixedExpense(btn.dataset.id, input ? input.value : undefined);
        render();
        toast(`${itemLabel} confirmado`);
      });
    });

    const confirmAllBtn = document.querySelector('[data-action="confirm-all-fixed"]');
    if (confirmAllBtn) {
      confirmAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".pending-amount-input").forEach(input => {
          confirmFixedExpense(input.dataset.id, input.value);
        });
        render();
        toast(`${type === "gasto" ? "Gastos" : "Ingresos"} fijos confirmados`);
      });
    }

    document.querySelectorAll('[data-action="delete-fixed"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.fixedExpenses = state.fixedExpenses.filter(fe => fe.id !== btn.dataset.id);
        dbDelete("fixedExpenses", btn.dataset.id);
        render();
        toast(`${itemLabel} eliminado`);
      });
    });

    const migrateBtn = document.querySelector('[data-action="migrate-cuota-carro"]');
    if (migrateBtn) {
      migrateBtn.addEventListener("click", () => {
        migratingFixedId = migrateBtn.dataset.id;
        activeTab = "deudas";
        render();
      });
    }
  }

  if (activeTab === "comparar") {
    document.getElementById("cmp-range-select").addEventListener("change", (e) => {
      cmpRange = parseInt(e.target.value, 10);
      render();
    });
  }

  if (activeTab === "movimientos") {
    document.getElementById("mov-month").addEventListener("change", (e) => {
      movMonthFilter = e.target.value;
      render();
    });
    document.getElementById("mov-type").addEventListener("change", (e) => {
      movTypeFilter = e.target.value;
      render();
    });
    document.querySelectorAll('[data-action="delete-tx"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.transactions = state.transactions.filter(t => t.id !== btn.dataset.id);
        dbDelete("transactions", btn.dataset.id);
        render();
        toast("Movimiento eliminado");
      });
    });
  }

  if (activeTab === "deudas") {
    document.getElementById("debt-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const total = parseFloat(fd.get("total"));
      const monthly = parseFloat(fd.get("monthly"));
      const months = parseInt(fd.get("months"), 10);
      if (!total || !monthly || !months) { toast("Completa todos los campos"); return; }
      const debt = {
        id: uid(),
        name: fd.get("name").trim(),
        totalAmount: total,
        originalTotal: total,
        monthlyPayment: monthly,
        remainingMonths: months
      };
      state.debts.push(debt);
      dbInsert("debts", debt);
      const migratingId = e.target.dataset.migratingId;
      if (migratingId) {
        state.fixedExpenses = state.fixedExpenses.filter(fe => fe.id !== migratingId);
        dbDelete("fixedExpenses", migratingId);
        migratingFixedId = null;
      }
      render();
      toast(migratingId ? "Deuda creada y movida desde Gastos fijos" : "Deuda agregada");
    });

    const cancelMigrateBtn = document.querySelector('[data-action="cancel-migrate-cuota"]');
    if (cancelMigrateBtn) {
      cancelMigrateBtn.addEventListener("click", () => {
        migratingFixedId = null;
        render();
      });
    }

    document.querySelectorAll('[data-action="pay-installment"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const debt = state.debts.find(d => d.id === btn.dataset.id);
        if (!debt || debt.remainingMonths <= 0) return;
        debt.totalAmount = Math.max(0, debt.totalAmount - debt.monthlyPayment);
        debt.remainingMonths = Math.max(0, debt.remainingMonths - 1);
        dbUpdate("debts", debt.id, { totalAmount: debt.totalAmount, remainingMonths: debt.remainingMonths });
        render();
        toast(`Cuota de "${debt.name}" registrada`);
      });
    });

    document.querySelectorAll('[data-action="delete-debt"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.debts = state.debts.filter(d => d.id !== btn.dataset.id);
        dbDelete("debts", btn.dataset.id);
        render();
        toast("Deuda eliminada");
      });
    });
  }

  if (activeTab === "metas") {
    document.getElementById("goal-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const target = parseFloat(fd.get("target"));
      const name = fd.get("name").trim();
      if (!target || target <= 0 || !name) { toast("Completa nombre y monto objetivo"); return; }
      const goal = { id: uid(), name, targetAmount: target, savedAmount: 0 };
      state.goals.push(goal);
      dbInsert("goals", goal);
      render();
      toast("Meta agregada");
    });

    document.querySelectorAll('[data-action="withdraw-goal"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const goal = state.goals.find(g => g.id === btn.dataset.id);
        if (!goal) return;
        const input = document.querySelector(`.withdraw-input[data-id="${btn.dataset.id}"]`);
        const amount = parseFloat(input ? input.value : "");
        if (!amount || amount <= 0) { toast("Ingresa un monto válido a retirar"); return; }
        if (amount > goal.savedAmount) { toast("No puedes retirar más de lo ahorrado en la meta"); return; }
        goal.savedAmount -= amount;
        dbUpdate("goals", goal.id, { savedAmount: goal.savedAmount });
        const alloc = { id: uid(), type: "goal", targetId: goal.id, amount: -amount, date: todayISO() };
        state.incomeAllocations.push(alloc);
        dbInsert("incomeAllocations", alloc);
        render();
        toast(`Retiraste ${fmtMoney(amount)} de "${goal.name}" a disponible libre`);
      });
    });

    document.querySelectorAll('[data-action="delete-goal"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const goal = state.goals.find(g => g.id === btn.dataset.id);
        if (!goal) return;
        const returned = goal.savedAmount;
        if (returned > 0) {
          const alloc = { id: uid(), type: "goal", targetId: goal.id, amount: -returned, date: todayISO() };
          state.incomeAllocations.push(alloc);
          dbInsert("incomeAllocations", alloc);
        }
        state.goals = state.goals.filter(g => g.id !== btn.dataset.id);
        dbDelete("goals", btn.dataset.id);
        render();
        toast(returned > 0 ? `Meta eliminada, ${fmtMoney(returned)} devuelto a disponible libre` : "Meta eliminada");
      });
    });
  }

  if (activeTab === "cobrar") {
    document.getElementById("receivable-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = parseFloat(fd.get("amount"));
      const who = fd.get("who").trim();
      if (!amount || amount <= 0 || !who) { toast("Completa quién debe y el monto"); return; }
      const r = {
        id: uid(),
        who,
        amount,
        estimatedDate: fd.get("estimatedDate") || "",
        paid: false
      };
      state.receivables.push(r);
      dbInsert("receivables", r);
      render();
      toast("Cuenta por cobrar agregada");
    });

    document.querySelectorAll('[data-action="mark-paid"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const r = state.receivables.find(x => x.id === btn.dataset.id);
        if (!r || r.paid) return;
        r.paid = true;
        r.paidDate = todayISO();
        dbUpdate("receivables", r.id, { paid: true, paidDate: r.paidDate });
        const tx = {
          id: uid(),
          type: "ingreso",
          category: "Otros",
          amount: r.amount,
          date: r.paidDate,
          note: `Cobro: ${r.who}`
        };
        state.transactions.push(tx);
        dbInsert("transactions", tx);
        render();
        toast(`Cobro de "${r.who}" registrado como ingreso`);
      });
    });

    document.querySelectorAll('[data-action="delete-receivable"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.receivables = state.receivables.filter(r => r.id !== btn.dataset.id);
        dbDelete("receivables", btn.dataset.id);
        render();
        toast("Registro eliminado");
      });
    });
  }

  if (activeTab === "esperados") {
    document.getElementById("expected-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = parseFloat(fd.get("amount"));
      const name = fd.get("name").trim();
      if (!amount || amount <= 0 || !name) { toast("Completa nombre y monto"); return; }
      const ei = {
        id: uid(),
        name,
        amount,
        expectedDate: fd.get("expectedDate") || "",
        received: false
      };
      state.expectedIncomes.push(ei);
      dbInsert("expectedIncomes", ei);
      render();
      toast("Ingreso esperado agregado");
    });

    document.querySelectorAll('[data-action="mark-received"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const ei = state.expectedIncomes.find(x => x.id === btn.dataset.id);
        if (!ei || ei.received) return;
        ei.received = true;
        ei.receivedDate = todayISO();
        dbUpdate("expectedIncomes", ei.id, { received: true, receivedDate: ei.receivedDate });
        const tx = {
          id: uid(),
          type: "ingreso",
          category: "Otros",
          amount: ei.amount,
          date: ei.receivedDate,
          note: `Ingreso esperado: ${ei.name}`
        };
        state.transactions.push(tx);
        dbInsert("transactions", tx);
        render();
        toast(`"${ei.name}" registrado como ingreso`);
      });
    });

    document.querySelectorAll('[data-action="delete-expected"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.expectedIncomes = state.expectedIncomes.filter(ei => ei.id !== btn.dataset.id);
        dbDelete("expectedIncomes", btn.dataset.id);
        render();
        toast("Registro eliminado");
      });
    });
  }
}

// ---------- Exportar / Importar ----------

function exportData() {
  const dataStr = JSON.stringify(state, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finanzas-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Datos exportados");
}

function importDataFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      toast("Archivo inválido: no es un JSON válido");
      return;
    }
    const ok = confirm("Esto restaura este archivo como respaldo local Y lo sube a Supabase (fusionando por id, no duplica). ¿Continuar?");
    if (!ok) return;

    const migrated = migrateState(parsed);
    // Local backup, as requested — independent of the Supabase upload below.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));

    toast("Subiendo a Supabase…");
    await Promise.all(Object.keys(TABLES).map(key => dbUpsertMany(key, migrated[key])));

    state = await loadAllFromSupabase();
    render();
    toast("Datos importados y sincronizados con Supabase");
  };
  reader.onerror = () => toast("No se pudo leer el archivo");
  reader.readAsText(file);
}

// ---------- Puerta de contraseña ----------
// Clave única fija, guardada como hash SHA-256 (no en texto plano). Esto es
// una cortina de UI, no autenticación real: la publishable key de Supabase
// vive en este mismo archivo servido al navegador, así que alguien que la
// extraiga puede leer/escribir la base directo por REST sin pasar por aquí.
//
// El HTML de la app (header, nav, #app) NO existe en index.html — se
// construye e inyecta recién en mountAppShell(), llamada solo después de una
// contraseña correcta. Antes de eso no hay nada que inspeccionar en el DOM
// más allá del formulario de la puerta; no es solo un `hidden` tapando el
// contenido.

const GATE_PASSWORD_HASH = "09bb24ea71904771ec74cfdeb390df3390a81c9ff60123988ea30b16e4e72e70";
const UNLOCK_KEY = "finanzas_unlocked_v1";

const APP_SHELL_HTML = `
  <header class="topbar">
    <div class="topbar-row">
      <h1>💰 Mis Finanzas</h1>
      <div class="backup-bar">
        <button class="btn secondary small" id="export-btn">⬇ Exportar datos</button>
        <button class="btn secondary small" id="import-btn">⬆ Importar datos</button>
        <input type="file" id="import-file-input" accept="application/json" hidden>
        <button class="btn secondary small" id="lock-btn">🔒 Cerrar sesión</button>
      </div>
    </div>
    <nav class="tabs" id="tabs">
      <button class="tab-btn active" data-tab="dashboard">Resumen</button>
      <button class="tab-btn" data-tab="registro">Registro rápido</button>
      <button class="tab-btn" data-tab="fijos">Gastos fijos</button>
      <button class="tab-btn" data-tab="fijos-ingreso">Ingresos fijos</button>
      <button class="tab-btn" data-tab="movimientos">Movimientos</button>
      <button class="tab-btn" data-tab="deudas">Deudas</button>
      <button class="tab-btn" data-tab="metas">Metas</button>
      <button class="tab-btn" data-tab="cobrar">Por cobrar</button>
      <button class="tab-btn" data-tab="esperados">Ingresos esperados</button>
      <button class="tab-btn" data-tab="comparar">Comparar</button>
    </nav>
  </header>
  <main id="app"></main>
`;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function mountAppShell() {
  const shell = document.createElement("div");
  shell.id = "app-shell";
  shell.innerHTML = APP_SHELL_HTML;
  document.body.appendChild(shell);
  app = document.getElementById("app");

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    if (btn.dataset.tab !== "registro") lastIncomeAssign = null;
    activeTab = btn.dataset.tab;
    render();
  });

  document.getElementById("export-btn").addEventListener("click", exportData);

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });

  document.getElementById("import-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importDataFromFile(file);
    e.target.value = "";
  });

  document.getElementById("lock-btn").addEventListener("click", () => {
    localStorage.removeItem(UNLOCK_KEY);
    location.reload();
  });
}

function showApp() {
  const gate = document.getElementById("gate-screen");
  if (gate) gate.remove();
  mountAppShell();
}

async function boot() {
  app.innerHTML = '<div class="loading-state">Cargando datos…</div>';
  state = await loadAllFromSupabase();
  render();
}

document.getElementById("gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("gate-password").value;
  const errorEl = document.getElementById("gate-error");
  const hash = await sha256Hex(input);
  if (hash === GATE_PASSWORD_HASH) {
    errorEl.textContent = "";
    localStorage.setItem(UNLOCK_KEY, "1");
    showApp();
    boot();
  } else {
    errorEl.textContent = "Contraseña incorrecta";
  }
});

// ---------- Init ----------

if (localStorage.getItem(UNLOCK_KEY) === "1") {
  showApp();
  boot();
}
