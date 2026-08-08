// Envío de la confirmación por WhatsApp usando la Cloud API de Meta.
// Requiere una cuenta de WhatsApp Business y un número verificado.
// Doc: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_VERSION = "v20.0";

function digitsOnly(phone) {
  return String(phone).replace(/\D/g, "");
}

// Ojo: en algún momento este archivo insertaba automáticamente un "9" extra
// para números argentinos — se sacó porque terminaba armando un número
// distinto al que realmente estaba verificado como destinatario de prueba
// en Meta (ver historial). Lo único que se completa acá es el código de
// país si falta directamente: si el cliente escribe el número local, sin
// "54" adelante (10 dígitos: código de área + número, formato típico
// argentino), se lo agregamos. Si ya viene con código de país, o tiene otra
// cantidad de dígitos, se manda tal cual lo escribió — así no hay
// ambigüedad ni se corre el riesgo de armar un número distinto al
// verificado.
function normalizePhone(phone) {
  const digits = digitsOnly(phone);
  if (digits.length === 10 && !digits.startsWith("54")) {
    return `54${digits}`;
  }
  return digits;
}

async function sendWhatsAppMessage(phone, payload, { logLabel }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.warn(`[whatsapp] Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID, no se envía "${logLabel}".`);
    return { skipped: true };
  }
  if (!phone) {
    console.warn(`[whatsapp] Sin teléfono, no se envía "${logLabel}".`);
    return { skipped: true };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to: phone, ...payload }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error(`[whatsapp] Error enviando "${logLabel}":`, data);
  }
  return data;
}

export async function sendWhatsAppConfirmation(reservation) {
  const to = normalizePhone(reservation.clientPhone);
  const hour = `${String(reservation.hour).padStart(2, "0")}:00`;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  // Si hay una plantilla configurada (necesaria para mandar fuera de la
  // ventana de 24hs desde que el cliente escribió), se manda como
  // "template". El orden de los parámetros tiene que coincidir con las
  // variables {{1}}, {{2}}, {{3}} tal como quedó aprobada la plantilla en
  // Meta — ver la sugerencia de texto en el README del backend.
  const payload = templateName
    ? {
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es_AR" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: reservation.courtName },
                { type: "text", text: reservation.date },
                { type: "text", text: hour },
              ],
            },
            // Botón "Agregar al calendario" con URL dinámica — la parte fija
            // (https://tu-front/reserva/) ya está cargada en la plantilla
            // aprobada en Meta; acá sólo se completa la parte variable
            // ({{1}} del botón) con el id de esta reserva puntual, así el
            // link lleva a la pantalla de confirmación de este turno.
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: reservation.id }],
            },
          ],
        },
      }
    : {
        type: "text",
        text: {
          body:
            `¡Turno confirmado! 🎾⚽\n` +
            `${reservation.courtName}, ${reservation.date} a las ${hour}.\n` +
            `Pago acreditado por Mercado Pago. Te esperamos 10 min antes.\n\n` +
            `Agregalo a tu calendario: ${process.env.FRONTEND_URL}/reserva/${reservation.id}`,
        },
      };

  return sendWhatsAppMessage(to, payload, { logLabel: `confirmación ${reservation.id}` });
}

// Aviso de baja de un turno, disparado cuando el admin cancela una reserva
// ya confirmada. Igual que con la confirmación: si hay una plantilla
// aprobada configurada (WHATSAPP_CANCEL_TEMPLATE_NAME) se manda como
// "template" (funciona aunque hayan pasado más de 24hs desde el último
// mensaje del cliente); si no, se manda como texto libre, que sólo llega si
// el cliente le escribió al número del club en las últimas 24hs.
export async function sendWhatsAppCancellation(reservation, { reason } = {}) {
  const to = normalizePhone(reservation.clientPhone);
  const hour = `${String(reservation.hour).padStart(2, "0")}:00`;
  const templateName = process.env.WHATSAPP_CANCEL_TEMPLATE_NAME;

  const payload = templateName
    ? {
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es_AR" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: reservation.courtName },
                { type: "text", text: reservation.date },
                { type: "text", text: hour },
              ],
            },
          ],
        },
      }
    : {
        type: "text",
        text: {
          body:
            `Turno cancelado ❌\n` +
            `${reservation.courtName}, ${reservation.date} a las ${hour}.\n` +
            (reason ? `Motivo: ${reason}\n` : "") +
            `Cualquier duda, escribinos por acá.`,
        },
      };

  return sendWhatsAppMessage(to, payload, { logLabel: `cancelación ${reservation.id}` });
}

// Aviso de cambio de horario/cancha, disparado cuando el admin modifica una
// reserva ya confirmada. `previous` trae los datos de antes del cambio.
export async function sendWhatsAppModification(reservation, previous) {
  const to = normalizePhone(reservation.clientPhone);
  const newHour = `${String(reservation.hour).padStart(2, "0")}:00`;
  const prevHour = `${String(previous.hour).padStart(2, "0")}:00`;
  const templateName = process.env.WHATSAPP_MODIFY_TEMPLATE_NAME;

  const payload = templateName
    ? {
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es_AR" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: previous.courtName },
                { type: "text", text: previous.date },
                { type: "text", text: prevHour },
                { type: "text", text: reservation.courtName },
                { type: "text", text: reservation.date },
                { type: "text", text: newHour },
              ],
            },
          ],
        },
      }
    : {
        type: "text",
        text: {
          body:
            `Tu turno cambió 🔄\n` +
            `Antes: ${previous.courtName}, ${previous.date} a las ${prevHour}.\n` +
            `Ahora: ${reservation.courtName}, ${reservation.date} a las ${newHour}.\n` +
            `Te esperamos, 10 minutos antes de tu nuevo turno. \n` +
            `Cualquier duda, escribinos por acá.`,
        },
      };

  return sendWhatsAppMessage(to, payload, { logLabel: `modificación ${reservation.id}` });
}
