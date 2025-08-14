const logger = require('../utils/logger');
const Store = require('../models/Store');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const shopifyService = require('./shopify.service');
const noxaService = require('./noxa.service');

/**
 * Inventory Service
 * Handles inventory management and synchronization logic
 */
class InventoryService {
  /**
   * Sync Shopify inventory for a store using ProductVariant as source of truth.
   * Options: { selectedSkus?: string[], onlyInStock?: boolean, maxUpdates?: number, updateOutOfStock?: boolean, onlyMissingShopifyFields?: boolean }
   */
  async syncStoreFromProductVariants(storeId, options = {}) {
    const {
      selectedSkus = [],
      onlyInStock = false,
      maxUpdates = 0,
      updateOutOfStock = true,
      onlyMissingShopifyFields = false,
      onProgress = null,
      batchSize: optBatchSize,
      batchDelayMs: optBatchDelayMs
    } = options;

    const store = await Store.findById(storeId);
    if (!store) throw new Error('Store not found');

    // Helper: in-place Fisher-Yates shuffle
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // Load variants to sync
    const query = {};
    // If requested, limit to variants that are missing Shopify identifiers (variantId or inventoryItemId)
    if (onlyMissingShopifyFields) {
      query.$or = [
        { shopifyVariantId: { $in: [null, ''] } },
        { shopifyInventoryItemId: { $in: [null, ''] } }
      ];
    }
    if (selectedSkus.length > 0) {
      query.variantSku = { $in: selectedSkus.map(s => s && s.toString().trim()).filter(Boolean) };
    }
    // Stock filtering is disabled for now: ignore onlyInStock

    // Always stream in batches to avoid OOM and remove any artificial syncing limits
    {
      const batchSize = Number(optBatchSize || process.env.INVENTORY_BATCH_SIZE || 1000);
      const batchDelayMs = Number(optBatchDelayMs || process.env.INVENTORY_BATCH_DELAY_MS || 300);
      let lastId = null;
      let total = 0;
      let countToUpdate = 0;
      let skipped = 0;
      // Pre-compute total matching documents for progress visibility
      const totalToScan = await ProductVariant.countDocuments(query);

      while (true) {
        const batchQuery = { ...query };
        if (lastId) {
          batchQuery._id = { $gt: lastId };
        }
        const batch = await ProductVariant.find(batchQuery)
          .sort({ _id: 1 })
          .limit(batchSize)
          .lean(false); // want mongoose docs for saving

        if (!batch || batch.length === 0) break;

        // Resolve missing Shopify fields for this batch
        let needsShopifyLookup = batch.filter(v => !v.shopifyVariantId || !v.shopifyInventoryItemId || v.lastKnownShopifyQty == null);
        // Randomize order for lookup
        if (needsShopifyLookup.length > 1) shuffle(needsShopifyLookup);


        if (needsShopifyLookup.length > 0) {
          await this.resolveMissingShopifyFields(storeId, needsShopifyLookup);
        }

        // Count updatable ones for this batch
        let toUpdateBatch = batch.filter(pv => pv.shopifyVariantId && pv.shopifyInventoryItemId);
        if (!updateOutOfStock) {
          toUpdateBatch = toUpdateBatch.filter(pv => Number(pv.stockQty || 0) !== 0);
        }

        total += batch.length;
        countToUpdate += toUpdateBatch.length;
        skipped += Math.max(0, batch.length - toUpdateBatch.length);

        lastId = batch[batch.length - 1]._id;

        // Real-time progress callback and logs
        if (typeof onProgress === 'function') {
          try {
            await onProgress({ processed: total, resolved: countToUpdate, skipped, total: totalToScan });
          } catch (cbErr) {
            logger.warn(`onProgress callback failed: ${cbErr.message}`);
          }
        }

        // brief pause between batches to avoid hitting hard limits
        await new Promise(res => setTimeout(res, batchDelayMs));
      }

      return {
        total,
        countToUpdate,
        skipped,
        toUpdate: [] // intentionally empty to avoid huge payloads in large runs
      };
    }
  }
  
