// Actualiza la planilla de turnos en Google Sheets vía la API, usando una
// cuenta de servicio. La planilla tiene que estar compartida (permiso
// "Editor") con el email de esa cuenta de servicio.
// Doc: https://developers.google.com/sheets/api/quickstart/nodejs

import { google } from "googleapis";
import fs from "node:fs";

let sheetsClient = null;

function loadCredentials() {
  // Opción A: el JSON completo de la cuenta de servicio pegado directo en
  // una variable de entorno (más cómodo en hostings como Render, que no
  // tienen "subir un archivo" a mano — sólo variables de entorno, o su
  // función de "Secret Files" si preferís ese camino).
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON no es JSON válido.");
      return null;
    }
  }

  // Opción B: ruta a un archivo (para correr en tu compu, o si usás
  // "Secret Files" de Render con el JSON de la cuenta de servicio).
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (keyFile && fs.existsSync(keyFile)) {
    return JSON.parse(fs.readFileSync(keyFile, "utf8"));
  }

  return null;
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = loadCredentials();
  if (!credentials) {
    console.warn(
      "[sheets] Falta GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SERVICE_ACCOUNT_FILE, no se actualiza la planilla."
    );
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export async function appendReservationRow(reservation) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = await getSheetsClient();
  if (!sheets || !sheetId) return { skipped: true };

  const row = [
    reservation.id,
    reservation.sportLabel,
    reservation.courtName,
    reservation.date,
    `${String(reservation.hour).padStart(2, "0")}:00`,
    reservation.clientName || "",
    reservation.clientPhone || "",
    reservation.amount,
    reservation.paymentId,
    reservation.confirmedAt,
  ];

  return sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Turnos!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}
