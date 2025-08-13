# Enhanced Shopify GraphQL Integration Plan

## Shopify API Integration Requirements

### Latest Shopify GraphQL API (2024-01)
- Use Shopify Admin GraphQL API for all operations
- Implement proper GraphQL query optimization
- Handle rate limiting with exponential backoff
- Store location and inventory level IDs for direct updates

## Database Schema Updates

### Enhanced ProductMapping Model
```javascript
{
  _id: ObjectId,
  storeId: ObjectId,
  vendorId: ObjectId,
  vendorProductId: String,
  vendorVariantId: String,
  
  // Shopify Product Details
  shopifyProductId: String,
  shopifyVariantId: String,
  shopifyProductGid: String,      // NEW: GraphQL Global ID
  shopifyVariantGid: String,      // NEW: GraphQL Global ID
  
  // Shopify Inventory Details
  shopifyInventoryItemId: String, // NEW: Required for inventory updates
  shopifyInventoryItemGid: String,// NEW: GraphQL Global ID
  
  // Location-specific inventory
  inventoryLevels: [{             // NEW: Store inventory per location
    locationId: String,
    locationGid: String,          // GraphQL Global ID
    locationName: String,
    inventoryLevelId: String,     // Required for direct updates
    available: Number,
    committed: Number,
    incoming: Number,
    onHand: Number
  }],
  
  // SKU Information
  vendorSku: String,
  shopifySku: String,
  
  // Mapping Status
  isActive: Boolean,
  lastSynced: Date,
  syncStatus: String,             // NEW: "synced" | "pending" | "error"
  lastError: String,              // NEW: Store last sync error
  
  createdAt: Date,
  updatedAt: Date
}
```

### Enhanced Store Model
```javascript
{
  _id: ObjectId,
  name: String,
  shopifyDomain: String,
  accessToken: String,            // Encrypted
  
  // Store Details
  shopifyStoreId: String,
  shopifyStoreGid: String,        // NEW: GraphQL Global ID
  
  // Locations
  locations: [{                   // NEW: Store all locations
    locationId: String,
    locationGid: String,          // GraphQL Global ID
    name: String,
    isActive: Boolean,
    fulfillsOnlineOrders: Boolean,
    address: {
      address1: String,
      city: String,
      country: String,
      province: String,
      zip: String
    }
  }],
  
  // API Configuration
  apiVersion: String,             // NEW: Track API version
  graphqlEndpoint: String,        // NEW: GraphQL endpoint
  webhookEndpoint: String,        // NEW: For real-time updates
  
  // Store Status
  isActive: Boolean,
  lastSync: Date,
  productCount: Number,
  variantCount: Number,
  
  createdAt: Date,
  updatedAt: Date
}
```

## Shopify GraphQL Queries

### 1. Fetch Store Information and Locations
```graphql
query getStoreInfo {
  shop {
    id
    name
    myshopifyDomain
    plan {
      displayName
    }
  }
  locations(first: 50) {
    edges {
      node {
        id
        name
        isActive
        fulfillsOnlineOrders
        address {
          address1
          city
          country
          province
          zip
        }
      }
    }
  }
}
```

