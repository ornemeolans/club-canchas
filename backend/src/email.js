// Alertas por mail al dueño del club, usando cualquier servidor SMTP
// (Gmail, un proveedor transaccional, lo que ya tenga el club).
// No hace falta ningún servicio nuevo — sólo credenciales SMTP en el .env.

import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    console.warn("[email] Faltan EMAIL_HOST / EMAIL_USER / EMAIL_PASS, no se manda el mail.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: Number(EMAIL_PORT) || 587,
    secure: Number(EMAIL_PORT) === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  return transporter;
}

export async function sendAdminAlert(subject, text) {
  const to = process.env.EMAIL_TO;
  if (!to) {
    console.warn("[email] Falta EMAIL_TO, no se manda el mail.");
    return { skipped: true };
  }

  const t = getTransporter();
  if (!t) return { skipped: true };

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (err) {
    console.error("[email] Error mandando el mail:", err.message);
    return { error: err.message };
  }
}
