// ---------- Data ----------

const CATEGORIES = {
  ingreso: ["Sueldo Bonum", "Comisiones Bonum", "Freelance", "Hotmart", "Aporte papás", "Otros"],
  gasto: {
    "Fijos": ["Arriendo", "Cuota carro", "Internet", "Agua", "Luz", "Datos móviles", "Suscripciones digitales", "Universidad hermano", "Entrenamiento", "Seguro/salud"],
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
function migrateState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    transactions: Array.isArray(s.transactions) ? s.transactions : [],
    debts: Array.isArray(s.debts) ? s.debts : [],
    receivables: Array.isArray(s.receivables) ? s.receivables : [],
    fixedExpenses: Array.isArray(s.fixedExpenses) ? s.fixedExpenses : []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) {
    console.error("Error cargando datos", e);
  }
  return migrateState(null);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

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

// ---------- Gastos fijos ----------

function isFixedConfirmed(fixedExpenseId, mKey) {
  return state.transactions.some(t => t.fixedExpenseId === fixedExpenseId && monthKey(t.date) === mKey);
}

function pendingFixedExpenses(mKey) {
  return state.fixedExpenses.filter(fe => !isFixedConfirmed(fe.id, mKey));
}

function confirmFixedExpense(fixedExpenseId, amount) {
  const fe = state.fixedExpenses.find(f => f.id === fixedExpenseId);
  if (!fe) return;
  const amt = Number(amount) > 0 ? Number(amount) : fe.amount;
  state.transactions.push({
    id: uid(),
    type: "gasto",
    category: fe.category,
    amount: amt,
    date: todayISO(),
    note: fe.name && fe.name !== fe.category ? fe.name : "",
    fixedExpenseId: fe.id,
    source: "fijo"
  });
  saveState();
}

// ---------- App state ----------

let activeTab = "dashboard";
let dashboardMonth = todayISO().slice(0, 7);
let movMonthFilter = todayISO().slice(0, 7);
let movTypeFilter = "todos";
let entryType = "gasto";
let cmpRange = 3;

// ---------- Rendering ----------

const app = document.getElementById("app");

function render() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  });

  if (activeTab === "dashboard") app.innerHTML = renderDashboard();
  else if (activeTab === "registro") app.innerHTML = renderRegistro();
  else if (activeTab === "fijos") app.innerHTML = renderFijos();
  else if (activeTab === "movimientos") app.innerHTML = renderMovimientos();
  else if (activeTab === "deudas") app.innerHTML = renderDeudas();
  else if (activeTab === "cobrar") app.innerHTML = renderCobrar();
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

  const disponibleLibre = ingresos - gastosFijos - deudasComprometidas - gastosVariables;
  let semaforo = "red";
  if (disponibleLibre > 100) semaforo = "green";
  else if (disponibleLibre > 0) semaforo = "yellow";

  const byCategory = {};
  gastoTxs.forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });

  return {
    ingresos, gastos, gastosFijos, gastosVariables, gastosAhorro,
    deudasComprometidas, saldo, disponibleLibre, semaforo,
    byCategory, txCount: txs.length
  };
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
  const pendingFixed = pendingFixedExpenses(realMonth);
  const pendingBanner = pendingFixed.length ? `
    <div class="card alert-card">
      <h2>⚠ Gastos fijos pendientes — ${escapeHtml(monthLabel(realMonth))}</h2>
      <p class="alert-text">Tienes ${pendingFixed.length} gasto(s) fijo(s) sin confirmar este mes.</p>
      <button class="btn" data-action="goto-fijos">Ir a Gastos fijos</button>
    </div>` : "";

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
          <div class="semaforo-label">Disponible libre = ingresos − fijos confirmados − deudas − variables</div>
        </div>
      </div>
    </div>

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
            ¿Es un gasto fijo/recurrente?
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
  `;
}

// ---------- Gastos fijos ----------

function renderFijos() {
  const mKey = currentRealMonth();
  const pending = pendingFixedExpenses(mKey);
  const confirmedTx = state.transactions.filter(t => t.source === "fijo" && monthKey(t.date) === mKey);

  const pendingRows = pending.length ? pending.map(fe => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(fe.name || fe.category)}</div>
        <div class="meta">${escapeHtml(fe.category)} · configurado: ${fmtMoney(fe.amount)}</div>
      </div>
      <input type="number" step="0.01" min="0" class="pending-amount-input" data-id="${fe.id}" value="${fe.amount}">
      <button class="btn small" data-action="confirm-fixed" data-id="${fe.id}">Confirmar</button>
    </div>`).join("") : `<div class="empty-state">No hay fijos pendientes este mes. 🎉</div>`;

  const confirmedRows = confirmedTx.length ? confirmedTx.map(t => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(t.category)}</div>
        <div class="meta">${t.date}${t.note ? " · " + escapeHtml(t.note) : ""}</div>
      </div>
      <div class="amount-tag gasto">-${fmtMoney(t.amount)}</div>
    </div>`).join("") : `<div class="empty-state">Aún no confirmas ningún fijo este mes.</div>`;

  const configuredRows = state.fixedExpenses.length ? state.fixedExpenses.map(fe => `
    <div class="list-row">
      <div class="info">
        <div class="title">${escapeHtml(fe.name || fe.category)}</div>
        <div class="meta">${escapeHtml(fe.category)}</div>
      </div>
      <div class="amount-tag gasto">${fmtMoney(fe.amount)}</div>
      <button class="btn secondary small" data-action="delete-fixed" data-id="${fe.id}">Eliminar</button>
    </div>`).join("") : `<div class="empty-state">No has configurado gastos fijos todavía.</div>`;

  const categoryOptions = CATEGORIES.gasto["Fijos"].map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")
    + `<option value="${CUSTOM_CATEGORY}">Otro</option>`;

  return `
    <div class="card">
      <h2>Pendientes de confirmar — ${escapeHtml(monthLabel(mKey))}</h2>
      ${pending.length ? `<button class="btn" data-action="confirm-all-fixed" style="margin-bottom:12px;">Confirmar todos</button>` : ""}
      ${pendingRows}
    </div>

    <div class="card">
      <h2>Confirmados este mes</h2>
      ${confirmedRows}
    </div>

    <div class="card">
      <h2>Nuevo gasto fijo</h2>
      <form id="fixed-form" class="inline-form">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. Arriendo depto" required>
        </div>
        <div class="field">
          <label>Categoría</label>
          <select id="fixed-category-select" name="category" required>${categoryOptions}</select>
        </div>
        <div class="field" id="fixed-custom-field" style="display:none">
          <label>Nombre de la categoría personalizada</label>
          <input type="text" id="fixed-custom-category" placeholder="ej. Gimnasio">
        </div>
        <div class="field">
          <label>Monto</label>
          <input type="number" step="0.01" min="0" name="amount" placeholder="0.00" required>
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar fijo</button>
      </form>
    </div>

    <div class="card">
      <h2>Fijos configurados</h2>
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
      <h2>Nueva deuda</h2>
      <form id="debt-form" class="inline-form">
        <div class="field">
          <label>Nombre</label>
          <input type="text" name="name" placeholder="ej. Tarjeta X" required>
        </div>
        <div class="field">
          <label>Monto total</label>
          <input type="number" step="0.01" min="0" name="total" placeholder="0.00" required>
        </div>
        <div class="field">
          <label>Cuota mensual</label>
          <input type="number" step="0.01" min="0" name="monthly" placeholder="0.00" required>
        </div>
        <div class="field">
          <label>Meses restantes</label>
          <input type="number" min="1" step="1" name="months" placeholder="12" required>
        </div>
        <button type="submit" class="btn" style="grid-column: 1 / -1;">Agregar deuda</button>
      </form>
    </div>
    <div class="card">
      <h2>Deudas</h2>
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
    const gotoFijosBtn = document.querySelector('[data-action="goto-fijos"]');
    if (gotoFijosBtn) {
      gotoFijosBtn.addEventListener("click", () => {
        activeTab = "fijos";
        render();
      });
    }
  }

  if (activeTab === "registro") {
    document.querySelectorAll('[data-action="set-entry-type"]').forEach(btn => {
      btn.addEventListener("click", () => {
        entryType = btn.dataset.type;
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
      recurringField.style.display = categoryGroup(catSelect.value) === "Fijos" ? "flex" : "none";
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
      const isRecurring = entryType === "gasto" && recurringEl && recurringEl.checked;
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
        let fe = state.fixedExpenses.find(f => f.category === category && f.name === feName);
        if (fe) {
          fe.amount = amount;
        } else {
          fe = { id: uid(), name: feName, category, amount };
          state.fixedExpenses.push(fe);
        }
        tx.fixedExpenseId = fe.id;
        tx.source = "fijo";
      }

      state.transactions.push(tx);
      saveState();
      toast(isRecurring ? "Movimiento guardado y agregado a Gastos fijos" : "Movimiento guardado");
      e.target.reset();
      document.getElementById("f-date").value = todayISO();
      toggleMeta();
      toggleRecurring();
    });
  }

  if (activeTab === "fijos") {
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
      state.fixedExpenses.push({ id: uid(), name, category, amount });
      saveState();
      render();
      toast("Gasto fijo agregado");
    });

    document.querySelectorAll('[data-action="confirm-fixed"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.querySelector(`.pending-amount-input[data-id="${btn.dataset.id}"]`);
        confirmFixedExpense(btn.dataset.id, input ? input.value : undefined);
        render();
        toast("Gasto fijo confirmado");
      });
    });

    const confirmAllBtn = document.querySelector('[data-action="confirm-all-fixed"]');
    if (confirmAllBtn) {
      confirmAllBtn.addEventListener("click", () => {
        document.querySelectorAll(".pending-amount-input").forEach(input => {
          confirmFixedExpense(input.dataset.id, input.value);
        });
        render();
        toast("Fijos confirmados");
      });
    }

    document.querySelectorAll('[data-action="delete-fixed"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.fixedExpenses = state.fixedExpenses.filter(fe => fe.id !== btn.dataset.id);
        saveState();
        render();
        toast("Gasto fijo eliminado");
      });
    });
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
        saveState();
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
      state.debts.push({
        id: uid(),
        name: fd.get("name").trim(),
        totalAmount: total,
        originalTotal: total,
        monthlyPayment: monthly,
        remainingMonths: months
      });
      saveState();
      render();
      toast("Deuda agregada");
    });

    document.querySelectorAll('[data-action="pay-installment"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const debt = state.debts.find(d => d.id === btn.dataset.id);
        if (!debt || debt.remainingMonths <= 0) return;
        debt.totalAmount = Math.max(0, debt.totalAmount - debt.monthlyPayment);
        debt.remainingMonths = Math.max(0, debt.remainingMonths - 1);
        saveState();
        render();
        toast(`Cuota de "${debt.name}" registrada`);
      });
    });

    document.querySelectorAll('[data-action="delete-debt"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.debts = state.debts.filter(d => d.id !== btn.dataset.id);
        saveState();
        render();
        toast("Deuda eliminada");
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
      state.receivables.push({
        id: uid(),
        who,
        amount,
        estimatedDate: fd.get("estimatedDate") || "",
        paid: false
      });
      saveState();
      render();
      toast("Cuenta por cobrar agregada");
    });

    document.querySelectorAll('[data-action="mark-paid"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const r = state.receivables.find(x => x.id === btn.dataset.id);
        if (!r || r.paid) return;
        r.paid = true;
        r.paidDate = todayISO();
        state.transactions.push({
          id: uid(),
          type: "ingreso",
          category: "Otros",
          amount: r.amount,
          date: r.paidDate,
          note: `Cobro: ${r.who}`
        });
        saveState();
        render();
        toast(`Cobro de "${r.who}" registrado como ingreso`);
      });
    });

    document.querySelectorAll('[data-action="delete-receivable"]').forEach(btn => {
      btn.addEventListener("click", () => {
        state.receivables = state.receivables.filter(r => r.id !== btn.dataset.id);
        saveState();
        render();
        toast("Registro eliminado");
      });
    });
  }
}

// ---------- Tabs ----------

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  activeTab = btn.dataset.tab;
  render();
});

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
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      toast("Archivo inválido: no es un JSON válido");
      return;
    }
    const ok = confirm("Esto reemplazará todos los datos actuales por los del archivo importado. ¿Continuar?");
    if (!ok) return;
    state = migrateState(parsed);
    saveState();
    render();
    toast("Datos importados correctamente");
  };
  reader.onerror = () => toast("No se pudo leer el archivo");
  reader.readAsText(file);
}

document.getElementById("export-btn").addEventListener("click", exportData);

document.getElementById("import-btn").addEventListener("click", () => {
  document.getElementById("import-file-input").click();
});

document.getElementById("import-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importDataFromFile(file);
  e.target.value = "";
});

// ---------- Init ----------

render();
