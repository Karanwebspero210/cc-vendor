const logger = require('../utils/logger');
const shopifyService = require('../services/shopify.service');
const noxaService = require('../services/noxa.service');
const inventoryService = require('../services/inventory.service');
const Store = require('../models/Store');
const SyncLog = require('../models/SyncLog');
const { decryptData } = require('../utils/encryption');

/**
 * Sync Job Handler
 * Handles individual sync operations between stores and vendors
 */
class SyncJob {
  /**
   * Process a sync job
   * @param {Object} job - Bull job object
   * @param {Function} done - Callback function
   */
  static async process(job, done) {
    const { data } = job;
    const { syncId, storeId, vendorId, syncType, options = {} } = data;

    logger.info(`Starting sync job ${syncId}: ${syncType} sync between store ${storeId} and vendor ${vendorId}`);

    try {
      // Update job progress
      await job.progress(10);

      // Validate store and vendor
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

      if (!store.connected || !vendor.connected) {
        throw new Error('Store or vendor is not connected');
      }

      // Create sync log entry
      const syncLog = new SyncLog({
        syncId,
        storeId,
        vendorId,
        syncType,
        status: 'running',
        startedAt: new Date(),
        jobId: job.id,
        options
      });
      await syncLog.save();

      await job.progress(20);

      // Decrypt credentials
      const storeAccessToken = decryptData(store.accessToken);
      const vendorApiKey = decryptData(vendor.apiKey);

      let syncResult;

      switch (syncType) {
        case 'full':
          syncResult = await this.performFullSync(job, store, vendor, storeAccessToken, vendorApiKey, options);
          break;
        case 'inventory':
          syncResult = await this.performInventorySync(job, store, vendor, storeAccessToken, vendorApiKey, options);
          break;
        case 'products':
          syncResult = await this.performProductSync(job, store, vendor, storeAccessToken, vendorApiKey, options);
          break;
        default:
          throw new Error(`Unknown sync type: ${syncType}`);
      }

      // Update sync log with results
      await SyncLog.findOneAndUpdate(
        { syncId },
        {
          status: 'completed',
          completedAt: new Date(),
          result: syncResult,
          productsProcessed: syncResult.productsProcessed || 0,
          inventoryUpdated: syncResult.inventoryUpdated || 0,
          errors: syncResult.errors || []
        }
      );

      logger.info(`Sync job ${syncId} completed successfully`, syncResult);
      done(null, syncResult);

    } catch (error) {
      logger.error(`Sync job ${syncId} failed:`, error);

      // Update sync log with error
      await SyncLog.findOneAndUpdate(
        { syncId },
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
   * Perform full sync (products + inventory)
   */
  static async performFullSync(job, store, vendor, storeAccessToken, vendorApiKey, options) {
    logger.info(`Performing full sync for store ${store._id} and vendor ${vendor._id}`);

    await job.progress(30);

    // First sync products
    const productResult = await this.performProductSync(job, store, vendor, storeAccessToken, vendorApiKey, options);
    
    await job.progress(70);

    // Then sync inventory
    const inventoryResult = await this.performInventorySync(job, store, vendor, storeAccessToken, vendorApiKey, options);

    await job.progress(100);

    return {
      type: 'full',
      productsProcessed: productResult.productsProcessed,
      inventoryUpdated: inventoryResult.inventoryUpdated,
      errors: [...(productResult.errors || []), ...(inventoryResult.errors || [])],
      duration: Date.now() - job.processedOn
    };
  }

  /**
   * Perform inventory-only sync
   */
  static async performInventorySync(job, store, vendor, storeAccessToken, vendorApiKey, options) {
    logger.info(`Performing inventory sync for store ${store._id} and vendor ${vendor._id}`);

    const errors = [];
    let inventoryUpdated = 0;

    try {
      // Get active product mappings
      const mappings = await ProductMapping.find({
        storeId: store._id,
        vendorId: vendor._id,
        isActive: true,
        'syncSettings.syncInventory': true
      });

      logger.info(`Found ${mappings.length} active mappings for inventory sync`);

      const totalMappings = mappings.length;
      let processedMappings = 0;

      for (const mapping of mappings) {
        try {
          // Get vendor inventory for this SKU
          const vendorInventory = await noxaService.getInventory(vendor._id, {
            skus: [mapping.vendorSku],
            apiUrl: vendor.apiUrl,
            apiKey: vendorApiKey
          });

          if (vendorInventory && vendorInventory.length > 0) {
            const vendorStock = vendorInventory[0];
            let newQuantity = vendorStock.quantity;

            // Apply inventory buffer if configured
            if (mapping.syncSettings.inventoryBuffer > 0) {
              newQuantity = Math.max(0, newQuantity - mapping.syncSettings.inventoryBuffer);
            }

            // Update Shopify inventory
            await shopifyService.updateInventory({
              storeId: store._id,
              variantId: mapping.shopifyVariantId,
              inventoryItemId: mapping.shopifyInventoryItemId,
              quantity: newQuantity,
              shopDomain: store.shopDomain,
              accessToken: storeAccessToken
            });

            inventoryUpdated++;
            logger.debug(`Updated inventory for SKU ${mapping.vendorSku}: ${newQuantity}`);
          }

        } catch (error) {
          logger.error(`Error updating inventory for mapping ${mapping._id}:`, error);
          errors.push({
            mappingId: mapping._id,
            vendorSku: mapping.vendorSku,
            error: error.message
          });
        }

        processedMappings++;
        const progress = 30 + Math.floor((processedMappings / totalMappings) * 60);
        await job.progress(progress);
      }

    } catch (error) {
      logger.error('Error in inventory sync:', error);
      errors.push({ error: error.message });
    }

    return {
      type: 'inventory',
      inventoryUpdated,
      errors,
      duration: Date.now() - job.processedOn
    };
  }

  /**
   * Perform product-only sync
   */
  static async performProductSync(job, store, vendor, storeAccessToken, vendorApiKey, options) {
    logger.info(`Performing product sync for store ${store._id} and vendor ${vendor._id}`);

    const errors = [];
    let productsProcessed = 0;

    try {
      // Get vendor products
      const vendorProducts = await noxaService.getProducts(vendor._id, {
        limit: options.limit || 100,
        apiUrl: vendor.apiUrl,
        apiKey: vendorApiKey
      });

      logger.info(`Retrieved ${vendorProducts.products?.length || 0} products from vendor`);

      const products = vendorProducts.products || [];
      const totalProducts = products.length;

      for (let i = 0; i < products.length; i++) {
        const product = products[i];

        try {
          // Check if product mapping exists
          const existingMapping = await ProductMapping.findOne({
            storeId: store._id,
            vendorId: vendor._id,
            vendorSku: product.sku
          });

          if (!existingMapping) {
            // Create new product mapping if auto-mapping is enabled
            if (options.autoCreateMappings) {
              // This would involve creating products in Shopify and mapping them
              // Implementation depends on business logic for product creation
              logger.info(`Would create mapping for new product: ${product.sku}`);
            }
          } else {
            // Update existing product if needed
            logger.debug(`Product mapping exists for SKU: ${product.sku}`);
          }

          productsProcessed++;

        } catch (error) {
          logger.error(`Error processing product ${product.sku}:`, error);
          errors.push({
            sku: product.sku,
            error: error.message
          });
        }

        // Update progress
        const progress = 30 + Math.floor((i / totalProducts) * 40);
        await job.progress(progress);
      }

    } catch (error) {
      logger.error('Error in product sync:', error);
      errors.push({ error: error.message });
    }

    return {
      type: 'products',
      productsProcessed,
      errors,
      duration: Date.now() - job.processedOn
    };
  }

  /**
   * Handle job failure
   */
  static async onFailed(job, error) {
    logger.error(`Sync job ${job.id} failed:`, error);
    
    // Update sync log
    if (job.data.syncId) {
      await SyncLog.findOneAndUpdate(
        { syncId: job.data.syncId },
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
    logger.info(`Sync job ${job.id} completed:`, result);
  }

  /**
   * Handle job progress updates
   */
  static async onProgress(job, progress) {
    logger.debug(`Sync job ${job.id} progress: ${progress}%`);
  }
}

module.exports = SyncJob;
