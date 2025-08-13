const logger = require('../utils/logger');
const SyncJob = require('./sync-job');
const BatchSyncJob = require('./batch-sync-job');
const Store = require('../models/Store');
const SyncLog = require('../models/SyncLog');
const SyncSchedule = require('../models/SyncSchedule');
const syncService = require('../services/sync.service');

/**
 * Scheduled Sync Job Handler
 * Handles cron-based scheduled sync operations
 */
class ScheduledSyncJob {
  /**
   * Process a scheduled sync job
   * @param {Object} job - Bull job object
   * @param {Function} done - Callback function
   */
  static async process(job, done) {
    const { data } = job;
    const { scheduleId, scheduleName, syncConfig } = data;

    logger.info(`Starting scheduled sync job for schedule ${scheduleId}: ${scheduleName}`);

    try {
      // Update job progress
      await job.progress(5);

      // Get schedule configuration
      const schedule = await SyncSchedule.findById(scheduleId);
      if (!schedule) {
        throw new Error(`Schedule ${scheduleId} not found`);
      }

      if (!schedule.isActive) {
        logger.info(`Schedule ${scheduleId} is inactive, skipping execution`);
        done(null, { skipped: true, reason: 'Schedule inactive' });
        return;
      }

      // Update schedule last run time
      schedule.lastRun = new Date();
      schedule.runCount = (schedule.runCount || 0) + 1;
      await schedule.save();

      await job.progress(10);

      // Determine sync targets based on schedule configuration
      const { storeIds, vendorIds, syncType, options = {} } = syncConfig;

      // Validate and get active stores and vendors
      let stores, vendors;

      if (storeIds && storeIds.length > 0) {
        stores = await Store.find({ 
          _id: { $in: storeIds }, 
          connected: true, 
          isActive: true 
        });
      } else {
        // Get all active connected stores if none specified
        stores = await Store.find({ 
          connected: true, 
          isActive: true 
        });
      }

      if (vendorIds && vendorIds.length > 0) {
        vendors = await Vendor.find({ 
          _id: { $in: vendorIds }, 
          connected: true, 
          isActive: true 
        });
      } else {
        // Get all active connected vendors if none specified
        vendors = await Vendor.find({ 
          connected: true, 
          isActive: true 
        });
      }

      if (stores.length === 0) {
        throw new Error('No active connected stores found for scheduled sync');
      }

      if (vendors.length === 0) {
        throw new Error('No active connected vendors found for scheduled sync');
      }

      logger.info(`Scheduled sync will process ${stores.length} stores and ${vendors.length} vendors`);

      await job.progress(15);

      // Create scheduled sync log entry
      const scheduledSyncLog = new SyncLog({
        syncId: `scheduled_${scheduleId}_${Date.now()}`,
        syncType: 'scheduled',
        status: 'running',
        startedAt: new Date(),
        jobId: job.id,
        scheduleId,
        options: {
          ...options,
          scheduleName,
          storeCount: stores.length,
          vendorCount: vendors.length,
          individualSyncType: syncType
        }
      });
      await scheduledSyncLog.save();

      let syncResult;

      // Determine execution strategy
      if (options.executionStrategy === 'individual') {
        // Execute individual syncs for each store-vendor pair
        syncResult = await this.executeIndividualSyncs(job, stores, vendors, syncType, options, schedule);
      } else {
        // Execute as batch sync (default)
        syncResult = await this.executeBatchSync(job, stores, vendors, syncType, options, schedule);
      }

      // Update scheduled sync log with results
      await SyncLog.findOneAndUpdate(
        { syncId: scheduledSyncLog.syncId },
        {
          status: 'completed',
          completedAt: new Date(),
          result: syncResult,
          productsProcessed: syncResult.totalProductsProcessed || 0,
          inventoryUpdated: syncResult.totalInventoryUpdated || 0,
          errors: syncResult.errors || []
        }
      );

      // Update schedule with last success
      schedule.lastSuccessfulRun = new Date();
      schedule.successCount = (schedule.successCount || 0) + 1;
      await schedule.save();

      logger.info(`Scheduled sync job for schedule ${scheduleId} completed successfully`, syncResult);
      done(null, syncResult);

    } catch (error) {
      logger.error(`Scheduled sync job for schedule ${scheduleId} failed:`, error);

      // Update schedule with failure
      const schedule = await SyncSchedule.findById(scheduleId);
      if (schedule) {
        schedule.failureCount = (schedule.failureCount || 0) + 1;
        schedule.lastError = error.message;
        schedule.lastErrorAt = new Date();
        await schedule.save();
      }

      // Update scheduled sync log with error
      await SyncLog.findOneAndUpdate(
        { scheduleId, status: 'running' },
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
   * Execute batch sync strategy
   */
  static async executeBatchSync(job, stores, vendors, syncType, options, schedule) {
    logger.info('Executing scheduled sync using batch strategy');

    const batchId = `scheduled_batch_${schedule._id}_${Date.now()}`;
    const storeIds = stores.map(s => s._id);
    const vendorIds = vendors.map(v => v._id);

    // Create batch sync job data
    const batchJobData = {
      batchId,
      storeIds,
      vendorIds,
      syncType,
      options: {
        ...options,
        scheduledSync: true,
        scheduleId: schedule._id,
        strategy: options.batchStrategy || 'sequential'
      }
    };

    // Create mock job for batch sync
    const mockBatchJob = {
      id: batchId,
      data: batchJobData,
      processedOn: Date.now(),
      progress: async (progress) => {
        // Map batch progress to overall job progress (15-95%)
        const mappedProgress = 15 + (progress * 0.8);
        await job.progress(Math.floor(mappedProgress));
      }
    };

    // Execute batch sync
    const batchResult = await new Promise((resolve, reject) => {
      BatchSyncJob.process(mockBatchJob, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });

    await job.progress(100);

    return {
      executionStrategy: 'batch',
      scheduleId: schedule._id,
      scheduleName: schedule.name,
      ...batchResult
    };
  }

  /**
   * Execute individual syncs strategy
   */
  static async executeIndividualSyncs(job, stores, vendors, syncType, options, schedule) {
    logger.info('Executing scheduled sync using individual strategy');

    const results = [];
    const errors = [];
    let totalProductsProcessed = 0;
    let totalInventoryUpdated = 0;

    // Generate store-vendor pairs
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

    logger.info(`Generated ${syncPairs.length} sync pairs for individual execution`);

    if (syncPairs.length === 0) {
      throw new Error('No valid store-vendor pairs found with active mappings');
    }

    const baseProgress = 15;
    const progressRange = 80;

    // Process each pair individually
    for (let i = 0; i < syncPairs.length; i++) {
      const pair = syncPairs[i];

      try {
        logger.info(`Processing individual sync ${i + 1}/${syncPairs.length}: ${pair.storeName} <-> ${pair.vendorName}`);

        const syncId = `scheduled_individual_${schedule._id}_${pair.storeId}_${pair.vendorId}_${Date.now()}`;
        const syncJobData = {
          syncId,
          storeId: pair.storeId,
          vendorId: pair.vendorId,
          syncType,
          options: {
            ...options,
            scheduledSync: true,
            scheduleId: schedule._id
          }
        };

        const mockJob = {
          id: syncId,
          data: syncJobData,
          processedOn: Date.now(),
          progress: async (progress) => {
            const pairProgress = baseProgress + ((i / syncPairs.length) * progressRange) + ((progress / 100) * (progressRange / syncPairs.length));
            await job.progress(Math.floor(pairProgress));
          }
        };

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
        logger.error(`Error in individual sync ${pair.storeName} <-> ${pair.vendorName}:`, error);
        errors.push({
          storeId: pair.storeId,
          vendorId: pair.vendorId,
          storeName: pair.storeName,
          vendorName: pair.vendorName,
          error: error.message
        });
      }
    }

    await job.progress(100);

    return {
      executionStrategy: 'individual',
      scheduleId: schedule._id,
      scheduleName: schedule.name,
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
    logger.error(`Scheduled sync job ${job.id} failed:`, error);
    
    if (job.data.scheduleId) {
      // Update schedule failure count
      await SyncSchedule.findByIdAndUpdate(job.data.scheduleId, {
        $inc: { failureCount: 1 },
        lastError: error.message,
        lastErrorAt: new Date()
      });

      // Update sync log
      await SyncLog.findOneAndUpdate(
        { scheduleId: job.data.scheduleId, status: 'running' },
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
    logger.info(`Scheduled sync job ${job.id} completed:`, result);
    
    if (job.data.scheduleId && !result.skipped) {
      // Update schedule success count
      await SyncSchedule.findByIdAndUpdate(job.data.scheduleId, {
        $inc: { successCount: 1 },
        lastSuccessfulRun: new Date()
      });
    }
  }

  /**
   * Handle job progress updates
   */
  static async onProgress(job, progress) {
    logger.debug(`Scheduled sync job ${job.id} progress: ${progress}%`);
  }

  /**
   * Check if schedule should run based on conditions
   */
  static async shouldScheduleRun(schedule) {
    // Check if schedule is active
    if (!schedule.isActive) {
      return { shouldRun: false, reason: 'Schedule is inactive' };
    }

    // Check if within allowed time window
    if (schedule.timeWindow) {
      const now = new Date();
      const currentTime = now.getHours() * 100 + now.getMinutes();
      
      if (schedule.timeWindow.start && currentTime < schedule.timeWindow.start) {
        return { shouldRun: false, reason: 'Outside time window (too early)' };
      }
      
      if (schedule.timeWindow.end && currentTime > schedule.timeWindow.end) {
        return { shouldRun: false, reason: 'Outside time window (too late)' };
      }
    }

    // Check failure threshold
    if (schedule.maxConsecutiveFailures && schedule.consecutiveFailures >= schedule.maxConsecutiveFailures) {
      return { shouldRun: false, reason: 'Max consecutive failures reached' };
    }

    return { shouldRun: true };
  }
}

module.exports = ScheduledSyncJob;
