const logger = require('./logger');

/**
 * Centralized Error Handling Utility
 * Provides consistent error handling, logging, and response formatting
 */
class ErrorHandler {
  // Error types for categorization
  static ERROR_TYPES = {
    VALIDATION: 'validation',
    AUTHENTICATION: 'authentication',
    AUTHORIZATION: 'authorization',
    NOT_FOUND: 'not_found',
    CONFLICT: 'conflict',
    EXTERNAL_API: 'external_api',
    DATABASE: 'database',
    NETWORK: 'network',
    SYNC: 'sync',
    QUEUE: 'queue',
    SYSTEM: 'system'
  };

  // Error severity levels
  static SEVERITY_LEVELS = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
  };

  /**
   * Create a standardized error object
   * @param {string} message - Error message
   * @param {string} type - Error type
   * @param {number} statusCode - HTTP status code
   * @param {object} details - Additional error details
   * @param {string} severity - Error severity
   * @returns {Error} - Standardized error object
   */
  static createError(message, type = this.ERROR_TYPES.SYSTEM, statusCode = 500, details = null, severity = this.SEVERITY_LEVELS.MEDIUM) {
    const error = new Error(message);
    error.type = type;
    error.statusCode = statusCode;
    error.details = details;
    error.severity = severity;
    error.timestamp = new Date().toISOString();
    error.errorId = this.generateErrorId();
    
    return error;
  }

  /**
   * Generate unique error ID for tracking
   * @returns {string} - Unique error ID
   */
  static generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle and log errors consistently
   * @param {Error} error - Error object
   * @param {object} context - Additional context information
   * @returns {object} - Processed error information
   */
  static handleError(error, context = {}) {
    const errorInfo = {
      errorId: error.errorId || this.generateErrorId(),
      message: error.message,
      type: error.type || this.ERROR_TYPES.SYSTEM,
      statusCode: error.statusCode || 500,
      severity: error.severity || this.SEVERITY_LEVELS.MEDIUM,
      timestamp: error.timestamp || new Date().toISOString(),
      stack: error.stack,
      details: error.details,
      context
    };

    // Log based on severity
    switch (errorInfo.severity) {
      case this.SEVERITY_LEVELS.CRITICAL:
        logger.error('CRITICAL ERROR:', errorInfo);
        // Could trigger alerts here
        break;
      case this.SEVERITY_LEVELS.HIGH:
        logger.error('HIGH SEVERITY ERROR:', errorInfo);
        break;
      case this.SEVERITY_LEVELS.MEDIUM:
        logger.warn('MEDIUM SEVERITY ERROR:', errorInfo);
        break;
      case this.SEVERITY_LEVELS.LOW:
        logger.info('LOW SEVERITY ERROR:', errorInfo);
        break;
      default:
        logger.error('ERROR:', errorInfo);
    }

    return errorInfo;
  }

  /**
   * Express error middleware
   * @param {Error} err - Error object
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {function} next - Express next function
   */
  static expressErrorHandler(err, req, res, next) {
    const context = {
      url: req.url,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      requestId: req.id
    };

    const errorInfo = this.handleError(err, context);

    // Don't expose sensitive information in production
    const isProduction = process.env.NODE_ENV === 'production';
    
    const response = {
      success: false,
      error: {
        id: errorInfo.errorId,
        message: errorInfo.message,
        type: errorInfo.type,
        timestamp: errorInfo.timestamp
      }
    };

    // Add details in development
    if (!isProduction) {
      response.error.details = errorInfo.details;
      response.error.stack = errorInfo.stack;
    }

    res.status(errorInfo.statusCode).json(response);
  }

  /**
   * Handle database errors
   * @param {Error} error - Database error
   * @returns {Error} - Standardized error
   */
  static handleDatabaseError(error) {
    let message = 'Database operation failed';
    let statusCode = 500;
    let type = this.ERROR_TYPES.DATABASE;

    if (error.code === 11000) {
      // Duplicate key error
      message = 'Resource already exists';
      statusCode = 409;
      type = this.ERROR_TYPES.CONFLICT;
    } else if (error.name === 'ValidationError') {
      message = 'Invalid data provided';
      statusCode = 400;
      type = this.ERROR_TYPES.VALIDATION;
    } else if (error.name === 'CastError') {
      message = 'Invalid ID format';
      statusCode = 400;
      type = this.ERROR_TYPES.VALIDATION;
    }

    return this.createError(message, type, statusCode, {
      originalError: error.message,
      code: error.code,
      name: error.name
    });
  }

  /**
   * Handle external API errors
   * @param {Error} error - API error
   * @param {string} apiName - Name of the external API
   * @returns {Error} - Standardized error
   */
  static handleExternalAPIError(error, apiName = 'External API') {
    let message = `${apiName} request failed`;
    let statusCode = 502;
    let severity = this.SEVERITY_LEVELS.HIGH;

    if (error.response) {
      statusCode = error.response.status === 401 ? 401 : 502;
      message = `${apiName} error: ${error.response.statusText}`;
    } else if (error.code === 'ECONNREFUSED') {
      message = `${apiName} is unavailable`;
      severity = this.SEVERITY_LEVELS.CRITICAL;
    } else if (error.code === 'ETIMEDOUT') {
      message = `${apiName} request timeout`;
      severity = this.SEVERITY_LEVELS.MEDIUM;
    }

    return this.createError(message, this.ERROR_TYPES.EXTERNAL_API, statusCode, {
      apiName,
      originalError: error.message,
      code: error.code,
      response: error.response?.data
    }, severity);
  }

  /**
   * Handle sync operation errors
   * @param {Error} error - Sync error
   * @param {object} syncContext - Sync operation context
   * @returns {Error} - Standardized error
   */
  static handleSyncError(error, syncContext = {}) {
    const { syncId, storeId, vendorId, syncType } = syncContext;
    
    let message = 'Sync operation failed';
    let severity = this.SEVERITY_LEVELS.MEDIUM;

    if (error.type === this.ERROR_TYPES.EXTERNAL_API) {
      message = 'Sync failed due to external API error';
      severity = this.SEVERITY_LEVELS.HIGH;
    } else if (error.type === this.ERROR_TYPES.DATABASE) {
      message = 'Sync failed due to database error';
      severity = this.SEVERITY_LEVELS.HIGH;
    } else if (error.message.includes('timeout')) {
      message = 'Sync operation timed out';
      severity = this.SEVERITY_LEVELS.MEDIUM;
    }

    return this.createError(message, this.ERROR_TYPES.SYNC, 500, {
      syncId,
      storeId,
      vendorId,
      syncType,
      originalError: error.message,
      originalType: error.type
    }, severity);
  }

  /**
   * Handle queue operation errors
   * @param {Error} error - Queue error
   * @param {object} jobContext - Job context
   * @returns {Error} - Standardized error
   */
  static handleQueueError(error, jobContext = {}) {
    const { jobId, queueName, jobType } = jobContext;
    
    let message = 'Queue operation failed';
    let severity = this.SEVERITY_LEVELS.MEDIUM;

    if (error.message.includes('Redis')) {
      message = 'Queue backend (Redis) error';
      severity = this.SEVERITY_LEVELS.CRITICAL;
    } else if (error.message.includes('timeout')) {
      message = 'Queue operation timed out';
      severity = this.SEVERITY_LEVELS.MEDIUM;
    }

    return this.createError(message, this.ERROR_TYPES.QUEUE, 500, {
      jobId,
      queueName,
      jobType,
      originalError: error.message
    }, severity);
  }

  /**
   * Create validation error
   * @param {string} field - Field that failed validation
   * @param {string} message - Validation error message
   * @param {any} value - Invalid value
   * @returns {Error} - Validation error
   */
  static validationError(field, message, value = null) {
    return this.createError(
      `Validation failed for ${field}: ${message}`,
      this.ERROR_TYPES.VALIDATION,
      400,
      { field, value },
      this.SEVERITY_LEVELS.LOW
    );
  }

  /**
   * Create not found error
   * @param {string} resource - Resource that was not found
   * @param {string} identifier - Resource identifier
   * @returns {Error} - Not found error
   */
  static notFoundError(resource, identifier = null) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;

    return this.createError(
      message,
      this.ERROR_TYPES.NOT_FOUND,
      404,
      { resource, identifier },
      this.SEVERITY_LEVELS.LOW
    );
  }

  /**
   * Create authorization error
   * @param {string} action - Action that was denied
   * @param {string} resource - Resource being accessed
   * @returns {Error} - Authorization error
   */
  static authorizationError(action, resource = null) {
    const message = resource 
      ? `Not authorized to ${action} ${resource}`
      : `Not authorized to ${action}`;

    return this.createError(
      message,
      this.ERROR_TYPES.AUTHORIZATION,
      403,
      { action, resource },
      this.SEVERITY_LEVELS.MEDIUM
    );
  }

  /**
   * Retry logic for operations
   * @param {function} operation - Operation to retry
   * @param {object} options - Retry options
   * @returns {Promise} - Operation result
   */
  static async retry(operation, options = {}) {
    const {
      maxAttempts = 3,
      delay = 1000,
      backoff = 'exponential',
      shouldRetry = (error) => true
    } = options;

    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxAttempts || !shouldRetry(error)) {
          throw error;
        }

        const waitTime = backoff === 'exponential' 
          ? delay * Math.pow(2, attempt - 1)
          : delay;

        logger.warn(`Operation failed (attempt ${attempt}/${maxAttempts}), retrying in ${waitTime}ms:`, error.message);
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    throw lastError;
  }

  /**
   * Circuit breaker pattern implementation
   * @param {function} operation - Operation to wrap
   * @param {object} options - Circuit breaker options
   * @returns {function} - Wrapped operation
   */
  static circuitBreaker(operation, options = {}) {
    const {
      failureThreshold = 5,
      resetTimeout = 60000,
      monitoringPeriod = 60000
    } = options;

    let state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    let failureCount = 0;
    let lastFailureTime = null;
    let successCount = 0;

    return async (...args) => {
      const now = Date.now();

      // Reset failure count after monitoring period
      if (lastFailureTime && (now - lastFailureTime) > monitoringPeriod) {
        failureCount = 0;
        lastFailureTime = null;
      }

      // Check if circuit should be half-open
      if (state === 'OPEN' && lastFailureTime && (now - lastFailureTime) > resetTimeout) {
        state = 'HALF_OPEN';
        successCount = 0;
      }

      // Reject if circuit is open
      if (state === 'OPEN') {
        throw this.createError(
          'Circuit breaker is OPEN - operation rejected',
          this.ERROR_TYPES.SYSTEM,
          503,
          { circuitState: state, failureCount },
          this.SEVERITY_LEVELS.HIGH
        );
      }

      try {
        const result = await operation(...args);
        
        // Success in half-open state
        if (state === 'HALF_OPEN') {
          successCount++;
          if (successCount >= 2) {
            state = 'CLOSED';
            failureCount = 0;
            lastFailureTime = null;
          }
        }

        return result;
      } catch (error) {
        failureCount++;
        lastFailureTime = now;

        // Open circuit if threshold reached
        if (failureCount >= failureThreshold) {
          state = 'OPEN';
          logger.error(`Circuit breaker opened after ${failureCount} failures`);
        }

        throw error;
      }
    };
  }

  /**
   * Get error statistics for monitoring
   * @param {array} errors - Array of error objects
   * @returns {object} - Error statistics
   */
  static getErrorStats(errors) {
    const stats = {
      total: errors.length,
      byType: {},
      bySeverity: {},
      byStatusCode: {},
      recentErrors: 0
    };

    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const error of errors) {
      // Count by type
      const type = error.type || 'unknown';
      stats.byType[type] = (stats.byType[type] || 0) + 1;

      // Count by severity
      const severity = error.severity || 'unknown';
      stats.bySeverity[severity] = (stats.bySeverity[severity] || 0) + 1;

      // Count by status code
      const statusCode = error.statusCode || 500;
      stats.byStatusCode[statusCode] = (stats.byStatusCode[statusCode] || 0) + 1;

      // Count recent errors
      const errorTime = new Date(error.timestamp).getTime();
      if (errorTime > oneHourAgo) {
        stats.recentErrors++;
      }
    }

    return stats;
  }
}

module.exports = ErrorHandler;
