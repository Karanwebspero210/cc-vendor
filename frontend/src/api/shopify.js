// Use fetch directly since vite.config.js has proxy configured

async function triggerSyncWithShopify() {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch("/api/shopify/sync-with-shopify", {
    method: "POST",
    headers,
    // body: JSON.stringify({ maxUpdates }),
    body: JSON.stringify({}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error || `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function getSyncStatus(
  status = "unsynced",
  page = 1,
  limit = 25,
  search = ""
) {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const params = new URLSearchParams();
  params.set("status", status);
  params.set("page", String(page));
  params.set("limit", String(limit));
  if (search) params.set("search", search);

  const response = await fetch(
    `/api/shopify/sync-status?${params.toString()}`,
    {
      method: "GET",
      headers,
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error || `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export const shopifyApi = {
  triggerSyncWithShopify,
  getSyncStatus,
};

// New: Bulk update mismatched Shopify inventory to match local stockQty
export async function updateMismatchedInventory({
  // limit = 10,
  dryRun = false,
} = {}) {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`/api/shopify/mismatched/update`, {
    method: "POST",
    headers,
    // body: JSON.stringify({ limit, dryRun }),
    body: JSON.stringify({ dryRun }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error || `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

// New: Update selected variants by SKUs
export async function updateSelectedInventory({
  variantSkus = [],
  dryRun = false,
} = {}) {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`/api/shopify/selected/update`, {
    method: "POST",
    headers,
    body: JSON.stringify({ variantSkus, dryRun }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error || `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

// New: Get Shopify job status by SyncJob document id
export async function getShopifyJobStatus(jobId) {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`/api/shopify/jobs/${jobId}`, {
    method: "GET",
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error || `HTTP error! status: ${response.status}`;
    throw new Error(message);
  }
  return data;
}

// New: Download CSV for a Shopify job's details (unsynced/synced/all)
export async function downloadShopifyJobCsv(jobId, type = "unsynced") {
  const token = localStorage.getItem("cc_admin_token");
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(
    `/api/shopify/jobs/${jobId}/export?type=${encodeURIComponent(type)}`,
    {
      method: "GET",
      headers,
    }
  );

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
    match?.[1] || match?.[2] || `shopify-job-${jobId}-${type}.csv`
  );

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
