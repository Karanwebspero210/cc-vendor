# Couture Candy Backend API

## Overview
Node.js backend API for managing inventory synchronization between vendor APIs (Noxa) and Shopify stores. This documentation provides comprehensive information about the API endpoints, request/response formats, and integration guidelines.

## Postman Collection

We provide a Postman collection for easy API testing and integration. The collection includes all available endpoints with example requests and responses.

### Importing the Collection

1. Download the `CoutureCandyVendorAPI.postman_collection.json` file from the project root
2. Open Postman
3. Click "Import" and select the downloaded file
4. Configure the following environment variables in Postman:
   - `base_url`: Your API base URL (e.g., `http://localhost:5000`)
   - `auth_token`: Will be automatically set after successful login

### Using the Collection

1. Start with the `Login` request to authenticate
2. The `auth_token` will be automatically captured and used for subsequent requests
3. Explore the available endpoints organized by functionality

## Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Express-session
- **Scheduling**: Node-cron
- **Real-time**: Socket.io
- **Security**: bcrypt, helmet, cors

## Installation & Setup

### Prerequisites
- Node.js (v16+)
- MongoDB (local installation)
- npm or yarn

### Environment Variables
Create a `.env` file in the backend root:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/couture-candy-vendor
SESSION_SECRET=your-super-secret-session-key
ADMIN_PASSWORD=your-admin-password
NODE_ENV=development
```

### Installation
```bash
cd backend
npm install
npm run dev
```

## API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication Endpoints
- `POST /auth/login` - Admin login
- `POST /auth/logout` - Admin logout
- `GET /auth/verify` - Verify session

## WebSocket Authentication

### JWT Authentication
WebSocket connections require JWT authentication. The client must send an `authenticate` event with a valid JWT token:

```javascript
// Client-side example
const socket = io('http://your-backend-url');

// Authenticate with JWT token
socket.emit('authenticate', { 
  token: 'your.jwt.token.here' 
});

// Handle authentication response
socket.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});

