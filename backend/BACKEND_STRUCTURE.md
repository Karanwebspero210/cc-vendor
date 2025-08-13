# Enhanced Backend Structure

## Complete Folder Structure

```
backend/
├── src/
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── shopify.controller.js
│   │   ├── vendor.controller.js
│   │   ├── inventory.controller.js
│   │   ├── sync.controller.js
│   │   ├── cron.controller.js          # NEW: Cron job management
│   │   └── queue.controller.js         # NEW: Job queue management
│   ├── models/
│   │   ├── Store.js
│   │   ├── Vendor.js
│   │   ├── Product.js
│   │   ├── ProductMapping.js
│   │   ├── SyncLog.js
│   │   ├── SyncSchedule.js             # NEW: Cron schedule model
│   │   └── SyncJob.js                  # NEW: Job queue model
│   ├── services/
│   │   ├── shopify.service.js
│   │   ├── noxa.service.js
│   │   ├── inventory.service.js
│   │   ├── sync.service.js
│   │   ├── product-selector.service.js # NEW: Product selection logic
│   │   ├── batch.service.js            # NEW: Batch processing
│   │   └── scheduler.service.js        # NEW: Cron management
│   ├── jobs/
│   │   ├── sync-job.js                 # NEW: Individual sync job processor
│   │   ├── batch-sync-job.js           # NEW: Batch sync processor
│   │   └── scheduled-sync-job.js       # NEW: Scheduled sync processor
│   ├── queues/
│   │   ├── sync-queue.js               # NEW: Sync job queue setup
│   │   ├── queue-manager.js            # NEW: Queue management utilities
│   │   └── queue-events.js             # NEW: Queue event handlers
│   ├── schedulers/
│   │   ├── cron-manager.js             # NEW: Cron job manager
│   │   ├── schedule-validator.js       # NEW: Cron expression validation
│   │   └── job-scheduler.js            # NEW: Job scheduling logic
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── validation.middleware.js
│   │   ├── rate-limit.middleware.js    # NEW: Enhanced rate limiting
│   │   └── queue-auth.middleware.js    # NEW: Queue access control
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── shopify.routes.js
│   │   ├── vendor.routes.js
│   │   ├── inventory.routes.js
│   │   ├── sync.routes.js              # ENHANCED: Added control endpoints
│   │   ├── cron.routes.js              # NEW: Cron management routes
│   │   └── queue.routes.js             # NEW: Queue monitoring routes
│   ├── utils/
│   │   ├── database.js
│   │   ├── logger.js
│   │   ├── encryption.js
│   │   ├── sku-parser.js               # NEW: Enhanced SKU parsing
│   │   ├── job-priority.js             # NEW: Job priority management
│   │   └── error-handler.js            # NEW: Enhanced error handling
│   ├── websockets/
│   │   ├── socket-server.js            # NEW: Socket.io server setup
│   │   ├── sync-events.js              # NEW: Sync progress events
│   │   └── queue-events.js             # NEW: Queue status events
│   └── app.js
├── config/
│   ├── database.config.js
│   ├── queue.config.js                 # NEW: Queue configuration
│   ├── scheduler.config.js             # NEW: Scheduler configuration
│   └── socket.config.js                # NEW: Socket.io configuration
├── package.json
├── .env.example
└── README.md
```

## New Components Explained

### 1. Product Selection Service (`product-selector.service.js`)
```javascript
class ProductSelectorService {
  // Select single product for sync
  async selectSingleProduct(vendorId, productId, options = {}) {
    // Implementation for single product selection
  }

  // Select multiple products with filters
  async selectMultipleProducts(vendorId, filters = {}) {
    // Implementation for bulk product selection
  }

  // Select products by SKU patterns
  async selectBySKUs(vendorId, skus = []) {
    // Implementation for SKU-based selection
  }

  // Get product selection suggestions
  async getSelectionSuggestions(vendorId, criteria = {}) {
    // Implementation for intelligent product suggestions
  }
}
```

### 2. Batch Processing Service (`batch.service.js`)
```javascript
class BatchService {
  // Create batch sync job
  async createBatchJob(storeId, vendorId, products, options = {}) {
    // Implementation for batch job creation
  }

  // Process batch in chunks
  async processBatch(batchId, batchSize = 50) {
    // Implementation for batch processing
  }

  // Monitor batch progress
  async getBatchStatus(batchId) {
    // Implementation for batch status tracking
  }

  // Pause/Resume batch processing
  async controlBatch(batchId, action) {
    // Implementation for batch control
  }
}
```

### 3. Cron Manager (`cron-manager.js`)
```javascript
class CronManager {
  // Create new cron schedule
  async createSchedule(scheduleConfig) {
    // Implementation for schedule creation
  }

  // Update existing schedule
  async updateSchedule(scheduleId, updates) {
    // Implementation for schedule updates
  }

  // Start/Stop schedules
  async toggleSchedule(scheduleId, isActive) {
    // Implementation for schedule control
  }

  // Manually trigger scheduled job
  async triggerSchedule(scheduleId) {
    // Implementation for manual trigger
  }

  // Get next run times
  async getNextRuns(scheduleId) {
    // Implementation for schedule preview
  }
}
```

