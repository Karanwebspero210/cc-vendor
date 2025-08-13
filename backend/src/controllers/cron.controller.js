const { ResponseHelper } = require('../utils/helpers');
const logger = require('../utils/logger');
const SyncSchedule = require('../models/SyncSchedule');
const SyncJob = require('../models/SyncJob');

/**
 * Cron Controller
 * Handles cron job scheduling and management operations
 */
class CronController {
  /**
   * Get all scheduled cron jobs
   */
  async getSchedules(req, res) {
    try {
      const { page = 1, limit = 50, active, storeId, vendorId } = req.query;
      
      // Build filter query
      const filter = {};
      if (active !== undefined) {
        filter.isActive = active === 'true';
      }
      if (storeId) {
        filter.storeId = storeId;
      }
      if (vendorId) {
        filter.vendorId = vendorId;
      }
      
      // Fetch schedules with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [schedules, total] = await Promise.all([
        SyncSchedule.find(filter)
          .populate('storeId', 'name domain')
          .populate('vendorId', 'name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        SyncSchedule.countDocuments(filter)
      ]);
      
      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      };
      
      ResponseHelper.success(res, {
        schedules,
        pagination,
        filters: { active, storeId, vendorId }
      }, 'Cron schedules retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving cron schedules:', error);
      ResponseHelper.error(res, 'Failed to retrieve cron schedules', 500, 'CRON_SCHEDULES_ERROR');
    }
  }

  /**
   * Create a new cron schedule
   */
  async createSchedule(req, res) {
    try {
      const { name, description, cronExpression, storeId, vendorId, syncConfig, timezone, notifications } = req.body;
      
      // Validate required fields
      if (!name || !cronExpression || !storeId || !vendorId) {
        return ResponseHelper.error(res, 'Missing required fields: name, cronExpression, storeId, vendorId', 400, 'VALIDATION_ERROR');
      }
      
      // Validate cron expression format (basic validation)
      const cronParts = cronExpression.trim().split(/\s+/);
      if (cronParts.length !== 5) {
        return ResponseHelper.error(res, 'Invalid cron expression format. Expected 5 fields.', 400, 'INVALID_CRON_EXPRESSION');
      }
      
      // Create new schedule
      const schedule = new SyncSchedule({
        name,
        description,
        cronExpression,
        storeId,
        vendorId,
        syncConfig: syncConfig || {},
        timezone: timezone || 'UTC',
        notifications: notifications || {},
        createdBy: req.user?.id || 'system'
      });
      
      // Calculate next run time
      await schedule.updateNextRun();
      
      const savedSchedule = await schedule.save();
      await savedSchedule.populate(['storeId', 'vendorId']);
      
      ResponseHelper.success(res, savedSchedule, 'Cron schedule created successfully', 201);
    } catch (error) {
      logger.error('Error creating cron schedule:', error);
      
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      
      ResponseHelper.error(res, 'Failed to create cron schedule', 500, 'CRON_SCHEDULE_CREATION_ERROR');
    }
  }

  /**
   * Get cron schedule by ID
   */
  async getScheduleById(req, res) {
    try {
      const { id } = req.params;
      
      // Fetch schedule from database
      const schedule = await SyncSchedule.findById(id)
        .populate('storeId', 'name domain')
        .populate('vendorId', 'name');
      
      if (!schedule) {
        return ResponseHelper.error(res, 'Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
      }
      
      // Get recent execution history summary
      const recentJobs = await SyncJob.find({
        storeId: schedule.storeId,
        vendorId: schedule.vendorId,
        type: 'scheduled'
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('status createdAt completedAt result.stats');
      
      const scheduleWithHistory = {
        ...schedule.toObject(),
        recentExecutions: recentJobs
      };
      
      ResponseHelper.success(res, scheduleWithHistory, 'Cron schedule retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving cron schedule:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid schedule ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to retrieve cron schedule', 500, 'CRON_SCHEDULE_FETCH_ERROR');
    }
  }

  /**
   * Update cron schedule
   */
  async updateSchedule(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      // Find existing schedule
      const schedule = await SyncSchedule.findById(id);
      if (!schedule) {
        return ResponseHelper.error(res, 'Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
      }
      
      // Validate cron expression if being updated
      if (updateData.cronExpression) {
        const cronParts = updateData.cronExpression.trim().split(/\s+/);
        if (cronParts.length !== 5) {
          return ResponseHelper.error(res, 'Invalid cron expression format. Expected 5 fields.', 400, 'INVALID_CRON_EXPRESSION');
        }
      }
      
      // Update allowed fields
      const allowedUpdates = ['name', 'description', 'cronExpression', 'syncConfig', 'timezone', 'notifications', 'metadata'];
      allowedUpdates.forEach(field => {
        if (updateData[field] !== undefined) {
          schedule[field] = updateData[field];
        }
      });
      
      schedule.lastModifiedBy = req.user?.id || 'system';
      
      // Recalculate next run if cron expression changed
      if (updateData.cronExpression) {
        await schedule.updateNextRun();
      }
      
      const updatedSchedule = await schedule.save();
      await updatedSchedule.populate(['storeId', 'vendorId']);
      
      ResponseHelper.success(res, updatedSchedule, 'Cron schedule updated successfully');
    } catch (error) {
      logger.error('Error updating cron schedule:', error);
      
      if (error.name === 'ValidationError') {
        return ResponseHelper.error(res, error.message, 400, 'VALIDATION_ERROR');
      }
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid schedule ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to update cron schedule', 500, 'CRON_SCHEDULE_UPDATE_ERROR');
    }
  }

  /**
   * Delete cron schedule
   */
  async deleteSchedule(req, res) {
    try {
      const { id } = req.params;
      
      // Find and validate schedule exists
      const schedule = await SyncSchedule.findById(id);
      if (!schedule) {
        return ResponseHelper.error(res, 'Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
      }
      
      // Cancel any running jobs for this schedule
      await SyncJob.updateMany(
        {
          storeId: schedule.storeId,
          vendorId: schedule.vendorId,
          status: { $in: ['queued', 'active', 'delayed'] },
          type: 'scheduled'
        },
        {
          status: 'cancelled',
          completedAt: new Date()
        }
      );
      
      // Delete the schedule
      await SyncSchedule.findByIdAndDelete(id);
      
      ResponseHelper.success(res, null, 'Cron schedule deleted successfully');
    } catch (error) {
      logger.error('Error deleting cron schedule:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid schedule ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to delete cron schedule', 500, 'CRON_SCHEDULE_DELETE_ERROR');
    }
  }

  /**
   * Activate a cron schedule
   */
  async activateSchedule(req, res) {
    try {
      const { id } = req.params;
      
      // Find and validate schedule exists
      const schedule = await SyncSchedule.findById(id);
      if (!schedule) {
        return ResponseHelper.error(res, 'Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
      }
      
      // Check if already active
      if (schedule.isActive) {
        return ResponseHelper.error(res, 'Schedule is already active', 400, 'SCHEDULE_ALREADY_ACTIVE');
      }
      
      // Activate the schedule using model method
      await schedule.activate();
      await schedule.populate(['storeId', 'vendorId']);
      
      const activationResult = {
        scheduleId: id,
        name: schedule.name,
        isActive: schedule.isActive,
        nextRun: schedule.nextRun,
        activatedAt: new Date(),
        store: schedule.storeId,
        vendor: schedule.vendorId
      };
      
      ResponseHelper.success(res, activationResult, 'Cron schedule activated successfully');
    } catch (error) {
      logger.error('Error activating cron schedule:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid schedule ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to activate cron schedule', 500, 'CRON_SCHEDULE_ACTIVATION_ERROR');
    }
  }

  /**
   * Deactivate a cron schedule
   */
  async deactivateSchedule(req, res) {
    try {
      const { id } = req.params;
      
      // Find and validate schedule exists
      const schedule = await SyncSchedule.findById(id);
      if (!schedule) {
        return ResponseHelper.error(res, 'Schedule not found', 404, 'SCHEDULE_NOT_FOUND');
      }
      
      // Check if already inactive
      if (!schedule.isActive) {
        return ResponseHelper.error(res, 'Schedule is already inactive', 400, 'SCHEDULE_ALREADY_INACTIVE');
      }
      
      // Stop any running jobs for this schedule
      await SyncJob.updateMany(
        {
          storeId: schedule.storeId,
          vendorId: schedule.vendorId,
          status: { $in: ['queued', 'active', 'delayed'] },
          type: 'scheduled'
        },
        {
          status: 'cancelled',
          completedAt: new Date()
        }
      );
      
      // Deactivate the schedule using model method
      await schedule.deactivate();
      await schedule.populate(['storeId', 'vendorId']);
      
      const deactivationResult = {
        scheduleId: id,
        name: schedule.name,
        isActive: schedule.isActive,
        nextRun: schedule.nextRun,
        deactivatedAt: new Date(),
        store: schedule.storeId,
        vendor: schedule.vendorId
      };
      
      ResponseHelper.success(res, deactivationResult, 'Cron schedule deactivated successfully');
    } catch (error) {
      logger.error('Error deactivating cron schedule:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid schedule ID format', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to deactivate cron schedule', 500, 'CRON_SCHEDULE_DEACTIVATION_ERROR');
    }
  }

  /**
   * Get currently running cron jobs
   */
  async getRunningJobs(req, res) {
    try {
      const { storeId, vendorId, type } = req.query;
      
      // Build filter for active jobs
      const filter = {
        status: { $in: ['queued', 'active', 'delayed'] }
      };
      
      if (storeId) {
        filter.storeId = storeId;
      }
      if (vendorId) {
        filter.vendorId = vendorId;
      }
      if (type) {
        filter.type = type;
      }
      
      // Fetch active jobs with progress and timing information
      const runningJobs = await SyncJob.find(filter)
        .populate('storeId', 'name domain')
        .populate('vendorId', 'name')
        .sort({ priority: -1, createdAt: 1 })
        .select('jobId type status priority progress createdAt startedAt scheduledFor data.syncConfig metadata');
      
      // Group jobs by type for better organization
      const groupedJobs = runningJobs.reduce((acc, job) => {
        const jobType = job.type;
        if (!acc[jobType]) {
          acc[jobType] = [];
        }
        acc[jobType].push({
          ...job.toObject(),
          estimatedTimeRemaining: job.startedAt ? 
            Math.max(0, (job.data?.syncConfig?.maxExecutionTime || 3600000) - (Date.now() - job.startedAt.getTime())) : 
            null
        });
        return acc;
      }, {});
      
      const response = {
        total: runningJobs.length,
        byType: groupedJobs,
        jobs: runningJobs,
        filters: { storeId, vendorId, type }
      };
      
      ResponseHelper.success(res, response, 'Running cron jobs retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving running cron jobs:', error);
      ResponseHelper.error(res, 'Failed to retrieve running cron jobs', 500, 'RUNNING_CRON_JOBS_ERROR');
    }
  }

  /**
   * Get cron job execution history
   */
  async getJobHistory(req, res) {
    try {
      const { page = 1, limit = 50, scheduleId, status, storeId, vendorId, type, startDate, endDate } = req.query;
      
      // Build filter query
      const filter = {};
      
      // Filter by schedule (if scheduleId provided, find jobs for that schedule's store/vendor)
      if (scheduleId) {
        const schedule = await SyncSchedule.findById(scheduleId);
        if (schedule) {
          filter.storeId = schedule.storeId;
          filter.vendorId = schedule.vendorId;
          filter.type = 'scheduled';
        }
      }
      
      // Direct filters
      if (storeId) {
        filter.storeId = storeId;
      }
      if (vendorId) {
        filter.vendorId = vendorId;
      }
      if (status) {
        filter.status = status;
      }
      if (type) {
        filter.type = type;
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
      
      // Only show completed jobs (not queued/active)
      if (!status) {
        filter.status = { $in: ['completed', 'failed', 'cancelled'] };
      }
      
      // Fetch job history with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [jobs, total] = await Promise.all([
        SyncJob.find(filter)
          .populate('storeId', 'name domain')
          .populate('vendorId', 'name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .select('jobId type status priority createdAt startedAt completedAt result progress errors metadata'),
        SyncJob.countDocuments(filter)
      ]);
      
      // Calculate statistics
      const stats = await SyncJob.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgDuration: {
              $avg: {
                $cond: {
                  if: { $and: ['$startedAt', '$completedAt'] },
                  then: { $subtract: ['$completedAt', '$startedAt'] },
                  else: null
                }
              }
            }
          }
        }
      ]);
      
      const pagination = {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      };
      
      ResponseHelper.success(res, {
        jobs,
        pagination,
        stats,
        filters: { scheduleId, status, storeId, vendorId, type, startDate, endDate }
      }, 'Cron job history retrieved successfully');
    } catch (error) {
      logger.error('Error retrieving cron job history:', error);
      
      if (error.name === 'CastError') {
        return ResponseHelper.error(res, 'Invalid ID format in filters', 400, 'INVALID_ID_FORMAT');
      }
      
      ResponseHelper.error(res, 'Failed to retrieve cron job history', 500, 'CRON_JOB_HISTORY_ERROR');
    }
  }
}

module.exports = new CronController();
