const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const shopifyController = require('../controllers/shopify.controller');
const { ResponseHelper } = require('../utils/helpers');

const router = express.Router();

// Apply authentication to all Shopify routes
router.use(authenticateAdmin);

/**
 * @route GET /api/shopify/stores
 * @desc Get all connected Shopify stores
 * @access Private
 */
router.get('/', shopifyController.getStores);

/**
 * @route POST /api/shopify/connect
 * @desc Connect a new Shopify store
 * @access Private
 */
router.post('/connect', shopifyController.connectStore);

/**
 * @route POST /api/shopify/:storeId/sync-inventory
 * @desc Bulk sync inventory to Shopify for a store
 * @access Private
 */
router.post('/sync-with-shopify', shopifyController.syncWithShopify);

module.exports = router;
