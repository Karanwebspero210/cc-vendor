const logger = require('../utils/logger');
const queueManager = require('../queues/queue-manager');

/**
 * Sync Events WebSocket Handler
 * Manages real-time sync status updates and notifications
 */
class SyncEvents {
  constructor(io) {
    this.io = io;
    this.syncNamespace = io.of('/sync');
    this.connectedClients = new Map();
    this.setupEventHandlers();
    this.setupQueueListeners();
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.syncNamespace.on('connection', (socket) => {
      logger.info(`Client connected to sync namespace: ${socket.id}`);
      
      // Store client information
      this.connectedClients.set(socket.id, {
        socket,
        subscribedSyncs: new Set(),
        subscribedStores: new Set(),
        subscribedVendors: new Set(),
        connectedAt: new Date()
      });

      // Handle client events
      this.handleClientEvents(socket);

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Client disconnected from sync namespace: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });
    });
  }

  /**
   * Handle individual client events
   */
  handleClientEvents(socket) {
    const clientInfo = this.connectedClients.get(socket.id);

    // Subscribe to specific sync updates
    socket.on('subscribe:sync', (data) => {
      const { syncId } = data;
      if (syncId) {
        clientInfo.subscribedSyncs.add(syncId);
        socket.join(`sync:${syncId}`);
        logger.debug(`Client ${socket.id} subscribed to sync ${syncId}`);
        
        // Send current sync status
        this.sendSyncStatus(syncId, socket);
      }
    });

    // Unsubscribe from sync updates
    socket.on('unsubscribe:sync', (data) => {
      const { syncId } = data;
      if (syncId) {
        clientInfo.subscribedSyncs.delete(syncId);
        socket.leave(`sync:${syncId}`);
        logger.debug(`Client ${socket.id} unsubscribed from sync ${syncId}`);
      }
    });

    // Subscribe to store sync updates
    socket.on('subscribe:store', (data) => {
      const { storeId } = data;
      if (storeId) {
        clientInfo.subscribedStores.add(storeId);
        socket.join(`store:${storeId}`);
        logger.debug(`Client ${socket.id} subscribed to store ${storeId} syncs`);
      }
    });

    // Unsubscribe from store sync updates
    socket.on('unsubscribe:store', (data) => {
      const { storeId } = data;
      if (storeId) {
        clientInfo.subscribedStores.delete(storeId);
        socket.leave(`store:${storeId}`);
        logger.debug(`Client ${socket.id} unsubscribed from store ${storeId} syncs`);
      }
    });

    // Subscribe to vendor sync updates
    socket.on('subscribe:vendor', (data) => {
      const { vendorId } = data;
      if (vendorId) {
        clientInfo.subscribedVendors.add(vendorId);
        socket.join(`vendor:${vendorId}`);
        logger.debug(`Client ${socket.id} subscribed to vendor ${vendorId} syncs`);
      }
    });

    // Unsubscribe from vendor sync updates
    socket.on('unsubscribe:vendor', (data) => {
      const { vendorId } = data;
      if (vendorId) {
        clientInfo.subscribedVendors.delete(vendorId);
        socket.leave(`vendor:${vendorId}`);
        logger.debug(`Client ${socket.id} unsubscribed from vendor ${vendorId} syncs`);
      }
    });

    // Subscribe to all sync updates (admin only)
    socket.on('subscribe:all', (data) => {
      const { isAdmin } = data;
      if (isAdmin) {
        socket.join('admin:all');
        logger.debug(`Admin client ${socket.id} subscribed to all sync updates`);
      }
    });

    // Request current sync status
    socket.on('request:sync-status', (data) => {
      const { syncId } = data;
      if (syncId) {
        this.sendSyncStatus(syncId, socket);
      }
    });

    // Request active syncs
    socket.on('request:active-syncs', () => {
      this.sendActiveSyncs(socket);
    });

    // Request queue statistics
    socket.on('request:queue-stats', () => {
      this.sendQueueStats(socket);
    });
  }

  /**
   * Setup queue event listeners for real-time updates
   */
  setupQueueListeners() {
    const queues = queueManager.getAllQueues();

    Object.keys(queues).forEach(queueName => {
      const queue = queues[queueName];

      // Job started
      queue.on('active', (job) => {
        this.handleJobStarted(job, queueName);
      });

      // Job progress
      queue.on('progress', (job, progress) => {
        this.handleJobProgress(job, progress, queueName);
      });

      // Job completed
      queue.on('completed', (job, result) => {
        this.handleJobCompleted(job, result, queueName);
      });

      // Job failed
      queue.on('failed', (job, error) => {
        this.handleJobFailed(job, error, queueName);
      });

      // Job stalled
      queue.on('stalled', (job) => {
        this.handleJobStalled(job, queueName);
      });
    });
  }

  /**
   * Handle job started event
   */
  handleJobStarted(job, queueName) {
    const syncData = this.extractSyncData(job);
    
    const event = {
      type: 'sync:started',
      syncId: syncData.syncId,
      jobId: job.id,
      queueName,
      timestamp: new Date().toISOString(),
      data: syncData
    };

    this.broadcastSyncEvent(event, syncData);
    logger.debug(`Sync started event broadcasted for ${syncData.syncId}`);
  }

  /**
   * Handle job progress event
   */
  handleJobProgress(job, progress, queueName) {
    const syncData = this.extractSyncData(job);
    
    const event = {
      type: 'sync:progress',
      syncId: syncData.syncId,
      jobId: job.id,
      queueName,
      progress,
      timestamp: new Date().toISOString(),
      data: syncData
    };

    this.broadcastSyncEvent(event, syncData);
  }

  /**
   * Handle job completed event
   */
  handleJobCompleted(job, result, queueName) {
    const syncData = this.extractSyncData(job);
    
    const event = {
      type: 'sync:completed',
      syncId: syncData.syncId,
      jobId: job.id,
      queueName,
      result,
      timestamp: new Date().toISOString(),
      data: syncData
    };

    this.broadcastSyncEvent(event, syncData);
    logger.info(`Sync completed event broadcasted for ${syncData.syncId}`);
  }

  /**
   * Handle job failed event
   */
  handleJobFailed(job, error, queueName) {
    const syncData = this.extractSyncData(job);
    
    const event = {
      type: 'sync:failed',
      syncId: syncData.syncId,
      jobId: job.id,
      queueName,
      error: {
        message: error.message,
        stack: error.stack
      },
      timestamp: new Date().toISOString(),
      data: syncData
    };

    this.broadcastSyncEvent(event, syncData);
    logger.error(`Sync failed event broadcasted for ${syncData.syncId}:`, error);
  }

  /**
   * Handle job stalled event
   */
  handleJobStalled(job, queueName) {
    const syncData = this.extractSyncData(job);
    
    const event = {
      type: 'sync:stalled',
      syncId: syncData.syncId,
      jobId: job.id,
      queueName,
      timestamp: new Date().toISOString(),
      data: syncData
    };

    this.broadcastSyncEvent(event, syncData);
    logger.warn(`Sync stalled event broadcasted for ${syncData.syncId}`);
  }

  /**
   * Extract sync data from job
   */
  extractSyncData(job) {
    const data = job.data || {};
    
    return {
      syncId: data.syncId || data.batchId || `job_${job.id}`,
      storeId: data.storeId,
      vendorId: data.vendorId,
      storeIds: data.storeIds,
      vendorIds: data.vendorIds,
      syncType: data.syncType,
      options: data.options,
      triggeredBy: data.options?.triggeredBy || 'unknown'
    };
  }

  /**
   * Broadcast sync event to relevant clients
   */
  broadcastSyncEvent(event, syncData) {
    // Broadcast to clients subscribed to this specific sync
    this.syncNamespace.to(`sync:${syncData.syncId}`).emit('sync:update', event);

    // Broadcast to clients subscribed to stores
    if (syncData.storeId) {
      this.syncNamespace.to(`store:${syncData.storeId}`).emit('sync:update', event);
    }
    if (syncData.storeIds) {
      syncData.storeIds.forEach(storeId => {
        this.syncNamespace.to(`store:${storeId}`).emit('sync:update', event);
      });
    }

    // Broadcast to clients subscribed to vendors
    if (syncData.vendorId) {
      this.syncNamespace.to(`vendor:${syncData.vendorId}`).emit('sync:update', event);
    }
    if (syncData.vendorIds) {
      syncData.vendorIds.forEach(vendorId => {
        this.syncNamespace.to(`vendor:${vendorId}`).emit('sync:update', event);
      });
    }

    // Broadcast to admin clients
    this.syncNamespace.to('admin:all').emit('sync:update', event);
  }

  /**
   * Send current sync status to a specific socket
   */
  async sendSyncStatus(syncId, socket) {
    try {
      const syncService = require('../services/sync.service');
      const status = await syncService.getSyncStatus(syncId);
      
      socket.emit('sync:status', {
        syncId,
        status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error sending sync status for ${syncId}:`, error);
      socket.emit('sync:error', {
        syncId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send active syncs to a specific socket
   */
  async sendActiveSyncs(socket) {
    try {
      const syncService = require('../services/sync.service');
      const activeSyncs = await syncService.getActiveSyncs();
      
      socket.emit('sync:active-list', {
        syncs: activeSyncs,
        count: activeSyncs.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error sending active syncs:', error);
      socket.emit('sync:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Send queue statistics to a specific socket
   */
  async sendQueueStats(socket) {
    try {
      const stats = {};
      const queues = queueManager.getAllQueues();
      
      for (const [queueName, queue] of Object.entries(queues)) {
        stats[queueName] = await queueManager.getQueueStats(queueName);
      }
      
      socket.emit('queue:stats', {
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Error sending queue stats:', error);
      socket.emit('sync:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Broadcast system notification
   */
  broadcastSystemNotification(notification) {
    const event = {
      type: 'system:notification',
      notification,
      timestamp: new Date().toISOString()
    };

    this.syncNamespace.emit('system:update', event);
    logger.info('System notification broadcasted:', notification);
  }

  /**
   * Broadcast queue status change
   */
  broadcastQueueStatusChange(queueName, status) {
    const event = {
      type: 'queue:status-change',
      queueName,
      status,
      timestamp: new Date().toISOString()
    };

    this.syncNamespace.to('admin:all').emit('queue:update', event);
    logger.info(`Queue status change broadcasted: ${queueName} -> ${status}`);
  }

  /**
   * Get connected clients statistics
   */
  getClientStats() {
    const stats = {
      totalClients: this.connectedClients.size,
      subscriptions: {
        syncs: 0,
        stores: 0,
        vendors: 0,
        admins: 0
      }
    };

    for (const client of this.connectedClients.values()) {
      stats.subscriptions.syncs += client.subscribedSyncs.size;
      stats.subscriptions.stores += client.subscribedStores.size;
      stats.subscriptions.vendors += client.subscribedVendors.size;
    }

    // Count admin clients
    const adminRoom = this.syncNamespace.adapter.rooms.get('admin:all');
    stats.subscriptions.admins = adminRoom ? adminRoom.size : 0;

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
        logger.info(`Cleaning up stale client connection: ${socketId}`);
        this.connectedClients.delete(socketId);
      }
    }
  }
}

module.exports = SyncEvents;