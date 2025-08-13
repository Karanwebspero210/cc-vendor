# Comprehensive Error Handling & Retry Strategy

## Error Categories & Handling

### 1. Shopify API Errors

#### Rate Limiting (429 Errors)
```javascript
class ShopifyRateLimitHandler {
  static async handleRateLimit(error, context) {
    const retryAfter = error.response?.headers['retry-after'] || 2;
    const delay = parseInt(retryAfter) * 1000;
    
    logger.warn(`Shopify rate limit hit, retrying after ${delay}ms`, {
      endpoint: context.endpoint,
      attempt: context.attempt
    });
    
    // Update sync status
    await SyncLog.findByIdAndUpdate(context.syncId, {
      status: 'rate_limited',
      $push: {
        errors: {
          type: 'rate_limit',
          message: `Rate limited, retrying in ${delay}ms`,
          timestamp: new Date(),
          retryAfter: delay
        }
      }
    });
    
    // Emit real-time update
    socketService.emitSyncUpdate(context.syncId, {
      status: 'rate_limited',
      message: `Rate limited, retrying in ${delay}ms`,
      retryAfter: delay
    });
    
    return { shouldRetry: true, delay };
  }
}
```

#### GraphQL Errors
```javascript
class GraphQLErrorHandler {
  static async handleGraphQLError(error, query, variables, context) {
    const graphqlErrors = error.response?.errors || [];
    
    for (const gqlError of graphqlErrors) {
      switch (gqlError.extensions?.code) {
        case 'THROTTLED':
          return await this.handleThrottling(gqlError, context);
        
        case 'ACCESS_DENIED':
          return await this.handleAccessDenied(gqlError, context);
        
        case 'INVALID_INPUT':
          return await this.handleInvalidInput(gqlError, variables, context);
        
        case 'RESOURCE_NOT_FOUND':
          return await this.handleResourceNotFound(gqlError, context);
        
        default:
          return await this.handleGenericError(gqlError, context);
      }
    }
  }
  
  static async handleThrottling(error, context) {
    const cost = error.extensions?.cost;
    const throttleStatus = error.extensions?.throttleStatus;
    
    logger.warn('GraphQL throttling detected', {
      cost,
      throttleStatus,
      context
    });
    
    // Calculate delay based on throttle status
    const delay = this.calculateThrottleDelay(throttleStatus);
    
    return { shouldRetry: true, delay };
  }
  
  static calculateThrottleDelay(throttleStatus) {
    if (!throttleStatus) return 2000; // Default 2 seconds
    
    const { currentlyAvailable, maximumAvailable, restoreRate } = throttleStatus;
    const pointsNeeded = Math.max(1, maximumAvailable * 0.1); // Need 10% of max points
    const timeToRestore = Math.ceil((pointsNeeded - currentlyAvailable) / restoreRate);
    
    return Math.max(1000, timeToRestore * 1000); // At least 1 second
  }
}
```

### 2. Vendor API Errors

#### Noxa API Error Handling
```javascript
class NoxaErrorHandler {
  static async handleNoxaError(error, context) {
    const statusCode = error.response?.status;
    const errorData = error.response?.data;
    
    switch (statusCode) {
      case 401:
        return await this.handleUnauthorized(error, context);
      
      case 403:
        return await this.handleForbidden(error, context);
      
      case 429:
        return await this.handleRateLimit(error, context);
      
      case 500:
      case 502:
      case 503:
      case 504:
        return await this.handleServerError(error, context);
      
      default:
        return await this.handleGenericError(error, context);
    }
  }
  
  static async handleUnauthorized(error, context) {
    logger.error('Noxa API unauthorized - token may be expired', {
      vendorId: context.vendorId,
      error: error.message
    });
    
    // Mark vendor as inactive
    await Vendor.findByIdAndUpdate(context.vendorId, {
      isActive: false,
      lastError: 'Unauthorized - token expired or invalid'
    });
    
    // Notify admin
    await NotificationService.sendAlert({
      type: 'vendor_auth_failed',
      vendorId: context.vendorId,
      message: 'Vendor API authentication failed - please update access token'
    });
    
    return { shouldRetry: false, requiresManualIntervention: true };
  }
}
```