  /**
   * Helper: Resolve and update missing Shopify fields (shopifyVariantId, shopifyInventoryItemId, lastKnownShopifyQty)
   * for the provided ProductVariant mongoose docs by fetching productVariants by SKUs in batches.
   */
  async resolveMissingShopifyFields(storeId, variantDocs = []) {
    try {
      const lookupSkus = [...new Set(
        (variantDocs || [])
          .map(v => String(v.variantSku || '').trim())
          .filter(Boolean)
      )];
      if (lookupSkus.length === 0) return;
      // Small helper to throttle between batches
      const sleep = (ms) => new Promise(res => setTimeout(res, ms));

      // Process SKUs in batches to avoid giant maps and respect Shopify rate limits
      const skuBatchSize = 500; // each batch will be further chunked inside shopifyService
      for (let i = 0; i < lookupSkus.length; i += skuBatchSize) {
        const batchSkus = lookupSkus.slice(i, i + skuBatchSize);

        const skuInfoMap = await shopifyService.getProductVariantsBySkus(storeId, batchSkus);

        // Apply updates for only the documents in this batch
        const batchSkuSet = new Set(batchSkus.map(s => String(s).toLowerCase()));
        const docsInBatch = variantDocs.filter(v => batchSkuSet.has(String(v.variantSku || '').toLowerCase()));

        for (const pv of docsInBatch) {
          const key = String(pv.variantSku || '').toLowerCase();
          const info = skuInfoMap.get(key);
          let changed = false;
          if (info) {
            if (!pv.shopifyVariantId && info.variantId) {
              pv.shopifyVariantId = info.variantId;
              changed = true;
            }
            // Store extra Shopify identifiers/labels for better mapping
            if (!pv.shopifyProductId && info.raw?.product?.id) {
              pv.shopifyProductId = info.raw.product.id;
              changed = true;
            }
            if (!pv.shopifyVariantTitle && info.raw?.title) {
              pv.shopifyVariantTitle = info.raw.title;
              changed = true;
            }
            // Try to set inventoryItemId; if missing, fallback by variantId
            if (!pv.shopifyInventoryItemId) {
              if (info.inventoryItemId) {
                pv.shopifyInventoryItemId = info.inventoryItemId;
                changed = true;
              } else if (info.variantId) {
                try {
                  const fallback = await shopifyService.getInventoryItemForVariant(storeId, info.variantId);
                  if (fallback?.inventoryItemId) {
                    pv.shopifyInventoryItemId = fallback.inventoryItemId;
                    changed = true;
                  }
                  if (pv.lastKnownShopifyQty == null && typeof fallback?.inventoryQuantity === 'number') {
                    pv.lastKnownShopifyQty = fallback.inventoryQuantity;
                    changed = true;
                  }
                } catch (fallbackErr) {
                  logger.warn(`Fallback inventory lookup failed for SKU ${pv.variantSku}: ${fallbackErr.message}`);
                }
              }
            }
            if (pv.lastKnownShopifyQty == null && typeof info.inventoryQuantity === 'number') {
              pv.lastKnownShopifyQty = info.inventoryQuantity;
              changed = true;
            }
          } else {
            logger.debug(`No Shopify match found for SKU '${pv.variantSku}' during field resolution`);
          }
          // If still missing required fields after lookup, mark as failed
          const missingRequired = (!pv.shopifyVariantId || !pv.shopifyInventoryItemId);
          if (missingRequired) {
            pv.lastSyncStatus = 'failed';
            pv.lastSyncError = 'MISSING_SHOPIFY_FIELDS';
            pv.lastSyncAt = new Date();
            changed = true;
            logger.warn(`[resolveMissingShopifyFields][missing]`, {
              sku: pv.variantSku,
              shopifyVariantId: pv.shopifyVariantId,
              shopifyInventoryItemId: pv.shopifyInventoryItemId
            });
          } else {
            // Fields resolved: ensure a valid enum value is set to pass validation
            if (pv.lastSyncStatus !== 'success') {
              pv.lastSyncStatus = 'success';
              pv.lastSyncError = null;
              pv.lastSyncAt = new Date();
              changed = true;
            }
          }
          if (changed) {
            await pv.save();
            logger.info(`[resolveMissingShopifyFields][updated]`, {
              sku: pv.variantSku,
              shopifyVariantId: pv.shopifyVariantId,
              shopifyInventoryItemId: pv.shopifyInventoryItemId,
              shopifyProductId: pv.shopifyProductId,
              shopifyVariantTitle: pv.shopifyVariantTitle,
              lastKnownShopifyQty: pv.lastKnownShopifyQty,
              status: pv.lastSyncStatus
            });
          }
        }

        // brief pause between batches to avoid hitting hard limits
        await sleep(300);
      }
    } catch (err) {
      logger.error('resolveMissingShopifyFields failed:', err);
      throw err;
    }
  }
  /**
   * Get comprehensive inventory overview
   */
  async getInventoryOverview() {
    try {
      const [stores, vendors, products, mappings] = await Promise.all([
        Store.find({}),
        Vendor.find({}),
        Product.find({}),
        ProductMapping.find({})
      ]);

      const connectedStores = stores.filter(store => store.connectionStatus === 'connected');
      const connectedVendors = vendors.filter(vendor => vendor.connectionStatus === 'connected');

      // Calculate inventory statistics
      const totalProducts = products.length;
      const totalVariants = products.reduce((sum, product) => sum + (product.variants?.length || 0), 0);
      
      const lowStockItems = products.filter(product => 
        product.variants?.some(variant => variant.inventory < 10)
      ).length;

      const outOfStockItems = products.filter(product => 
        product.variants?.some(variant => variant.inventory === 0)
      ).length;

      // Find discrepancies between store and vendor inventory
      const discrepancies = await this.findInventoryDiscrepancies();

      const lastSyncAt = products.reduce((latest, product) => {
        const productLastSync = product.lastSyncAt;
        return productLastSync && productLastSync > latest ? productLastSync : latest;
      }, null);

      return {
        totalProducts,
        totalVariants,
        lowStockItems,
        outOfStockItems,
        discrepancies: discrepancies.length,
        lastSyncAt,
        stores: {
          connected: connectedStores.length,
          total: stores.length
        },
        vendors: {
          connected: connectedVendors.length,
          total: vendors.length
        },
        mappings: {
          active: mappings.filter(m => m.isActive).length,
          total: mappings.length
        }
      };
    } catch (error) {
      logger.error('Error getting inventory overview:', error);
      throw error;
    }
  }

