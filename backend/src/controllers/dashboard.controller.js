const Product = require("../models/Product");
const ProductVariant = require("../models/ProductVariant");
const Store = require("../models/Store");
const { ResponseHelper } = require("../utils/helpers");
const logger = require("../utils/logger");

/**
 * Get high-level dashboard statistics
 * @route GET /api/dashboard
 * @access Private (Admin)
 */
const getDashboardStats = async (req, res) => {
  try {
    const [
      totalProducts,
      totalVariants,
      totalStores,
      connectedStoresCount,
      disconnectedStoresCount,
      errorStoresCount,
      activeStores,
    ] = await Promise.all([
      Product.countDocuments({}),
      ProductVariant.countDocuments({}),
      Store.countDocuments({}),
      Store.countDocuments({ isActive: true, connectionStatus: "connected" }),
      Store.countDocuments({
        isActive: true,
        connectionStatus: "disconnected",
      }),
      Store.countDocuments({ isActive: true, connectionStatus: "error" }),
      Store.find({ isActive: true })
        .select(
          "name shopifyDomain connectionStatus lastConnectionCheck createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    return ResponseHelper.success(
      res,
      {
        totals: {
          totalProducts,
          totalVariants,
          totalStores,
          connectedStores: connectedStoresCount,
          disconnectedStores: disconnectedStoresCount,
          errorStores: errorStoresCount,
        },
        stores: activeStores,
      },
      "Dashboard stats retrieved successfully"
    );
  } catch (error) {
    logger.error("Failed to get dashboard stats:", error);
    return ResponseHelper.error(
      res,
      "Failed to get dashboard stats",
      500,
      "DASHBOARD_STATS_ERROR"
    );
  }
};

module.exports = {
  getDashboardStats,
};
