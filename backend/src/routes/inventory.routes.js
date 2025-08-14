const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { readOnlyLimiter } = require('../middleware/rate-limit.middleware');
const inventoryController = require('../controllers/inventory.controller');

const router = express.Router();

// Auth + rate limit for inventory routes
router.use(authenticateAdmin);
router.use(readOnlyLimiter);

/**
 * @route GET /api/inventory/all
 * @desc List all variants (inventory) for all products with pagination and filters
 *        Query: page, limit, status, sku, stockQtyMin, stockQtyMax
 * @access Private
 */
router.get('/all', validate.inventoryList, inventoryController.getAllProductsVariantsInventory);

/**
 * @route GET /api/inventory/:productId/
 * @desc Alias route to list variants by productId param
 * @access Private
 */
router.get('/:productId', validate.inventoryList, inventoryController.getVariantsByProductId);

module.exports = router;
