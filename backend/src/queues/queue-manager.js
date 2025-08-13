const Queue = require('bull');
const logger = require('../utils/logger');
const SyncJob = require('../jobs/sync-job');
const BatchSyncJob = require('../jobs/batch-sync-job');
const ScheduledSyncJob = require('../jobs/scheduled-sync-job');

/**
 * Queue Manager
 * Manages Bull queues and job processing
 */
class QueueManager {
  constructor() {
    this.queues = {};
    this.redisConfig = {
      redis: {
        port: process.env.REDIS_PORT || 6379,
        host: process.env.REDIS_HOST || 'localhost',
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0
      }
    };
  }

  /**
   * Initialize all queues
   */
  initialize() {
    logger.info('Initializing queue manager...');

    // Create queues
    this.queues.sync = new Queue('sync queue', this.redisConfig);
    this.queues.batch = new Queue('batch queue', this.redisConfig);
    this.queues.scheduled = new Queue('scheduled queue', this.redisConfig);

    // Setup job processors
    this.setupProcessors();

    // Setup event listeners
    this.setupEventListeners();

    logger.info('Queue manager initialized successfully');
  }

  /**
   * Setup job processors
   */
  setupProcessors() {
    // Sync queue processor
    this.queues.sync.process('sync', 5, async (job, done) => {
      try {
        await SyncJob.process(job, done);
      } catch (error) {
        logger.error('Error in sync job processor:', error);
        done(error);
      }
    });

    // Batch queue processor
    this.queues.batch.process('batch-sync', 2, async (job, done) => {
      try {
        await BatchSyncJob.process(job, done);
      } catch (error) {
        logger.error('Error in batch sync job processor:', error);
        done(error);
      }
    });

    // Scheduled queue processor
    this.queues.scheduled.process('scheduled-sync', 3, async (job, done) => {
      try {
        await ScheduledSyncJob.process(job, done);
      } catch (error) {
        logger.error('Error in scheduled sync job processor:', error);
        done(error);
      }
    });

    logger.info('Queue processors setup complete');
  }

  /**
   * Setup event listeners for all queues
   */
  setupEventListeners() {
    Object.keys(this.queues).forEach(queueName => {
      const queue = this.queues[queueName];

      // Job completed
      queue.on('completed', (job, result) => {
        logger.info(`Job ${job.id} in ${queueName} queue completed`, { jobId: job.id, result });
        
        // Call specific job completion handlers
        if (queueName === 'sync') SyncJob.onCompleted(job, result);
        else if (queueName === 'batch') BatchSyncJob.onCompleted(job, result);
        else if (queueName === 'scheduled') ScheduledSyncJob.onCompleted(job, result);
      });

      // Job failed
      queue.on('failed', (job, error) => {
        logger.error(`Job ${job.id} in ${queueName} queue failed:`, error);
        
        // Call specific job failure handlers
        if (queueName === 'sync') SyncJob.onFailed(job, error);
        else if (queueName === 'batch') BatchSyncJob.onFailed(job, error);
        else if (queueName === 'scheduled') ScheduledSyncJob.onFailed(job, error);
      });

      // Job progress
      queue.on('progress', (job, progress) => {
        logger.debug(`Job ${job.id} in ${queueName} queue progress: ${progress}%`);
        
        // Call specific job progress handlers
        if (queueName === 'sync') SyncJob.onProgress(job, progress);
        else if (queueName === 'batch') BatchSyncJob.onProgress(job, progress);
        else if (queueName === 'scheduled') ScheduledSyncJob.onProgress(job, progress);
      });

      // Job stalled
      queue.on('stalled', (job) => {
        logger.warn(`Job ${job.id} in ${queueName} queue stalled`);
      });

      // Queue error
      queue.on('error', (error) => {
        logger.error(`Error in ${queueName} queue:`, error);
      });
    });

    logger.info('Queue event listeners setup complete');
  }

  /**
   * Add a sync job to the queue
   */
  async addSyncJob(data, options = {}) {
    const jobOptions = {
      delay: options.delay || 0,
      attempts: options.attempts || 3,
      backoff: options.backoff || 'exponential',
      removeOnComplete: options.removeOnComplete || 10,
      removeOnFail: options.removeOnFail || 5,
      ...options
    };

    const job = await this.queues.sync.add('sync', data, jobOptions);
    logger.info(`Added sync job ${job.id} to queue`, { syncId: data.syncId });
    return job;
  }

  /**
   * Add a batch sync job to the queue
   */
  async addBatchSyncJob(data, options = {}) {
    const jobOptions = {
      delay: options.delay || 0,
      attempts: options.attempts || 2,
      backoff: options.backoff || 'exponential',
      removeOnComplete: options.removeOnComplete || 5,
      removeOnFail: options.removeOnFail || 3,
      ...options
    };

    const job = await this.queues.batch.add('batch-sync', data, jobOptions);
    logger.info(`Added batch sync job ${job.id} to queue`, { batchId: data.batchId });
    return job;
  }

  /**
   * Add a scheduled sync job to the queue
   */
  async addScheduledSyncJob(data, options = {}) {
    const jobOptions = {
      delay: options.delay || 0,
      attempts: options.attempts || 2,
      backoff: options.backoff || 'exponential',
      removeOnComplete: options.removeOnComplete || 5,
      removeOnFail: options.removeOnFail || 3,
      ...options
    };

    const job = await this.queues.scheduled.add('scheduled-sync', data, jobOptions);
    logger.info(`Added scheduled sync job ${job.id} to queue`, { scheduleId: data.scheduleId });
    return job;
  }

  /**
   * Get queue by name
   */
  getQueue(name) {
    return this.queues[name];
  }

  /**
   * Get all queues
   */
  getAllQueues() {
    return this.queues;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length
    };
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    logger.info(`Queue ${queueName} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName) {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    logger.info(`Queue ${queueName} resumed`);
  }

  /**
   * Clean a queue
   */
  async cleanQueue(queueName, grace = 0, status = 'completed') {
    const queue = this.queues[queueName];
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const jobs = await queue.clean(grace, status);
    logger.info(`Cleaned ${jobs.length} ${status} jobs from ${queueName} queue`);
    return jobs;
  }

  /**
   * Gracefully close all queues
   */
  async close() {
    logger.info('Closing queue manager...');

    const closePromises = Object.keys(this.queues).map(async (queueName) => {
      try {
        await this.queues[queueName].close();
        logger.info(`Queue ${queueName} closed`);
      } catch (error) {
        logger.error(`Error closing queue ${queueName}:`, error);
      }
    });

    await Promise.all(closePromises);
    logger.info('Queue manager closed');
  }
}

// Create singleton instance
const queueManager = new QueueManager();

module.exports = queueManager;
