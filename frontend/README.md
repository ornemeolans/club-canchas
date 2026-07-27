# Club Canchas — frontend

React + Vite. Necesita el backend corriendo (ver `../backend/README.md`).

```bash
npm install
cp .env.example .env   # y poné ahí la URL del backend
npm run dev
```

Por defecto corre en `http://localhost:5173` y apunta a
`http://localhost:4000/api`.

## Cómo funciona el regreso desde Mercado Pago

Al pagar, el botón redirige de verdad a Mercado Pago (`window.location.href`).
MP después devuelve al cliente a `FRONTEND_URL/reserva/:holdId` (configurado
del lado del backend, en `back_urls`). Esta app detecta esa ruta al cargar y
se queda esperando (haciendo polling) a que el backend confirme el pago vía
el webhook — no hace falta que el cliente haga nada más.

Para que esa ruta funcione en producción con un server estático, configurá el
hosting para que sirva `index.html` en cualquier ruta que empiece con
`/reserva/` (SPA fallback) — con Vercel/Netlify es automático o una línea de
config; si lo servís vos con Express, agregá un `app.get('*', ...)` que
devuelva `dist/index.html`.
