import "dotenv/config";
import express from "express";
import cors from "cors";
import routes from "./routes.js";
import { startReconciliationJob } from "./reconcile.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", routes);

app.get("/", (_req, res) => {
  res.send("Club Canchas backend OK");
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Backend escuchando en http://localhost:${port}`);
  startReconciliationJob();
  console.log("Job de reconciliación con Mercado Pago activo (cada 60s).");
  if (!process.env.MP_ACCESS_TOKEN) {
    console.warn("⚠️  Falta MP_ACCESS_TOKEN en .env — el pago no va a funcionar.");
  }
  if (!process.env.PUBLIC_BASE_URL?.startsWith("https://")) {
    console.warn(
      "⚠️  PUBLIC_BASE_URL no parece una URL https pública — Mercado Pago " +
        "no va a poder pegarle al webhook. Ver README (ngrok/deploy)."
    );
  }
});