### 3. Database Errors

#### MongoDB Error Handling
```javascript
class DatabaseErrorHandler {
  static async handleDatabaseError(error, operation, context) {
    const errorCode = error.code;
    
    switch (errorCode) {
      case 11000: // Duplicate key error
        return await this.handleDuplicateKey(error, context);
      
      case 16500: // Connection timeout
        return await this.handleConnectionTimeout(error, context);
      
      case 13: // Unauthorized
        return await this.handleUnauthorized(error, context);
      
      default:
        return await this.handleGenericDatabaseError(error, context);
    }
  }
  
  static async handleDuplicateKey(error, context) {
    logger.warn('Duplicate key error - record may already exist', {
      error: error.message,
      context
    });
    
    // For product mappings, this might be acceptable
    if (context.operation === 'createMapping') {
      return { shouldRetry: false, canContinue: true };
    }
    
    return { shouldRetry: false, canContinue: false };
  }
}
```

## Retry Strategy Implementation

### Exponential Backoff with Jitter
```javascript
class RetryStrategy {
  static calculateDelay(attempt, baseDelay = 1000, maxDelay = 300000) {
    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    
    // Cap at maximum delay
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    // Add jitter (±25% random variation)
    const jitter = cappedDelay * 0.25 * (Math.random() - 0.5);
    
    return Math.round(cappedDelay + jitter);
  }
  
  static async executeWithRetry(operation, context = {}, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 300000,
      retryCondition = this.defaultRetryCondition
    } = options;
    
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        
        // Log successful retry if this wasn't the first attempt
        if (attempt > 1) {
          logger.info(`Operation succeeded on attempt ${attempt}`, context);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if we should retry
        const shouldRetry = retryCondition(error, attempt, context);
        
        if (!shouldRetry || attempt > maxRetries) {
          break;
        }
        
        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, baseDelay, maxDelay);
        
        logger.warn(`Operation failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`, {
          error: error.message,
          context,
          delay
        });
        
        // Update sync status with retry information
        if (context.syncId) {
          await this.updateSyncWithRetry(context.syncId, {
            attempt,
            maxRetries,
            nextRetryIn: delay,
            error: error.message
          });
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // All retries exhausted
    logger.error(`Operation failed after ${maxRetries + 1} attempts`, {
      error: lastError.message,
      context
    });
    
    throw new Error(`Operation failed after ${maxRetries + 1} attempts: ${lastError.message}`);
  }
  
  static defaultRetryCondition(error, attempt, context) {
    // Don't retry client errors (4xx) except rate limits
    if (error.response?.status >= 400 && error.response?.status < 500) {
      return error.response.status === 429; // Only retry rate limits
    }
    
    // Retry server errors (5xx)
    if (error.response?.status >= 500) {
      return true;
    }
    
    // Retry network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    // Retry GraphQL throttling
    if (error.message.includes('throttled') || error.message.includes('rate limit')) {
      return true;
    }
    
    return false;
  }
  
  static async updateSyncWithRetry(syncId, retryInfo) {
    try {
      await SyncLog.findByIdAndUpdate(syncId, {
        $push: {
          retryAttempts: {
            attempt: retryInfo.attempt,
            maxRetries: retryInfo.maxRetries,
            nextRetryIn: retryInfo.nextRetryIn,
            error: retryInfo.error,
            timestamp: new Date()
          }
        }
      });
      
      // Emit real-time update
      socketService.emitSyncUpdate(syncId, {
        status: 'retrying',
        retryInfo
      });
    } catch (error) {
      logger.error('Failed to update sync with retry info', error);
    }
  }
}
```

## Circuit Breaker Pattern

