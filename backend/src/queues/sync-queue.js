const Queue = require('bull');
const logger = require('../utils/logger');
const JobPriority = require('../utils/job-priority');
const ErrorHandler = require('../utils/error-handler');

/**
 * Sync Queue Management
 * Handles sync job queuing, processing, and monitoring
 */
class SyncQueue {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
    this.queue = null;
    this.processors = new Map();
    this.eventHandlers = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the sync queue
   */
  async initialize() {
    try {
      // Create the Bull queue
      this.queue = new Queue('sync queue', {
        redis: this.redisConfig,
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 5,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      });

      // Setup event listeners
      this.setupEventListeners();

      // Setup job processors
      this.setupProcessors();

      this.isInitialized = true;
      logger.info('Sync queue initialized successfully');

      return this.queue;
    } catch (error) {
      logger.error('Failed to initialize sync queue:', error);
      throw ErrorHandler.handleQueueError(error, { queueName: 'sync' });
    }
  }

  /**
   * Setup event listeners for the queue
   */
  setupEventListeners() {
    // Job completed
    this.queue.on('completed', (job, result) => {
      logger.info(`Sync job ${job.id} completed successfully`, {
        jobId: job.id,
        syncId: job.data.syncId,
        duration: job.finishedOn - job.processedOn,
        result: result
      });

      this.emitEvent('job:completed', { job, result });
    });

    // Job failed
    this.queue.on('failed', (job, error) => {
      logger.error(`Sync job ${job.id} failed:`, {
        jobId: job.id,
        syncId: job.data.syncId,
        error: error.message,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts
      });

      this.emitEvent('job:failed', { job, error });
    });

    // Job started (active)
    this.queue.on('active', (job) => {
      logger.info(`Sync job ${job.id} started processing`, {
        jobId: job.id,
        syncId: job.data.syncId,
        priority: job.opts.priority
      });

      this.emitEvent('job:started', { job });
    });

    // Job progress
    this.queue.on('progress', (job, progress) => {
      logger.debug(`Sync job ${job.id} progress: ${progress}%`, {
        jobId: job.id,
        syncId: job.data.syncId,
        progress
      });

      this.emitEvent('job:progress', { job, progress });
    });

    // Job stalled
    this.queue.on('stalled', (job) => {
      logger.warn(`Sync job ${job.id} stalled`, {
        jobId: job.id,
        syncId: job.data.syncId
      });

      this.emitEvent('job:stalled', { job });
    });

    // Queue error
    this.queue.on('error', (error) => {
      logger.error('Sync queue error:', error);
      this.emitEvent('queue:error', { error });
    });

    // Queue waiting
    this.queue.on('waiting', (jobId) => {
      logger.debug(`Job ${jobId} is waiting in sync queue`);
      this.emitEvent('job:waiting', { jobId });
    });

    // Queue paused
    this.queue.on('paused', () => {
      logger.info('Sync queue paused');
      this.emitEvent('queue:paused', {});
    });

    // Queue resumed
    this.queue.on('resumed', () => {
      logger.info('Sync queue resumed');
      this.emitEvent('queue:resumed', {});
    });
  }

  /**
   * Setup job processors
   */
  setupProcessors() {
    // Main sync processor
    this.queue.process('sync', 5, async (job) => {
      return this.processSyncJob(job);
    });

    logger.info('Sync queue processors setup complete');
  }

