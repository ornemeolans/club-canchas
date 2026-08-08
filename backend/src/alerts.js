// Revisa cada tanto si alguna "tanda" de turnos bloqueados en lote (por
// ejemplo: cancha de tenis 1, 18hs, todos los martes de agosto) llegó a su
// último turno — y le manda un mail al dueño para que decida si bloquea más
// fechas o libera el horario para volver a alquilarlo.

import { listSeriesNeedingAlert, markSeriesAlerted, findCourt } from "./store.js";
import { sendAdminAlert, renderBlockSeriesAlertHtml } from "./email.js";

const CHECK_EVERY_MS = 60 * 60 * 1000; // cada 1 hora alcanza — no hace falta más seguido

export async function checkSeries() {
  const pending = listSeriesNeedingAlert();
  for (const series of pending) {
    const found = findCourt(series.courtId);
    const courtName = found?.court?.name || series.courtId;
    const subject = `Club Canchas — último turno bloqueado: ${courtName}`;
    // `text` es el fallback en texto plano (clientes de mail viejos,
    // preview de notificaciones, lectores de pantalla). `html` es la
    // versión con estilo que ve la mayoría hoy en día.
    const text =
      `El bloqueo de "${series.reason || "sin motivo cargado"}" en ${courtName}, ` +
      `${String(series.hour).padStart(2, "0")}:00, llegó a su último turno bloqueado (${series.lastDate}).\n\n` +
      `Fechas que estaban bloqueadas: ${series.dates.join(", ")}.\n\n` +
      `Entrá al panel de administrador para bloquear más fechas si la actividad ` +
      `continúa, o no hagas nada si ya se puede volver a alquilar ese horario ` +
      `a partir de ahora.`;
    const adminUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/admin` : null;
    const html = renderBlockSeriesAlertHtml({
      courtName,
      reason: series.reason,
      hour: series.hour,
      lastDate: series.lastDate,
      dates: series.dates,
      adminUrl,
    });

    await sendAdminAlert(subject, text, html);
    markSeriesAlerted(series.id);
  }
  return pending.length;
}

export function startBlockSeriesAlertJob() {
  const interval = setInterval(checkSeries, CHECK_EVERY_MS);
  interval.unref();
  // Además de esperar la primera hora, revisa una vez apenas arranca el
  // servidor — por si el último turno de alguna serie ya había llegado
  // mientras el servidor estaba reiniciando.
  checkSeries();
  return interval;
}
