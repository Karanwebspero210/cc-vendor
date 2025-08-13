const logger = require('../utils/logger');

/**
 * Queue Events WebSocket Handler
 * Manages real-time queue status updates and job monitoring
 */
class QueueEvents {
  constructor(io) {
    this.io = io;
    this.queueNamespace = io.of('/queue');
    this.connectedClients = new Map();
    this.queueStats = new Map();
    this.setupEventHandlers();
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.queueNamespace.on('connection', (socket) => {
      logger.info(`Client connected to queue namespace: ${socket.id}`);
      
      // Store client information
      this.connectedClients.set(socket.id, {
        socket,
        subscribedQueues: new Set(),
        subscribedJobs: new Set(),
        connectedAt: new Date(),
        isAdmin: false
      });

      // Handle client events
      this.handleClientEvents(socket);

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Client disconnected from queue namespace: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });
    });
  }

  /**
   * Handle individual client events
   */
  handleClientEvents(socket) {
    const clientInfo = this.connectedClients.get(socket.id);

    // Authentication
    socket.on('authenticate', (data) => {
      const { isAdmin, userId } = data;
      clientInfo.isAdmin = isAdmin || false;
      clientInfo.userId = userId;
      
      if (isAdmin) {
        socket.join('admin:queue');
        logger.debug(`Admin client ${socket.id} authenticated for queue monitoring`);
      }
    });

    // Subscribe to queue updates
    socket.on('subscribe:queue', (data) => {
      const { queueName } = data;
      if (queueName) {
        clientInfo.subscribedQueues.add(queueName);
        socket.join(`queue:${queueName}`);
        logger.debug(`Client ${socket.id} subscribed to queue ${queueName}`);
        
        // Send current queue status
        this.sendQueueStatus(queueName, socket);
      }
    });

    // Unsubscribe from queue updates
    socket.on('unsubscribe:queue', (data) => {
      const { queueName } = data;
      if (queueName) {
        clientInfo.subscribedQueues.delete(queueName);
        socket.leave(`queue:${queueName}`);
        logger.debug(`Client ${socket.id} unsubscribed from queue ${queueName}`);
      }
    });

    // Subscribe to specific job updates
    socket.on('subscribe:job', (data) => {
      const { jobId } = data;
      if (jobId) {
        clientInfo.subscribedJobs.add(jobId);
        socket.join(`job:${jobId}`);
        logger.debug(`Client ${socket.id} subscribed to job ${jobId}`);
        
        // Send current job status
        this.sendJobStatus(jobId, socket);
      }
    });

    // Unsubscribe from job updates
    socket.on('unsubscribe:job', (data) => {
      const { jobId } = data;
      if (jobId) {
        clientInfo.subscribedJobs.delete(jobId);
        socket.leave(`job:${jobId}`);
        logger.debug(`Client ${socket.id} unsubscribed from job ${jobId}`);
      }
    });

    // Request all queue statistics (admin only)
    socket.on('request:all-queues', () => {
      if (!clientInfo.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }
      
      this.sendAllQueueStats(socket);
    });

    // Request specific queue details
    socket.on('request:queue-details', (data) => {
      const { queueName } = data;
      if (queueName) {
        this.sendQueueDetails(queueName, socket);
      }
    });

    // Request job details
    socket.on('request:job-details', (data) => {
      const { jobId } = data;
      if (jobId) {
        this.sendJobDetails(jobId, socket);
      }
    });

    // Admin actions
    socket.on('admin:pause-queue', (data) => {
      if (!clientInfo.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }
      
      this.handlePauseQueue(data.queueName, socket);
    });

    socket.on('admin:resume-queue', (data) => {
      if (!clientInfo.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }
      
      this.handleResumeQueue(data.queueName, socket);
    });

    socket.on('admin:clear-queue', (data) => {
      if (!clientInfo.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }
      
      this.handleClearQueue(data.queueName, data.status, socket);
    });
  }

  /**
   * Handle queue status updates
   */
  handleQueueStatusUpdate(queueName, status, stats) {
    const event = {
      type: 'queue:status-update',
      queueName,
      status,
      stats,
      timestamp: new Date().toISOString()
    };

    // Broadcast to subscribers of this queue
    this.queueNamespace.to(`queue:${queueName}`).emit('queue:update', event);
    
    // Broadcast to admin clients
    this.queueNamespace.to('admin:queue').emit('queue:update', event);

    // Update internal stats
    this.queueStats.set(queueName, { ...stats, lastUpdate: new Date() });

    logger.debug(`Queue status update broadcasted for ${queueName}:`, status);
  }

  /**
   * Handle job status updates
   */
  handleJobStatusUpdate(jobId, queueName, status, progress = null, result = null, error = null) {
    const event = {
      type: 'job:status-update',
      jobId,
      queueName,
      status,
      progress,
      result,
      error,
      timestamp: new Date().toISOString()
    };

    // Broadcast to subscribers of this job
    this.queueNamespace.to(`job:${jobId}`).emit('job:update', event);
    
    // Broadcast to subscribers of the queue
    this.queueNamespace.to(`queue:${queueName}`).emit('job:update', event);
    
    // Broadcast to admin clients
    this.queueNamespace.to('admin:queue').emit('job:update', event);

    logger.debug(`Job status update broadcasted for ${jobId}:`, status);
  }

  /**
   * Handle job progress updates
   */
  handleJobProgress(jobId, queueName, progress, data = null) {
    const event = {
      type: 'job:progress',
      jobId,
      queueName,
      progress,
      data,
      timestamp: new Date().toISOString()
    };

    // Broadcast to subscribers of this job
    this.queueNamespace.to(`job:${jobId}`).emit('job:progress', event);
    
    // Broadcast to subscribers of the queue (throttled)
    this.throttledBroadcast(`queue:${queueName}`, 'job:progress', event, 1000);
  }

  /**
   * Throttled broadcast to avoid overwhelming clients
   */
  throttledBroadcast(room, eventName, data, interval) {
    const key = `${room}:${eventName}`;
    const now = Date.now();
    
    if (!this.lastBroadcast) {
      this.lastBroadcast = new Map();
    }
    
    const lastTime = this.lastBroadcast.get(key) || 0;
    
    if (now - lastTime >= interval) {
      this.queueNamespace.to(room).emit(eventName, data);
      this.lastBroadcast.set(key, now);
    }
  }

  /**
   * Send current queue status to a specific socket
   */
  async sendQueueStatus(queueName, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const stats = await queueManager.getQueueStats(queueName);
      
      socket.emit('queue:status', {
        queueName,
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending queue status for ${queueName}:`, error);
      socket.emit('queue:error', {
        queueName,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send all queue statistics to a specific socket
   */
  async sendAllQueueStats(socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const queues = queueManager.getAllQueues();
      const allStats = {};
      
      for (const queueName of Object.keys(queues)) {
        allStats[queueName] = await queueManager.getQueueStats(queueName);
      }
      
      socket.emit('queue:all-stats', {
        stats: allStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error sending all queue stats:', error);
      socket.emit('queue:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send queue details to a specific socket
   */
  async sendQueueDetails(queueName, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const queue = queueManager.getQueue(queueName);
      
      if (!queue) {
        socket.emit('queue:error', {
          queueName,
          error: 'Queue not found',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(0, 10), // Get first 10 jobs
        queue.getActive(0, 10),
        queue.getCompleted(0, 10),
        queue.getFailed(0, 10),
        queue.getDelayed(0, 10)
      ]);

      socket.emit('queue:details', {
        queueName,
        jobs: {
          waiting: waiting.map(job => this.formatJobInfo(job)),
          active: active.map(job => this.formatJobInfo(job)),
          completed: completed.map(job => this.formatJobInfo(job)),
          failed: failed.map(job => this.formatJobInfo(job)),
          delayed: delayed.map(job => this.formatJobInfo(job))
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending queue details for ${queueName}:`, error);
      socket.emit('queue:error', {
        queueName,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send job status to a specific socket
   */
  async sendJobStatus(jobId, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const queues = queueManager.getAllQueues();
      
      let job = null;
      let queueName = null;
      
      // Find the job in all queues
      for (const [name, queue] of Object.entries(queues)) {
        job = await queue.getJob(jobId);
        if (job) {
          queueName = name;
          break;
        }
      }
      
      if (!job) {
        socket.emit('job:error', {
          jobId,
          error: 'Job not found',
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      socket.emit('job:status', {
        jobId,
        queueName,
        job: this.formatJobInfo(job),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending job status for ${jobId}:`, error);
      socket.emit('job:error', {
        jobId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send job details to a specific socket
   */
  async sendJobDetails(jobId, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const queues = queueManager.getAllQueues();
      
      let job = null;
      let queueName = null;
      
      // Find the job in all queues
      for (const [name, queue] of Object.entries(queues)) {
        job = await queue.getJob(jobId);
        if (job) {
          queueName = name;
          break;
        }
      }
      
      if (!job) {
        socket.emit('job:error', {
          jobId,
          error: 'Job not found',
          timestamp: new Date().toISOString()
        });
        return;
      }
      
      socket.emit('job:details', {
        jobId,
        queueName,
        job: {
          ...this.formatJobInfo(job),
          data: job.data,
          opts: job.opts,
          stacktrace: job.stacktrace,
          logs: job.logs || []
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending job details for ${jobId}:`, error);
      socket.emit('job:error', {
        jobId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Format job information for client consumption
   */
  formatJobInfo(job) {
    return {
      id: job.id,
      name: job.name,
      progress: job.progress(),
      priority: job.opts.priority,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      delay: job.opts.delay,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue
    };
  }

  /**
   * Handle admin pause queue action
   */
  async handlePauseQueue(queueName, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      await queueManager.pauseQueue(queueName);
      
      socket.emit('admin:action-result', {
        action: 'pause',
        queueName,
        success: true,
        timestamp: new Date().toISOString()
      });

      // Broadcast to all queue subscribers
      this.handleQueueStatusUpdate(queueName, 'paused', {});
    } catch (error) {
      logger.error(`Error pausing queue ${queueName}:`, error);
      socket.emit('admin:action-result', {
        action: 'pause',
        queueName,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle admin resume queue action
   */
  async handleResumeQueue(queueName, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      await queueManager.resumeQueue(queueName);
      
      socket.emit('admin:action-result', {
        action: 'resume',
        queueName,
        success: true,
        timestamp: new Date().toISOString()
      });

      // Broadcast to all queue subscribers
      this.handleQueueStatusUpdate(queueName, 'resumed', {});
    } catch (error) {
      logger.error(`Error resuming queue ${queueName}:`, error);
      socket.emit('admin:action-result', {
        action: 'resume',
        queueName,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle admin clear queue action
   */
  async handleClearQueue(queueName, status, socket) {
    try {
      const queueManager = require('../queues/queue-manager');
      const result = await queueManager.cleanQueue(queueName, 0, status);
      
      socket.emit('admin:action-result', {
        action: 'clear',
        queueName,
        status,
        success: true,
        clearedJobs: result.length,
        timestamp: new Date().toISOString()
      });

      // Broadcast to all queue subscribers
      this.handleQueueStatusUpdate(queueName, 'cleared', { clearedJobs: result.length });
    } catch (error) {
      logger.error(`Error clearing queue ${queueName}:`, error);
      socket.emit('admin:action-result', {
        action: 'clear',
        queueName,
        status,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get connected clients statistics
   */
  getClientStats() {
    const stats = {
      totalClients: this.connectedClients.size,
      subscriptions: {
        queues: 0,
        jobs: 0,
        admins: 0
      }
    };

    for (const client of this.connectedClients.values()) {
      stats.subscriptions.queues += client.subscribedQueues.size;
      stats.subscriptions.jobs += client.subscribedJobs.size;
      if (client.isAdmin) {
        stats.subscriptions.admins++;
      }
    }

    return stats;
  }

  /**
   * Cleanup stale connections and subscriptions
   */
  cleanup() {
    const now = Date.now();
    const staleThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [socketId, client] of this.connectedClients.entries()) {
      const connectionAge = now - client.connectedAt.getTime();
      
      if (connectionAge > staleThreshold && !client.socket.connected) {
        logger.info(`Cleaning up stale queue client connection: ${socketId}`);
        this.connectedClients.delete(socketId);
      }
    }

    // Clean up old broadcast timestamps
    if (this.lastBroadcast) {
      const broadcastThreshold = 5 * 60 * 1000; // 5 minutes
      for (const [key, timestamp] of this.lastBroadcast.entries()) {
        if (now - timestamp > broadcastThreshold) {
          this.lastBroadcast.delete(key);
        }
      }
    }
  }
}

module.exports = QueueEvents;