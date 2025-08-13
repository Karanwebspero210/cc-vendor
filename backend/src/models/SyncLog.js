const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema({
  // Sync operation identification
  syncId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Type of sync operation
  type: {
    type: String,
    enum: ['manual', 'automated', 'batch', 'scheduled'],
    required: true
  },
  
  // References
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  
  // Sync status and progress
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'paused'],
    default: 'pending'
  },
  
  // Progress tracking
  progress: {
    totalProducts: {
      type: Number,
      default: 0
    },
    processedProducts: {
      type: Number,
      default: 0
    },
    successCount: {
      type: Number,
      default: 0
    },
    errorCount: {
      type: Number,
      default: 0
    },
    skippedCount: {
      type: Number,
      default: 0
    },
    percentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  
  // Timing information
  startTime: Date,
  endTime: Date,
  duration: {
    type: Number, // in milliseconds
    default: 0
  },
  estimatedDuration: Number,
  
  // Error tracking
  errors: [{
    productId: String,
    sku: String,
    error: String,
    errorCode: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    }
  }],
  
  // Sync configuration
  config: {
    batchSize: {
      type: Number,
      default: 50
    },
    selectedProducts: [String], // Array of product IDs or SKUs
    syncInventory: {
      type: Boolean,
      default: true
    },
    syncPrices: {
      type: Boolean,
      default: false
    },
    updateOutOfStock: {
      type: Boolean,
      default: true
    },
    dryRun: {
      type: Boolean,
      default: false
    }
  },
  
  // Results summary
  results: {
    inventoryUpdates: {
      type: Number,
      default: 0
    },
    priceUpdates: {
      type: Number,
      default: 0
    },
    newMappings: {
      type: Number,
      default: 0
    },
    conflictsResolved: {
      type: Number,
      default: 0
    },
    totalChanges: {
      type: Number,
      default: 0
    }
  },
  
  // Performance metrics
  performance: {
    averageProcessingTime: Number, // ms per product
    apiCallsCount: {
      type: Number,
      default: 0
    },
    rateLimitHits: {
      type: Number,
      default: 0
    },
    retryAttempts: {
      type: Number,
      default: 0
    }
  },
  
  // Trigger information
  triggeredBy: {
    type: String,
    enum: ['admin', 'cron', 'webhook', 'api', 'system'],
    default: 'admin'
  },
  triggerData: {
    userId: String,
    cronJobId: String,
    webhookId: String,
    apiEndpoint: String,
    reason: String
  },
  
  // Job queue information
  jobId: String,
  queueName: String,
  priority: {
    type: Number,
    default: 0
  },
  
  // Logs and debug information
  logs: [{
    level: {
      type: String,
      enum: ['debug', 'info', 'warn', 'error'],
      default: 'info'
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    data: mongoose.Schema.Types.Mixed
  }],
  
  // Metadata
  metadata: {
    userAgent: String,
    ipAddress: String,
    environment: String,
    version: String,
    notes: String,
    tags: [String]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  suppressReservedKeysWarning: true
});

// Indexes for performance
syncLogSchema.index({ syncId: 1 }, { unique: true });
syncLogSchema.index({ storeId: 1, vendorId: 1 });
syncLogSchema.index({ status: 1 });
syncLogSchema.index({ type: 1 });
syncLogSchema.index({ startTime: -1 });
syncLogSchema.index({ createdAt: -1 });
syncLogSchema.index({ triggeredBy: 1 });

// Virtual for success rate
syncLogSchema.virtual('successRate').get(function() {
  const total = this.progress.processedProducts;
  if (total === 0) return 0;
  return (this.progress.successCount / total) * 100;
});

// Virtual for error rate
syncLogSchema.virtual('errorRate').get(function() {
  const total = this.progress.processedProducts;
  if (total === 0) return 0;
  return (this.progress.errorCount / total) * 100;
});

// Virtual for is running
syncLogSchema.virtual('isRunning').get(function() {
  return ['pending', 'running'].includes(this.status);
});

