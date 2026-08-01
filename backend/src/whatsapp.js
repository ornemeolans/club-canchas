// Envío de la confirmación por WhatsApp usando la Cloud API de Meta.
// Requiere una cuenta de WhatsApp Business y un número verificado.
// Doc: https://developers.facebook.com/docs/whatsapp/cloud-api

const GRAPH_VERSION = "v20.0";

function digitsOnly(phone) {
  return String(phone).replace(/\D/g, "");
}

// Ojo: en algún momento este archivo insertaba automáticamente un "9" extra
// para números argentinos (una regla que corre para algunas plataformas,
// pero no siempre para la API de WhatsApp — depende de cómo esté
// registrado el número). Se sacó porque terminaba armando un número
// distinto al que realmente está verificado como destinatario de prueba en
// Meta, y eso rompía el envío. Ahora se manda tal cual lo carga el
// cliente en el formulario — asegurate de que el número que probás en el
// sitio sea EXACTAMENTE igual (mismo formato) al que aparece verificado en
// el panel de Meta como destinatario de prueba.
function normalizePhone(phone) {
  return digitsOnly(phone);
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

  const to = normalizePhone(reservation.clientPhone);
  console.log(`[whatsapp] Tal como lo cargó el cliente: "${reservation.clientPhone}" → mandando a: "${to}"`);
  const hour = `${String(reservation.hour).padStart(2, "0")}:00`;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

  // Si hay una plantilla configurada (necesaria para mandar fuera de la
  // ventana de 24hs desde que el cliente escribió), se manda como
  // "template". El orden de los parámetros tiene que coincidir con las
  // variables {{1}}, {{2}}, {{3}} tal como quedó aprobada la plantilla en
  // Meta — ver la sugerencia de texto en el README del backend.
  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to,
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
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body:
            `¡Turno confirmado! 🎾⚽\n` +
            `${reservation.courtName}, ${reservation.date} a las ${hour}.\n` +
            `Pago acreditado por Mercado Pago. Te esperamos 10 min antes.`,
        },
      };

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("[whatsapp] Error enviando mensaje:", data);
  }
  return data;
}
