import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { api } from "./api.js";

function nextDays(n) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    out.push(d);
  }
  return out;
}
const fmtDateKey = (d) => d.toISOString().slice(0, 10);
const fmtDateLabel = (d) => ({
  weekday: d.toLocaleDateString("es-AR", { weekday: "short" }).replace(".", ""),
  day: d.getDate(),
});

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
function isPastSlot(dateKey, hour) {
  const now = nowInClubTimezone();
  if (dateKey < now.date) return true;
  if (dateKey > now.date) return false;
  return hour <= now.hour;
}

// Se usa como placeholder mientras /api/config todavía no respondió.
const FALLBACK_SPORTS = {
  futbol: { label: "Fútbol", price: 0, courts: [] },
  tenis: { label: "Tenis", price: 0, courts: [] },
};

export default function App() {
  const days = useMemo(() => nextDays(7), []);
  const dateKeys = useMemo(() => days.map(fmtDateKey), [days]);

  const [sports, setSports] = useState(FALLBACK_SPORTS);
  const [hours, setHours] = useState([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState(null);

  const [sport, setSport] = useState("futbol");
  const [courtId, setCourtId] = useState(null);
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

  const sportDef = sports[sport] || FALLBACK_SPORTS[sport];
  const court = sportDef.courts.find((c) => c.id === courtId) || null;
  const date = days[dateIdx];
  const dateKey = dateKeys[dateIdx];

  // ---- Carga inicial: config + si venimos de vuelta del checkout de MP ----
  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        setSports(cfg.sports);
        setHours(cfg.hours);
        const firstSport = Object.keys(cfg.sports)[0];
        setSport(firstSport);
        setCourtId(cfg.sports[firstSport].courts[0]?.id || null);
        setConfigLoaded(true);
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

  const gcalUrl = useMemo(() => {
    if (!reservation) return "#";
    const start = new Date(`${reservation.date}T00:00:00`);
    start.setHours(reservation.hour, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    const fmt = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const text = encodeURIComponent(`${reservation.sportLabel} — ${reservation.courtName}`);
    const details = encodeURIComponent(`Turno reservado en el club. Cancha: ${reservation.courtName}.`);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${fmt(start)}/${fmt(end)}&details=${details}`;
  }, [reservation]);

  if (configError) {
    return (
      <div className="app" style={{ padding: 40 }}>
        No se pudo conectar con el backend ({configError}). Revisá que esté
        corriendo y que VITE_API_URL apunte ahí.
      </div>
    );
  }

  return (
    <div className="app">
      <AppStyles />

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
            {!configLoaded ? (
              <p className="section-sub">Cargando disponibilidad…</p>
            ) : (
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
            )}
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
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => (window.location.href = "/")}>
              Reservar otro turno
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Teko:wght@500;600;700&family=Work+Sans:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
      :root{
        --field:#122A20; --field-deep:#0B1D16; --field-panel:#1B3A2C;
        --turf:#7FB56A; --turf-soft:#31502F; --clay:#C97A4A; --clay-soft:#5B3A2A;
        --chalk:#F3EFE2; --chalk-dim:#C8CBB8; --flood:#F4C24C; --danger:#E1583C;
        --radius:10px;
      }
      *{box-sizing:border-box;}
      .app{ background:var(--field-deep); color:var(--chalk); font-family:'Work Sans', sans-serif; min-height:100vh; padding-bottom:60px; }
      .display{ font-family:'Teko', sans-serif; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; }
      .mono{ font-family:'Space Mono', monospace; }
      .hero{ padding:56px 24px 40px; background:radial-gradient(ellipse at 20% -10%, rgba(127,181,106,0.18), transparent 55%), var(--field); border-bottom:1px solid rgba(243,239,226,0.08); }
      .hero-inner{ max-width:960px; margin:0 auto; }
      .eyebrow{ font-family:'Space Mono', monospace; font-size:12px; letter-spacing:2px; text-transform:uppercase; color:var(--flood); margin-bottom:10px; }
      .hero h1{ font-size:clamp(42px, 9vw, 84px); line-height:0.92; margin:0 0 14px; }
      .hero p{ max-width:520px; color:var(--chalk-dim); font-size:16px; line-height:1.55; margin:0 0 26px; }
      .btn{ font-family:'Work Sans', sans-serif; font-weight:600; font-size:14px; border:none; border-radius:8px; padding:13px 22px; cursor:pointer; }
      .btn:disabled{ opacity:0.6; cursor:not-allowed; }
      .btn-primary{ background:var(--flood); color:#25200a; }
      .btn-ghost{ background:transparent; color:var(--chalk); border:1px solid rgba(243,239,226,0.35); }
      .btn-outline{ background:transparent; border:1px solid currentColor; padding:11px 18px; color:var(--chalk); }
      section{ max-width:960px; margin:0 auto; padding:44px 24px; }
      .section-title{ font-size:34px; margin:0 0 4px; }
      .section-sub{ color:var(--chalk-dim); font-size:14px; margin:0 0 26px; }
      .tabs{ display:flex; gap:10px; margin-bottom:22px; }
      .tab{ font-family:'Teko', sans-serif; font-size:22px; text-transform:uppercase; padding:9px 20px 6px; border-radius:999px; cursor:pointer; border:1px solid rgba(243,239,226,0.18); color:var(--chalk-dim); background:rgba(255,255,255,0.02); }
      .tab.active.futbol{ background:var(--turf-soft); color:var(--turf); border-color:var(--turf); }
      .tab.active.tenis{ background:var(--clay-soft); color:var(--clay); border-color:var(--clay); }
      .courts{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:30px; }
      @media(max-width:560px){ .courts{ grid-template-columns:1fr; } }
      .court-card{ border-radius:var(--radius); padding:16px 18px; cursor:pointer; border:1px solid rgba(243,239,226,0.12); background:var(--field-panel); }
      .court-card .name{ font-family:'Teko',sans-serif; font-size:24px; }
      .court-card.selected{ border-color:var(--accent); background:rgba(255,255,255,0.045); }
      .price-tag{ font-family:'Space Mono',monospace; font-size:12px; color:var(--chalk-dim); margin-top:8px; }
      .date-strip{ display:flex; gap:8px; overflow-x:auto; padding-bottom:6px; margin-bottom:26px; }
      .date-pill{ flex:0 0 auto; width:58px; text-align:center; padding:10px 0 8px; border-radius:10px; border:1px solid rgba(243,239,226,0.14); cursor:pointer; background:rgba(255,255,255,0.02); }
      .date-pill .wd{ font-size:11px; text-transform:uppercase; color:var(--chalk-dim); }
      .date-pill .d{ font-family:'Teko',sans-serif; font-size:26px; line-height:1; }
      .date-pill.selected{ border-color:var(--flood); background:rgba(255,255,255,0.05); }
      .board{ background:var(--field-deep); border:1px solid rgba(243,239,226,0.1); border-radius:12px; padding:18px; }
      .slot-grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(84px,1fr)); gap:8px; }
      .slot{ font-family:'Space Mono', monospace; font-size:14px; padding:12px 0; border-radius:6px; text-align:center; cursor:pointer; border:1px solid rgba(243,239,226,0.14); color:var(--chalk); background:rgba(255,255,255,0.02); }
      .slot.taken{ color:rgba(243,239,226,0.25); cursor:not-allowed; background:repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 6px, rgba(255,255,255,0.05) 6px 12px); }
      .hold-overlay{ position:fixed; inset:0; background:rgba(6,14,10,0.72); display:flex; align-items:center; justify-content:center; z-index:40; padding:16px; }
      .hold-card{ background:var(--field-panel); width:100%; max-width:460px; border-radius:16px; padding:26px 24px 30px; border:1px solid rgba(243,239,226,0.12); }
      .input{ width:100%; padding:11px 12px; border-radius:8px; border:1px solid rgba(243,239,226,0.2); background:var(--field-deep); color:var(--chalk); font-family:'Work Sans', sans-serif; font-size:14px; }
      .clock{ font-family:'Space Mono', monospace; font-size:54px; text-align:center; padding:14px 0; border-radius:10px; margin:14px 0 18px; background:var(--field-deep); border:1px solid rgba(243,239,226,0.1); }
      .clock.low{ color:var(--danger); border-color:var(--danger); }
      .row{ display:flex; justify-content:space-between; font-size:14px; padding:7px 0; border-bottom:1px dashed rgba(243,239,226,0.1); }
      .row b{ font-family:'Space Mono', monospace; }
      .hold-actions{ display:flex; gap:10px; margin-top:16px; }
      .hold-actions .btn{ flex:1; }
      .verifying{ display:flex; align-items:center; gap:10px; font-size:13px; color:var(--chalk-dim); justify-content:center; padding:16px 0; }
      .spinner{ width:14px; height:14px; border-radius:50%; border:2px solid rgba(243,239,226,0.25); border-top-color:var(--flood); animation:spin .8s linear infinite; }
      @keyframes spin{ to{ transform:rotate(360deg); } }
      .confirm-wrap{ display:grid; grid-template-columns:1fr; gap:16px; }
      .wa-bubble{ background:#0B141A; border:1px solid rgba(243,239,226,0.1); border-radius:12px; padding:16px; }
      .wa-head{ display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:12px; color:#8FD16A; }
      .wa-msg{ background:#1F2C34; border-radius:10px 10px 10px 2px; padding:12px 14px; font-size:13.5px; line-height:1.5; color:#E9EDEF; }
      .cal-card{ background:var(--field-panel); border:1px solid rgba(243,239,226,0.12); border-radius:12px; padding:18px; display:flex; flex-direction:column; gap:10px; }
      .cal-card h4{ margin:0; font-family:'Teko',sans-serif; font-size:22px; }
      .badge-ok{ display:inline-flex; align-items:center; gap:6px; font-size:12px; background:rgba(127,181,106,0.15); color:var(--turf); padding:5px 10px; border-radius:999px; }
      table{ width:100%; border-collapse:collapse; font-size:13px; }
      thead th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--chalk-dim); padding:8px 10px; border-bottom:1px solid rgba(243,239,226,0.14); }
      tbody td{ padding:10px; border-bottom:1px solid rgba(243,239,226,0.06); }
      .empty-row td{ color:var(--chalk-dim); text-align:center; padding:26px 10px; }
      footer{ text-align:center; padding:30px 24px 10px; color:var(--chalk-dim); font-size:12px; }
    `}</style>
  );
}
