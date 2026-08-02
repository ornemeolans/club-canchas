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
2. En "Personalizar caso de uso" → "Paso 1. Pruébala" tenés un número de
   prueba gratis, con su **token de acceso temporal** (`WHATSAPP_TOKEN`,
   dura 24hs) y su **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`). Ahí
   mismo agregás tu celular como "destinatario de prueba" para poder recibir
   mensajes durante las pruebas.
3. **Números argentinos**: no des por sentado si hace falta o no el `9`
   extra después del `54` — depende de cómo esté registrado ese número en
   WhatsApp, y varía. Lo importante es que el número que pruebes en el
   formulario del sitio sea **exactamente igual** (mismo formato, mismos
   dígitos) al que aparece verificado como "destinatario de prueba" en el
   panel de Meta — cualquier diferencia hace que rebote con el error
   `(#131030) Recipient phone number not in allowed list`.
4. Con `WHATSAPP_TEMPLATE_NAME` vacío, el código manda **texto libre** — que
   sólo entrega si el cliente le escribió al número del club en las últimas
   24hs. Para el caso real (avisarle a alguien que nunca te escribió antes),
   Meta exige una **plantilla aprobada**. Para crear una:
   - En el mismo panel de WhatsApp de tu app, andá a **Administrador de
     WhatsApp → Plantillas de mensajes → Crear plantilla**.
   - Categoría: **Utilidad** (utility) — es la que corresponde a
     confirmaciones de una compra/reserva, no "Marketing".
   - Cuerpo del mensaje sugerido (con 3 variables, en ese orden):
     ```
     ¡Turno confirmado! 🎾⚽
     {{1}}, {{2}} a las {{3}}.
     Pago acreditado por Mercado Pago. Te esperamos 10 min antes.
     ```
     El código manda esas variables en este orden: cancha, fecha, horario.
   - Metá el nombre que le pusiste a la plantilla en `WHATSAPP_TEMPLATE_NAME`
     (y el idioma con el que la aprobaste en `WHATSAPP_TEMPLATE_LANG`, por
     defecto `es_AR`).
   - Opcional: agregale un botón "Ir al sitio web" con URL **dinámica**,
     base `https://TU-FRONT/reserva/` — así el mensaje incluye un botón para
     volver a la pantalla de confirmación de esa reserva (que ya tiene el
     link de Google Calendar y el de descargar `.ics`). El código ya manda
     el id de la reserva como el valor de esa parte variable del botón.
   - La aprobación de Meta suele tardar minutos a un par de horas. Hasta que
     esté aprobada, dejá `WHATSAPP_TEMPLATE_NAME` vacío y probá con tu
     propio número dentro de la ventana de 24hs (mandándole primero un
     mensaje vos al número de prueba desde tu WhatsApp).

## 4. Google Sheets (la planilla de turnos)

1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com/),
   activá la **Google Sheets API**, y creá una **cuenta de servicio**.
2. Descargá su clave en formato JSON. **No la subas a git.**
3. Abrí ese archivo JSON con un editor de texto, copiá **todo** el
   contenido, y pegalo como valor de la variable `GOOGLE_SERVICE_ACCOUNT_JSON`
   en Render (Environment → Add Environment Variable) — tiene que quedar en
   una sola variable, con el JSON completo adentro. Es más simple que subir
   un archivo, que en Render no es tan directo (existe su función "Secret
   Files" si preferís ese camino en vez de la variable de entorno).
4. Creá la planilla de turnos, agregale una hoja llamada `Turnos` con
   encabezados en la fila 1 (id, deporte, cancha, fecha, horario, cliente,
   teléfono, monto, id de pago, confirmado el), y compartila con el email de
   la cuenta de servicio (está dentro del JSON, campo `client_email`) con
   permiso de **Editor**. Esta planilla es privada — no la compartas
   públicamente ni con "cualquiera con el link"; sólo con esa cuenta de
   servicio y con quien vos decidas darle acceso desde Drive.
5. Copiá el ID de la planilla (la parte de la URL entre `/d/` y `/edit`) a
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
| GET | `/api/admin/schedule?date` | Calendario completo (todas las canchas) para el panel de admin |
| POST | `/api/admin/blocks` | Bloquea un turno puntual (`courtId, date, hour, reason`) |
| DELETE | `/api/admin/blocks/:id` | Saca un bloqueo |
| POST | `/api/admin/blocks/bulk` | Bloquea muchos turnos de una (`courtId, hour, dates[], reason`) |

Las rutas bajo `/admin` piden `ADMIN_TOKEN` en el header `x-admin-token`, igual
que `/api/reservations`.

## Panel de administrador

En `frontend`, la ruta `/admin` (ej. `https://tu-sitio.netlify.app/admin`) es
un calendario visual de las 4 canchas, protegido por la misma `ADMIN_TOKEN`.
Desde ahí se puede:

- Tocar un horario disponible para bloquearlo (clases, mantenimiento) o uno
  bloqueado para liberarlo.
- **Bloquear varios turnos de una vez**: mismo horario y cancha, en un rango
  de fechas, opcionalmente repitiendo sólo ciertos días de la semana (por
  ejemplo, "todos los martes de agosto"). Internamente queda guardado como
  una "serie" (`createBlockSeries` en `store.js`).

### Alerta por mail al llegar al último turno bloqueado

Cuando la fecha del **último** turno de una de esas series llega (o ya
pasó), un job que corre cada una hora (`src/alerts.js`) manda un mail al
dueño del club avisando — para que decida si carga más fechas (la clase
sigue) o no hace nada y el horario queda libre para alquilar de nuevo
automáticamente. Necesita las variables `EMAIL_*` del `.env` (cualquier
servidor SMTP sirve, ver `.env.example` para un ejemplo con Gmail). Sin esas
variables cargadas, el resto del sistema sigue funcionando igual — sólo no
se manda el mail (se avisa por log).

## Nota sobre el store

Las reservas y holds viven en memoria (`src/store.js`). Sirve para probar y
para un club chico, pero se pierde todo si el servidor se reinicia. Para
producción en serio, conviene cambiar `store.js` por una base de datos
(Postgres, SQLite, etc.) manteniendo las mismas funciones exportadas.
