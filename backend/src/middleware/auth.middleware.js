const logger = require('../utils/logger');
const { ResponseHelper } = require('../utils/helpers');
const { verifyToken } = require('../utils/jwt.utils');

/**
 * Extract Bearer token from Authorization header or query/body
 */
const getTokenFromRequest = (req) => {
  const authHeader = req.get('Authorization') || req.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.query && req.query.token) return String(req.query.token);
  if (req.body && req.body.token) return String(req.body.token);
  return null;
};

/**
 * Authentication middleware for admin routes (JWT-based)
 */
const authenticateAdmin = (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      logger.auth('Unauthorized access attempt (no token)', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path
      });
      return ResponseHelper.error(res, 'Authentication required', 401, 'UNAUTHORIZED');
    }

    const decoded = verifyToken(token);
    const isAdmin = !!decoded.isAdmin;
    if (!isAdmin) {
      logger.auth('Forbidden access (not admin)', { userId: decoded.userId, path: req.path });
      return ResponseHelper.error(res, 'Forbidden', 403, 'FORBIDDEN');
    }

    req.user = {
      userId: decoded.userId,
      role: 'admin',
      tokenIssuedAt: decoded.iat ? new Date(decoded.iat * 1000) : undefined,
      tokenExpiresAt: decoded.exp ? new Date(decoded.exp * 1000) : undefined
    };

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return ResponseHelper.error(res, error.message || 'Authentication error', 401, 'AUTH_ERROR');
  }
};

/**
 * Optional authentication middleware - continues if not authenticated
 */
const optionalAuth = (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (token) {
      try {
        const decoded = verifyToken(token);
        req.user = {
          userId: decoded.userId,
          role: decoded.isAdmin ? 'admin' : 'user'
        };
      } catch (e) {
        // Ignore invalid token for optional auth
      }
    }
    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next(); // Continue even if there's an error
  }
};

/**
 * Check if user is authenticated (for API status checks)
 */
const checkAuth = (req, res, next) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      req.isAuthenticated = false;
      return next();
    }
    try {
      const decoded = verifyToken(token);
      req.isAuthenticated = true;
      req.user = {
        userId: decoded.userId,
        role: decoded.isAdmin ? 'admin' : 'user'
      };
    } catch (e) {
      req.isAuthenticated = false;
    }
    next();
  } catch (error) {
    logger.error('Check auth middleware error:', error);
    req.isAuthenticated = false;
    next();
  }
};

/**
 * Rate limiting for authentication endpoints
 */
const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    
    // Clean old entries
    for (const [ip, data] of attempts.entries()) {
      if (now - data.firstAttempt > windowMs) {
        attempts.delete(ip);
      }
    }

    const userAttempts = attempts.get(key);
    
    if (!userAttempts) {
      attempts.set(key, {
        count: 1,
        firstAttempt: now
      });
      return next();
    }

    if (now - userAttempts.firstAttempt > windowMs) {
      // Reset window
      attempts.set(key, {
        count: 1,
        firstAttempt: now
      });
      return next();
    }

    if (userAttempts.count >= maxAttempts) {
      logger.auth('Rate limit exceeded for authentication', {
        ip: req.ip,
        attempts: userAttempts.count,
        userAgent: req.get('User-Agent')
      });

      return ResponseHelper.error(
        res,
        'Too many authentication attempts. Please try again later.',
        429,
        'RATE_LIMIT_EXCEEDED',
        {
          retryAfter: Math.ceil((windowMs - (now - userAttempts.firstAttempt)) / 1000)
        }
      );
    }

    userAttempts.count++;
    next();
  };
};

/**
 * Session validation middleware (no-op for JWT)
 */
const validateSession = (req, res, next) => next();

module.exports = {
  authenticateAdmin,
  optionalAuth,
  checkAuth,
  authRateLimit,
  validateSession
};
