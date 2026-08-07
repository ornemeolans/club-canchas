import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { api } from "./api.js";
import "./styles.css";

const CLUB_TIMEZONE = "America/Argentina/Buenos_Aires";

// "Hoy" según la hora del club (Argentina), no la del dispositivo del
// visitante ni una conversión a UTC — evitar ambas es lo que previene el
// bug de "se corre un día" a la noche.
function clubNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

// Cada elemento representa una fecha de calendario (no un instante), anclada
// a medianoche UTC — de ahí en más SIEMPRE se lee con getUTC*, nunca con los
// getters locales, para que no dependa del huso horario del navegador.
function nextDays(n) {
  const { year, month, day } = clubNowParts();
  const anchor = Date.UTC(year, month - 1, day);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(new Date(anchor + i * 86400000));
  }
  return out;
}
function fmtDateKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDateLabel(d) {
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" })
    .format(d)
    .replace(".", "");
  return { weekday, day: d.getUTCDate() };
}

function nowInClubTimezone() {
  const { year, month, day, hour } = clubNowParts();
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}`, hour };
}
function isPastSlot(dateKey, hour) {
  const now = nowInClubTimezone();
  if (dateKey < now.date) return true;
  if (dateKey > now.date) return false;
  return hour <= now.hour;
}

// Los deportes/canchas/horarios prácticamente no cambian — se conocen de
// entrada, así la grilla se puede mostrar apenas carga la página, sin
// esperar la ida y vuelta a /api/config. Ese pedido sigue haciéndose en
// segundo plano (por si el precio u otra cosa cambió), pero ya no bloquea
// el primer render.
const DEFAULT_SPORTS = {
  futbol: {
    label: "Fútbol",
    price: 12000,
    courts: [
      { id: "f1", name: "Cancha de Fútbol 1" },
      { id: "f2", name: "Cancha de Fútbol 2" },
    ],
  },
  tenis: {
    label: "Tenis",
    price: 9000,
    courts: [
      { id: "t1", name: "Cancha de Tenis 1" },
      { id: "t2", name: "Cancha de Tenis 2" },
    ],
  },
};
const DEFAULT_HOURS = Array.from({ length: 13 }, (_, i) => 9 + i);

export default function App() {
  const days = useMemo(() => nextDays(7), []);
  const dateKeys = useMemo(() => days.map(fmtDateKey), [days]);

  const [sports, setSports] = useState(DEFAULT_SPORTS);
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [configError, setConfigError] = useState(null);

  const [sport, setSport] = useState("futbol");
  const [courtId, setCourtId] = useState("f1");
  const [dateIdx, setDateIdx] = useState(0);
  const [takenHours, setTakenHours] = useState([]);

  const [selectedHour, setSelectedHour] = useState(null);
  const [step, setStep] = useState("grid"); // grid | form | hold | confirming | confirmed | error
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [formError, setFormError] = useState(null);

  const [hold, setHold] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState(null);

  const [reservation, setReservation] = useState(null);

  const pollRef = useRef(null);
  const tickRef = useRef(null);

  const sportDef = sports[sport] || DEFAULT_SPORTS[sport];
  const court = sportDef.courts.find((c) => c.id === courtId) || null;
  const dateKey = dateKeys[dateIdx];

  // ---- Carga inicial: config en segundo plano (ya no bloquea el primer
  // render — la grilla usa los valores por defecto de entrada) + si venimos
  // de vuelta del checkout de MP ----
  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        setSports(cfg.sports);
        setHours(cfg.hours);
        // Ojo: no se pisa `sport`/`courtId` acá — si el visitante ya venía
        // interactuando con la grilla (con los valores por defecto) antes
        // de que esto responda, forzarlos de vuelta al primero sería un
        // mal salto de UI.
      })
      .catch((err) => setConfigError(err.message));

    const match = window.location.pathname.match(/^\/reserva\/([\w-]+)$/);
    if (match) {
      setStep("confirming");
      pollAfterCheckout(match[1]);
    }
  }, []);

  // ---- Disponibilidad de la cancha/fecha elegida ----
  const refreshAvailability = useCallback(() => {
    if (!courtId || !dateKey) return;
    api
      .getAvailability(courtId, dateKey)
      .then((r) => setTakenHours(r.takenHours))
      .catch(() => {});
  }, [courtId, dateKey]);

  useEffect(() => {
    refreshAvailability();
    const id = setInterval(refreshAvailability, 15_000);
    return () => clearInterval(id);
  }, [refreshAvailability]);

  const switchSport = (s) => {
    setSport(s);
    setCourtId(sports[s].courts[0]?.id || null);
    setStep("grid");
    setSelectedHour(null);
  };
  const pickCourt = (id) => {
    setCourtId(id);
    setStep("grid");
    setSelectedHour(null);
  };
  const pickDate = (idx) => {
    setDateIdx(idx);
    setStep("grid");
    setSelectedHour(null);
  };

  const openForm = (hour) => {
    setSelectedHour(hour);
    setFormError(null);
    setStep("form");
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      setFormError("Completá nombre y teléfono.");
      return;
    }
    try {
      const { hold: created } = await api.createHold({
        courtId,
        date: dateKey,
        hour: selectedHour,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
      });
      setHold(created);
      setStep("hold");
      refreshAvailability();
    } catch (err) {
      setFormError(err.message);
    }
  };

  const cancelHold = () => {
    setStep("grid");
    setSelectedHour(null);
    setHold(null);
    refreshAvailability();
  };

  // ---- Cuenta regresiva del hold, calculada contra expiresAt del backend ----
  useEffect(() => {
    if (step !== "hold" || !hold) return;
    const tick = () => {
      const left = Math.max(0, Math.round((hold.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(tickRef.current);
        setStep("grid");
        setHold(null);
        setSelectedHour(null);
        refreshAvailability();
      }
    };
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => clearInterval(tickRef.current);
  }, [step, hold, refreshAvailability]);

  // ---- Pagar: pide la preferencia y redirige al checkout real de MP ----
  const startPayment = async () => {
    if (!hold) return;
    setPayLoading(true);
    setPayError(null);
    try {
      const { initPoint } = await api.startPayment(hold.id);
      window.location.href = initPoint; // redirección real a Mercado Pago
    } catch (err) {
      setPayError(err.message);
      setPayLoading(false);
    }
  };

  // ---- Al volver del checkout: esperar la confirmación del webhook ----
  function pollAfterCheckout(holdId) {
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const r = await api.getReservation(holdId).catch(() => null);
        if (r?.reservation) {
          clearInterval(pollRef.current);
          setReservation(r.reservation);
          setStep("confirmed");
          return;
        }
        const h = await api.getHold(holdId).catch(() => null);
        if (!h && attempts > 3) {
          // Ni hold ni reserva: probablemente expiró antes de acreditarse.
          clearInterval(pollRef.current);
          setStep("error");
        }
      } catch {
        /* seguir intentando */
      }
      if (attempts > 40) {
        // ~2 minutos de polling; después de eso, avisamos y dejamos de insistir.
        clearInterval(pollRef.current);
        setStep("error");
      }
    }, 3000);
  }
  useEffect(() => () => clearInterval(pollRef.current), []);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const low = secondsLeft <= 60;

  // Argentina no tiene horario de verano — UTC-3 fijo todo el año. Se arma
  // el horario del evento a partir de eso directamente, para que el
  // turno quede a la hora correcta sin importar en qué huso esté el
  // navegador de quien reservó.
  const argentinaWallTimeToUTC = (dateStr, hour) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hour + 3, 0, 0));
  };

  const gcalUrl = useMemo(() => {
    if (!reservation) return "#";
    const start = argentinaWallTimeToUTC(reservation.date, reservation.hour);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const text = encodeURIComponent(`${reservation.sportLabel} — ${reservation.courtName}`);
    const details = encodeURIComponent(`Turno reservado en el club. Cancha: ${reservation.courtName}.`);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${fmt(start)}/${fmt(end)}&details=${details}`;
  }, [reservation]);

  // Alternativa que no depende de tener sesión de Google iniciada: un
  // archivo .ics descargable, que abre directo en Google Calendar, Outlook,
  // Apple Calendar, etc.
  const downloadIcs = () => {
    if (!reservation) return;
    const start = argentinaWallTimeToUTC(reservation.date, reservation.hour);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Club Canchas//Reservas//ES",
      "BEGIN:VEVENT",
      `UID:${reservation.id}@club-canchas`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${reservation.sportLabel} — ${reservation.courtName}`,
      `DESCRIPTION:Turno reservado en el club. Cancha: ${reservation.courtName}.`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `turno-${reservation.date}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (configError) {
    console.error("No se pudo sincronizar /api/config:", configError);
  }

  return (
    <main className="app">
      <div className="hero">
        <div className="hero-inner">
          <div className="eyebrow">9:00 — 22:00 · turnos de 1 hora</div>
          <h1 className="display">
            Reservá tu
            <br />
            cancha
          </h1>
          <p>
            Fútbol y tenis. Elegí cancha, día y horario y pagá por
            transferencia a través de Mercado Pago: tu turno queda
            confirmado solo, apenas se acredita el pago.
          </p>
          <a href="#reservar" className="btn btn-primary">
            Ver disponibilidad
          </a>
        </div>
      </div>

      {step !== "confirming" && step !== "confirmed" && step !== "error" && (
        <section id="reservar">
          <h2 className="section-title display">Elegí tu turno</h2>
          <p className="section-sub">2 canchas de fútbol · 2 canchas de tenis</p>

          <div className="tabs">
            {Object.entries(sports).map(([key, s]) => (
              <div key={key} className={`tab ${key} ${sport === key ? "active" : ""}`} onClick={() => switchSport(key)}>
                {s.label}
              </div>
            ))}
          </div>

          <div className="courts" style={{ "--accent": `var(--${sport === "tenis" ? "clay" : "turf"})` }}>
            {sportDef.courts.map((c) => (
              <div key={c.id} className={`court-card ${courtId === c.id ? "selected" : ""}`} onClick={() => pickCourt(c.id)}>
                <div className="name display">{c.name}</div>
                <div className="price-tag">${sportDef.price.toLocaleString("es-AR")} / turno</div>
              </div>
            ))}
          </div>

          <div className="date-strip">
            {days.map((d, i) => {
              const { weekday, day } = fmtDateLabel(d);
              return (
                <div key={i} className={`date-pill ${i === dateIdx ? "selected" : ""}`} onClick={() => pickDate(i)}>
                  <div className="wd">{weekday}</div>
                  <div className="d display">{day}</div>
                </div>
              );
            })}
          </div>

          <div className="board">
            <div className="slot-grid">
              {hours
                .filter((h) => !isPastSlot(dateKey, h))
                .map((h) => {
                  const taken = takenHours.includes(h);
                  return (
                    <div key={h} className={`slot ${taken ? "taken" : ""}`} onClick={() => !taken && openForm(h)}>
                      {String(h).padStart(2, "0")}:00
                    </div>
                  );
                })}
              {hours.filter((h) => !isPastSlot(dateKey, h)).length === 0 && (
                <p className="section-sub" style={{ margin: 0 }}>
                  No quedan horarios disponibles hoy.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <footer>Club Canchas</footer>

      {/* FORM: nombre + teléfono, antes de apartar el horario */}
      {step === "form" && (
        <div className="hold-overlay">
          <div className="hold-card">
            <div className="eyebrow">Un dato antes de apartar el turno</div>
            <p style={{ fontSize: 13, color: "var(--chalk-dim)", marginTop: 0 }}>
              Lo necesitamos para mandarte la confirmación por WhatsApp.
            </p>
            <form onSubmit={submitForm}>
              <input
                className="input"
                placeholder="Nombre y apellido"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
              <input
                className="input"
                placeholder="WhatsApp (ej: +54 9 11 1234 5678)"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                style={{ marginTop: 10 }}
              />
              {formError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{formError}</p>}
              <div className="hold-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setStep("grid")}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary">
                  Apartar horario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HOLD: countdown real + botón de pago que redirige a MP */}
      {step === "hold" && hold && (
        <div className="hold-overlay">
          <div className="hold-card">
            <div className="eyebrow">Turno apartado</div>
            <div className="row"><span>Cancha</span><b>{court?.name}</b></div>
            <div className="row"><span>Fecha</span><b>{dateKey}</b></div>
            <div className="row">
              <span>Horario</span>
              <b>{String(selectedHour).padStart(2, "0")}:00 - {String(selectedHour + 1).padStart(2, "0")}:00</b>
            </div>
            <div className="row"><span>Monto</span><b>${sportDef.price.toLocaleString("es-AR")}</b></div>

            <div className={`clock ${low ? "low" : ""}`}>{mm}:{ss}</div>

            <p style={{ fontSize: 12.5, color: "var(--chalk-dim)", lineHeight: 1.5 }}>
              El pago se hace por transferencia dentro de Mercado Pago (no se
              aceptan tarjetas). Ni bien se acredita, tu
              turno se confirma solo.
            </p>
            {payError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{payError}</p>}

            <div className="hold-actions">
              <button className="btn btn-ghost" onClick={cancelHold} disabled={payLoading}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={startPayment} disabled={payLoading}>
                {payLoading ? "Abriendo Mercado Pago…" : "Pagar por transferencia"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMING: volvimos del checkout, esperando el webhook */}
      {step === "confirming" && (
        <div className="hold-overlay">
          <div className="hold-card">
            <div className="verifying">
              <span className="spinner" />
              Esperando que Mercado Pago confirme el pago…
            </div>
            <p style={{ fontSize: 12, color: "var(--chalk-dim)", textAlign: "center" }}>
              Esto lo confirma Mercado Pago automáticamente. Podés dejar esta
              pantalla abierta un momento.
            </p>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="hold-overlay">
          <div className="hold-card">
            <div className="eyebrow" style={{ color: "var(--danger)" }}>No pudimos confirmar el turno</div>
            <p style={{ fontSize: 13, color: "var(--chalk-dim)" }}>
              Puede que el pago no se haya acreditado a tiempo, o que el hold
              haya expirado. Si te descontaron el pago, escribinos.
            </p>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => (window.location.href = "/")}>
              Volver a intentar
            </button>
          </div>
        </div>
      )}

      {step === "confirmed" && reservation && (
        <div className="hold-overlay">
          <div className="hold-card">
            <div className="badge-ok">✓ Pago acreditado</div>
            <h3 className="display" style={{ fontSize: 30, margin: "8px 0 16px" }}>Turno confirmado</h3>
            <div className="confirm-wrap">
              <div className="wa-bubble">
                <div className="wa-head">● WhatsApp — Club Canchas</div>
                <div className="wa-msg">
                  ¡Turno confirmado! 🎾⚽<br />
                  {reservation.courtName}, {reservation.date} a las {String(reservation.hour).padStart(2, "0")}:00.
                </div>
              </div>
              <div className="cal-card">
                <h4>Agregalo a tu calendario</h4>
                <a href={gcalUrl} target="_blank" rel="noreferrer" className="btn btn-outline">+ Google Calendar</a>
                <button onClick={downloadIcs} className="btn btn-ghost" style={{ marginTop: 8 }}>
                  Descargar .ics
                </button>
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => (window.location.href = "/")}>
              Reservar otro turno
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
