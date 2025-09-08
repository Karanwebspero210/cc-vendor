// Use fetch directly since vite.config.js has proxy configured
async function getAllInventory(page = 1, limit = 50, search = "", params = {}) {
  try {
    // console.log("API call to inventory:", { page, limit, search });

    // Get token from localStorage
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", String(limit));
    if (search) query.set("search", search);

    // Forward stock filters when provided
    if (
      params &&
      Object.prototype.hasOwnProperty.call(params, "stockQtyMin") &&
      params.stockQtyMin !== undefined &&
      params.stockQtyMin !== ""
    ) {
      query.set("stockQtyMin", String(params.stockQtyMin));
    }
    if (
      params &&
      Object.prototype.hasOwnProperty.call(params, "stockQtyMax") &&
      params.stockQtyMax !== undefined &&
      params.stockQtyMax !== ""
    ) {
      query.set("stockQtyMax", String(params.stockQtyMax));
    }

    // Forward status filter(s)
    if (
      params &&
      typeof params.status === "string" &&
      params.status.trim() !== ""
    ) {
      query.set("status", params.status.trim());
    }
    // Forward sync status filter(s) - accept both keys
    if (
      params &&
      typeof params.syncStatus === "string" &&
      params.syncStatus.trim() !== ""
    ) {
      query.set("syncStatus", params.syncStatus.trim());
    }
    if (
      params &&
      typeof params.lastSyncStatus === "string" &&
      params.lastSyncStatus.trim() !== ""
    ) {
      query.set("lastSyncStatus", params.lastSyncStatus.trim());
    }

    const response = await fetch(`/api/inventory/all?${query.toString()}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // console.log("API response:", data);
    return data;
  } catch (error) {
    console.error("API error:", error);
    throw new Error(error.message || "Failed to fetch inventory");
  }
}

async function getProductInventory(productId) {
  try {
    // console.log("API call to product inventory:", { productId });

    // Get token from localStorage
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`/api/inventory/${productId}`, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // console.log("API response:", data);
    return data;
  } catch (error) {
    console.error("API error:", error);
    throw new Error(error.message || "Failed to fetch product inventory");
  }
}

export const inventoryApi = {
  getAllInventory,
  getProductInventory,
};

// New API: fetch mismatched variants (stockQty !== lastKnownShopifyQty)
async function getMismatchedInventory(
  page = 1,
  limit = 50,
  search = "",
  params = {}
) {
  try {
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("limit", String(limit));
    if (search) query.set("search", search);

    if (
      params &&
      Object.prototype.hasOwnProperty.call(params, "stockQtyMin") &&
      params.stockQtyMin !== undefined &&
      params.stockQtyMin !== ""
    ) {
      query.set("stockQtyMin", String(params.stockQtyMin));
    }
    if (
      params &&
      Object.prototype.hasOwnProperty.call(params, "stockQtyMax") &&
      params.stockQtyMax !== undefined &&
      params.stockQtyMax !== ""
    ) {
      query.set("stockQtyMax", String(params.stockQtyMax));
    }
    if (
      params &&
      typeof params.status === "string" &&
      params.status.trim() !== ""
    ) {
      query.set("status", params.status.trim());
    }
    if (
      params &&
      typeof params.syncStatus === "string" &&
      params.syncStatus.trim() !== ""
    ) {
      query.set("syncStatus", params.syncStatus.trim());
    }
    if (
      params &&
      typeof params.lastSyncStatus === "string" &&
      params.lastSyncStatus.trim() !== ""
    ) {
      query.set("lastSyncStatus", params.lastSyncStatus.trim());
    }

    const response = await fetch(
      `/api/inventory/mismatched?${query.toString()}`,
      {
        method: "GET",
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("API error:", error);
    throw new Error(error.message || "Failed to fetch mismatched inventory");
  }
}

// augment exports
inventoryApi.getMismatchedInventory = getMismatchedInventory;

// Download all inventory variants as CSV with optional filters
inventoryApi.downloadInventoryCsv = async function downloadInventoryCsv(
  params = {}
) {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const query = new URLSearchParams();
  if (typeof params.search === "string" && params.search.trim()) {
    query.set("search", params.search.trim());
  }
  if (typeof params.status === "string" && params.status.trim()) {
    query.set("status", params.status.trim());
  }
  if (typeof params.syncStatus === "string" && params.syncStatus.trim()) {
    query.set("syncStatus", params.syncStatus.trim());
  }
  if (
    Object.prototype.hasOwnProperty.call(params, "stockQtyMin") &&
    params.stockQtyMin !== undefined &&
    params.stockQtyMin !== ""
  ) {
    query.set("stockQtyMin", String(params.stockQtyMin));
  }
  if (
    Object.prototype.hasOwnProperty.call(params, "stockQtyMax") &&
    params.stockQtyMax !== undefined &&
    params.stockQtyMax !== ""
  ) {
    query.set("stockQtyMax", String(params.stockQtyMax));
  }

  const url = `/api/inventory/export${
    query.toString() ? `?${query.toString()}` : ""
  }`;
  const response = await fetch(url, { method: "GET", headers });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      text || `Failed to download CSV (status ${response.status})`
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(
    /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i
  );
  const filename = decodeURIComponent(
    match?.[1] || match?.[2] || `inventory-variants.csv`
  );

  const urlObj = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = urlObj;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(urlObj);
};
