const logger = require('../utils/logger');
const { parseSkuPattern } = require('../utils/sku-parser');

/**
 * Product Selector Service
 * Handles SKU pattern recognition and product mapping logic
 */
class ProductSelectorService {
  constructor() {
    // Common SKU patterns for Noxa vendor
    this.skuPatterns = [
      {
        name: 'noxa_standard',
        pattern: /^noxa_([A-Z0-9]+)-([A-Za-z]+)-([0-9XS-XL]+)-?([A-Z]*)?$/,
        groups: ['productCode', 'color', 'size', 'suffix']
      },
      {
        name: 'noxa_simple',
        pattern: /^noxa_([A-Z0-9]+)-([A-Za-z]+)-([0-9XS-XL]+)$/,
        groups: ['productCode', 'color', 'size']
      },
      {
        name: 'noxa_basic',
        pattern: /^noxa_([A-Z0-9]+)$/,
        groups: ['productCode']
      }
    ];

    // Color mappings for standardization
    this.colorMappings = {
      'white': ['white', 'wht', 'w'],
      'black': ['black', 'blk', 'b'],
      'red': ['red', 'r'],
      'blue': ['blue', 'blu', 'bl'],
      'green': ['green', 'grn', 'g'],
      'pink': ['pink', 'pnk', 'p'],
      'purple': ['purple', 'prpl', 'pur'],
      'yellow': ['yellow', 'ylw', 'y'],
      'orange': ['orange', 'org', 'o'],
      'gray': ['gray', 'grey', 'gry', 'gr'],
      'brown': ['brown', 'brn', 'br'],
      'navy': ['navy', 'nvy', 'n'],
      'beige': ['beige', 'bge', 'bg'],
      'cream': ['cream', 'crm', 'cr']
    };

    // Size mappings for standardization
    this.sizeMappings = {
      'XS': ['xs', 'extra-small', 'xsmall'],
      'S': ['s', 'small'],
      'M': ['m', 'medium', 'med'],
      'L': ['l', 'large', 'lg'],
      'XL': ['xl', 'extra-large', 'xlarge'],
      'XXL': ['xxl', '2xl', 'extra-extra-large'],
      'XXXL': ['xxxl', '3xl'],
      '0': ['0', 'zero'],
      '2': ['2', 'two'],
      '4': ['4', 'four'],
      '6': ['6', 'six'],
      '8': ['8', 'eight'],
      '10': ['10', 'ten'],
      '12': ['12', 'twelve'],
      '14': ['14', 'fourteen'],
      '16': ['16', 'sixteen'],
      '18': ['18', 'eighteen'],
      '20': ['20', 'twenty']
    };
  }

  /**
   * Parse vendor SKU and extract product information
   */
  parseVendorSku(sku) {
    try {
      for (const pattern of this.skuPatterns) {
        const match = sku.match(pattern.pattern);
        if (match) {
          const parsed = {
            originalSku: sku,
            pattern: pattern.name,
            parsed: true
          };

          // Extract groups based on pattern
          pattern.groups.forEach((group, index) => {
            parsed[group] = match[index + 1] || null;
          });

          // Standardize color and size
          if (parsed.color) {
            parsed.standardColor = this.standardizeColor(parsed.color);
          }
          if (parsed.size) {
            parsed.standardSize = this.standardizeSize(parsed.size);
          }

          // Generate base product identifier
          parsed.baseProductCode = parsed.productCode;
          
          return parsed;
        }
      }

      // If no pattern matches, return basic info
      return {
        originalSku: sku,
        parsed: false,
        baseProductCode: sku
      };
    } catch (error) {
      logger.error('Error parsing vendor SKU:', error);
      return {
        originalSku: sku,
        parsed: false,
        error: error.message
      };
    }
  }

