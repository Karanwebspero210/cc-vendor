// Use fetch directly since vite.config.js has proxy configured
async function getProducts(page = 1, limit = 20, search = "") {
  try {
    // console.log("API call to products:", { page, limit, search });

    // Get token from localStorage
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
    const response = await fetch(
      `/api/products/?page=${page}&limit=${limit}${searchParam}`,
      {
        method: "GET",
        headers,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    // console.log("API response:", data);
    return data;
  } catch (error) {
    console.error("API error:", error);
    throw new Error(error.message || "Failed to fetch products");
  }
}

export const productsApi = {
  getProducts,
  async downloadProductsCsv(params = {}) {
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const query = new URLSearchParams();
    if (params && typeof params.search === "string" && params.search.trim()) {
      query.set("search", params.search.trim());
    }

    const url = `/api/products/export${
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
      match?.[1] || match?.[2] || `products.csv`
    );

    const urlObj = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(urlObj);
  },
  async startProductSync(page = 1, limit = 100) {
    try {
      const token = localStorage.getItem("cc_admin_token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const response = await fetch(`/api/products/sync`, {
        method: "POST",
        headers,
        body: JSON.stringify({ page, limit }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          data?.message ||
          data?.error ||
          `HTTP error! status: ${response.status}`;
        throw new Error(message);
      }
      return data;
    } catch (error) {
      console.error("API error (startProductSync):", error);
      throw new Error(error.message || "Failed to start product sync");
    }
  },
  async updateInventoryBySKUs(skus = []) {
    try {
      const token = localStorage.getItem("cc_admin_token");
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const response = await fetch(`/api/products/inventory/update`, {
        method: "POST",
        headers,
        body: JSON.stringify({ skus }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          data?.message ||
          data?.error ||
          `HTTP error! status: ${response.status}`;
        throw new Error(message);
      }
      return data;
    } catch (error) {
      console.error("API error (updateInventoryBySKUs):", error);
      throw new Error(error.message || "Failed to start inventory update");
    }
  },
};
