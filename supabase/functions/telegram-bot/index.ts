// Telegram bot — registro rápido de gastos/ingresos por chat.
//
// Escribe en la misma tabla `transactions` que usa la app web. NO toca
// fijos, deudas, metas ni reparto de ingresos — solo altas simples del
// día a día, igual que "Registro rápido" sin marcar el checkbox de
// recurrente.
//
// Variables de entorno requeridas (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN         token del bot (BotFather)
//   TELEGRAM_WEBHOOK_SECRET    string propio para verificar que el POST venga de Telegram
//   AUTHORIZED_CHAT_ID         único chat_id permitido; todo lo demás se ignora
//   SUPABASE_URL               ya inyectada automáticamente por la plataforma
//   SUPABASE_SERVICE_ROLE_KEY  service_role key — bypassa RLS, nunca la publishable key
//
// Las categorías de abajo son una copia de CATEGORIES en app.js. Si cambias
// las categorías en la app web, actualízalas aquí también — no hay
// sincronización automática entre los dos archivos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const AUTHORIZED_CHAT_ID = Deno.env.get("AUTHORIZED_CHAT_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// ---------- Categorías (espejo de CATEGORIES en app.js) ----------

// "Ahorro/inversión" queda fuera a propósito: en la app web tiene su propio
// campo de "meta" y este bot solo hace altas simples.
const GASTO_CATEGORIES = [
  "Arriendo", "Internet", "Agua", "Luz", "Datos móviles",
  "Suscripciones digitales", "Universidad hermano", "Entrenamiento", "Seguro/salud",
  "Comida/mercado", "Salidas a comer", "Gasolina", "Uber/taxi", "Compras casa",
  "Fútbol-cancha", "Fútbol-cervezas", "Socialización/salidas", "Peluquería", "Ropa", "Imprevistos",
];

const INGRESO_CATEGORIES = [
  "Sueldo Bonum", "Comisiones Bonum", "Freelance", "Hotmart", "Aporte papás", "Otros",
];

// palabra clave -> categoría. Se ordena de la más específica (más larga) a
// la más genérica antes de buscar, así "cerveza" no cae en Fútbol-cancha.
const KEYWORDS: [string, string][] = [
  ["arriendo", "Arriendo"], ["renta", "Arriendo"], ["alquiler", "Arriendo"],
  ["internet", "Internet"], ["wifi", "Internet"],
  ["agua", "Agua"],
  ["luz", "Luz"], ["electricidad", "Luz"],
  ["datos moviles", "Datos móviles"], ["recarga", "Datos móviles"],
  ["suscripcion", "Suscripciones digitales"], ["netflix", "Suscripciones digitales"], ["spotify", "Suscripciones digitales"], ["disney", "Suscripciones digitales"],
  ["universidad", "Universidad hermano"], ["colegiatura", "Universidad hermano"],
  ["entrenamiento", "Entrenamiento"], ["gimnasio", "Entrenamiento"], ["gym", "Entrenamiento"],
  ["seguro", "Seguro/salud"], ["medico", "Seguro/salud"],
  ["mercado", "Comida/mercado"], ["comida", "Comida/mercado"], ["super", "Comida/mercado"], ["almuerzo", "Comida/mercado"],
  ["restaurante", "Salidas a comer"], ["comer fuera", "Salidas a comer"],
  ["gasolina", "Gasolina"], ["combustible", "Gasolina"],
  ["uber", "Uber/taxi"], ["taxi", "Uber/taxi"], ["cabify", "Uber/taxi"],
  ["compras casa", "Compras casa"],
  ["cancha", "Fútbol-cancha"],
  ["cerveza", "Fútbol-cervezas"], ["cervezas", "Fútbol-cervezas"], ["birra", "Fútbol-cervezas"],
  ["futbol", "Fútbol-cancha"], ["fútbol", "Fútbol-cancha"],
  ["cine", "Socialización/salidas"], ["fiesta", "Socialización/salidas"], ["social", "Socialización/salidas"],
  ["peluqueria", "Peluquería"], ["corte de pelo", "Peluquería"],
  ["ropa", "Ropa"], ["zapatos", "Ropa"],
  ["imprevisto", "Imprevistos"],
  ["sueldo", "Sueldo Bonum"], ["salario", "Sueldo Bonum"],
  ["comisiones", "Comisiones Bonum"], ["comision", "Comisiones Bonum"],
  ["freelance", "Freelance"],
  ["hotmart", "Hotmart"],
  ["aporte papas", "Aporte papás"], ["papas", "Aporte papás"], ["aporte", "Aporte papás"],
].sort((a, b) => b[0].length - a[0].length);

