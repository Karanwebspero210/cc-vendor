const express = require('express');
const { authenticateAdmin } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { defaultLimiter, readOnlyLimiter } = require('../middleware/rate-limit.middleware');
const { ResponseHelper } = require('../utils/helpers');
const Store = require('../models/Store');
const shopifyService = require('../services/shopify.service');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all store routes
router.use(authenticateAdmin);

// Apply rate limiting
router.use('/*/products', readOnlyLimiter); // More lenient for read operations
router.use(defaultLimiter); // Default for other operations

/**
 * @route GET /api/stores
 * @desc Get all connected stores
 * @access Private
 */
router.get('/', validate.pagination, async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const [stores, total] = await Promise.all([
      Store.find({ isActive: true })
        .select('-accessToken') // Don't expose encrypted tokens
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Store.countDocuments({ isActive: true })
    ]);

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    };

    ResponseHelper.success(res, {
      stores,
      pagination
    }, 'Stores retrieved successfully');
  } catch (error) {
    logger.error('Error retrieving stores:', error);
    ResponseHelper.error(res, 'Failed to retrieve stores', 500, 'STORE_FETCH_ERROR');
  }
});

/**
 * @route POST /api/stores
 * @desc Connect a new Shopify store
 * @access Private
 */
router.post('/', validate.store.create, async (req, res) => {
  try {
    const { name, shopDomain, accessToken, description } = req.body;

    // Check if store already exists
    const existingStore = await Store.findByDomain(shopDomain);
    if (existingStore) {
      return ResponseHelper.error(res, 'Store with this domain already exists', 409, 'STORE_ALREADY_EXISTS');
    }

    // Test the connection before saving
    const connectionTest = await shopifyService.testConnection(shopDomain, accessToken);
    if (!connectionTest.success) {
      return ResponseHelper.error(res, 'Failed to connect to Shopify store: ' + connectionTest.error, 400, 'SHOPIFY_CONNECTION_FAILED');
    }

    // Create new store
    const store = new Store({
      name,
      shopDomain,
      accessToken, // Will be encrypted by the model setter
      description,
      shopifyShopId: connectionTest.shopInfo.id.toString(),
      connectionStatus: 'connected',
      metadata: {
        shopifyPlan: connectionTest.shopInfo.plan_name,
        timezone: connectionTest.shopInfo.timezone,
        currency: connectionTest.shopInfo.currency,
        country: connectionTest.shopInfo.country_name
      }
    });

    await store.save();

    // Remove sensitive data from response
    const storeResponse = store.toJSON();
    delete storeResponse.accessToken;

    logger.info(`New store connected: ${shopDomain}`, { storeId: store._id });
    ResponseHelper.success(res, storeResponse, 'Store connected successfully', 201);
  } catch (error) {
    logger.error('Error connecting store:', error);
    if (error.code === 11000) {
      ResponseHelper.error(res, 'Store with this domain already exists', 409, 'STORE_ALREADY_EXISTS');
    } else {
      ResponseHelper.error(res, 'Failed to connect store', 500, 'STORE_CONNECTION_ERROR');
    }
  }
});

/**
 * @route GET /api/stores/:id
 * @desc Get store by ID
 * @access Private
 */
router.get('/:id', validate.mongoId, async (req, res) => {
  try {
    const { id } = req.params;

    const store = await Store.findById(id).select('-accessToken');
    if (!store) {
      return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
    }

    if (!store.isActive) {
      return ResponseHelper.error(res, 'Store is inactive', 410, 'STORE_INACTIVE');
    }

    ResponseHelper.success(res, store, 'Store retrieved successfully');
  } catch (error) {
    logger.error('Error retrieving store:', error);
    ResponseHelper.error(res, 'Failed to retrieve store', 500, 'STORE_FETCH_ERROR');
  }
});

/**
 * @route PUT /api/stores/:id
 * @desc Update store configuration
 * @access Private
 */
router.put('/:id', validate.mongoId, validate.store.update, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, settings } = req.body;

    const store = await Store.findById(id);
    if (!store) {
      return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
    }

    if (!store.isActive) {
      return ResponseHelper.error(res, 'Cannot update inactive store', 410, 'STORE_INACTIVE');
    }

    // Update allowed fields
    if (name !== undefined) store.name = name;
    if (description !== undefined) store.description = description;
    if (settings !== undefined) {
      store.settings = { ...store.settings, ...settings };
    }

    await store.save();

    // Remove sensitive data from response
    const storeResponse = store.toJSON();
    delete storeResponse.accessToken;

    logger.info(`Store updated: ${store.shopifyDomain}`, { storeId: store._id });
    ResponseHelper.success(res, storeResponse, 'Store updated successfully');
  } catch (error) {
    logger.error('Error updating store:', error);
    ResponseHelper.error(res, 'Failed to update store', 500, 'STORE_UPDATE_ERROR');
  }
});

