const logger = require('../utils/logger');
const ErrorHandler = require('../utils/error-handler');

/**
 * Queue Events Manager
 * Handles queue event coordination and WebSocket integration
 */
class QueueEvents {
  constructor() {
    this.eventHandlers = new Map();
    this.websocketHandler = null;
    this.queues = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize queue events manager
   */
  initialize(websocketHandler = null) {
    this.websocketHandler = websocketHandler;
    this.isInitialized = true;
    logger.info('Queue events manager initialized');
  }

  /**
   * Register a queue for event monitoring
   */
  registerQueue(queueName, queue) {
    if (!queue) {
      throw new Error(`Queue instance required for ${queueName}`);
    }

    this.queues.set(queueName, queue);
    this.setupQueueEventListeners(queueName, queue);
    
    logger.info(`Queue ${queueName} registered for event monitoring`);
  }

  /**
   * Setup event listeners for a specific queue
   */
  setupQueueEventListeners(queueName, queue) {
    // Job events
    queue.on('active', (job) => {
      this.handleJobEvent('job:active', queueName, job);
    });

    queue.on('completed', (job, result) => {
      this.handleJobEvent('job:completed', queueName, job, { result });
    });

    queue.on('failed', (job, error) => {
      this.handleJobEvent('job:failed', queueName, job, { error: error.message });
    });

    queue.on('progress', (job, progress) => {
      this.handleJobEvent('job:progress', queueName, job, { progress });
    });

    queue.on('stalled', (job) => {
      this.handleJobEvent('job:stalled', queueName, job);
    });

    queue.on('waiting', (jobId) => {
      this.handleJobEvent('job:waiting', queueName, null, { jobId });
    });

    // Queue events
    queue.on('paused', () => {
      this.handleQueueEvent('queue:paused', queueName);
    });

    queue.on('resumed', () => {
      this.handleQueueEvent('queue:resumed', queueName);
    });

    queue.on('error', (error) => {
      this.handleQueueEvent('queue:error', queueName, { error: error.message });
    });

    queue.on('cleaned', (jobs, type) => {
      this.handleQueueEvent('queue:cleaned', queueName, { 
        cleanedJobs: jobs.length, 
        type 
      });
    });
  }

  /**
   * Handle job-related events
   */
  handleJobEvent(eventType, queueName, job, additionalData = {}) {
    const eventData = {
      type: eventType,
      queueName,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    if (job) {
      eventData.job = {
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress ? job.progress() : 0,
        priority: job.opts?.priority,
        attempts: job.attemptsMade,
        maxAttempts: job.opts?.attempts,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason
      };
    }

    // Log the event
    this.logEvent(eventType, eventData);

    // Emit to registered handlers
    this.emitEvent(eventType, eventData);

    // Send to WebSocket if available
    if (this.websocketHandler) {
      this.sendToWebSocket(eventType, eventData);
    }
  }

  /**
   * Handle queue-related events
   */
  handleQueueEvent(eventType, queueName, additionalData = {}) {
    const eventData = {
      type: eventType,
      queueName,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    // Log the event
    this.logEvent(eventType, eventData);

    // Emit to registered handlers
    this.emitEvent(eventType, eventData);

    // Send to WebSocket if available
    if (this.websocketHandler) {
      this.sendToWebSocket(eventType, eventData);
    }
  }

  /**
   * Log events based on type and severity
   */
  logEvent(eventType, eventData) {
    const { queueName, job } = eventData;

    switch (eventType) {
      case 'job:completed':
        logger.info(`Job completed in ${queueName}:`, {
          jobId: job?.id,
          duration: job?.finishedOn - job?.processedOn
        });
        break;

      case 'job:failed':
        logger.error(`Job failed in ${queueName}:`, {
          jobId: job?.id,
          error: eventData.error,
          attempts: job?.attempts
        });
        break;

      case 'job:active':
        logger.info(`Job started in ${queueName}:`, {
          jobId: job?.id,
          priority: job?.priority
        });
        break;

      case 'job:stalled':
        logger.warn(`Job stalled in ${queueName}:`, {
          jobId: job?.id
        });
        break;

      case 'queue:error':
        logger.error(`Queue error in ${queueName}:`, eventData.error);
        break;

      case 'queue:paused':
        logger.info(`Queue ${queueName} paused`);
        break;

      case 'queue:resumed':
        logger.info(`Queue ${queueName} resumed`);
        break;

      case 'queue:cleaned':
        logger.info(`Queue ${queueName} cleaned:`, {
          cleanedJobs: eventData.cleanedJobs,
          type: eventData.type
        });
        break;

      default:
        logger.debug(`Queue event ${eventType} in ${queueName}:`, eventData);
    }
  }

  /**
   * Send event to WebSocket handler
   */
  sendToWebSocket(eventType, eventData) {
    try {
      if (this.websocketHandler) {
        // Send to sync events handler if it's a sync-related event
        if (eventData.queueName === 'sync' && this.websocketHandler.syncEvents) {
          this.websocketHandler.syncEvents.handleJobStatusUpdate(
            eventData.job?.id,
            eventData.queueName,
            this.mapEventTypeToStatus(eventType),
            eventData.progress,
            eventData.result,
            eventData.error
          );
        }

        // Send to queue events handler if available
        if (this.websocketHandler.queueEvents) {
          if (eventType.startsWith('job:')) {
            this.websocketHandler.queueEvents.handleJobStatusUpdate(
              eventData.job?.id,
              eventData.queueName,
              this.mapEventTypeToStatus(eventType),
              eventData.progress,
              eventData.result,
              eventData.error
            );
          } else if (eventType.startsWith('queue:')) {
            this.websocketHandler.queueEvents.handleQueueStatusUpdate(
              eventData.queueName,
              this.mapEventTypeToStatus(eventType),
              eventData
            );
          }
        }
      }
    } catch (error) {
      logger.error('Error sending event to WebSocket:', error);
    }
  }

  /**
   * Map event type to status string
   */
  mapEventTypeToStatus(eventType) {
    const statusMap = {
      'job:active': 'running',
      'job:completed': 'completed',
      'job:failed': 'failed',
      'job:stalled': 'stalled',
      'job:waiting': 'waiting',
      'job:progress': 'running',
      'queue:paused': 'paused',
      'queue:resumed': 'active',
      'queue:error': 'error',
      'queue:cleaned': 'cleaned'
    };

    return statusMap[eventType] || 'unknown';
  }

  /**
   * Register event handler
   */
  on(eventType, handler) {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType).push(handler);
    
    logger.debug(`Event handler registered for ${eventType}`);
  }

  /**
   * Remove event handler
   */
  off(eventType, handler) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        logger.debug(`Event handler removed for ${eventType}`);
      }
    }
  }

  /**
   * Emit event to registered handlers
   */
  emitEvent(eventType, eventData) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers && handlers.length > 0) {
      handlers.forEach(handler => {
        try {
          handler(eventData);
        } catch (error) {
          logger.error(`Error in event handler for ${eventType}:`, error);
        }
      });
    }

    // Also emit to wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers && wildcardHandlers.length > 0) {
      wildcardHandlers.forEach(handler => {
        try {
          handler(eventType, eventData);
        } catch (error) {
          logger.error(`Error in wildcard event handler:`, error);
        }
      });
    }
  }

  /**
   * Get queue statistics for all registered queues
   */
  async getAllQueueStats() {
    const stats = {};

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
          queue.getDelayed(),
          queue.isPaused()
        ]);

        stats[queueName] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          paused,
          total: waiting.length + active.length + completed.length + failed.length + delayed.length,
          lastUpdated: new Date().toISOString()
        };
      } catch (error) {
        logger.error(`Error getting stats for queue ${queueName}:`, error);
        stats[queueName] = {
          error: error.message,
          lastUpdated: new Date().toISOString()
        };
      }
    }

    return stats;
  }

  /**
   * Get specific queue statistics
   */
  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
        queue.isPaused()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Error getting stats for queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Get recent events for monitoring
   */
  getRecentEvents(limit = 50) {
    // This would typically be stored in a circular buffer or database
    // For now, return empty array as events are handled in real-time
    return [];
  }

  /**
   * Pause all registered queues
   */
  async pauseAllQueues() {
    const results = {};

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        await queue.pause();
        results[queueName] = { success: true };
        logger.info(`Queue ${queueName} paused`);
      } catch (error) {
        results[queueName] = { success: false, error: error.message };
        logger.error(`Failed to pause queue ${queueName}:`, error);
      }
    }

    return results;
  }

  /**
   * Resume all registered queues
   */
  async resumeAllQueues() {
    const results = {};

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        await queue.resume();
        results[queueName] = { success: true };
        logger.info(`Queue ${queueName} resumed`);
      } catch (error) {
        results[queueName] = { success: false, error: error.message };
        logger.error(`Failed to resume queue ${queueName}:`, error);
      }
    }

    return results;
  }

  /**
   * Clean all queues
   */
  async cleanAllQueues(grace = 0, status = 'completed') {
    const results = {};

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const cleanedJobs = await queue.clean(grace, status);
        results[queueName] = { 
          success: true, 
          cleanedJobs: cleanedJobs.length 
        };
        logger.info(`Cleaned ${cleanedJobs.length} ${status} jobs from queue ${queueName}`);
      } catch (error) {
        results[queueName] = { success: false, error: error.message };
        logger.error(`Failed to clean queue ${queueName}:`, error);
      }
    }

    return results;
  }

  /**
   * Get registered queue names
   */
  getQueueNames() {
    return Array.from(this.queues.keys());
  }

  /**
   * Check if queue is registered
   */
  hasQueue(queueName) {
    return this.queues.has(queueName);
  }

  /**
   * Get queue instance
   */
  getQueue(queueName) {
    return this.queues.get(queueName);
  }

  /**
   * Health check for all queues
   */
  async healthCheck() {
    const health = {
      healthy: true,
      queues: {},
      timestamp: new Date().toISOString()
    };

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const stats = await this.getQueueStats(queueName);
        health.queues[queueName] = {
          healthy: true,
          stats
        };
      } catch (error) {
        health.healthy = false;
        health.queues[queueName] = {
          healthy: false,
          error: error.message
        };
      }
    }

    return health;
  }

  /**
   * Cleanup and close all queues
   */
  async cleanup() {
    logger.info('Cleaning up queue events manager...');

    for (const [queueName, queue] of this.queues.entries()) {
      try {
        await queue.close();
        logger.info(`Queue ${queueName} closed`);
      } catch (error) {
        logger.error(`Error closing queue ${queueName}:`, error);
      }
    }

    this.queues.clear();
    this.eventHandlers.clear();
    this.isInitialized = false;

    logger.info('Queue events manager cleanup complete');
  }
}

// Create singleton instance
const queueEvents = new QueueEvents();

module.exports = queueEvents;