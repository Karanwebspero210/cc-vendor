const logger = require('./logger');

/**
 * SKU Pattern Recognition and Parsing Utility
 * Handles parsing of vendor SKUs and mapping to Shopify products
 */
class SKUParser {
  static patterns = [
    // Pattern: noxa_E467W-White-2-CCSALE (vendor_mainSku-color-size-suffix)
    {
      regex: /^noxa_([A-Z0-9]+)-([A-Za-z]+)-([A-Za-z0-9]+)-?([A-Z]*)/,
      type: 'noxa_full',
      groups: ['vendor', 'mainSku', 'color', 'size', 'suffix']
    },
    // Pattern: noxa_6015-NUDE-XS (vendor_mainSku-color-size)
    {
      regex: /^noxa_([A-Z0-9]+)-([A-Z]+)-([A-Z]+)/,
      type: 'noxa_standard',
      groups: ['vendor', 'mainSku', 'color', 'size']
    },
    // Pattern: E467W (main SKU only)
    {
      regex: /^([A-Z0-9]+)$/,
      type: 'main_sku',
      groups: ['mainSku']
    },
    // Pattern: vendor_SKU-COLOR-SIZE (generic vendor format)
    {
      regex: /^([a-z]+)_([A-Z0-9]+)-([A-Za-z]+)-([A-Za-z0-9]+)/,
      type: 'vendor_generic',
      groups: ['vendor', 'mainSku', 'color', 'size']
    },
    // Pattern: SKU-COLOR-SIZE (no vendor prefix)
    {
      regex: /^([A-Z0-9]+)-([A-Za-z]+)-([A-Za-z0-9]+)/,
      type: 'no_vendor',
      groups: ['mainSku', 'color', 'size']
    }
  ];

  /**
   * Parse SKU to extract components
   * @param {string} sku - SKU to parse
   * @returns {object|null} - Parsed SKU components or null if no match
   */
  static parse(sku) {
    if (!sku || typeof sku !== 'string') {
      logger.warn('Invalid SKU provided for parsing:', sku);
      return null;
    }

    const trimmedSku = sku.trim();

    for (const pattern of this.patterns) {
      const match = trimmedSku.match(pattern.regex);
      if (match) {
        const result = {
          originalSku: sku,
          trimmedSku,
          patternType: pattern.type,
          isVariant: pattern.groups.length > 1
        };

        // Map matched groups to named properties
        pattern.groups.forEach((groupName, index) => {
          result[groupName] = match[index + 1] || null;
        });

        // Extract vendor prefix if present
        if (trimmedSku.includes('_')) {
          result.vendorPrefix = trimmedSku.split('_')[0];
        }

        // Determine if this is a main product or variant
        result.isMainProduct = !result.color && !result.size;

        logger.debug('SKU parsed successfully:', result);
        return result;
      }
    }

    // If no pattern matches, return basic structure
    logger.debug('No pattern matched for SKU, returning basic structure:', sku);
    return {
      originalSku: sku,
      trimmedSku,
      mainSku: trimmedSku,
      patternType: 'unknown',
      isVariant: false,
      isMainProduct: true,
      vendor: null,
      vendorPrefix: null,
      color: null,
      size: null,
      suffix: null
    };
  }

  /**
   * Extract main SKU from variant SKU
   * @param {string} variantSku - Variant SKU
   * @returns {string} - Main SKU
   */
  static extractMainSKU(variantSku) {
    const parsed = this.parse(variantSku);
    return parsed ? parsed.mainSku : variantSku;
  }

  /**
   * Check if two SKUs are related (same main SKU)
   * @param {string} sku1 - First SKU
   * @param {string} sku2 - Second SKU
   * @returns {boolean} - True if related
   */
  static areRelated(sku1, sku2) {
    const main1 = this.extractMainSKU(sku1);
    const main2 = this.extractMainSKU(sku2);
    return main1 === main2;
  }

  /**
   * Generate variant SKU from components
   * @param {object} components - SKU components
   * @returns {string} - Generated SKU
   */
  static generateVariantSKU(components) {
    const {
      mainSku,
      color,
      size,
      vendor = 'noxa',
      suffix = ''
    } = components;

    if (!mainSku) {
      throw new Error('Main SKU is required to generate variant SKU');
    }

    let sku = `${vendor}_${mainSku}`;
    
    if (color) {
      sku += `-${color}`;
    }
    
    if (size) {
      sku += `-${size}`;
    }
    
    if (suffix) {
      sku += `-${suffix}`;
    }

    return sku;
  }

