const logger = require('../utils/logger');
const SyncJob = require('./sync-job');
const Store = require('../models/Store');
const SyncLog = require('../models/SyncLog');
const batchService = require('../services/batch.service');

/**
 * Batch Sync Job Handler
 * Handles batch sync operations across multiple stores and vendors
 */
class BatchSyncJob {
  /**
   * Process a batch sync job
   * @param {Object} job - Bull job object
   * @param {Function} done - Callback function
   */
  static async process(job, done) {
    const { data } = job;
    const { batchId, storeIds, vendorIds, syncType, options = {} } = data;

    logger.info(`Starting batch sync job ${batchId}: ${syncType} sync for ${storeIds.length} stores and ${vendorIds.length} vendors`);

    try {
      // Update job progress
      await job.progress(5);

      // Validate stores and vendors
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

      logger.info(`Found ${stores.length} stores and ${vendors.length} vendors for batch sync`);

      // Create batch sync log entry
      const batchSyncLog = new SyncLog({
        syncId: batchId,
        syncType: 'batch',
        status: 'running',
        startedAt: new Date(),
        jobId: job.id,
        options: {
          ...options,
          storeCount: stores.length,
          vendorCount: vendors.length,
          individualSyncType: syncType
        }
      });
      await batchSyncLog.save();

      await job.progress(10);

      // Generate all store-vendor combinations
      const syncPairs = [];
      for (const store of stores) {
        for (const vendor of vendors) {
          // Check if there are active mappings between this store and vendor
          const mappingCount = await ProductMapping.countDocuments({
            storeId: store._id,
            vendorId: vendor._id,
            isActive: true
          });

          if (mappingCount > 0 || options.includeUnmapped) {
            syncPairs.push({
              storeId: store._id,
              vendorId: vendor._id,
              storeName: store.name,
              vendorName: vendor.name,
              mappingCount
            });
          }
        }
      }

      logger.info(`Generated ${syncPairs.length} sync pairs for batch processing`);

      if (syncPairs.length === 0) {
        throw new Error('No valid store-vendor pairs found with active mappings');
      }

      await job.progress(15);

      // Process sync pairs based on strategy
      let batchResult;
      switch (options.strategy || 'sequential') {
        case 'parallel':
          batchResult = await this.processParallelSync(job, syncPairs, syncType, options);
          break;
        case 'sequential':
        default:
          batchResult = await this.processSequentialSync(job, syncPairs, syncType, options);
          break;
      }

      // Update batch sync log with results
      await SyncLog.findOneAndUpdate(
        { syncId: batchId },
        {
          status: 'completed',
          completedAt: new Date(),
          result: batchResult,
          productsProcessed: batchResult.totalProductsProcessed || 0,
          inventoryUpdated: batchResult.totalInventoryUpdated || 0,
          errors: batchResult.errors || []
        }
      );

      logger.info(`Batch sync job ${batchId} completed successfully`, batchResult);
      done(null, batchResult);

    } catch (error) {
      logger.error(`Batch sync job ${batchId} failed:`, error);

      // Update batch sync log with error
      await SyncLog.findOneAndUpdate(
        { syncId: batchId },
        {
          status: 'failed',
          completedAt: new Date(),
          error: error.message,
          errorStack: error.stack
        }
      );

      done(error);
    }
  }

  /**
   * Process sync pairs sequentially
   */
  static async processSequentialSync(job, syncPairs, syncType, options) {
    logger.info(`Processing ${syncPairs.length} sync pairs sequentially`);

    const results = [];
    const errors = [];
    let totalProductsProcessed = 0;
    let totalInventoryUpdated = 0;

    const baseProgress = 15;
    const progressRange = 80;

    for (let i = 0; i < syncPairs.length; i++) {
      const pair = syncPairs[i];
      
      try {
        logger.info(`Processing sync pair ${i + 1}/${syncPairs.length}: ${pair.storeName} <-> ${pair.vendorName}`);

        // Create individual sync job data
        const syncId = `${job.data.batchId}_${pair.storeId}_${pair.vendorId}`;
        const syncJobData = {
          syncId,
          storeId: pair.storeId,
          vendorId: pair.vendorId,
          syncType,
          options: {
            ...options,
            batchSync: true,
            parentBatchId: job.data.batchId
          }
        };

        // Create a mock job object for the individual sync
        const mockJob = {
          id: syncId,
          data: syncJobData,
          processedOn: Date.now(),
          progress: async (progress) => {
            // Calculate overall batch progress
            const pairProgress = baseProgress + ((i / syncPairs.length) * progressRange) + ((progress / 100) * (progressRange / syncPairs.length));
            await job.progress(Math.floor(pairProgress));
          }
        };

        // Process individual sync
        const syncResult = await new Promise((resolve, reject) => {
          SyncJob.process(mockJob, (error, result) => {
            if (error) reject(error);
            else resolve(result);
          });
        });

        results.push({
          storeId: pair.storeId,
          vendorId: pair.vendorId,
          storeName: pair.storeName,
          vendorName: pair.vendorName,
          result: syncResult
        });

        totalProductsProcessed += syncResult.productsProcessed || 0;
        totalInventoryUpdated += syncResult.inventoryUpdated || 0;

        if (syncResult.errors && syncResult.errors.length > 0) {
          errors.push(...syncResult.errors.map(err => ({
            ...err,
            storeId: pair.storeId,
            vendorId: pair.vendorId
          })));
        }

      } catch (error) {
        logger.error(`Error processing sync pair ${pair.storeName} <-> ${pair.vendorName}:`, error);
        errors.push({
          storeId: pair.storeId,
          vendorId: pair.vendorId,
          storeName: pair.storeName,
          vendorName: pair.vendorName,
          error: error.message
        });
      }

      // Update progress
      const progress = baseProgress + ((i + 1) / syncPairs.length) * progressRange;
      await job.progress(Math.floor(progress));
    }

    await job.progress(100);

    return {
      strategy: 'sequential',
      totalPairs: syncPairs.length,
      successfulPairs: results.length,
      failedPairs: syncPairs.length - results.length,
      totalProductsProcessed,
      totalInventoryUpdated,
      results,
      errors,
      duration: Date.now() - job.processedOn
    };
  }

