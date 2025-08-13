const rateLimit = require('express-rate-limit');
const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Rate Limiting Middleware
 * Provides various rate limiting strategies for different endpoints
 */

/**
 * Default rate limiter for general API endpoints
 */
const defaultLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    ResponseHelper.error(
      res,
      'Too many requests from this IP, please try again later.',
      429,
      'RATE_LIMIT_EXCEEDED',
      {
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
      }
    );
  }
});

/**
 * Strict rate limiter for authentication endpoints
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login attempts per windowMs
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    ResponseHelper.error(
      res,
      'Too many authentication attempts from this IP, please try again later.',
      429,
      'AUTH_RATE_LIMIT_EXCEEDED',
      {
        retryAfter: 15 * 60
      }
    );
  }
});

/**
 * Moderate rate limiter for sync operations
 */
const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 sync requests per 5 minutes
  message: {
    error: 'Too many sync requests from this IP, please try again later.',
    code: 'SYNC_RATE_LIMIT_EXCEEDED',
    retryAfter: 5 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Sync rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    ResponseHelper.error(
      res,
      'Too many sync requests from this IP, please try again later.',
      429,
      'SYNC_RATE_LIMIT_EXCEEDED',
      {
        retryAfter: 5 * 60
      }
    );
  }
});

/**
 * Lenient rate limiter for read-only operations
 */
const readOnlyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // limit each IP to 300 read requests per windowMs
  message: {
    error: 'Too many read requests from this IP, please try again later.',
    code: 'READ_RATE_LIMIT_EXCEEDED',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Read rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    ResponseHelper.error(
      res,
      'Too many read requests from this IP, please try again later.',
      429,
      'READ_RATE_LIMIT_EXCEEDED',
      {
        retryAfter: 15 * 60
      }
    );
  }
});

/**
 * Very strict rate limiter for admin operations
 */
const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each IP to 50 admin requests per hour
  message: {
    error: 'Too many admin requests from this IP, please try again later.',
    code: 'ADMIN_RATE_LIMIT_EXCEEDED',
    retryAfter: 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Admin rate limit exceeded for IP: ${req.ip}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl
    });
    
    ResponseHelper.error(
      res,
      'Too many admin requests from this IP, please try again later.',
      429,
      'ADMIN_RATE_LIMIT_EXCEEDED',
      {
        retryAfter: 60 * 60
      }
    );
  }
});

/**
 * Create custom rate limiter with specific options
 */
function createCustomLimiter(options = {}) {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
      error: 'Too many requests from this IP, please try again later.',
      code: 'CUSTOM_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false
  };

  const limiterOptions = { ...defaultOptions, ...options };

  if (!limiterOptions.handler) {
    limiterOptions.handler = (req, res) => {
      logger.warn(`Custom rate limit exceeded for IP: ${req.ip}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        limiterOptions
      });
      
      ResponseHelper.error(
        res,
        limiterOptions.message.error,
        429,
        limiterOptions.message.code,
        {
          retryAfter: Math.ceil(limiterOptions.windowMs / 1000)
        }
      );
    };
  }

  return rateLimit(limiterOptions);
}

/**
 * Skip rate limiting for certain conditions
 */
function skipRateLimit(req) {
  // Skip rate limiting for health checks
  if (req.path === '/health' || req.path === '/api/health') {
    return true;
  }

  // Skip for localhost in development
  if (process.env.NODE_ENV === 'development' && req.ip === '127.0.0.1') {
    return true;
  }

  // Skip for whitelisted IPs (if configured)
  const whitelistedIPs = process.env.RATE_LIMIT_WHITELIST?.split(',') || [];
  if (whitelistedIPs.includes(req.ip)) {
    return true;
  }

  return false;
}

/**
 * Apply skip logic to all limiters
 */
[defaultLimiter, authLimiter, syncLimiter, readOnlyLimiter, adminLimiter].forEach(limiter => {
  limiter.skip = skipRateLimit;
});

module.exports = {
  defaultLimiter,
  authLimiter,
  syncLimiter,
  readOnlyLimiter,
  adminLimiter,
  createCustomLimiter,
  skipRateLimit
};
