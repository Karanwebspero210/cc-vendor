const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { defaultLimiter, readOnlyLimiter } = require('../middleware/rate-limit.middleware');
const cronController = require('../controllers/cron.controller');

const router = express.Router();

// Apply authentication to all cron routes
router.use(authenticateAdmin);

// Apply rate limiting
router.use(readOnlyLimiter);

/**
 * @route GET /api/cron/schedules
 * @desc Get all scheduled cron jobs
 * @access Private
 */
router.get('/schedules', cronController.getSchedules);

/**
 * @route POST /api/cron/schedules
 * @desc Create a new cron schedule
 * @access Private
 */
router.post('/schedules', validate.cron.create, cronController.createSchedule);

/**
 * @route GET /api/cron/schedules/:id
 * @desc Get cron schedule by ID
 * @access Private
 */
router.get('/schedules/:id', validate.mongoId, cronController.getScheduleById);

/**
 * @route PUT /api/cron/schedules/:id
 * @desc Update cron schedule
 * @access Private
 */
router.put('/schedules/:id', validate.mongoId, validate.cron.update, cronController.updateSchedule);

/**
 * @route DELETE /api/cron/schedules/:id
 * @desc Delete cron schedule
 * @access Private
 */
router.delete('/schedules/:id', validate.mongoId, cronController.deleteSchedule);

/**
 * @route POST /api/cron/schedules/:id/activate
 * @desc Activate a cron schedule
 * @access Private
 */
router.post('/schedules/:id/activate', validate.mongoId, cronController.activateSchedule);

/**
 * @route POST /api/cron/schedules/:id/deactivate
 * @desc Deactivate a cron schedule
 * @access Private
 */
router.post('/schedules/:id/deactivate', validate.mongoId, cronController.deactivateSchedule);

/**
 * @route GET /api/cron/jobs/running
 * @desc Get currently running cron jobs
 * @access Private
 */
router.get('/jobs/running', cronController.getRunningJobs);

/**
 * @route GET /api/cron/jobs/history
 * @desc Get cron job execution history
 * @access Private
 */
router.get('/jobs/history', validate.pagination, cronController.getJobHistory);

module.exports = router;
