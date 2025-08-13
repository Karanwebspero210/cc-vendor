const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const SyncLog = require('../models/SyncLog');
const SyncJob = require('../models/SyncJob');
const { v4: uuidv4 } = require('uuid');
const { createQueue } = require('../queues');
const noxaService = require('../services/noxa.service');

/**
 * Product Controller
 * Handles product operations and syncing
 */
class ProductController {
  constructor() {
    // Create queues for jobs
    this.productSyncQueue = createQueue('product-sync');
    this.inventoryUpdateQueue = createQueue('inventory-update');
    
    // Bind all methods to maintain 'this' context
    this.startProductSync = this.startProductSync.bind(this);
    this.getSyncJobStatus = this.getSyncJobStatus.bind(this);
    this.getProducts = this.getProducts.bind(this);
    this.updateInventoryBySKUs = this.updateInventoryBySKUs.bind(this);
    this.getJobStatus = this.getJobStatus.bind(this);

    // Register processor for product sync jobs (once per process)
    if (!this.productSyncQueue._productSyncProcessorAttached) {
      this.productSyncQueue.process('sync-products', 1, async (job) => {
        const { jobId, options = {} } = job.data || {};
        const page = parseInt(options.page) || 1;
        const limit = parseInt(options.limit) || 100;

        // Create a SyncLog entry (optional if schema requires extra fields)
        let syncLog = null;
        let syncJobDoc = null;
        try {
          // Link to SyncJob if exists
          syncJobDoc = await SyncJob.findOne({ jobId });
          if (syncJobDoc) {
            await syncJobDoc.start();
          }

          syncLog = await SyncLog.create({
            syncId: jobId,
            type: 'manual',
            status: 'running',
            queueName: 'product-sync',
            jobId: String(job.id),
            startTime: new Date(),
            progress: { totalProducts: 0, processedProducts: 0, successCount: 0, errorCount: 0, skippedCount: 0, percentage: 0 },
            triggeredBy: 'admin',
            triggerData: {}
          });
        } catch (e) {
          logger.warn(`SyncLog create skipped: ${e.message}`);
        }

        try {
          // Fetch first page to determine total and page size
          const first = await noxaService.getActiveSKUList(page, limit);
          if (!first.Result || !first.Response) {
            throw new Error(first.Message || 'Failed to fetch active SKU list');
          }

          const { SKUList: firstList = [], TotalCount = first.Response?.TotalCount || 0, ListSize = first.Response?.ListSize || firstList.length } = first.Response;
          const totalCount = Number(TotalCount) || firstList.length;
          const listSize = Number(ListSize) || firstList.length || limit;
          const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, listSize)));

          // Initialize totals
          if (syncLog) {
            syncLog.progress.totalProducts = totalCount;
            await syncLog.save();
          }
          if (syncJobDoc) {
            await syncJobDoc.updateProgress(0, 0, totalCount);
          }

          const chunkSize = 100; // per vendor docs
          let processed = 0;

          // Helper to process one page of SKUs with de-dup and limited concurrency
          const processSkuPage = async (skuList) => {
            const uniqueSkus = Array.from(new Set((skuList || [])
              .filter(Boolean)
              .map(s => s.toString().trim().toUpperCase())));

            const chunks = [];
            for (let i = 0; i < uniqueSkus.length; i += chunkSize) {
              chunks.push(uniqueSkus.slice(i, i + chunkSize));
            }

            const concurrency = Math.max(1, parseInt(process.env.NOXA_BATCH_CONCURRENCY || '3'));
            let index = 0;

            const worker = async () => {
              while (true) {
                const currentIndex = index;
                if (currentIndex >= chunks.length) break;
                index += 1;
                const chunk = chunks[currentIndex];
                try {
                  const r = await noxaService.getInventoryBySKUs(chunk);
                  const success = !!(r && r.Result);
                  processed += chunk.length;
                  if (syncLog) await syncLog.updateProgress(processed, success);
                  if (syncJobDoc) await syncJobDoc.updateProgress(processed, syncJobDoc.progress.failed, totalCount);
                } catch (e) {
                  processed += chunk.length;
                  if (syncLog) {
                    await syncLog.addError({ sku: chunk, error: e.message, errorCode: 'NOXA_BATCH_FETCH_ERROR' });
                    await syncLog.updateProgress(processed, false);
                  }
                  const failed = (syncJobDoc?.progress?.failed || 0) + chunk.length;
                  if (syncJobDoc) await syncJobDoc.updateProgress(processed, failed, totalCount);
                }
                const pct = Math.round((processed / Math.max(1, totalCount)) * 100);
                await job.progress(pct);
              }
            };

            const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
            await Promise.all(workers);
          };

          // Process first page
          await processSkuPage(firstList);

          // Process remaining pages
          for (let p = page + 1; p <= totalPages; p += 1) {
            const resp = await noxaService.getActiveSKUList(p, listSize);
            if (!resp.Result || !resp.Response) {
              throw new Error(resp.Message || `Failed to fetch active SKU list page ${p}`);
            }
            const { SKUList = [] } = resp.Response;
            await processSkuPage(SKUList);
          }

          if (syncLog) await syncLog.complete(true);
          if (syncJobDoc) await syncJobDoc.complete(true, { message: 'Product sync completed', stats: { duration: syncLog ? syncLog.duration : undefined } });
          return { success: true, processed: processed, total: totalCount };
        } catch (err) {
          if (syncLog) {
            await syncLog.addLog('error', 'Product sync failed', { message: err.message });
            await syncLog.complete(false);
          }
          if (syncJobDoc) await syncJobDoc.fail(err, false);
          throw err;
        }
      });

      // Mark to avoid duplicate attachment
      this.productSyncQueue._productSyncProcessorAttached = true;
    }

    // Register processor for inventory update jobs
    if (!this.inventoryUpdateQueue._inventoryUpdateProcessorAttached) {
      this.inventoryUpdateQueue.process('inventory-update', 1, async (job) => {
        const { jobId, skus = [] } = job.data || {};
        let syncJobDoc = null;
        try {
          syncJobDoc = await SyncJob.findOne({ jobId });
          if (syncJobDoc) await syncJobDoc.start();

          // Perform inventory update via vendor service
          const response = await noxaService.getInventoryBySKUs(skus);
          if (!response || response.Result !== true) {
            throw new Error(response?.Message || 'Inventory update failed');
          }

          if (syncJobDoc) {
            await syncJobDoc.updateProgress(skus.length, 0, skus.length);
            await syncJobDoc.complete(true, {
              message: `Inventory updated for ${skus.length} SKU(s)`,
              data: { skus },
              stats: { inventoryUpdates: skus.length }
            });
          }

          return { success: true, updated: skus.length };
        } catch (err) {
          if (syncJobDoc) {
            await syncJobDoc.fail(err, false);
          }
          throw err;
        }
      });

      this.inventoryUpdateQueue._inventoryUpdateProcessorAttached = true;
    }
  }
  /**
   * Start a product sync job
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async startProductSync(req, res) {
    try {
      const { page = 1, limit = 100 } = req.body;
      const jobId = uuidv4();

      logger.info(`Starting product sync job ${jobId}`, { page, limit });
      // Enforce single running product sync
      const existing = await SyncJob.findOne({
        queueName: 'product-sync',
        status: { $in: ['queued', 'active', 'delayed'] }
      });
      if (existing) {
        return ResponseHelper.error(
          res,
          'A product sync job is already in progress. Please wait until it finishes.',
          409,
          'SYNC_ALREADY_RUNNING',
          { currentJobId: existing.jobId }
        );
      }

      // Create DB record for the job
      await SyncJob.create({
        jobId,
        type: 'manual',
        status: 'queued',
        queueName: 'product-sync',
        metadata: {
          triggeredBy: req.user ? req.user.id : 'system'
        }
      });
      
      // Add job to the queue
      const job = await this.productSyncQueue.add(
        'sync-products',
        { 
          jobId,
          options: { page, limit },
          startedBy: req.user ? req.user.id : 'system'
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true
        }
      );
      
      // Return job information immediately
      ResponseHelper.success(res, {
        jobId,
        status: 'queued',
        message: 'Product sync job has been queued',
        data: {
          jobId: job.id,
          status: 'queued',
          progress: 0,
          page,
          limit
        },
      });
    } catch (error) {
      logger.error('Error starting product sync job:', error);
      ResponseHelper.error(
        res,
        'Failed to start product sync job',
        error.status || 500,
        'PRODUCT_SYNC_START_ERROR',
        { error: error.message }
      );
    }
  }

  /**
   * Get status of a product sync job
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getSyncJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return ResponseHelper.error(
          res,
          'Job ID is required',
          400,
          'MISSING_JOB_ID'
        );
      }
      
      // Prefer DB status
      const jobDoc = await SyncJob.findOne({ jobId });
      if (jobDoc) {
        return ResponseHelper.success(res, {
          jobId,
          status: jobDoc.status,
          progress: jobDoc.progress,
          createdAt: jobDoc.createdAt,
          startedAt: jobDoc.startedAt,
          completedAt: jobDoc.completedAt,
          result: jobDoc.result
        }, 'Job status retrieved');
      }

      // Fallback to queue and logs
      const jobs = await this.productSyncQueue.getJobs(['waiting', 'active', 'completed', 'failed']);
      const qJob = jobs.find(j => j.data.jobId === jobId);
      if (qJob) {
        const state = await qJob.getState();
        const progress = qJob.progress();
        return ResponseHelper.success(res, {
          jobId,
          status: state,
          progress: typeof progress === 'number' ? progress : undefined,
          timestamp: new Date().toISOString()
        }, 'Job status retrieved');
      }

      const log = await SyncLog.findOne({ $or: [ { syncId: jobId }, { jobId: jobId } ] });
      if (log) {
        return ResponseHelper.success(res, {
          jobId,
          status: log.status,
          startTime: log.startTime,
          endTime: log.endTime,
          duration: log.endTime ? log.endTime - log.startTime : null
        }, 'Job status retrieved');
      }

      return ResponseHelper.error(
        res,
        'Job not found',
        404,
        'JOB_NOT_FOUND'
      );
    } catch (error) {
      logger.error('Error getting job status:', error);
      ResponseHelper.error(
        res,
        'Failed to get job status',
        error.status || 500,
        'JOB_STATUS_ERROR',
        { error: error.message }
      );
    }
  }

  /**
   * Get all products with pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getProducts(req, res) {
    try {
      const { page = 1, limit = 50, search } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const query = {};
      if (search) {
        query.$or = [
          { mainSku: { $regex: search, $options: 'i' } },
          { 'variants.sku': { $regex: search, $options: 'i' } },
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      const [products, total] = await Promise.all([
        Product.find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ mainSku: 1 }),
        Product.countDocuments(query)
      ]);
      
      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      };
      
      ResponseHelper.success(res, {
        products,
        pagination
      }, 'Products retrieved successfully');
    } catch (error) {
      logger.error('Error getting products:', error);
      ResponseHelper.error(
        res,
        'Failed to retrieve products',
        500,
        'PRODUCTS_FETCH_ERROR',
        { error: error.message }
      );
    }
  }

  /**
   * Update inventory for specific SKUs
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async updateInventoryBySKUs(req, res) {
    try {
      const { skus } = req.body;
      
      if (!Array.isArray(skus) || skus.length === 0) {
        return ResponseHelper.badRequest(res, 'SKUs array is required and cannot be empty');
      }
      
      const jobId = uuidv4();
      logger.info(`Starting inventory update job ${jobId}`, { skus });

      // Create DB job record
      await SyncJob.create({
        jobId,
        type: 'manual',
        status: 'queued',
        queueName: 'inventory-update',
        data: { selectedProducts: skus, syncConfig: { syncInventory: true } },
        metadata: { triggeredBy: req.user ? req.user.id : 'system' }
      });

      // Enqueue inventory update
      await this.inventoryUpdateQueue.add(
        'inventory-update',
        { jobId, skus },
        { jobId, removeOnComplete: true, removeOnFail: true }
      );

      return ResponseHelper.success(res, {
        jobId,
        status: 'queued',
        message: 'Inventory update job has been queued',
        skus,
        startedAt: new Date()
      });
      
    } catch (error) {
      logger.error('Error in updateInventoryBySKUs:', error);
      return ResponseHelper.error(res, error.message || 'Failed to start inventory update');
    }
  }
  
  /**
   * Get job status
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  async getJobStatus(req, res) {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        return ResponseHelper.badRequest(res, 'Job ID is required');
      }

      const jobDoc = await SyncJob.findOne({ jobId });
      if (!jobDoc) {
        return ResponseHelper.notFound(res, 'Job not found');
      }

      return ResponseHelper.success(res, {
        jobId: jobDoc.jobId,
        status: jobDoc.status,
        progress: jobDoc.progress,
        result: jobDoc.result,
        createdAt: jobDoc.createdAt,
        startedAt: jobDoc.startedAt,
        completedAt: jobDoc.completedAt
      });
      
    } catch (error) {
      logger.error('Error in getJobStatus:', error);
      return ResponseHelper.error(res, error.message || 'Failed to get job status');
    }
  }
}

// Export an instance of the controller
module.exports = new ProductController();