// ---------- Utilidades de texto ----------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(s: string): number {
  const n = normalize(s);
  return n ? n.split(" ").filter(Boolean).length : 0;
}

function fmt(n: number): string {
  return n.toLocaleString("es-EC", { style: "currency", currency: "USD" });
}

function todayInGuayaquil(): string {
  // Ecuador no tiene horario de verano; fijo en America/Guayaquil para que
  // un mensaje de madrugada UTC no se registre en el día equivocado.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
}

function extractAmount(text: string): { amount: number; isIncome: boolean; rest: string } | null {
  const match = text.match(/([+-]?)\s*\$?\s*(\d+(?:[.,]\d{1,2})?)/);
  if (!match || match.index === undefined) return null;
  const isIncome = match[1] === "+";
  const amount = parseFloat(match[2].replace(",", "."));
  if (!isFinite(amount) || amount <= 0) return null;
  const rest = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).trim();
  return { amount, isIncome, rest };
}

function matchCategory(rest: string, isIncome: boolean): string | null {
  const norm = normalize(rest);
  if (!norm) return null;
  const pool = isIncome ? INGRESO_CATEGORIES : GASTO_CATEGORIES;

  for (const cat of pool) {
    if (norm.includes(normalize(cat))) return cat;
  }
  for (const [kw, cat] of KEYWORDS) {
    if (pool.includes(cat) && norm.includes(kw)) return cat;
  }
  return null;
}

function catIndex(cat: string, isIncome: boolean): number {
  return (isIncome ? INGRESO_CATEGORIES : GASTO_CATEGORIES).indexOf(cat);
}

function catByIndex(idx: number, isIncome: boolean): string | undefined {
  return (isIncome ? INGRESO_CATEGORIES : GASTO_CATEGORIES)[idx];
}

// ---------- Telegram API ----------

// deno-lint-ignore no-explicit-any
async function tg(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error(`Telegram ${method} falló:`, await res.text());
  return res.json().catch(() => null);
}

function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  return tg("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup, parse_mode: "HTML" });
}

function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  return tg("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup, parse_mode: "HTML" });
}

function answerCallback(id: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id: id, text });
}

