// Alertas por mail al dueño del club, usando Resend (mails transaccionales
// por HTTPS). Se usa esto en vez de SMTP directo porque muchos hostings
// gratuitos (Render incluido, desde sept. 2025) bloquean las conexiones
// salientes por los puertos de SMTP — por HTTPS no hay ese problema.
// Plan gratis de Resend: https://resend.com (no hace falta tarjeta).

export async function sendAdminAlert(subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !to || !from) {
    console.warn("[email] Faltan RESEND_API_KEY / EMAIL_TO / EMAIL_FROM, no se manda el mail.");
    return { skipped: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[email] Error mandando el mail:", data);
      return { error: data };
    }
    return { sent: true };
  } catch (err) {
    console.error("[email] Error mandando el mail:", err.message);
    return { error: err.message };
  }
}
