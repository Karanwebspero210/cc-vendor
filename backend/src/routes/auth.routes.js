const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticateAdmin, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { authLimiter } = require('../middleware/rate-limit.middleware');

const router = express.Router();

// Apply rate limiting to all auth routes
router.use(authLimiter);

// Apply authentication middleware to protected routes
router.use('/verify', authenticateAdmin);
router.use('/session', authenticateAdmin);
router.use('/change-password', authenticateAdmin);

/**
 * @route POST /api/auth/login
 * @desc Admin login
 * @access Public
 */
router.post('/login', validate.auth.login, authController.login);

/**
 * @route POST /api/auth/logout
 * @desc Admin logout
 * @access Private
 */
router.post('/logout', authenticateAdmin, authController.logout);

/**
 * @route GET /api/auth/verify
 * @desc Verify authentication status
 * @access Public
 */
router.get('/verify', authenticateAdmin, authController.verify);

/**
 * @route GET /api/auth/session
 * @desc Get current session info
 * @access Private
 */
router.get('/session', authenticateAdmin, authController.getSession);

/**
 * @route POST /api/auth/change-password
 * @desc Change admin password
 * @access Private
 */
router.post('/change-password', validate.auth.changePassword, authController.changePassword);

module.exports = router;
