const TOKEN_STORAGE_KEY = "cc_admin_token";

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token || "");
  } catch (_) {
    // ignore storage errors (e.g., private mode)
  }
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch (_) {
    return "";
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (_) {
    // ignore
  }
}

export function getAuthHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
