import { Router } from "express";
import {
  SPORTS,
  findCourt,
  getTakenHours,
  createHold,
  getHold,
  attachPreference,
  findHoldByPreference,
  confirmHold,
  listReservations,
  getReservation,
  cancelReservation,
  updateReservation,
  getCourtSchedule,
  createBlock,
  removeBlock,
  createBlockSeries,
} from "./store.js";
import { createPaymentPreference, getPayment, searchApprovedPaymentByReference, isValidWebhookSignature } from "./mercadopago.js";
import { sendWhatsAppConfirmation, sendWhatsAppCancellation, sendWhatsAppModification } from "./whatsapp.js";
import { appendReservationRow, readSheetRows, sheetUrl } from "./sheets.js";
import { checkSeries } from "./alerts.js";

// Confirma una reserva a partir de un pago aprobado, y dispara todo lo que
// tiene que pasar solo: marcar el turno, mandar WhatsApp, actualizar la
// planilla. La usan tanto el webhook como el job de reconciliación.
//
// Ojo con lo que SÍ y lo que NO se valida acá: no se compara el nombre que
// puso el cliente en el formulario contra el nombre del titular de la
// cuenta que pagó — esa comparación no es confiable (alguien puede pagar
// desde la cuenta de un familiar, por ejemplo) y no es lo que usa Mercado
// Pago para identificar el pago. Lo que sí se valida es que el pago esté
// `approved` y que el monto coincida con el precio de esa cancha — el
// enlace con la reserva ya lo garantiza el `external_reference` (el id del
// hold), que viene firmado y validado en el webhook.
export async function confirmPaymentForHold(hold, payment) {
  if (payment.status !== "approved") return null;

  const found = findCourt(hold.courtId);
  const expectedAmount = found?.sport?.price;
  if (expectedAmount != null && payment.transaction_amount !== expectedAmount) {
    console.warn(
      `[confirm] Monto no coincide para el hold ${hold.id}: esperado ${expectedAmount}, pagado ${payment.transaction_amount}. No se confirma.`
    );
    return null;
  }

  const reservation = confirmHold(hold.id, payment.id);
  if (!reservation) return null;
  await Promise.allSettled([
    sendWhatsAppConfirmation(reservation),
    appendReservationRow(reservation),
  ]);
  return reservation;
}

const router = Router();

// Todo lo de /admin es para uso interno del club, no para la página
// pública — pide la clave simple (ADMIN_TOKEN) en el header.
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

// Config de deportes/canchas/horarios para que el front no la tenga hardcodeada.
router.get("/config", (_req, res) => {
  res.json({
    sports: SPORTS,
    hours: Array.from({ length: 13 }, (_, i) => 9 + i),
    holdMinutes: 5,
  });
});

// Horarios ocupados (holds activos + turnos confirmados) para una cancha/fecha.
router.get("/availability", (req, res) => {
  const { courtId, date } = req.query;
  if (!courtId || !date) return res.status(400).json({ error: "Falta courtId o date" });
  if (!findCourt(courtId)) return res.status(404).json({ error: "Cancha inexistente" });
  res.json({ takenHours: getTakenHours(courtId, date) });
});

// Aparta el turno por 5 minutos.
router.post("/holds", (req, res) => {
  const { courtId, date, hour, clientName, clientPhone } = req.body || {};
  if (!courtId || !date || hour == null || !clientName || !clientPhone) {
    return res.status(400).json({ error: "Faltan datos (courtId, date, hour, clientName, clientPhone)" });
  }
  if (!findCourt(courtId)) return res.status(404).json({ error: "Cancha inexistente" });

  const hold = createHold({ courtId, date, hour, clientName, clientPhone });
  if (!hold) return res.status(409).json({ error: "Ese horario ya no está disponible" });
  if (hold.error === "past") {
    return res.status(409).json({ error: "Ese horario ya pasó" });
  }

  res.status(201).json({ hold });
});

// Consultar el estado de un hold / reserva (para que el front haga polling
// mientras espera la confirmación del webhook).
router.get("/holds/:id", (req, res) => {
  const hold = getHold(req.params.id);
  if (!hold) return res.status(404).json({ error: "No encontrado (puede haber expirado o ya estar confirmado)" });
  res.json({ hold });
});