// Virtual for is completed
syncLogSchema.virtual('isCompleted').get(function() {
  return ['completed', 'failed', 'cancelled'].includes(this.status);
});

// Instance methods
syncLogSchema.methods.start = function() {
  this.status = 'running';
  this.startTime = new Date();
  return this.save();
};

syncLogSchema.methods.complete = function(success = true) {
  this.status = success ? 'completed' : 'failed';
  this.endTime = new Date();
  if (this.startTime) {
    this.duration = this.endTime - this.startTime;
  }
  this.progress.percentage = 100;
  return this.save();
};

syncLogSchema.methods.updateProgress = function(processed, success = true) {
  if (success) {
    this.progress.successCount += 1;
  } else {
    this.progress.errorCount += 1;
  }
  
  this.progress.processedProducts = processed;
  
  if (this.progress.totalProducts > 0) {
    this.progress.percentage = Math.round(
      (this.progress.processedProducts / this.progress.totalProducts) * 100
    );
  }
  
  return this.save();
};

syncLogSchema.methods.addError = function(error) {
  this.errors.push({
    ...error,
    timestamp: new Date()
  });
  this.progress.errorCount = this.errors.length;
  return this.save();
};

syncLogSchema.methods.addLog = function(level, message, data = null) {
  this.logs.push({
    level,
    message,
    data,
    timestamp: new Date()
  });
  return this.save();
};

syncLogSchema.methods.pause = function() {
  this.status = 'paused';
  return this.save();
};

syncLogSchema.methods.resume = function() {
  this.status = 'running';
  return this.save();
};

syncLogSchema.methods.cancel = function() {
  this.status = 'cancelled';
  this.endTime = new Date();
  if (this.startTime) {
    this.duration = this.endTime - this.startTime;
  }
  return this.save();
};

syncLogSchema.methods.updateResults = function(results) {
  Object.assign(this.results, results);
  this.results.totalChanges = 
    this.results.inventoryUpdates + 
    this.results.priceUpdates + 
    this.results.newMappings;
  return this.save();
};

// Static methods
syncLogSchema.statics.findByStore = function(storeId, limit = 50) {
  return this.find({ storeId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('storeId vendorId');
};

syncLogSchema.statics.findByVendor = function(vendorId, limit = 50) {
  return this.find({ vendorId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('storeId vendorId');
};

syncLogSchema.statics.findRunning = function() {
  return this.find({ status: { $in: ['pending', 'running'] } });
};

syncLogSchema.statics.findRecent = function(hours = 24) {
  const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
  return this.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 });
};

syncLogSchema.statics.getStats = function(storeId = null, vendorId = null, days = 30) {
  const match = {};
  const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  match.createdAt = { $gte: since };
  
  if (storeId) match.storeId = mongoose.Types.ObjectId(storeId);
  if (vendorId) match.vendorId = mongoose.Types.ObjectId(vendorId);
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSyncs: { $sum: 1 },
        successfulSyncs: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        failedSyncs: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        totalProducts: { $sum: '$progress.totalProducts' },
        totalProcessed: { $sum: '$progress.processedProducts' },
        totalErrors: { $sum: '$progress.errorCount' },
        averageDuration: { $avg: '$duration' },
        totalInventoryUpdates: { $sum: '$results.inventoryUpdates' },
        totalPriceUpdates: { $sum: '$results.priceUpdates' }
      }
    }
  ]);
};

// Pre-save middleware
syncLogSchema.pre('save', function(next) {
  // Generate sync ID if not provided
  if (!this.syncId) {
    this.syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Update performance metrics
  if (this.isModified('progress.processedProducts') && this.startTime) {
    const elapsed = Date.now() - this.startTime;
    if (this.progress.processedProducts > 0) {
      this.performance.averageProcessingTime = elapsed / this.progress.processedProducts;
    }
  }
  
  next();
});

module.exports = mongoose.model('SyncLog', syncLogSchema);
