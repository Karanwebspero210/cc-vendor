// Guard global fetch to auto-handle auth expiration across the app
import * as legacyServices from "./index";

function clearAuthAndRedirect() {
  try {
    legacyServices.removeToken?.();
  } catch (_) {}
  try {
    // Lazy import to avoid circular deps if any
    import("../utils/storage").then((m) => m.clearToken?.());
  } catch (_) {}
  try {
    window.location.href = "/login";
  } catch (_) {}
}

function shouldLogoutFromPayload(payload) {
  try {
    if (!payload || typeof payload !== "object") return false;
    const isFailure = payload.success === false || payload.status === "error";
    if (!isFailure) return false;
    const error = payload.error || {};
    const code = error && error.code;
    const message = (error && error.message) || payload.message || "";
    const tokenExpired = /token has expired/i.test(String(message || ""));
    return code === "AUTH_ERROR" || tokenExpired;
  } catch (_) {
    return false;
  }
}

// Only patch once
if (typeof window !== "undefined" && !window.__cc_fetch_guard_installed__) {
  window.__cc_fetch_guard_installed__ = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function guardedFetch(input, init) {
    const res = await originalFetch(input, init);
    try {
      if (res && (res.status === 401 || res.status === 403)) {
        clearAuthAndRedirect();
        return res;
      }

      // Clone and inspect JSON payload when possible
      const resClone = res.clone();
      const contentType = resClone.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await resClone.json().catch(() => null);
        if (shouldLogoutFromPayload(data)) {
          clearAuthAndRedirect();
        }
      }
    } catch (_) {
      // ignore guard errors
    }
    return res;
  };
}
