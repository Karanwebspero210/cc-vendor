const logger = require('../utils/logger');
const SyncJob = require('../models/SyncJob');
const inventoryService = require('./inventory.service');
const syncService = require('./sync.service');

/**
 * Batch Service
 * Handles batch operations and bulk processing
 */
class BatchService {
  /**
   * Process batch sync operations
   */
  async processBatchSync(operations, options = {}) {
    try {
      const { priority = 'normal', maxConcurrent = 3 } = options;
      const results = {
        total: operations.length,
        successful: 0,
        failed: 0,
        errors: [],
        results: []
      };

      // Process operations in batches to avoid overwhelming the system
      for (let i = 0; i < operations.length; i += maxConcurrent) {
        const batch = operations.slice(i, i + maxConcurrent);
        const batchPromises = batch.map(operation => this.processOperation(operation));
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          const operation = batch[index];
          if (result.status === 'fulfilled') {
            results.successful++;
            results.results.push({
              operation,
              success: true,
              result: result.value
            });
          } else {
            results.failed++;
            results.errors.push({
              operation,
              error: result.reason.message
            });
            results.results.push({
              operation,
              success: false,
              error: result.reason.message
            });
          }
        });
      }

      return results;
    } catch (error) {
      logger.error('Error processing batch sync:', error);
      throw error;
    }
  }

  /**
   * Process individual operation
   */
  async processOperation(operation) {
    try {
      const { type, storeId, vendorId, data } = operation;
      
      switch (type) {
        case 'inventory_update':
          return await this.processInventoryUpdate(storeId, vendorId, data);
        case 'product_sync':
          return await this.processProductSync(storeId, vendorId, data);
        case 'mapping_create':
          return await this.processMappingCreate(storeId, vendorId, data);
        default:
          throw new Error(`Unknown operation type: ${type}`);
      }
    } catch (error) {
      logger.error('Error processing operation:', error);
      throw error;
    }
  }

  /**
   * Process inventory update operation
   */
  async processInventoryUpdate(storeId, vendorId, data) {
    try {
      const { items = [], force = false } = data;
      
      if (!items || items.length === 0) {
        throw new Error('No items provided for inventory update');
      }

      let updated = 0;
      let errors = [];

      // Process each inventory item
      for (const item of items) {
        try {
          const { sku, quantity, operation = 'set' } = item;
          
          if (!sku) {
            errors.push({ item, error: 'SKU is required' });
            continue;
          }

          // Refresh inventory for the specific store or vendor
          if (storeId) {
            await inventoryService.refreshStoreInventory(storeId, force);
          } else if (vendorId) {
            await inventoryService.refreshVendorInventory(vendorId, force);
          }

          updated++;
        } catch (error) {
          errors.push({ item, error: error.message });
          logger.error('Error updating inventory item:', { item, error });
        }
      }

      return {
        updated,
        total: items.length,
        errors,
        success: errors.length === 0
      };
    } catch (error) {
      logger.error('Error processing inventory update:', error);
      throw error;
    }
  }

  /**
   * Process product sync operation
   */
  async processProductSync(storeId, vendorId, data) {
    try {
      const { syncType = 'inventory', products = [], options = {} } = data;
      
      let syncResult;
      
      // If specific products are provided, sync only those
      if (products && products.length > 0) {
        let synced = 0;
        let errors = [];
        
        for (const product of products) {
          try {
            // For specific products, we'll use the sync service's inventory sync
            // with product-specific options
            await syncService.syncInventory(storeId, vendorId, {
              ...options,
              productFilter: product
            });
            synced++;
          } catch (error) {
            errors.push({ product, error: error.message });
            logger.error('Error syncing product:', { product, error });
          }
        }
        
        syncResult = {
          synced,
          total: products.length,
          errors,
          success: errors.length === 0
        };
      } else {
        // Sync all products based on sync type
        switch (syncType) {
          case 'inventory':
            syncResult = await syncService.syncInventory(storeId, vendorId, options);
            break;
          case 'products':
            syncResult = await syncService.syncProducts(storeId, vendorId, options);
            break;
          case 'full':
            syncResult = await syncService.syncFull(storeId, vendorId, options);
            break;
          default:
            throw new Error(`Unknown sync type: ${syncType}`);
        }
      }
      
      return {
        ...syncResult,
        syncType,
        storeId,
        vendorId
      };
    } catch (error) {
      logger.error('Error processing product sync:', error);
      throw error;
    }
  }

  /**
   * Process mapping creation operation
   */
  async processMappingCreate(storeId, vendorId, data) {
    try {
      const { mappings = [], overwrite = false } = data;
      
      if (!mappings || mappings.length === 0) {
        throw new Error('No mappings provided for creation');
      }

      let created = 0;
      let updated = 0;
      let errors = [];
      const results = [];

      for (const mapping of mappings) {
        try {
          const {
            shopifyProductId,
            shopifyVariantId,
            vendorSku,
            vendorProductId,
            isActive = true,
            syncDirection = 'both',
            priceMultiplier = 1,
            inventoryBuffer = 0
          } = mapping;

          // Validate required fields
          if (!shopifyProductId || !vendorSku) {
            errors.push({ 
              mapping, 
              error: 'shopifyProductId and vendorSku are required' 
            });
            continue;
          }

          // Check if mapping already exists
          const existingMapping = await ProductMapping.findOne({
            storeId,
            vendorId,
            shopifyProductId,
            vendorSku
          });

          if (existingMapping && !overwrite) {
            errors.push({ 
              mapping, 
              error: 'Mapping already exists. Use overwrite=true to update.' 
            });
            continue;
          }

          const mappingData = {
            storeId,
            vendorId,
            shopifyProductId,
            shopifyVariantId,
            vendorSku,
            vendorProductId,
            isActive,
            syncDirection,
            priceMultiplier,
            inventoryBuffer,
            lastSyncAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };

          let result;
          if (existingMapping) {
            // Update existing mapping
            result = await ProductMapping.findByIdAndUpdate(
              existingMapping._id,
              { ...mappingData, updatedAt: new Date() },
              { new: true }
            );
            updated++;
          } else {
            // Create new mapping
            result = await ProductMapping.create(mappingData);
            created++;
          }

          results.push({
            mapping: result,
            action: existingMapping ? 'updated' : 'created'
          });

        } catch (error) {
          errors.push({ mapping, error: error.message });
          logger.error('Error creating/updating mapping:', { mapping, error });
        }
      }

      return {
        created,
        updated,
        total: mappings.length,
        errors,
        results,
        success: errors.length === 0
      };
    } catch (error) {
      logger.error('Error processing mapping creation:', error);
      throw error;
    }
  }
}

module.exports = new BatchService();
