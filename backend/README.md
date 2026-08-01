# Club Canchas — backend

Node + Express. Maneja las reservas, la preferencia de pago de Mercado Pago,
el webhook que confirma el pago solo, el envío de WhatsApp y la actualización
de la planilla en Google Sheets.

## 1. Instalar y configurar

```bash
npm install
cp .env.example .env
```

Completá `.env` con tus credenciales (ver abajo). El servidor arranca igual
sin completarlas, pero avisa por consola qué falta y esas partes quedan
desactivadas (por ejemplo, sin `WHATSAPP_TOKEN` no manda el mensaje, pero el
resto del flujo sigue andando).

```bash
npm run dev
```

Por defecto queda en `http://localhost:4000`.

## 2. Mercado Pago

1. Entrá a [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app)
   y creá una aplicación (o usá una existente).
2. Copiá el **Access Token de producción** a `MP_ACCESS_TOKEN`.
3. En la misma app, andá a **Webhooks > Configurar notificaciones**, poné como
   URL `https://TU-BACKEND-PUBLICO/api/webhooks/mercadopago`, activá el evento
   **Pagos**, y guardá. Ahí te va a mostrar una **clave secreta** — copiala a
   `MP_WEBHOOK_SECRET`.
4. `PUBLIC_BASE_URL` tiene que ser esa misma URL pública (sin el `/api/...`),
   y `FRONTEND_URL` la URL pública donde corre el front-end de React.

### Probar en local con ngrok

Mercado Pago necesita pegarle al webhook desde afuera, así que en desarrollo
hace falta exponer tu `localhost:4000` con algo como
[ngrok](https://ngrok.com/) u otro túnel:

```bash
ngrok http 4000
```

Usá la URL `https://xxxx.ngrok-free.app` que te da como `PUBLIC_BASE_URL`
mientras probás.

## 3. WhatsApp (Cloud API de Meta)

1. Creá una app de tipo "Business" en [developers.facebook.com](https://developers.facebook.com/)
   y agregále el producto **WhatsApp**.
2. De ahí sacás `WHATSAPP_TOKEN` (token de acceso) y `WHATSAPP_PHONE_NUMBER_ID`
   (el número de WhatsApp del club, ya verificado).
3. El código actual manda un mensaje de texto libre — sólo funciona si el
   cliente le escribió al número del club en las últimas 24hs. Para mandar
   confirmaciones fuera de esa ventana (el caso normal acá), hace falta crear
   y aprobar una **plantilla de mensaje** en el Administrador de WhatsApp, y
   adaptar `sendWhatsAppConfirmation` en `src/whatsapp.js` para usar
   `type: "template"` con esa plantilla en vez de `type: "text"`.

## 4. Google Sheets (la planilla de turnos)

1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com/),
   activá la **Google Sheets API**, y creá una **cuenta de servicio**.
2. Descargá su clave en formato JSON y guardala como
   `backend/service-account.json` (o la ruta que pongas en
   `GOOGLE_SERVICE_ACCOUNT_FILE`). **No la subas a git.**
3. Creá la planilla de turnos, agregale una hoja llamada `Turnos` con
   encabezados en la fila 1 (id, deporte, cancha, fecha, horario, cliente,
   teléfono, monto, id de pago, confirmado el), y compartila con el email de
   la cuenta de servicio (está dentro del JSON, campo `client_email`) con
   permiso de **Editor**. Esta planilla es privada — no la compartas
   públicamente ni con "cualquiera con el link"; sólo con esa cuenta de
   servicio y con quien vos decidas darle acceso desde Drive.
4. Copiá el ID de la planilla (la parte de la URL entre `/d/` y `/edit`) a
   `GOOGLE_SHEET_ID`.

## Sobre la "planilla" visible en la página

La página pública **no** muestra ningún listado de turnos ni datos de
clientes — eso quedaría expuesto a cualquiera que entre al sitio. La
planilla real es el Google Sheet privado del punto anterior, que sólo ve el
dueño del club (y quien él invite desde Drive).

Además, `GET /api/reservations` (que devuelve el listado completo con
nombres y teléfonos) está protegido con una clave simple — hay que mandarla
en el header `x-admin-token` con el valor de `ADMIN_TOKEN` del `.env`. Es
para que vos puedas consultarlo si alguna vez lo necesitás (por ejemplo con
`curl`), no para que lo use la página.

## Horarios que ya pasaron

Un turno de hoy cuya hora de inicio ya llegó (o quedó atrás) no se ofrece,
aunque nadie lo haya reservado — ni en `/api/availability` (aparece como
ocupado) ni en la página (directamente no se muestra). Se calcula en
`store.js` con la zona horaria del club (`America/Argentina/Buenos_Aires`
por defecto — cambiala ahí si el club está en otro huso). Además, intentar
crear un hold para un horario pasado se rechaza en `POST /api/holds` aunque
alguien le pegue directo a la API sin pasar por la página.

## Sobre el nombre del cliente vs. quién transfiere

El formulario le pide nombre y WhatsApp al cliente, pero **no se compara
ese nombre contra el titular de la cuenta de Mercado Pago que hace la
transferencia** — y es intencional. Alguien puede perfectamente pagar desde
la cuenta de un familiar o de otra persona; exigir que coincida rechazaría
reservas legítimas todo el tiempo. Lo que realmente vincula el pago con la
reserva es el `external_reference` (el id del hold), que va firmado en la
preferencia y se valida en el webhook — no el nombre. Como capa extra de
seguridad, sí se valida que el **monto** pagado coincida exactamente con el
precio de esa cancha antes de confirmar (ver `confirmPaymentForHold` en
`routes.js`).

## Dos capas de confirmación (no depende de una sola)

1. **Webhook** (`/api/webhooks/mercadopago`) — Mercado Pago le pega a esta URL
   apenas el pago cambia de estado. Es la vía principal, casi instantánea.
2. **Reconciliación automática** (`src/reconcile.js`) — cada 60 segundos,
   revisa los turnos que están "esperando pago" y le pregunta directamente a
   la API de Mercado Pago (`GET /v1/payments/search?external_reference=...`,
   con el access token de la cuenta del club) si ya hay un pago aprobado.
   Es una red de contención por si alguna notificación del webhook se pierde
   (falla de red, servidor caído un momento, etc.) — así igual se termina
   confirmando solo, sin que nadie tenga que revisar nada a mano.

También queda expuesto `POST /api/holds/:id/verify` para forzar esa misma
consulta a mano si alguna vez hace falta.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/config` | Deportes, canchas, horarios |
| GET | `/api/availability?courtId&date` | Horarios ocupados de esa cancha/fecha |
| POST | `/api/holds` | Aparta un turno 5 min (`courtId, date, hour, clientName, clientPhone`) |
| GET | `/api/holds/:id` | Estado de un hold |
| POST | `/api/holds/:id/pay` | Crea la preferencia de pago y devuelve el link de Mercado Pago |
| POST | `/api/holds/:id/verify` | Chequeo manual contra Mercado Pago (además del webhook y la reconciliación automática) |
| POST | `/api/webhooks/mercadopago` | Lo llama Mercado Pago solo — confirma el pago |
| GET | `/api/reservations` | Planilla de turnos confirmados |
| GET | `/api/reservations/:id` | Un turno confirmado puntual |

## Nota sobre el store

Las reservas y holds viven en memoria (`src/store.js`). Sirve para probar y
para un club chico, pero se pierde todo si el servidor se reinicia. Para
producción en serio, conviene cambiar `store.js` por una base de datos
(Postgres, SQLite, etc.) manteniendo las mismas funciones exportadas.
