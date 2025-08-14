const mongoose = require('mongoose');
const encryptionService = require('../utils/encryption');

const storeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  shopifyDomain: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]\.myshopify\.com$/.test(v);
      },
      message: 'Invalid Shopify domain format'
    }
  },
  accessToken: {
    type: String,
    required: true,
    set: function(token) {
      // Encrypt access token before storing
      return encryptionService.encrypt(token);
    },
    get: function(encryptedToken) {
      // Decrypt access token when retrieving
      try {
        return encryptionService.decrypt(encryptedToken);
      } catch (error) {
        return encryptedToken; // Return as-is if decryption fails
      }
    }
  },
  shopifyShopId: {
    type: String,
    required: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  connectionStatus: {
    type: String,
    enum: ['connected', 'disconnected', 'error'],
    default: 'connected'
  },
  lastConnectionCheck: {
    type: Date,
    default: Date.now
  },
  settings: {
    autoSync: {
      type: Boolean,
      default: false
    },
    syncFrequency: {
      type: String,
      enum: ['hourly', 'daily', 'weekly'],
      default: 'daily'
    },
    inventoryThreshold: {
      type: Number,
      default: 5
    },
    defaultLocationId: {
      type: String,
      default: null
    },
    updateOutOfStock: {
      type: Boolean,
      default: true
    }
  },
  metadata: {
    shopifyPlan: String,
    timezone: String,
    currency: String,
    country: String
  }
}, {
  timestamps: true,
  toJSON: { 
    getters: true,
    transform: function(doc, ret) {
      // Don't expose encrypted access token in JSON
      delete ret.accessToken;
      return ret;
    }
  },
  toObject: { getters: true }
});

// Indexes
storeSchema.index({ shopifyDomain: 1 }, { unique: true });
storeSchema.index({ isActive: 1 });
storeSchema.index({ 'settings.autoSync': 1 });

// Instance methods
storeSchema.methods.getDecryptedToken = function() {
  try {
    return encryptionService.decrypt(this.accessToken);
  } catch (error) {
    throw new Error('Failed to decrypt access token');
  }
};

storeSchema.methods.updateConnectionStatus = function(status, error = null) {
  this.connectionStatus = status;
  this.lastConnectionCheck = new Date();
  if (error) {
    this.metadata.lastError = error;
  }
  return this.save();
};

// Static methods
storeSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

storeSchema.statics.findByDomain = function(domain) {
  return this.findOne({ shopifyDomain: domain.toLowerCase() });
};

storeSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

storeSchema.statics.findByDomain = function(domain) {
  return this.findOne({ shopifyDomain: domain.toLowerCase() });
};

storeSchema.statics.getAutoSyncStores = function() {
  return this.find({ 
    isActive: true, 
    'settings.autoSync': true,
    connectionStatus: 'connected'
  });
};

// Pre-save middleware
storeSchema.pre('save', function(next) {
  if (this.isModified('shopifyDomain')) {
    this.shopifyDomain = this.shopifyDomain.toLowerCase();
  }
  next();
});

module.exports = mongoose.model('Store', storeSchema);