### 2. Fetch Products with Inventory Information
```graphql
query getProductsWithInventory($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      node {
        id
        handle
        title
        status
        variants(first: 100) {
          edges {
            node {
              id
              sku
              title
              price
              inventoryItem {
                id
                tracked
                requiresShipping
                inventoryLevels(first: 10) {
                  edges {
                    node {
                      id
                      available
                      committed
                      incoming
                      onHand
                      location {
                        id
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### 3. Update Inventory Levels
```graphql
mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup {
      id
      reason
      referenceDocumentUri
      changes {
        name
        delta
        quantityAfterChange
        item {
          id
          sku
        }
        location {
          id
          name
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

### 4. Bulk Inventory Update
```graphql
mutation inventoryBulkAdjustQuantityAtLocation($inventoryItemAdjustments: [InventoryAdjustItemInput!]!, $locationId: ID!) {
  inventoryBulkAdjustQuantityAtLocation(
    inventoryItemAdjustments: $inventoryItemAdjustments
    locationId: $locationId
  ) {
    inventoryLevels {
      id
      available
      item {
        id
        sku
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

## Enhanced Shopify Service

### shopify.service.js
```javascript
const { GraphQLClient } = require('graphql-request');

class ShopifyService {
  constructor(store) {
    this.store = store;
    this.client = new GraphQLClient(
      `https://${store.shopifyDomain}/admin/api/2024-01/graphql.json`,
      {
        headers: {
          'X-Shopify-Access-Token': decrypt(store.accessToken),
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // Initialize store data with locations and inventory
  async initializeStore() {
    try {
      const storeInfo = await this.getStoreInfo();
      const locations = await this.getLocations();
      
      // Update store with locations
      await Store.findByIdAndUpdate(this.store._id, {
        shopifyStoreId: storeInfo.shop.id,
        shopifyStoreGid: storeInfo.shop.id,
        locations: locations.map(loc => ({
          locationId: loc.id,
          locationGid: loc.id,
          name: loc.name,
          isActive: loc.isActive,
          fulfillsOnlineOrders: loc.fulfillsOnlineOrders,
          address: loc.address
        })),
        apiVersion: '2024-01',
        graphqlEndpoint: `https://${this.store.shopifyDomain}/admin/api/2024-01/graphql.json`
      });

      return { success: true, locations: locations.length };
    } catch (error) {
      throw new Error(`Store initialization failed: ${error.message}`);
    }
  }

  // Fetch products with complete inventory information
  async fetchProductsWithInventory(cursor = null, limit = 50) {
    const query = `
      query getProductsWithInventory($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              handle
              title
              status
              variants(first: 100) {
                edges {
                  node {
                    id
                    sku
                    title
                    price
                    inventoryItem {
                      id
                      tracked
                      requiresShipping
                      inventoryLevels(first: 10) {
                        edges {
                          node {
                            id
                            available
                            committed
                            incoming
                            onHand
                            location {
                              id
                              name
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    try {
      const variables = { first: limit, after: cursor };
      const response = await this.executeWithRetry(query, variables);
      
      return {
        products: response.products.edges.map(edge => edge.node),
        hasNextPage: response.products.pageInfo.hasNextPage,
        endCursor: response.products.pageInfo.endCursor
      };
    } catch (error) {
      throw new Error(`Failed to fetch products: ${error.message}`);
    }
  }

  // Update single variant inventory
  async updateVariantInventory(variantMapping, newQuantity, locationId = null) {
    // Use the primary location if none specified
    const targetLocationId = locationId || this.store.locations[0]?.locationId;
    
    if (!targetLocationId) {
      throw new Error('No location available for inventory update');
    }

    const inventoryLevel = variantMapping.inventoryLevels.find(
      level => level.locationId === targetLocationId
    );

    if (!inventoryLevel) {
      throw new Error(`Inventory level not found for location ${targetLocationId}`);
    }

    const currentQuantity = inventoryLevel.available;
    const delta = newQuantity - currentQuantity;

    if (delta === 0) {
      return { success: true, message: 'No update needed', delta: 0 };
    }

    const mutation = `
      mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          inventoryAdjustmentGroup {
            id
            reason
            changes {
              name
              delta
              quantityAfterChange
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        reason: "correction",
        name: "Vendor inventory sync",
        changes: [{
          inventoryItemId: variantMapping.shopifyInventoryItemGid,
          locationId: targetLocationId,
          delta: delta
        }]
      }
    };

    try {
      const response = await this.executeWithRetry(mutation, variables);
      
      if (response.inventoryAdjustQuantities.userErrors.length > 0) {
        throw new Error(response.inventoryAdjustQuantities.userErrors[0].message);
      }

      // Update local mapping with new quantity
      await ProductMapping.findByIdAndUpdate(variantMapping._id, {
        'inventoryLevels.$.available': newQuantity,
        lastSynced: new Date(),
        syncStatus: 'synced',
        lastError: null
      });

      return {
        success: true,
        delta: delta,
        newQuantity: newQuantity,
        adjustmentGroupId: response.inventoryAdjustmentGroup?.id
      };
    } catch (error) {
      // Update mapping with error status
      await ProductMapping.findByIdAndUpdate(variantMapping._id, {
        syncStatus: 'error',
        lastError: error.message
      });
      
      throw error;
    }
  }

  // Bulk update multiple variants
  async bulkUpdateInventory(variantMappings, locationId = null) {
    const targetLocationId = locationId || this.store.locations[0]?.locationId;
    
    if (!targetLocationId) {
      throw new Error('No location available for bulk inventory update');
    }

    const adjustments = variantMappings
      .map(mapping => {
        const inventoryLevel = mapping.inventoryLevels.find(
          level => level.locationId === targetLocationId
        );
        
        if (!inventoryLevel || !mapping.newQuantity) return null;
        
        const delta = mapping.newQuantity - inventoryLevel.available;
        if (delta === 0) return null;
        
        return {
          inventoryItemId: mapping.shopifyInventoryItemGid,
          availableDelta: delta
        };
      })
      .filter(Boolean);

    if (adjustments.length === 0) {
      return { success: true, message: 'No updates needed', updated: 0 };
    }

    const mutation = `
      mutation inventoryBulkAdjustQuantityAtLocation($inventoryItemAdjustments: [InventoryAdjustItemInput!]!, $locationId: ID!) {
        inventoryBulkAdjustQuantityAtLocation(
          inventoryItemAdjustments: $inventoryItemAdjustments
          locationId: $locationId
        ) {
          inventoryLevels {
            id
            available
            item {
              id
              sku
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      inventoryItemAdjustments: adjustments,
      locationId: targetLocationId
    };

    try {
      const response = await this.executeWithRetry(mutation, variables);
      
      if (response.inventoryBulkAdjustQuantityAtLocation.userErrors.length > 0) {
        throw new Error(response.inventoryBulkAdjustQuantityAtLocation.userErrors[0].message);
      }

      // Update local mappings
      const updatePromises = variantMappings.map(mapping => 
        ProductMapping.findByIdAndUpdate(mapping._id, {
          'inventoryLevels.$.available': mapping.newQuantity,
          lastSynced: new Date(),
          syncStatus: 'synced',
          lastError: null
        })
      );

      await Promise.all(updatePromises);

      return {
        success: true,
        updated: adjustments.length,
        inventoryLevels: response.inventoryBulkAdjustQuantityAtLocation.inventoryLevels
      };
    } catch (error) {
      // Update mappings with error status
      const errorPromises = variantMappings.map(mapping => 
        ProductMapping.findByIdAndUpdate(mapping._id, {
          syncStatus: 'error',
          lastError: error.message
        })
      );

      await Promise.all(errorPromises);
      throw error;
    }
  }

  // Execute GraphQL with retry logic
  async executeWithRetry(query, variables = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.request(query, variables);
        return response;
      } catch (error) {
        lastError = error;
        
        // Check if it's a rate limit error
        if (error.response?.status === 429 || error.message.includes('rate limit')) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Check if it's a temporary error
        if (error.response?.status >= 500) {
          const delay = Math.pow(2, attempt) * 1000;
          console.log(`Server error, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // If it's not a retryable error, throw immediately
        throw error;
      }
    }
    
    throw new Error(`GraphQL request failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  // Get store information
  async getStoreInfo() {
    const query = `
      query getStoreInfo {
        shop {
          id
          name
          myshopifyDomain
          plan {
            displayName
          }
        }
      }
    `;
    
    const response = await this.executeWithRetry(query);
    return response;
  }

  // Get store locations
  async getLocations() {
    const query = `
      query getLocations {
        locations(first: 50) {
          edges {
            node {
              id
              name
              isActive
              fulfillsOnlineOrders
              address {
                address1
                city
                country
                province
                zip
              }
            }
          }
        }
      }
    `;
    
    const response = await this.executeWithRetry(query);
    return response.locations.edges.map(edge => edge.node);
  }
}

module.exports = ShopifyService;
```

## Error Handling & Retry Strategy

### Enhanced Error Handling Service
```javascript
class ErrorHandlingService {
  static async handleSyncError(error, context = {}) {
    const errorLog = {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack,
      context: context,
      timestamp: new Date(),
      severity: this.determineSeverity(error)
    };

    // Log error
    logger.error('Sync Error:', errorLog);

    // Determine if retry is possible
    const shouldRetry = this.shouldRetry(error);
    
    // Update sync log with error
    if (context.syncId) {
      await SyncLog.findByIdAndUpdate(context.syncId, {
        $push: {
          errors: {
            productId: context.productId,
            sku: context.sku,
            error: error.message,
            retryCount: context.retryCount || 0,
            nextRetry: shouldRetry ? this.calculateNextRetry(context.retryCount || 0) : null
          }
        }
      });
    }

    return {
      shouldRetry,
      nextRetryDelay: shouldRetry ? this.calculateRetryDelay(context.retryCount || 0) : null,
      errorLog
    };
  }

  static shouldRetry(error) {
    // Rate limit errors
    if (error.message.includes('rate limit') || error.response?.status === 429) {
      return true;
    }
    
    // Server errors
    if (error.response?.status >= 500) {
      return true;
    }
    
    // Network errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
    
    // GraphQL errors that are retryable
    if (error.message.includes('timeout') || error.message.includes('connection')) {
      return true;
    }
    
    return false;
  }

  static calculateRetryDelay(retryCount) {
    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 300000; // 5 minutes
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    const jitter = Math.random() * 0.1 * delay; // 10% jitter
    return delay + jitter;
  }

  static calculateNextRetry(retryCount) {
    const delay = this.calculateRetryDelay(retryCount);
    return new Date(Date.now() + delay);
  }

  static determineSeverity(error) {
    if (error.response?.status >= 500) return 'high';
    if (error.response?.status === 429) return 'medium';
    if (error.message.includes('rate limit')) return 'medium';
    return 'low';
  }
}

module.exports = ErrorHandlingService;
```

## Real-time Inventory Updates

### Webhook Integration for Real-time Updates
```javascript
class ShopifyWebhookService {
  // Set up webhooks for real-time inventory updates
  async setupInventoryWebhooks(store) {
    const webhooks = [
      {
        topic: 'inventory_levels/update',
        address: `${process.env.WEBHOOK_BASE_URL}/webhooks/shopify/inventory-update`,
        format: 'json'
      },
      {
        topic: 'inventory_items/update',
        address: `${process.env.WEBHOOK_BASE_URL}/webhooks/shopify/inventory-item-update`,
        format: 'json'
      }
    ];

    for (const webhook of webhooks) {
      await this.createWebhook(store, webhook);
    }
  }

  // Handle inventory level updates from Shopify
  async handleInventoryLevelUpdate(webhookData) {
    const { inventory_item_id, location_id, available } = webhookData;
    
    try {
      // Find the mapping for this inventory item
      const mapping = await ProductMapping.findOne({
        shopifyInventoryItemId: inventory_item_id,
        'inventoryLevels.locationId': location_id
      });

      if (mapping) {
        // Update the local inventory level
        await ProductMapping.updateOne(
          { 
            _id: mapping._id,
            'inventoryLevels.locationId': location_id 
          },
          { 
            $set: { 
              'inventoryLevels.$.available': available,
              'inventoryLevels.$.onHand': webhookData.on_hand || available
            } 
          }
        );

        // Emit real-time update to frontend
        socketService.emitInventoryUpdate({
          mappingId: mapping._id,
          sku: mapping.shopifySku,
          locationId: location_id,
          available: available
        });
      }
    } catch (error) {
      logger.error('Webhook inventory update failed:', error);
    }
  }
}
```

This enhanced plan now includes:

1. **Complete Shopify GraphQL Integration** with latest API version
2. **Proper Storage** of location and inventory IDs for direct updates
3. **Robust Error Handling** with retry mechanisms
4. **Real-time Updates** through webhooks
5. **Bulk Operations** for efficient inventory management
6. **Exponential Backoff** for rate limiting
7. **Comprehensive Logging** for debugging and monitoring
