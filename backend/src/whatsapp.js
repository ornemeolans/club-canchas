// Envío de la confirmación por WhatsApp usando la Cloud API de Meta.
// Requiere una cuenta de WhatsApp Business y un número verificado.
// Doc: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_VERSION = "v20.0";

function digitsOnly(phone) {
  return String(phone).replace(/\D/g, "");
}

export async function sendWhatsAppConfirmation(reservation) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.warn("[whatsapp] Faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID, no se envía el mensaje.");
    return { skipped: true };
  }
  if (!reservation.clientPhone) {
    console.warn(`[whatsapp] Reserva ${reservation.id} sin teléfono, no se envía el mensaje.`);
    return { skipped: true };
  }

  const to = digitsOnly(reservation.clientPhone);
  const bodyText =
    `¡Turno confirmado! 🎾⚽\n` +
    `${reservation.courtName}, ${reservation.date} a las ${String(reservation.hour).padStart(2, "0")}:00.\n` +
    `Pago acreditado por Mercado Pago. Te esperamos 10 min antes.`;

  // Mensaje de texto libre — sólo funciona si el cliente escribió al número
  // del club en las últimas 24hs. Fuera de esa ventana, Meta exige usar una
  // plantilla (template) pre-aprobada; ver WHATSAPP_TEMPLATE_NAME en .env.
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: bodyText },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("[whatsapp] Error enviando mensaje:", data);
  }
  return data;
}
