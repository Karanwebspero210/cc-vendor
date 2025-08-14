const Joi = require('joi');
const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Validation Middleware
 * Provides request validation using Joi schemas
 */

// Common validation schemas
const schemas = {
  // Store validation
  store: {
    create: Joi.object({
      name: Joi.string().required().min(1).max(100),
      shopDomain: Joi.string().required().pattern(/^[a-zA-Z0-9-]+\.myshopify\.com$/),
      accessToken: Joi.string().required().min(10),
      description: Joi.string().optional().max(500)
    }),
    update: Joi.object({
      name: Joi.string().optional().min(1).max(100),
      description: Joi.string().optional().max(500),
      settings: Joi.object().optional()
    })
  },

  // Vendor validation
  vendor: {
    create: Joi.object({
      name: Joi.string().required().min(1).max(100),
      apiUrl: Joi.string().required().uri(),
      apiKey: Joi.string().required().min(10),
      description: Joi.string().optional().max(500),
      settings: Joi.object().optional()
    }),
    update: Joi.object({
      name: Joi.string().optional().min(1).max(100),
      apiUrl: Joi.string().optional().uri(),
      apiKey: Joi.string().optional().min(10),
      description: Joi.string().optional().max(500),
      settings: Joi.object().optional()
    })
  },

  // Sync validation
  sync: {
    manual: Joi.object({
      storeId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      vendorId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      syncType: Joi.string().valid('inventory', 'products', 'full').default('inventory'),
      options: Joi.object({
        direction: Joi.string().valid('vendor-to-store', 'store-to-vendor').default('vendor-to-store'),
        dryRun: Joi.boolean().default(false),
        createMissing: Joi.boolean().default(false),
        updateExisting: Joi.boolean().default(true)
      }).optional()
    }),
    batch: Joi.object({
      operations: Joi.array().items(
        Joi.object({
          storeId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
          vendorId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
          syncType: Joi.string().valid('inventory', 'products', 'full').required(),
          options: Joi.object().optional()
        })
      ).required().min(1).max(50),
      priority: Joi.string().valid('low', 'normal', 'high').default('normal')
    })
  },

  // Mapping validation
  mapping: {
    create: Joi.object({
      storeId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      vendorId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      shopifyProductId: Joi.string().required(),
      shopifyVariantId: Joi.string().optional(),
      vendorSku: Joi.string().required().min(1).max(100),
      syncSettings: Joi.object({
        enabled: Joi.boolean().default(true),
        syncInventory: Joi.boolean().default(true),
        syncPrice: Joi.boolean().default(false),
        inventoryBuffer: Joi.number().integer().min(0).default(0)
      }).optional()
    }),
    update: Joi.object({
      syncSettings: Joi.object({
        enabled: Joi.boolean().optional(),
        syncInventory: Joi.boolean().optional(),
        syncPrice: Joi.boolean().optional(),
        inventoryBuffer: Joi.number().integer().min(0).optional()
      }).optional(),
      isActive: Joi.boolean().optional()
    }),
    bulk: Joi.object({
      mappings: Joi.array().items(
        Joi.object({
          storeId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
          vendorId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
          shopifyProductId: Joi.string().required(),
          vendorSku: Joi.string().required()
        })
      ).required().min(1).max(100)
    })
  },

  // Cron validation
  cron: {
    create: Joi.object({
      name: Joi.string().required().min(1).max(100),
      cronExpression: Joi.string().required().pattern(/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/),
      storeId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      vendorId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
      syncConfig: Joi.object({
        syncType: Joi.string().valid('inventory', 'products', 'full').default('inventory'),
        direction: Joi.string().valid('vendor-to-store', 'store-to-vendor').default('vendor-to-store'),
        options: Joi.object().optional()
      }).required()
    }),
    update: Joi.object({
      name: Joi.string().optional().min(1).max(100),
      cronExpression: Joi.string().optional(),
      syncConfig: Joi.object().optional(),
      isActive: Joi.boolean().optional()
    })
  },

  // Auth validation
  auth: {
    login: Joi.object({
      email: Joi.string().email().required().trim().lowercase(),
      password: Joi.string().required().min(1)
    }),
    changePassword: Joi.object({
      currentPassword: Joi.string().required().min(1),
      newPassword: Joi.string().required().min(8).max(128)
    })
  },

  // Common query validation
  query: {
    pagination: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(50)
    }),
    // Inventory list filters
    inventoryList: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(200).default(50),
      status: Joi.string().optional(), // CSV supported in controller
      sku: Joi.string().optional().max(200),
      variantSku: Joi.string().optional().max(200),
      search: Joi.string().optional().max(200),
      stockQtyMin: Joi.number().optional(),
      stockQtyMax: Joi.number().optional()
    }),
    search: Joi.object({
      query: Joi.string().optional().max(100),
      status: Joi.string().optional(),
      type: Joi.string().optional()
    })
  }
};

/**
 * Create validation middleware for request body
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Request validation failed:', { errors, body: req.body });
      
      return ResponseHelper.error(
        res,
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        { errors }
      );
    }

    req.body = value;
    next();
  };
}

/**
 * Create validation middleware for query parameters
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Query validation failed:', { errors, query: req.query });
      
      return ResponseHelper.error(
        res,
        'Query validation failed',
        400,
        'QUERY_VALIDATION_ERROR',
        { errors }
      );
    }

    req.query = value;
    next();
  };
}

/**
 * Create validation middleware for URL parameters
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
      allowUnknown: false
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }));

      logger.warn('Params validation failed:', { errors, params: req.params });
      
      return ResponseHelper.error(
        res,
        'Parameter validation failed',
        400,
        'PARAMS_VALIDATION_ERROR',
        { errors }
      );
    }

    req.params = value;
    next();
  };
}

/**
 * MongoDB ObjectId validation schema
 */
const mongoIdSchema = Joi.object({
  id: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/).messages({
    'string.pattern.base': 'Invalid ID format'
  })
});

/**
 * Common validation middleware functions
 */
const validate = {
  // Body validation
  body: validateBody,
  
  // Query validation
  query: validateQuery,
  
  // Params validation
  params: validateParams,
  
  // MongoDB ID validation
  mongoId: validateParams(mongoIdSchema),
  
  // Pagination validation
  pagination: validateQuery(schemas.query.pagination),
  
  // Inventory list query validation
  inventoryList: validateQuery(schemas.query.inventoryList),
  
  // Search validation
  search: validateQuery(schemas.query.search),
  
  // Store validation
  store: {
    create: validateBody(schemas.store.create),
    update: validateBody(schemas.store.update)
  },
  
  // Vendor validation
  vendor: {
    create: validateBody(schemas.vendor.create),
    update: validateBody(schemas.vendor.update)
  },
  
  // Sync validation
  sync: {
    manual: validateBody(schemas.sync.manual),
    batch: validateBody(schemas.sync.batch)
  },
  
  // Mapping validation
  mapping: {
    create: validateBody(schemas.mapping.create),
    update: validateBody(schemas.mapping.update),
    bulk: validateBody(schemas.mapping.bulk)
  },
  
  // Cron validation
  cron: {
    create: validateBody(schemas.cron.create),
    update: validateBody(schemas.cron.update)
  },
  
  // Auth validation
  auth: {
    login: validateBody(schemas.auth.login),
    changePassword: validateBody(schemas.auth.changePassword)
  }
};

module.exports = {
  validate,
  schemas,
  validateBody,
  validateQuery,
  validateParams
};
