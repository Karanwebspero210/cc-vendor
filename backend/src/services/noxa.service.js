const axios = require('axios');
const logger = require('../utils/logger');
const ProductVariant = require('../models/ProductVariant');
const Product = require('../models/Product');

/**
 * Noxa Service
 * Handles all Noxa vendor API interactions
 */
class NoxaService {
  constructor() {
    this.baseUrl = process.env.NOXA_API_URL || 'http://api.noxanabel.com/API';
    this.timeout = 30000; // 30 seconds
    this.authKey = process.env.NOXA_AUTH_KEY;
    
    if (!this.authKey) {
      logger.warn('NOXA_AUTH_KEY environment variable is not set');
    }
  }

  /**
   * Upsert a Product document for a given main SKU and inventories from Noxa
   * @param {string} mainSku
   * @param {string} skuStatus
   * @param {Array} inventories - array of { Color, Size, StockQty, PreOrderDate }
   */
  async upsertProductFromNoxa(mainSku, skuStatus, inventories = []) {
    const vendorId = process.env.NOXA_VENDOR_ID || undefined;
    const variants = (inventories || []).map((inv) => {
      const variantSku = `noxa_${mainSku}-${inv.Color}-${inv.Size}`;
      return {
        variantId: variantSku,
        sku: variantSku,
        title: `${mainSku} ${inv.Color || ''} ${inv.Size || ''}`.trim(),
        color: inv.Color,
        size: inv.Size,
        inventoryQuantity: Number(inv.StockQty) || 0,
        isActive: (Number(inv.StockQty) || 0) > 0,
        metadata: {
          preOrderDate: inv.PreOrderDate || null
        }
      };
    });

    const totalInventory = variants.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0);

    await Product.updateOne(
      { source: 'vendor', sourceId: mainSku },
      {
        $set: {
          source: 'vendor',
          sourceId: mainSku,
          vendorId: vendorId || undefined,
          title: mainSku,
          description: '',
          mainSku,
          status: skuStatus && skuStatus.toLowerCase() === 'active' ? 'active' : 'draft',
          totalInventory,
          inStock: totalInventory > 0,
          lastSynced: new Date(),
          syncStatus: 'synced'
        },
        $setOnInsert: {
          images: [],
          tags: []
        }
      },
      { upsert: true }
    );

