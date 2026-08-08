// Alertas por mail al dueño del club, usando Resend (mails transaccionales
// por HTTPS). Se usa esto en vez de SMTP directo porque muchos hostings
// gratuitos (Render incluido, desde sept. 2025) bloquean las conexiones
// salientes por los puertos de SMTP — por HTTPS no hay ese problema.
// Plan gratis de Resend: https://resend.com (no hace falta tarjeta).

export async function sendAdminAlert(subject, text, html) {
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
      // `text` siempre va (fallback para lectores de pantalla, previews,
      // y clientes de mail viejos que no rendericen HTML). `html`, si se
      // pasa, es lo que se ve en Gmail/Outlook/etc modernos.
      body: JSON.stringify({ from, to, subject, text, ...(html ? { html } : {}) }),
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

// Escapa texto que va insertado dentro de HTML (nombres de cancha, motivos
// de bloqueo, etc. los carga el admin a mano — nunca hay que confiar en que
// no tengan "<" o "&" sueltos).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Arma el HTML del mail de "último turno bloqueado" con la estética del
// sitio (verde cancha + acento amarillo). Todo con estilos inline y tablas
// a propósito — es lo único que anda bien consistente entre Gmail, Outlook
// y el resto de los clientes de mail, que ignoran <style> en el <head> o
// CSS moderno (flexbox, grid, variables).
export function renderBlockSeriesAlertHtml({ courtName, reason, hour, lastDate, dates, adminUrl }) {
  const hourLabel = `${String(hour).padStart(2, "0")}:00`;
  const datesList = dates
    .map(
      (d) =>
        `<li style="margin:0 0 4px;color:#3A4A3E;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${escapeHtml(d)}</li>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="es">
  <body style="margin:0;padding:0;background:#E9ECE3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9ECE3;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #DADFD2;">

            <!-- Header -->
            <tr>
              <td style="background:#122A20;padding:24px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-family:Arial,Helvetica,sans-serif;color:#F3EFE2;font-size:13px;letter-spacing:1px;text-transform:uppercase;">
                      Club Canchas
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-top:6px;font-family:Arial,Helvetica,sans-serif;color:#FFFFFF;font-size:20px;font-weight:bold;">
                      ⚠️ Último turno bloqueado
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#20301F;">
                  El bloqueo de <strong>${escapeHtml(reason || "sin motivo cargado")}</strong> llegó al
                  último turno que tenías reservado en la agenda. Si la actividad sigue, hay que bloquear
                  más fechas — si no hacés nada, el horario queda libre para alquilar de nuevo.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6EF;border-radius:8px;border:1px solid #DADFD2;margin-bottom:20px;">
                  <tr>
                    <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3A4A3E;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:4px 0;color:#7A8577;width:110px;">Cancha</td>
                          <td style="padding:4px 0;font-weight:bold;color:#20301F;">${escapeHtml(courtName)}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 0;color:#7A8577;">Horario</td>
                          <td style="padding:4px 0;font-weight:bold;color:#20301F;">${escapeHtml(hourLabel)}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 0;color:#7A8577;">Último bloqueo</td>
                          <td style="padding:4px 0;font-weight:bold;color:#20301F;">${escapeHtml(lastDate)}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#7A8577;text-transform:uppercase;letter-spacing:0.5px;">
                  Fechas que estaban bloqueadas (${dates.length})
                </p>
                <ul style="margin:0 0 24px;padding-left:18px;">
                  ${datesList}
                </ul>

                ${
                  adminUrl
                    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#F4C24C;">
                        <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#122A20;text-decoration:none;border-radius:8px;">
                          Ir al panel de administrador
                        </a>
                      </td></tr></table>`
                    : ""
                }
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 28px;background:#F4F6EF;border-top:1px solid #DADFD2;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7A8577;">
                  Aviso automático de Club Canchas — no hace falta responder este mail.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}
