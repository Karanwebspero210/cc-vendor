const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { ResponseHelper } = require('../utils/helpers');
const { generateToken, verifyToken } = require('../utils/jwt.utils');

class AuthController {
  /**
   * Admin login
   * POST /api/auth/login
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return ResponseHelper.validationError(res, [
          { field: 'email', message: 'Email is required' },
          { field: 'password', message: 'Password is required' }
        ]);
      }

      // Check credentials against environment variables
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminEmail || !adminPassword) {
        logger.error('ADMIN_EMAIL or ADMIN_PASSWORD environment variable not set');
        return ResponseHelper.error(
          res,
          'Server configuration error',
          500,
          'CONFIG_ERROR'
        );
      }

      // Simple comparison (in production, use a user DB and hashed passwords)
      if (email !== adminEmail || password !== adminPassword) {
        logger.auth('Failed login attempt', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date()
        });

        return ResponseHelper.error(
          res,
          'Invalid email or password',
          401,
          'INVALID_CREDENTIALS'
        );
      }

      // Issue JWT token for admin
      const userId = 'admin';
      const token = generateToken(userId, true);

      logger.auth('Successful admin login', {
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      return ResponseHelper.success(
        res,
        {
          token,
          user: {
            role: 'admin',
            userId,
            email,
            // client can decode token for iat/exp if needed
          }
        },
        'Login successful'
      );

    } catch (error) {
      logger.error('Login error:', error);
      return ResponseHelper.error(
        res,
        'Login failed',
        500,
        'LOGIN_ERROR'
      );
    }
  }

  /**
   * Admin logout
   * POST /api/auth/logout
   */
  static async logout(req, res) {
    try {
      // Stateless logout for JWT: client should discard token
      logger.auth('Admin logout (stateless JWT)', {
        userId: req.user?.userId,
        ip: req.ip
      });

      return ResponseHelper.success(
        res,
        null,
        'Logout successful'
      );

    } catch (error) {
      logger.error('Logout error:', error);
      return ResponseHelper.error(
        res,
        'Logout failed',
        500,
        'LOGOUT_ERROR'
      );
    }
  }

  /**
   * Verify authentication status
   * GET /api/auth/verify
   */
  static async verify(req, res) {
    try {
      // If route is protected by authenticateAdmin, req.user will be present
      const isAuthenticated = !!req.user && req.user.role === 'admin';

      if (isAuthenticated) {
        return ResponseHelper.success(
          res,
          {
            authenticated: true,
            user: {
              role: req.user.role,
              userId: req.user.userId
            }
          },
          'Authenticated'
        );
      } else {
        return ResponseHelper.success(
          res,
          {
            authenticated: false
          },
          'Not authenticated'
        );
      }

    } catch (error) {
      logger.error('Auth verification error:', error);
      return ResponseHelper.error(
        res,
        'Verification failed',
        500,
        'VERIFICATION_ERROR'
      );
    }
  }

  /**
   * Get current session info
   * GET /api/auth/session
   */
  static async getSession(req, res) {
    try {
      if (!req.user) {
        return ResponseHelper.error(
          res,
          'Not authenticated',
          401,
          'NOT_AUTHENTICATED'
        );
      }

      return ResponseHelper.success(
        res,
        {
          session: {
            role: req.user.role,
            userId: req.user.userId
          }
        },
        'Session retrieved'
      );

    } catch (error) {
      logger.error('Get session error:', error);
      return ResponseHelper.error(
        res,
        'Failed to get session',
        500,
        'SESSION_ERROR'
      );
    }
  }

  /**
   * Change admin password
   * POST /api/auth/change-password
   */
  static async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;

      // Validate input
      if (!currentPassword || !newPassword) {
        return ResponseHelper.validationError(res, [
          { field: 'currentPassword', message: 'Current password is required' },
          { field: 'newPassword', message: 'New password is required' }
        ]);
      }

      if (newPassword.length < 8) {
        return ResponseHelper.validationError(res, [
          { field: 'newPassword', message: 'New password must be at least 8 characters' }
        ]);
      }

      // Verify current password
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (currentPassword !== adminPassword) {
        return ResponseHelper.error(
          res,
          'Current password is incorrect',
          401,
          'INVALID_CURRENT_PASSWORD'
        );
      }

      // Note: In a real application, you would update the password in a secure way
      // This is a simplified implementation for demo purposes
      logger.auth('Password change requested', {
        sessionId: req.user.sessionId,
        ip: req.ip
      });

      return ResponseHelper.success(
        res,
        null,
        'Password change functionality would be implemented here'
      );

    } catch (error) {
      logger.error('Change password error:', error);
      return ResponseHelper.error(
        res,
        'Password change failed',
        500,
        'PASSWORD_CHANGE_ERROR'
      );
    }
  }
}

module.exports = AuthController;
