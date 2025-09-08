const { ResponseHelper } = require("../utils/helpers");
const logger = require("../utils/logger");
const shopifyService = require("../services/shopify.service");
const inventoryService = require("../services/inventory.service");
const SyncJob = require("../models/SyncJob");
const Store = require("../models/Store");
const { v4: uuidv4 } = require("uuid");
const encryption = require("../utils/encryption");
const { createQueue } = require("../queues");
const ProductVariant = require("../models/ProductVariant");

/**
 * Shopify Controller
 * Handles Shopify store operations and API interactions
 */
class ShopifyController {
  constructor() {
    // Queue to handle background sync with Shopify jobs
    this.shopifySyncQueue = createQueue("shopify-sync");

    // Bind methods to preserve 'this' when used as route handlers
    this.getStores = this.getStores.bind(this);
    this.syncWithShopify = this.syncWithShopify.bind(this);
    this.getSyncStatus = this.getSyncStatus.bind(this);
    this.bulkUpdateMismatchedInventory =
      this.bulkUpdateMismatchedInventory.bind(this);
    this.bulkUpdateSelectedInventory =
      this.bulkUpdateSelectedInventory.bind(this);
    this.exportJobCsv = this.exportJobCsv.bind(this);
    this.autoConnectStore = this.autoConnectStore.bind(this);
    this.stopWorker = this.stopWorker.bind(this);

    // Register queue processor once
    if (!this.shopifySyncQueue._shopifySyncProcessorAttached) {
      this.shopifySyncQueue.process("sync-with-shopify", 1, async (job) => {
        const { jobId, storeId, options = {} } = job.data || {};

        let syncJobDoc = null;
        try {
          const procStartTs = Date.now();
          logger.info(`[queue:shopify-sync][start][${jobId}]`, {
            bullJobId: job.id,
            storeId,
            options,
          });

          // Check if job should be stopped
          if (job._shouldStop) {
            throw new Error(job._stopReason || "Job stopped by user");
          }

          syncJobDoc = await SyncJob.findOne({ jobId });
          if (syncJobDoc) await syncJobDoc.start();
          if (syncJobDoc) {
            logger.debug(`[queue:shopify-sync][db-loaded][${jobId}]`, {
              dbId: String(syncJobDoc._id),
            });
          }

          const store = await Store.findById(storeId);
          if (!store) {
            throw new Error("Store not found");
          }

          // Resolve and persist required Shopify fields only (no inventory quantity updates here)
          const prep = await inventoryService.syncStoreFromProductVariants(
            storeId,
            {
              ...options,
              // Real-time progress hook
              onProgress: async ({ processed, resolved, skipped, total }) => {
                try {
                  // Check if job should be stopped during progress
                  if (job._shouldStop) {
                    throw new Error(job._stopReason || "Job stopped by user");
                  }

                  // Update Bull job progress in percentage and SyncJob document
                  const pct =
                    total > 0 ? Math.round((processed / total) * 100) : 0;
                  await job.progress(pct);
                  if (syncJobDoc) {
                    await syncJobDoc.updateProgress(resolved, 0, total);
                    if (typeof syncJobDoc.appendLogs === "function") {
                      await syncJobDoc.appendLogs([
                        {
                          level: "info",
                          message: `Batch progress: processed=${processed} resolved=${resolved} skipped=${skipped} total=${total} (${pct}%)`,
                        },
                      ]);
                    }
                  }
                  logger.info(`[queue:shopify-sync][progress][${jobId}]`, {
                    processed,
                    resolved,
                    skipped,
                    total,
                    pct,
                  });
                } catch (e) {
                  logger.warn(
                    `[queue:shopify-sync][progress-failed][${jobId}] ${e.message}`
                  );
                }
              },
              // Allow tuning batch sizes/delays via env; safe defaults already in service
              batchSize: Number(process.env.INVENTORY_BATCH_SIZE || 1000),
              batchDelayMs: Number(process.env.INVENTORY_BATCH_DELAY_MS || 300),
            }
          );
          const totalItems = Number(prep.total || 0);
          const resolvedItems = Number(prep.countToUpdate || 0);
          const skippedItems = Number(prep.skipped || 0);
          logger.info(`[queue:shopify-sync][resolved][${jobId}]`, {
            totalItems,
            resolvedItems,
            skippedItems,
          });

          if (syncJobDoc)
            await syncJobDoc.updateProgress(resolvedItems, 0, totalItems);

          // Collect sample details for job result (limit to avoid large payloads)
          let syncedItems = [];
          let unsyncedItems = [];
          try {
            const startedAt =
              syncJobDoc?.startedAt || new Date(Date.now() - 5 * 60 * 1000);
            syncedItems = await ProductVariant.find({
              lastSyncAt: { $gte: startedAt },
              shopifyVariantId: { $nin: [null, ""] },
              shopifyInventoryItemId: { $nin: [null, ""] },
            })
              .sort({ lastSyncAt: -1 })
              .limit(100)
              .select(
                "variantSku shopifyVariantId shopifyInventoryItemId lastKnownShopifyQty updatedAt lastSyncAt"
              )
              .lean();
            unsyncedItems = await ProductVariant.find({
              $or: [
                { shopifyVariantId: { $in: [null, ""] } },
                { shopifyInventoryItemId: { $in: [null, ""] } },
              ],
            })
              .sort({ updatedAt: -1 })
              .limit(100)
              .select(
                "variantSku shopifyVariantId shopifyInventoryItemId lastKnownShopifyQty updatedAt lastSyncAt"
              )
              .lean();
          } catch (collectErr) {
            logger.warn(
              `[queue:shopify-sync][collect-details][${jobId}] ${collectErr.message}`
            );
          }

          const logs = [
            { level: "info", message: `Variants scanned: ${totalItems}` },
            {
              level: "info",
              message: `Variants with required Shopify fields: ${resolvedItems}`,
            },
            {
              level: "info",
              message: `Variants skipped (missing fields/unqualified): ${skippedItems}`,
            },
          ];

          // Complete job with summary only; no inventory push performed in this step
          if (syncJobDoc) {
            await syncJobDoc.complete(true, {
              message: "Shopify field resolution completed",
              data: {
                logs,
                summary: prep,
                details: {
                  syncedItems,
                  unsyncedItems,
                },
                counts: {
                  synced: resolvedItems,
                  unsynced: Math.max(0, totalItems - resolvedItems),
                },
              },
              stats: {
                resolved: resolvedItems,
                skipped: skippedItems,
                duration: syncJobDoc.duration,
              },
            });
            logger.info(`[queue:shopify-sync][complete][${jobId}]`, {
              dbId: String(syncJobDoc._id),
              durationMs: Date.now() - procStartTs,
            });
          }

          return {
            resolved: resolvedItems,
            skipped: skippedItems,
            total: totalItems,
          };
        } catch (error) {
          if (syncJobDoc) {
            await syncJobDoc.fail(error, false);
          }
          logger.error(
            `[queue:shopify-sync][error][${jobId}] ${error.message}`,
            { storeId, options }
          );
          throw error;
        }
      });

      // Processor to update Shopify inventory (selected SKUs or mismatched)
      this.shopifySyncQueue.process("update-inventory", 1, async (job) => {
        const {
          jobId,
          storeId,
          variantSkus = [],
          dryRun = false,
          mode = "selected",
        } = job.data || {};

        let syncJobDoc = null;
        try {
          logger.info(
            `[queue:shopify-sync][inventory-update][start][${jobId}]`,
            {
              bullJobId: job.id,
              storeId,
              mode,
              dryRun,
              variantSkusCount: Array.isArray(variantSkus)
                ? variantSkus.length
                : 0,
            }
          );

          // Check if job should be stopped
          if (job._shouldStop) {
            throw new Error(job._stopReason || "Job stopped by user");
          }

          syncJobDoc = await SyncJob.findOne({ jobId });
          if (syncJobDoc) await syncJobDoc.start();

          const store = await Store.findById(storeId);
          if (!store) throw new Error("Store not found");

          // Determine target variants
          let variants = [];
          if (mode === "mismatched") {
            const filter = {
              lastKnownShopifyQty: { $ne: null },
              $expr: { $ne: ["$stockQty", "$lastKnownShopifyQty"] },
              shopifyVariantId: { $nin: [null, ""] },
              shopifyInventoryItemId: { $nin: [null, ""] },
            };
            // Get all mismatched variants without limit
            variants = await ProductVariant.find(filter).sort({
              updatedAt: -1,
            });
          } else {
            // selected mode
            const list = Array.isArray(variantSkus) ? variantSkus : [];
            variants = await ProductVariant.find({ variantSku: { $in: list } });
          }

          const total = variants.length;
          if (syncJobDoc) await syncJobDoc.updateProgress(0, 0, total);

          const results = [];
          let completed = 0;
          let failed = 0;
          const batchSize = 100;

          // Process variants in batches of 100
          for (
            let batchStart = 0;
            batchStart < variants.length;
            batchStart += batchSize
          ) {
            // Check if job should be stopped before each batch
            if (job._shouldStop) {
              throw new Error(job._stopReason || "Job stopped by user");
            }

            const batchEnd = Math.min(batchStart + batchSize, variants.length);
            const batch = variants.slice(batchStart, batchEnd);

            logger.info(
              `[queue:shopify-sync][inventory-update][batch][${jobId}]`,
              {
                batchNumber: Math.floor(batchStart / batchSize) + 1,
                batchStart,
                batchEnd,
                batchSize: batch.length,
                totalVariants: variants.length,
              }
            );

            for (let i = 0; i < batch.length; i++) {
              const v = batch[i];
              try {
                const desiredQty =
                  typeof v.stockQty === "number" ? v.stockQty : 0;
                const prevQty =
                  typeof v.lastKnownShopifyQty === "number"
                    ? v.lastKnownShopifyQty
                    : null;
                if (!dryRun) {
                  await shopifyService.setInventoryQuantity({
                    storeId: String(store._id),
                    inventoryItemId: v.shopifyInventoryItemId,
                    quantity: desiredQty,
                  });
                  v.lastKnownShopifyQty = desiredQty;
                  v.lastSyncAt = new Date();
                  v.lastSyncStatus = "success";
                  v.lastSyncError = null;
                  await v.save();
                }
                completed++;
                results.push({
                  variantSku: v.variantSku,
                  shopifyInventoryItemId: v.shopifyInventoryItemId,
                  previousQuantity: prevQty,
                  toQuantity: typeof v.stockQty === "number" ? v.stockQty : 0,
                  status: dryRun ? "skipped (dry-run)" : "updated",
                });
              } catch (err) {
                failed++;
                v.lastSyncStatus = "failed";
                v.lastSyncError = err.message;
                v.lastSyncAt = new Date();
                await v.save();
                results.push({
                  variantSku: v.variantSku,
                  shopifyInventoryItemId: v.shopifyInventoryItemId,
                  previousQuantity:
                    typeof v.lastKnownShopifyQty === "number"
                      ? v.lastKnownShopifyQty
                      : null,
                  error: err.message,
                  status: "failed",
                });
                logger.warn(
                  `[queue:shopify-sync][inventory-update][failed][${jobId}] ${v.variantSku}: ${err.message}`
                );
              }

              // Update progress
              const currentProcessed = batchStart + i + 1;
              const pct =
                total > 0 ? Math.round((currentProcessed / total) * 100) : 0;
              await job.progress(pct);
              if (syncJobDoc)
                await syncJobDoc.updateProgress(completed, failed, total);
            }

            // Log batch completion
            logger.info(
              `[queue:shopify-sync][inventory-update][batch-complete][${jobId}]`,
              {
                batchNumber: Math.floor(batchStart / batchSize) + 1,
                batchProcessed: batch.length,
                totalProcessed: batchStart + batch.length,
                totalVariants: variants.length,
                completed,
                failed,
              }
            );
          }

          // Complete job
          if (syncJobDoc) {
            await syncJobDoc.complete(true, {
              message: `Inventory ${
                dryRun ? "dry-run " : ""
              }update ${mode} completed`,
              data: { items: results },
              stats: {
                inventoryUpdates: dryRun ? 0 : completed,
                errors: failed,
                duration: syncJobDoc.duration,
              },
            });
          }

          logger.info(
            `[queue:shopify-sync][inventory-update][complete][${jobId}]`,
            {
              total,
              updated: dryRun ? 0 : completed,
              failed,
            }
          );

          return {
            total,
            updated: dryRun ? 0 : completed,
            failed,
            items: results,
          };
        } catch (error) {
          if (syncJobDoc) await syncJobDoc.fail(error, false);
          logger.error(
            `[queue:shopify-sync][inventory-update][error][${jobId}] ${error.message}`
          );
          throw error;
        }
      });

      this.shopifySyncQueue._shopifySyncProcessorAttached = true;
    }
  }
  /**
   * Get all connected Shopify stores
   */
  async getStores(req, res) {
    try {
      // Return the connected store for the current admin context
      // Since this is an admin-only app and single-vendor, we return the first connected store
      const store = await Store.findOne(
        { connectionStatus: "connected" },
        "-accessToken -encryptedCredentials"
      ).sort({ createdAt: -1 });

      if (!store) {
        return ResponseHelper.success(
          res,
          { store: null },
          "No connected Shopify store found"
        );
      }

      ResponseHelper.success(
        res,
        { store },
        "Connected Shopify store retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving Shopify stores:", error);
      ResponseHelper.error(
        res,
        "Failed to retrieve Shopify stores",
        500,
        "SHOPIFY_STORES_ERROR"
      );
    }
  }

