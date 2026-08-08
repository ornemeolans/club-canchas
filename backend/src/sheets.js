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

// Trae la planilla tal cual está en Google Sheets, para mostrarla dentro
// del panel de admin (misma cuenta de servicio y mismo scope que ya se
// usa para escribir, así que no hace falta nada nuevo del lado de Google).
// Devuelve { header, rows } — `header` es la primera fila (encabezados),
// `rows` el resto. Si falta la config, { skipped: true } (mismo criterio
// que appendReservationRow) para que la ruta lo distinga de un error real.
export async function readSheetRows() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheets = await getSheetsClient();
  if (!sheets || !sheetId) return { skipped: true };

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Turnos!A:J",
  });
  const values = res.data.values || [];
  const [header, ...rows] = values;
  return { header: header || [], rows };
}

// URL para abrir la planilla real en Google Sheets (para editar algo que el
// panel no cubre). No hace falta llamada a la API para esto, es sólo la URL
// estándar de Sheets con el ID.
export function sheetUrl() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : null;
}