// Genera la preferencia de pago en Mercado Pago y devuelve el link de checkout.
router.post("/holds/:id/pay", async (req, res) => {
  const hold = getHold(req.params.id);
  if (!hold) return res.status(404).json({ error: "El turno ya no está apartado (expiró)" });

  const found = findCourt(hold.courtId);
  if (!found) return res.status(404).json({ error: "Cancha inexistente" });
  const { court, sport } = found;

  try {
    const preference = await createPaymentPreference(hold, {
      courtName: court.name,
      sportLabel: sport.label,
      price: sport.price,
    });
    attachPreference(hold.id, preference.id);
    res.json({ initPoint: preference.init_point, preferenceId: preference.id });
  } catch (err) {
    console.error("[mercadopago] Error creando preferencia:", err);
    res.status(502).json({ error: "No se pudo iniciar el pago con Mercado Pago" });
  }
});

// Webhook de Mercado Pago. Confirma el pago sin intervención humana.
router.post("/webhooks/mercadopago", async (req, res) => {
  const dataId = req.query["data.id"] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;

  // Responder rápido igual: MP espera 200/201 en <=22s, y reintenta si no.
  res.sendStatus(200);

  if (type !== "payment" || !dataId) return;

  const valid = isValidWebhookSignature({
    xSignature: req.headers["x-signature"],
    xRequestId: req.headers["x-request-id"],
    dataId,
  });
  if (!valid) {
    console.warn("[webhook] Firma inválida, se ignora la notificación.");
    return;
  }

  try {
    const payment = await getPayment(dataId);
    if (payment.status !== "approved") return;

    const hold =
      getHold(payment.external_reference) ||
      // fallback por si external_reference no vino: buscar por preferencia
      findHoldByPreference(payment.order?.id);
    if (!hold) {
      console.warn(`[webhook] Pago ${dataId} aprobado pero no encontré el hold correspondiente.`);
      return;
    }

    const reservation = await confirmPaymentForHold(hold, payment);
    if (!reservation) return;
  } catch (err) {
    console.error("[webhook] Error procesando la notificación:", err);
  }
});

// Verificación manual contra Mercado Pago (además del webhook automático):
// busca en la cuenta del access token si esta reserva ya tiene un pago
// aprobado, por si la notificación automática no llegó todavía.
router.post("/holds/:id/verify", async (req, res) => {
  const hold = getHold(req.params.id);
  if (!hold) return res.status(404).json({ error: "No encontrado" });

  try {
    const payment = await searchApprovedPaymentByReference(hold.id);
    if (!payment) return res.json({ confirmed: false });

    const reservation = await confirmPaymentForHold(hold, payment);
    res.json({ confirmed: !!reservation, reservation });
  } catch (err) {
    console.error("[verify] Error consultando Mercado Pago:", err);
    res.status(502).json({ error: "No se pudo consultar Mercado Pago" });
  }
});

// Planilla de turnos confirmados. Esto es para uso interno del club, no
// para la página pública — por eso pide una clave simple en el header.
// (La "planilla" de verdad, para el día a día, es el Google Sheet privado.)
router.get("/reservations", requireAdmin, (_req, res) => {
  res.json({ reservations: listReservations() });
});

// La planilla de Google Sheets, para mostrarla dentro del panel de admin
// (sólo lectura acá — para editar algo puntual que el panel no cubre, se
// usa la URL de `sheetUrl`, que también viaja en la respuesta).
router.get("/admin/sheet", requireAdmin, async (_req, res) => {
  try {
    const result = await readSheetRows();
    if (result.skipped) {
      return res
        .status(503)
        .json({ error: "La planilla no está configurada (falta GOOGLE_SHEET_ID o la cuenta de servicio)." });
    }
    res.json({ header: result.header, rows: result.rows, sheetUrl: sheetUrl() });
  } catch (err) {
    console.error("[sheets] Error leyendo la planilla:", err);
    res.status(502).json({ error: "No se pudo leer la planilla de Google Sheets." });
  }
});

// Una reserva confirmada puntual (usado por el front al volver del checkout).
router.get("/reservations/:id", (req, res) => {
  const reservation = getReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: "No encontrada" });
  res.json({ reservation });
});

