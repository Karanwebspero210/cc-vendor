const logger = require('../utils/logger');
const noxaService = require('../services/noxa.service');
const ProductVariant = require('../models/ProductVariant');
const SyncLog = require('../models/SyncLog');
const { v4: uuidv4 } = require('uuid');

/**
 * Product Sync Job
 * Handles syncing products from Noxa vendor to the local database
 */
class ProductSyncJob {
  /**
   * Process a product sync job
   * @param {Object} job - Bull job object
   * @param {Function} done - Callback function
   */
  static async process(job, done) {
    const { data } = job;
    const { jobId = uuidv4(), options = {} } = data;
    const { page = 1, limit = 100 } = options;
    
    logger.info(`Starting product sync job ${jobId}`, { jobId, options });
    
    // Create a sync log entry
    const syncLog = new SyncLog({
      jobId,
      type: 'product-sync',
      status: 'in-progress',
      startTime: new Date(),
      metadata: { options }
    });
    
    try {
      await syncLog.save();
      
      // Update job progress
      await job.progress(10);
      
      // Get all active SKUs first
      const skusResponse = await noxaService.makeRequest('/inventory/ActiveSKUList', 'GET', null, {
        pgNo: page,
        pgSize: limit
      });
      
      if (!skusResponse.Result || !Array.isArray(skusResponse.Response) || skusResponse.Response.length === 0) {
        syncLog.status = 'completed';
        syncLog.endTime = new Date();
        syncLog.result = { message: 'No active SKUs found to sync' };
        await syncLog.save();
        
        logger.info(`Product sync job ${jobId} completed: No active SKUs found`);
        return done(null, { 
          success: true, 
          message: 'No active SKUs found to sync',
          jobId
        });
      }
      
      // Extract SKUs from the response
      const skus = skusResponse.Response.map(item => item.SKU).filter(Boolean);
      
      if (skus.length === 0) {
        syncLog.status = 'completed';
        syncLog.endTime = new Date();
        syncLog.result = { message: 'No valid SKUs found to process' };
        await syncLog.save();
        
        logger.info(`Product sync job ${jobId} completed: No valid SKUs found`);
        return done(null, { 
          success: true, 
          message: 'No valid SKUs found to process',
          jobId
        });
      }
      
      // Process SKUs in batches
      const batchSize = 10; // Smaller batch size to avoid timeouts
      let processed = 0;
      let synced = 0;
      let skipped = 0;
      let failed = 0;
      
      for (let i = 0; i < skus.length; i += batchSize) {
        // Process a batch of SKUs
        const batch = skus.slice(i, i + batchSize);
        
        // Get inventory for this batch of SKUs
        const inventoryResponse = await noxaService.getInventoryBySKUs(batch);
        
        const batchResults = [];
        if (inventoryResponse.Result && inventoryResponse.Response) {
          // Process successful responses
          inventoryResponse.Response.details?.forEach(item => {
            batchResults.push({
              success: true,
              sku: item.sku,
              variants: item.variants
            });
          });
        }
        
        // Update sync log with batch results
        syncLog.progress = {
          total: skus.length,
          processed: processed + batch.length,
          success: (syncLog.progress?.success || 0) + batchResults.filter(r => r.success).length,
          failed: (syncLog.progress?.failed || 0) + batch.length - batchResults.filter(r => r.success).length,
          lastProcessedSKU: batch[batch.length - 1]
        };
        
        await syncLog.save();
        
        // Update progress
        processed += batch.length;
        const progress = Math.min(Math.round((processed / skus.length) * 90) + 10, 99);
        await job.progress(progress);
        
        // Log batch results
        const successful = batchResults.filter(r => r.success);
        const failed = batch.length - successful.length;
        
        logger.info(`Processed batch ${i / batchSize + 1}`, {
          total: skus.length,
          processed,
          success: successful.length,
          failed
        });
        
        // Process products in batches
        const bulkOps = [];
        for (const batchResult of batchResults) {
          try {
            const sku = batchResult.sku;
            
            // Skip if we already have this product and it was updated recently
            const existingProduct = await ProductVariant.findOne({ 'vendorSku': sku });
            if (existingProduct && 
                existingProduct.lastUpdated && 
                (Date.now() - existingProduct.lastUpdated.getTime()) < (24 * 60 * 60 * 1000)) {
              logger.debug(`Skipping recently updated product: ${sku}`);
              skipped++;
              continue;
            }
            
            // Add to bulk operations
            bulkOps.push({
              updateOne: {
                filter: { vendorSku: sku },
                update: { $set: noxaService.transformProductData(batchResult.variants) },
                upsert: true
              }
            });
            
            synced++;
          } catch (error) {
            logger.error(`Error processing product: ${batchResult.sku}`, error);
            failed++;
          }
        }
        
        // Execute bulk operations if we have any
        if (bulkOps.length > 0) {
          try {
            await ProductVariant.bulkWrite(bulkOps, { ordered: false });
          } catch (error) {
            logger.error('Error in bulk write operation:', error);
            // Try to save products individually if bulk write fails
            for (const op of bulkOps) {
              try {
                await ProductVariant.updateOne(
                  op.updateOne.filter,
                  op.updateOne.update,
                  { upsert: true }
                );
              } catch (indError) {
                logger.error(`Failed to save product ${op.updateOne.filter.vendorSku}:`, indError);
                failed++;
              }
            }
          }
        }
      }
      
      // Update sync log with results
      syncLog.status = 'completed';
      syncLog.endTime = new Date();
      syncLog.result = {
        totalProcessed: processed,
        synced,
        skipped,
        failed
      };
      
      await syncLog.save();
      
      logger.info(`Product sync job ${jobId} completed successfully`, {
        totalProcessed: processed,
        synced,
        skipped,
        failed
      });
      
      done(null, {
        success: true,
        jobId,
        totalProcessed: processed,
        synced,
        skipped,
        failed
      });
      
    } catch (error) {
      logger.error(`Product sync job ${jobId} failed:`, error);
      
      // Update sync log with error
      syncLog.status = 'failed';
      syncLog.endTime = new Date();
      syncLog.error = error.message;
      syncLog.stack = error.stack;
      
      try {
        await syncLog.save();
      } catch (logError) {
        logger.error('Failed to update sync log:', logError);
      }
      
      done(error);
    }
  }
  
  /**
   * Get job status by ID
   * @param {string} jobId - The job ID
   * @returns {Promise<Object>} - The job status and results
   */
  static async getJobStatus(jobId) {
    try {
      const log = await SyncLog.findOne({ jobId, type: 'product-sync' });
      
      if (!log) {
        return {
          found: false,
          status: 'not-found',
          message: 'No sync job found with the specified ID'
        };
      }
      
      return {
        found: true,
        jobId: log.jobId,
        status: log.status,
        startTime: log.startTime,
        endTime: log.endTime,
        duration: log.endTime ? log.endTime - log.startTime : null,
        result: log.result,
        error: log.error,
        metadata: log.metadata
      };
    } catch (error) {
      logger.error(`Error getting job status for ${jobId}:`, error);
      throw error;
    }
  }
}

module.exports = ProductSyncJob;