    // Overwrite variants array to ensure current snapshot
    await Product.updateOne(
      { source: 'vendor', sourceId: mainSku },
      { $set: { variants } }
    );
  }

  /**
   * Get active SKU list (paginated)
   * @param {number} pgNo - Page number (1-indexed)
   * @param {number} pgSize - Page size
   * @returns {Promise<{Result:boolean, Message:string|null, Response:{PageNo:number, ListSize:number, SKUList:string[], TotalCount:number}}>} 
   */
  async getActiveSKUList(pgNo = 1, pgSize = 100) {  
    try {
      const response = await this.makeRequest(`/Inventory/ActiveSKUList`, 'GET', null, { pgNo, pgSize });
      return response;
    } catch (error) {
      logger.error('Error fetching active SKU list from Noxa:', error);
      return {
        Result: false,
        Message: error.message || 'Failed to fetch active SKU list',
        Response: null
      };
    }
  }

  /**
   * Get detailed product information by SKU and process its variants
   * @param {string} sku - Product SKU
   * @returns {Promise<Object>} - Standardized response with SKU details and inventory
   */
  async getProductDetails(sku) {
    try {
      // Make the API request to get product details
      const response = await this.makeRequest(`/Inventory/InventoryBySKU/${sku}`, 'GET');
      
      // If the API returned a successful response but no product data
      if (!response.Response) {
        return {
          Result: false,
          Message: `No product details found for SKU: ${sku}`,
          Response: null
        };
      }
      
      // Extract the necessary fields from the response
      const { SKU, SKUStatus, Inventories = [] } = response.Response;
      
      // Process and save variants
      try {
        await this.processProductVariants(SKU, Inventories);
      } catch (error) {
        logger.error(`Failed to process variants for SKU ${sku}:`, error.message);
      }
      
      // Get the updated variants from the database (preserve original case)
      const variants = await ProductVariant.find({ mainSku: SKU })
        .select('variantSku color size stockQty preOrderDate status')
        .lean();
      
      // Format the response
      const productData = {
        SKU,
        SKUStatus,
        variants: variants.map(v => ({
          variantSku: v.variantSku,
          color: v.color,
          size: v.size,
          stockQty: v.stockQty,
          preOrderDate: v.preOrderDate,
          status: v.status
        })),
        lastUpdated: new Date().toISOString(),
        variantStats: {
          total: variants.length,
          inStock: variants.filter(v => v.stockQty > 0).length,
          outOfStock: variants.filter(v => v.stockQty <= 0).length
        }
      };
      
      return {
        Result: true,
        Message: `Retrieved details for SKU: ${sku} with ${variants.length} variants`,
        Response: productData
      };
      
    } catch (error) {
      logger.error(`Error fetching details for SKU ${sku}:`, error);
      
      return {
        Result: false,
        Message: `Failed to fetch details for SKU ${sku}: ${error.message}`,
        Response: null,
        error: {
          message: error.message,
          status: error.status,
          code: error.code
        }
      };
    }
  }

  /**
   * Process and save product variants
   * @param {Array|Object} variantsData - Either an array of variants or an object with mainSku and inventories
   * @param {Array} [inventories] - Optional array of inventory items (if first param is mainSku)
   * @param {Map<string, ObjectId>} productIdByMainSku - Map of mainSku to product _id for linking
   * @returns {Promise<Object>} - Result of the bulk write operation
   */
  async processProductVariants(variantsData, inventories = [], productIdByMainSku = new Map()) {
      try {
        // Normalize input to a flat array of variant objects with mainSku, color, size, stockQty, status, preOrderDate
        let variants = [];
        if (Array.isArray(variantsData)) {
          variants = variantsData;
        } else if (typeof variantsData === 'string') {
          const mainSku = variantsData
          variants = (inventories || []).map(inv => ({
            mainSku,
            color: inv.Color,
            size: inv.Size,
            stockQty: Number(inv.StockQty) || 0,
            preOrderDate: inv.PreOrderDate || null,
            status: (Number(inv.StockQty) || 0) > 0 ? 'Active' : 'Inactive'
          }));
        } else if (variantsData && typeof variantsData === 'object' && variantsData.mainSku && Array.isArray(variantsData.inventories)) {
          const mainSku = (variantsData.mainSku || '').toString().trim();
          variants = (variantsData.inventories || []).map(inv => ({
            mainSku,
            color: inv.Color,
            size: inv.Size,
            stockQty: Number(inv.StockQty) || 0,
            preOrderDate: inv.PreOrderDate,
            status: (Number(inv.StockQty) || 0) > 0 ? 'Active' : 'Inactive'
          }));
        } else {
          variants = [];
        }

        if (!variants.length) {
          return { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }


        const prepared = variants.map(v => {
          const mainSku = v.mainSku;
          const color = v.color;
          const size = v.size;
          // Use ProductVariant helper if available to generate consistent SKU
          const variantSku = ProductVariant.generateVariantSku
            ? ProductVariant.generateVariantSku(mainSku, color, size)
            : `noxa_${mainSku}-${color.replace(/\s+/g, '')}-${size.replace(/\s+/g, '')}`;
          return {
            ...v,
            mainSku,
            color,
            size,
            variantSku,
            stockQty: Number(v.stockQty) || 0,
            preOrderDate: v.preOrderDate ? new Date(v.preOrderDate) : null,
            status: v.status || ((Number(v.stockQty) || 0) > 0 ? 'Active' : 'Inactive')
          };
        });

        // Resolve Product IDs by mainSku. If a map is provided, use it (expects keys uppercased).
        let idByMainSku = productIdByMainSku instanceof Map ? productIdByMainSku : new Map();
        const missingMainSkus = [];
        const ensureIdForMainSku = (ms) => {
          const key = ms;
          if (idByMainSku.has(key)) return;
          missingMainSkus.push(key);
        };
        Array.from(new Set(prepared.map(p => p.mainSku))).forEach(ensureIdForMainSku);

        if (missingMainSkus.length) {
          // Fetch products by mainSku (aligns with Product schema)
          const products = await Product.find({ mainSku: { $in: missingMainSkus } }, { _id: 1, mainSku: 1 }).lean();
          for (const p of products) {
            idByMainSku.set(p.mainSku, p._id);
          }
        }

        // If some still missing, create minimal vendor products so variant can link
        const stillMissing = Array.from(new Set(prepared.map(p => p.mainSku))).filter(ms => !idByMainSku.has(ms));
        if (stillMissing.length) {
          const now = new Date();
          const productUpserts = stillMissing.map(ms => ({
            updateOne: {
              filter: { source: 'vendor', mainSku: ms },
              update: {
                $setOnInsert: {
                  source: 'vendor',
                  mainSku: ms,
                  totalInventory: 0,
                  inStock: false,
                  syncStatus: 'synced',
                  lastSynced: now
                }
              },
              upsert: true
            }
          }));
          if (productUpserts.length) {
            await Product.bulkWrite(productUpserts, { ordered: false });
          }
          // Re-fetch to get IDs
          const products2 = await Product.find({ mainSku: { $in: stillMissing } }, { _id: 1, mainSku: 1 }).lean();
          for (const p of products2) {
            idByMainSku.set(  p.mainSku, p._id);
          }
        }

        // Build variant bulk ops 
        const bulkOps = prepared.map(v => {
          const productId = idByMainSku.get(v.mainSku);
          if (!productId) {
            // Skip if we still couldn't resolve product
            return null;
          }
          return {
            updateOne: {
              filter: { variantSku: v.variantSku },
              update: {
                $set: {
                  product_id: productId,
                  mainSku: v.mainSku,
                  color: v.color,
                  size: v.size,
                  stockQty: v.stockQty,
                  preOrderDate: v.preOrderDate || null,
                  status: v.status || 'Active',
                  lastSynced: new Date()
                },
                $setOnInsert: {
                  variantSku: v.variantSku
                }
              },
              upsert: true
            }
          };
        }).filter(Boolean);

        if (!bulkOps.length) {
          return { acknowledged: true, insertedCount: 0, matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }

        const result = await ProductVariant.bulkWrite(bulkOps, { ordered: false });
        return result;
      } catch (err) {
        logger.error('Error processing product variants:', err);
        throw err;
      }
  }

  /**
   * Fetches inventory for specific SKUs from Noxa API
   * @param {string[]} skus - Array of SKUs to fetch inventory for
   * @returns {Promise<Object>} - Standardized response object with inventory data
   */
  async getInventoryBySKUs(skus) {
    console.log("skus", skus)
    try {
      if (!Array.isArray(skus) || skus.length === 0) {
        return {
          Result: false,
          Message: 'SKU list must be a non-empty array',
          Response: null
        };
      }

      // Normalize and de-duplicate SKUs to match vendor expectations
      const payloadSkus = Array.from(new Set(
        skus
          .filter(Boolean)
          .map(s => s.toString().trim())
      ));

      logger.debug(`Noxa batch payload: ${payloadSkus.length} SKUs`, { sample: payloadSkus.slice(0, 5) });

      // Make the API request to Noxa with retry/backoff
      const doPost = async () => this.makeRequest(
        '/Inventory/InventoriesBySKUs',
        'POST',
        { SKUList: payloadSkus }
      );
      let response;
      let attempt = 0;
      const maxRetries = 3;
      while (true) {
        try {
          response = await doPost();
          break;
        } catch (err) {
          const status = err.status || 0;
          const retriable = status === 0 || status >= 500 || status === 429;
          if (!retriable || attempt >= maxRetries) throw err;
          const delay = Math.min(2000, 500 * Math.pow(2, attempt)) + Math.floor(Math.random() * 200);
          await new Promise(r => setTimeout(r, delay));
          attempt += 1;
        }
      }

      if (response.Result && Array.isArray(response.Response)) {
        const results = [];
        const allVariants = [];
        const productOps = [];

        for (const product of response.Response) {
          if (!product?.SKU || !Array.isArray(product.Inventories)) continue;

          const mainSku = product.SKU;
          const skuStatus = product.SKUStatus;

          const variants = product.Inventories.map(inv => ({
            variantSku: `noxa_${mainSku}-${inv.Color}-${inv.Size}`,
            mainSku,
            skuStatus,
            color: inv.Color,
            size: inv.Size,
            stockQty: inv.StockQty,
            preOrderDate: inv.PreOrderDate,
            status: inv.StockQty > 0 ? 'Active' : 'Inactive',
            updatedAt: new Date()
          }));
          allVariants.push(...variants);

          const totalInventory = (product.Inventories || []).reduce((s, inv) => s + (Number(inv.StockQty) || 0), 0);
          const vendorId = process.env.NOXA_VENDOR_ID || undefined;
          productOps.push({
            updateOne: {
              filter: { source: 'vendor', sourceId: mainSku },
              update: {
                $set: {
                  source: 'vendor',
                  sourceId: mainSku,
                  vendorId: vendorId || undefined,
                  mainSku,
                  status: skuStatus && skuStatus.toLowerCase() === 'active' ? 'active' : 'draft',
                  totalInventory,
                  inStock: totalInventory > 0,
                  lastSynced: new Date(),
                  syncStatus: 'synced'
                },
                $unset: { variants: "" },
                
              },
              upsert: true
            }
          });

          results.push({ sku: mainSku, status: skuStatus, variants: variants.length });
        }

        // Upsert products (minimal fields only) first so we can link variants -> product
        await Product.bulkWrite(productOps, { ordered: false });

        // Build a map of mainSku -> product _id for linking
        const uniqueMainSkus = Array.from(new Set(allVariants.map(v => v.mainSku)));
        const products = await Product.find({ source: 'vendor', sourceId: { $in: uniqueMainSkus } }, { _id: 1, sourceId: 1 }).lean();
        const productIdByMainSku = new Map(products.map(p => [p.sourceId, p._id]));

        // Now process variants in bulk with product references
        await this.processProductVariants(allVariants, [], productIdByMainSku);

        return {
          Result: true,
          Message: `Successfully processed inventory for ${results.length} SKU(s)`,
          Response: {
            processedSkus: results.length,
            details: results
          }
        };
      }

      return response; // Return original response if no processing was done
    } catch (error) {
      logger.error('Error in getInventoryBySKUs:', error);
      return {
        Result: false,
        Message: error.message || 'Failed to fetch inventory by SKUs',
        Response: null
      };
    }
  }

  /**
   * Make HTTP request to Noxa API
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {Object|null} data - Request body data
   * @param {Object} params - Query parameters
   * @returns {Promise<Object>} - Response data with Result, Message, and Response fields
   */
  async makeRequest(endpoint, method = 'GET', data = null, params = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    if (!this.authKey) {
      throw new Error('NOXA_AUTH_KEY environment variable is not set');
    }
    
    // Debug: log the URL and method (without sensitive headers)
    logger.debug(`Noxa request: ${method} ${url}`);

    const config = {
      method,
      url,
      headers: {
        'X-Auth-Key': this.authKey,
        'Content-Type': 'application/json',
        'User-Agent': 'CoutureCandyVendorApp/1.0',
        'Accept': '*/*'
      },
      timeout: this.timeout,
      params
    };

    if (data) {
      config.data = data;
      if (method === 'POST') {
        const keys = Object.keys(data || {});
        const sizeHint = JSON.stringify(data).length;
        logger.debug(`Noxa POST payload keys: ${keys.join(', ')} (size≈${sizeHint} bytes)`);
      }
    }

    try {
      const response = await axios(config);
      
      // Normalize response to standard shape
      if (Array.isArray(response.data)) {
        return { Result: true, Message: null, Response: response.data };
      }

      const { Result, Message, Response } = response.data || {};

      // If the API indicates an error in the response
      if (Result === false) {
        const errorMessage = Message || 'Noxa API returned a failure result';
        const error = new Error(`Noxa API Error: ${errorMessage}`);
        error.response = response;
        error.status = response.status || 400;
        throw error;
      }
      
      // Return the standardized response format
      return {
        Result: Result !== undefined ? Result : true,
        Message: Message || null,
        Response: (Response !== undefined ? Response : null)
      };
      
    } catch (error) {
      if (error.response) {
        // API responded with error status
        const { status, data } = error.response;
        let errorMessage = `Noxa API Error: ${status}`;
        
        // Try to get error message from response data
        if (data) {
          if (typeof data === 'string') {
            errorMessage += ` - ${data}`;
          } else if (data.Message) {
            errorMessage += ` - ${data.Message}`;
          } else if (data.error) {
            errorMessage += ` - ${data.error}`;
          } else if (data.statusText) {
            errorMessage += ` - ${data.statusText}`;
          }
        }
        
        const apiError = new Error(errorMessage);
        apiError.status = status;
        apiError.data = data;
        throw apiError;
        
      } else if (error.request) {
        // Request timeout or network error
        throw new Error('Noxa API request failed: Network error or timeout');
      } else {
        // Other error
        throw new Error(`Noxa API request failed: ${error.message}`);
      }
    }
  }
}

const noxaService = new NoxaService();
module.exports = noxaService;