/**
 * @route DELETE /api/stores/:id
 * @desc Disconnect store
 * @access Private
 */
router.delete('/:id', validate.mongoId, async (req, res) => {
  try {
    const { id } = req.params;

    const store = await Store.findById(id);
    if (!store) {
      return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
    }

    if (!store.isActive) {
      return ResponseHelper.error(res, 'Store is already disconnected', 410, 'STORE_ALREADY_DISCONNECTED');
    }

    // Soft delete - mark as inactive instead of removing
    store.isActive = false;
    store.connectionStatus = 'disconnected';
    await store.save();

    logger.info(`Store disconnected: ${store.shopifyDomain}`, { storeId: store._id });
    ResponseHelper.success(res, null, 'Store disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting store:', error);
    ResponseHelper.error(res, 'Failed to disconnect store', 500, 'STORE_DISCONNECT_ERROR');
  }
});

/**
 * @route GET /api/stores/:id/products
 * @desc Get products from a specific store
 * @access Private
 */
router.get('/:id/products', validate.mongoId, validate.pagination, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const { query: searchQuery } = req.query;

    const store = await Store.findById(id);
    if (!store) {
      return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
    }

    if (!store.isActive) {
      return ResponseHelper.error(res, 'Store is inactive', 410, 'STORE_INACTIVE');
    }

    if (store.connectionStatus !== 'connected') {
      return ResponseHelper.error(res, 'Store is not connected', 400, 'STORE_NOT_CONNECTED');
    }

    // Calculate cursor for pagination (Shopify uses cursor-based pagination)
    const cursor = page > 1 ? Buffer.from(`page:${page}`).toString('base64') : null;

    const products = await shopifyService.getProducts(id, {
      limit: parseInt(limit),
      cursor,
      query: searchQuery
    });

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      hasNext: products.pageInfo.hasNextPage,
      hasPrev: products.pageInfo.hasPreviousPage
    };

    ResponseHelper.success(res, {
      products: products.edges.map(edge => edge.node),
      pagination
    }, 'Store products retrieved successfully');
  } catch (error) {
    logger.error('Error retrieving store products:', error);
    ResponseHelper.error(res, 'Failed to retrieve store products', 500, 'STORE_PRODUCTS_ERROR');
  }
});

/**
 * @route POST /api/stores/:id/test-connection
 * @desc Test store connection
 * @access Private
 */
router.post('/:id/test-connection', validate.mongoId, async (req, res) => {
  try {
    const { id } = req.params;

    const store = await Store.findById(id);
    if (!store) {
      return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
    }

    if (!store.isActive) {
      return ResponseHelper.error(res, 'Cannot test connection for inactive store', 410, 'STORE_INACTIVE');
    }

    // Get decrypted access token and test connection
    const accessToken = store.getDecryptedToken();
    const connectionTest = await shopifyService.testConnection(store.shopifyDomain, accessToken);

    // Update connection status based on test result
    const newStatus = connectionTest.success ? 'connected' : 'error';
    await store.updateConnectionStatus(newStatus, connectionTest.error);

    const response = {
      connected: connectionTest.success,
      shopInfo: connectionTest.shopInfo || null,
      error: connectionTest.error || null,
      lastChecked: new Date().toISOString()
    };

    if (connectionTest.success) {
      logger.info(`Store connection test successful: ${store.shopifyDomain}`, { storeId: store._id });
      ResponseHelper.success(res, response, 'Store connection test successful');
    } else {
      logger.warn(`Store connection test failed: ${store.shopifyDomain}`, { storeId: store._id, error: connectionTest.error });
      ResponseHelper.error(res, 'Store connection test failed: ' + connectionTest.error, 400, 'CONNECTION_TEST_FAILED', response);
    }
  } catch (error) {
    logger.error('Error testing store connection:', error);
    ResponseHelper.error(res, 'Store connection test failed', 500, 'CONNECTION_TEST_ERROR');
  }
});

module.exports = router;
