const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  getConfig: () => request("/config"),
  getAvailability: (courtId, date) =>
    request(`/availability?courtId=${courtId}&date=${date}`),
  createHold: (payload) =>
    request("/holds", { method: "POST", body: JSON.stringify(payload) }),
  getHold: (id) => request(`/holds/${id}`),
  startPayment: (id) => request(`/holds/${id}/pay`, { method: "POST" }),
  getReservations: () => request("/reservations"),
  getReservation: (id) => request(`/reservations/${id}`),
};

export const adminApi = {
  getSchedule: (date, token) =>
    request(`/admin/schedule?date=${date}`, { headers: { "x-admin-token": token } }),
  createBlock: (payload, token) =>
    request("/admin/blocks", {
      method: "POST",
      headers: { "x-admin-token": token },
      body: JSON.stringify(payload),
    }),
  createBulkBlock: (payload, token) =>
    request("/admin/blocks/bulk", {
      method: "POST",
      headers: { "x-admin-token": token },
      body: JSON.stringify(payload),
    }),
  removeBlock: (id, token) =>
    request(`/admin/blocks/${id}`, { method: "DELETE", headers: { "x-admin-token": token } }),
  checkAlertsNow: (token) =>
    request("/admin/check-alerts", { method: "POST", headers: { "x-admin-token": token } }),
};
