const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { syncLimiter, defaultLimiter, readOnlyLimiter } = require('../middleware/rate-limit.middleware');
const syncController = require('../controllers/sync.controller');

const router = express.Router();

// Apply authentication to all sync routes
router.use(authenticateAdmin);

// Apply rate limiting based on operation type
router.use('/manual', syncLimiter);
router.use('/batch', syncLimiter);
router.use('/*/pause', defaultLimiter);
router.use('/*/resume', defaultLimiter);
router.use('/*/cancel', defaultLimiter);
router.use(readOnlyLimiter); // Default for read operations

/**
 * @route POST /api/sync/manual
 * @desc Start manual sync operation
 * @access Private
 */
router.post('/manual', validate.sync.manual, syncController.startManualSync);

/**
 * @route POST /api/sync/batch
 * @desc Start batch sync operation
 * @access Private
 */
router.post('/batch', validate.sync.batch, syncController.startBatchSync);

/**
 * @route GET /api/sync/jobs
 * @desc Get all sync jobs with filters (history)
 * @access Private
 */
router.get('/jobs', validate.pagination, syncController.getSyncHistory);

/**
 * @route GET /api/sync/jobs/:id
 * @desc Get sync job details/status by job id
 * @access Private
 */
router.get('/jobs/:id', validate.mongoId, syncController.getSyncStatus);

/**
 * @route GET /api/sync/jobs/active
 * @desc Get active (queued/active/delayed) jobs with optional filters
 * @access Private
 */
router.get('/jobs/active', syncController.getActiveSyncs);

/**
 * @route POST /api/sync/pause/:syncId
 * @desc Pause a running sync operation
 * @access Private
 */
router.post('/:id/pause', validate.mongoId, syncController.pauseSync);

/**
 * @route POST /api/sync/resume/:syncId
 * @desc Resume a paused sync operation
 * @access Private
 */
router.post('/:id/resume', validate.mongoId, syncController.resumeSync);

/**
 * @route POST /api/sync/cancel/:syncId
 * @desc Cancel a sync operation
 * @access Private
 */
router.post('/:id/cancel', validate.mongoId, syncController.cancelSync);

module.exports = router;
