const mongoose = require('mongoose');
const logger = require('./logger');

/**
 * Database Connection and Management Utilities
 */
class DatabaseHelper {
  /**
   * Connect to MongoDB with retry logic
   */
  static async connect(connectionString, options = {}) {
    const defaultOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferMaxEntries: 0,
      bufferCommands: false,
      ...options
    };

    try {
      await mongoose.connect(connectionString, defaultOptions);
      logger.info('MongoDB connected successfully');
      
      // Handle connection events
      this.setupConnectionEvents();
      
      return mongoose.connection;
    } catch (error) {
      logger.error('MongoDB connection failed:', error);
      throw error;
    }
  }

  /**
   * Setup MongoDB connection event handlers
   */
  static setupConnectionEvents() {
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connection established');
    });

    mongoose.connection.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    // Handle application termination
    process.on('SIGINT', () => {
      this.gracefulShutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
      this.gracefulShutdown('SIGTERM');
    });
  }

  /**
   * Graceful shutdown of database connection
   */
  static async gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Closing MongoDB connection...`);
    
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error);
      process.exit(1);
    }
  }

  /**
   * Check database connection health
   */
  static async healthCheck() {
    try {
      const state = mongoose.connection.readyState;
      const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };

      const isHealthy = state === 1;
      
      return {
        healthy: isHealthy,
        state: states[state],
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name
      };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Get database statistics
   */
  static async getStats() {
    try {
      const db = mongoose.connection.db;
      const stats = await db.stats();
      
      return {
        collections: stats.collections,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        indexSize: stats.indexSize,
        objects: stats.objects
      };
    } catch (error) {
      logger.error('Error getting database stats:', error);
      throw error;
    }
  }

  /**
   * Create database indexes for better performance
   */
  static async createIndexes() {
    try {
      const collections = [
        {
          name: 'stores',
          indexes: [
            { shopDomain: 1 },
            { isActive: 1 },
            { connected: 1 },
            { createdAt: -1 }
          ]
        },
        {
          name: 'vendors',
          indexes: [
            { name: 1 },
            { isActive: 1 },
            { connected: 1 },
            { createdAt: -1 }
          ]
        },
        {
          name: 'productmappings',
          indexes: [
            { storeId: 1, vendorId: 1 },
            { shopifyProductId: 1 },
            { vendorSku: 1 },
            { isActive: 1 },
            { createdAt: -1 }
          ]
        },
        {
          name: 'synclogs',
          indexes: [
            { syncId: 1 },
            { storeId: 1 },
            { vendorId: 1 },
            { status: 1 },
            { startedAt: -1 },
            { jobId: 1 }
          ]
        },
        {
          name: 'syncschedules',
          indexes: [
            { name: 1 },
            { isActive: 1 },
            { nextRun: 1 },
            { createdAt: -1 }
          ]
        }
      ];

      for (const collection of collections) {
        const db = mongoose.connection.db;
        const coll = db.collection(collection.name);
        
        for (const index of collection.indexes) {
          try {
            await coll.createIndex(index);
            logger.debug(`Created index on ${collection.name}:`, index);
          } catch (error) {
            if (error.code !== 85) { // Index already exists
              logger.warn(`Failed to create index on ${collection.name}:`, error.message);
            }
          }
        }
      }

      logger.info('Database indexes created successfully');
    } catch (error) {
      logger.error('Error creating database indexes:', error);
      throw error;
    }
  }

  /**
   * Clean up old records based on retention policy
   */
  static async cleanup(options = {}) {
    const {
      syncLogRetentionDays = 30,
      failedSyncLogRetentionDays = 7,
      dryRun = false
    } = options;

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - syncLogRetentionDays);

      const failedCutoffDate = new Date();
      failedCutoffDate.setDate(failedCutoffDate.getDate() - failedSyncLogRetentionDays);

      const operations = [];

      // Clean up old successful sync logs
      const successfulSyncLogs = await mongoose.connection.db
        .collection('synclogs')
        .countDocuments({
          status: 'completed',
          completedAt: { $lt: cutoffDate }
        });

      if (successfulSyncLogs > 0) {
        operations.push({
          collection: 'synclogs',
          operation: 'deleteMany',
          filter: {
            status: 'completed',
            completedAt: { $lt: cutoffDate }
          },
          count: successfulSyncLogs
        });
      }

      // Clean up old failed sync logs
      const failedSyncLogs = await mongoose.connection.db
        .collection('synclogs')
        .countDocuments({
          status: 'failed',
          completedAt: { $lt: failedCutoffDate }
        });

      if (failedSyncLogs > 0) {
        operations.push({
          collection: 'synclogs',
          operation: 'deleteMany',
          filter: {
            status: 'failed',
            completedAt: { $lt: failedCutoffDate }
          },
          count: failedSyncLogs
        });
      }

      if (dryRun) {
        logger.info('Database cleanup (dry run):', operations);
        return operations;
      }

      // Execute cleanup operations
      let totalDeleted = 0;
      for (const op of operations) {
        const result = await mongoose.connection.db
          .collection(op.collection)
          .deleteMany(op.filter);
        
        totalDeleted += result.deletedCount;
        logger.info(`Cleaned up ${result.deletedCount} records from ${op.collection}`);
      }

      logger.info(`Database cleanup completed. Total records deleted: ${totalDeleted}`);
      return { totalDeleted, operations };

    } catch (error) {
      logger.error('Database cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Backup database collections
   */
  static async backup(collections = [], outputPath = './backup') {
    try {
      const fs = require('fs').promises;
      const path = require('path');

      // Create backup directory
      await fs.mkdir(outputPath, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupResults = [];

      for (const collectionName of collections) {
        const collection = mongoose.connection.db.collection(collectionName);
        const documents = await collection.find({}).toArray();
        
        const filename = `${collectionName}_${timestamp}.json`;
        const filepath = path.join(outputPath, filename);
        
        await fs.writeFile(filepath, JSON.stringify(documents, null, 2));
        
        backupResults.push({
          collection: collectionName,
          documents: documents.length,
          file: filepath
        });

        logger.info(`Backed up ${documents.length} documents from ${collectionName} to ${filepath}`);
      }

      logger.info('Database backup completed');
      return backupResults;

    } catch (error) {
      logger.error('Database backup failed:', error);
      throw error;
    }
  }
}

module.exports = DatabaseHelper;
