const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { defaultLimiter, readOnlyLimiter } = require('../middleware/rate-limit.middleware');
const { ResponseHelper } = require('../utils/helpers');
const vendorController = require('../controllers/vendor.controller');

const router = express.Router();

// Apply authentication to all vendor routes
router.use(authenticateAdmin);

// Apply rate limiting
router.use('/*/products', readOnlyLimiter);
router.use('/*/inventory', readOnlyLimiter);
router.use(defaultLimiter);

/**
 * @route GET /api/vendors
 * @desc Get all configured vendors
 * @access Private
 */
router.get('/', validate.pagination, vendorController.getVendors);

/**
 * @route POST /api/vendors
 * @desc Add a new vendor configuration
 * @access Private
 */
router.post('/', validate.vendor.create, vendorController.createVendor);

/**
 * @route GET /api/vendors/:id
 * @desc Get vendor by ID
 * @access Private
 */
router.get('/:id', validate.mongoId, vendorController.getVendorById);

/**
 * @route PUT /api/vendors/:id
 * @desc Update vendor configuration
 * @access Private
 */
router.put('/:id', validate.mongoId, validate.vendor.update, vendorController.updateVendor);

/**
 * @route DELETE /api/vendors/:id
 * @desc Remove vendor configuration
 * @access Private
 */
router.delete('/:id', validate.mongoId, vendorController.deleteVendor);

/**
 * @route GET /api/vendors/:id/products
 * @desc Get products from a specific vendor
 * @access Private
 */
router.get('/:id/products', validate.mongoId, validate.pagination, vendorController.getVendorProducts);

/**
 * @route GET /api/vendors/:id/inventory
 * @desc Fetch latest products from vendor API
 * @access Private
 */
router.get('/:id/inventory', validate.mongoId, vendorController.getVendorInventory);

/**
 * @route POST /api/vendors/:id/sync-products
 * @desc Fetch latest products from vendor API
 * @access Private
 */
router.post('/:id/sync-products', validate.mongoId, vendorController.syncVendor);

/**
 * @route POST /api/vendors/:id/test-connection
 * @desc Test vendor API connection
 * @access Private
 */
router.post('/:id/test-connection', validate.mongoId, vendorController.testConnection);

module.exports = router;
