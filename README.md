# Club Canchas — reservas con confirmación automática por Mercado Pago

Fútbol (2 canchas) y tenis (2 canchas), turnos de 1h entre 9:00 y 22:00.
El cliente aparta un horario por 5 minutos, paga con Mercado Pago, y el
turno se confirma solo — sin que nadie tenga que revisar nada a mano — vía
el webhook de pagos de MP. Al confirmarse: WhatsApp automático, link para
sumarlo a Google Calendar, y la planilla de turnos (Google Sheets) se
actualiza sola.

## Estructura

- `backend/` — Express. Preferencias de pago, webhook de MP, WhatsApp,
  Google Sheets. Ver `backend/README.md` para las credenciales que hacen
  falta cargar.
- `frontend/` — React + Vite. La app que ve el cliente. Ver
  `frontend/README.md`.

## Para arrancar en local

```bash
# Terminal 1
cd backend
npm install
cp .env.example .env   # completar credenciales
npm run dev

# Terminal 2
cd frontend
npm install
cp .env.example .env
npm run dev

# Terminal 3 (sólo para probar el webhook en local)
ngrok http 4000
# y poner esa URL de ngrok como PUBLIC_BASE_URL en backend/.env
```

Con eso, entrando a `http://localhost:5173` ya se puede reservar y pagar de
punta a punta usando una cuenta de prueba de Mercado Pago.

## Qué falta para que esté 100% funcionando

El código ya implementa todo el flujo. Lo único que depende de vos:

1. Cargar las credenciales reales en `backend/.env` (Mercado Pago, WhatsApp,
   Google Sheets) — están todas explicadas en `backend/README.md`.
2. Deployar el backend en algún lado con HTTPS (Render, Railway, un VPS,
   etc.) para que Mercado Pago le pueda pegar al webhook.
3. Deployar el frontend (Vercel, Netlify, etc.) apuntando `VITE_API_URL` al
   backend ya deployado.
4. Aprobar una plantilla de WhatsApp en Meta si vas a confirmar turnos fuera
   de una conversación reciente con el cliente (el caso normal).

No pude probar contra las APIs reales de Mercado Pago/WhatsApp/Google desde
acá porque no tengo tus credenciales ni salida de red a esos dominios — sí
verifiqué que el backend levanta, que el front compila, y que el flujo de
holds/disponibilidad funciona de punta a punta con datos de prueba.
