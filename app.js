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

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error("Error cargando datos", e);
  }
  return { transactions: [], debts: [], receivables: [] };
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

// ---------- App state ----------

let activeTab = "dashboard";
let dashboardMonth = todayISO().slice(0, 7);
let movMonthFilter = todayISO().slice(0, 7);
let movTypeFilter = "todos";
let entryType = "gasto";

// ---------- Rendering ----------

const app = document.getElementById("app");

function render() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  });

  if (activeTab === "dashboard") app.innerHTML = renderDashboard();
  else if (activeTab === "registro") app.innerHTML = renderRegistro();
  else if (activeTab === "movimientos") app.innerHTML = renderMovimientos();
  else if (activeTab === "deudas") app.innerHTML = renderDeudas();
  else if (activeTab === "cobrar") app.innerHTML = renderCobrar();

  attachHandlers();
}

// ---------- Dashboard ----------

function computeMonthTotals(key) {
  const txs = state.transactions.filter(t => monthKey(t.date) === key);
  const ingresos = txs.filter(t => t.type === "ingreso").reduce((s, t) => s + t.amount, 0);
  const gastos = txs.filter(t => t.type === "gasto").reduce((s, t) => s + t.amount, 0);

  const deudasComprometidas = state.debts
    .filter(d => d.remainingMonths > 0)
    .reduce((s, d) => s + d.monthlyPayment, 0);

  const saldo = ingresos - gastos - deudasComprometidas;

  const byCategory = {};
  txs.filter(t => t.type === "gasto").forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });

  return { ingresos, gastos, deudasComprometidas, saldo, byCategory, txCount: txs.length };
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

  return `
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
    function toggleMeta() {
      metaField.style.display = catSelect.value === "Ahorro/inversión" ? "flex" : "none";
    }
    catSelect.addEventListener("change", toggleMeta);
    toggleMeta();

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
      state.transactions.push({
        id: uid(),
        type: entryType,
        category,
        amount,
        date: fd.get("date") || todayISO(),
        note
      });
      saveState();
      toast("Movimiento guardado");
      e.target.reset();
      document.getElementById("f-date").value = todayISO();
      toggleMeta();
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

// ---------- Init ----------

render();
