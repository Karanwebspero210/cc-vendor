const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const ProductVariant = require('../models/ProductVariant');
const Product = require('../models/Product');

/**
 * Inventory Controller (simplified)
 * Single endpoint to list inventory variants by product_id
 * Supports: pagination, status filter, stock quantity range, SKU search
 */
class InventoryController {
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
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
      const skip = (page - 1) * limit;

      // Filters
      const filter = {};

      // Status filter (single or CSV)
      if (typeof req.query.status === 'string' && req.query.status.trim().length) {
        const statuses = req.query.status.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      // SKU search (variantSku contains)
      if (typeof req.query.sku === 'string' && req.query.sku.trim().length) {
        filter.variantSku = { $regex: req.query.sku.trim(), $options: 'i' };
      }

      // Stock quantity range (validated, clamped, normalized)
      const stockQtyFilter = {};
      const hasMin = req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== '';
      const hasMax = req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== '';
      if (hasMin) {
        const min = Number(req.query.stockQtyMin);
        if (Number.isFinite(min)) stockQtyFilter.$gte = min < 0 ? 0 : min;
      }
      if (hasMax) {
        const max = Number(req.query.stockQtyMax);
        if (Number.isFinite(max)) stockQtyFilter.$lte = max;
      }
      if (stockQtyFilter.$gte !== undefined && stockQtyFilter.$lte !== undefined && stockQtyFilter.$gte > stockQtyFilter.$lte) {
        // swap to normalize range
        const tmp = stockQtyFilter.$gte;
        stockQtyFilter.$gte = stockQtyFilter.$lte;
        stockQtyFilter.$lte = tmp;
      }
      if (Object.keys(stockQtyFilter).length) {
        filter.stockQty = stockQtyFilter;
      }

      // Fetch total and items
      const [total, items] = await Promise.all([
        ProductVariant.countDocuments(filter),
        ProductVariant.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean()
      ]);

      const pages = Math.ceil(total / limit) || 1;

      return ResponseHelper.success(res, {
        items,
        pagination: {
          total,
          page,
          limit,
          pages,
          hasNextPage: page < pages,
          hasPrevPage: page > 1
        }
      }, 'Variants inventory retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving variants by product_id:', error);
      return ResponseHelper.error(res, 'Failed to retrieve variants inventory', 500, 'VARIANTS_INVENTORY_ERROR');
    }
  }  

  async getVariantsByProductId(req, res) {
    try {
      const productId = req.query.product_id || req.params.productId;
      if (!productId) {
        return ResponseHelper.error(res, 'product_id is required', 400, 'PRODUCT_ID_REQUIRED');
      }

      // Pagination
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
      const skip = (page - 1) * limit;

      // Filters
      const filter = { product_id: productId };

      // Status filter (single or CSV)
      if (typeof req.query.status === 'string' && req.query.status.trim().length) {
        const statuses = req.query.status.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length) filter.status = { $in: statuses };
      }

      // SKU search (variantSku contains)
      if (typeof req.query.sku === 'string' && req.query.sku.trim().length) {
        filter.variantSku = { $regex: req.query.sku.trim(), $options: 'i' };
      }

      // Stock quantity range (validated, clamped, normalized)
      const stockQtyFilter = {};
      const hasMin = req.query.stockQtyMin !== undefined && req.query.stockQtyMin !== '';
      const hasMax = req.query.stockQtyMax !== undefined && req.query.stockQtyMax !== '';
      if (hasMin) {
        const min = Number(req.query.stockQtyMin);
        if (Number.isFinite(min)) stockQtyFilter.$gte = min < 0 ? 0 : min;
      }
      if (hasMax) {
        const max = Number(req.query.stockQtyMax);
        if (Number.isFinite(max)) stockQtyFilter.$lte = max;
      }
      if (stockQtyFilter.$gte !== undefined && stockQtyFilter.$lte !== undefined && stockQtyFilter.$gte > stockQtyFilter.$lte) {
        const tmp = stockQtyFilter.$gte;
        stockQtyFilter.$gte = stockQtyFilter.$lte;
        stockQtyFilter.$lte = tmp;
      }
      if (Object.keys(stockQtyFilter).length) {
        filter.stockQty = stockQtyFilter;
      }

      // Fetch total and items
      const [total, items, product] = await Promise.all([
        ProductVariant.countDocuments(filter),
        ProductVariant.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.findById(productId).lean()
      ]);

      const pages = Math.ceil(total / limit) || 1;

      return ResponseHelper.success(res, {
        product: product || null,
        items,
        pagination: {
          total,
          page,
          limit,
          pages,
          hasNextPage: page < pages,
          hasPrevPage: page > 1
        }
      }, 'Variants inventory retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving variants by product_id:', error);
      return ResponseHelper.error(res, 'Failed to retrieve variants inventory', 500, 'VARIANTS_INVENTORY_ERROR');
    }
  }
}

module.exports = new InventoryController();
