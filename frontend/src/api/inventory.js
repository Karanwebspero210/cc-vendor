// Use fetch directly since vite.config.js has proxy configured
async function getAllInventory(page = 1, limit = 50, search = "") {
  try {
    // console.log("API call to inventory:", { page, limit, search });

    // Get token from localStorage
    const token = localStorage.getItem("cc_admin_token");
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
    const response = await fetch(
      `/api/inventory/all?page=${page}&limit=${limit}${searchParam}`,
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
