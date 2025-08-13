const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { defaultLimiter, syncLimiter } = require('../middleware/rate-limit.middleware');
const productController = require('../controllers/product.controller');

const router = express.Router();

// Apply authentication to all product routes
router.use(authenticateAdmin);

// Apply rate limiting
router.use(defaultLimiter);

/**
 * @route POST /api/products/sync
 * @desc Start a new product sync job
 * @access Private (Admin)
 * @body {number} [page=1] - Page number to start syncing from
 * @body {number} [limit=100] - Number of products per page
 * @returns {Object} - Job information including jobId
 */
router.post('/sync', syncLimiter, productController.startProductSync);


/**
 * @route GET /api/products
 * @desc Get all products with pagination and search
 * @access Private (Admin)
 * @query {number} [page=1] - Page number
 * @query {number} [limit=50] - Items per page
 * @query {string} [search] - Search term for sku, title, or description
 */
router.get('/', productController.getProducts);

/**
 * @route POST /api/products/inventory/update
 * @desc Update inventory for specific SKUs
 * @access Private (Admin)
 * @body {string[]} skus - Array of SKUs to update inventory for
 * @returns {Object} - Job information including jobId
 */
router.post('/inventory/update', syncLimiter, productController.updateInventoryBySKUs);


module.exports = router;
