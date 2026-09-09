# Desplegar el bot de Telegram

Código ya listo en este repo:
- `supabase/functions/telegram-bot/index.ts` — la función
- `supabase/config.toml` — desactiva la verificación de JWT de Supabase para esta función (Telegram no manda uno; la seguridad real la hace la función comparando un secret_token propio)

Todo lo de abajo lo corres **tú**, en tu propia terminal. Yo no tengo acceso a tu cuenta de Supabase ni a tu contraseña de base de datos.

## 0. Dato importante: la service_role key no la tocas

Supabase inyecta automáticamente 4 variables reservadas en **toda** función desplegada: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`. El código ya las lee con `Deno.env.get(...)`. No hay ningún paso donde la copies, la pegues, ni me la muestres a mí.

(Si algún día ves en los logs de la función un error de `SUPABASE_SERVICE_ROLE_KEY is undefined`, avísame — sería una excepción, no lo normal — y te doy el comando puntual para configurarla a mano.)

## 1. Instalar el CLI de Supabase (si no lo tienes)

```powershell
# Opción A — con Scoop
scoop install supabase

# Opción B — con npm
npm install -g supabase
```

Verifica: `supabase --version`

## 2. Iniciar sesión

```powershell
supabase login
```

Abre el navegador y entras con tu cuenta de Supabase.

## 3. Vincular el proyecto

```powershell
cd C:\Users\juanc\ProspeccionBonum\finanzas-personales
supabase link --project-ref zyjqojchnhlpfakmnqnf
```

Te va a pedir la contraseña de la base de datos (la que pusiste al crear el proyecto). Solo la usa el CLI en tu máquina.

## 4. Configurar los 3 secrets que sí hacen falta

```powershell
supabase secrets set `
  TELEGRAM_BOT_TOKEN=8709456166:AAHXLMTpTFLMl2GH-jnN4QcyH1stq7oEESY `
  TELEGRAM_WEBHOOK_SECRET=ae090bf827bd66fc0ae47d4f38334cb5fbe392dd1e999d69 `
  AUTHORIZED_CHAT_ID=1104713557
```

(El token del bot y el chat ID son los que me diste; el `TELEGRAM_WEBHOOK_SECRET` lo generé yo al azar — es solo para que la función pueda verificar que el POST viene realmente de Telegram y no de cualquiera que adivine la URL.)

## 5. Desplegar

```powershell
supabase functions deploy telegram-bot
```

Te va a devolver la URL de la función, algo como:

```
https://zyjqojchnhlpfakmnqnf.supabase.co/functions/v1/telegram-bot
```

## 6. Registrar el webhook en Telegram

Esto lo corres tú (usa tu bot token, no toca Supabase):

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot8709456166:AAHXLMTpTFLMl2GH-jnN4QcyH1stq7oEESY/setWebhook" -Body @{
  url = "https://zyjqojchnhlpfakmnqnf.supabase.co/functions/v1/telegram-bot"
  secret_token = "ae090bf827bd66fc0ae47d4f38334cb5fbe392dd1e999d69"
}
```

Debería responder `ok: True`, `description: Webhook was set`.

Si prefieres que lo registre yo (solo necesito el token del bot, que ya tengo, y no toca tu cuenta de Supabase), dime y lo hago — pero por defecto no lo hago sin que me confirmes, ya que es una configuración persistente.

## 7. Probar

Desde el chat de Telegram autorizado (1104713557), manda:

```
/start
```

Deberías recibir el mensaje de bienvenida. Luego prueba, por ejemplo:

```
20 comida
```

y revisa la tabla `transactions` en el dashboard de Supabase — debería aparecer la fila con `type: gasto`, `category: Comida/mercado`, `amount: 20`.

## 8. Verificar el webhook (opcional)

```powershell
Invoke-RestMethod "https://api.telegram.org/bot8709456166:AAHXLMTpTFLMl2GH-jnN4QcyH1stq7oEESY/getWebhookInfo"
```

## Si algo falla

```powershell
supabase functions logs telegram-bot
```

o en el dashboard: Edge Functions → telegram-bot → Logs.
