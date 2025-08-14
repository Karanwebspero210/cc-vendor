const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const shopifyService = require('../services/shopify.service');
const inventoryService = require('../services/inventory.service');
const SyncJob = require('../models/SyncJob');
const Store = require('../models/Store');
const { v4: uuidv4 } = require('uuid');
const encryption = require('../utils/encryption');
const { createQueue } = require('../queues');

/**
 * Shopify Controller
 * Handles Shopify store operations and API interactions
 */
class ShopifyController {
  constructor() {
    // Queue to handle background sync with Shopify jobs
    this.shopifySyncQueue = createQueue('shopify-sync');

    // Bind methods to preserve 'this' when used as route handlers
    this.getStores = this.getStores.bind(this);
    this.connectStore = this.connectStore.bind(this);
    this.syncWithShopify = this.syncWithShopify.bind(this);

    // Register queue processor once
    if (!this.shopifySyncQueue._shopifySyncProcessorAttached) {
      this.shopifySyncQueue.process('sync-with-shopify', 1, async (job) => {
        const { jobId, storeId, options = {} } = job.data || {};

        let syncJobDoc = null;
        try {
          const procStartTs = Date.now();
          logger.info(`[queue:shopify-sync][start][${jobId}]`, { bullJobId: job.id, storeId, options });
          syncJobDoc = await SyncJob.findOne({ jobId });
          if (syncJobDoc) await syncJobDoc.start();
          if (syncJobDoc) {
            logger.debug(`[queue:shopify-sync][db-loaded][${jobId}]`, { dbId: String(syncJobDoc._id) });
          }

          const store = await Store.findById(storeId);
          if (!store) {
            throw new Error('Store not found');
          }

          // Resolve and persist required Shopify fields only (no inventory quantity updates here)
          const prep = await inventoryService.syncStoreFromProductVariants(storeId, {
            ...options,
            // Real-time progress hook
            onProgress: async ({ processed, resolved, skipped, total }) => {
              try {
                // Update Bull job progress in percentage and SyncJob document
                const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
                await job.progress(pct);
                if (syncJobDoc) {
                  await syncJobDoc.updateProgress(resolved, 0, total);
                  if (typeof syncJobDoc.appendLogs === 'function') {
                    await syncJobDoc.appendLogs([
                      { level: 'info', message: `Batch progress: processed=${processed} resolved=${resolved} skipped=${skipped} total=${total} (${pct}%)` }
                    ]);
                  }
                }
                logger.info(`[queue:shopify-sync][progress][${jobId}]`, { processed, resolved, skipped, total, pct });
              } catch (e) {
                logger.warn(`[queue:shopify-sync][progress-failed][${jobId}] ${e.message}`);
              }
            },
            // Allow tuning batch sizes/delays via env; safe defaults already in service
            batchSize: Number(process.env.INVENTORY_BATCH_SIZE || 1000),
            batchDelayMs: Number(process.env.INVENTORY_BATCH_DELAY_MS || 300)
          });
          const totalItems = Number(prep.total || 0);
          const resolvedItems = Number(prep.countToUpdate || 0);
          const skippedItems = Number(prep.skipped || 0);
          logger.info(`[queue:shopify-sync][resolved][${jobId}]`, { totalItems, resolvedItems, skippedItems });

          if (syncJobDoc) await syncJobDoc.updateProgress(resolvedItems, 0, totalItems);

          const logs = [
            { level: 'info', message: `Variants scanned: ${totalItems}` },
            { level: 'info', message: `Variants with required Shopify fields: ${resolvedItems}` },
            { level: 'info', message: `Variants skipped (missing fields/unqualified): ${skippedItems}` }
          ];

          // Complete job with summary only; no inventory push performed in this step
          if (syncJobDoc) {
            await syncJobDoc.complete(true, {
              message: 'Shopify field resolution completed',
              data: { logs, summary: prep },
              stats: { resolved: resolvedItems, skipped: skippedItems, duration: syncJobDoc.duration }
            });
            logger.info(`[queue:shopify-sync][complete][${jobId}]`, { dbId: String(syncJobDoc._id), durationMs: Date.now() - procStartTs });
          }

          return { resolved: resolvedItems, skipped: skippedItems, total: totalItems };
        } catch (error) {
          if (syncJobDoc) {
            await syncJobDoc.fail(error, false);
          }
          logger.error(`[queue:shopify-sync][error][${jobId}] ${error.message}`, { storeId, options });
          throw error;
        }
      });

      this.shopifySyncQueue._shopifySyncProcessorAttached = true;
    }
  }
  /**
   * Get all connected Shopify stores
   */
  async getStores(req, res) {
    try {
      // Return the connected store for the current admin context
      // Since this is an admin-only app and single-vendor, we return the first connected store
      const store = await Store.findOne({ connectionStatus: 'connected' }, '-accessToken -encryptedCredentials')
        .sort({ createdAt: -1 });

      if (!store) {
        return ResponseHelper.success(res, { store: null }, 'No connected Shopify store found');
      }

      ResponseHelper.success(res, { store }, 'Connected Shopify store retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving Shopify stores:', error);
      ResponseHelper.error(res, 'Failed to retrieve Shopify stores', 500, 'SHOPIFY_STORES_ERROR');
    }
  }

