import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// El panel de admin se separa en su propio archivo JS, para que los
// clientes que sólo van a reservar no lo descarguen — se pide recién si
// alguien entra a /admin.
const Admin = lazy(() => import("./Admin.jsx"));

const isAdmin = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isAdmin ? (
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
