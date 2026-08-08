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

const HOURS = Array.from({ length: 13 }, (_, i) => 9 + i);
const WEEKDAYS = [
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mié", value: 3 },
  { label: "Jue", value: 4 },
  { label: "Vie", value: 5 },
  { label: "Sáb", value: 6 },
  { label: "Dom", value: 0 },
];

function datesInRange(startDate, endDate, weekdays) {
  if (!startDate || !endDate) return [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (end < start) return [];
  const out = [];
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    if (weekdays.length === 0 || weekdays.includes(d.getUTCDay())) {
      out.push(fmtDateKey(d));
    }
  }
  return out;
}

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

  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editCourtId, setEditCourtId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editHour, setEditHour] = useState(HOURS[0]);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const [actionError, setActionError] = useState(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCourtId, setBulkCourtId] = useState("");
  const [bulkHour, setBulkHour] = useState(HOURS[0]);
  const [bulkStart, setBulkStart] = useState(dateKey);
  const [bulkEnd, setBulkEnd] = useState(dateKey);
  const [bulkWeekdays, setBulkWeekdays] = useState([]);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkError, setBulkError] = useState(null);

  const [view, setView] = useState("calendar"); // "calendar" | "sheet"
  const [sheetData, setSheetData] = useState(null); // { header, rows, sheetUrl }
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);

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

  const loadSheet = useCallback(() => {
    if (!token) return;
    setSheetLoading(true);
    setSheetError(null);
    adminApi
      .getSheet(token)
      .then((r) => setSheetData(r))
      .catch((err) => setSheetError(err.message))
      .finally(() => setSheetLoading(false));
  }, [token]);

  useEffect(() => {
    if (view === "sheet" && !sheetData) loadSheet();
  }, [view, sheetData, loadSheet]);

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

  const closeDetail = () => {
    setDetailSlot(null);
    setCancelConfirmOpen(false);
    setEditOpen(false);
    setActionError(null);
  };

  const openCancelConfirm = () => {
    setCancelReason("");
    setActionError(null);
    setCancelConfirmOpen(true);
  };

  const confirmCancel = async () => {
    if (!detailSlot) return;
    setCancelBusy(true);
    setActionError(null);
    try {
      await adminApi.cancelReservation(detailSlot.reservationId, cancelReason.trim(), token);
      closeDetail();
      loadSchedule();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setCancelBusy(false);
    }
  };

  const openEdit = () => {
    if (!detailSlot) return;
    setEditCourtId(detailSlot.courtId);
    setEditDate(detailSlot.date);
    setEditHour(detailSlot.hour);
    setEditError(null);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!detailSlot) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await adminApi.updateReservation(
        detailSlot.reservationId,
        { courtId: editCourtId, date: editDate, hour: Number(editHour) },
        token
      );
      closeDetail();
      loadSchedule();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditBusy(false);
    }
  };

  const bulkDates = useMemo(
    () => datesInRange(bulkStart, bulkEnd, bulkWeekdays),
    [bulkStart, bulkEnd, bulkWeekdays]
  );

  const openBulk = () => {
    setBulkCourtId(courts[0]?.courtId || "");
    setBulkHour(HOURS[0]);
    setBulkStart(dateKey);
    setBulkEnd(dateKey);
    setBulkWeekdays([]);
    setBulkReason("");
    setBulkResult(null);
    setBulkError(null);
    setBulkOpen(true);
  };

  const toggleWeekday = (value) => {
    setBulkWeekdays((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  const submitBulk = async () => {
    if (!bulkCourtId || bulkDates.length === 0) return;
    setBulkError(null);
    try {
      const res = await adminApi.createBulkBlock(
        { courtId: bulkCourtId, hour: Number(bulkHour), dates: bulkDates, reason: bulkReason },
        token
      );
      setBulkResult(res);
      loadSchedule();
    } catch (err) {
      setBulkError(err.message);
    }
  };

  if (!token) {
    return (
      <main className="app admin-login">
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
      </main>
    );
  }

  return (
    <main className="app">
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
          <div className="admin-tabs" style={{ margin: "4px 0 14px" }}>
            <button
              className={`tab ${view === "calendar" ? "active futbol" : ""}`}
              onClick={() => setView("calendar")}
            >
              Calendario
            </button>
            <button className={`tab ${view === "sheet" ? "active futbol" : ""}`} onClick={() => setView("sheet")}>
              Planilla
            </button>
          </div>
          {view === "calendar" && (
            <button className="btn btn-primary" onClick={openBulk} style={{ marginRight: 10 }}>
              Bloquear varios turnos
            </button>
          )}
          <button className="btn btn-ghost" onClick={logout}>
            Salir
          </button>
        </div>
      </div>

      {view === "calendar" && (
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
                        setDetailSlot({
                          ...slot,
                          courtId: court.courtId,
                          courtName: court.courtName,
                          date: dateKey,
                        });
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
      )}

      {view === "sheet" && (
      <section>
        <div className="admin-sheet-head">
          <div>
            <h3 className="display" style={{ fontSize: 24, margin: "0 0 4px" }}>
              Planilla de turnos
            </h3>
            <p className="section-sub" style={{ margin: 0 }}>
              Se lee directo de Google Sheets — es la misma planilla que se actualiza sola con cada pago.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" onClick={loadSheet} disabled={sheetLoading}>
              {sheetLoading ? "Actualizando…" : "Actualizar"}
            </button>
            {sheetData?.sheetUrl && (
              <a href={sheetData.sheetUrl} target="_blank" rel="noreferrer" className="btn btn-outline">
                Abrir en Google Sheets
              </a>
            )}
          </div>
        </div>

        {sheetLoading && !sheetData && <p className="section-sub">Cargando planilla…</p>}
        {sheetError && <p style={{ color: "var(--danger)" }}>{sheetError}</p>}

        {sheetData && (
          <div className="admin-sheet-table-wrap">
            <table>
              <thead>
                <tr>
                  {sheetData.header.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetData.rows.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={sheetData.header.length || 1}>Todavía no hay turnos cargados.</td>
                  </tr>
                )}
                {sheetData.rows
                  .slice()
                  .reverse()
                  .map((row, i) => (
                    <tr key={i}>
                      {sheetData.header.map((_, colIdx) => (
                        <td key={colIdx}>{row[colIdx] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

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

      {detailSlot && !cancelConfirmOpen && !editOpen && (
        <div className="hold-overlay" onClick={closeDetail}>
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
            {actionError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{actionError}</p>}
            <div className="hold-actions" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={closeDetail}>
                Cerrar
              </button>
              <button className="btn btn-ghost" onClick={openEdit}>
                Modificar
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={openCancelConfirm}
              >
                Cancelar reserva
              </button>
            </div>
          </div>
        </div>
      )}

      {detailSlot && cancelConfirmOpen && (
        <div className="hold-overlay" onClick={() => setCancelConfirmOpen(false)}>
          <div className="hold-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Cancelar reserva</div>
            <p style={{ fontSize: 12.5, color: "var(--chalk-dim)", marginTop: 0 }}>
              Se libera el horario ({detailSlot.courtName}, {detailSlot.date} a las{" "}
              {String(detailSlot.hour).padStart(2, "0")}:00) y se le avisa a {detailSlot.clientName} por
              WhatsApp.
            </p>
            <input
              className="input"
              placeholder="Motivo (opcional, va en el mensaje al cliente)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              autoFocus
            />
            {actionError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{actionError}</p>}
            <div className="hold-actions">
              <button className="btn btn-ghost" onClick={() => setCancelConfirmOpen(false)} disabled={cancelBusy}>
                Volver
              </button>
              <button
                className="btn btn-primary"
                style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                onClick={confirmCancel}
                disabled={cancelBusy}
              >
                {cancelBusy ? "Cancelando…" : "Confirmar cancelación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailSlot && editOpen && (
        <div className="hold-overlay" onClick={() => setEditOpen(false)}>
          <div className="hold-card" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Modificar turno</div>
            <p style={{ fontSize: 12.5, color: "var(--chalk-dim)", marginTop: 0 }}>
              Se le avisa a {detailSlot.clientName} por WhatsApp con el horario anterior y el nuevo.
            </p>

            <label className="admin-field-label">Cancha</label>
            <select className="input" value={editCourtId} onChange={(e) => setEditCourtId(e.target.value)}>
              {courts.map((c) => (
                <option key={c.courtId} value={c.courtId}>
                  {c.courtName} — {c.sportLabel}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="admin-field-label">Fecha</label>
                <input className="input" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="admin-field-label">Horario</label>
                <select className="input" value={editHour} onChange={(e) => setEditHour(e.target.value)}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {editError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{editError}</p>}
            <div className="hold-actions">
              <button className="btn btn-ghost" onClick={() => setEditOpen(false)} disabled={editBusy}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={submitEdit} disabled={editBusy}>
                {editBusy ? "Guardando…" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkOpen && (
        <div className="hold-overlay" onClick={() => setBulkOpen(false)}>
          <div className="hold-card" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Bloquear varios turnos</div>
            <p style={{ fontSize: 12.5, color: "var(--chalk-dim)", marginTop: 0 }}>
              Mismo horario y cancha, en un rango de fechas — útil para una clase que se repite todas las
              semanas, o para bloquear varios días seguidos (mantenimiento, torneo, etc.).
            </p>

            <label className="admin-field-label">Cancha</label>
            <select className="input" value={bulkCourtId} onChange={(e) => setBulkCourtId(e.target.value)}>
              {courts.map((c) => (
                <option key={c.courtId} value={c.courtId}>
                  {c.courtName} — {c.sportLabel}
                </option>
              ))}
            </select>

            <label className="admin-field-label">Horario</label>
            <select className="input" value={bulkHour} onChange={(e) => setBulkHour(e.target.value)}>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="admin-field-label">Desde</label>
                <input
                  className="input"
                  type="date"
                  value={bulkStart}
                  onChange={(e) => setBulkStart(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="admin-field-label">Hasta</label>
                <input className="input" type="date" value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} />
              </div>
            </div>

            <label className="admin-field-label">
              Repetir sólo estos días (dejalo vacío para bloquear todos los días del rango)
            </label>
            <div className="admin-weekdays">
              {WEEKDAYS.map((w) => (
                <button
                  type="button"
                  key={w.value}
                  className={`admin-weekday ${bulkWeekdays.includes(w.value) ? "selected" : ""}`}
                  onClick={() => toggleWeekday(w.value)}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <label className="admin-field-label">Motivo</label>
            <input
              className="input"
              placeholder="Ej: clase de tenis con profe Juan"
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
            />

            <p style={{ fontSize: 12.5, color: "var(--chalk-dim)", margin: "12px 0 0" }}>
              Esto va a bloquear <b>{bulkDates.length}</b> turno{bulkDates.length === 1 ? "" : "s"}
              {bulkDates.length > 0 && ` (del ${bulkDates[0]} al ${bulkDates[bulkDates.length - 1]})`}.
              Cuando llegue el último, te mandamos un mail para avisar y que decidas si seguís bloqueando o lo
              liberás para alquilar.
            </p>

            {bulkError && <p style={{ color: "var(--danger)", fontSize: 13 }}>{bulkError}</p>}
            {bulkResult && (
              <p style={{ color: "var(--turf)", fontSize: 13 }}>
                Se bloquearon {bulkResult.createdCount} turnos.
                {bulkResult.skippedDates.length > 0 &&
                  ` ${bulkResult.skippedDates.length} ya estaban ocupados y no se tocaron: ${bulkResult.skippedDates.join(", ")}.`}
              </p>
            )}

            <div className="hold-actions">
              <button className="btn btn-ghost" onClick={() => setBulkOpen(false)}>
                Cerrar
              </button>
              <button className="btn btn-primary" onClick={submitBulk} disabled={bulkDates.length === 0}>
                Bloquear {bulkDates.length > 0 ? `(${bulkDates.length})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