  /**
   * Process sync pairs in parallel (with concurrency limit)
   */
  static async processParallelSync(job, syncPairs, syncType, options) {
    logger.info(`Processing ${syncPairs.length} sync pairs in parallel`);

    const concurrency = options.concurrency || 3; // Limit concurrent syncs
    const results = [];
    const errors = [];

    // Process in batches to control concurrency
    const batches = [];
    for (let i = 0; i < syncPairs.length; i += concurrency) {
      batches.push(syncPairs.slice(i, i + concurrency));
    }

    let totalProductsProcessed = 0;
    let totalInventoryUpdated = 0;
    let processedPairs = 0;

    const baseProgress = 15;
    const progressRange = 80;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      logger.info(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} pairs`);

      // Process batch in parallel
      const batchPromises = batch.map(async (pair) => {
        try {
          const syncId = `${job.data.batchId}_${pair.storeId}_${pair.vendorId}`;
          const syncJobData = {
            syncId,
            storeId: pair.storeId,
            vendorId: pair.vendorId,
            syncType,
            options: {
              ...options,
              batchSync: true,
              parentBatchId: job.data.batchId
            }
          };

          const mockJob = {
            id: syncId,
            data: syncJobData,
            processedOn: Date.now(),
            progress: async () => {} // No individual progress updates in parallel mode
          };

          const syncResult = await new Promise((resolve, reject) => {
            SyncJob.process(mockJob, (error, result) => {
              if (error) reject(error);
              else resolve(result);
            });
          });

          return {
            success: true,
            storeId: pair.storeId,
            vendorId: pair.vendorId,
            storeName: pair.storeName,
            vendorName: pair.vendorName,
            result: syncResult
          };

        } catch (error) {
          return {
            success: false,
            storeId: pair.storeId,
            vendorId: pair.vendorId,
            storeName: pair.storeName,
            vendorName: pair.vendorName,
            error: error.message
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process batch results
      for (const result of batchResults) {
        if (result.success) {
          results.push(result);
          totalProductsProcessed += result.result.productsProcessed || 0;
          totalInventoryUpdated += result.result.inventoryUpdated || 0;

          if (result.result.errors && result.result.errors.length > 0) {
            errors.push(...result.result.errors.map(err => ({
              ...err,
              storeId: result.storeId,
              vendorId: result.vendorId
            })));
          }
        } else {
          errors.push({
            storeId: result.storeId,
            vendorId: result.vendorId,
            storeName: result.storeName,
            vendorName: result.vendorName,
            error: result.error
          });
        }
      }

      processedPairs += batch.length;

      // Update progress
      const progress = baseProgress + (processedPairs / syncPairs.length) * progressRange;
      await job.progress(Math.floor(progress));
    }

    await job.progress(100);

    return {
      strategy: 'parallel',
      concurrency,
      totalPairs: syncPairs.length,
      successfulPairs: results.length,
      failedPairs: syncPairs.length - results.length,
      totalProductsProcessed,
      totalInventoryUpdated,
      results,
      errors,
      duration: Date.now() - job.processedOn
    };
  }

  /**
   * Handle job failure
   */
  static async onFailed(job, error) {
    logger.error(`Batch sync job ${job.id} failed:`, error);
    
    if (job.data.batchId) {
      await SyncLog.findOneAndUpdate(
        { syncId: job.data.batchId },
        {
          status: 'failed',
          completedAt: new Date(),
          error: error.message,
          errorStack: error.stack
        }
      );
    }
  }

  /**
   * Handle job completion
   */
  static async onCompleted(job, result) {
    logger.info(`Batch sync job ${job.id} completed:`, result);
  }

  /**
   * Handle job progress updates
   */
  static async onProgress(job, progress) {
    logger.debug(`Batch sync job ${job.id} progress: ${progress}%`);
  }
}

module.exports = BatchSyncJob;