  /**
   * Process a sync job
   */
  async processSyncJob(job) {
    const { syncId, storeId, vendorId, syncType, options = {} } = job.data;

    try {
      logger.info(`Processing sync job ${job.id}:`, {
        syncId,
        storeId,
        vendorId,
        syncType
      });

      // Update job progress
      await job.progress(5);

      // Import sync job processor
      const SyncJob = require('../jobs/sync-job');

      // Process the sync job
      const result = await new Promise((resolve, reject) => {
        SyncJob.process(job, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        });
      });

      logger.info(`Sync job ${job.id} completed:`, result);
      return result;

    } catch (error) {
      logger.error(`Sync job ${job.id} failed:`, error);
      throw ErrorHandler.handleSyncError(error, {
        syncId,
        storeId,
        vendorId,
        syncType
      });
    }
  }

  /**
   * Add a sync job to the queue
   */
  async addSyncJob(jobData, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      // Determine job priority
      const priorityInfo = JobPriority.determinePriority({
        syncType: jobData.syncType,
        triggeredBy: jobData.options?.triggeredBy,
        userInitiated: jobData.options?.triggeredBy === 'manual',
        isScheduled: jobData.options?.triggeredBy === 'scheduled'
      });

      // Merge queue options with priority settings
      const jobOptions = {
        ...priorityInfo.queueOptions,
        ...options,
        priority: priorityInfo.priorityLevel
      };

      // Add job to queue
      const job = await this.queue.add('sync', jobData, jobOptions);

      logger.info(`Sync job added to queue:`, {
        jobId: job.id,
        syncId: jobData.syncId,
        priority: priorityInfo.priority,
        priorityLevel: priorityInfo.priorityLevel,
        reason: priorityInfo.reason
      });

      this.emitEvent('job:added', { job, priority: priorityInfo });

      return job;

    } catch (error) {
      logger.error('Failed to add sync job to queue:', error);
      throw ErrorHandler.handleQueueError(error, {
        queueName: 'sync',
        jobType: 'sync'
      });
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      return await this.queue.getJob(jobId);
    } catch (error) {
      logger.error(`Failed to get job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      await job.remove();
      logger.info(`Sync job ${jobId} cancelled`);

      this.emitEvent('job:cancelled', { jobId });

      return true;
    } catch (error) {
      logger.error(`Failed to cancel job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId) {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }

      await job.retry();
      logger.info(`Sync job ${jobId} retried`);

      this.emitEvent('job:retried', { jobId });

      return true;
    } catch (error) {
      logger.error(`Failed to retry job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed(),
        this.queue.getDelayed(),
        this.queue.isPaused()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused,
        total: waiting.length + active.length + completed.length + failed.length + delayed.length
      };
    } catch (error) {
      logger.error('Failed to get sync queue stats:', error);
      throw error;
    }
  }

  /**
   * Get jobs by status
   */
  async getJobs(status, start = 0, end = 10) {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      const jobs = await this.queue.getJobs([status], start, end);
      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress(),
        priority: job.opts.priority,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason
      }));
    } catch (error) {
      logger.error(`Failed to get ${status} jobs:`, error);
      throw error;
    }
  }

  /**
   * Pause the queue
   */
  async pause() {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      await this.queue.pause();
      logger.info('Sync queue paused');
      return true;
    } catch (error) {
      logger.error('Failed to pause sync queue:', error);
      throw error;
    }
  }

  /**
   * Resume the queue
   */
  async resume() {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      await this.queue.resume();
      logger.info('Sync queue resumed');
      return true;
    } catch (error) {
      logger.error('Failed to resume sync queue:', error);
      throw error;
    }
  }

  /**
   * Clean completed/failed jobs
   */
  async clean(grace = 0, status = 'completed') {
    if (!this.isInitialized) {
      throw new Error('Sync queue not initialized');
    }

    try {
      const jobs = await this.queue.clean(grace, status);
      logger.info(`Cleaned ${jobs.length} ${status} jobs from sync queue`);
      return jobs;
    } catch (error) {
      logger.error(`Failed to clean ${status} jobs:`, error);
      throw error;
    }
  }

  /**
   * Register event handler
   */
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  /**
   * Emit event to registered handlers
   */
  emitEvent(event, data) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          logger.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Get the underlying Bull queue instance
   */
  getQueue() {
    return this.queue;
  }

  /**
   * Close the queue
   */
  async close() {
    if (this.queue) {
      await this.queue.close();
      this.isInitialized = false;
      logger.info('Sync queue closed');
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    if (!this.isInitialized) {
      return {
        healthy: false,
        error: 'Queue not initialized'
      };
    }

    try {
      const stats = await this.getStats();
      return {
        healthy: true,
        stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = SyncQueue;