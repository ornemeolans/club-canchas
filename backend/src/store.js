// Store en memoria. Para producción real conviene reemplazarlo por una base
// de datos (Postgres, SQLite, etc.) — la interfaz de abajo es la que hay que
// mantener si se migra.

import { nanoid } from "nanoid";

const HOLD_MINUTES = 5;
const HOLD_MS = HOLD_MINUTES * 60 * 1000;
// Una vez que el cliente entra al checkout de Mercado Pago, le damos más
// margen antes de liberar el horario — pagar puede tardar más que los
// minutos que quedaban del hold original.
const PAYMENT_GRACE_MINUTES = 15;
const PAYMENT_GRACE_MS = PAYMENT_GRACE_MINUTES * 60 * 1000;

// Zona horaria del club, para decidir qué horarios ya pasaron. Ajustar acá
// si el club está en otra provincia con huso distinto.
const CLUB_TIMEZONE = "America/Argentina/Buenos_Aires";

function nowInClubTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

// Un turno "ya pasó" si es de un día anterior a hoy, o si es hoy y la hora
// de inicio ya llegó o quedó atrás.
export function isPastSlot(date, hour) {
  const now = nowInClubTimezone();
  if (date < now.date) return true;
  if (date > now.date) return false;
  return hour <= now.hour;
}

export const SPORTS = {
  futbol: {
    label: "Fútbol",
    price: 120,
    courts: [
      { id: "f1", name: "Cancha de Fútbol 1" },
      { id: "f2", name: "Cancha de Fútbol 2" },
    ],
  },
  tenis: {
    label: "Tenis",
    price: 90,
    courts: [
      { id: "t1", name: "Cancha de Tenis 1" },
      { id: "t2", name: "Cancha de Tenis 2" },
    ],
  },
};

export function findCourt(courtId) {
  for (const sport of Object.values(SPORTS)) {
    const court = sport.courts.find((c) => c.id === courtId);
    if (court) return { court, sport };
  }
  return null;
}

// holds: reservas en curso, todavía no pagadas. Expiran solas.
// Map<holdId, { id, courtId, date, hour, clientName, clientPhone,
//               status: 'pending'|'paying'|'confirmed'|'expired',
//               preferenceId, paymentId, expiresAt }>
const holds = new Map();

// reservations: turnos ya confirmados (pago acreditado). Esto es "la planilla".
const reservations = [];

function slotKey(courtId, date, hour) {
  return `${courtId}__${date}__${hour}`;
}

export function isSlotTaken(courtId, date, hour) {
  const key = slotKey(courtId, date, hour);
  const activeHold = [...holds.values()].some(
    (h) =>
      slotKey(h.courtId, h.date, h.hour) === key &&
      (h.status === "pending" || h.status === "paying") &&
      h.expiresAt > Date.now()
  );
  if (activeHold) return true;
  return reservations.some((r) => slotKey(r.courtId, r.date, r.hour) === key);
}

export function getTakenHours(courtId, date) {
  const hours = new Set();
  for (const h of holds.values()) {
    if (
      h.courtId === courtId &&
      h.date === date &&
      (h.status === "pending" || h.status === "paying") &&
      h.expiresAt > Date.now()
    ) {
      hours.add(h.hour);
    }
  }
  for (const r of reservations) {
    if (r.courtId === courtId && r.date === date) hours.add(r.hour);
  }
  // Los horarios que ya pasaron tampoco se ofrecen, aunque nadie los haya
  // reservado.
  for (let h = 9; h <= 21; h++) {
    if (isPastSlot(date, h)) hours.add(h);
  }
  return [...hours];
}

export function createHold({ courtId, date, hour, clientName, clientPhone }) {
  if (isPastSlot(date, hour)) return { error: "past" };
  if (isSlotTaken(courtId, date, hour)) return null;
  const id = nanoid(10);
  const hold = {
    id,
    courtId,
    date,
    hour,
    clientName,
    clientPhone,
    status: "pending",
    preferenceId: null,
    paymentId: null,
    expiresAt: Date.now() + HOLD_MS,
    createdAt: Date.now(),
  };
  holds.set(id, hold);
  return hold;
}

export function getHold(id) {
  return holds.get(id) || null;
}

export function attachPreference(id, preferenceId) {
  const hold = holds.get(id);
  if (!hold) return null;
  hold.preferenceId = preferenceId;
  hold.status = "paying";
  hold.expiresAt = Date.now() + PAYMENT_GRACE_MS;
  return hold;
}

export function findHoldByPreference(preferenceId) {
  return [...holds.values()].find((h) => h.preferenceId === preferenceId) || null;
}

// Holds que ya generaron una preferencia de pago y todavía no se confirmaron
// (esperando webhook). Los usa el job de reconciliación.
export function listPayingHolds() {
  return [...holds.values()].filter((h) => h.status === "paying");
}

export function confirmHold(id, paymentId) {
  const hold = holds.get(id);
  if (!hold) return null;
  hold.status = "confirmed";
  hold.paymentId = paymentId;

  const { court, sport } = findCourt(hold.courtId) || {};
  const reservation = {
    id: hold.id,
    courtId: hold.courtId,
    courtName: court?.name || hold.courtId,
    sportLabel: sport?.label || "",
    date: hold.date,
    hour: hold.hour,
    amount: sport?.price || 0,
    clientName: hold.clientName,
    clientPhone: hold.clientPhone,
    paymentId,
    confirmedAt: new Date().toISOString(),
  };
  reservations.push(reservation);
  holds.delete(id);
  return reservation;
}

export function listReservations() {
  return [...reservations].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

export function getReservation(id) {
  return reservations.find((r) => r.id === id) || null;
}

// Limpieza periódica de holds vencidos.
setInterval(() => {
  const now = Date.now();
  for (const [id, hold] of holds) {
    if (hold.status !== "confirmed" && hold.expiresAt <= now) {
      holds.delete(id);
    }
  }
}, 15_000).unref();
