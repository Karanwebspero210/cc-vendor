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
   * Options: { selectedSkus?: string[], onlyInStock?: boolean, maxUpdates?: number, updateOutOfStock?: boolean }
   */
  async syncStoreFromProductVariants(storeId, options = {}) {
    const {
      selectedSkus = [],
      onlyInStock = false,
      maxUpdates = 0,
      updateOutOfStock = true
    } = options;

    const store = await Store.findById(storeId);
    if (!store) throw new Error('Store not found');

    // Resolve and cache primary location
    const locationId = await shopifyService.getPrimaryLocationId(storeId);

    // Load variants to sync
    const query = {};
    if (selectedSkus.length > 0) {
      query.variantSku = { $in: selectedSkus.map(s => s.toUpperCase()) };
    }
    if (onlyInStock) {
      query.stockQty = { $gt: 0 };
    }

    const variants = await ProductVariant.find(query).lean(false); // want mongoose docs for saving

    // Build Shopify SKU map by paging products
    const skuMap = new Map(); // key: lowercased SKU, value: { variantId, inventoryItemId }
    let hasNext = true;
    let cursor = undefined;
    while (hasNext) {
      const products = await shopifyService.getProducts(storeId, { limit: 50, cursor });
      for (const edge of products.edges || []) {
        const productNode = edge.node;
        for (const vEdge of (productNode.variants?.edges || [])) {
          const v = vEdge.node;
          if (v.sku) {
            const key = String(v.sku).toLowerCase();
            skuMap.set(key, {
              variantId: v.id,
              inventoryItemId: v.inventoryItem?.id
            });
          }
        }
      }
      hasNext = products.pageInfo?.hasNextPage;
      if (hasNext) {
        const last = products.edges[products.edges.length - 1];
        cursor = last?.cursor;
      }
    }

    // Resolve/cache IDs and prepare list to update
    const toUpdate = [];
    for (const pv of variants) {
      // Ensure Shopify IDs cached
      if (!pv.shopifyVariantId || !pv.shopifyInventoryItemId) {
        const match = skuMap.get(String(pv.variantSku).toLowerCase());
        if (match && match.variantId && match.inventoryItemId) {
          pv.shopifyVariantId = match.variantId;
          pv.shopifyInventoryItemId = match.inventoryItemId;
          await pv.save();
        } else {
          pv.lastSyncStatus = 'failed';
          pv.lastSyncError = 'UNMATCHED_SKU';
          pv.lastSyncAt = new Date();
          await pv.save();
          continue;
        }
      }

      // Filter out zero stock if not updating out of stock
      const targetQty = Number(pv.stockQty || 0);
      if (!updateOutOfStock && targetQty === 0) {
        continue;
      }

      toUpdate.push(pv);
      if (maxUpdates > 0 && toUpdate.length >= maxUpdates) break;
    }

    if (toUpdate.length === 0) {
      return { updated: 0, total: variants.length, skipped: variants.length };
    }

    // Fetch current inventory levels for all items
    const inventoryItemIds = toUpdate.map(pv => pv.shopifyInventoryItemId);
    const levels = await shopifyService.getInventoryLevels(storeId, inventoryItemIds);
    const currentMap = new Map(); // inventoryItemId -> available at our location
    for (const item of levels || []) {
      const invItemId = item.id;
      let availableAtLoc = 0;
      for (const lvlEdge of (item.inventoryLevels?.edges || [])) {
        const lvl = lvlEdge.node;
        if (lvl.location?.id === locationId) {
          availableAtLoc = Number(lvl.available || 0);
          break;
        }
      }
      currentMap.set(invItemId, availableAtLoc);
    }

    // Perform updates sequentially to be safe with rate limits
    let updated = 0, failed = 0, skipped = 0;
    const itemLogs = [];
    for (const pv of toUpdate) {
      const invItemId = pv.shopifyInventoryItemId;
      const fromQty = currentMap.get(invItemId) ?? 0;
      const toQty = Number(pv.stockQty || 0);
      const delta = toQty - fromQty;

      if (delta === 0) {
        skipped++;
        continue;
      }
      try {
        await shopifyService.updateInventory(storeId, invItemId, delta, locationId);
        pv.lastKnownShopifyQty = toQty;
        pv.lastSyncAt = new Date();
        pv.lastSyncStatus = 'success';
        pv.lastSyncError = null;
        await pv.save();
        updated++;
        itemLogs.push({ sku: pv.variantSku, inventoryItemId: invItemId, fromQty, toQty, delta, status: 'success' });
      } catch (err) {
        failed++;
        pv.lastSyncAt = new Date();
        pv.lastSyncStatus = 'failed';
        pv.lastSyncError = err?.message || 'UPDATE_FAILED';
        await pv.save();
        logger.error(`Inventory update failed for SKU ${pv.variantSku}:`, err);
        itemLogs.push({ sku: pv.variantSku, inventoryItemId: invItemId, fromQty, toQty, delta, status: 'failed', error: err?.message });
      }
    }

    return {
      total: toUpdate.length,
      updated,
      failed,
      skipped,
      logs: itemLogs
    };
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
