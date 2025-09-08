const logger = require("../utils/logger");
const InMemoryQueue = require("./inmemory-queue");

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

  // Force in-memory driver (no Redis/Bull)
  const queue = new InMemoryQueue(name);
  logger.info(`Queue ${name} initialized with in-memory driver`);

  // Log queue events
  queue.on("error", (error) => {
    logger.error(`Queue ${name} error:`, error);
  });

  queue.on("waiting", (jobId) => {
    logger.debug(`Job ${jobId} is waiting in queue ${name}`);
  });

  queue.on("active", (job) => {
    logger.info(`Job ${job.id} started processing in queue ${name}`);
  });

  queue.on("completed", (job, result) => {
    logger.info(`Job ${job.id} completed in queue ${name}`, { result });
  });

  queue.on("failed", (job, error) => {
    logger.error(`Job ${job.id} failed in queue ${name}:`, error);
  });

  // No 'stalled' event for in-memory queue

  // Store the queue in our map
  queues.set(name, queue);

  return queue;
};

/**
 * Gracefully shut down all queues
 */
const closeAllQueues = async () => {
  logger.info("Closing all queues...");

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
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received. Closing queues...");
  await closeAllQueues();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received. Closing queues...");
  await closeAllQueues();
  process.exit(0);
});

module.exports = {
  createQueue,
  closeAllQueues,
  queues: Object.freeze(queues), // Export as read-only
};
