const { ResponseHelper } = require("../utils/helpers");
const logger = require("../utils/logger");
// const Queue = require('bull');
// const redis = require('redis');

// // Queue instances (these would be initialized in a queue service)
// const syncQueue = new Queue('sync queue', process.env.REDIS_URL || 'redis://localhost:6379');
// const batchQueue = new Queue('batch queue', process.env.REDIS_URL || 'redis://localhost:6379');
// const cronQueue = new Queue('cron queue', process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Queue Controller
 * Handles job queue management and monitoring operations
 */
class QueueController {
  /**
   * Get overall queue status and statistics
   */
  async getQueueStatus(req, res) {
    try {
      // Get status from Bull queue instances
      const [syncCounts, batchCounts, cronCounts] = await Promise.all([
        sync.getJobCounts(),
        batch.getJobCounts(),
        scheduled.getJobCounts(),
      ]);

      // Workers not applicable for in-memory; return 0
      const [syncWorkers, batchWorkers, cronWorkers] = [[], [], []];

      const queueStatus = {
        queues: {
          sync: {
            active: syncCounts.active || 0,
            waiting: syncCounts.waiting || 0,
            completed: syncCounts.completed || 0,
            failed: syncCounts.failed || 0,
            delayed: syncCounts.delayed || 0,
            paused: syncCounts.paused || 0,
          },
          batch: {
            active: batchCounts.active || 0,
            waiting: batchCounts.waiting || 0,
            completed: batchCounts.completed || 0,
            failed: batchCounts.failed || 0,
            delayed: batchCounts.delayed || 0,
            paused: batchCounts.paused || 0,
          },
          cron: {
            active: cronCounts.active || 0,
            waiting: cronCounts.waiting || 0,
            completed: cronCounts.completed || 0,
            failed: cronCounts.failed || 0,
            delayed: cronCounts.delayed || 0,
            paused: cronCounts.paused || 0,
          },
        },
        workers: {
          sync: 0,
          batch: 0,
          cron: 0,
          total: 0,
        },
        system: {
          memory: process.memoryUsage(),
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
      };

      ResponseHelper.success(
        res,
        queueStatus,
        "Queue status retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving queue status:", error);
      ResponseHelper.error(
        res,
        "Failed to retrieve queue status",
        500,
        "QUEUE_STATUS_ERROR"
      );
    }
  }

  /**
   * Get all jobs in the queue
   */
  async getJobs(req, res) {
    try {
      const { status, type, page = 1, limit = 50 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Determine which queues to query
      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queuesToQuery = [];
      if (!type || type === "sync")
        queuesToQuery.push({ queue: sync, name: "sync" });
      if (!type || type === "batch")
        queuesToQuery.push({ queue: batch, name: "batch" });
      if (!type || type === "cron")
        queuesToQuery.push({ queue: scheduled, name: "cron" });

      // Fetch jobs from queues
      let allJobs = [];
      for (const { queue, name } of queuesToQuery) {
        let queueJobs = [];

        if (!status || status === "active") {
          const activeJobs = await queue.getActive();
          queueJobs.push(
            ...activeJobs.map((job) => ({
              ...job,
              queueType: name,
              status: "active",
            }))
          );
        }
        if (!status || status === "waiting") {
          const waitingJobs = await queue.getWaiting();
          queueJobs.push(
            ...waitingJobs.map((job) => ({
              ...job,
              queueType: name,
              status: "waiting",
            }))
          );
        }
        if (!status || status === "completed") {
          const completedJobs = await queue.getCompleted();
          queueJobs.push(
            ...completedJobs.map((job) => ({
              ...job,
              queueType: name,
              status: "completed",
            }))
          );
        }
        if (!status || status === "failed") {
          const failedJobs = await queue.getFailed();
          queueJobs.push(
            ...failedJobs.map((job) => ({
              ...job,
              queueType: name,
              status: "failed",
            }))
          );
        }

        allJobs.push(...queueJobs);
      }

      // Sort by creation time (newest first)
      allJobs.sort(
        (a, b) =>
          new Date(b.timestamp || b.processedOn || b.finishedOn) -
          new Date(a.timestamp || a.processedOn || a.finishedOn)
      );

      // Apply pagination
      const total = allJobs.length;
      const jobs = allJobs.slice(skip, skip + parseInt(limit)).map((job) => ({
        id: job.id,
        name: job.name,
        queueType: job.queueType,
        status: job.status,
        data: job.data,
        progress: job.progress || 0,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
        failedReason: job.failedReason,
        returnvalue: job.returnvalue,
      }));

      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      };

      ResponseHelper.success(
        res,
        {
          jobs,
          pagination,
          filters: { status, type },
        },
        "Queue jobs retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving queue jobs:", error);
      ResponseHelper.error(
        res,
        "Failed to retrieve queue jobs",
        500,
        "QUEUE_JOBS_ERROR"
      );
    }
  }

  /**
   * Get specific job status and details
   */
  async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queues = [sync, batch, scheduled];
      let foundJob = null;
      let queueType = null;

      for (const [index, queue] of queues.entries()) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            foundJob = job;
            queueType = ["sync", "batch", "cron"][index];
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!foundJob) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }

      // Get job state
      const state = await foundJob.getState();

      const jobStatus = {
        jobId: foundJob.id,
        name: foundJob.name,
        queueType,
        status: state,
        progress:
          typeof foundJob._progress === "number" ? foundJob._progress : 0,
        data: foundJob.data,
        result: foundJob.returnvalue,
        createdAt: foundJob.timestamp,
        processedAt: foundJob.processedOn,
        finishedAt: foundJob.finishedOn,
        failedReason: foundJob.failedReason,
        attemptsMade: foundJob.attemptsMade,
        delay: foundJob.delay,
      };

      ResponseHelper.success(
        res,
        jobStatus,
        "Job status retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving job status:", error);
      ResponseHelper.error(
        res,
        "Failed to retrieve job status",
        500,
        "JOB_STATUS_ERROR"
      );
    }
  }

  /**
   * Cancel a specific job
   */
  async cancelJob(req, res) {
    try {
      const { jobId } = req.params;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queues = [sync, batch, scheduled];
      let foundJob = null;
      let queueType = null;

      for (const [index, queue] of queues.entries()) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            foundJob = job;
            queueType = ["sync", "batch", "cron"][index];
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!foundJob) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }

      // Cancel the job (remove from queue)
      const state = await foundJob.getState();
      await foundJob.remove();

      const cancelResult = {
        jobId: foundJob.id,
        queueType,
        cancelled: true,
        cancelledAt: new Date(),
        previousState: state,
      };

      ResponseHelper.success(res, cancelResult, "Job cancelled successfully");
    } catch (error) {
      logger.error("Error cancelling job:", error);
      ResponseHelper.error(
        res,
        "Failed to cancel job",
        500,
        "JOB_CANCEL_ERROR"
      );
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(req, res) {
    try {
      const { jobId } = req.params;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queues = [sync, batch, scheduled];
      let foundJob = null;
      let queueType = null;

      for (const [index, queue] of queues.entries()) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            foundJob = job;
            queueType = ["sync", "batch", "cron"][index];
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!foundJob) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }

      // Retry the job (works only for failed)
      await foundJob.retry();
      const state = await foundJob.getState();

      const retryResult = {
        jobId: foundJob.id,
        queueType,
        retried: true,
        retriedAt: new Date(),
        attemptsMade: foundJob.attemptsMade,
      };

      ResponseHelper.success(
        res,
        retryResult,
        "Job retry initiated successfully"
      );
    } catch (error) {
      logger.error("Error retrying job:", error);
      ResponseHelper.error(res, "Failed to retry job", 500, "JOB_RETRY_ERROR");
    }
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(req, res) {
    try {
      const { jobId } = req.params;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queues = [sync, batch, scheduled];
      let foundJob = null;
      let queueType = null;

      for (const [index, queue] of queues.entries()) {
        try {
          const job = await queue.getJob(jobId);
          if (job) {
            foundJob = job;
            queueType = ["sync", "batch", "cron"][index];
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!foundJob) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }

      // Remove the job
      await foundJob.remove();

      logger.info(`Job ${jobId} removed from ${queueType} queue`);

      ResponseHelper.success(
        res,
        {
          jobId: foundJob.id,
          queueType,
          removed: true,
          removedAt: new Date(),
        },
        "Job removed successfully"
      );
    } catch (error) {
      logger.error("Error removing job:", error);
      ResponseHelper.error(
        res,
        "Failed to remove job",
        500,
        "JOB_REMOVE_ERROR"
      );
    }
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(req, res) {
    try {
      const { queueName } = req.body;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queuesToPause = [];

      if (!queueName || queueName === "all") {
        queuesToPause.push(
          { queue: sync, name: "sync" },
          { queue: batch, name: "batch" },
          { queue: scheduled, name: "cron" }
        );
      } else {
        switch (queueName) {
          case "sync":
            queuesToPause.push({ queue: sync, name: "sync" });
            break;
          case "batch":
            queuesToPause.push({ queue: batch, name: "batch" });
            break;
          case "cron":
            queuesToPause.push({ queue: scheduled, name: "cron" });
            break;
          default:
            return ResponseHelper.error(
              res,
              "Invalid queue name",
              400,
              "INVALID_QUEUE_NAME"
            );
        }
      }

      // Pause the queues
      const pausePromises = queuesToPause.map(({ queue }) => queue.pause());
      await Promise.all(pausePromises);

      const pauseResult = {
        paused: true,
        queueNames: queuesToPause.map((q) => q.name),
        pausedAt: new Date(),
      };

      logger.info(
        `Queues paused: ${queuesToPause.map((q) => q.name).join(", ")}`
      );

      ResponseHelper.success(res, pauseResult, "Queue(s) paused successfully");
    } catch (error) {
      logger.error("Error pausing queue:", error);
      ResponseHelper.error(
        res,
        "Failed to pause queue",
        500,
        "QUEUE_PAUSE_ERROR"
      );
    }
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(req, res) {
    try {
      const { queueName } = req.body;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queuesToResume = [];

      if (!queueName || queueName === "all") {
        queuesToResume.push(
          { queue: sync, name: "sync" },
          { queue: batch, name: "batch" },
          { queue: scheduled, name: "cron" }
        );
      } else {
        switch (queueName) {
          case "sync":
            queuesToResume.push({ queue: sync, name: "sync" });
            break;
          case "batch":
            queuesToResume.push({ queue: batch, name: "batch" });
            break;
          case "cron":
            queuesToResume.push({ queue: scheduled, name: "cron" });
            break;
          default:
            return ResponseHelper.error(
              res,
              "Invalid queue name",
              400,
              "INVALID_QUEUE_NAME"
            );
        }
      }

      // Resume the queues
      const resumePromises = queuesToResume.map(({ queue }) => queue.resume());
      await Promise.all(resumePromises);

      const resumeResult = {
        resumed: true,
        queueNames: queuesToResume.map((q) => q.name),
        resumedAt: new Date(),
      };

      logger.info(
        `Queues resumed: ${queuesToResume.map((q) => q.name).join(", ")}`
      );

      ResponseHelper.success(
        res,
        resumeResult,
        "Queue(s) resumed successfully"
      );
    } catch (error) {
      logger.error("Error resuming queue:", error);
      ResponseHelper.error(
        res,
        "Failed to resume queue",
        500,
        "QUEUE_RESUME_ERROR"
      );
    }
  }

  /**
   * Clear completed and failed jobs from queue
   */
  async clearQueue(req, res) {
    try {
      const { status = "completed", queueName } = req.body;

      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queuesToClear = [];

      if (!queueName || queueName === "all") {
        queuesToClear.push(
          { queue: sync, name: "sync" },
          { queue: batch, name: "batch" },
          { queue: scheduled, name: "cron" }
        );
      } else {
        switch (queueName) {
          case "sync":
            queuesToClear.push({ queue: sync, name: "sync" });
            break;
          case "batch":
            queuesToClear.push({ queue: batch, name: "batch" });
            break;
          case "cron":
            queuesToClear.push({ queue: scheduled, name: "cron" });
            break;
          default:
            return ResponseHelper.error(
              res,
              "Invalid queue name",
              400,
              "INVALID_QUEUE_NAME"
            );
        }
      }

      let clearedCount = 0;

      // Clear jobs based on status
      for (const { queue, name } of queuesToClear) {
        try {
          if (status === "completed" || status === "all") {
            const completed = await queue.clean(0, "completed");
            clearedCount += completed.length;
          }
          if (status === "failed" || status === "all") {
            const failed = await queue.clean(0, "failed");
            clearedCount += failed.length;
          }
          if (status === "active" && status !== "all") {
            const active = await queue.clean(0, "active");
            clearedCount += active.length;
          }
        } catch (error) {
          logger.error(`Error clearing ${name} queue:`, error);
        }
      }

      const clearResult = {
        cleared: true,
        status,
        queueNames: queuesToClear.map((q) => q.name),
        clearedCount,
        clearedAt: new Date(),
      };

      logger.info(
        `Cleared ${clearedCount} ${status} jobs from queues: ${queuesToClear
          .map((q) => q.name)
          .join(", ")}`
      );

      ResponseHelper.success(res, clearResult, "Queue(s) cleared successfully");
    } catch (error) {
      logger.error("Error clearing queue:", error);
      ResponseHelper.error(
        res,
        "Failed to clear queue",
        500,
        "QUEUE_CLEAR_ERROR"
      );
    }
  }

  /**
   * Get detailed queue statistics
   */
  async getQueueStats(req, res) {
    try {
      const { period = "24h" } = req.query;

      // Calculate time range based on period
      const now = Date.now();
      let startTime;

      switch (period) {
        case "1h":
          startTime = now - 60 * 60 * 1000;
          break;
        case "24h":
          startTime = now - 24 * 60 * 60 * 1000;
          break;
        case "7d":
          startTime = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case "30d":
          startTime = now - 30 * 24 * 60 * 60 * 1000;
          break;
        default:
          startTime = now - 24 * 60 * 60 * 1000;
      }

      // Ensure initialized and get queues
      if (!queueManager.queues || !queueManager.queues.sync) {
        queueManager.initialize();
      }

      const { sync, batch, scheduled } = queueManager.getAllQueues();
      const queueStats = {};
      const queues = [
        { queue: sync, name: "sync" },
        { queue: batch, name: "batch" },
        { queue: scheduled, name: "cron" },
      ];

      let totalJobs = 0;
      let totalSuccess = 0;
      let totalFailed = 0;
      let totalProcessingTime = 0;
      let jobsWithProcessingTime = 0;

      for (const { queue, name } of queues) {
        try {
          const [completed, failed] = await Promise.all([
            queue.getCompleted(),
            queue.getFailed(),
          ]);

          // Filter jobs by time period
          const completedInPeriod = completed.filter(
            (job) => job.finishedOn && job.finishedOn >= startTime
          );
          const failedInPeriod = failed.filter(
            (job) => job.finishedOn && job.finishedOn >= startTime
          );

          // Calculate average processing time
          let avgProcessingTime = 0;
          const jobsWithTime = completedInPeriod.filter(
            (job) => job.processedOn && job.finishedOn
          );

          if (jobsWithTime.length > 0) {
            const totalTime = jobsWithTime.reduce(
              (sum, job) => sum + (job.finishedOn - job.processedOn),
              0
            );
            avgProcessingTime = totalTime / jobsWithTime.length;
            totalProcessingTime += totalTime;
            jobsWithProcessingTime += jobsWithTime.length;
          }

          const queueTotal = completedInPeriod.length + failedInPeriod.length;

          queueStats[name] = {
            total: queueTotal,
            success: completedInPeriod.length,
            failed: failedInPeriod.length,
            successRate:
              queueTotal > 0
                ? (completedInPeriod.length / queueTotal) * 100
                : 0,
            avgProcessingTime: Math.round(avgProcessingTime),
          };

          totalJobs += queueTotal;
          totalSuccess += completedInPeriod.length;
          totalFailed += failedInPeriod.length;
        } catch (error) {
          logger.error(`Error getting stats for ${name} queue:`, error);
          queueStats[name] = {
            total: 0,
            success: 0,
            failed: 0,
            successRate: 0,
            avgProcessingTime: 0,
          };
        }
      }

      // Calculate overall stats
      const overallSuccessRate =
        totalJobs > 0 ? (totalSuccess / totalJobs) * 100 : 0;
      const overallAvgProcessingTime =
        jobsWithProcessingTime > 0
          ? totalProcessingTime / jobsWithProcessingTime
          : 0;

      // Calculate throughput (jobs per hour)
      const periodHours =
        {
          "1h": 1,
          "24h": 24,
          "7d": 168,
          "30d": 720,
        }[period] || 24;

      const throughput = totalJobs / periodHours;

      const stats = {
        period,
        totalJobs,
        successRate: Math.round(overallSuccessRate * 100) / 100,
        averageProcessingTime: Math.round(overallAvgProcessingTime),
        throughput: Math.round(throughput * 100) / 100,
        byQueue: queueStats,
        generatedAt: new Date().toISOString(),
      };

      ResponseHelper.success(
        res,
        stats,
        "Queue statistics retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving queue statistics:", error);
      ResponseHelper.error(
        res,
        "Failed to retrieve queue statistics",
        500,
        "QUEUE_STATS_ERROR"
      );
    }
  }
}

module.exports = new QueueController();