### API Circuit Breaker
```javascript
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 300000; // 5 minutes
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.requestCount = 0;
  }
  
  async execute(operation, context = {}) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info(`Circuit breaker ${this.name} entering HALF_OPEN state`);
      } else {
        throw new Error(`Circuit breaker ${this.name} is OPEN - operation rejected`);
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    this.successCount++;
    
    if (this.state === 'HALF_OPEN' && this.successCount >= 3) {
      this.state = 'CLOSED';
      logger.info(`Circuit breaker ${this.name} reset to CLOSED state`);
    }
  }
  
  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.error(`Circuit breaker ${this.name} opened due to ${this.failures} failures`);
      
      // Notify monitoring system
      NotificationService.sendAlert({
        type: 'circuit_breaker_open',
        circuitBreaker: this.name,
        failures: this.failures
      });
    }
  }
  
  getStats() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Usage
const shopifyCircuitBreaker = new CircuitBreaker('shopify-api', {
  failureThreshold: 5,
  resetTimeout: 60000
});

const noxaCircuitBreaker = new CircuitBreaker('noxa-api', {
  failureThreshold: 3,
  resetTimeout: 30000
});
```

## Enhanced Sync Job with Error Handling

### Robust Sync Job Implementation
```javascript
class RobustSyncJob {
  constructor(jobData) {
    this.jobData = jobData;
    this.retryStrategy = new RetryStrategy();
    this.errorHandler = new ErrorHandlingService();
  }
  
  async execute() {
    const { syncId, storeId, vendorId, products } = this.jobData;
    
    try {
      // Initialize services with circuit breakers
      const shopifyService = new ShopifyService(
        await Store.findById(storeId),
        shopifyCircuitBreaker
      );
      const vendorService = new NoxaService(
        await Vendor.findById(vendorId),
        noxaCircuitBreaker
      );
      
      // Update sync status
      await SyncLog.findByIdAndUpdate(syncId, {
        status: 'running',
        startTime: new Date()
      });
      
      // Process each product with error handling
      const results = {
        successful: 0,
        failed: 0,
        errors: []
      };
      
      for (const product of products) {
        try {
          await this.syncSingleProduct(
            product,
            shopifyService,
            vendorService,
            { syncId, storeId, vendorId }
          );
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            productId: product.vendorProductId,
            sku: product.sku,
            error: error.message,
            timestamp: new Date()
          });
          
          logger.error(`Failed to sync product ${product.sku}`, {
            error: error.message,
            syncId,
            productId: product.vendorProductId
          });
        }
        
        // Emit progress update
        socketService.emitSyncProgress(syncId, {
          processed: results.successful + results.failed,
          total: products.length,
          successful: results.successful,
          failed: results.failed
        });
      }
      
      // Complete sync
      await SyncLog.findByIdAndUpdate(syncId, {
        status: results.failed === 0 ? 'completed' : 'completed_with_errors',
        endTime: new Date(),
        successCount: results.successful,
        errorCount: results.failed,
        errors: results.errors
      });
      
      // Emit completion event
      socketService.emitSyncComplete(syncId, results);
      
      return results;
    } catch (error) {
      // Handle job-level failure
      await SyncLog.findByIdAndUpdate(syncId, {
        status: 'failed',
        endTime: new Date(),
        errors: [{
          type: 'job_failure',
          message: error.message,
          timestamp: new Date()
        }]
      });
      
      socketService.emitSyncError(syncId, error.message);
      throw error;
    }
  }
  
  async syncSingleProduct(product, shopifyService, vendorService, context) {
    // Get vendor inventory with retry
    const vendorInventory = await this.retryStrategy.executeWithRetry(
      () => vendorService.getProductInventory(product.vendorProductId),
      { ...context, operation: 'get_vendor_inventory', productId: product.vendorProductId }
    );
    
    // Get current Shopify inventory
    const mapping = await ProductMapping.findOne({
      vendorProductId: product.vendorProductId,
      storeId: context.storeId
    });
    
    if (!mapping) {
      throw new Error(`No mapping found for product ${product.vendorProductId}`);
    }
    
    // Calculate inventory difference
    const currentShopifyInventory = mapping.inventoryLevels[0]?.available || 0;
    const newInventory = vendorInventory.available;
    
    if (currentShopifyInventory === newInventory) {
      logger.debug(`No inventory change for ${product.sku} - skipping update`);
      return;
    }
    
    // Update Shopify inventory with retry
    await this.retryStrategy.executeWithRetry(
      () => shopifyService.updateVariantInventory(mapping, newInventory),
      { ...context, operation: 'update_shopify_inventory', sku: product.sku },
      {
        retryCondition: (error, attempt, ctx) => {
          // Custom retry logic for inventory updates
          if (error.message.includes('inventory_item_not_found')) {
            return false; // Don't retry if inventory item doesn't exist
          }
          return RetryStrategy.defaultRetryCondition(error, attempt, ctx);
        }
      }
    );
    
    logger.info(`Successfully synced ${product.sku}: ${currentShopifyInventory} → ${newInventory}`);
  }
}
```