  /**
   * Automatically connect Shopify store using environment variables
   */
  async autoConnectStore() {
    try {
      const shopDomain = process.env.SHOPIFY_DOMAIN;
      const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

      if (!shopDomain || !accessToken) {
        logger.warn(
          "SHOPIFY_DOMAIN or SHOPIFY_ACCESS_TOKEN not found in environment variables. Skipping auto-connect."
        );
        return null;
      }

      // Normalize incoming domain to myshopify.com form
      let normalizedDomain = (shopDomain || "")
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
      if (!normalizedDomain.endsWith(".myshopify.com")) {
        // If only subdomain or custom domain provided, force myshopify domain using subdomain part
        const sub = normalizedDomain.split(".")[0];
        normalizedDomain = `${sub}.myshopify.com`;
      }

      // Check if store already exists
      const existingStore = await Store.findOne({
        shopifyDomain: normalizedDomain,
      });
      if (existingStore) {
        logger.info(
          `Shopify store ${normalizedDomain} already exists in database`
        );
        return existingStore;
      }

      logger.info(
        `Attempting to auto-connect Shopify store: ${normalizedDomain}`
      );

      // Test connection first
      const connectionTest = await shopifyService.testConnection(
        normalizedDomain,
        accessToken
      );

      if (!connectionTest.success) {
        logger.error(
          `Failed to connect to Shopify store: ${connectionTest.error}`
        );
        return null;
      }

      // Create store in database
      const store = new Store({
        name: connectionTest.shopInfo.name,
        shopifyDomain: normalizedDomain,
        accessToken, // encrypted by model setter
        shopifyShopId: String(connectionTest.shopInfo.id || ""),
        metadata: {
          timezone: connectionTest.shopInfo.iana_timezone,
          currency: connectionTest.shopInfo.currency,
        },
        isActive: true,
        lastConnectionCheck: new Date(),
      });

      await store.save();
      logger.info(
        `Successfully auto-connected Shopify store: ${store.name} (${normalizedDomain})`
      );

      // Fetch and cache the store's default location id immediately after connecting
      try {
        await shopifyService.getPrimaryLocationId(store._id);
      } catch (locErr) {
        logger.warn(
          `Unable to cache default Shopify location for store ${store._id}: ${locErr.message}`
        );
      }

      return store;
    } catch (error) {
      logger.error("Error auto-connecting Shopify store:", error);
      return null;
    }
  }

