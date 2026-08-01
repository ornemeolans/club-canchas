// Red de contención: además del webhook (que confirma al instante), este
// job revisa cada un rato los turnos que están "esperando pago" y le
// pregunta directamente a Mercado Pago (accediendo con el access token de la
// cuenta del club) si ya hay un pago aprobado para cada uno. Cubre el caso
// de que una notificación de webhook se pierda por algún problema de red.

import { listPayingHolds } from "./store.js";
import { searchApprovedPaymentByReference } from "./mercadopago.js";
import { confirmPaymentForHold } from "./routes.js";

const CHECK_EVERY_MS = 60_000;

export function startReconciliationJob() {
  const interval = setInterval(async () => {
    const pending = listPayingHolds();
    for (const hold of pending) {
      try {
        const payment = await searchApprovedPaymentByReference(hold.id);
        if (payment) {
          console.log(`[reconcile] Encontré un pago aprobado para el hold ${hold.id} que el webhook no había confirmado todavía.`);
          await confirmPaymentForHold(hold, payment);
        }
      } catch (err) {
        console.error(`[reconcile] Error revisando el hold ${hold.id}:`, err.message);
      }
    }
  }, CHECK_EVERY_MS);
  interval.unref();
  return interval;
}