  /**
   * Normalize SKU format
   * @param {string} sku - SKU to normalize
   * @returns {string} - Normalized SKU
   */
  static normalize(sku) {
    if (!sku) return '';

    const parsed = this.parse(sku);
    if (!parsed) return sku;

    // Rebuild SKU in standard format
    if (parsed.vendor && parsed.mainSku) {
      return this.generateVariantSKU({
        mainSku: parsed.mainSku,
        color: parsed.color,
        size: parsed.size,
        vendor: parsed.vendor,
        suffix: parsed.suffix
      });
    }

    return sku;
  }

  /**
   * Get all possible variant SKUs for a main SKU
   * @param {string} mainSku - Main SKU
   * @param {array} colors - Available colors
   * @param {array} sizes - Available sizes
   * @param {string} vendor - Vendor prefix
   * @returns {array} - Array of variant SKUs
   */
  static generateAllVariants(mainSku, colors = [], sizes = [], vendor = 'noxa') {
    const variants = [];

    // Add main SKU
    variants.push(`${vendor}_${mainSku}`);

    // Generate color variants
    for (const color of colors) {
      variants.push(`${vendor}_${mainSku}-${color}`);

      // Generate color + size variants
      for (const size of sizes) {
        variants.push(`${vendor}_${mainSku}-${color}-${size}`);
      }
    }

    // Generate size-only variants
    for (const size of sizes) {
      variants.push(`${vendor}_${mainSku}-${size}`);
    }

    return variants;
  }

  /**
   * Extract product information from SKU for mapping
   * @param {string} sku - SKU to analyze
   * @returns {object} - Product mapping information
   */
  static extractProductInfo(sku) {
    const parsed = this.parse(sku);
    if (!parsed) return null;

    return {
      mainSku: parsed.mainSku,
      isVariant: parsed.isVariant,
      hasColor: !!parsed.color,
      hasSize: !!parsed.size,
      color: parsed.color,
      size: parsed.size,
      vendor: parsed.vendor || parsed.vendorPrefix,
      patternType: parsed.patternType,
      searchTerms: this.generateSearchTerms(parsed)
    };
  }

  /**
   * Generate search terms for product matching
   * @param {object} parsed - Parsed SKU object
   * @returns {array} - Array of search terms
   */
  static generateSearchTerms(parsed) {
    const terms = [];

    // Add main SKU
    if (parsed.mainSku) {
      terms.push(parsed.mainSku);
    }

    // Add original SKU
    terms.push(parsed.originalSku);

    // Add SKU without vendor prefix
    if (parsed.vendorPrefix) {
      const withoutPrefix = parsed.originalSku.replace(`${parsed.vendorPrefix}_`, '');
      terms.push(withoutPrefix);
    }

    // Add color and size combinations
    if (parsed.color && parsed.size) {
      terms.push(`${parsed.mainSku} ${parsed.color} ${parsed.size}`);
      terms.push(`${parsed.color} ${parsed.size}`);
    }

    // Add individual attributes
    if (parsed.color) {
      terms.push(parsed.color);
    }

    if (parsed.size) {
      terms.push(parsed.size);
    }

    return [...new Set(terms)]; // Remove duplicates
  }

  /**
   * Validate SKU format
   * @param {string} sku - SKU to validate
   * @returns {object} - Validation result
   */
  static validate(sku) {
    if (!sku || typeof sku !== 'string') {
      return {
        isValid: false,
        error: 'SKU must be a non-empty string'
      };
    }

    const trimmed = sku.trim();
    
    if (trimmed.length === 0) {
      return {
        isValid: false,
        error: 'SKU cannot be empty'
      };
    }

    if (trimmed.length > 100) {
      return {
        isValid: false,
        error: 'SKU is too long (max 100 characters)'
      };
    }

    // Check for invalid characters
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      return {
        isValid: false,
        error: 'SKU contains invalid characters (only letters, numbers, underscore, and hyphen allowed)'
      };
    }

    const parsed = this.parse(trimmed);
    
    return {
      isValid: true,
      parsed,
      suggestions: parsed ? [] : ['Check SKU format against known patterns']
    };
  }

  /**
   * Get pattern statistics for debugging
   * @param {array} skus - Array of SKUs to analyze
   * @returns {object} - Pattern usage statistics
   */
  static getPatternStats(skus) {
    const stats = {
      total: skus.length,
      patterns: {},
      unparsed: 0
    };

    for (const sku of skus) {
      const parsed = this.parse(sku);
      if (parsed) {
        const pattern = parsed.patternType;
        stats.patterns[pattern] = (stats.patterns[pattern] || 0) + 1;
      } else {
        stats.unparsed++;
      }
    }

    return stats;
  }
}

module.exports = SKUParser;
