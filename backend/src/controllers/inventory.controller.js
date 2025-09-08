const { ResponseHelper } = require("../utils/helpers");
const logger = require("../utils/logger");
const ProductVariant = require("../models/ProductVariant");
const Product = require("../models/Product");

/**
 * Inventory Controller (simplified)
 * Single endpoint to list inventory variants by product_id
 * Supports: pagination, status filter, stock quantity range, SKU search
 */
class InventoryController {
  // Safely escape user-provided text for Mongo $regex
  static escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  /**
   * List variants inventory across ALL products
   * Query params:
   * - page (default 1), limit (default 50)
   * - status: single value or comma-separated values of ['Active','Inactive','Discontinued']
   * - sku: substring search against variantSku (case-insensitive)
   * - stockQtyMin, stockQtyMax: numeric range filter on stockQty
   */
  async getAllProductsVariantsInventory(req, res) {
    try {
      // Pagination
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10), 1),
        200
      );
      const skip = (page - 1) * limit;

      // Filters
      const filter = {};

      // Status filter (single or CSV)
      if (
        typeof req.query.status === "string" &&
        req.query.status.trim().length
      ) {
        const statuses = req.query.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      // Sync status filter (support keys: syncStatus or lastSyncStatus) - single or CSV
      {
        const syncKey = Object.keys(req.query).find((k) =>
          ["syncstatus", "lastsyncstatus"].includes(k.toString().toLowerCase())
        );
        if (syncKey && typeof req.query[syncKey] === "string") {
          const raw = req.query[syncKey].trim();
          if (raw.length) {
            const values = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (values.length) filter.lastSyncStatus = { $in: values };
          }
        }
      }

      console.log(req.query.sku);

      // SKU search (variantSku contains) - support aliases and escape regex
      {
        // Find any key matching sku aliases (case-insensitive)
        const aliases = ["sku", "variantSku", "variant_sku", "search"];
        const key = Object.keys(req.query).find((k) =>
          aliases.includes(k.toString().toLowerCase())
        );
        const rawSku =
          key && typeof req.query[key] === "string" ? req.query[key] : "";
        if (rawSku && rawSku.trim().length) {
          const trimmed = rawSku.trim();
          const pattern = InventoryController.escapeRegex(trimmed);
          filter.variantSku = { $regex: pattern, $options: "i" };
          logger.debug("Applying SKU filter for inventory/all", {
            key,
            rawSku: trimmed,
            pattern,
          });
        }
      }

      // Stock quantity filter: exact match when single value; inclusive range when both
      {
        const hasMin =
          req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== "";
        const hasMax =
          req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== "";
        const min = Number(req.query.stockQtyMin);
        const max = Number(req.query.stockQtyMax);
        const minValid = Number.isFinite(min);
        const maxValid = Number.isFinite(max);

        if (hasMin && !hasMax && minValid) {
          // Single min provided => exact match (clamped to 0 if negative)
          filter.stockQty = min < 0 ? 0 : min;
        } else if (!hasMin && hasMax && maxValid) {
          // Single max provided => exact match
          filter.stockQty = max;
        } else if (hasMin && hasMax) {
          if (minValid && maxValid) {
            const adjustedMin = min < 0 ? 0 : min;
            if (adjustedMin === max) {
              filter.stockQty = adjustedMin;
            } else {
              let low = adjustedMin;
              let high = max;
              if (low > high) {
                const t = low;
                low = high;
                high = t;
              }
              filter.stockQty = { $gte: low, $lte: high };
            }
          } else if (minValid) {
            filter.stockQty = min < 0 ? 0 : min;
          } else if (maxValid) {
            filter.stockQty = max;
          }
        }
      }

      // Fetch total and items
      const [total, items] = await Promise.all([
        ProductVariant.countDocuments(filter),
        ProductVariant.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const pages = Math.ceil(total / limit) || 1;

      return ResponseHelper.success(
        res,
        {
          items,
          pagination: {
            total,
            page,
            limit,
            pages,
            hasNextPage: page < pages,
            hasPrevPage: page > 1,
          },
        },
        "Variants inventory retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving variants by product_id:", error);
      return ResponseHelper.error(
        res,
        "Failed to retrieve variants inventory",
        500,
        "VARIANTS_INVENTORY_ERROR"
      );
    }
  }

  /**
   * List variants where stockQty !== lastKnownShopifyQty
   * Supports same pagination and filters as getAllProductsVariantsInventory
   */
  async getMismatchedVariantsInventory(req, res) {
    try {
      // Pagination
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10), 1),
        200
      );
      const skip = (page - 1) * limit;

      // Base filter: only where Shopify qty is known
      const filter = { lastKnownShopifyQty: { $ne: null } };

      // Status filter (single or CSV)
      if (
        typeof req.query.status === "string" &&
        req.query.status.trim().length
      ) {
        const statuses = req.query.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      // Sync status filter (support keys: syncStatus or lastSyncStatus) - single or CSV
      {
        const syncKey = Object.keys(req.query).find((k) =>
          ["syncstatus", "lastsyncstatus"].includes(k.toString().toLowerCase())
        );
        if (syncKey && typeof req.query[syncKey] === "string") {
          const raw = req.query[syncKey].trim();
          if (raw.length) {
            const values = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (values.length) filter.lastSyncStatus = { $in: values };
          }
        }
      }

      // SKU search (variantSku contains) - support aliases and escape regex
      {
        const aliases = ["sku", "variantSku", "variant_sku", "search"];
        const key = Object.keys(req.query).find((k) =>
          aliases.includes(k.toString().toLowerCase())
        );
        const rawSku =
          key && typeof req.query[key] === "string" ? req.query[key] : "";
        if (rawSku && rawSku.trim().length) {
          const trimmed = rawSku.trim();
          const pattern = InventoryController.escapeRegex(trimmed);
          filter.variantSku = { $regex: pattern, $options: "i" };
        }
      }

      // Optional stock qty range (applies to vendor stock only)
      {
        const hasMin =
          req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== "";
        const hasMax =
          req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== "";
        const min = Number(req.query.stockQtyMin);
        const max = Number(req.query.stockQtyMax);
        const minValid = Number.isFinite(min);
        const maxValid = Number.isFinite(max);

        if (hasMin && !hasMax && minValid) {
          filter.stockQty = min < 0 ? 0 : min;
        } else if (!hasMin && hasMax && maxValid) {
          filter.stockQty = max;
        } else if (hasMin && hasMax) {
          if (minValid && maxValid) {
            const adjustedMin = min < 0 ? 0 : min;
            if (adjustedMin === max) {
              filter.stockQty = adjustedMin;
            } else {
              let low = adjustedMin;
              let high = max;
              if (low > high) {
                const t = low;
                low = high;
                high = t;
              }
              filter.stockQty = { $gte: low, $lte: high };
            }
          } else if (minValid) {
            filter.stockQty = min < 0 ? 0 : min;
          } else if (maxValid) {
            filter.stockQty = max;
          }
        }
      }

      // Mongo expression: stockQty != lastKnownShopifyQty
      const expr = { $expr: { $ne: ["$stockQty", "$lastKnownShopifyQty"] } };

      const query = { ...filter, ...expr };

      const [total, items] = await Promise.all([
        ProductVariant.countDocuments(query),
        ProductVariant.find(query)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      const pages = Math.ceil(total / limit) || 1;

      return ResponseHelper.success(
        res,
        {
          items,
          pagination: {
            total,
            page,
            limit,
            pages,
            hasNextPage: page < pages,
            hasPrevPage: page > 1,
          },
        },
        "Mismatched variants inventory retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving mismatched variants:", error);
      return ResponseHelper.error(
        res,
        "Failed to retrieve mismatched variants",
        500,
        "VARIANTS_MISMATCH_ERROR"
      );
    }
  }

  async getVariantsByProductId(req, res) {
    try {
      const productId = req.query.product_id || req.params.productId;
      if (!productId) {
        return ResponseHelper.error(
          res,
          "product_id is required",
          400,
          "PRODUCT_ID_REQUIRED"
        );
      }

      // Pagination
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10), 1),
        200
      );
      const skip = (page - 1) * limit;

      // Filters
      const filter = { product_id: productId };

      // Status filter (single or CSV)
      if (
        typeof req.query.status === "string" &&
        req.query.status.trim().length
      ) {
        const statuses = req.query.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      // Sync status filter (support keys: syncStatus or lastSyncStatus) - single or CSV
      {
        const syncKey = Object.keys(req.query).find((k) =>
          ["syncstatus", "lastsyncstatus"].includes(k.toString().toLowerCase())
        );
        if (syncKey && typeof req.query[syncKey] === "string") {
          const raw = req.query[syncKey].trim();
          if (raw.length) {
            const values = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (values.length) filter.lastSyncStatus = { $in: values };
          }
        }
      }

      // SKU search (variantSku contains) - support aliases and escape regex
      {
        const rawSku =
          (typeof req.query.sku === "string" && req.query.sku) ||
          (typeof req.query.variantSku === "string" && req.query.variantSku) ||
          (typeof req.query.search === "string" && req.query.search) ||
          "";
        if (rawSku && rawSku.trim().length) {
          const pattern = InventoryController.escapeRegex(rawSku.trim());
          filter.variantSku = { $regex: pattern, $options: "i" };
        }
      }

      // Stock quantity filter: exact match when single value; inclusive range when both
      {
        const hasMin =
          req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== "";
        const hasMax =
          req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== "";
        const min = Number(req.query.stockQtyMin);
        const max = Number(req.query.stockQtyMax);
        const minValid = Number.isFinite(min);
        const maxValid = Number.isFinite(max);

        if (hasMin && !hasMax && minValid) {
          // Single min provided => exact match (clamped to 0 if negative)
          filter.stockQty = min < 0 ? 0 : min;
        } else if (!hasMin && hasMax && maxValid) {
          // Single max provided => exact match
          filter.stockQty = max;
        } else if (hasMin && hasMax) {
          if (minValid && maxValid) {
            const adjustedMin = min < 0 ? 0 : min;
            if (adjustedMin === max) {
              filter.stockQty = adjustedMin;
            } else {
              let low = adjustedMin;
              let high = max;
              if (low > high) {
                const t = low;
                low = high;
                high = t;
              }
              filter.stockQty = { $gte: low, $lte: high };
            }
          } else if (minValid) {
            filter.stockQty = min < 0 ? 0 : min;
          } else if (maxValid) {
            filter.stockQty = max;
          }
        }
      }

      // Fetch total and items
      const [total, items, product] = await Promise.all([
        ProductVariant.countDocuments(filter),
        ProductVariant.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.findById(productId).lean(),
      ]);

      const pages = Math.ceil(total / limit) || 1;

      return ResponseHelper.success(
        res,
        {
          product: product || null,
          items,
          pagination: {
            total,
            page,
            limit,
            pages,
            hasNextPage: page < pages,
            hasPrevPage: page > 1,
          },
        },
        "Variants inventory retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving variants by product_id:", error);
      return ResponseHelper.error(
        res,
        "Failed to retrieve variants inventory",
        500,
        "VARIANTS_INVENTORY_ERROR"
      );
    }
  }

  /**
   * Export all inventory variants as CSV
   * @route GET /api/inventory/export
   * Supports same filters as list: status, sku/search, stockQtyMin/Max, syncStatus
   */
  async exportAllInventoryCsv(req, res) {
    try {
      const filter = {};

      if (
        typeof req.query.status === "string" &&
        req.query.status.trim().length
      ) {
        const statuses = req.query.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      {
        const syncKey = Object.keys(req.query).find((k) =>
          ["syncstatus", "lastsyncstatus"].includes(k.toString().toLowerCase())
        );
        if (syncKey && typeof req.query[syncKey] === "string") {
          const raw = req.query[syncKey].trim();
          if (raw.length) {
            const values = raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (values.length) filter.lastSyncStatus = { $in: values };
          }
        }
      }

      {
        const aliases = ["sku", "variantSku", "variant_sku", "search"];
        const key = Object.keys(req.query).find((k) =>
          aliases.includes(k.toString().toLowerCase())
        );
        const rawSku =
          key && typeof req.query[key] === "string" ? req.query[key] : "";
        if (rawSku && rawSku.trim().length) {
          const trimmed = rawSku.trim();
          const pattern = InventoryController.escapeRegex(trimmed);
          filter.variantSku = { $regex: pattern, $options: "i" };
        }
      }

      {
        const hasMin =
          req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== "";
        const hasMax =
          req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== "";
        const min = Number(req.query.stockQtyMin);
        const max = Number(req.query.stockQtyMax);
        const minValid = Number.isFinite(min);
        const maxValid = Number.isFinite(max);

        if (hasMin && !hasMax && minValid) {
          filter.stockQty = min < 0 ? 0 : min;
        } else if (!hasMin && hasMax && maxValid) {
          filter.stockQty = max;
        } else if (hasMin && hasMax) {
          if (minValid && maxValid) {
            const adjustedMin = min < 0 ? 0 : min;
            if (adjustedMin === max) {
              filter.stockQty = adjustedMin;
            } else {
              let low = adjustedMin;
              let high = max;
              if (low > high) {
                const t = low;
                low = high;
                high = t;
              }
              filter.stockQty = { $gte: low, $lte: high };
            }
          } else if (minValid) {
            filter.stockQty = min < 0 ? 0 : min;
          } else if (maxValid) {
            filter.stockQty = max;
          }
        }
      }

      const projection =
        "variantSku mainSku color size stockQty status shopifyVariantId shopifyInventoryItemId lastKnownShopifyQty lastSyncAt updatedAt";
      const items = await ProductVariant.find(filter)
        .sort({ updatedAt: -1 })
        .select(projection)
        .lean();

      const headers = [
        "variantSku",
        "mainSku",
        "color",
        "size",
        "stockQty",
        "status",
        "shopifyVariantId",
        "shopifyInventoryItemId",
        "lastKnownShopifyQty",
        "lastSyncAt",
        "updatedAt",
      ];

      const escapeCsv = (value) => {
        if (value === null || value === undefined) return "";
        const str = String(value);
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const rows = items.map((it) =>
        [
          escapeCsv(it.variantSku || ""),
          escapeCsv(it.mainSku || ""),
          escapeCsv(it.color || ""),
          escapeCsv(it.size || ""),
          escapeCsv(typeof it.stockQty === "number" ? it.stockQty : ""),
          escapeCsv(it.status || ""),
          escapeCsv(it.shopifyVariantId || ""),
          escapeCsv(it.shopifyInventoryItemId || ""),
          escapeCsv(
            typeof it.lastKnownShopifyQty === "number"
              ? it.lastKnownShopifyQty
              : ""
          ),
          escapeCsv(it.lastSyncAt ? new Date(it.lastSyncAt).toISOString() : ""),
          escapeCsv(it.updatedAt ? new Date(it.updatedAt).toISOString() : ""),
        ].join(",")
      );

      const csv = [headers.join(","), ...rows].join("\n");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `inventory-variants-${ts}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      return res.status(200).send(csv);
    } catch (error) {
      logger.error("Error exporting inventory CSV:", error);
      return ResponseHelper.error(
        res,
        "Failed to export inventory CSV",
        500,
        "INVENTORY_CSV_EXPORT_ERROR"
      );
    }
  }
}

module.exports = new InventoryController();