## Error Monitoring & Alerting

### Error Monitoring Service
```javascript
class ErrorMonitoringService {
  static async trackError(error, context = {}) {
    const errorRecord = {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date(),
      severity: this.calculateSeverity(error, context),
      fingerprint: this.generateFingerprint(error, context)
    };
    
    // Store in database
    await ErrorLog.create(errorRecord);
    
    // Check if this error pattern requires alerting
    await this.checkAlertThresholds(errorRecord);
    
    return errorRecord;
  }
  
  static async checkAlertThresholds(errorRecord) {
    const timeWindow = 15 * 60 * 1000; // 15 minutes
    const now = new Date();
    const windowStart = new Date(now.getTime() - timeWindow);
    
    // Count similar errors in time window
    const similarErrors = await ErrorLog.countDocuments({
      fingerprint: errorRecord.fingerprint,
      timestamp: { $gte: windowStart }
    });
    
    // Alert thresholds
    const thresholds = {
      high: 1,    // Alert immediately for high severity
      medium: 5,  // Alert after 5 occurrences
      low: 10     // Alert after 10 occurrences
    };
    
    if (similarErrors >= thresholds[errorRecord.severity]) {
      await NotificationService.sendAlert({
        type: 'error_threshold_exceeded',
        severity: errorRecord.severity,
        errorType: errorRecord.type,
        message: errorRecord.message,
        occurrences: similarErrors,
        timeWindow: '15 minutes'
      });
    }
  }
  
  static generateFingerprint(error, context) {
    // Create a unique fingerprint for similar errors
    const components = [
      error.constructor.name,
      error.message.replace(/\d+/g, 'N'), // Replace numbers with 'N'
      context.operation || 'unknown',
      context.endpoint || 'unknown'
    ];
    
    return crypto
      .createHash('md5')
      .update(components.join('|'))
      .digest('hex');
  }
  
  static calculateSeverity(error, context) {
    // High severity: Authentication, authorization, data corruption
    if (error.message.includes('unauthorized') || 
        error.message.includes('forbidden') ||
        error.message.includes('corruption')) {
      return 'high';
    }
    
    // Medium severity: Rate limits, temporary failures
    if (error.response?.status === 429 ||
        error.response?.status >= 500 ||
        error.message.includes('rate limit')) {
      return 'medium';
    }
    
    // Low severity: Validation errors, not found errors
    return 'low';
  }
}
```

This comprehensive error handling strategy provides:

1. **Categorized Error Handling** for different API types
2. **Intelligent Retry Logic** with exponential backoff and jitter
3. **Circuit Breaker Pattern** to prevent cascading failures
4. **Real-time Error Tracking** and monitoring
5. **Automated Alerting** based on error patterns and thresholds
6. **Robust Job Processing** with per-product error isolation
7. **Comprehensive Logging** for debugging and analysis
