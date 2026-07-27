import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import crypto from "node:crypto";

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const preferenceApi = new Preference(client);
const paymentApi = new Payment(client);

/**
 * Crea una preferencia de pago para un hold (turno apartado por 5 min).
 * external_reference = hold.id, así el webhook sabe a qué reserva corresponde.
 */
export async function createPaymentPreference(hold, { courtName, sportLabel, price }) {
  const base = process.env.PUBLIC_BASE_URL;
  const frontend = process.env.FRONTEND_URL;

  const preference = await preferenceApi.create({
    body: {
      items: [
        {
          id: hold.id,
          title: `${sportLabel} — ${courtName} — ${hold.date} ${String(hold.hour).padStart(2, "0")}:00`,
          quantity: 1,
          unit_price: price,
          currency_id: "ARS",
        },
      ],
      external_reference: hold.id,
      payer: hold.clientName ? { name: hold.clientName } : undefined,
      back_urls: {
        success: `${frontend}/reserva/${hold.id}`,
        pending: `${frontend}/reserva/${hold.id}`,
        failure: `${frontend}/reserva/${hold.id}`,
      },
      auto_return: "approved",
      notification_url: `${base}/api/webhooks/mercadopago`,
      // El club sólo quiere cobrar por transferencia — se excluyen tarjetas,
      // efectivo/ticket, etc. "Dinero en cuenta" (account_money) no se puede
      // excluir del lado de la API, pero es plata que ya está en la cuenta
      // de Mercado Pago del club, así que no rompe el requisito.
      payment_methods: {
        excluded_payment_types: [
          { id: "credit_card" },
          { id: "debit_card" },
          { id: "prepaid_card" },
          { id: "ticket" },
          { id: "atm" },
          { id: "digital_currency" },
          { id: "digital_wallet" },
        ],
      },
      // Vence junto con el hold para no dejar links de pago colgados.
      expires: true,
      expiration_date_to: new Date(hold.expiresAt).toISOString(),
    },
  });

  return preference;
}

export async function getPayment(paymentId) {
  return paymentApi.get({ id: paymentId });
}

/**
 * Busca en la cuenta de Mercado Pago (la del access token) si ya hay un pago
 * aprobado para esta reserva. Es el mismo dato que trae el webhook, pero
 * consultado "a demanda" — sirve como red de contención si alguna notificación
 * no llega (falla de red, servidor caído un rato, etc.).
 * Doc: GET /v1/payments/search?external_reference=...
 */
export async function searchApprovedPaymentByReference(externalReference) {
  const url = new URL("https://api.mercadopago.com/v1/payments/search");
  url.searchParams.set("external_reference", externalReference);
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Búsqueda de pagos en MP falló: ${res.status}`);

  const data = await res.json();
  const results = data.results || [];
  return results.find((p) => p.status === "approved") || null;
}

/**
 * Valida la firma x-signature que manda Mercado Pago en cada notificación,
 * para confirmar que la notificación realmente viene de MP.
 * Doc: manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};"
 */
export function isValidWebhookSignature({ xSignature, xRequestId, dataId }) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || !xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v?.trim()];
    })
  );
  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
