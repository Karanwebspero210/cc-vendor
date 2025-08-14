import { getAuthHeader } from "../utils/storage";

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
    ...(options.headers || {}),
  };

  const response = await fetch(path, { ...options, headers });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // not json
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      response.statusText ||
      "Request failed";
    throw new Error(message);
  }

  return payload;
}

async function login({ password }) {
  const body = JSON.stringify({ password });
  const res = await request("/api/auth/login", { method: "POST", body });
  const token = res?.data?.token || res?.token;
  return { ...res, token };
}

async function changePassword({ currentPassword, newPassword }) {
  const body = JSON.stringify({ currentPassword, newPassword });
  return request("/api/auth/change-password", { method: "POST", body });
}

export const authApi = {
  login,
  changePassword,
};
