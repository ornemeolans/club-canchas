import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api, adminApi } from "./api.js";
import "./styles.css";
import "./admin.css";

const CLUB_TIMEZONE = "America/Argentina/Buenos_Aires";

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
  return { year: get("year"), month: get("month"), day: get("day") };
}

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

const STATUS_LABEL = {
  available: "Disponible",
  reserved: "Reservado",
  blocked: "Bloqueado",
  holding: "Reservando…",
  past: "Pasó",
};

export default function Admin() {
  const [token, setToken] = useState(() => localStorage.getItem("admin_token") || "");
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState(null);

  const days = useMemo(() => nextDays(14), []);
  const [dateIdx, setDateIdx] = useState(0);
  const dateKey = fmtDateKey(days[dateIdx]);

  const [courts, setCourts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [blockTarget, setBlockTarget] = useState(null); // { courtId, courtName, hour }
  const [blockReason, setBlockReason] = useState("");
  const [detailSlot, setDetailSlot] = useState(null); // reserved slot detail popover

  const loadSchedule = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    adminApi
      .getSchedule(dateKey, token)
      .then((r) => setCourts(r.courts))
      .catch((err) => {
        if (err.message === "No autorizado") {
          setAuthError("La clave no es correcta.");
          setToken("");
          localStorage.removeItem("admin_token");
        } else {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [token, dateKey]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  const submitToken = (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    localStorage.setItem("admin_token", tokenInput.trim());
    setToken(tokenInput.trim());
    setAuthError(null);
  };

  const logout = () => {
    localStorage.removeItem("admin_token");
    setToken("");
    setTokenInput("");
  };

  const openBlock = (courtId, courtName, hour) => {
    setBlockTarget({ courtId, courtName, hour });
    setBlockReason("");
  };

  const confirmBlock = async () => {
    if (!blockTarget) return;
    try {
      await adminApi.createBlock(
        { courtId: blockTarget.courtId, date: dateKey, hour: blockTarget.hour, reason: blockReason },
        token
      );
      setBlockTarget(null);
      loadSchedule();
    } catch (err) {
      setError(err.message);
    }
  };

  const unblock = async (blockId) => {
    try {
      await adminApi.removeBlock(blockId, token);
      loadSchedule();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!token) {
    return (
      <div className="app admin-login">
        <style>{`.admin-login{display:flex;align-items:center;justify-content:center;min-height:100vh;}`}</style>
        <form className="admin-login-card" onSubmit={submitToken}>
          <div className="eyebrow">Club Canchas — Admin</div>
          <h2 className="display" style={{ fontSize: 30, margin: "6px 0 16px" }}>
            Ingresá la clave
          </h2>
          <input
            className="input"
            type="password"
            placeholder="Clave de administrador"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            autoFocus
          />
          {authError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{authError}</p>}
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 14 }}>
            Entrar
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="hero admin-hero">
        <div className="hero-inner">
          <div className="eyebrow">Panel de administrador</div>
          <h1 className="display" style={{ fontSize: "clamp(32px, 6vw, 54px)" }}>
            Calendario de canchas
          </h1>
          <p style={{ marginBottom: 10 }}>
            Tocá un horario disponible para bloquearlo (clases, mantenimiento), o uno bloqueado para volver a
            habilitarlo.
          </p>
          <button className="btn btn-ghost" onClick={logout}>
            Salir
          </button>
        </div>
      </div>

      <section>
        <div className="date-strip">
          {days.map((d, i) => {
            const { weekday, day } = fmtDateLabel(d);
            return (
              <div
                key={i}
                className={`date-pill ${i === dateIdx ? "selected" : ""}`}
                onClick={() => setDateIdx(i)}
              >
                <div className="wd">{weekday}</div>
                <div className="d display">{day}</div>
              </div>
            );
          })}
        </div>

        {loading && <p className="section-sub">Cargando...</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="admin-grid">
          {courts.map((court) => (
            <div key={court.courtId} className="admin-court">
              <div className="admin-court-head">
                <span className="display">{court.courtName}</span>
                <span className="section-sub" style={{ margin: 0 }}>
                  {court.sportLabel}
                </span>
              </div>
              <div className="admin-slot-grid">
                {court.hours.map((slot) => (
                  <button
                    key={slot.hour}
                    className={`admin-slot admin-slot-${slot.status}`}
                    disabled={slot.status === "past" || slot.status === "holding"}
                    onClick={() => {
                      if (slot.status === "available") {
                        openBlock(court.courtId, court.courtName, slot.hour);
                      } else if (slot.status === "blocked") {
                        unblock(slot.blockId);
                      } else if (slot.status === "reserved") {
                        setDetailSlot({ ...slot, courtName: court.courtName });
                      }
                    }}
                    title={
                      slot.status === "reserved"
                        ? `${slot.clientName} — ${slot.clientPhone}`
                        : slot.status === "blocked"
                        ? slot.reason || "Bloqueado"
                        : STATUS_LABEL[slot.status]
                    }
                  >
                    {String(slot.hour).padStart(2, "0")}:00
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="admin-legend">
          <span>
            <span className="dot" style={{ background: "var(--turf)" }} /> Disponible
          </span>
          <span>
            <span className="dot" style={{ background: "var(--flood)" }} /> Reservado
          </span>
          <span>
            <span className="dot" style={{ background: "var(--danger)" }} /> Bloqueado
          </span>
          <span>
            <span className="dot" style={{ background: "rgba(243,239,226,0.2)" }} /> Pasó / en curso de pago
          </span>
        </div>
      </section>

      {blockTarget && (
        <div className="hold-overlay" onClick={() => setBlockTarget(null)}>
          <div className="hold-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Bloquear horario</div>
            <div className="row">
              <span>Cancha</span>
              <b>{blockTarget.courtName}</b>
            </div>
            <div className="row">
              <span>Horario</span>
              <b>{String(blockTarget.hour).padStart(2, "0")}:00</b>
            </div>
            <input
              className="input"
              style={{ marginTop: 14 }}
              placeholder="Motivo (ej: clase de fútbol infantil)"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              autoFocus
            />
            <div className="hold-actions">
              <button className="btn btn-ghost" onClick={() => setBlockTarget(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={confirmBlock}>
                Bloquear
              </button>
            </div>
          </div>
        </div>
      )}

      {detailSlot && (
        <div className="hold-overlay" onClick={() => setDetailSlot(null)}>
          <div className="hold-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Turno reservado</div>
            <div className="row">
              <span>Cancha</span>
              <b>{detailSlot.courtName}</b>
            </div>
            <div className="row">
              <span>Horario</span>
              <b>{String(detailSlot.hour).padStart(2, "0")}:00</b>
            </div>
            <div className="row">
              <span>Cliente</span>
              <b>{detailSlot.clientName}</b>
            </div>
            <div className="row">
              <span>WhatsApp</span>
              <b>{detailSlot.clientPhone}</b>
            </div>
            <div className="row">
              <span>Monto</span>
              <b>${detailSlot.amount?.toLocaleString("es-AR")}</b>
            </div>
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => setDetailSlot(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
