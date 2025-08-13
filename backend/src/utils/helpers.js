const moment = require('moment');
const logger = require('./logger');

/**
 * SKU Pattern Recognition and Parsing
 */
class SKUHelper {
  static patterns = [
    // Pattern: noxa_E467W-White-2-CCSALE
    /^noxa_([A-Z0-9]+)-([A-Za-z]+)-([A-Za-z0-9]+)-?([A-Z]*)/,
    // Pattern: noxa_6015-NUDE-XS
    /^noxa_([A-Z0-9]+)-([A-Z]+)-([A-Z]+)/,
    // Pattern: E467W (main SKU)
    /^([A-Z0-9]+)$/,
    // Pattern: vendor_SKU-COLOR-SIZE
    /^([a-z]+)_([A-Z0-9]+)-([A-Za-z]+)-([A-Za-z0-9]+)/
  ];

  /**
   * Parse SKU to extract components
   * @param {string} sku - SKU to parse
   * @returns {object} - Parsed SKU components
   */
  static parseSKU(sku) {
    if (!sku) return null;

    for (const pattern of this.patterns) {
      const match = sku.match(pattern);
      if (match) {
        return {
          originalSku: sku,
          mainSku: match[1],
          color: match[2] || null,
          size: match[3] || null,
          suffix: match[4] || null,
          prefix: sku.includes('_') ? sku.split('_')[0] + '_' : null,
          isVariant: match.length > 2
        };
      }
    }

    return {
      originalSku: sku,
      mainSku: sku,
      color: null,
      size: null,
      suffix: null,
      prefix: null,
      isVariant: false
    };
  }

  /**
   * Extract main SKU from variant SKU
   * @param {string} variantSku - Variant SKU
   * @returns {string} - Main SKU
   */
  static extractMainSKU(variantSku) {
    const parsed = this.parseSKU(variantSku);
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
  static generateVariantSKU({ mainSku, color, size, prefix = 'noxa_', suffix = '' }) {
    let sku = `${prefix}${mainSku}`;
    if (color) sku += `-${color}`;
    if (size) sku += `-${size}`;
    if (suffix) sku += `-${suffix}`;
    return sku;
  }
}

/**
 * API Response Helpers
 */
class ResponseHelper {
  /**
   * Success response
   * @param {object} res - Express response object
   * @param {any} data - Response data
   * @param {string} message - Success message
   * @param {number} statusCode - HTTP status code
   */
  static success(res, data = null, message = 'Success', statusCode = 200) {
    const response = {
      success: true,
      message,
      timestamp: new Date().toISOString()
    };

    if (data !== null) {
      response.data = data;
    }

    return res.status(statusCode).json(response);
  }

  /**
   * Error response
   * @param {object} res - Express response object
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {string} code - Error code
   * @param {any} details - Error details
   */
  static error(res, message = 'Internal Server Error', statusCode = 500, code = null, details = null) {
    const response = {
      success: false,
      error: {
        message,
        timestamp: new Date().toISOString()
      }
    };

    if (code) response.error.code = code;
    if (details) response.error.details = details;

    logger.error('API Error:', {
      message,
      statusCode,
      code,
      details
    });

    return res.status(statusCode).json(response);
  }

  /**
   * Validation error response
   * @param {object} res - Express response object
   * @param {array} errors - Validation errors
   */
  static validationError(res, errors) {
    return this.error(res, 'Validation failed', 400, 'VALIDATION_ERROR', errors);
  }

  /**
   * Paginated response
   * @param {object} res - Express response object
   * @param {array} data - Response data
   * @param {object} pagination - Pagination info
   * @param {string} message - Success message
   */
  static paginated(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Validation Helpers
 */
class ValidationHelper {
  /**
   * Validate Shopify domain
   * @param {string} domain - Domain to validate
   * @returns {boolean} - True if valid
   */
  static isValidShopifyDomain(domain) {
    const pattern = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]\.myshopify\.com$/;
    return pattern.test(domain);
  }

  /**
   * Validate Shopify access token
   * @param {string} token - Token to validate
   * @returns {boolean} - True if valid format
   */
  static isValidShopifyToken(token) {
    const pattern = /^shpat_[a-zA-Z0-9]{32}$/;
    return pattern.test(token);
  }

  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} - True if valid
   */
  static isValidEmail(email) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(email);
  }

  /**
   * Validate URL format
   * @param {string} url - URL to validate
   * @returns {boolean} - True if valid
   */
  static isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate cron expression
   * @param {string} cronExpression - Cron expression to validate
   * @returns {boolean} - True if valid
   */
  static isValidCronExpression(cronExpression) {
    const pattern = /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
    return pattern.test(cronExpression);
  }
}

/**
 * Date and Time Helpers
 */
class DateHelper {
  /**
   * Format date for display
   * @param {Date|string} date - Date to format
   * @param {string} format - Moment.js format string
   * @returns {string} - Formatted date
   */
  static format(date, format = 'YYYY-MM-DD HH:mm:ss') {
    return moment(date).format(format);
  }

  /**
   * Get relative time
   * @param {Date|string} date - Date to get relative time for
   * @returns {string} - Relative time string
   */
  static fromNow(date) {
    return moment(date).fromNow();
  }

  /**
   * Check if date is within last N minutes
   * @param {Date|string} date - Date to check
   * @param {number} minutes - Minutes threshold
   * @returns {boolean} - True if within threshold
   */
  static isWithinMinutes(date, minutes) {
    return moment().diff(moment(date), 'minutes') <= minutes;
  }

  /**
   * Get next cron execution time
   * @param {string} cronExpression - Cron expression
   * @returns {Date} - Next execution time
   */
  static getNextCronExecution(cronExpression) {
    // This is a simplified implementation
    // In production, use a proper cron parser library
    const now = new Date();
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
    return nextHour;
  }
}

/**
 * Array and Object Helpers
 */
class ArrayHelper {
  /**
   * Chunk array into smaller arrays
   * @param {array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {array} - Array of chunks
   */
  static chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Remove duplicates from array
   * @param {array} array - Array with duplicates
   * @param {string} key - Key to check for duplicates (for objects)
   * @returns {array} - Array without duplicates
   */
  static unique(array, key = null) {
    if (!key) {
      return [...new Set(array)];
    }
    
    const seen = new Set();
    return array.filter(item => {
      const value = item[key];
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  }

  /**
   * Group array by key
   * @param {array} array - Array to group
   * @param {string} key - Key to group by
   * @returns {object} - Grouped object
   */
  static groupBy(array, key) {
    return array.reduce((groups, item) => {
      const value = item[key];
      if (!groups[value]) {
        groups[value] = [];
      }
      groups[value].push(item);
      return groups;
    }, {});
  }
}

module.exports = {
  SKUHelper,
  ResponseHelper,
  ValidationHelper,
  DateHelper,
  ArrayHelper
};
