const logger = require('./logger');

/**
 * Job Priority Management Utility
 * Handles priority assignment and queue management for sync jobs
 */
class JobPriority {
  // Priority levels (higher number = higher priority)
  static PRIORITY_LEVELS = {
    CRITICAL: 10,    // System critical operations
    HIGH: 7,         // Manual user-initiated syncs
    NORMAL: 5,       // Regular scheduled syncs
    LOW: 3,          // Batch operations
    BACKGROUND: 1    // Cleanup and maintenance
  };

  // Priority names for easy reference
  static PRIORITIES = {
    CRITICAL: 'critical',
    HIGH: 'high',
    NORMAL: 'normal',
    LOW: 'low',
    BACKGROUND: 'background'
  };

  /**
   * Get priority level by name
   * @param {string} priorityName - Priority name
   * @returns {number} - Priority level
   */
  static getPriorityLevel(priorityName) {
    const level = this.PRIORITY_LEVELS[priorityName.toUpperCase()];
    if (level === undefined) {
      logger.warn(`Unknown priority level: ${priorityName}, defaulting to NORMAL`);
      return this.PRIORITY_LEVELS.NORMAL;
    }
    return level;
  }

  /**
   * Get priority name by level
   * @param {number} priorityLevel - Priority level
   * @returns {string} - Priority name
   */
  static getPriorityName(priorityLevel) {
    const entry = Object.entries(this.PRIORITY_LEVELS)
      .find(([, level]) => level === priorityLevel);
    return entry ? entry[0].toLowerCase() : 'normal';
  }

  /**
   * Determine job priority based on context
   * @param {object} jobContext - Job context information
   * @returns {object} - Priority information
   */
  static determinePriority(jobContext) {
    const {
      syncType,
      triggeredBy,
      storeCount = 1,
      vendorCount = 1,
      isScheduled = false,
      isRetry = false,
      retryCount = 0,
      hasErrors = false,
      userInitiated = false
    } = jobContext;

    let priority = this.PRIORITIES.NORMAL;
    let reason = 'Default priority';

    // Critical priority conditions
    if (hasErrors && retryCount > 0) {
      priority = this.PRIORITIES.CRITICAL;
      reason = 'Error recovery retry';
    } else if (syncType === 'emergency' || triggeredBy === 'emergency') {
      priority = this.PRIORITIES.CRITICAL;
      reason = 'Emergency sync operation';
    }
    // High priority conditions
    else if (userInitiated || triggeredBy === 'manual') {
      priority = this.PRIORITIES.HIGH;
      reason = 'User-initiated operation';
    } else if (syncType === 'inventory' && !isScheduled) {
      priority = this.PRIORITIES.HIGH;
      reason = 'Manual inventory sync';
    }
    // Low priority conditions
    else if (storeCount > 5 || vendorCount > 5) {
      priority = this.PRIORITIES.LOW;
      reason = 'Large batch operation';
    } else if (syncType === 'full' && isScheduled) {
      priority = this.PRIORITIES.LOW;
      reason = 'Scheduled full sync';
    }
    // Background priority conditions
    else if (syncType === 'cleanup' || triggeredBy === 'maintenance') {
      priority = this.PRIORITIES.BACKGROUND;
      reason = 'Maintenance operation';
    }
    // Normal priority (scheduled operations)
    else if (isScheduled) {
      priority = this.PRIORITIES.NORMAL;
      reason = 'Scheduled operation';
    }

    const priorityLevel = this.getPriorityLevel(priority);

    logger.debug('Job priority determined:', {
      priority,
      priorityLevel,
      reason,
      jobContext
    });

    return {
      priority,
      priorityLevel,
      reason,
      queueOptions: this.getQueueOptions(priority, jobContext)
    };
  }

  /**
   * Get Bull queue options based on priority
   * @param {string} priority - Priority name
   * @param {object} jobContext - Job context
   * @returns {object} - Bull queue options
   */
  static getQueueOptions(priority, jobContext = {}) {
    const priorityLevel = this.getPriorityLevel(priority);
    const { isRetry = false, retryCount = 0 } = jobContext;

    const baseOptions = {
      priority: priorityLevel,
      removeOnComplete: 10,
      removeOnFail: 5
    };

    switch (priority) {
      case this.PRIORITIES.CRITICAL:
        return {
          ...baseOptions,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          delay: 0, // Execute immediately
          removeOnComplete: 20,
          removeOnFail: 10
        };

      case this.PRIORITIES.HIGH:
        return {
          ...baseOptions,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          delay: isRetry ? 1000 : 0,
          removeOnComplete: 15,
          removeOnFail: 8
        };

      case this.PRIORITIES.NORMAL:
        return {
          ...baseOptions,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 10000
          },
          delay: isRetry ? 5000 : 0
        };

      case this.PRIORITIES.LOW:
        return {
          ...baseOptions,
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 30000
          },
          delay: isRetry ? 30000 : 10000,
          removeOnComplete: 5,
          removeOnFail: 3
        };

