import { Router } from "express";
import { SPORTS, findCourt, getTakenHours, createHold, getHold, attachPreference, findHoldByPreference, confirmHold, listReservations, getReservation } from "./store.js";
import { createPaymentPreference, getPayment, searchApprovedPaymentByReference, isValidWebhookSignature } from "./mercadopago.js";
import { sendWhatsAppConfirmation } from "./whatsapp.js";
import { appendReservationRow } from "./sheets.js";

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
router.get("/reservations", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  res.json({ reservations: listReservations() });
});

// Una reserva confirmada puntual (usado por el front al volver del checkout).
router.get("/reservations/:id", (req, res) => {
  const reservation = getReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: "No encontrada" });
  res.json({ reservation });
});

export default router;
