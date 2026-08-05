// Revisa cada tanto si alguna "tanda" de turnos bloqueados en lote (por
// ejemplo: cancha de tenis 1, 18hs, todos los martes de agosto) llegó a su
// último turno — y le manda un mail al dueño para que decida si bloquea más
// fechas o libera el horario para volver a alquilarlo.

import { listSeriesNeedingAlert, markSeriesAlerted, findCourt } from "./store.js";
import { sendAdminAlert } from "./email.js";

const CHECK_EVERY_MS = 60 * 60 * 1000; // cada 1 hora alcanza — no hace falta más seguido

export async function checkSeries() {
  const pending = listSeriesNeedingAlert();
  for (const series of pending) {
    const found = findCourt(series.courtId);
    const courtName = found?.court?.name || series.courtId;
    const subject = `Club Canchas — último turno bloqueado: ${courtName}`;
    const text =
      `El bloqueo de "${series.reason || "sin motivo cargado"}" en ${courtName}, ` +
      `${String(series.hour).padStart(2, "0")}:00, llegó a su último turno bloqueado (${series.lastDate}).\n\n` +
      `Fechas que estaban bloqueadas: ${series.dates.join(", ")}.\n\n` +
      `Entrá al panel de administrador para bloquear más fechas si la actividad ` +
      `continúa, o no hagas nada si ya se puede volver a alquilar ese horario ` +
      `a partir de ahora.`;

    await sendAdminAlert(subject, text);
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