  /**
   * Connect a new Shopify store
   */
  async connectStore(req, res) {
    try {
      const { shopDomain, accessToken } = req.body;
      
      // Normalize incoming domain to myshopify.com form
      let normalizedDomain = (shopDomain || '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .toLowerCase();
      if (!normalizedDomain.endsWith('.myshopify.com')) {
        // If only subdomain or custom domain provided, force myshopify domain using subdomain part
        const sub = normalizedDomain.split('.')[0];
        normalizedDomain = `${sub}.myshopify.com`;
      }
      
      // Check if store already exists
      const existingStore = await Store.findOne({ shopifyDomain: normalizedDomain });
      if (existingStore) {
        return ResponseHelper.error(res, 'Store with this domain already exists', 400, 'STORE_ALREADY_EXISTS');
      }     

      // Test connection first
      const connectionTest = await shopifyService.testConnection(normalizedDomain, accessToken);
      
      if (!connectionTest.success) {
        return ResponseHelper.error(res, 'Failed to connect to Shopify store: ' + connectionTest.error, 400, 'CONNECTION_FAILED');
      }
      
      // Create store in database
      const store = new Store({
        name: connectionTest.shopInfo.name,
        shopifyDomain: normalizedDomain,
        accessToken, // encrypted by model setter
        shopifyShopId: String(connectionTest.shopInfo.id || ''),
        metadata: {
          timezone: connectionTest.shopInfo.iana_timezone,
          currency: connectionTest.shopInfo.currency
        },
        isActive: true,
        lastConnectionCheck: new Date()
      });
      
      await store.save();

      // Fetch and cache the store's default location id immediately after connecting
      try {
        await shopifyService.getPrimaryLocationId(store._id);
      } catch (locErr) {
        logger.warn(`Unable to cache default Shopify location for store ${store._id}: ${locErr.message}`);
      }
      
      // Return store without sensitive data
      const storeData = store.toObject();
      delete storeData.accessToken;
      delete storeData.encryptedCredentials;
      
      ResponseHelper.success(res, storeData, 'Shopify store connected successfully', 201);
    } catch (error) {
      logger.error('Error connecting Shopify store:', error);
      ResponseHelper.error(res, 'Failed to connect Shopify store', 500, 'SHOPIFY_CONNECTION_ERROR');
    }
  }  

  /**
   * Bulk sync inventory from ProductVariant to Shopify for a store
   */
  async syncWithShopify(req, res) {
    try {
      // Updated flow: remove selection option and target only variants missing Shopify IDs
      const { /* onlyInStock = false, */ maxUpdates = 0 } = req.body || {};
      const reqStartTs = Date.now();
      const reqId = req.headers['x-request-id'] || uuidv4();
      logger.info(`[api:syncWithShopify][start][${reqId}]`, {
        maxUpdates,
        ip: req.ip,
        path: req.originalUrl
      });

      // Get the connected store for current admin context
      const store = await Store.findOne({ connectionStatus: 'connected' });
      if (!store) {
        return ResponseHelper.error(res, 'No connected Shopify store found', 404, 'STORE_NOT_FOUND');
      }
      const storeId = String(store._id);
      logger.debug(`[api:syncWithShopify][store-loaded][${reqId}]`, { storeId });

      const jobId = uuidv4();
      logger.debug(`[api:syncWithShopify][job-uuid-created][${reqId}]`, { jobId });

      // Create SyncJob and enqueue background processing without waiting
      const jobDoc = await SyncJob.create({
        jobId,  
        type: 'manual',
        storeId,
        status: 'queued',
        queueName: 'shopify-sync',
        data: {
          selectedProducts: [],
          syncConfig: { batchSize: 50, syncInventory: false, dryRun: false },
          filters: { onlyMissingShopifyFields: true, maxUpdates }
        },
        metadata: { triggeredBy: 'manual', tags: ['shopify-sync'] }
      });
      logger.info(`[api:syncWithShopify][job-doc-created][${reqId}]`, { dbId: String(jobDoc._id), jobId, storeId });
     
      // Push to queue (processor will fetch sizes and variant details from Shopify)
      const bullJob = await this.shopifySyncQueue.add(
        'sync-with-shopify',
        {
          jobId,
          storeId,
          // Processor will resolve missing Shopify fields (variantId, inventoryItemId) from Shopify by SKU
          options: { maxUpdates, onlyMissingShopifyFields: true }
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: false
        }
      );
      logger.info(`[api:syncWithShopify][enqueued][${reqId}]`, { bullJobId: bullJob && bullJob.id, jobId, dbId: String(jobDoc._id) });

      // Return immediately without waiting for processing
      ResponseHelper.success(
        res,
        {
          jobId: jobDoc._id,
          status: 'queued',
          message: 'Sync with Shopify job has been queued'
        },
        'Sync with Shopify queued'
      );
      logger.info(`[api:syncWithShopify][response][${reqId}]`, { durationMs: Date.now() - reqStartTs, dbId: String(jobDoc._id), jobId, bullJobId: bullJob && bullJob.id });
    } catch (error) {
      logger.error(`[api:syncWithShopify][error] ${error.message}`);
      ResponseHelper.error(res, 'Failed to sync inventory', 500, 'SHOPIFY_BULK_INVENTORY_ERROR');
    }
  }

  /**
   * Update inventory for a specific variant
   */
  async updateInventory(req, res) {
    try {
      const { storeId, variantId } = req.params;
      const { quantity, inventoryItemId } = req.body;
      
      // Validate inputs
      if (typeof quantity !== 'number' || quantity < 0) {
        return ResponseHelper.error(res, 'Quantity must be a non-negative number', 400, 'INVALID_QUANTITY');
      }
      
      // Validate store exists and is connected
      const store = await Store.findById(storeId);
      if (!store) {
        return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
      }
      
      if (!store.connected) {
        return ResponseHelper.error(res, 'Store is not connected. Please test connection first.', 400, 'STORE_NOT_CONNECTED');
      }
      
      // Decrypt access token
      const accessToken = encryption.decrypt(store.accessToken);
      
      // Use Shopify GraphQL API to update inventory
      const updateResult = await shopifyService.updateInventory({
        storeId,
        variantId,
        inventoryItemId,
        quantity,
        shopDomain: store.shopifyDomain,
        accessToken
      });
      
      // Log the inventory change
      logger.info(`Inventory updated for store ${storeId}, variant ${variantId}: ${updateResult.previousQuantity} -> ${quantity}`);
      
      ResponseHelper.success(res, {
        ...updateResult,
        updatedAt: new Date()
      }, 'Shopify inventory updated successfully');
    } catch (error) {
      logger.error('Error updating Shopify inventory:', error);
      ResponseHelper.error(res, 'Failed to update Shopify inventory', 500, 'SHOPIFY_INVENTORY_UPDATE_ERROR');
    }
  }
 
}

module.exports = new ShopifyController();