      case this.PRIORITIES.BACKGROUND:
        return {
          ...baseOptions,
          attempts: 1,
          backoff: {
            type: 'fixed',
            delay: 60000
          },
          delay: 60000, // Always delay background jobs
          removeOnComplete: 3,
          removeOnFail: 2
        };

      default:
        return baseOptions;
    }
  }

  /**
   * Calculate job delay based on system load and priority
   * @param {string} priority - Priority name
   * @param {object} systemLoad - Current system load metrics
   * @returns {number} - Delay in milliseconds
   */
  static calculateDelay(priority, systemLoad = {}) {
    const {
      activeJobs = 0,
      queueLength = 0,
      cpuUsage = 0,
      memoryUsage = 0
    } = systemLoad;

    const baseDelay = this.getQueueOptions(priority).delay || 0;

    // Don't add delay for critical jobs
    if (priority === this.PRIORITIES.CRITICAL) {
      return baseDelay;
    }

    // Calculate load factor (0-1)
    const loadFactor = Math.min(1, (
      (activeJobs / 10) * 0.3 +
      (queueLength / 50) * 0.3 +
      (cpuUsage / 100) * 0.2 +
      (memoryUsage / 100) * 0.2
    ));

    // Apply load-based delay multiplier
    const loadMultiplier = 1 + (loadFactor * 2); // 1x to 3x multiplier
    const calculatedDelay = Math.floor(baseDelay * loadMultiplier);

    logger.debug('Job delay calculated:', {
      priority,
      baseDelay,
      loadFactor,
      loadMultiplier,
      calculatedDelay,
      systemLoad
    });

    return calculatedDelay;
  }

  /**
   * Get recommended concurrency for job type
   * @param {string} jobType - Type of job (sync, batch, scheduled)
   * @param {string} priority - Priority level
   * @returns {number} - Recommended concurrency
   */
  static getRecommendedConcurrency(jobType, priority) {
    const concurrencyMap = {
      sync: {
        [this.PRIORITIES.CRITICAL]: 3,
        [this.PRIORITIES.HIGH]: 5,
        [this.PRIORITIES.NORMAL]: 3,
        [this.PRIORITIES.LOW]: 2,
        [this.PRIORITIES.BACKGROUND]: 1
      },
      batch: {
        [this.PRIORITIES.CRITICAL]: 1,
        [this.PRIORITIES.HIGH]: 2,
        [this.PRIORITIES.NORMAL]: 2,
        [this.PRIORITIES.LOW]: 1,
        [this.PRIORITIES.BACKGROUND]: 1
      },
      scheduled: {
        [this.PRIORITIES.CRITICAL]: 2,
        [this.PRIORITIES.HIGH]: 3,
        [this.PRIORITIES.NORMAL]: 3,
        [this.PRIORITIES.LOW]: 2,
        [this.PRIORITIES.BACKGROUND]: 1
      }
    };

    return concurrencyMap[jobType]?.[priority] || 2;
  }

  /**
   * Check if job should be throttled based on priority and system state
   * @param {string} priority - Job priority
   * @param {object} systemState - Current system state
   * @returns {object} - Throttling decision
   */
  static shouldThrottle(priority, systemState = {}) {
    const {
      activeJobs = 0,
      failedJobsLastHour = 0,
      systemHealth = 'good'
    } = systemState;

    // Never throttle critical jobs
    if (priority === this.PRIORITIES.CRITICAL) {
      return {
        shouldThrottle: false,
        reason: 'Critical priority jobs are never throttled'
      };
    }

    // Throttle if system is unhealthy
    if (systemHealth === 'poor') {
      return {
        shouldThrottle: priority !== this.PRIORITIES.HIGH,
        reason: 'System health is poor'
      };
    }

    // Throttle if too many active jobs
    if (activeJobs > 20) {
      return {
        shouldThrottle: [this.PRIORITIES.LOW, this.PRIORITIES.BACKGROUND].includes(priority),
        reason: 'Too many active jobs'
      };
    }

    // Throttle if too many recent failures
    if (failedJobsLastHour > 10) {
      return {
        shouldThrottle: priority === this.PRIORITIES.BACKGROUND,
        reason: 'High failure rate detected'
      };
    }

    return {
      shouldThrottle: false,
      reason: 'No throttling conditions met'
    };
  }

  /**
   * Get priority statistics for monitoring
   * @param {array} jobs - Array of job objects
   * @returns {object} - Priority statistics
   */
  static getPriorityStats(jobs) {
    const stats = {
      total: jobs.length,
      byPriority: {},
      byStatus: {},
      averageWaitTime: 0
    };

    let totalWaitTime = 0;

    for (const job of jobs) {
      const priority = this.getPriorityName(job.priority || 5);
      const status = job.status || 'unknown';

      // Count by priority
      stats.byPriority[priority] = (stats.byPriority[priority] || 0) + 1;

      // Count by status
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Calculate wait time
      if (job.processedOn && job.timestamp) {
        totalWaitTime += job.processedOn - job.timestamp;
      }
    }

    if (jobs.length > 0) {
      stats.averageWaitTime = Math.floor(totalWaitTime / jobs.length);
    }

    return stats;
  }
}

module.exports = JobPriority;