  /**
   * Bulk sync inventory from ProductVariant to Shopify for a store
   */
  async syncWithShopify(req, res) {
    try {
      // Updated flow: remove selection option and target only variants missing Shopify IDs
      // const { /* onlyInStock = false, */ maxUpdates = 0 } = req.body || {};
      const reqStartTs = Date.now();
      const reqId = req.headers["x-request-id"] || uuidv4();
      logger.info(`[api:syncWithShopify][start][${reqId}]`, {
        // maxUpdates,
        ip: req.ip,
        path: req.originalUrl,
      });

      // Get the connected store for current admin context
      const store = await Store.findOne({ connectionStatus: "connected" });
      if (!store) {
        return ResponseHelper.error(
          res,
          "No connected Shopify store found",
          404,
          "STORE_NOT_FOUND"
        );
      }
      const storeId = String(store._id);
      logger.debug(`[api:syncWithShopify][store-loaded][${reqId}]`, {
        storeId,
      });

      const jobId = uuidv4();
      logger.debug(`[api:syncWithShopify][job-uuid-created][${reqId}]`, {
        jobId,
      });

      // Create SyncJob and enqueue background processing without waiting
      const jobDoc = await SyncJob.create({
        jobId,
        type: "manual",
        storeId,
        status: "queued",
        queueName: "shopify-sync",
        data: {
          selectedProducts: [],
          syncConfig: { batchSize: 50, syncInventory: false, dryRun: false },
          // filters: { onlyMissingShopifyFields: true, maxUpdates },
          filters: { onlyMissingShopifyFields: true },
        },
        metadata: { triggeredBy: "manual", tags: ["shopify-sync"] },
      });
      logger.info(`[api:syncWithShopify][job-doc-created][${reqId}]`, {
        dbId: String(jobDoc._id),
        jobId,
        storeId,
      });

      // Push to queue (processor will fetch sizes and variant details from Shopify)
      const bullJob = await this.shopifySyncQueue.add(
        "sync-with-shopify",
        {
          jobId,
          storeId,
          // Processor will resolve missing Shopify fields (variantId, inventoryItemId) from Shopify by SKU
          // options: { maxUpdates, onlyMissingShopifyFields: true },
          options: { onlyMissingShopifyFields: true },
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      logger.info(`[api:syncWithShopify][enqueued][${reqId}]`, {
        bullJobId: bullJob && bullJob.id,
        jobId,
        dbId: String(jobDoc._id),
      });

      // Return immediately without waiting for processing
      ResponseHelper.success(
        res,
        {
          jobId: jobDoc._id,
          status: "queued",
          message: "Sync with Shopify job has been queued",
        },
        "Sync with Shopify queued"
      );
      logger.info(`[api:syncWithShopify][response][${reqId}]`, {
        durationMs: Date.now() - reqStartTs,
        dbId: String(jobDoc._id),
        jobId,
        bullJobId: bullJob && bullJob.id,
      });
    } catch (error) {
      logger.error(`[api:syncWithShopify][error] ${error.message}`);
      ResponseHelper.error(
        res,
        "Failed to sync inventory",
        500,
        "SHOPIFY_BULK_INVENTORY_ERROR"
      );
    }
  }

  /**
   * Get Shopify sync status for variants
   * Query params:
   * - status: 'synced' | 'unsynced' (default 'synced')
   * - page: default 1
   * - limit: default 50
   * - search: optional substring match on variantSku
   */
  async getSyncStatus(req, res) {
    try {
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "50", 10), 1),
        200
      );
      const skip = (page - 1) * limit;
      const status = (req.query.status || "synced").toString().toLowerCase();
      const search = (req.query.search || "").toString().trim();

      const syncedFilter = {
        shopifyVariantId: { $nin: [null, ""] },
        shopifyInventoryItemId: { $nin: [null, ""] },
      };
      const unsyncedFilter = {
        $or: [
          { shopifyVariantId: { $in: [null, ""] } },
          { shopifyInventoryItemId: { $in: [null, ""] } },
        ],
      };

      const baseFilter = status === "unsynced" ? unsyncedFilter : syncedFilter;
      const filter = { ...baseFilter };
      if (search) {
        filter.variantSku = {
          $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        };
      }

      const [totalSynced, totalUnsynced, total, items] = await Promise.all([
        ProductVariant.countDocuments(syncedFilter),
        ProductVariant.countDocuments(unsyncedFilter),
        ProductVariant.countDocuments(filter),
        ProductVariant.find(filter)
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
      ]);

      return ResponseHelper.success(
        res,
        {
          items,
          counts: { synced: totalSynced, unsynced: totalUnsynced },
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / Math.max(1, limit)),
          },
        },
        "Shopify sync status retrieved successfully"
      );
    } catch (error) {
      logger.error("Error retrieving Shopify sync status:", error);
      return ResponseHelper.error(
        res,
        "Failed to retrieve Shopify sync status",
        500,
        "SHOPIFY_SYNC_STATUS_ERROR"
      );
    }
  }

  /**
   * Update inventory for a specific variant
   */
  async updateInventory(req, res) {
    try {
      const { storeId, variantId } = req.params;
      const { quantity, inventoryItemId } = req.body;

      // Validate inputs
      if (typeof quantity !== "number" || quantity < 0) {
        return ResponseHelper.error(
          res,
          "Quantity must be a non-negative number",
          400,
          "INVALID_QUANTITY"
        );
      }

      // Validate store exists and is connected
      const store = await Store.findById(storeId);
      if (!store) {
        return ResponseHelper.error(
          res,
          "Store not found",
          404,
          "STORE_NOT_FOUND"
        );
      }

      if (!store.connected) {
        return ResponseHelper.error(
          res,
          "Store is not connected. Please test connection first.",
          400,
          "STORE_NOT_CONNECTED"
        );
      }

      // Decrypt access token
      const accessToken = encryption.decrypt(store.accessToken);

      // Use Shopify GraphQL API to update inventory
      const updateResult = await shopifyService.updateInventory({
        storeId,
        variantId,
        inventoryItemId,
        quantity,
        shopDomain: store.shopifyDomain,
        accessToken,
      });

      // Log the inventory change
      logger.info(
        `Inventory updated for store ${storeId}, variant ${variantId}: ${updateResult.previousQuantity} -> ${quantity}`
      );

      ResponseHelper.success(
        res,
        {
          ...updateResult,
          updatedAt: new Date(),
        },
        "Shopify inventory updated successfully"
      );
    } catch (error) {
      logger.error("Error updating Shopify inventory:", error);
      ResponseHelper.error(
        res,
        "Failed to update Shopify inventory",
        500,
        "SHOPIFY_INVENTORY_UPDATE_ERROR"
      );
    }
  }

  /**
   * Bulk update Shopify inventory for mismatched variants by setting Shopify quantity to match stockQty
   * Body: { dryRun?: boolean }
   */
  async bulkUpdateMismatchedInventory(req, res) {
    try {
      const { dryRun = false } = req.body || {};

      // Find connected store
      const store = await Store.findOne({ connectionStatus: "connected" });
      if (!store) {
        return ResponseHelper.error(
          res,
          "No connected Shopify store found",
          404,
          "STORE_NOT_FOUND"
        );
      }

      const storeId = String(store._id);

      // Create a job to process in background
      const jobId = uuidv4();
      const jobDoc = await SyncJob.create({
        jobId,
        type: "manual",
        storeId,
        status: "queued",
        queueName: "shopify-sync",
        data: {
          selectedProducts: [],
          syncConfig: {
            batchSize: 10,
            syncInventory: true,
            dryRun,
          },
          filters: { mode: "mismatched" },
        },
        metadata: {
          triggeredBy: "manual",
          tags: ["shopify-inventory-update", "mismatched"],
        },
      });

      const bullJob = await this.shopifySyncQueue.add(
        "update-inventory",
        { jobId, storeId, dryRun, mode: "mismatched" },
        { jobId, removeOnComplete: true, removeOnFail: false }
      );

      logger.info(`[api:bulkUpdateMismatchedInventory][enqueued]`, {
        jobId,
        dbId: String(jobDoc._id),
        bullJobId: bullJob && bullJob.id,
      });

      return ResponseHelper.success(
        res,
        {
          jobId: jobDoc._id,
          status: "queued",
          message: "Inventory update (mismatched) has been queued",
        },
        dryRun
          ? "Dry-run queued for mismatched inventory update"
          : "Mismatched inventory update queued"
      );
    } catch (error) {
      logger.error("Error in bulkUpdateMismatchedInventory:", error);
      return ResponseHelper.error(
        res,
        error.message || "Failed to update mismatched inventory",
        500,
        "SHOPIFY_BULK_UPDATE_ERROR"
      );
    }
  }

  /**
   * Bulk update Shopify inventory for selected variants (by SKU)
   * Body: { variantSkus: string[], dryRun?: boolean }
   */
  async bulkUpdateSelectedInventory(req, res) {
    try {
      const { variantSkus = [], dryRun = false } = req.body || {};
      if (!Array.isArray(variantSkus) || variantSkus.length === 0) {
        return ResponseHelper.badRequest(
          res,
          "variantSkus array is required and cannot be empty"
        );
      }

      // Find connected store
      const store = await Store.findOne({ connectionStatus: "connected" });
      if (!store) {
        return ResponseHelper.error(
          res,
          "No connected Shopify store found",
          404,
          "STORE_NOT_FOUND"
        );
      }

      const storeId = String(store._id);

      // Create a job to process selected SKUs
      const jobId = uuidv4();
      const jobDoc = await SyncJob.create({
        jobId,
        type: "manual",
        storeId,
        status: "queued",
        queueName: "shopify-sync",
        data: {
          selectedProducts: variantSkus,
          syncConfig: {
            batchSize: variantSkus.length,
            syncInventory: true,
            dryRun,
          },
          filters: { mode: "selected" },
        },
        metadata: {
          triggeredBy: "manual",
          tags: ["shopify-inventory-update", "selected"],
        },
      });

      const bullJob = await this.shopifySyncQueue.add(
        "update-inventory",
        { jobId, storeId, variantSkus, dryRun, mode: "selected" },
        { jobId, removeOnComplete: true, removeOnFail: false }
      );

      logger.info(`[api:bulkUpdateSelectedInventory][enqueued]`, {
        jobId,
        dbId: String(jobDoc._id),
        bullJobId: bullJob && bullJob.id,
      });

      return ResponseHelper.success(
        res,
        {
          jobId: jobDoc._id,
          status: "queued",
          message: "Inventory update (selected) has been queued",
        },
        dryRun
          ? "Dry-run queued for selected inventory update"
          : "Selected inventory update queued"
      );
    } catch (error) {
      logger.error("Error in bulkUpdateSelectedInventory:", error);
      return ResponseHelper.error(
        res,
        error.message || "Failed to update selected inventory",
        500,
        "SHOPIFY_SELECTED_UPDATE_ERROR"
      );
    }
  }

  /**
   * Get status for a specific Shopify inventory job (by SyncJob _id)
   */
  async getJobStatus(req, res) {
    try {
      const { id } = req.params;
      const job = await SyncJob.findById(id).lean();
      if (!job) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }
      return ResponseHelper.success(res, { job }, "Job status retrieved");
    } catch (error) {
      logger.error("Error retrieving job status:", error);
      return ResponseHelper.error(
        res,
        "Failed to retrieve job status",
        500,
        "JOB_STATUS_ERROR"
      );
    }
  }

  /**
   * Export job details as CSV for synced/unsynced variants
   * @route GET /api/shopify/jobs/:id/export?type=unsynced|synced|all
   */
  async exportJobCsv(req, res) {
    try {
      const { id } = req.params;
      const type = (req.query.type || "unsynced").toString().toLowerCase();

      const job = await SyncJob.findById(id).lean();
      if (!job) {
        return ResponseHelper.error(res, "Job not found", 404, "JOB_NOT_FOUND");
      }

      const syncedFilter = {
        shopifyVariantId: { $nin: [null, ""] },
        shopifyInventoryItemId: { $nin: [null, ""] },
      };
      const unsyncedFilter = {
        $or: [
          { shopifyVariantId: { $in: [null, ""] } },
          { shopifyInventoryItemId: { $in: [null, ""] } },
        ],
      };

      let filter = {};
      if (type === "unsynced") filter = unsyncedFilter;
      else if (type === "synced") filter = syncedFilter;
      // type === 'all' -> no extra filter

      const projection =
        "variantSku shopifyVariantId shopifyInventoryItemId lastKnownShopifyQty lastSyncAt updatedAt";

      const items = await ProductVariant.find(filter)
        .sort({ updatedAt: -1 })
        .select(projection)
        .lean();

      // CSV headers
      const headers = [
        "variantSku",
        "shopifyVariantId",
        "shopifyInventoryItemId",
        "lastKnownShopifyQty",
        "lastSyncAt",
        "updatedAt",
        ...(type === "unsynced" ? ["unsyncedReason"] : []),
      ];

      const escapeCsv = (value) => {
        if (value === null || value === undefined) return "";
        const str = String(value);
        // escape quotes by doubling them
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      const rows = items.map((it) => {
        const base = [
          escapeCsv(it.variantSku || ""),
          escapeCsv(it.shopifyVariantId || ""),
          escapeCsv(it.shopifyInventoryItemId || ""),
          escapeCsv(
            typeof it.lastKnownShopifyQty === "number"
              ? it.lastKnownShopifyQty
              : ""
          ),
          escapeCsv(it.lastSyncAt ? new Date(it.lastSyncAt).toISOString() : ""),
          escapeCsv(it.updatedAt ? new Date(it.updatedAt).toISOString() : ""),
        ];
        if (type === "unsynced") {
          const missing = [];
          if (!it.shopifyVariantId) missing.push("MISSING_SHOPIFY_VARIANT_ID");
          if (!it.shopifyInventoryItemId)
            missing.push("MISSING_SHOPIFY_INVENTORY_ITEM_ID");
          base.push(escapeCsv(missing.join("; ")));
        }
        return base.join(",");
      });

      const csv = [headers.join(","), ...rows].join("\n");

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `shopify-job-${id}-${type}-${ts}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"${filename}\"`
      );
      return res.status(200).send(csv);
    } catch (error) {
      logger.error("Error exporting job CSV:", error);
      return ResponseHelper.error(
        res,
        "Failed to export job CSV",
        500,
        "JOB_CSV_EXPORT_ERROR"
      );
    }
  }

  /**
   * Stop all running workers and cancel queued jobs
   * Query params:
   * - jobId: optional specific job ID to stop
   * - type: optional job type to stop ('sync-with-shopify' | 'update-inventory' | 'all')
   */
  async stopWorker(req, res) {
    try {
      const { jobId, type = "all" } = req.query;
      const reqId = req.headers["x-request-id"] || uuidv4();

      logger.info(`[api:stopWorker][start][${reqId}]`, {
        jobId,
        type,
        ip: req.ip,
        path: req.originalUrl,
      });

      let stoppedJobs = [];
      let cancelledJobs = [];

      if (jobId) {
        // Stop specific job by ID
        try {
          const job = await this.shopifySyncQueue.getJob(jobId);
          if (job) {
            const jobState = await job.getState();
            if (jobState === "active") {
              // For active jobs, we can't directly stop them in InMemoryQueue
              // We'll mark them for removal and they'll be handled when they complete
              job._shouldStop = true;
              job._stopReason = "Manually stopped by user";
              stoppedJobs.push({
                id: job.id,
                type: job.name,
                status: "marked_for_stop",
              });
            } else if (jobState === "waiting") {
              await job.remove();
              cancelledJobs.push({
                id: job.id,
                type: job.name,
                status: "cancelled",
              });
            }
          }
        } catch (jobError) {
          logger.warn(`[api:stopWorker][job-not-found][${reqId}]`, {
            jobId,
            error: jobError.message,
          });
        }
      } else {
        // Stop jobs by type or all
        const jobs = await this.shopifySyncQueue.getJobs(["waiting", "active"]);

        for (const job of jobs) {
          try {
            // Filter by type if specified
            if (type !== "all" && job.name !== type) {
              continue;
            }

            const jobState = await job.getState();
            if (jobState === "active") {
              // For active jobs, mark them for stopping
              job._shouldStop = true;
              job._stopReason = "Manually stopped by user";
              stoppedJobs.push({
                id: job.id,
                type: job.name,
                status: "marked_for_stop",
              });
            } else if (jobState === "waiting") {
              await job.remove();
              cancelledJobs.push({
                id: job.id,
                type: job.name,
                status: "cancelled",
              });
            }
          } catch (jobError) {
            logger.warn(`[api:stopWorker][job-error][${reqId}]`, {
              jobId: job.id,
              error: jobError.message,
            });
          }
        }
      }

      // Update SyncJob documents for stopped jobs
      for (const stoppedJob of stoppedJobs) {
        try {
          const syncJob = await SyncJob.findOne({
            $or: [{ jobId: stoppedJob.id }, { "data.jobId": stoppedJob.id }],
          });
          if (syncJob) {
            await syncJob.fail(new Error("Manually stopped by user"), false);
          }
        } catch (syncJobError) {
          logger.warn(`[api:stopWorker][sync-job-update-error][${reqId}]`, {
            jobId: stoppedJob.id,
            error: syncJobError.message,
          });
        }
      }

      const totalAffected = stoppedJobs.length + cancelledJobs.length;

      logger.info(`[api:stopWorker][complete][${reqId}]`, {
        stoppedJobs: stoppedJobs.length,
        cancelledJobs: cancelledJobs.length,
        totalAffected,
      });

      return ResponseHelper.success(
        res,
        {
          stoppedJobs,
          cancelledJobs,
          summary: {
            totalStopped: stoppedJobs.length,
            totalCancelled: cancelledJobs.length,
            totalAffected,
          },
        },
        `Successfully stopped ${totalAffected} job(s)`
      );
    } catch (error) {
      logger.error(`[api:stopWorker][error] ${error.message}`);
      return ResponseHelper.error(
        res,
        "Failed to stop workers",
        500,
        "STOP_WORKER_ERROR"
      );
    }
  }
}

module.exports = new ShopifyController();
