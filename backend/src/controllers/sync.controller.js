const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const SyncJob = require('../models/SyncJob');
const Store = require('../models/Store');

/**
 * Sync Controller
 * Handles synchronization operations between stores and vendors
 */
class SyncController {
  /**
   * Start manual sync operation
   */
  async startManualSync(req, res) {
    try {
      const { storeId, vendorId, syncType = 'inventory', options = {} } = req.body;
      
      // Validate required fields
      if (!storeId || !vendorId) {
        return ResponseHelper.error(res, 'Missing required fields: storeId, vendorId', 400, 'VALIDATION_ERROR');
      }
      
      // Validate sync type
      const validSyncTypes = ['inventory', 'products', 'full', 'incremental'];
      if (!validSyncTypes.includes(syncType)) {
        return ResponseHelper.error(res, `Invalid sync type. Must be one of: ${validSyncTypes.join(', ')}`, 400, 'INVALID_SYNC_TYPE');
      }
      
      // Validate store and vendor exist and are connected
      const [store, vendor] = await Promise.all([
        Store.findById(storeId),
        Vendor.findById(vendorId)
      ]);
      
      if (!store) {
        return ResponseHelper.error(res, 'Store not found', 404, 'STORE_NOT_FOUND');
      }
      
      if (!vendor) {
        return ResponseHelper.error(res, 'Vendor not found', 404, 'VENDOR_NOT_FOUND');
      }
      
      // Check if store is connected (has access token)
      if (!store.accessToken) {
        return ResponseHelper.error(res, 'Store is not connected. Please connect the store first.', 400, 'STORE_NOT_CONNECTED');
      }
      
      // Check if vendor is active
      if (!vendor.isActive) {
        return ResponseHelper.error(res, 'Vendor is not active', 400, 'VENDOR_NOT_ACTIVE');
      }
      
      // Create sync job in queue
      const syncJob = new SyncJob({
        type: 'manual',
        storeId,
        vendorId,
        priority: options.priority || 0,
        data: {
          selectedProducts: options.selectedProducts || [],
          syncConfig: {
            batchSize: options.batchSize || 50,
            syncInventory: syncType === 'inventory' || syncType === 'full',
            syncPrices: options.syncPrices || false,
            updateOutOfStock: options.updateOutOfStock !== false,
            dryRun: options.dryRun || false
          },
          filters: options.filters || {}
        },
        metadata: {
          triggeredBy: req.user?.id || 'manual',
          userAgent: req.get('User-Agent'),
          ipAddress: req.ip,
          tags: [syncType, 'manual'],
          notes: options.notes || `Manual ${syncType} sync`
        }
      });
      
      const savedJob = await syncJob.save();
      await savedJob.populate(['storeId', 'vendorId']);
      
      const syncData = {
        syncId: savedJob.jobId,
        jobId: savedJob._id,
        type: 'manual',
        syncType,
        storeId: savedJob.storeId,
        vendorId: savedJob.vendorId,
        status: savedJob.status,
        priority: savedJob.priority,
        options: savedJob.data,
        createdAt: savedJob.createdAt,
        estimatedDuration: this._estimateSyncDuration(syncType, options)
      };
      
      ResponseHelper.success(res, syncData, 'Manual sync started successfully', 201);
    } catch (error) {
      logger.error('Error starting manual sync:', error);
      
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to start manual sync', 500, 'MANUAL_SYNC_ERROR');
    }
  }

