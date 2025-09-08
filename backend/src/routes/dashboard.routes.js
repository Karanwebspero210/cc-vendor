const express = require("express");
const { authenticateAdmin } = require("../middleware/auth.middleware");
const { readOnlyLimiter } = require("../middleware/rate-limit.middleware");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

// Protect all dashboard routes
router.use(authenticateAdmin);

// Read-only limiter for dashboard
router.use(readOnlyLimiter);

/**
 * @route GET /api/dashboard
 * @desc Get dashboard overview stats
 * @access Private (Admin)
 */
router.get("/", dashboardController.getDashboardStats);

module.exports = router;