socket.on('authentication_error', (error) => {
  console.error('Authentication failed:', error);
});
```

### JWT Configuration
Add these to your `.env` file:

```env
# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret
JWT_EXPIRES_IN=24h  # Token expiration time (e.g., 24h, 7d)
```

### Protected Events
The following WebSocket events require authentication:
- `subscribe:all`
- `request:queue-stats`
- `admin:action`

### Error Responses

#### Authentication Required
```json
{
  "success": false,
  "message": "Authentication token is required",
  "code": "AUTH_TOKEN_REQUIRED",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### Invalid/Expired Token
```json
{
  "success": false,
  "message": "Token has expired",
  "code": "AUTH_FAILED",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Store Management
- `GET /stores` - List all connected Shopify stores
- `POST /stores` - Connect new Shopify store
- `PUT /stores/:id` - Update store configuration
- `DELETE /stores/:id` - Remove store connection
- `GET /stores/:id/products` - Fetch store products

### Vendor Management
- `GET /vendors` - List all configured vendors
- `POST /vendors` - Add new vendor API configuration
- `PUT /vendors/:id` - Update vendor configuration
- `DELETE /vendors/:id` - Remove vendor
- `GET /vendors/:id/products` - Fetch vendor products
- `POST /vendors/:id/sync` - Sync vendor product data

### Product Mapping
- `GET /mappings` - List product mappings
- `POST /mappings` - Create new mapping
- `PUT /mappings/:id` - Update mapping
- `DELETE /mappings/:id` - Remove mapping
- `POST /mappings/bulk` - Bulk create mappings

### Inventory Synchronization
- `POST /sync/manual` - Start manual inventory sync for selected products
- `POST /sync/batch` - Create batch sync job for multiple products
- `GET /sync/status/:id` - Get sync operation status
- `POST /sync/control/:id` - Control sync operations (pause/resume/cancel)
- `GET /sync/history` - Get sync history
- `GET /sync/queue` - View sync job queue

### Cron Job Management
- `GET /cron/schedules` - List all scheduled cron jobs
- `POST /cron/schedules` - Create new cron schedule
- `PUT /cron/schedules/:id` - Update cron schedule
- `DELETE /cron/schedules/:id` - Delete cron schedule
- `POST /cron/schedules/:id/run` - Manually trigger scheduled job

## Database Models

### Store Model
```javascript
{
  name: String,
  shopifyDomain: String,
  accessToken: String, // encrypted
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Vendor Model
```javascript
{
  name: String,
  apiEndpoint: String,
  accessToken: String, // encrypted
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Product Model
```javascript
{
  vendorId: ObjectId,
  vendorProductId: String,
  mainSku: String,
  name: String,
  variants: [{
    vendorVariantId: String,
    sku: String,
    color: String,
    size: String,
    inventory: Number,
    lastUpdated: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### ProductMapping Model
```javascript
{
  storeId: ObjectId,
  vendorId: ObjectId,
  vendorProductId: String,
  vendorVariantId: String,
  shopifyProductId: String,
  shopifyVariantId: String,
  vendorSku: String,
  shopifySku: String,
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### SyncLog Model
```javascript
{
  type: String, // "manual" | "batch" | "automated"
  storeId: ObjectId,
  vendorId: ObjectId,
  status: String, // "pending" | "running" | "completed" | "failed" | "paused"
  totalProducts: Number,
  processedProducts: Number,
  successCount: Number,
  errorCount: Number,
  skippedCount: Number,
  errors: [{
    productId: String,
    sku: String,
    error: String,
    retryCount: Number,
    nextRetry: Date
  }],
  currentProduct: {
    vendorProductId: String,
    sku: String,
    name: String
  },
  jobId: String,
  priority: String, // "high" | "normal" | "low"
  startTime: Date,
  endTime: Date,
  createdAt: Date
}
```

### SyncSchedule Model
```javascript
{
  name: String,
  cronExpression: String,
  storeId: ObjectId,
  vendorId: ObjectId,
  isActive: Boolean,
  lastRun: Date,
  nextRun: Date,
  successCount: Number,
  failureCount: Number,
  syncConfig: {
    type: String, // "all_products" | "filtered" | "selected_products"
    filters: {
      priority: String,
      category: String,
      minInventoryDifference: Number,
      lastSyncBefore: Date
    },
    products: [String], // For selected_products type
    options: {
      updateThreshold: Number,
      batchSize: Number,
      retryFailedItems: Boolean,
      maxRetries: Number
    }
  },
  notifications: {
    onSuccess: Boolean,
    onFailure: Boolean,
    onPartialFailure: Boolean
  },
  createdAt: Date,
  updatedAt: Date
}
```

### SyncJob Model
```javascript
{
  syncId: ObjectId,
  type: String, // "manual" | "batch" | "scheduled"
  status: String, // "queued" | "running" | "completed" | "failed" | "paused"
  priority: String, // "high" | "normal" | "low"
  storeId: ObjectId,
  vendorId: ObjectId,
  products: [{
    vendorProductId: String,
    variants: [String],
    status: String, // "pending" | "processing" | "completed" | "failed"
    retryCount: Number
  }],
  options: {
    updateThreshold: Number,
    dryRun: Boolean,
    batchSize: Number
  },
  queuePosition: Number,
  createdAt: Date,
  startedAt: Date,
  completedAt: Date
}
```

## Key Features

### Product Selection & Sync Control
- Single product selection for immediate sync
- Multiple product selection for batch processing
- SKU-based product filtering and selection
- Priority-based sync queue management
- Real-time sync operation control (pause/resume/cancel)

### Job Queue Management
- Background job processing with Bull Queue
- Priority-based job scheduling
- Job retry mechanisms with exponential backoff
- Real-time job progress tracking
- Queue monitoring and management

### SKU Pattern Recognition
The system handles various SKU patterns:
- Main product SKUs: `E467W`, `6015`
- Shopify variant SKUs: `noxa_E467W-White-2-CCSALE`
- Pattern extraction for color/size mapping
- Intelligent product matching algorithms

### Automated Scheduling
- Flexible cron job configuration with cron expressions
- Multiple schedule support per store/vendor combination
- Schedule management (create/update/delete/pause)
- Manual trigger for scheduled jobs
- Comprehensive scheduling history and analytics

### Batch Processing
- Configurable batch sizes for large sync operations
- Intelligent batching based on API rate limits
- Batch progress tracking and error handling
- Resumable batch operations

### Security
- Encrypted storage of API tokens
- Session-based authentication
- Input validation and sanitization
- Rate limiting protection
- Job queue security and isolation

## Development

### Running in Development
```bash
npm run dev
```

### Running Tests
```bash
npm test
```

### Code Structure
- `controllers/` - Request handlers
- `models/` - Database schemas
- `services/` - Business logic
- `middleware/` - Custom middleware
- `routes/` - API route definitions
- `jobs/` - Background job definitions
- `queues/` - Job queue management
- `schedulers/` - Cron job schedulers
- `utils/` - Helper functions

## Deployment
- Configure production environment variables
- Set up MongoDB connection
- Configure reverse proxy (nginx)
- Set up SSL certificates
- Configure monitoring and logging