  /**
   * Start batch sync operation
   */
  async startBatchSync(req, res) {
    try {
      const { operations, priority = 0, options = {} } = req.body;
      
      // Validate operations array
      if (!operations || !Array.isArray(operations) || operations.length === 0) {
        return ResponseHelper.error(res, 'Operations array is required and must not be empty', 400, 'VALIDATION_ERROR');
      }
      
      if (operations.length > 100) {
        return ResponseHelper.error(res, 'Maximum 100 operations allowed per batch', 400, 'BATCH_SIZE_EXCEEDED');
      }
      
      // Validate each operation in batch
      const validationErrors = [];
      const validatedOperations = [];
      
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        
        if (!op.storeId || !op.vendorId) {
          validationErrors.push(`Operation ${i + 1}: Missing storeId or vendorId`);
          continue;
        }
        
        if (!op.syncType || !['inventory', 'products', 'full', 'incremental'].includes(op.syncType)) {
          validationErrors.push(`Operation ${i + 1}: Invalid or missing syncType`);
          continue;
        }
        
        // Validate store and vendor exist
        const [store, vendor] = await Promise.all([
          Store.findById(op.storeId),
          Vendor.findById(op.vendorId)
        ]);
        
        if (!store) {
          validationErrors.push(`Operation ${i + 1}: Store not found`);
          continue;
        }
        
        if (!vendor) {
          validationErrors.push(`Operation ${i + 1}: Vendor not found`);
          continue;
        }
        
        if (!store.accessToken) {
          validationErrors.push(`Operation ${i + 1}: Store is not connected`);
          continue;
        }
        
        if (!vendor.isActive) {
          validationErrors.push(`Operation ${i + 1}: Vendor is not active`);
          continue;
        }
        
        validatedOperations.push({
          ...op,
          store,
          vendor,
          index: i + 1
        });
      }
      
      if (validationErrors.length > 0) {
        return ResponseHelper.error(res, 'Batch validation failed', 400, 'BATCH_VALIDATION_ERROR', {
          errors: validationErrors,
          validOperations: validatedOperations.length,
          totalOperations: operations.length
        });
      }
      
      // Create batch sync jobs
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const createdJobs = [];
      
      for (const op of validatedOperations) {
        const syncJob = new SyncJob({
          type: 'batch',
          storeId: op.storeId,
          vendorId: op.vendorId,
          priority: priority,
          data: {
            selectedProducts: op.selectedProducts || [],
            syncConfig: {
              batchSize: op.batchSize || 50,
              syncInventory: op.syncType === 'inventory' || op.syncType === 'full',
              syncPrices: op.syncPrices || false,
              updateOutOfStock: op.updateOutOfStock !== false,
              dryRun: op.dryRun || false
            },
            filters: op.filters || {}
          },
          metadata: {
            triggeredBy: req.user?.id || 'batch',
            userAgent: req.get('User-Agent'),
            ipAddress: req.ip,
            tags: [op.syncType, 'batch', batchId],
            notes: op.notes || `Batch ${op.syncType} sync (${op.index}/${operations.length})`,
            batchId,
            batchIndex: op.index,
            batchTotal: operations.length
          }
        });
        
        const savedJob = await syncJob.save();
        createdJobs.push(savedJob);
      }
      
      const batchData = {
        batchId,
        type: 'batch',
        operationsCount: createdJobs.length,
        priority,
        status: 'queued',
        jobs: createdJobs.map(job => ({
          jobId: job.jobId,
          syncId: job._id,
          storeId: job.storeId,
          vendorId: job.vendorId,
          syncType: job.metadata.tags.find(tag => ['inventory', 'products', 'full', 'incremental'].includes(tag)),
          status: job.status
        })),
        estimatedDuration: this._estimateBatchDuration(createdJobs),
        createdAt: new Date()
      };
      
      ResponseHelper.success(res, batchData, 'Batch sync started successfully', 201);
    } catch (error) {
      logger.error('Error starting batch sync:', error);
      
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid ID format in operations', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to start batch sync', 500, 'BATCH_SYNC_ERROR');
    }
  }

  /**
   * Get sync status by ID
   */
  async getSyncStatus(req, res) {
    try {
      const { id, syncId } = req.params;
      const paramId = id || syncId;
      
      // Try to find by jobId first, then by _id
      let syncJob = await SyncJob.findOne({ jobId: paramId })
        .populate('storeId', 'name domain')
        .populate('vendorId', 'name');
      
      if (!syncJob) {
        syncJob = await SyncJob.findById(paramId)
          .populate('storeId', 'name domain')
          .populate('vendorId', 'name');
      }
      
      if (!syncJob) {
        return ResponseHelper.error(res, 'Sync job not found', 404, 'SYNC_NOT_FOUND');
      }
      
      // Calculate additional status information
      const now = new Date();
      const duration = syncJob.startedAt && syncJob.completedAt ? 
        syncJob.completedAt - syncJob.startedAt : 
        syncJob.startedAt ? now - syncJob.startedAt : null;
      
      const syncStatus = {
        syncId: syncJob.jobId,
        jobId: syncJob._id,
        type: syncJob.type,
        status: syncJob.status,
        priority: syncJob.priority,
        progress: {
          percentage: syncJob.progress.percentage,
          completed: syncJob.progress.completed,
          failed: syncJob.progress.failed,
          total: syncJob.progress.total
        },
        store: syncJob.storeId,
        vendor: syncJob.vendorId,
        createdAt: syncJob.createdAt,
        scheduledFor: syncJob.scheduledFor,
        startedAt: syncJob.startedAt,
        completedAt: syncJob.completedAt,
        duration: duration,
        attempts: syncJob.attempts,
        maxAttempts: syncJob.maxAttempts,
        data: syncJob.data,
        result: syncJob.result,
        errors: syncJob.errors,
        metadata: syncJob.metadata,
        isActive: syncJob.isActive,
        successRate: syncJob.successRate
      };
      
      // Add estimated time remaining for active jobs
      if (syncJob.status === 'active' && syncJob.startedAt) {
        const maxDuration = syncJob.data?.syncConfig?.maxExecutionTime || 3600000; // 1 hour default
        const elapsed = now - syncJob.startedAt;
        syncStatus.estimatedTimeRemaining = Math.max(0, maxDuration - elapsed);
      }
      
      ResponseHelper.success(res, syncStatus, 'Sync status retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving sync status:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid sync ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to retrieve sync status', 500, 'SYNC_STATUS_ERROR');
    }
  }

  /**
   * Get sync history
   */
  async getSyncHistory(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        status, 
        type, 
        storeId, 
        vendorId, 
        startDate, 
        endDate,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;
      
      // Build filter query
      const filter = {};
      
      // Status filter
      if (status) {
        if (Array.isArray(status)) {
          filter.status = { $in: status };
        } else {
          filter.status = status;
        }
      }
      
      // Type filter
      if (type) {
        if (Array.isArray(type)) {
          filter.type = { $in: type };
        } else {
          filter.type = type;
        }
      }
      
      // Store filter
      if (storeId) {
        filter.storeId = storeId;
      }
      
      // Vendor filter
      if (vendorId) {
        filter.vendorId = vendorId;
      }
      
      // Date range filter
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
          filter.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          filter.createdAt.$lte = new Date(endDate);
        }
      }
      
      // Build sort object
      const sort = {};
      const validSortFields = ['createdAt', 'completedAt', 'status', 'type', 'priority'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      sort[sortField] = sortOrder === 'asc' ? 1 : -1;
      
      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const limitNum = parseInt(limit);
      
      // Fetch sync history with pagination
      const [history, total] = await Promise.all([
        SyncJob.find(filter)
          .populate('storeId', 'name domain')
          .populate('vendorId', 'name')
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .select('jobId type status priority createdAt startedAt completedAt progress result errors metadata'),
        SyncJob.countDocuments(filter)
      ]);
      
      const pagination = {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: skip + limitNum < total,
        hasPrev: parseInt(page) > 1
      };
      
      ResponseHelper.success(res, {
        history,
        pagination     
      }, 'Sync history retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving sync history:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid ID format in filters', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to retrieve sync history', 500, 'SYNC_HISTORY_ERROR');
    }
  }

  /**
   * Pause sync operation
   */
  async pauseSync(req, res) {
    try {
      const { id, syncId } = req.params;
      const paramId = id || syncId;
      
      // Try to find by jobId first, then by _id
      let syncJob = await SyncJob.findOne({ jobId: paramId });
      
      if (!syncJob) {
        syncJob = await SyncJob.findById(paramId);
      }
      
      if (!syncJob) {
        return ResponseHelper.error(res, 'Sync job not found', 404, 'SYNC_NOT_FOUND');
      }
      
      // Check if job can be paused (only active jobs can be paused)
      if (syncJob.status !== 'active') {
        return ResponseHelper.error(res, `Cannot pause sync job with status: ${syncJob.status}. Only active jobs can be paused.`, 400, 'SYNC_NOT_PAUSABLE');
      }
      
      // Update job status to paused
      syncJob.status = 'delayed'; // Using 'delayed' as pause status in the schema
      
      // Add pause information to metadata
      if (!syncJob.metadata) {
        syncJob.metadata = {};
      }
      
      syncJob.metadata.pausedAt = new Date();
      syncJob.metadata.pausedBy = req.user?.id || 'system';
      syncJob.metadata.pauseReason = req.body.reason || 'Manual pause';
      
      // If there are existing tags, add pause tag
      if (syncJob.metadata.tags) {
        if (!syncJob.metadata.tags.includes('paused')) {
          syncJob.metadata.tags.push('paused');
        }
      } else {
        syncJob.metadata.tags = ['paused'];
      }
      
      const updatedJob = await syncJob.save();
      await updatedJob.populate(['storeId', 'vendorId']);
      
      const pauseResult = {
        syncId: updatedJob.jobId,
        jobId: updatedJob._id,
        status: updatedJob.status,
        previousStatus: 'active',
        pausedAt: syncJob.metadata.pausedAt,
        pausedBy: syncJob.metadata.pausedBy,
        pauseReason: syncJob.metadata.pauseReason,
        store: updatedJob.storeId,
        vendor: updatedJob.vendorId,
        progress: updatedJob.progress,
        metadata: updatedJob.metadata
      };
      
      ResponseHelper.success(res, pauseResult, 'Sync paused successfully');
    } catch (error) {
      logger.error('Error pausing sync:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid sync ID format', 400, 'INVALID_ID_FORMAT');
      }
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      
      ResponseHelper.error(res, 'Failed to pause sync', 500, 'SYNC_PAUSE_ERROR');
    }
  }

  /**
   * Resume sync operation
   */
  async resumeSync(req, res) {
    try {
      const { id, syncId } = req.params;
      const paramId = id || syncId;
      
      // Try to find by jobId first, then by _id
      let syncJob = await SyncJob.findOne({ jobId: paramId });
      
      if (!syncJob) {
        syncJob = await SyncJob.findById(paramId);
      }
      
      if (!syncJob) {
        return ResponseHelper.error(res, 'Sync job not found', 404, 'SYNC_NOT_FOUND');
      }
      
      // Check if job can be resumed (only delayed/paused jobs can be resumed)
      if (syncJob.status !== 'delayed') {
        return ResponseHelper.error(res, `Cannot resume sync job with status: ${syncJob.status}. Only paused jobs can be resumed.`, 400, 'SYNC_NOT_RESUMABLE');
      }
      
      // Check if this job was actually paused (has pause metadata)
      const wasPaused = syncJob.metadata?.tags?.includes('paused') || syncJob.metadata?.pausedAt;
      if (!wasPaused) {
        return ResponseHelper.error(res, 'This job was not paused and cannot be resumed', 400, 'SYNC_NOT_PAUSED');
      }
      
      // Update job status back to queued (will be picked up by job processor)
      syncJob.status = 'queued';
      
      // Add resume information to metadata
      if (!syncJob.metadata) {
        syncJob.metadata = {};
      }
      
      syncJob.metadata.resumedAt = new Date();
      syncJob.metadata.resumedBy = req.user?.id || 'system';
      syncJob.metadata.resumeReason = req.body.reason || 'Manual resume';
      
      // Remove pause tag and add resume tag
      if (syncJob.metadata.tags) {
        syncJob.metadata.tags = syncJob.metadata.tags.filter(tag => tag !== 'paused');
        if (!syncJob.metadata.tags.includes('resumed')) {
          syncJob.metadata.tags.push('resumed');
        }
      } else {
        syncJob.metadata.tags = ['resumed'];
      }
      
      const updatedJob = await syncJob.save();
      await updatedJob.populate(['storeId', 'vendorId']);
      
      const resumeResult = {
        syncId: updatedJob.jobId,
        jobId: updatedJob._id,
        status: updatedJob.status,
        previousStatus: 'delayed',
        resumedAt: syncJob.metadata.resumedAt,
        resumedBy: syncJob.metadata.resumedBy,
        resumeReason: syncJob.metadata.resumeReason,
        pausedAt: syncJob.metadata.pausedAt,
        store: updatedJob.storeId,
        vendor: updatedJob.vendorId,
        progress: updatedJob.progress,
        metadata: updatedJob.metadata
      };
      
      ResponseHelper.success(res, resumeResult, 'Sync resumed successfully');
    } catch (error) {
      logger.error('Error resuming sync:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid sync ID format', 400, 'INVALID_ID_FORMAT');
      }
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      
      ResponseHelper.error(res, 'Failed to resume sync', 500, 'SYNC_RESUME_ERROR');
    }
  }

  /**
   * Cancel sync operation
   */
  async cancelSync(req, res) {
    try {
      const { id, syncId } = req.params;
      const paramId = id || syncId;
      
      // Try to find by jobId first, then by _id
      let syncJob = await SyncJob.findOne({ jobId: paramId });
      
      if (!syncJob) {
        syncJob = await SyncJob.findById(paramId);
      }
      
      if (!syncJob) {
        return ResponseHelper.error(res, 'Sync job not found', 404, 'SYNC_NOT_FOUND');
      }
      
      // Check if job can be cancelled (only active, queued, or delayed jobs can be cancelled)
      const cancellableStatuses = ['queued', 'active', 'delayed'];
      if (!cancellableStatuses.includes(syncJob.status)) {
        return ResponseHelper.error(res, `Cannot cancel sync job with status: ${syncJob.status}. Only queued, active, or paused jobs can be cancelled.`, 400, 'SYNC_NOT_CANCELLABLE');
      }
      
      // Store original status for response
      const originalStatus = syncJob.status;
      
      // Update job status to cancelled
      syncJob.status = 'cancelled';
      syncJob.completedAt = new Date();
      
      // Add cancellation information to metadata
      if (!syncJob.metadata) {
        syncJob.metadata = {};
      }
      
      syncJob.metadata.cancelledAt = new Date();
      syncJob.metadata.cancelledBy = req.user?.id || 'system';
      syncJob.metadata.cancellationReason = req.body.reason || 'Manual cancellation';
      syncJob.metadata.originalStatus = originalStatus;
      
      // Add cancelled tag
      if (syncJob.metadata.tags) {
        if (!syncJob.metadata.tags.includes('cancelled')) {
          syncJob.metadata.tags.push('cancelled');
        }
        // Remove paused tag if it exists
        syncJob.metadata.tags = syncJob.metadata.tags.filter(tag => tag !== 'paused');
      } else {
        syncJob.metadata.tags = ['cancelled'];
      }
      
      // Set result with cancellation info
      syncJob.result = {
        success: false,
        message: 'Job was cancelled',
        data: null,
        stats: {
          inventoryUpdates: syncJob.progress.completed || 0,
          priceUpdates: 0,
          errors: syncJob.progress.failed || 0,
          duration: syncJob.startedAt ? Date.now() - syncJob.startedAt.getTime() : 0
        }
      };
      
      const updatedJob = await syncJob.save();
      await updatedJob.populate(['storeId', 'vendorId']);
      
      const cancelResult = {
        syncId: updatedJob.jobId,
        jobId: updatedJob._id,
        status: updatedJob.status,
        originalStatus,
        cancelledAt: syncJob.metadata.cancelledAt,
        cancelledBy: syncJob.metadata.cancelledBy,
        cancellationReason: syncJob.metadata.cancellationReason,
        store: updatedJob.storeId,
        vendor: updatedJob.vendorId,
        progress: updatedJob.progress,
        result: updatedJob.result,
        metadata: updatedJob.metadata
      };
      
      ResponseHelper.success(res, cancelResult, 'Sync cancelled successfully');
    } catch (error) {
      logger.error('Error cancelling sync:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid sync ID format', 400, 'INVALID_ID_FORMAT');
      }
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      
      ResponseHelper.error(res, 'Failed to cancel sync', 500, 'SYNC_CANCEL_ERROR');
    }
  }

  /**
   * Get active sync operations
   */
  async getActiveSyncs(req, res) {
    try {
      const { 
        storeId, 
        vendorId, 
        type, 
        priority, 
        groupBy = 'type',
        includeProgress = true 
      } = req.query;
      
      // Build filter for active jobs (queued, active, delayed)
      const filter = {
        status: { $in: ['queued', 'active', 'delayed'] }
      };
      
      // Apply additional filters
      if (storeId) {
        filter.storeId = storeId;
      }
      if (vendorId) {
        filter.vendorId = vendorId;
      }
      if (type) {
        if (Array.isArray(type)) {
          filter.type = { $in: type };
        } else {
          filter.type = type;
        }
      }
      if (priority !== undefined) {
        filter.priority = parseInt(priority);
      }
      
      // Fetch active sync jobs
      const activeSyncs = await SyncJob.find(filter)
        .populate('storeId', 'name domain')
        .populate('vendorId', 'name')
        .sort({ priority: -1, createdAt: 1 }) // High priority first, then FIFO
        .select('jobId type status priority progress createdAt startedAt scheduledFor data.syncConfig metadata');
      
      // Calculate additional information for each job
      const now = new Date();
      const enrichedSyncs = activeSyncs.map(job => {
        const jobData = job.toObject();
        
        // Calculate estimated time remaining for active jobs
        if (job.status === 'active' && job.startedAt) {
          const maxDuration = job.data?.syncConfig?.maxExecutionTime || 3600000; // 1 hour default
          const elapsed = now - job.startedAt.getTime();
          jobData.estimatedTimeRemaining = Math.max(0, maxDuration - elapsed);
          jobData.elapsedTime = elapsed;
        }
        
        // Calculate wait time for queued jobs
        if (job.status === 'queued') {
          jobData.waitTime = now - job.createdAt.getTime();
        }
        
        // Calculate pause duration for delayed/paused jobs
        if (job.status === 'delayed' && job.metadata?.pausedAt) {
          jobData.pauseDuration = now - new Date(job.metadata.pausedAt).getTime();
        }
        
        // Add queue position estimate for queued jobs
        if (job.status === 'queued') {
          const higherPriorityCount = activeSyncs.filter(j => 
            j.status === 'queued' && 
            (j.priority > job.priority || 
             (j.priority === job.priority && j.createdAt < job.createdAt))
          ).length;
          jobData.queuePosition = higherPriorityCount + 1;
        }
        
        return jobData;
      });
      
      // Group results if requested
      let groupedSyncs = {};
      const validGroupBy = ['type', 'status', 'priority', 'store', 'vendor'];
      const groupField = validGroupBy.includes(groupBy) ? groupBy : 'type';
      
      if (groupField === 'store') {
        groupedSyncs = enrichedSyncs.reduce((acc, job) => {
          const key = job.storeId?.name || 'Unknown Store';
          if (!acc[key]) acc[key] = [];
          acc[key].push(job);
          return acc;
        }, {});
      } else if (groupField === 'vendor') {
        groupedSyncs = enrichedSyncs.reduce((acc, job) => {
          const key = job.vendorId?.name || 'Unknown Vendor';
          if (!acc[key]) acc[key] = [];
          acc[key].push(job);
          return acc;
        }, {});
      } else {
        groupedSyncs = enrichedSyncs.reduce((acc, job) => {
          const key = job[groupField] || 'Unknown';
          if (!acc[key]) acc[key] = [];
          acc[key].push(job);
          return acc;
        }, {});
      }
      
      // Calculate summary statistics
      const summary = {
        total: enrichedSyncs.length,
        byStatus: {
          queued: enrichedSyncs.filter(j => j.status === 'queued').length,
          active: enrichedSyncs.filter(j => j.status === 'active').length,
          paused: enrichedSyncs.filter(j => j.status === 'delayed').length
        },
        byType: enrichedSyncs.reduce((acc, job) => {
          acc[job.type] = (acc[job.type] || 0) + 1;
          return acc;
        }, {}),
        byPriority: enrichedSyncs.reduce((acc, job) => {
          const priority = job.priority || 0;
          acc[priority] = (acc[priority] || 0) + 1;
          return acc;
        }, {}),
        averageWaitTime: enrichedSyncs
          .filter(j => j.waitTime)
          .reduce((sum, j) => sum + j.waitTime, 0) / 
          Math.max(enrichedSyncs.filter(j => j.waitTime).length, 1),
        longestRunning: enrichedSyncs
          .filter(j => j.status === 'active' && j.elapsedTime)
          .sort((a, b) => (b.elapsedTime || 0) - (a.elapsedTime || 0))[0] || null
      };
      
      const response = {
        summary,
        groupedBy: groupField,
        grouped: groupedSyncs,
        jobs: enrichedSyncs,
        filters: { storeId, vendorId, type, priority }
      };
      
      ResponseHelper.success(res, response, 'Active syncs retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving active syncs:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid ID format in filters', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to retrieve active syncs', 500, 'ACTIVE_SYNCS_ERROR');
    }
  }
  // Helper methods
  _estimateSyncDuration(syncType, options) {
    const baseTime = {
      'inventory': 300000, // 5 minutes
      'products': 600000,  // 10 minutes
      'full': 1800000,     // 30 minutes
      'incremental': 180000 // 3 minutes
    };
    
    let duration = baseTime[syncType] || baseTime['inventory'];
    
    // Adjust based on batch size
    if (options.batchSize) {
      const factor = options.batchSize / 50; // 50 is default
      duration = duration * factor;
    }
    
    // Adjust for selected products
    if (options.selectedProducts && options.selectedProducts.length > 0) {
      const factor = Math.min(options.selectedProducts.length / 100, 2); // Max 2x for large selections
      duration = duration * factor;
    }
    
    return Math.round(duration);
  }
  
  _estimateBatchDuration(jobs) {
    // Estimate batch duration as sum of individual jobs with some parallelization factor
    const totalDuration = jobs.reduce((sum, job) => {
      const syncType = job.metadata.tags.find(tag => ['inventory', 'products', 'full', 'incremental'].includes(tag));
      return sum + this._estimateSyncDuration(syncType, job.data.syncConfig);
    }, 0);
    
    // Apply parallelization factor (assume 3 jobs can run in parallel)
    const parallelFactor = Math.min(jobs.length / 3, 1);
    return Math.round(totalDuration * parallelFactor);
  }
}

module.exports = new SyncController();
