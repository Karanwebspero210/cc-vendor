const axios = require('axios');
const { encrypt, decrypt } = require('../utils/encryption');
const logger = require('../utils/logger');
const Store = require('../models/Store');

/**
 * Shopify Service
 * Handles all Shopify API interactions and store management
 */
class ShopifyService {
  constructor() {
    this.apiVersion = process.env.SHOPIFY_API_VERSION || '2023-10';
  }

  /**
   * Fetch inventoryItemId and inventoryQuantity for a given variant ID (GID)
   */
  async getInventoryItemForVariant(storeId, variantId) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      const query = `
        query variantInventory($id: ID!) {
          productVariant(id: $id) {
            id
            inventoryQuantity
            inventoryItem { id }
          }
        }
      `;
      const variables = { id: variantId };
      const resp = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, query, variables);
      const v = resp.data?.data?.productVariant;
      return {
        inventoryItemId: v?.inventoryItem?.id || null,
        inventoryQuantity: typeof v?.inventoryQuantity === 'number' ? v.inventoryQuantity : null
      };
    } catch (error) {
      logger.error('Error fetching inventory item for variant:', error);
      throw error;
    }
  }

  /**
   * Get product variants by SKUs using GraphQL productVariants search
   * Returns a map keyed by lowercased SKU -> { variantId, inventoryItemId, inventoryQuantity, raw }
   */
  async getProductVariantsBySkus(storeId, skus = []) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      if (!Array.isArray(skus) || skus.length === 0) {
        return new Map();
      }

      const accessToken = decrypt(store.accessToken);

      const graphqlQuery = `
        query productVariantsBySku($first: Int!, $query: String!, $after: String) {
          productVariants(first: $first, query: $query, after: $after) {
            edges {
              cursor
              node {
                id
                title
                sku
                inventoryQuantity
                inventoryItem { id }
                product { id title }
              }
            }
            pageInfo { hasNextPage }
          }
        }
      `;

      // Shopify search length/complexity can be limited; chunk SKUs conservatively
      const chunkSize = 25;
      const outMap = new Map();
      const sleep = (ms) => new Promise(res => setTimeout(res, ms));
      const perChunkDelayMs = Number(process.env.SHOPIFY_GRAPHQL_CHUNK_DELAY_MS || 200); // throttle between chunk requests
      // Helper to safely escape quotes/backslashes in SKUs for GraphQL search
      const escapeSku = (s) => String(s).trim().replace(/\\/g, '\\\\').replace(/\"/g, '\\"');
      for (let i = 0; i < skus.length; i += chunkSize) {
        const chunk = skus.slice(i, i + chunkSize).filter(Boolean);
        if (!chunk.length) continue;
        // Quote SKUs to ensure exact-match search even when SKUs contain spaces/special characters
        const orQuery = chunk.map(s => `sku:\"${escapeSku(s)}\"`).join(' OR ');
        let after = null;
        let page = 0;
        do {
          const variables = { first: 100, query: orQuery, after };
          const resp = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, graphqlQuery, variables);
          const body = resp.data?.data?.productVariants;
          const edges = body?.edges || [];
          for (const edge of edges) {
            const node = edge?.node;
            if (!node?.sku) continue;
            const key = String(node.sku).toLowerCase();
            outMap.set(key, {
              variantId: node.id,
              inventoryItemId: node.inventoryItem?.id || null,
              inventoryQuantity: typeof node.inventoryQuantity === 'number' ? node.inventoryQuantity : null,
              raw: node
            });
          }
          after = edges.length ? edges[edges.length - 1].cursor : null;
          page++;
          // small delay to avoid hammering Shopify
          await sleep(perChunkDelayMs);
          if (!body?.pageInfo?.hasNextPage) break;
        } while (true);
      }

      return outMap;
    } catch (error) {
      logger.error('Error getting product variants by SKUs:', error);
      throw error;
    }
  }

  /**
   * Get primary location ID for a store and cache it in Store.settings.defaultLocationId
   */
  async getPrimaryLocationId(storeId) {
    const store = await Store.findById(storeId);
    if (!store) throw new Error('Store not found');

    // Return cached if available
    if (store.settings?.defaultLocationId) {
      return store.settings.defaultLocationId;
    }

    const accessToken = decrypt(store.accessToken);

    const query = `
      query locations($first: Int!) {
        locations(first: $first) {
          edges {
            node {
              id
              name
              isActive
              legacyResourceId
            }
          }
        }
      }
    `;

    const resp = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, query, { first: 5 });
    const edges = resp.data?.data?.locations?.edges || [];
    if (!edges.length) throw new Error('No Shopify locations found');

    // Choose the first active as primary
    const active = edges.find(e => e.node?.isActive) || edges[0];
    const locationId = active.node.id;

    // Cache on store
    store.settings = store.settings || {};
    store.settings.defaultLocationId = locationId;
    await store.save();

    return locationId;
  }

  /**
   * Test Shopify store connection using app access token
   * Validates the connection and checks required permissions
   * @param {string} shopDomain - The Shopify store domain (e.g., 'mystore.myshopify.com')
   * @param {string} accessToken - The Shopify Admin API access token from the store
   * @returns {Promise<Object>} - Object containing success status and shop info or error
   */
  async testConnection(shopDomain, accessToken) {
    try {
      // Validate input parameters
      if (!shopDomain || !accessToken) {
        throw new Error('Shop domain and access token are required');
      }

      // Normalize the shop domain
      const normalizedDomain = shopDomain
        .replace(/^https?:\/\//, '') // Remove http:// or https://
        .replace(/\/.*$/, '')         // Remove any path
        .toLowerCase();

      // Make a request to the shop endpoint to verify the token
      const response = await this.makeRequest(normalizedDomain, accessToken, 'shop.json');
      
      // Check if we got a valid response
      if (!response.data || !response.data.shop) {
        throw new Error('Invalid response format from Shopify API');
      }

      const { shop } = response.data;     

      return {
        success: true,
        shopInfo: {
          id: shop.id,
          name: shop.name,
          email: shop.email,
          domain: shop.domain,
          iana_timezone: shop.iana_timezone,
          currency: shop.currency,
          timezone_offset: shop.timezone_offset,
          timezone_abbreviation: shop.timezone_abbreviation,
          timezone_offset_minutes: shop.timezone_offset_minutes,
          timezone_offset_minutes_clock: shop.timezone_offset_minutes_clock,
          timezone_abbr: shop.timezone_abbr,
        }
      };

    } catch (error) {
      let errorMessage = 'Failed to connect to Shopify store';
      let errorDetails = {};

      if (error.response) {
        // Handle different HTTP status codes
        const { status, statusText, data } = error.response;
        
        switch (status) {
          case 401:
            errorMessage = 'Invalid access token. Please check your credentials.';
            break;
          case 403:
            errorMessage = 'Access denied. The provided access token does not have sufficient permissions.';
            break;
          case 404:
            errorMessage = 'Shop not found. Please check the store domain.';
            break;
          case 429:
            errorMessage = 'API rate limit exceeded. Please try again later.';
            break;
          default:
            errorMessage = `Shopify API Error: ${status} ${statusText}`;
        }
        
        errorDetails = {
          statusCode: status,
          statusText,
          url: error.config?.url,
          method: error.config?.method
        };
      } else {
        errorMessage = error.message || errorMessage;
      }
      
      logger.error(`Shopify connection test failed: ${errorMessage}`, errorDetails);
      
      return {
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      };
    }
  }

  /**
   * Get shop information
   */
  async getShopInfo(storeId) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      const response = await this.makeRequest(store.shopDomain, accessToken, 'shop.json');
      
      return response.data.shop;
    } catch (error) {
      logger.error('Error getting shop info:', error);
      throw error;
    }
  }

  /**
   * Get products from Shopify store using GraphQL
   */
  async getProducts(storeId, options = {}) {
    try {
      const { limit = 50, cursor, query } = options;
      const store = await Store.findById(storeId);
      
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      
      const graphqlQuery = `
        query getProducts($first: Int!, $after: String, $query: String) {
          products(first: $first, after: $after, query: $query) {
            edges {
              node {
                id
                title
                handle
                status
                createdAt
                updatedAt
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                      inventoryQuantity
                      inventoryItem {
                        id
                        tracked
                      }
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
            }
          }
        }
      `;

      const variables = {
        first: limit,
        after: cursor,
        query
      };

      const response = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, graphqlQuery, variables);
      return response.data.data.products;
    } catch (error) {
      logger.error('Error getting Shopify products:', error);
      throw error;
    }
  }

  /**
   * Get inventory levels for products
   */
  async getInventoryLevels(storeId, inventoryItemIds = []) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      
      const graphqlQuery = `
        query getInventoryLevels($inventoryItemIds: [ID!]!) {
          inventoryItems(ids: $inventoryItemIds) {
            id
            tracked
            inventoryLevels(first: 10) {
              edges {
                node {
                  id
                  available
                  location {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      `;

      const variables = { inventoryItemIds };
      const response = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, graphqlQuery, variables);
      
      return response.data.data.inventoryItems;
    } catch (error) {
      logger.error('Error getting inventory levels:', error);
      throw error;
    }
  }

  /**
   * Update inventory quantity for a variant
   */
  async updateInventory(storeId, variantId, quantity, locationId) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      
      const graphqlMutation = `
        mutation inventoryAdjustQuantity($input: InventoryAdjustQuantityInput!) {
          inventoryAdjustQuantity(input: $input) {
            inventoryLevel {
              id
              available
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = {
        input: {
          inventoryLevelId: `gid://shopify/InventoryLevel/${locationId}?inventory_item_id=${variantId}`,
          availableDelta: quantity
        }
      };

      const response = await this.makeGraphQLRequest(store.shopifyDomain, accessToken, graphqlMutation, variables);
      
      if (response.data.data.inventoryAdjustQuantity.userErrors.length > 0) {
        throw new Error(response.data.data.inventoryAdjustQuantity.userErrors[0].message);
      }

      return response.data.data.inventoryAdjustQuantity.inventoryLevel;
    } catch (error) {
      logger.error('Error updating inventory:', error);
      throw error;
    }
  }

  /**
   * Create or update products in Shopify
   */
  async createProduct(storeId, productData) {
    try {
      const store = await Store.findById(storeId);
      if (!store) {
        throw new Error('Store not found');
      }

      const accessToken = decrypt(store.accessToken);
      
      const graphqlMutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product {
              id
              title
              handle
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const variables = { input: productData };
      const response = await this.makeGraphQLRequest(store.shopDomain, accessToken, graphqlMutation, variables);
      
      if (response.data.data.productCreate.userErrors.length > 0) {
        throw new Error(response.data.data.productCreate.userErrors[0].message);
      }

      return response.data.data.productCreate.product;
    } catch (error) {
      logger.error('Error creating product:', error);
      throw error;
    }
  }

  /**
   * Make REST API request to Shopify Admin API
   * @param {string} shopDomain - The Shopify store domain (e.g., 'mystore.myshopify.com')
   * @param {string} accessToken - The Shopify Admin API access token
   * @param {string} endpoint - The API endpoint (e.g., 'shop.json')
   * @param {string} [method='GET'] - HTTP method
   * @param {Object} [data=null] - Request body data
   * @returns {Promise<Object>} - API response
   */
  async makeRequest(shopDomain, accessToken, endpoint, method = 'GET', data = null) {
    // Normalize shop domain (remove protocol and path if present)
    let normalizedDomain = shopDomain
      .replace(/^https?:\/\//, '') // Remove http:// or https://
      .replace(/\/.*$/, '')         // Remove any path
      .toLowerCase();

    // If only a store "name" or subdomain was provided (no dot) and it's not already a myshopify domain,
    // assume it's the shop subdomain and append .myshopify.com
    if (!normalizedDomain.includes('.') && !normalizedDomain.endsWith('myshopify.com')) {
      normalizedDomain = `${normalizedDomain}.myshopify.com`;
    }

    const url = `https://${normalizedDomain}/admin/api/${this.apiVersion}/${endpoint.replace(/^\/+/, '')}`;

    const config = {
      method,
      url,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Noxa-Vendor-App/1.0 (Noxa App)'
      },
      timeout: 10000 // 10 second timeout
    };

    if (data) {
      if (method.toUpperCase() === 'GET') {
        config.params = data;
      } else {
        config.data = data;
      }
    }

    try {
      const response = await axios(config);
      return response;
    } catch (error) {
      // Enhance error with more context
      if (error.response) {
        const { status, statusText, data } = error.response;
        const errorMessage = `Shopify API Error: ${status} ${statusText}`;
        error.message = errorMessage;
        error.details = data;
      }
      throw error;
    }
  }

  /**
   * Make GraphQL request to Shopify Admin API
   * @param {string} shopDomain - The Shopify store domain (e.g., 'mystore.myshopify.com')
   * @param {string} accessToken - The Shopify Admin API access token
   * @param {string} query - The GraphQL query string
   * @param {Object} [variables={}] - GraphQL variables
   * @returns {Promise<Object>} - GraphQL response
   */
  async makeGraphQLRequest(shopDomain, accessToken, query, variables = {}) {
    // Normalize shop domain (remove protocol and path if present)
    let normalizedDomain = shopDomain
      .replace(/^https?:\/\//, '') // Remove http:// or https://
      .replace(/\/.*$/, '')         // Remove any path
      .toLowerCase();

    // If only a store "name" or subdomain was provided (no dot) and it's not already a myshopify domain,
    // assume it's the shop subdomain and append .myshopify.com
    if (!normalizedDomain.includes('.') && !normalizedDomain.endsWith('myshopify.com')) {
      normalizedDomain = `${normalizedDomain}.myshopify.com`;
    }

    const url = `https://${normalizedDomain}/admin/api/${this.apiVersion}/graphql.json`;

    const baseConfig = {
      method: 'POST',
      url,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'Noxa-Vendor-App/1.0 (Noxa App)',
        'Accept': 'application/json'
      },
      data: {
        query,
        variables: variables || {}
      },
      timeout: 20000 // 20 second timeout for GraphQL queries
    };

    // basic retry with backoff for rate limiting / transient errors
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    const maxRetries = 4;
    let attempt = 0;
    let lastErr;
    while (attempt <= maxRetries) {
      try {
        return await axios(baseConfig);
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        const retryAfter = Number(err?.response?.headers?.['retry-after']) || null;
        const shouldRetry = status === 429 || status === 430 || status === 500 || status === 502 || status === 503 || status === 504;
        if (!shouldRetry || attempt === maxRetries) break;
        const backoff = retryAfter ? retryAfter * 1000 : Math.min(2000 * Math.pow(2, attempt), 15000);
        await sleep(backoff);
        attempt++;
      }
    }
    throw lastErr;
  }

  /**
   * Validate Shopify webhook
   */
  validateWebhook(data, hmacHeader) {
    const crypto = require('crypto');
    const calculated = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(data, 'utf8')
      .digest('base64');

    return calculated === hmacHeader;
  }
}

module.exports = new ShopifyService();
