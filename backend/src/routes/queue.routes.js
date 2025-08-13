const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authenticateQueue, authenticateQueueAdmin, logQueueAccess, validateQueueOperation } = require('../middleware/queue-auth.middleware');
const { readOnlyLimiter, defaultLimiter } = require('../middleware/rate-limit.middleware');
const queueController = require('../controllers/queue.controller');

const router = express.Router();

// Apply queue authentication and logging
router.use(authenticateQueue);
router.use(logQueueAccess);
router.use(validateQueueOperation);

// Apply rate limiting
router.use(readOnlyLimiter);

/**
 * @route GET /api/queue/status
 * @desc Get overall queue status and statistics
 * @access Private
 */
router.get('/status', queueController.getQueueStatus);

/**
 * @route GET /api/queue/jobs
 * @desc Get all jobs in the queue
 * @access Private
 */
router.get('/jobs', validate.pagination, queueController.getJobs);

/**
 * @route GET /api/queue/jobs/:jobId
 * @desc Get specific job status and details
 * @access Private
 */
router.get('/jobs/:jobId', queueController.getJobStatus);

/**
 * @route POST /api/queue/jobs/:jobId/cancel
 * @desc Cancel a specific job
 * @access Private
 */
router.post('/jobs/:jobId/cancel', authenticateQueueAdmin, defaultLimiter, queueController.cancelJob);

/**
 * @route POST /api/queue/jobs/:jobId/retry
 * @desc Retry a failed job
 * @access Private
 */
router.post('/jobs/:jobId/retry', authenticateQueueAdmin, defaultLimiter, queueController.retryJob);

/**
 * @route DELETE /api/queue/jobs/:jobId
 * @desc Remove a job from the queue
 * @access Private
 */
router.delete('/jobs/:jobId', authenticateQueueAdmin, defaultLimiter, queueController.removeJob);

/**
 * @route POST /api/queue/pause
 * @desc Pause queue processing
 * @access Private
 */
router.post('/pause', authenticateQueueAdmin, defaultLimiter, queueController.pauseQueue);

/**
 * @route POST /api/queue/resume
 * @desc Resume queue processing
 * @access Private
 */
router.post('/resume', authenticateQueueAdmin, defaultLimiter, queueController.resumeQueue);

/**
 * @route POST /api/queue/clear
 * @desc Clear completed and failed jobs from queue
 * @access Private
 */
router.post('/clear', authenticateQueueAdmin, defaultLimiter, queueController.clearQueue);

/**
 * @route GET /api/queue/stats
 * @desc Get detailed queue statistics
 * @access Private
 */
router.get('/stats', queueController.getQueueStats);

module.exports = router;
