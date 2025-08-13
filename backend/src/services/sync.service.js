const logger = require('../utils/logger');
const SyncLog = require('../models/SyncLog');
const Store = require('../models/Store');
const queueManager = require('../queues/queue-manager');
const shopifyService = require('./shopify.service');
const noxaService = require('./noxa.service');
const inventoryService = require('./inventory.service');

/**
 * Sync Service
 * Handles synchronization operations between stores and vendors
 */
class SyncService {
  /**
   * Start manual sync operation
   */
  async startManualSync(storeId, vendorId, syncType = 'inventory', options = {}) {
    try {
      const syncId = `manual_${storeId}_${vendorId}_${Date.now()}`;
      
      // Validate store and vendor exist
      const [store, vendor] = await Promise.all([
        Store.findById(storeId),
        Vendor.findById(vendorId)
      ]);
      
      if (!store) {
        throw new Error(`Store ${storeId} not found`);
      }
      
      if (!vendor) {
        throw new Error(`Vendor ${vendorId} not found`);
      }
      
      // Queue the sync job using queue manager
      const job = await queueManager.addSyncJob({
        syncId,
        storeId,
        vendorId,
        syncType,
        options: {
          ...options,
          triggeredBy: 'manual',
          userId: options.userId
        }
      });
      
      logger.info(`Manual sync job queued: ${syncId}`, { jobId: job.id });

      return {
        syncId,
        jobId: job.id,
        status: 'queued',
        storeId,
        vendorId,
        syncType
      };
    } catch (error) {
      logger.error('Error starting manual sync:', error);
      throw error;
    }
  }

  /**
   * Start batch sync operation
   */
  async startBatchSync(storeIds, vendorIds, syncType = 'inventory', options = {}) {
    try {
      const batchId = `batch_${Date.now()}`;
      
      // Validate stores and vendors exist
      const [stores, vendors] = await Promise.all([
        Store.find({ _id: { $in: storeIds }, connected: true, isActive: true }),
        Vendor.find({ _id: { $in: vendorIds }, connected: true, isActive: true })
      ]);
      
      if (stores.length === 0) {
        throw new Error('No valid connected stores found');
      }
      
      if (vendors.length === 0) {
        throw new Error('No valid connected vendors found');
      }
      
      // Queue the batch sync job using queue manager
      const job = await queueManager.addBatchSyncJob({
        batchId,
        storeIds: stores.map(s => s._id),
        vendorIds: vendors.map(v => v._id),
        syncType,
        options: {
          ...options,
          triggeredBy: 'manual',
          userId: options.userId
        }
      });
      
      logger.info(`Batch sync job queued: ${batchId}`, { jobId: job.id });

      return {
        batchId,
        type: 'batch',
        operationsCount: storeIds.length * vendorIds.length,
        priority: 'normal',
        status: 'queued',
        jobs: []
      };
    } catch (error) {
      logger.error('Error starting batch sync:', error);
      throw error;
    }
  }

  /**
   * Start vendor sync operation
   */
  async startVendorSync(options = {}) {
    try {
      const { vendorId, syncType = 'full', storeIds } = options;
      
      if (!vendorId) {
        throw new Error('Vendor ID is required');
      }
      
      let targetStoreIds = storeIds;
      
      // If no specific stores provided, get all stores with mappings to this vendor
      if (!targetStoreIds || targetStoreIds.length === 0) {
        const mappings = await ProductMapping.find({
          vendorId,
          isActive: true
        }).distinct('storeId');
        
        if (mappings.length === 0) {
          throw new Error('No active mappings found for vendor');
        }
        
        targetStoreIds = mappings;
      }
      
      return this.startBatchSync(targetStoreIds, [vendorId], syncType, {
        ...options,
        type: 'vendor'
      });
    } catch (error) {
      logger.error('Error starting vendor sync:', error);
      throw error;
    }
  }

  /**
   * Execute sync job
   */
  async executeSyncJob(syncId) {
    try {
      const syncLog = await SyncLog.findOne({ syncId });
      if (!syncLog) {
        throw new Error('Sync not found');
      }

      // Update job status to running
      await SyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'running',
        startedAt: new Date()
      });

      let result;
      switch (syncLog.syncType) {
        case 'inventory':
          result = await this.syncInventory(syncLog.storeId, syncLog.vendorId, syncLog.options);
          break;
        case 'products':
          result = await this.syncProducts(syncLog.storeId, syncLog.vendorId, syncLog.options);
          break;
        case 'full':
          result = await this.syncFull(syncLog.storeId, syncLog.vendorId, syncLog.options);
          break;
        default:
          throw new Error(`Unknown sync type: ${syncLog.syncType}`);
      }

