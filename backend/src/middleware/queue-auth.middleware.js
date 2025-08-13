const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const { verifyToken } = require('../utils/jwt.utils');

/**
 * Queue Authentication Middleware
 * Provides authentication for queue management endpoints
 */

/**
 * Authenticate queue access with API key or admin session
 */
function authenticateQueue(req, res, next) {
  try {
    // Check for API key in headers
    const authHeader = req.get('Authorization') || req.get('authorization');
    const apiKey = req.headers['x-queue-api-key'];
    const bearer = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : null;

    // Allow access if valid JWT is present (any authenticated user)
    if (bearer) {
      try {
        const decoded = verifyToken(bearer);
        req.queueAuth = { type: 'jwt', isAdmin: !!decoded.isAdmin, userId: decoded.userId };
        return next();
      } catch (e) {
        // fall through to API key check
      }
    }
    
    // Check API key
    if (apiKey) {
      const validApiKey = process.env.QUEUE_API_KEY;
      
      if (!validApiKey) {
        logger.error('Queue API key not configured in environment');
        return ResponseHelper.error(res, 'Queue access not configured', 500, 'QUEUE_CONFIG_ERROR');
      }
      
      if (apiKey === validApiKey) {
        req.queueAuth = { type: 'api_key' };
        return next();
      }
    }
    
    logger.warn('Unauthorized queue access attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      hasApiKey: !!apiKey
    });
    
    return ResponseHelper.error(res, 'Queue access denied', 401, 'QUEUE_AUTH_REQUIRED');
  } catch (error) {
    logger.error('Error in queue authentication:', error);
    return ResponseHelper.error(res, 'Authentication error', 500, 'QUEUE_AUTH_ERROR');
  }
}

/**
 * Authenticate queue admin operations (more restrictive)
 */
function authenticateQueueAdmin(req, res, next) {
  try {
    // Only allow admin JWT for admin operations
    const authHeader = req.get('Authorization') || req.get('authorization');
    const bearer = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : null;

    let isAdminAuthenticated = false;
    if (bearer) {
      try {
        const decoded = verifyToken(bearer);
        isAdminAuthenticated = !!decoded.isAdmin;
        if (isAdminAuthenticated) {
          req.queueAuth = { type: 'jwt', isAdmin: true, userId: decoded.userId };
        }
      } catch (e) {}
    }

    if (!isAdminAuthenticated) {
      logger.warn('Unauthorized queue admin access attempt', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
      return ResponseHelper.error(res, 'Admin access required for queue management', 403, 'QUEUE_ADMIN_REQUIRED');
    }
    next();
  } catch (error) {
    logger.error('Error in queue admin authentication:', error);
    return ResponseHelper.error(res, 'Authentication error', 500, 'QUEUE_AUTH_ERROR');
  }
}

/**
 * Authenticate read-only queue access
 */
function authenticateQueueReadOnly(req, res, next) {
  try {
    // Allow both API key and admin/user JWT for read-only access
    const authHeader = req.get('Authorization') || req.get('authorization');
    const apiKey = req.headers['x-queue-api-key'];
    const bearer = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : null;

    if (bearer) {
      try {
        const decoded = verifyToken(bearer);
        req.queueAuth = { type: 'jwt', isAdmin: !!decoded.isAdmin, permissions: ['read'], userId: decoded.userId };
        return next();
      } catch (e) {}
    }
    
    if (apiKey) {
      const validApiKey = process.env.QUEUE_API_KEY || process.env.QUEUE_READ_API_KEY;
      
      if (apiKey === validApiKey) {
        req.queueAuth = { type: 'api_key', permissions: ['read'] };
        return next();
      }
    }
    
    logger.warn('Unauthorized queue read access attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return ResponseHelper.error(res, 'Queue access denied', 401, 'QUEUE_READ_AUTH_REQUIRED');
  } catch (error) {
    logger.error('Error in queue read authentication:', error);
    return ResponseHelper.error(res, 'Authentication error', 500, 'QUEUE_AUTH_ERROR');
  }
}

/**
 * Check if request has specific queue permission
 */
function hasQueuePermission(permission) {
  return (req, res, next) => {
    try {
      if (!req.queueAuth) {
        return ResponseHelper.error(res, 'Queue authentication required', 401, 'QUEUE_AUTH_REQUIRED');
      }
      
      // JWT admin has all permissions
      if (req.queueAuth.type === 'jwt' && req.queueAuth.isAdmin) {
        return next();
      }

      // Check API key permissions
      if (req.queueAuth.permissions && req.queueAuth.permissions.includes(permission)) {
        return next();
      }
      
      logger.warn(`Insufficient queue permissions for ${permission}`, {
        ip: req.ip,
        authType: req.queueAuth.type,
        permissions: req.queueAuth.permissions
      });
      
      return ResponseHelper.error(res, `Insufficient permissions for ${permission}`, 403, 'QUEUE_PERMISSION_DENIED');
    } catch (error) {
      logger.error('Error checking queue permission:', error);
      return ResponseHelper.error(res, 'Permission check error', 500, 'QUEUE_PERMISSION_ERROR');
    }
  };
}

/**
 * Log queue access for audit purposes
 */
function logQueueAccess(req, res, next) {
  const startTime = Date.now();
  
  // Log the request
  logger.info('Queue access', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    authType: req.queueAuth?.type,
    timestamp: new Date().toISOString()
  });
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info('Queue access completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      ip: req.ip
    });
  });
  
  next();
}

/**
 * Validate queue operation parameters
 */
function validateQueueOperation(req, res, next) {
  try {
    const { method, path } = req;
    
    // Validate job ID format for job-specific operations
    if (path.includes('/jobs/') && req.params.jobId) {
      const jobIdPattern = /^[a-zA-Z0-9_-]+$/;
      if (!jobIdPattern.test(req.params.jobId)) {
        return ResponseHelper.error(res, 'Invalid job ID format', 400, 'INVALID_JOB_ID');
      }
    }
    
    // Validate queue name if provided
    if (req.body && req.body.queueName) {
      const validQueueNames = ['sync', 'batch', 'cron', 'default'];
      if (!validQueueNames.includes(req.body.queueName)) {
        return ResponseHelper.error(res, 'Invalid queue name', 400, 'INVALID_QUEUE_NAME');
      }
    }
    
    next();
  } catch (error) {
    logger.error('Error validating queue operation:', error);
    return ResponseHelper.error(res, 'Validation error', 500, 'QUEUE_VALIDATION_ERROR');
  }
}

module.exports = {
  authenticateQueue,
  authenticateQueueAdmin,
  authenticateQueueReadOnly,
  hasQueuePermission,
  logQueueAccess,
  validateQueueOperation
};
