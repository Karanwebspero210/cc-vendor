const Queue = require('bull');
const logger = require('../utils/logger');
const InMemoryQueue = require('./inmemory-queue');

// Create a map to store our queues
const queues = new Map();

/**
 * Create a new queue with the given name
 * @param {string} name - The name of the queue
 * @returns {Queue} The created queue
 */
const createQueue = (name) => {
  if (queues.has(name)) {
    return queues.get(name);
  }

  // Default to Redis for durability; only use memory if explicitly requested
  const driver = (process.env.QUEUE_DRIVER || 'redis').toLowerCase();

  let queue;
  if (driver === 'memory') {
    queue = new InMemoryQueue(name);
    logger.info(`Queue ${name} initialized with in-memory driver`);
  } else {
    // Create a new queue with Redis connection (prefer REDIS_URL if given)
    const redisUrl = process.env.REDIS_URL;
    const queueOpts = {
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
      },
    };
    queue = redisUrl
      ? new Queue(name, redisUrl, queueOpts)
      : new Queue(name, {
          redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || '',
            db: process.env.REDIS_DB || 0,
          },
          ...queueOpts,
        });
  }

  // Log queue events
  queue.on('error', (error) => {
    logger.error(`Queue ${name} error:`, error);
  });

  queue.on('waiting', (jobId) => {
    logger.debug(`Job ${jobId} is waiting in queue ${name}`);
  });

  queue.on('active', (job) => {
    logger.info(`Job ${job.id} started processing in queue ${name}`);
  });

  queue.on('completed', (job, result) => {
    logger.info(`Job ${job.id} completed in queue ${name}`, { result });
  });

  queue.on('failed', (job, error) => {
    logger.error(`Job ${job.id} failed in queue ${name}:`, error);
  });

  if (queue.on && queue.eventNames().includes('stalled')) {
    queue.on('stalled', (job) => {
      logger.warn(`Job ${job.id} stalled in queue ${name}`);
    });
  }

  // Store the queue in our map
  queues.set(name, queue);
  
  return queue;
};

/**
 * Gracefully shut down all queues
 */
const closeAllQueues = async () => {
  logger.info('Closing all queues...');
  
  for (const [name, queue] of queues) {
    try {
      logger.info(`Closing queue: ${name}`);
      await queue.close();
      logger.info(`Queue ${name} closed`);
    } catch (error) {
      logger.error(`Error closing queue ${name}:`, error);
    }
  }
  
  // Clear the queues map
  queues.clear();
};

// Handle process termination
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Closing queues...');
  await closeAllQueues();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Closing queues...');
  await closeAllQueues();
  process.exit(0);
});

module.exports = {
  createQueue,
  closeAllQueues,
  queues: Object.freeze(queues) // Export as read-only
};