// Baja de una reserva confirmada, a pedido del cliente. Libera el horario
// y le avisa por WhatsApp. La notificación se manda después de responder
// (no bloquea al admin esperando a que WhatsApp conteste), pero si falla
// queda logueada en el server.
router.delete("/admin/reservations/:id", requireAdmin, (req, res) => {
  const reservation = getReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: "No encontrada" });

  const removed = cancelReservation(req.params.id);
  if (!removed) return res.status(404).json({ error: "No encontrada" });

  res.status(204).end();

  sendWhatsAppCancellation(removed, { reason: req.body?.reason }).catch((err) =>
    console.error(`[whatsapp] Error avisando cancelación de ${removed.id}:`, err)
  );
});

// Modifica cancha/fecha/hora de una reserva confirmada, a pedido del
// cliente. Le avisa por WhatsApp con el horario anterior y el nuevo.
router.patch("/admin/reservations/:id", requireAdmin, (req, res) => {
  const { courtId, date, hour } = req.body || {};
  if (!courtId && !date && hour == null) {
    return res.status(400).json({ error: "Nada para modificar (courtId, date, hour)" });
  }

  const result = updateReservation(req.params.id, { courtId, date, hour });
  if (result.error === "not_found") return res.status(404).json({ error: "No encontrada" });
  if (result.error === "invalid_court") return res.status(404).json({ error: "Cancha inexistente" });
  if (result.error === "past") {
    return res.status(409).json({ error: "Ese horario ya pasó o falta menos de 15 minutos" });
  }
  if (result.error === "taken") return res.status(409).json({ error: "Ese horario ya está ocupado" });

  res.json({ reservation: result.reservation });

  sendWhatsAppModification(result.reservation, result.previous).catch((err) =>
    console.error(`[whatsapp] Error avisando modificación de ${result.reservation.id}:`, err)
  );
});

// Vista de calendario para el administrador: todas las canchas de un
// deporte, con el estado de cada horario para una fecha (disponible,
// reservado, bloqueado, en curso de pago, o ya pasado).
router.get("/admin/schedule", requireAdmin, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "Falta date" });

  const courts = Object.values(SPORTS).flatMap((sport) =>
    sport.courts.map((court) => ({
      courtId: court.id,
      courtName: court.name,
      sportLabel: sport.label,
      hours: getCourtSchedule(court.id, date),
    }))
  );
  res.json({ date, courts });
});

// Bloquear un horario a mano (clases, mantenimiento, etc.) para que no
// aparezca disponible, sin que haya una reserva real detrás.
router.post("/admin/blocks", requireAdmin, (req, res) => {
  const { courtId, date, hour, reason } = req.body || {};
  if (!courtId || !date || hour == null) {
    return res.status(400).json({ error: "Faltan datos (courtId, date, hour)" });
  }
  if (!findCourt(courtId)) return res.status(404).json({ error: "Cancha inexistente" });

  const block = createBlock({ courtId, date, hour, reason });
  if (!block) return res.status(409).json({ error: "Ese horario ya no está disponible para bloquear" });
  res.status(201).json({ block });
});

// Bloquear muchos turnos de una sola vez (ej. una clase semanal durante
// varios meses): mismo horario y cancha, en una lista de fechas. Queda
// registrado como una "serie" — cuando llegue el último día de esa lista,
// se manda un mail solo avisando que hay que decidir si se sigue
// bloqueando o se libera el horario.
router.post("/admin/blocks/bulk", requireAdmin, (req, res) => {
  const { courtId, hour, dates, reason } = req.body || {};
  if (!courtId || hour == null || !Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ error: "Faltan datos (courtId, hour, dates[])" });
  }
  if (!findCourt(courtId)) return res.status(404).json({ error: "Cancha inexistente" });

  const { series, created, skipped } = createBlockSeries({ courtId, hour, dates, reason });
  res.status(201).json({
    series,
    createdCount: created.length,
    skippedDates: skipped, // fechas que ya estaban ocupadas y no se pudieron bloquear
  });

  // Si el último turno de esta tanda ya es hoy (por ejemplo, un bloqueo de
  // un solo día), no hace falta esperar el próximo ciclo de 1 hora — se
  // revisa ya mismo. No bloquea la respuesta al admin.
  checkSeries().catch((err) => console.error("[alerts] Error en el chequeo inmediato:", err.message));
});

// Sacar un bloqueo (volver a habilitar ese horario para reservar).
router.delete("/admin/blocks/:id", requireAdmin, (req, res) => {
  const removed = removeBlock(req.params.id);
  if (!removed) return res.status(404).json({ error: "Bloqueo no encontrado" });
  res.status(204).end();
});

export default router;
