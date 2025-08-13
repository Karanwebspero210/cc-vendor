const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const shopifyService = require('../services/shopify.service');
const inventoryService = require('../services/inventory.service');
const SyncJob = require('../models/SyncJob');
const syncService = require('../services/sync.service');
const Store = require('../models/Store');
const encryption = require('../utils/encryption');

/**
 * Shopify Controller
 * Handles Shopify store operations and API interactions
 */
class ShopifyController {
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

      console.log('Connection test result:', connectionTest);
      
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
   * Get products from a specific Shopify store
   */
  async getStoreProducts(req, res) {
    try {
      const { storeId } = req.params;
      const { page = 1, limit = 50, query } = req.query;
      
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
      
      // Use Shopify GraphQL API to fetch products
      const result = await shopifyService.getProducts(storeId, {
        page: parseInt(page),
        limit: parseInt(limit),
        query,
        shopDomain: store.shopifyDomain,
        accessToken
      });
      
      ResponseHelper.success(res, result, 'Shopify products retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving Shopify products:', error);
      ResponseHelper.error(res, 'Failed to retrieve Shopify products', 500, 'SHOPIFY_PRODUCTS_ERROR');
    }
  }

  /**
   * Get inventory levels from Shopify store
   */
  async getStoreInventory(req, res) {
    try {
      const { storeId } = req.params;
      const { productIds, variantIds } = req.query;
      
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
      
      // Parse IDs if provided
      const productIdList = productIds ? productIds.split(',') : undefined;
      const variantIdList = variantIds ? variantIds.split(',') : undefined;
      
      // Use Shopify GraphQL API to fetch inventory levels
      const inventory = await shopifyService.getInventory(storeId, {
        productIds: productIdList,
        variantIds: variantIdList,
        shopDomain: store.shopDomain,
        accessToken
      });
      
      ResponseHelper.success(res, inventory, 'Shopify inventory retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving Shopify inventory:', error);
      ResponseHelper.error(res, 'Failed to retrieve Shopify inventory', 500, 'SHOPIFY_INVENTORY_ERROR');
    }
  }

  /**
   * Sync products from Shopify store
   */
  async syncStoreProducts(req, res) {
    try {
      const { storeId } = req.params;
      const { syncType = 'full', vendorIds } = req.body;
      
      // Validate store exists and is connected
      const store = await Store.findById(storeId);
      if (!store) {
        return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
      }
      
      if (!store.connected) {
        return ResponseHelper.error(res, 'Store is not connected. Please test connection first.', 400, 'STORE_NOT_CONNECTED');
      }
      
      // Validate sync type
      const validSyncTypes = ['full', 'inventory', 'products'];
      if (!validSyncTypes.includes(syncType)) {
        return ResponseHelper.error(res, 'Invalid sync type. Must be one of: ' + validSyncTypes.join(', '), 400, 'INVALID_SYNC_TYPE');
      }
      
      // Create sync job in queue
      const syncData = await syncService.startStoreSync({
        storeId,
        syncType,
        vendorIds: vendorIds || [],
        triggeredBy: 'manual',
        userId: req.user?.id
      });
      
      ResponseHelper.success(res, syncData, 'Shopify product sync started successfully');
    } catch (error) {
      logger.error('Error starting Shopify product sync:', error);
      ResponseHelper.error(res, 'Failed to start Shopify product sync', 500, 'SHOPIFY_SYNC_ERROR');
    }
  }

  /**
   * Bulk sync inventory from ProductVariant to Shopify for a store
   */
  async syncInventory(req, res) {
    try {
      const { selectedSkus = [], onlyInStock = false, maxUpdates = 0, updateOutOfStock = true } = req.body || {};

      // Get the connected store for current admin context
      const store = await Store.findOne({ connectionStatus: 'connected' });
      if (!store) {
        return ResponseHelper.error(res, 'No connected Shopify store found', 404, 'STORE_NOT_FOUND');
      }
      const storeId = String(store._id);

      // Create SyncJob
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const job = await SyncJob.create({
        jobId,
        type: 'manual',
        storeId,
        status: 'queued',
        data: {
          selectedProducts: selectedSkus,
          syncConfig: { batchSize: 50, syncInventory: true, updateOutOfStock, dryRun: false }
        },
        metadata: { triggeredBy: 'manual', tags: ['inventory-sync'] }
      });

      await job.start();

      const result = await inventoryService.syncStoreFromProductVariants(storeId, {
        selectedSkus,
        onlyInStock,
        maxUpdates,
        updateOutOfStock
      });

      // Update job progress/result
      await job.updateProgress(result.updated, result.failed, result.total);
      await job.complete(true, {
        message: 'Inventory sync completed',
        data: { logs: result.logs },
        stats: { inventoryUpdates: result.updated, errors: result.failed, duration: job.duration }
      });

      ResponseHelper.success(res, { jobId: job.jobId, ...result }, 'Inventory sync completed');
    } catch (error) {
      logger.error('Error syncing inventory:', error);
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

  /**
   * Test Shopify store connection
   */
  async testConnection(req, res) {
    try {
      const { storeId } = req.params;
      
      // Validate store exists
      const store = await Store.findById(storeId);
      if (!store) {
        return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
      }
      
      // Decrypt access token
      const accessToken = encryption.decrypt(store.accessToken);
      
      // Test API connection with stored credentials
      const connectionTest = await shopifyService.testConnection(store.shopifyDomain, accessToken);
      
      // Update store connection status
      await Store.findByIdAndUpdate(storeId, {
        connected: connectionTest.success,
        lastConnectionTest: new Date(),
        connectionStatus: connectionTest.status,
        lastError: connectionTest.success ? null : connectionTest.error,
        shopInfo: connectionTest.success ? connectionTest.shopInfo : store.shopInfo
      });
      
      const result = {
        connected: connectionTest.success,
        status: connectionTest.status,
        shopInfo: {
          ...connectionTest.shopInfo,
          testedAt: new Date()
        }
      };
      
      if (!connectionTest.success) {
        result.error = connectionTest.error;
      }
      
      ResponseHelper.success(res, result, connectionTest.success ? 'Shopify connection test successful' : 'Shopify connection test failed');
    } catch (error) {
      logger.error('Error testing Shopify connection:', error);
      ResponseHelper.error(res, 'Shopify connection test failed', 500, 'SHOPIFY_CONNECTION_TEST_ERROR');
    }
  }
}

module.exports = new ShopifyController();
