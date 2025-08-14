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
};
