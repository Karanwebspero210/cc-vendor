const mongoose = require('mongoose');

// Note: Variants are stored in ProductVariant collection; no embedded variants here.

const productSchema = new mongoose.Schema({
  // Source information
  source: {
    type: String,
    enum: ['shopify', 'vendor'],
    required: true
  }, 
  
  // Store/Vendor reference
  storeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: function() { return this.source === 'shopify'; }
  },
  // Main SKU (extracted from variants)
  mainSku: {
    type: String,
    required: true,
    trim: true,
    index: true
  },  
  // Status and availability
  status: {
    type: String,
    enum: ['active', 'archived', 'draft'],
    default: 'active'
  },
  
  // Inventory tracking
  totalInventory: {
    type: Number,
    default: 0
  },
  inStock: {
    type: Boolean,
    default: true
  },
  // Sync information
  lastSynced: Date,
  syncStatus: {
    type: String,
    enum: ['pending', 'synced', 'error', 'manual'],
    default: 'pending'
  },
  syncErrors: [String],

  // No mapping info or additional metadata
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
productSchema.index({ source: 1 });
productSchema.index({ mainSku: 1 });
productSchema.index({ storeId: 1 });
productSchema.index({ status: 1, inStock: 1 });
productSchema.index({ lastSynced: 1 });
productSchema.index({ syncStatus: 1 });

// Virtual for checking if product has inventory
productSchema.virtual('hasInventory').get(function() {
  return this.totalInventory > 0;
});

// Instance methods
productSchema.methods.updateInventory = function(total = null) {
  if (typeof total === 'number') {
    this.totalInventory = total;
  }
  this.inStock = (this.totalInventory || 0) > 0;
  return this.save();
};

productSchema.methods.updateSyncStatus = function(status, errors = null) {
  this.syncStatus = status;
  this.lastSynced = new Date();
  if (errors) {
    this.syncErrors = Array.isArray(errors) ? errors : [errors];
  }
  return this.save();
};

// Static methods
productSchema.statics.findByMainSku = function(mainSku, source = null) {
  const query = { mainSku };
  if (source) query.source = source;
  return this.find(query);
};

productSchema.statics.findByStore = function(storeId) {
  return this.find({ storeId, source: 'shopify' });
};

module.exports = mongoose.model('Product', productSchema);