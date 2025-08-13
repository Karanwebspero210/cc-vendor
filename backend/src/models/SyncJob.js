const mongoose = require('mongoose');

const syncJobSchema = new mongoose.Schema({
  // Job identification
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Job type and priority
  type: {
    type: String,
    enum: ['manual', 'scheduled', 'batch', 'retry', 'webhook'],
    required: true
  },
  priority: {
    type: Number,
    default: 0,
    min: -10,
    max: 10
  },
  
  // References
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: false
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: false
  },
  syncLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SyncLog',
    required: false
  },
  
  // Job status
  status: {
    type: String,
    enum: ['queued', 'active', 'completed', 'failed', 'delayed', 'cancelled'],
    default: 'queued'
  },
  
  // Timing
  createdAt: {
    type: Date,
    default: Date.now
  },
  scheduledFor: Date,
  startedAt: Date,
  completedAt: Date,
  
  // Job data and configuration
  data: {
    selectedProducts: [String], // SKUs or product IDs
    syncConfig: {
      batchSize: {
        type: Number,
        default: 50
      },
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
    filters: {
      onlyInStock: Boolean,
      minInventory: Number,
      maxInventory: Number,
      categories: [String],
      tags: [String]
    }
  },
  
  // Progress tracking
  progress: {
    total: {
      type: Number,
      default: 0
    },
    completed: {
      type: Number,
      default: 0
    },
    failed: {
      type: Number,
      default: 0
    },
    percentage: {
      type: Number,
      default: 0
    }
  },
  
  // Retry configuration
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  retryDelay: {
    type: Number,
    default: 5000 // 5 seconds
  },
  
  // Error handling
  errors: [{
    attempt: Number,
    error: String,
    stack: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Results
  result: {
    success: Boolean,
    message: String,
    data: mongoose.Schema.Types.Mixed,
    stats: {
      inventoryUpdates: Number,
      priceUpdates: Number,
      errors: Number,
      duration: Number
    }
  },
  
  // Queue information
  queueName: {
    type: String,
    default: 'sync'
  },
  
  // Metadata
  metadata: {
    triggeredBy: String,
    userAgent: String,
    ipAddress: String,
    tags: [String],
    notes: String
  }
}, {
  timestamps: false, // Using custom createdAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  suppressReservedKeysWarning: true
});

// Indexes
syncJobSchema.index({ jobId: 1 }, { unique: true });
syncJobSchema.index({ status: 1, priority: -1 });
syncJobSchema.index({ storeId: 1, vendorId: 1 });
syncJobSchema.index({ type: 1 });
syncJobSchema.index({ scheduledFor: 1 });
syncJobSchema.index({ createdAt: -1 });

// Virtual for duration
syncJobSchema.virtual('duration').get(function() {
  if (this.startedAt && this.completedAt) {
    return this.completedAt - this.startedAt;
  }
  return null;
});

// Virtual for is active
syncJobSchema.virtual('isActive').get(function() {
  return ['queued', 'active', 'delayed'].includes(this.status);
});

// Virtual for success rate
syncJobSchema.virtual('successRate').get(function() {
  const total = this.progress.completed + this.progress.failed;
  if (total === 0) return 0;
  return (this.progress.completed / total) * 100;
});

// Instance methods
syncJobSchema.methods.start = function() {
  this.status = 'active';
  this.startedAt = new Date();
  this.attempts += 1;
  return this.save();
};

syncJobSchema.methods.complete = function(success = true, result = {}) {
  this.status = success ? 'completed' : 'failed';
  this.completedAt = new Date();
  this.result = {
    success,
    ...result,
    timestamp: new Date()
  };
  return this.save();
};

syncJobSchema.methods.fail = function(error, canRetry = true) {
  this.errors.push({
    attempt: this.attempts,
    error: error.message || error,
    stack: error.stack,
    timestamp: new Date()
  });
  
  if (canRetry && this.attempts < this.maxAttempts) {
    this.status = 'delayed';
    this.scheduledFor = new Date(Date.now() + this.retryDelay);
  } else {
    this.status = 'failed';
    this.completedAt = new Date();
  }
  
  return this.save();
};

syncJobSchema.methods.cancel = function() {
  this.status = 'cancelled';
  this.completedAt = new Date();
  return this.save();
};

syncJobSchema.methods.updateProgress = function(completed, failed = 0, total = null) {
  this.progress.completed = completed;
  this.progress.failed = failed;
  
  if (total !== null) {
    this.progress.total = total;
  }
  
  if (this.progress.total > 0) {
    this.progress.percentage = Math.round(
      ((this.progress.completed + this.progress.failed) / this.progress.total) * 100
    );
  }
  
  return this.save();
};

// Static methods
syncJobSchema.statics.findQueued = function() {
  return this.find({ 
    status: { $in: ['queued', 'delayed'] },
    $or: [
      { scheduledFor: { $exists: false } },
      { scheduledFor: { $lte: new Date() } }
    ]
  }).sort({ priority: -1, createdAt: 1 });
};

syncJobSchema.statics.findActive = function() {
  return this.find({ status: 'active' });
};

syncJobSchema.statics.findByStore = function(storeId) {
  return this.find({ storeId }).sort({ createdAt: -1 });
};

syncJobSchema.statics.findByVendor = function(vendorId) {
  return this.find({ vendorId }).sort({ createdAt: -1 });
};

syncJobSchema.statics.findRecent = function(hours = 24) {
  const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
  return this.find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 });
};

syncJobSchema.statics.getQueueStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

// Pre-save middleware
syncJobSchema.pre('save', function(next) {
  // Generate job ID if not provided
  if (!this.jobId) {
    this.jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  next();
});

module.exports = mongoose.model('SyncJob', syncJobSchema);
