const mongoose = require('mongoose');

const syncScheduleSchema = new mongoose.Schema({
  // Schedule identification
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
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
  
  // Cron configuration
  cronExpression: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        // Basic cron validation - 5 fields separated by spaces
        const parts = v.trim().split(/\s+/);
        return parts.length === 5;
      },
      message: 'Invalid cron expression format'
    }
  },
  timezone: {
    type: String,
    default: 'UTC'
  },
  
  // Schedule status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Execution tracking
  nextRun: Date,
  lastRun: Date,
  lastRunStatus: {
    type: String,
    enum: ['success', 'failed', 'skipped'],
    default: null
  },
  lastRunDuration: Number, // milliseconds
  
  // Sync configuration
  syncConfig: {
    type: {
      type: String,
      enum: ['full', 'incremental', 'selected'],
      default: 'incremental'
    },
    batchSize: {
      type: Number,
      default: 50,
      min: 1,
      max: 500
    },
    selectedProducts: [String], // SKUs or product IDs
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
    onlyInStock: {
      type: Boolean,
      default: false
    }
  },
  
  // Execution limits
  maxExecutionTime: {
    type: Number,
    default: 3600000 // 1 hour in milliseconds
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  retryDelay: {
    type: Number,
    default: 300000 // 5 minutes in milliseconds
  },
  
  // Notification settings
  notifications: {
    onSuccess: {
      type: Boolean,
      default: false
    },
    onFailure: {
      type: Boolean,
      default: true
    },
    onPartialFailure: {
      type: Boolean,
      default: true
    },
    email: String,
    webhook: String
  },
  
  // Statistics
  stats: {
    totalRuns: {
      type: Number,
      default: 0
    },
    successfulRuns: {
      type: Number,
      default: 0
    },
    failedRuns: {
      type: Number,
      default: 0
    },
    averageDuration: {
      type: Number,
      default: 0
    },
    lastFailureReason: String
  },
  
  // Metadata
  createdBy: String,
  lastModifiedBy: String,
  metadata: {
    tags: [String],
    notes: String,
    priority: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
syncScheduleSchema.index({ storeId: 1, vendorId: 1 });
syncScheduleSchema.index({ isActive: 1, nextRun: 1 });
syncScheduleSchema.index({ cronExpression: 1 });
syncScheduleSchema.index({ nextRun: 1 });

// Virtual for success rate
syncScheduleSchema.virtual('successRate').get(function() {
  if (this.stats.totalRuns === 0) return 0;
  return (this.stats.successfulRuns / this.stats.totalRuns) * 100;
});

// Virtual for schedule health
syncScheduleSchema.virtual('health').get(function() {
  if (!this.isActive) return 'disabled';
  if (this.stats.totalRuns === 0) return 'new';
  
  const successRate = this.successRate;
  if (successRate >= 95) return 'excellent';
  if (successRate >= 80) return 'good';
  if (successRate >= 60) return 'fair';
  return 'poor';
});

// Instance methods
syncScheduleSchema.methods.updateNextRun = function() {
  // This is a simplified implementation
  // In production, use a proper cron parser library like 'node-cron' or 'cron-parser'
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  this.nextRun = nextHour;
  return this.save();
};

syncScheduleSchema.methods.recordExecution = function(status, duration, error = null) {
  this.lastRun = new Date();
  this.lastRunStatus = status;
  this.lastRunDuration = duration;
  
  this.stats.totalRuns += 1;
  if (status === 'success') {
    this.stats.successfulRuns += 1;
  } else if (status === 'failed') {
    this.stats.failedRuns += 1;
    if (error) {
      this.stats.lastFailureReason = error;
    }
  }
  
  // Update average duration
  this.stats.averageDuration = (
    (this.stats.averageDuration * (this.stats.totalRuns - 1) + duration) / 
    this.stats.totalRuns
  );
  
  return this.updateNextRun();
};

syncScheduleSchema.methods.activate = function() {
  this.isActive = true;
  return this.updateNextRun();
};

syncScheduleSchema.methods.deactivate = function() {
  this.isActive = false;
  this.nextRun = null;
  return this.save();
};

// Static methods
syncScheduleSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

syncScheduleSchema.statics.findDue = function() {
  return this.find({
    isActive: true,
    nextRun: { $lte: new Date() }
  });
};

syncScheduleSchema.statics.findByStore = function(storeId) {
  return this.find({ storeId });
};

syncScheduleSchema.statics.findByVendor = function(vendorId) {
  return this.find({ vendorId });
};

module.exports = mongoose.model('SyncSchedule', syncScheduleSchema);
