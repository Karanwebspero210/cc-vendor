const { Server } = require('socket.io');
const logger = require('../utils/logger');
const SyncEvents = require('./sync-events');
const { verifySocketToken } = require('../utils/jwt.utils');

/**
 * WebSocket Server Setup and Management
 * Handles Socket.IO server initialization and namespace management
 */
class SocketServer {
  constructor() {
    this.io = null;
    this.server = null;
    this.syncEvents = null;
    this.connectedClients = new Map();
    this.namespaces = new Map();
  }

  /**
   * Initialize Socket.IO server
   * @param {object} httpServer - HTTP server instance
   * @param {object} options - Socket.IO options
   */
  initialize(httpServer, options = {}) {
    const defaultOptions = {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      ...options
    };

    this.io = new Server(httpServer, defaultOptions);
    this.server = httpServer;

    logger.info('Socket.IO server initialized');

    // Setup main connection handling
    this.setupMainConnection();

    // Initialize sync events handler
    this.syncEvents = new SyncEvents(this.io);
    this.namespaces.set('sync', this.syncEvents);

    // Setup periodic cleanup
    this.setupCleanup();

    return this.io;
  }

  /**
   * Setup main Socket.IO connection handling
   */
  setupMainConnection() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id} from ${socket.handshake.address}`);

      // Store client information
      this.connectedClients.set(socket.id, {
        socket,
        connectedAt: new Date(),
        lastActivity: new Date(),
        userAgent: socket.handshake.headers['user-agent'],
        ip: socket.handshake.address
      });

      // Setup authentication
      this.handleAuthentication(socket);

      // Setup general event handlers
      this.handleGeneralEvents(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
        this.connectedClients.delete(socket.id);
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
      });
    });

    // Handle server-level events
    this.io.engine.on('connection_error', (err) => {
      logger.error('Socket.IO connection error:', {
        req: err.req?.url,
        code: err.code,
        message: err.message,
        context: err.context
      });
    });
  }

  /**
   * Handle client authentication with JWT token
   */
  handleAuthentication(socket) {
    socket.on('authenticate', (data) => {
      const { token } = data;
      
      if (!token) {
        logger.warn(`Authentication failed for socket ${socket.id}: No token provided`);
        return socket.emit('authentication_error', {
          success: false,
          message: 'Authentication token is required',
          code: 'AUTH_TOKEN_REQUIRED',
          timestamp: new Date().toISOString()
        });
      }

      // Verify the JWT token
      const authResult = verifySocketToken(token);
      
      if (!authResult.authenticated) {
        logger.warn(`Authentication failed for socket ${socket.id}: ${authResult.error}`);
        return socket.emit('authentication_error', {
          success: false,
          message: authResult.error || 'Authentication failed',
          code: 'AUTH_FAILED',
          timestamp: new Date().toISOString()
        });
      }

      // Authentication successful
      const { userId, isAdmin } = authResult;
      socket.userId = userId;
      socket.isAdmin = isAdmin;
      socket.authenticated = true;
      
      logger.info(`Client ${socket.id} authenticated as user ${userId} (admin: ${isAdmin})`);
      
      // Update client info
      const clientInfo = this.connectedClients.get(socket.id);
      if (clientInfo) {
        clientInfo.userId = userId;
        clientInfo.isAdmin = isAdmin;
        clientInfo.authenticated = true;
        clientInfo.lastActivity = new Date();
      }

      // Send success response
      socket.emit('authenticated', {
        success: true,
        userId,
        isAdmin,
        timestamp: new Date().toISOString()
      });
    });

    // Require authentication for certain events
    socket.use((packet, next) => {
      const [event] = packet;
      const protectedEvents = [
        'subscribe:all',
        'request:queue-stats',
        'admin:action'
      ];

      if (protectedEvents.includes(event) && !socket.authenticated) {
        return next(new Error('Authentication required'));
      }

      // Update last activity
      const clientInfo = this.connectedClients.get(socket.id);
      if (clientInfo) {
        clientInfo.lastActivity = new Date();
      }

      next();
    });
  }

  /**
   * Handle general WebSocket events
   */
  handleGeneralEvents(socket) {
    // Ping/Pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
        serverId: process.env.SERVER_ID || 'server-1'
      });
    });

    // Client info request
    socket.on('request:client-info', () => {
      const clientInfo = this.connectedClients.get(socket.id);
      socket.emit('client:info', {
        socketId: socket.id,
        connectedAt: clientInfo?.connectedAt,
        authenticated: socket.authenticated || false,
        userId: socket.userId,
        isAdmin: socket.isAdmin || false,
        timestamp: new Date().toISOString()
      });
    });

    // Server stats request (admin only)
    socket.on('request:server-stats', () => {
      if (!socket.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }

      const stats = this.getServerStats();
      socket.emit('server:stats', {
        stats,
        timestamp: new Date().toISOString()
      });
    });

    // Broadcast message (admin only)
    socket.on('admin:broadcast', (data) => {
      if (!socket.isAdmin) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }

      const { message, type = 'info', targetNamespace } = data;
      
      const broadcastData = {
        type: 'admin:broadcast',
        message,
        messageType: type,
        from: socket.userId || 'admin',
        timestamp: new Date().toISOString()
      };

      if (targetNamespace && this.io.of(targetNamespace)) {
        this.io.of(targetNamespace).emit('admin:message', broadcastData);
      } else {
        this.io.emit('admin:message', broadcastData);
      }

      logger.info(`Admin broadcast sent by ${socket.userId}:`, message);
    });
  }

  /**
   * Setup periodic cleanup tasks
   */
  setupCleanup() {
    // Cleanup every 5 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
      
      // Cleanup sync events
      if (this.syncEvents) {
        this.syncEvents.cleanup();
      }
    }, 5 * 60 * 1000);

    // Log stats every 10 minutes
    setInterval(() => {
      const stats = this.getServerStats();
      logger.info('WebSocket server stats:', stats);
    }, 10 * 60 * 1000);
  }

  /**
   * Clean up stale connections
   */
  cleanupStaleConnections() {
    const now = Date.now();
    const staleThreshold = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    for (const [socketId, client] of this.connectedClients.entries()) {
      const inactiveTime = now - client.lastActivity.getTime();
      
      if (inactiveTime > staleThreshold && !client.socket.connected) {
        this.connectedClients.delete(socketId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} stale WebSocket connections`);
    }
  }

  /**
   * Get server statistics
   */
  getServerStats() {
    const connectedSockets = this.io.engine.clientsCount;
    const authenticatedClients = Array.from(this.connectedClients.values())
      .filter(client => client.authenticated).length;
    const adminClients = Array.from(this.connectedClients.values())
      .filter(client => client.isAdmin).length;

    const namespaceStats = {};
    for (const [name, namespace] of this.namespaces.entries()) {
      if (namespace.getClientStats) {
        namespaceStats[name] = namespace.getClientStats();
      }
    }

    return {
      connectedSockets,
      authenticatedClients,
      adminClients,
      totalClients: this.connectedClients.size,
      namespaces: namespaceStats,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Broadcast system notification to all clients
   */
  broadcastSystemNotification(notification) {
    const event = {
      type: 'system:notification',
      notification,
      timestamp: new Date().toISOString()
    };

    this.io.emit('system:update', event);
    
    // Also broadcast to sync namespace
    if (this.syncEvents) {
      this.syncEvents.broadcastSystemNotification(notification);
    }

    logger.info('System notification broadcasted to all clients:', notification);
  }

  /**
   * Send notification to specific user
   */
  sendUserNotification(userId, notification) {
    const userSockets = Array.from(this.connectedClients.values())
      .filter(client => client.userId === userId)
      .map(client => client.socket);

    const event = {
      type: 'user:notification',
      notification,
      timestamp: new Date().toISOString()
    };

    userSockets.forEach(socket => {
      socket.emit('user:update', event);
    });

    logger.info(`User notification sent to ${userSockets.length} sockets for user ${userId}:`, notification);
  }

  /**
   * Get connected clients for a specific user
   */
  getUserSockets(userId) {
    return Array.from(this.connectedClients.values())
      .filter(client => client.userId === userId)
      .map(client => client.socket);
  }

  /**
   * Check if user is connected
   */
  isUserConnected(userId) {
    return Array.from(this.connectedClients.values())
      .some(client => client.userId === userId && client.socket.connected);
  }

  /**
   * Get namespace handler
   */
  getNamespace(name) {
    return this.namespaces.get(name);
  }

  /**
   * Gracefully shutdown the WebSocket server
   */
  async shutdown() {
    logger.info('Shutting down WebSocket server...');

    // Notify all clients about shutdown
    this.broadcastSystemNotification({
      type: 'maintenance',
      message: 'Server is shutting down for maintenance',
      severity: 'warning'
    });

    // Give clients time to receive the message
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close all connections
    this.io.close();

    // Clear client tracking
    this.connectedClients.clear();
    this.namespaces.clear();

    logger.info('WebSocket server shutdown complete');
  }

  /**
   * Health check for WebSocket server
   */
  healthCheck() {
    return {
      status: this.io ? 'healthy' : 'unhealthy',
      connectedClients: this.connectedClients.size,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }
}

// Create singleton instance
const socketServer = new SocketServer();

module.exports = socketServer;