### 4. Job Queue System (`sync-queue.js`)
```javascript
const Queue = require('bull');
const syncQueue = new Queue('inventory sync', {
  redis: {
    port: process.env.REDIS_PORT || 6379,
    host: process.env.REDIS_HOST || 'localhost',
  },
});

// Job types
const JOB_TYPES = {
  MANUAL_SYNC: 'manual-sync',
  BATCH_SYNC: 'batch-sync',
  SCHEDULED_SYNC: 'scheduled-sync',
  SINGLE_PRODUCT_SYNC: 'single-product-sync'
};

// Job priorities
const JOB_PRIORITIES = {
  HIGH: 1,
  NORMAL: 5,
  LOW: 10
};

// Add jobs to queue
syncQueue.add(JOB_TYPES.MANUAL_SYNC, jobData, {
  priority: JOB_PRIORITIES.HIGH,
  attempts: 3,
  backoff: 'exponential',
  delay: 0
});
```

### 5. Enhanced Sync Controller (`sync.controller.js`)
```javascript
class SyncController {
  // Start manual sync with product selection
  async startManualSync(req, res) {
    const { storeId, vendorId, products, skus, options } = req.body;
    
    try {
      // Validate inputs
      // Create sync job
      // Add to queue
      // Return job details
    } catch (error) {
      // Error handling
    }
  }

  // Create batch sync job
  async createBatchSync(req, res) {
    const { storeId, vendorId, batchType, products, filters, options } = req.body;
    
    try {
      // Create batch job
      // Process in background
      // Return batch details
    } catch (error) {
      // Error handling
    }
  }

  // Control sync operations
  async controlSync(req, res) {
    const { syncId } = req.params;
    const { action } = req.body; // pause, resume, cancel, retry_failed
    
    try {
      // Control sync operation
      // Update job status
      // Return new status
    } catch (error) {
      // Error handling
    }
  }

  // Get sync queue status
  async getQueueStatus(req, res) {
    try {
      // Get queue statistics
      // Return queue info
    } catch (error) {
      // Error handling
    }
  }
}
```

### 6. Cron Controller (`cron.controller.js`)
```javascript
class CronController {
  // List all schedules
  async getSchedules(req, res) {
    try {
      // Fetch all schedules
      // Return with next run times
    } catch (error) {
      // Error handling
    }
  }

  // Create new schedule
  async createSchedule(req, res) {
    const { name, cronExpression, storeId, vendorId, syncConfig, notifications } = req.body;
    
    try {
      // Validate cron expression
      // Create schedule
      // Set up cron job
      // Return schedule details
    } catch (error) {
      // Error handling
    }
  }

  // Update schedule
  async updateSchedule(req, res) {
    const { id } = req.params;
    const updates = req.body;
    
    try {
      // Update schedule
      // Restart cron job if needed
      // Return updated schedule
    } catch (error) {
      // Error handling
    }
  }

  // Delete schedule
  async deleteSchedule(req, res) {
    const { id } = req.params;
    
    try {
      // Stop cron job
      // Delete schedule
      // Return success
    } catch (error) {
      // Error handling
    }
  }

  // Manually trigger schedule
  async triggerSchedule(req, res) {
    const { id } = req.params;
    
    try {
      // Trigger scheduled job manually
      // Return sync details
    } catch (error) {
      // Error handling
    }
  }
}
```

## Key API Endpoints Added

### Product Selection & Sync Control
- `POST /api/sync/manual` - Enhanced with product selection
- `POST /api/sync/batch` - New batch processing endpoint
- `POST /api/sync/control/:syncId` - Control running syncs
- `GET /api/sync/queue` - Monitor job queue

### Cron Job Management
- `GET /api/cron/schedules` - List all schedules
- `POST /api/cron/schedules` - Create new schedule
- `PUT /api/cron/schedules/:id` - Update schedule
- `DELETE /api/cron/schedules/:id` - Delete schedule
- `POST /api/cron/schedules/:id/run` - Manual trigger

### Queue Management
- `GET /api/queue/status` - Queue statistics
- `GET /api/queue/jobs` - List jobs in queue
- `POST /api/queue/jobs/:id/retry` - Retry failed job
- `DELETE /api/queue/jobs/:id` - Remove job from queue

## Dependencies to Add

```json
{
  "dependencies": {
    "bull": "^4.10.4",
    "node-cron": "^3.0.2",
    "cron-parser": "^4.8.1",
    "ioredis": "^5.3.2",
    "socket.io": "^4.7.2"
  }
}
```

## Environment Variables to Add

```env
# Queue Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Job Processing
MAX_CONCURRENT_JOBS=5
JOB_TIMEOUT=300000
RETRY_ATTEMPTS=3

# Cron Configuration
ENABLE_CRON=true
CRON_TIMEZONE=America/New_York

# Socket.io
SOCKET_CORS_ORIGIN=http://localhost:3000
```

This enhanced structure provides complete control over product selection, batch processing, and automated scheduling as requested. The system now supports:

1. **Single Product Sync**: Select and sync individual products
2. **Batch Processing**: Create jobs for multiple products with queue management
3. **Cron Job Control**: Full CRUD operations for scheduled tasks
4. **Real-time Monitoring**: Live updates for all sync operations
5. **Job Queue Management**: Priority-based processing with retry mechanisms
