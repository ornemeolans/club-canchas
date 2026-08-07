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

// No se puede reservar un turno si empieza en menos de este margen.
const BOOKING_CUTOFF_MINUTES = 15;

function nowInClubTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

// Minutos transcurridos desde una referencia arbitraria pero común, sólo
// para poder restar fechas/horas entre sí. Como tanto "ahora" como el
// turno se calculan con la misma zona horaria del club, la diferencia da
// bien aunque tratemos los campos como si fueran UTC.
function toMinutesSinceEpoch(date, hour, minute = 0) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

// Un turno ya no se puede reservar si es de un día anterior a hoy, o si
// falta menos de BOOKING_CUTOFF_MINUTES para que empiece (o ya empezó).
// Se usa "<=" y no "<": como nowInClubTimezone() sólo tiene precisión de
// minuto (sin segundos), "ahora" puede estar hasta 59s adelantado respecto
// del minuto que se lee — con "<" el turno quedaba visible todo ese último
// minuto antes de cumplirse el corte real de 15 minutos.
export function isPastSlot(date, hour) {
  const now = nowInClubTimezone();
  const nowMinutes = toMinutesSinceEpoch(now.date, now.hour, now.minute);
  const slotMinutes = toMinutesSinceEpoch(date, hour);
  return slotMinutes - nowMinutes <= BOOKING_CUTOFF_MINUTES;
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

// blocks: horarios que el club bloqueó a mano (clases, mantenimiento, etc.)
// para que no aparezcan como disponibles, sin que exista una reserva real.
// [{ id, courtId, date, hour, reason, createdAt }]
const blocks = [];

function slotKey(courtId, date, hour) {
  return `${courtId}__${date}__${hour}`;
}

export function isSlotBlocked(courtId, date, hour) {
  return blocks.some((b) => slotKey(b.courtId, b.date, b.hour) === slotKey(courtId, date, hour));
}

export function getBlock(courtId, date, hour) {
  return blocks.find((b) => slotKey(b.courtId, b.date, b.hour) === slotKey(courtId, date, hour)) || null;
}

export function createBlock({ courtId, date, hour, reason, seriesId }) {
  if (isSlotBlocked(courtId, date, hour)) return null;
  const id = nanoid(10);
  const block = { id, courtId, date, hour, reason: reason || "", seriesId: seriesId || null, createdAt: Date.now() };
  blocks.push(block);
  return block;
}

export function removeBlock(id) {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  blocks.splice(idx, 1);
  return true;
}

// blockSeries: agrupa un bloqueo masivo (ej. "cancha de tenis 1, 18hs,
// todos los martes de agosto") para poder avisar por mail cuando se acerca
// el último turno bloqueado de la tanda.
// [{ id, courtId, hour, reason, dates: [...], lastDate, createdAt, alerted }]
const blockSeries = [];

export function createBlockSeries({ courtId, hour, dates, reason }) {
  const seriesId = nanoid(10);
  const created = [];
  const skipped = [];
  for (const date of dates) {
    const block = createBlock({ courtId, date, hour, reason, seriesId });
    if (block) created.push(block);
    else skipped.push(date);
  }
  const sortedDates = [...dates].sort();
  const series = {
    id: seriesId,
    courtId,
    hour,
    reason: reason || "",
    dates: sortedDates,
    lastDate: sortedDates[sortedDates.length - 1],
    createdAt: Date.now(),
    alerted: false,
  };
  blockSeries.push(series);
  return { series, created, skipped };
}

// Series cuyo último turno bloqueado ya es hoy (o quedó atrás) y todavía no
// se avisó por mail. La usa el job de alertas.
export function listSeriesNeedingAlert() {
  const { date: today } = nowInClubTimezone();
  return blockSeries.filter((s) => !s.alerted && s.lastDate <= today);
}

export function markSeriesAlerted(id) {
  const series = blockSeries.find((s) => s.id === id);
  if (series) series.alerted = true;
}

export function isSlotTaken(courtId, date, hour) {
  const key = slotKey(courtId, date, hour);
  if (isSlotBlocked(courtId, date, hour)) return true;
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
  for (const b of blocks) {
    if (b.courtId === courtId && b.date === date) hours.add(b.hour);
  }
  // Los horarios que ya pasaron tampoco se ofrecen, aunque nadie los haya
  // reservado.
  for (let h = 9; h <= 21; h++) {
    if (isPastSlot(date, h)) hours.add(h);
  }
  return [...hours];
}

// Vista completa de una cancha/fecha para el panel de administrador: el
// estado de cada hora (disponible, en curso de pago, reservada, bloqueada,
// o ya pasada), con el detalle que corresponda en cada caso.
export function getCourtSchedule(courtId, date) {
  const hours = [];
  for (let hour = 9; hour <= 21; hour++) {
    const reservation = reservations.find(
      (r) => r.courtId === courtId && r.date === date && r.hour === hour
    );
    if (reservation) {
      hours.push({
        hour,
        status: "reserved",
        clientName: reservation.clientName,
        clientPhone: reservation.clientPhone,
        amount: reservation.amount,
      });
      continue;
    }

    const block = getBlock(courtId, date, hour);
    if (block) {
      hours.push({ hour, status: "blocked", blockId: block.id, reason: block.reason });
      continue;
    }

    const hold = [...holds.values()].find(
      (h) =>
        h.courtId === courtId &&
        h.date === date &&
        h.hour === hour &&
        (h.status === "pending" || h.status === "paying") &&
        h.expiresAt > Date.now()
    );
    if (hold) {
      hours.push({ hour, status: "holding", clientName: hold.clientName });
      continue;
    }

    if (isPastSlot(date, hour)) {
      hours.push({ hour, status: "past" });
      continue;
    }

    hours.push({ hour, status: "available" });
  }
  return hours;
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