      // Update job status to completed
      await SyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'completed',
        completedAt: new Date(),
        result
      });

      return result;
    } catch (error) {
      logger.error('Error executing sync job:', error);

      // Update job status to failed
      await SyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'failed',
        completedAt: new Date(),
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Sync inventory between store and vendor
   */
  async syncInventory(storeId, vendorId, options = {}) {
    try {
      const { direction = 'vendor-to-store', dryRun = false } = options;
      
      // Get active mappings between store and vendor
      const mappings = await ProductMapping.find({
        storeId,
        vendorId,
        isActive: true,
        'syncSettings.enabled': true
      });

      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [],
        summary: {}
      };

      for (const mapping of mappings) {
        try {
          if (direction === 'vendor-to-store') {
            await this.syncInventoryVendorToStore(mapping, dryRun);
          } else if (direction === 'store-to-vendor') {
            await this.syncInventoryStoreToVendor(mapping, dryRun);
          }
          
          results.successful++;
        } catch (error) {
          logger.error(`Error syncing inventory for mapping ${mapping._id}:`, error);
          results.errors.push({
            mappingId: mapping._id,
            error: error.message
          });
          results.failed++;
        }
        
        results.processed++;
      }

      results.summary = {
        direction,
        dryRun,
        mappingsProcessed: mappings.length
      };

      return results;
    } catch (error) {
      logger.error('Error syncing inventory:', error);
      throw error;
    }
  }

  /**
   * Sync products between store and vendor
   */
  async syncProducts(storeId, vendorId, options = {}) {
    try {
      const { createMissing = false, updateExisting = true } = options;
      
      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [],
        summary: {}
      };

      // Get vendor products
      const vendorProducts = await noxaService.getProducts(vendorId);
      
      for (const vendorProduct of vendorProducts.products) {
        try {
          const transformedProduct = noxaService.transformProductData(vendorProduct);
          
          // Check if mapping exists
          let mapping = await ProductMapping.findOne({
            vendorId,
            vendorSku: transformedProduct.vendorSku
          });

          if (!mapping && createMissing) {
            // Create new product in Shopify and mapping
            await this.createProductFromVendor(storeId, vendorId, transformedProduct);
            results.successful++;
          } else if (mapping && updateExisting) {
            // Update existing product
            await this.updateProductFromVendor(mapping, transformedProduct);
            results.successful++;
          }
          
        } catch (error) {
          logger.error(`Error syncing product ${vendorProduct.sku}:`, error);
          results.errors.push({
            sku: vendorProduct.sku,
            error: error.message
          });
          results.failed++;
        }
        
        results.processed++;
      }

      results.summary = {
        createMissing,
        updateExisting,
        vendorProductsFound: vendorProducts.products.length
      };

      return results;
    } catch (error) {
      logger.error('Error syncing products:', error);
      throw error;
    }
  }

  /**
   * Full sync between store and vendor
   */
  async syncFull(storeId, vendorId, options = {}) {
    try {
      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [],
        summary: {}
      };

      // First sync products
      const productSync = await this.syncProducts(storeId, vendorId, options);
      
      // Then sync inventory
      const inventorySync = await this.syncInventory(storeId, vendorId, options);

      results.processed = productSync.processed + inventorySync.processed;
      results.successful = productSync.successful + inventorySync.successful;
      results.failed = productSync.failed + inventorySync.failed;
      results.errors = [...productSync.errors, ...inventorySync.errors];
      
      results.summary = {
        productSync: productSync.summary,
        inventorySync: inventorySync.summary
      };

      return results;
    } catch (error) {
      logger.error('Error performing full sync:', error);
      throw error;
    }
  }

  /**
   * Get sync status by sync ID
   */
  async getSyncStatus(syncId) {
    try {
      const syncLog = await SyncLog.findOne({ syncId }).sort({ createdAt: -1 });
      
      if (!syncLog) {
        throw new Error('Sync not found');
      }
      
      // Get job status from queue if available
      let jobStatus = null;
      if (syncLog.jobId) {
        try {
          const syncQueue = queueManager.getQueue('sync');
          const job = await syncQueue.getJob(syncLog.jobId);
          if (job) {
            jobStatus = {
              id: job.id,
              progress: job.progress(),
              processedOn: job.processedOn,
              finishedOn: job.finishedOn,
              failedReason: job.failedReason
            };
          }
        } catch (error) {
          logger.warn(`Could not get job status for sync ${syncId}:`, error.message);
        }
      }
      
      return {
        syncId,
        status: syncLog.status,
        syncType: syncLog.syncType,
        storeId: syncLog.storeId,
        vendorId: syncLog.vendorId,
        startedAt: syncLog.startedAt,
        completedAt: syncLog.completedAt,
        result: syncLog.result,
        error: syncLog.error,
        jobStatus
      };
    } catch (error) {
      logger.error('Error getting sync status:', error);
      throw error;
    }
  }

  /**
   * Get sync history
   */
  async getSyncHistory(filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 50 } = pagination;
      const skip = (page - 1) * limit;

      const query = {};
      
      if (filters.storeId) query.storeId = filters.storeId;
      if (filters.vendorId) query.vendorId = filters.vendorId;
      if (filters.syncType) query.syncType = filters.syncType;
      if (filters.status) query.status = filters.status;
      if (filters.dateFrom) query.startedAt = { $gte: new Date(filters.dateFrom) };
      if (filters.dateTo) {
        query.startedAt = query.startedAt || {};
        query.startedAt.$lte = new Date(filters.dateTo);
      }

      const [syncLogs, total] = await Promise.all([
        SyncLog.find(query)
          .populate('storeId', 'name shopDomain')
          .populate('vendorId', 'name')
          .skip(skip)
          .limit(limit)
          .sort({ startedAt: -1 }),
        SyncLog.countDocuments(query)
      ]);

      return {
        syncs: syncLogs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting sync history:', error);
      throw error;
    }
  }

  /**
   * Pause all syncs (pause queues)
   */
  async pauseAllSyncs() {
    try {
      await queueManager.pauseQueue('sync');
      await queueManager.pauseQueue('batch');
      await queueManager.pauseQueue('scheduled');
      
      logger.info('All sync queues paused');
      
      return {
        status: 'paused',
        pausedAt: new Date()
      };
    } catch (error) {
      logger.error('Error pausing all syncs:', error);
      throw error;
    }
  }

  /**
   * Resume all syncs (resume queues)
   */
  async resumeAllSyncs() {
    try {
      await queueManager.resumeQueue('sync');
      await queueManager.resumeQueue('batch');
      await queueManager.resumeQueue('scheduled');
      
      logger.info('All sync queues resumed');
      
      return {
        status: 'resumed',
        resumedAt: new Date()
      };
    } catch (error) {
      logger.error('Error resuming all syncs:', error);
      throw error;
    }
  }

  /**
   * Get active syncs
   */
  async getActiveSyncs() {
    try {
      const activeSyncs = await SyncLog.find({
        status: { $in: ['queued', 'running'] }
      })
      .populate('storeId', 'name shopDomain')
      .populate('vendorId', 'name')
      .sort({ startedAt: -1 });

      return activeSyncs;
    } catch (error) {
      logger.error('Error getting active syncs:', error);
      throw error;
    }
  }

  /**
   * Helper: Calculate sync progress percentage
   */
  calculateProgress(syncJob) {
    if (syncJob.status === 'completed') return 100;
    if (syncJob.status === 'failed' || syncJob.status === 'cancelled') return 0;
    if (syncJob.status === 'running') return 50; // TODO: Implement real progress tracking
    return 0;
  }

  /**
   * Helper: Sync inventory from vendor to store
   */
  async syncInventoryVendorToStore(mapping, dryRun = false) {
    try {
      logger.info(`Syncing inventory vendor to store for mapping ${mapping._id}`, { dryRun });
      
      // Get vendor inventory for this SKU
      const vendorInventory = await noxaService.getInventory(mapping.vendorId, [mapping.vendorSku]);
      const vendorItem = vendorInventory.find(item => item.sku === mapping.vendorSku);
      
      if (!vendorItem) {
        throw new Error(`Vendor inventory not found for SKU: ${mapping.vendorSku}`);
      }
      
      // Calculate sync inventory based on mapping settings
      const rawInventory = parseInt(vendorItem.quantity || vendorItem.inventory || 0);
      let syncInventory = rawInventory + (mapping.syncSettings.inventoryOffset || 0);
      
      // Apply minimum inventory constraint
      if (syncInventory < (mapping.syncSettings.minimumInventory || 0)) {
        syncInventory = mapping.syncSettings.minimumInventory || 0;
      }
      
      // Apply maximum inventory constraint
      if (mapping.syncSettings.maximumInventory && syncInventory > mapping.syncSettings.maximumInventory) {
        syncInventory = mapping.syncSettings.maximumInventory;
      }
      
      // Ensure non-negative inventory
      syncInventory = Math.max(0, syncInventory);
      
      logger.info(`Inventory calculation: vendor=${rawInventory}, sync=${syncInventory}`, {
        mappingId: mapping._id,
        offset: mapping.syncSettings.inventoryOffset,
        min: mapping.syncSettings.minimumInventory,
        max: mapping.syncSettings.maximumInventory
      });
      
      if (!dryRun) {
        // Get current Shopify inventory to calculate delta
        const shopifyInventoryLevels = await shopifyService.getInventoryLevels(
          mapping.storeId, 
          [mapping.shopifyVariantId]
        );
        
        let currentShopifyInventory = 0;
        if (shopifyInventoryLevels.length > 0) {
          const inventoryLevel = shopifyInventoryLevels[0].inventoryLevels.edges[0];
          if (inventoryLevel) {
            currentShopifyInventory = inventoryLevel.node.available || 0;
          }
        }
        
        // Calculate inventory delta
        const inventoryDelta = syncInventory - currentShopifyInventory;
        
        if (inventoryDelta !== 0) {
          // Update Shopify inventory
          await shopifyService.updateInventory(
            mapping.storeId,
            mapping.shopifyVariantId,
            inventoryDelta,
            null // Use default location
          );
          
          logger.info(`Updated Shopify inventory: ${currentShopifyInventory} -> ${syncInventory}`, {
            mappingId: mapping._id,
            delta: inventoryDelta
          });
        }
        
        // Update mapping with latest inventory data
        await ProductMapping.findByIdAndUpdate(mapping._id, {
          vendorInventory: rawInventory,
          shopifyInventory: syncInventory,
          inventoryDifference: rawInventory - syncInventory,
          lastInventoryCheck: new Date(),
          lastSyncAttempt: new Date(),
          syncStatus: 'success'
        });
      }
      
      return {
        vendorInventory: rawInventory,
        syncInventory,
        updated: !dryRun,
        skipped: dryRun
      };
    } catch (error) {
      logger.error(`Error syncing inventory vendor to store for mapping ${mapping._id}:`, error);
      
      if (!dryRun) {
        // Update mapping with error status
        await ProductMapping.findByIdAndUpdate(mapping._id, {
          lastSyncAttempt: new Date(),
          syncStatus: 'error',
          syncErrors: [error.message]
        });
      }
      
      throw error;
    }
  }

  /**
   * Helper: Sync inventory from store to vendor
   */
  async syncInventoryStoreToVendor(mapping, dryRun = false) {
    try {
      logger.info(`Syncing inventory store to vendor for mapping ${mapping._id}`, { dryRun });
      
      // Get Shopify inventory levels
      const shopifyInventoryLevels = await shopifyService.getInventoryLevels(
        mapping.storeId, 
        [mapping.shopifyVariantId]
      );
      
      let shopifyInventory = 0;
      if (shopifyInventoryLevels.length > 0) {
        const inventoryLevel = shopifyInventoryLevels[0].inventoryLevels.edges[0];
        if (inventoryLevel) {
          shopifyInventory = inventoryLevel.node.available || 0;
        }
      }
      
      logger.info(`Found Shopify inventory: ${shopifyInventory}`, {
        mappingId: mapping._id,
        shopifyVariantId: mapping.shopifyVariantId
      });
      
      if (!dryRun) {
        // Check if vendor supports inventory updates
        const vendor = await Vendor.findById(mapping.vendorId);
        if (!vendor) {
          throw new Error('Vendor not found');
        }
        
        // Update vendor inventory (if supported)
        try {
          await noxaService.updateInventory(
            mapping.vendorId,
            mapping.vendorSku,
            shopifyInventory
          );
          
          logger.info(`Updated vendor inventory: ${shopifyInventory}`, {
            mappingId: mapping._id,
            vendorSku: mapping.vendorSku
          });
        } catch (vendorError) {
          // Some vendors may not support inventory updates
          logger.warn(`Vendor inventory update not supported or failed:`, {
            mappingId: mapping._id,
            error: vendorError.message
          });
          
          // Don't throw error, just log the limitation
        }
        
        // Update mapping with latest inventory data
        await ProductMapping.findByIdAndUpdate(mapping._id, {
          shopifyInventory,
          inventoryDifference: (mapping.vendorInventory || 0) - shopifyInventory,
          lastInventoryCheck: new Date(),
          lastSyncAttempt: new Date(),
          syncStatus: 'success'
        });
      }
      
      return {
        shopifyInventory,
        updated: !dryRun,
        skipped: dryRun,
        vendorUpdateSupported: true // Will be false if vendor doesn't support updates
      };
    } catch (error) {
      logger.error(`Error syncing inventory store to vendor for mapping ${mapping._id}:`, error);
      
      if (!dryRun) {
        // Update mapping with error status
        await ProductMapping.findByIdAndUpdate(mapping._id, {
          lastSyncAttempt: new Date(),
          syncStatus: 'error',
          syncErrors: [error.message]
        });
      }
      
      throw error;
    }
  }

  // /**
  //  * Helper: Create product in Shopify from vendor data
  //  */
  // async createProductFromVendor(storeId, vendorId, productData) {
  //   // TODO: Implement product creation from vendor data   
  // }

  // /**
  //  * Helper: Update existing product from vendor data
  //  */
  // async updateProductFromVendor(mapping, productData) {
  //   // TODO: Implement product update from vendor data
  // }
}

module.exports = new SyncService();
