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

    console.log('Shopify access token:', accessToken);
    console.log('Shopify domain:', store.shopifyDomain);  
    console.log('Shopify API version:', this.apiVersion);
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

      // Verify we have the necessary permissions by checking if we can access products
      try {
        await this.makeRequest(normalizedDomain, accessToken, 'products/count.json');
      } catch (permissionError) {
        if (permissionError.response?.status === 403) {
          throw new Error('Insufficient permissions: The access token does not have required permissions');
        }
        // If it's not a permission error, continue with the shop info we have
      }

      // Get API call limit information
      const rateLimit = {
        limit: parseInt(response.headers['x-shopify-shop-api-call-limit']?.split('/')[1]) || 0,
        remaining: parseInt(response.headers['x-shopify-shop-api-call-limit']?.split('/')[0]) || 0
      };

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
          api_rate_limit: rateLimit
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
    
    const config = {
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
      timeout: 15000 // 15 second timeout for GraphQL queries
    };

    return await axios(config);
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