function categoryKeyboard(isIncome: boolean, amount: number) {
  const pool = isIncome ? INGRESO_CATEGORIES : GASTO_CATEGORIES;
  const t = isIncome ? "i" : "g";
  const rows = [];
  for (let i = 0; i < pool.length; i += 2) {
    const row = [{ text: pool[i], callback_data: `c:${t}:${i}:${amount}` }];
    if (pool[i + 1]) row.push({ text: pool[i + 1], callback_data: `c:${t}:${i + 1}:${amount}` });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function confirmKeyboard(isIncome: boolean, idx: number, amount: number) {
  const t = isIncome ? "i" : "g";
  return {
    inline_keyboard: [[
      { text: "✅ Sí", callback_data: `y:${t}:${idx}:${amount}` },
      { text: "❌ No", callback_data: `n:${t}:${amount}` },
    ]],
  };
}

// ---------- Guardado ----------

async function saveTransaction(isIncome: boolean, category: string, amount: number, note: string) {
  const { error } = await supabase.from("transactions").insert({
    id: crypto.randomUUID(),
    type: isIncome ? "ingreso" : "gasto",
    category,
    amount,
    date: todayInGuayaquil(),
    note: note || null,
  });
  return error;
}

function savedText(isIncome: boolean, amount: number, category: string) {
  return `✅ ${isIncome ? "+" : ""}${fmt(amount)} — ${category}`;
}

// ---------- Handlers ----------

// deno-lint-ignore no-explicit-any
async function handleMessage(message: any) {
  const chatId = message.chat?.id;
  if (chatId === undefined || String(chatId) !== AUTHORIZED_CHAT_ID) return; // ignora en silencio

  const text: string = (message.text || "").trim();
  if (!text) return;

  if (text === "/start" || text === "/ayuda" || text === "/help") {
    await sendMessage(
      chatId,
      "👋 Registra gastos e ingresos rápido:\n\n" +
        "• <b>20</b> → te pregunto la categoría\n" +
        "• <b>20 comida</b> → intento adivinar la categoría\n" +
        "• <b>gasté 15 en futbol</b> → te confirmo antes de guardar\n" +
        "• <b>+50</b> o <b>+50 freelance</b> → mismo patrón, pero como ingreso\n\n" +
        "No manejo fijos, deudas ni metas — solo movimientos simples del día a día."
    );
    return;
  }

  const parsed = extractAmount(text);
  if (!parsed) {
    await sendMessage(
      chatId,
      "No encontré un monto. Ejemplos: <code>20</code>, <code>20 comida</code>, <code>gasté 15 en futbol</code>, <code>+50 freelance</code>."
    );
    return;
  }

  const { amount, isIncome, rest } = parsed;

  if (!rest) {
    await sendMessage(chatId, `${isIncome ? "➕" : "💸"} ${fmt(amount)} — ¿en qué categoría?`, categoryKeyboard(isIncome, amount));
    return;
  }

  const category = matchCategory(rest, isIncome);
  if (!category) {
    await sendMessage(
      chatId,
      `${isIncome ? "➕" : "💸"} ${fmt(amount)} — no reconocí la categoría, elige una:`,
      categoryKeyboard(isIncome, amount)
    );
    return;
  }

  if (wordCount(rest) <= 2) {
    // "20 comida" / "+50 freelance": match directo, guarda de una.
    const error = await saveTransaction(isIncome, category, amount, text);
    await sendMessage(chatId, error ? `⚠️ No se pudo guardar: ${error.message}` : savedText(isIncome, amount, category));
    return;
  }

  // Frase más larga ("gasté 15 en futbol"): confirmar antes de guardar.
  const idx = catIndex(category, isIncome);
  await sendMessage(
    chatId,
    `Entendí: <b>${fmt(amount)}</b> en <b>${category}</b>. ¿Confirmas?`,
    confirmKeyboard(isIncome, idx, amount)
  );
}

// deno-lint-ignore no-explicit-any
async function handleCallback(cb: any) {
  const chatId = cb.message?.chat?.id;
  if (chatId === undefined || String(chatId) !== AUTHORIZED_CHAT_ID) {
    await answerCallback(cb.id);
    return;
  }

  const messageId = cb.message.message_id;
  const parts: string[] = (cb.data || "").split(":");
  const action = parts[0];

  if (action === "c" || action === "y") {
    const isIncome = parts[1] === "i";
    const idx = parseInt(parts[2], 10);
    const amount = parseFloat(parts[3]);
    const category = catByIndex(idx, isIncome);

    await answerCallback(cb.id, action === "y" ? "Guardado" : undefined);

    if (!category || !isFinite(amount)) {
      await editMessage(chatId, messageId, "⚠️ Algo salió mal, envía el monto de nuevo.");
      return;
    }
    const error = await saveTransaction(isIncome, category, amount, "");
    await editMessage(chatId, messageId, error ? `⚠️ No se pudo guardar: ${error.message}` : savedText(isIncome, amount, category));
    return;
  }

  if (action === "n") {
    const isIncome = parts[1] === "i";
    const amount = parseFloat(parts[2]);
    await answerCallback(cb.id);
    await editMessage(chatId, messageId, `${isIncome ? "➕" : "💸"} ${fmt(amount)} — elige la categoría:`, categoryKeyboard(isIncome, amount));
    return;
  }

  await answerCallback(cb.id);
}

// ---------- Entry point ----------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  // Solo procesa updates que traigan el secret_token configurado en
  // setWebhook — evita que cualquiera con la URL pueda invocar la función.
  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json().catch(() => null);
  if (!update) return new Response("ok", { status: 200 });

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (e) {
    console.error("Error procesando update:", e);
  }

  return new Response("ok", { status: 200 });
});
