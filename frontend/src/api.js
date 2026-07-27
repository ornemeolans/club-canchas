const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