  /**
   * Get inventory for specific stores
   */
  async getStoreInventory(storeIds, options = {}) {
    try {
      const { page = 1, limit = 50 } = options;
      const skip = (page - 1) * limit;

      const query = storeIds?.length > 0 ? { storeId: { $in: storeIds } } : {};
      
      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('storeId', 'name shopDomain')
          .skip(skip)
          .limit(limit)
          .sort({ updatedAt: -1 }),
        Product.countDocuments(query)
      ]);

      return {
        inventory: products.map(product => this.formatInventoryItem(product)),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting store inventory:', error);
      throw error;
    }
  }

  /**
   * Get inventory for specific vendors
   */
  async getVendorInventory(vendorIds, options = {}) {
    try {
      const { page = 1, limit = 50 } = options;
      const skip = (page - 1) * limit;

      const query = vendorIds?.length > 0 ? { vendorId: { $in: vendorIds } } : {};
      
      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('vendorId', 'name apiUrl')
          .skip(skip)
          .limit(limit)
          .sort({ updatedAt: -1 }),
        Product.countDocuments(query)
      ]);

      return {
        inventory: products.map(product => this.formatInventoryItem(product)),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting vendor inventory:', error);
      throw error;
    }
  }

  /**
   * Get inventory for specific products
   */
  async getProductInventory(productIds) {
    try {
      const products = await Product.find({ _id: { $in: productIds } })
        .populate('storeId', 'name shopDomain')
        .populate('vendorId', 'name');

      const inventory = [];

      for (const product of products) {
        // Get mappings for this product
        const mappings = await ProductMapping.find({
          $or: [
            { shopifyProductId: product.shopifyProductId },
            { vendorSku: product.vendorSku }
          ]
        });

        inventory.push({
          ...this.formatInventoryItem(product),
          mappings: mappings.map(mapping => ({
            id: mapping._id,
            shopifyProductId: mapping.shopifyProductId,
            vendorSku: mapping.vendorSku,
            syncEnabled: mapping.syncSettings.enabled,
            lastSyncAt: mapping.lastSyncAt
          }))
        });
      }

      return inventory;
    } catch (error) {
      logger.error('Error getting product inventory:', error);
      throw error;
    }
  }

  /**
   * Find low stock items
   */
  async getLowStockItems(threshold = 10, options = {}) {
    try {
      const { page = 1, limit = 50 } = options;
      const skip = (page - 1) * limit;

      const query = {
        'variants.inventory': { $lt: threshold, $gte: 0 }
      };

      const [products, total] = await Promise.all([
        Product.find(query)
          .populate('storeId', 'name shopDomain')
          .populate('vendorId', 'name')
          .skip(skip)
          .limit(limit)
          .sort({ 'variants.inventory': 1 }),
        Product.countDocuments(query)
      ]);

      const lowStockItems = products.map(product => {
        const lowStockVariants = product.variants.filter(variant => 
          variant.inventory < threshold && variant.inventory >= 0
        );

        return {
          ...this.formatInventoryItem(product),
          lowStockVariants,
          minInventory: Math.min(...lowStockVariants.map(v => v.inventory))
        };
      });

      return {
        items: lowStockItems,
        threshold,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting low stock items:', error);
      throw error;
    }
  }

  /**
   * Find inventory discrepancies between stores and vendors
   */
  async findInventoryDiscrepancies(options = {}) {
    try {
      const { page = 1, limit = 50 } = options;
      const skip = (page - 1) * limit;

      const mappings = await ProductMapping.find({ isActive: true })
        .populate('storeId')
        .populate('vendorId')
        .skip(skip)
        .limit(limit);

      const discrepancies = [];

      for (const mapping of mappings) {
        try {
          // Get current inventory from both store and vendor
          const [storeProduct, vendorProduct] = await Promise.all([
            Product.findOne({ 
              storeId: mapping.storeId._id,
              shopifyProductId: mapping.shopifyProductId 
            }),
            Product.findOne({ 
              vendorId: mapping.vendorId._id,
              vendorSku: mapping.vendorSku 
            })
          ]);

          if (storeProduct && vendorProduct) {
            const storeInventory = this.getTotalInventory(storeProduct);
            const vendorInventory = this.getTotalInventory(vendorProduct);
            const variance = Math.abs(storeInventory - vendorInventory);
            const variancePercent = storeInventory > 0 ? (variance / storeInventory) * 100 : 100;

            if (variance > 0) {
              discrepancies.push({
                mappingId: mapping._id,
                shopifyProductId: mapping.shopifyProductId,
                vendorSku: mapping.vendorSku,
                storeName: mapping.storeId.name,
                vendorName: mapping.vendorId.name,
                storeInventory,
                vendorInventory,
                variance,
                variancePercent: Math.round(variancePercent * 100) / 100,
                lastChecked: new Date()
              });
            }
          }
        } catch (error) {
          logger.error(`Error checking discrepancy for mapping ${mapping._id}:`, error);
        }
      }

      const total = await ProductMapping.countDocuments({ isActive: true });

      return {
        discrepancies,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Error finding inventory discrepancies:', error);
      throw error;
    }
  }

  /**
   * Refresh inventory data from external sources
   */
  async refreshInventory(storeIds = [], vendorIds = [], force = false) {
    try {
      const refreshJobs = [];

      // Refresh store inventory
      for (const storeId of storeIds) {
        refreshJobs.push(this.refreshStoreInventory(storeId, force));
      }

      // Refresh vendor inventory
      for (const vendorId of vendorIds) {
        refreshJobs.push(this.refreshVendorInventory(vendorId, force));
      }

      const results = await Promise.allSettled(refreshJobs);
      
      const summary = {
        total: results.length,
        successful: results.filter(r => r.status === 'fulfilled').length,
        failed: results.filter(r => r.status === 'rejected').length,
        errors: results
          .filter(r => r.status === 'rejected')
          .map(r => r.reason.message)
      };

      return summary;
    } catch (error) {
      logger.error('Error refreshing inventory:', error);
      throw error;
    }
  }

  /**
   * Refresh inventory for a specific store
   */
  async refreshStoreInventory(storeId, force = false) {
    try {
      const store = await Store.findById(storeId);
      if (!store || store.connectionStatus !== 'connected') {
        throw new Error('Store not found or not connected');
      }

      // Check if refresh is needed (unless forced)
      if (!force && store.lastInventorySync && 
          Date.now() - store.lastInventorySync.getTime() < 300000) { // 5 minutes
        return { skipped: true, reason: 'Recent sync' };
      }

      const products = await shopifyService.getProducts(storeId);
      let updated = 0;

      for (const productEdge of products.edges) {
        const shopifyProduct = productEdge.node;
        
        await Product.findOneAndUpdate(
          { 
            storeId,
            shopifyProductId: shopifyProduct.id 
          },
          {
            title: shopifyProduct.title,
            handle: shopifyProduct.handle,
            status: shopifyProduct.status,
            variants: shopifyProduct.variants.edges.map(v => ({
              variantId: v.node.id,
              title: v.node.title,
              sku: v.node.sku,
              price: parseFloat(v.node.price),
              inventory: v.node.inventoryQuantity || 0
            })),
            lastSyncAt: new Date()
          },
          { upsert: true }
        );
        updated++;
      }

      // Update store sync timestamp
      await Store.findByIdAndUpdate(storeId, {
        lastInventorySync: new Date(),
        'syncStats.lastInventorySync': new Date()
      });

      return { updated };
    } catch (error) {
      logger.error('Error refreshing store inventory:', error);
      throw error;
    }
  }

  /**
   * Refresh inventory for a specific vendor
   */
  async refreshVendorInventory(vendorId, force = false) {
    try {
      const vendor = await Vendor.findById(vendorId);
      if (!vendor || vendor.connectionStatus !== 'connected') {
        throw new Error('Vendor not found or not connected');
      }

      // Check if refresh is needed (unless forced)
      if (!force && vendor.lastInventorySync && 
          Date.now() - vendor.lastInventorySync.getTime() < 300000) { // 5 minutes
        return { skipped: true, reason: 'Recent sync' };
      }

      const inventory = await noxaService.getInventory(vendorId);
      let updated = 0;

      for (const item of inventory) {
        const productData = noxaService.transformProductData(item);
        
        await Product.findOneAndUpdate(
          { 
            vendorId,
            vendorSku: item.sku 
          },
          {
            title: productData.title,
            description: productData.description,
            variants: [{
              sku: item.sku,
              price: productData.price,
              inventory: productData.inventory
            }],
            category: productData.category,
            lastSyncAt: new Date()
          },
          { upsert: true }
        );
        updated++;
      }

      // Update vendor sync timestamp
      await Vendor.findByIdAndUpdate(vendorId, {
        lastInventorySync: new Date(),
        'syncStats.lastInventorySync': new Date()
      });

      return { updated };
    } catch (error) {
      logger.error('Error refreshing vendor inventory:', error);
      throw error;
    }
  }

  /**
   * Format inventory item for API response
   */
  formatInventoryItem(product) {
    return {
      id: product._id,
      title: product.title,
      sku: product.vendorSku || product.variants?.[0]?.sku,
      totalInventory: this.getTotalInventory(product),
      variants: product.variants?.map(variant => ({
        id: variant.variantId || variant._id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        inventory: variant.inventory
      })) || [],
      store: product.storeId ? {
        id: product.storeId._id || product.storeId,
        name: product.storeId.name
      } : null,
      vendor: product.vendorId ? {
        id: product.vendorId._id || product.vendorId,
        name: product.vendorId.name
      } : null,
      lastSyncAt: product.lastSyncAt,
      syncStatus: product.syncStatus
    };
  }

  /**
   * Calculate total inventory for a product
   */
  getTotalInventory(product) {
    if (!product.variants || product.variants.length === 0) {
      return 0;
    }
    
    return product.variants.reduce((total, variant) => {
      return total + (variant.inventory || 0);
    }, 0);
  }
}

module.exports = new InventoryService();
