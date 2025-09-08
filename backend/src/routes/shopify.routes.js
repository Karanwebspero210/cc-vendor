const express = require("express");
const { authenticateAdmin } = require("../middleware/auth.middleware");
const { syncLimiter } = require("../middleware/rate-limit.middleware");
const shopifyController = require("../controllers/shopify.controller");
const { ResponseHelper } = require("../utils/helpers");

const router = express.Router();

// Apply authentication to all Shopify routes
router.use(authenticateAdmin);

/**
 * @route GET /api/shopify/stores
 * @desc Get all connected Shopify stores
 * @access Private
 */
router.get("/", shopifyController.getStores);

/**
 * @route POST /api/shopify/:storeId/sync-inventory
 * @desc Bulk sync inventory to Shopify for a store
 * @access Private
 */
router.post("/sync-with-shopify", shopifyController.syncWithShopify);

/**
 * @route GET /api/shopify/sync-status
 * @desc Get synced vs unsynced variants with pagination and counts
 * @access Private
 */
router.get("/sync-status", shopifyController.getSyncStatus);

/**
 * @route POST /api/shopify/mismatched/update
 * @desc Bulk set Shopify stock to match local stockQty for mismatched variants
 * @access Private
 */
router.post(
  "/mismatched/update",
  syncLimiter,
  shopifyController.bulkUpdateMismatchedInventory
);

/**
 * @route POST /api/shopify/selected/update
 * @desc Bulk set Shopify stock to match local stockQty for selected variant SKUs
 * @access Private
 */
router.post(
  "/selected/update",
  syncLimiter,
  shopifyController.bulkUpdateSelectedInventory
);

/**
 * @route GET /api/shopify/jobs/:id
 * @desc Get Shopify inventory job status/details by id
 * @access Private
 */
router.get("/jobs/:id", shopifyController.getJobStatus);

/**
 * @route GET /api/shopify/jobs/:id/export
 * @desc Export job result details as CSV (type=unsynced|synced|all)
 * @access Private
 */
router.get("/jobs/:id/export", shopifyController.exportJobCsv);

/**
 * @route POST /api/shopify/stop-worker
 * @desc Stop running workers and cancel queued jobs
 * @query jobId: optional specific job ID to stop
 * @query type: optional job type to stop ('sync-with-shopify' | 'update-inventory' | 'all')
 * @access Private
 */
router.post("/stop-worker", shopifyController.stopWorker);

module.exports = router;
