// Actualiza la planilla de turnos en Google Sheets vía la API, usando una
// cuenta de servicio. La planilla tiene que estar compartida (permiso
// "Editor") con el email de esa cuenta de servicio.
// Doc: https://developers.google.com/sheets/api/quickstart/nodejs

import { google } from "googleapis";
import fs from "node:fs";

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!keyFile || !fs.existsSync(keyFile)) {
    console.warn("[sheets] Falta GOOGLE_SERVICE_ACCOUNT_FILE, no se actualiza la planilla.");
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile,
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
