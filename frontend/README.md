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

Esa ruta (`/reserva/:id`) no es un archivo real, así que necesita que el
hosting sepa redirigir cualquier ruta a `index.html` y dejar que React se
encargue (fallback de SPA). Ya está resuelto acá con `public/_redirects`
(`/* /index.html 200`), que Vite copia automáticamente a `dist/` en cada
build — con Netlify no hace falta configurar nada más. Si en algún momento
cambiás a otro hosting, fijate cómo se configura ese mismo fallback ahí
(en Vercel es automático; si lo servís vos con Express, un
`app.get('*', ...)` que devuelva `dist/index.html`).
