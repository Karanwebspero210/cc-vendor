# Technical Specifications - Couture Candy Vendor App

## System Architecture Overview

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend │    │   Node.js API   │    │   MongoDB       │
│   (Port 3000)   │◄──►│   (Port 5000)   │◄──►│   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   External APIs │
                    │   - Shopify     │
                    │   - Noxa Vendor │
                    └─────────────────┘
```

## Detailed API Specifications

### Authentication API

#### POST /api/auth/login
**Purpose**: Admin login with password
```json
// Request
{
  "password": "admin_password"
}

// Response (Success)
{
  "success": true,
  "message": "Login successful",
  "user": {
    "role": "admin",
    "sessionId": "session_id"
  }
}

// Response (Error)
{
  "success": false,
  "message": "Invalid password"
}
```

#### GET /api/auth/verify
**Purpose**: Verify current session
```json
// Response
{
  "authenticated": true,
  "user": {
    "role": "admin",
    "sessionId": "session_id"
  }
}
```

### Store Management API

#### GET /api/stores
**Purpose**: List all connected Shopify stores
```json
// Response
{
  "success": true,
  "stores": [
    {
      "_id": "store_id",
      "name": "Store Name",
      "shopifyDomain": "store.myshopify.com",
      "isActive": true,
      "productCount": 150,
      "lastSync": "2024-01-15T10:30:00Z",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### POST /api/stores
**Purpose**: Connect new Shopify store
```json
// Request
{
  "name": "Store Name",
  "shopifyDomain": "store.myshopify.com",
  "accessToken": "shpat_xxxxxxxxxxxxx"
}

// Response
{
  "success": true,
  "message": "Store connected successfully",
  "store": {
    "_id": "new_store_id",
    "name": "Store Name",
    "shopifyDomain": "store.myshopify.com",
    "isActive": true
  }
}
```

### Vendor Management API

#### GET /api/vendors
**Purpose**: List all configured vendors
```json
// Response
{
  "success": true,
  "vendors": [
    {
      "_id": "vendor_id",
      "name": "Noxa",
      "apiEndpoint": "https://api.noxa.com",
      "isActive": true,
      "productCount": 500,
      "lastSync": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### POST /api/vendors
**Purpose**: Add new vendor configuration
```json
// Request
{
  "name": "Vendor Name",
  "apiEndpoint": "https://api.vendor.com",
  "accessToken": "vendor_access_token"
}

// Response
{
  "success": true,
  "message": "Vendor added successfully",
  "vendor": {
    "_id": "new_vendor_id",
    "name": "Vendor Name",
    "isActive": true
  }
}
```

### Product Mapping API

#### GET /api/mappings
**Purpose**: List product mappings with filtering
```json
// Query Parameters: ?storeId=xxx&vendorId=xxx&page=1&limit=50

// Response
{
  "success": true,
  "mappings": [
    {
      "_id": "mapping_id",
      "storeId": "store_id",
      "vendorId": "vendor_id",
      "vendorSku": "E467W",
      "shopifySku": "noxa_E467W-White-2-CCSALE",
      "vendorProductName": "Product Name",
      "shopifyProductName": "Shopify Product Name",
      "vendorInventory": 50,
      "shopifyInventory": 45,
      "lastSynced": "2024-01-15T10:30:00Z",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "pages": 3
  }
}
```

#### POST /api/mappings/bulk
**Purpose**: Create multiple mappings at once
```json
// Request
{
  "storeId": "store_id",
  "vendorId": "vendor_id",
  "mappings": [
    {
      "vendorProductId": "vendor_product_1",
      "vendorVariantId": "vendor_variant_1",
      "shopifyProductId": "shopify_product_1",
      "shopifyVariantId": "shopify_variant_1",
      "vendorSku": "E467W",
      "shopifySku": "noxa_E467W-White-2-CCSALE"
    }
  ]
}

// Response
{
  "success": true,
  "message": "Bulk mappings created",
  "created": 25,
  "failed": 2,
  "errors": [
    {
      "sku": "E467W",
      "error": "Shopify variant not found"
    }
  ]
}
```

### Inventory Sync API

#### POST /api/sync/manual
**Purpose**: Start manual inventory sync for selected products
```json
// Request
{
  "storeId": "store_id",
  "vendorId": "vendor_id",
  "products": [
    {
      "vendorProductId": "vendor_product_1",
      "variants": ["variant_1", "variant_2"] // Optional: specific variants
    },
    {
      "vendorProductId": "vendor_product_2"
      // If no variants specified, sync all variants
    }
  ],
  "skus": ["E467W", "6015"], // Alternative: select by SKUs
  "options": {
    "dryRun": false,
    "updateThreshold": 5, // Only update if difference > 5
    "priority": "high" // high, normal, low
  }
}

// Response
{
  "success": true,
  "syncId": "sync_operation_id",
  "jobId": "job_12345",
  "message": "Sync job created",
  "estimatedDuration": "5 minutes",
  "queuePosition": 1
}
```

#### POST /api/sync/batch
**Purpose**: Create batch sync job for multiple products
```json
// Request
{
  "storeId": "store_id",
  "vendorId": "vendor_id",
  "batchType": "selected_products", // all_products, selected_products, by_category
  "products": [
    {
      "vendorProductId": "vendor_product_1",
      "priority": "high"
    }
  ],
  "filters": {
    "category": "clothing",
    "lastSyncBefore": "2024-01-01T00:00:00Z",
    "inventoryDifference": 10
  },
  "options": {
    "batchSize": 50,
    "delayBetweenBatches": 1000, // ms
    "retryFailedItems": true
  }
}

// Response
{
  "success": true,
  "batchId": "batch_operation_id",
  "totalProducts": 150,
  "estimatedBatches": 3,
  "estimatedDuration": "15 minutes"
}
```

#### GET /api/sync/status/:syncId
**Purpose**: Get real-time sync status
```json
// Response
{
  "success": true,
  "sync": {
    "_id": "sync_operation_id",
    "type": "manual", // manual, batch, automated
    "status": "running", // pending, running, completed, failed, paused
    "progress": {
      "total": 100,
      "processed": 45,
      "successful": 40,
      "failed": 5,
      "skipped": 0,
      "percentage": 45
    },
    "currentProduct": {
      "vendorProductId": "product_123",
      "sku": "E467W",
      "name": "Product Name"
    },
    "startTime": "2024-01-15T10:30:00Z",
    "estimatedCompletion": "2024-01-15T10:35:00Z",
    "errors": [
      {
        "productId": "product_123",
        "sku": "E467W",
        "error": "API rate limit exceeded",
        "retryCount": 2,
        "nextRetry": "2024-01-15T10:32:00Z"
      }
    ]
  }
}
```

#### POST /api/sync/control/:syncId
**Purpose**: Control running sync operations
```json
// Request
{
  "action": "pause" // pause, resume, cancel, retry_failed
}

// Response
{
  "success": true,
  "message": "Sync operation paused",
  "newStatus": "paused"
}
```

### Cron Job Management API

#### GET /api/cron/schedules
**Purpose**: List all scheduled cron jobs
```json
// Response
{
  "success": true,
  "schedules": [
    {
      "_id": "schedule_id",
      "name": "Daily Inventory Sync",
      "cronExpression": "0 2 * * *", // Every day at 2 AM
      "storeId": "store_id",
      "vendorId": "vendor_id",
      "isActive": true,
      "lastRun": "2024-01-15T02:00:00Z",
      "nextRun": "2024-01-16T02:00:00Z",
      "successCount": 25,
      "failureCount": 2,
      "options": {
        "syncType": "all_products",
        "updateThreshold": 5,
        "notifyOnFailure": true
      }
    }
  ]
}
```

#### POST /api/cron/schedules
**Purpose**: Create new cron schedule
```json
// Request
{
  "name": "Hourly High Priority Sync",
  "cronExpression": "0 * * * *", // Every hour
  "storeId": "store_id",
  "vendorId": "vendor_id",
  "syncConfig": {
    "type": "filtered", // all_products, filtered, selected_products
    "filters": {
      "priority": "high",
      "category": "clothing",
      "minInventoryDifference": 10
    },
    "products": ["product_1", "product_2"], // For selected_products type
    "options": {
      "updateThreshold": 5,
      "batchSize": 25,
      "retryFailedItems": true,
      "maxRetries": 3
    }
  },
  "notifications": {
    "onSuccess": false,
    "onFailure": true,
    "onPartialFailure": true
  }
}

// Response
{
  "success": true,
  "schedule": {
    "_id": "new_schedule_id",
    "name": "Hourly High Priority Sync",
    "nextRun": "2024-01-15T11:00:00Z"
  }
}
```

#### PUT /api/cron/schedules/:id
**Purpose**: Update existing cron schedule
```json
// Request
{
  "cronExpression": "0 */2 * * *", // Every 2 hours
  "isActive": true,
  "syncConfig": {
    "options": {
      "updateThreshold": 10
    }
  }
}

// Response
{
  "success": true,
  "message": "Schedule updated",
  "nextRun": "2024-01-15T12:00:00Z"
}
```

#### POST /api/cron/schedules/:id/run
**Purpose**: Manually trigger a scheduled job
```json
// Response
{
  "success": true,
  "syncId": "sync_operation_id",
  "message": "Scheduled job triggered manually"
}
```

#### DELETE /api/cron/schedules/:id
**Purpose**: Delete cron schedule
```json
// Response
{
  "success": true,
  "message": "Schedule deleted"
}
```

## SKU Pattern Recognition Algorithm

### Pattern Analysis
```javascript
// SKU Pattern Examples:
// Main Product: E467W, 6015
// Shopify Variants: 
//   - noxa_E467W-White-2-CCSALE
//   - noxa_6015-NUDE-XS
//   - noxa_6015-TAN-S

// Pattern Recognition Function
function parseShopifySku(sku) {
  const patterns = [
    /^noxa_([A-Z0-9]+)-([A-Z]+)-([A-Z0-9]+)(?:-[A-Z]+)?$/,
    /^([A-Z0-9]+)-([A-Z]+)-([A-Z0-9]+)$/,
    /^([A-Z0-9]+)$/
  ];
  
  for (const pattern of patterns) {
    const match = sku.match(pattern);
    if (match) {
      return {
        mainSku: match[1],
        color: match[2] || null,
        size: match[3] || null,
        prefix: sku.startsWith('noxa_') ? 'noxa_' : null
      };
    }
  }
  
  return null;
}
```

### Mapping Algorithm
```javascript
function findVendorMatches(shopifyProducts, vendorProducts) {
  const mappingSuggestions = [];
  
  for (const shopifyProduct of shopifyProducts) {
    for (const variant of shopifyProduct.variants) {
      const parsed = parseShopifySku(variant.sku);
      if (parsed) {
        const vendorMatch = vendorProducts.find(vp => 
          vp.mainSku === parsed.mainSku
        );
        
        if (vendorMatch) {
          const vendorVariant = findBestVariantMatch(
            vendorMatch.variants, 
            parsed.color, 
            parsed.size
          );
          
          if (vendorVariant) {
            mappingSuggestions.push({
              shopifyProductId: shopifyProduct.id,
              shopifyVariantId: variant.id,
              vendorProductId: vendorMatch.id,
              vendorVariantId: vendorVariant.id,
              confidence: calculateConfidence(parsed, vendorVariant)
            });
          }
        }
      }
    }
  }
  
  return mappingSuggestions;
}
```

## Real-time Communication (Socket.io)

### Socket Events

#### Client → Server Events
```javascript
// Join sync room for updates
socket.emit('join-sync', { syncId: 'sync_operation_id' });

// Start manual sync
socket.emit('start-sync', {
  storeId: 'store_id',
  vendorId: 'vendor_id',
  skus: ['E467W']
});
```

#### Server → Client Events
```javascript
// Sync progress updates
socket.emit('sync:progress', {
  syncId: 'sync_operation_id',
  progress: {
    total: 100,
    processed: 45,
    percentage: 45
  }
});

// Sync completion
socket.emit('sync:complete', {
  syncId: 'sync_operation_id',
  results: {
    successful: 95,
    failed: 5,
    duration: '4m 32s'
  }
});

// Real-time inventory updates
socket.emit('inventory:updated', {
  sku: 'E467W',
  vendorInventory: 50,
  shopifyInventory: 50,
  lastUpdated: '2024-01-15T10:30:00Z'
});
```

## Database Optimization

### Indexing Strategy
```javascript
// MongoDB Indexes
db.products.createIndex({ "vendorId": 1, "mainSku": 1 });
db.products.createIndex({ "variants.sku": 1 });
db.productmappings.createIndex({ "storeId": 1, "vendorId": 1 });
db.productmappings.createIndex({ "vendorSku": 1 });
db.productmappings.createIndex({ "shopifySku": 1 });
db.synclogs.createIndex({ "createdAt": -1 });
db.synclogs.createIndex({ "status": 1, "createdAt": -1 });
```

### Query Optimization
```javascript
// Efficient mapping queries
const mappings = await ProductMapping.find({
  storeId: ObjectId(storeId),
  vendorId: ObjectId(vendorId),
  isActive: true
}).populate('vendorProduct shopifyProduct').lean();

// Bulk inventory updates
const bulkOps = mappings.map(mapping => ({
  updateOne: {
    filter: { _id: mapping.shopifyVariantId },
    update: { $set: { inventory_quantity: mapping.vendorInventory } }
  }
}));
```

## Security Implementation

### Token Encryption
```javascript
const crypto = require('crypto');

// Encrypt access tokens before storage
function encryptToken(token) {
  const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

// Decrypt tokens for API calls
function decryptToken(encryptedToken) {
  const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY);
  let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

// API rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

// Sync operation rate limiting
const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit sync operations
  message: 'Too many sync operations'
});
```

## Performance Monitoring

### Key Metrics
- API response times
- Sync operation duration
- Database query performance
- Memory usage
- Error rates
- Real-time connection count

### Monitoring Implementation
```javascript
// Performance middleware
const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} - ${duration}ms`);
    
    // Log slow queries
    if (duration > 1000) {
      logger.warn(`Slow request: ${req.method} ${req.path} - ${duration}ms`);
    }
  });
  
  next();
};
```

## Error Handling Strategy

### Error Categories
1. **API Errors**: External API failures (Shopify, Vendor)
2. **Database Errors**: Connection, query, validation errors
3. **Business Logic Errors**: Mapping conflicts, sync failures
4. **System Errors**: Memory, network, file system errors

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "SHOPIFY_API_ERROR",
    "message": "Failed to update inventory",
    "details": "Rate limit exceeded",
    "timestamp": "2024-01-15T10:30:00Z",
    "requestId": "req_12345"
  }
}
```

## Deployment Configuration

### Environment Variables
```bash
# Backend Environment
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb://localhost:27017/couture-candy-vendor
SESSION_SECRET=your-super-secret-session-key
ADMIN_PASSWORD=your-secure-admin-password
ENCRYPTION_KEY=your-encryption-key
SHOPIFY_API_VERSION=2024-01
LOG_LEVEL=info

# Frontend Environment
REACT_APP_API_URL=https://api.yourdomain.com
REACT_APP_SOCKET_URL=https://api.yourdomain.com
REACT_APP_VERSION=1.0.0
```

### Production Deployment
```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "5000:5000"
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
      
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
      
  mongodb:
    image: mongo:5.0
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
      
volumes:
  mongodb_data:
```