  /**
   * Find potential Shopify product matches for vendor SKU
   */
  async findShopifyMatches(vendorSku, shopifyProducts) {
    try {
      const skuInfo = this.parseVendorSku(vendorSku);
      const matches = [];

      for (const product of shopifyProducts) {
        const score = this.calculateMatchScore(skuInfo, product);
        if (score > 0) {
          matches.push({
            product,
            score,
            matchReasons: this.getMatchReasons(skuInfo, product, score)
          });
        }
      }

      // Sort by score (highest first)
      matches.sort((a, b) => b.score - a.score);

      return matches;
    } catch (error) {
      logger.error('Error finding Shopify matches:', error);
      throw error;
    }
  }

  /**
   * Calculate match score between vendor SKU and Shopify product
   */
  calculateMatchScore(skuInfo, shopifyProduct) {
    let score = 0;
    const maxScore = 100;

    if (!skuInfo.parsed) {
      // If SKU couldn't be parsed, try basic string matching
      const productTitle = shopifyProduct.title.toLowerCase();
      const sku = skuInfo.originalSku.toLowerCase();
      
      if (productTitle.includes(sku.replace('noxa_', ''))) {
        score += 30;
      }
      
      return Math.min(score, maxScore);
    }

    // Product code match (highest weight)
    if (skuInfo.productCode) {
      const productTitle = shopifyProduct.title.toLowerCase();
      const productCode = skuInfo.productCode.toLowerCase();
      
      if (productTitle.includes(productCode)) {
        score += 40;
      }
      
      // Check variants for SKU matches
      for (const variant of shopifyProduct.variants || []) {
        if (variant.sku && variant.sku.toLowerCase().includes(productCode)) {
          score += 35;
          break;
        }
      }
    }

    // Color match
    if (skuInfo.standardColor) {
      const productTitle = shopifyProduct.title.toLowerCase();
      const color = skuInfo.standardColor.toLowerCase();
      
      if (productTitle.includes(color)) {
        score += 15;
      }
      
      // Check variant titles
      for (const variant of shopifyProduct.variants || []) {
        if (variant.title && variant.title.toLowerCase().includes(color)) {
          score += 10;
          break;
        }
      }
    }

    // Size match
    if (skuInfo.standardSize) {
      const size = skuInfo.standardSize;
      
      for (const variant of shopifyProduct.variants || []) {
        if (variant.title && this.sizeMatches(variant.title, size)) {
          score += 10;
          break;
        }
      }
    }

    // Handle exact SKU match in variants
    for (const variant of shopifyProduct.variants || []) {
      if (variant.sku === skuInfo.originalSku) {
        score += 50; // High score for exact match
        break;
      }
    }

    return Math.min(score, maxScore);
  }

  /**
   * Get reasons for the match score
   */
  getMatchReasons(skuInfo, shopifyProduct, score) {
    const reasons = [];

    if (score >= 80) {
      reasons.push('High confidence match');
    } else if (score >= 60) {
      reasons.push('Good match');
    } else if (score >= 40) {
      reasons.push('Possible match');
    } else if (score > 0) {
      reasons.push('Low confidence match');
    }

    if (skuInfo.productCode) {
      const productTitle = shopifyProduct.title.toLowerCase();
      if (productTitle.includes(skuInfo.productCode.toLowerCase())) {
        reasons.push('Product code found in title');
      }
    }

    if (skuInfo.standardColor) {
      const productTitle = shopifyProduct.title.toLowerCase();
      if (productTitle.includes(skuInfo.standardColor.toLowerCase())) {
        reasons.push('Color match in title');
      }
    }

    // Check for exact SKU matches
    for (const variant of shopifyProduct.variants || []) {
      if (variant.sku === skuInfo.originalSku) {
        reasons.push('Exact SKU match found');
        break;
      }
    }

    return reasons;
  }

