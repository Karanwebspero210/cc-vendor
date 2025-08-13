const mongoose = require('mongoose');

const productVariantSchema = new mongoose.Schema({
  // Reference to the main product
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  
  // Main product SKU (e.g., 'A1241')
  mainSku: {
    type: String,
    required: true,
    index: true
  },
  
  // Unique variant SKU in format: noxa_<mainSku>-<Color>-<Size>
  variantSku: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Variant details from Noxa
  color: {
    type: String,
    required: true
  },
  
  size: {
    type: String,
    required: true
  },
  
  // Inventory details
  stockQty: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Shopify linkage (cached after first successful match)
  shopifyVariantId: {
    type: String,
    default: null,
    index: true
  },
  shopifyInventoryItemId: {
    type: String,
    default: null,
    index: true
  },
  lastKnownShopifyQty: {
    type: Number,
    default: null
  },
  lastSyncAt: {
    type: Date,
    default: null
  },
  lastSyncStatus: {
    type: String,
    enum: ['success', 'failed'],
    default: null
  },
  lastSyncError: {
    type: String,
    default: null
  },
  
  preOrderDate: {
    type: Date,
    default: null
  },
  
  // Status from Noxa
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Discontinued'],
    default: 'Active'
  },
  
  // Timestamps
  lastSynced: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster queries
productVariantSchema.index({ mainSku: 1, color: 1, size: 1  }, { unique: true });

/**
 * Generate variant SKU in format: noxa_<mainSku>-<Color>-<Size>
 * @param {string} mainSku - The main product SKU
 * @param {string} color - The color variant
 * @param {string} size - The size variant
 * @returns {string} - Generated variant SKU
 */
productVariantSchema.statics.generateVariantSku = function(mainSku, color, size) {
  return `noxa_${mainSku}-${(color || '').replace(/\s+/g, '')}-${(size || '').replace(/\s+/g, '')}`.toUpperCase();
};

/**
 * Find or create a variant
 * @param {Object} params - Variant parameters
 * @returns {Promise<Document>} - The found or created variant
 */
productVariantSchema.statics.findOrCreate = async function(params) {
  const { mainSku, color, size } = params;
  const variantSku = this.generateVariantSku(mainSku, color, size);
  
  let variant = await this.findOne({ variantSku });
  
  if (!variant) {
    variant = new this({
      ...params,
      variantSku,
      mainSku: mainSku.toUpperCase(),
      color: (color || '').toString().trim(),
      size: (size || '').toString().trim()
    });
    await variant.save();
  }
  
  return variant;
};

/**
 * Update inventory for multiple variants in bulk
 * @param {Array} variants - Array of variant updates
 * @returns {Promise<Object>} - Bulk write result
 */
productVariantSchema.statics.bulkUpdateInventory = async function(variants) {
  const bulkOps = variants.map(variant => ({
    updateOne: {
      filter: { variantSku: variant.variantSku },
      update: {
        $set: {
          stockQty: variant.stockQty,
          preOrderDate: variant.preOrderDate,
          status: variant.status || 'Active',
          lastSynced: new Date()
        },
        $setOnInsert: {
          mainSku: variant.mainSku,
          color: variant.color,
          size: variant.size,
          variantSku: variant.variantSku
        }
      },
      upsert: true
    }
  }));
  
  return this.bulkWrite(bulkOps, { ordered: false });
};

const ProductVariant = mongoose.model('ProductVariant', productVariantSchema);

module.exports = ProductVariant;