  /**
   * Generate mapping suggestions for vendor products
   */
  async generateMappingSuggestions(vendorProducts, shopifyProducts) {
    try {
      const suggestions = [];

      for (const vendorProduct of vendorProducts) {
        const matches = await this.findShopifyMatches(vendorProduct.sku, shopifyProducts);
        
        if (matches.length > 0) {
          const bestMatch = matches[0];
          
          suggestions.push({
            vendorSku: vendorProduct.sku,
            vendorProduct: {
              title: vendorProduct.title || vendorProduct.name,
              price: vendorProduct.price,
              inventory: vendorProduct.inventory
            },
            suggestedShopifyProduct: bestMatch.product,
            confidence: this.getConfidenceLevel(bestMatch.score),
            score: bestMatch.score,
            reasons: bestMatch.matchReasons,
            alternativeMatches: matches.slice(1, 4) // Top 3 alternatives
          });
        } else {
          suggestions.push({
            vendorSku: vendorProduct.sku,
            vendorProduct: {
              title: vendorProduct.title || vendorProduct.name,
              price: vendorProduct.price,
              inventory: vendorProduct.inventory
            },
            suggestedShopifyProduct: null,
            confidence: 'none',
            score: 0,
            reasons: ['No matching products found'],
            alternativeMatches: []
          });
        }
      }

      return suggestions;
    } catch (error) {
      logger.error('Error generating mapping suggestions:', error);
      throw error;
    }
  }

  /**
   * Validate mapping suggestion
   */
  validateMapping(vendorSku, shopifyProductId, shopifyVariantId = null) {
    try {
      const skuInfo = this.parseVendorSku(vendorSku);
      
      const validation = {
        valid: true,
        warnings: [],
        errors: [],
        suggestions: []
      };

      // Check if SKU was parsed successfully
      if (!skuInfo.parsed) {
        validation.warnings.push('Vendor SKU pattern not recognized - manual verification recommended');
      }

      // TODO: Add more validation logic
      // - Check if Shopify product exists
      // - Validate variant compatibility
      // - Check for duplicate mappings

      return validation;
    } catch (error) {
      logger.error('Error validating mapping:', error);
      return {
        valid: false,
        errors: [error.message]
      };
    }
  }

  /**
   * Standardize color name
   */
  standardizeColor(color) {
    const lowerColor = color.toLowerCase();
    
    for (const [standard, variants] of Object.entries(this.colorMappings)) {
      if (variants.includes(lowerColor)) {
        return standard;
      }
    }
    
    return color; // Return original if no mapping found
  }

  /**
   * Standardize size
   */
  standardizeSize(size) {
    const lowerSize = size.toLowerCase();
    
    for (const [standard, variants] of Object.entries(this.sizeMappings)) {
      if (variants.includes(lowerSize)) {
        return standard;
      }
    }
    
    return size.toUpperCase(); // Return uppercase if no mapping found
  }

  /**
   * Check if sizes match
   */
  sizeMatches(variantTitle, targetSize) {
    const title = variantTitle.toLowerCase();
    const size = targetSize.toLowerCase();
    
    // Direct match
    if (title.includes(size)) {
      return true;
    }
    
    // Check size mappings
    const variants = this.sizeMappings[targetSize.toUpperCase()] || [];
    return variants.some(variant => title.includes(variant));
  }

  /**
   * Get confidence level from score
   */
  getConfidenceLevel(score) {
    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    if (score >= 40) return 'low';
    return 'none';
  }

  /**
   * Extract product attributes from title and description
   */
  extractProductAttributes(title, description = '') {
    const attributes = {};
    const text = `${title} ${description}`.toLowerCase();

    // Extract color
    for (const [color, variants] of Object.entries(this.colorMappings)) {
      if (variants.some(variant => text.includes(variant))) {
        attributes.color = color;
        break;
      }
    }

    // Extract size
    for (const [size, variants] of Object.entries(this.sizeMappings)) {
      if (variants.some(variant => text.includes(variant))) {
        attributes.size = size;
        break;
      }
    }

    // Extract material (basic patterns)
    const materials = ['cotton', 'polyester', 'silk', 'wool', 'linen', 'denim', 'leather'];
    for (const material of materials) {
      if (text.includes(material)) {
        attributes.material = material;
        break;
      }
    }

    return attributes;
  }
}

module.exports = new ProductSelectorService();
