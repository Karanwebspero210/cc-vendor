const cron = require('node-cron');
const logger = require('../utils/logger');
const SyncSchedule = require('../models/SyncSchedule');
const syncService = require('./sync.service');

/**
 * Scheduler Service
 * Handles cron job scheduling and management
 */
class SchedulerService {
  constructor() {
    this.activeTasks = new Map(); // Store active cron tasks
    this.initialized = false;
  }

  /**
   * Initialize scheduler and load existing schedules
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }

      logger.info('Initializing scheduler service...');
      
      // Load and start all active schedules
      const activeSchedules = await SyncSchedule.find({ 
        isActive: true,
        status: 'active'
      });

      for (const schedule of activeSchedules) {
        await this.startSchedule(schedule);
      }

      this.initialized = true;
      logger.info(`Scheduler initialized with ${activeSchedules.length} active schedules`);
    } catch (error) {
      logger.error('Error initializing scheduler:', error);
      throw error;
    }
  }

  /**
   * Create a new cron schedule
   */
  async createSchedule(scheduleData) {
    try {
      const { name, cronExpression, storeId, vendorId, syncConfig } = scheduleData;

      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        throw new Error('Invalid cron expression');
      }

      // Create schedule record
      const schedule = new SyncSchedule({
        name,
        cronExpression,
        storeId,
        vendorId,
        syncConfig: {
          syncType: syncConfig.syncType || 'inventory',
          direction: syncConfig.direction || 'vendor-to-store',
          options: syncConfig.options || {}
        },
        isActive: true,
        status: 'active',
        nextRun: this.getNextRunTime(cronExpression)
      });

      await schedule.save();

      // Start the cron job
      await this.startSchedule(schedule);

      logger.info(`Created and started schedule: ${name}`);
      return schedule;
    } catch (error) {
      logger.error('Error creating schedule:', error);
      throw error;
    }
  }

  /**
   * Start a cron schedule
   */
  async startSchedule(schedule) {
    try {
      const scheduleId = schedule._id.toString();

      // Stop existing task if running
      if (this.activeTasks.has(scheduleId)) {
        this.activeTasks.get(scheduleId).stop();
      }

      // Create new cron task
      const task = cron.schedule(schedule.cronExpression, async () => {
        await this.executeScheduledSync(schedule);
      }, {
        scheduled: false,
        timezone: process.env.TIMEZONE || 'UTC'
      });

      // Start the task
      task.start();
      this.activeTasks.set(scheduleId, task);

      // Update schedule status
      await SyncSchedule.findByIdAndUpdate(scheduleId, {
        status: 'active',
        nextRun: this.getNextRunTime(schedule.cronExpression),
        lastStarted: new Date()
      });

      logger.info(`Started schedule: ${schedule.name} (${scheduleId})`);
    } catch (error) {
      logger.error('Error starting schedule:', error);
      throw error;
    }
  }

  /**
   * Stop a cron schedule
   */
  async stopSchedule(scheduleId) {
    try {
      const task = this.activeTasks.get(scheduleId);
      if (task) {
        task.stop();
        this.activeTasks.delete(scheduleId);
      }

      // Update schedule status
      await SyncSchedule.findByIdAndUpdate(scheduleId, {
        status: 'inactive',
        lastStopped: new Date()
      });

      logger.info(`Stopped schedule: ${scheduleId}`);
    } catch (error) {
      logger.error('Error stopping schedule:', error);
      throw error;
    }
  }

  /**
   * Update a cron schedule
   */
  async updateSchedule(scheduleId, updateData) {
    try {
      const schedule = await SyncSchedule.findById(scheduleId);
      if (!schedule) {
        throw new Error('Schedule not found');
      }

      // Validate new cron expression if provided
      if (updateData.cronExpression && !cron.validate(updateData.cronExpression)) {
        throw new Error('Invalid cron expression');
      }

      // Stop current task
      await this.stopSchedule(scheduleId);

      // Update schedule
      const updatedSchedule = await SyncSchedule.findByIdAndUpdate(
        scheduleId,
        {
          ...updateData,
          nextRun: updateData.cronExpression ? 
            this.getNextRunTime(updateData.cronExpression) : 
            schedule.nextRun,
          updatedAt: new Date()
        },
        { new: true }
      );

      // Restart if active
      if (updatedSchedule.isActive) {
        await this.startSchedule(updatedSchedule);
      }

      logger.info(`Updated schedule: ${scheduleId}`);
      return updatedSchedule;
    } catch (error) {
      logger.error('Error updating schedule:', error);
      throw error;
    }
  }

  /**
   * Delete a cron schedule
   */
  async deleteSchedule(scheduleId) {
    try {
      // Stop the task
      await this.stopSchedule(scheduleId);

      // Delete from database
      await SyncSchedule.findByIdAndDelete(scheduleId);

      logger.info(`Deleted schedule: ${scheduleId}`);
    } catch (error) {
      logger.error('Error deleting schedule:', error);
      throw error;
    }
  }

  /**
   * Activate a schedule
   */
  async activateSchedule(scheduleId) {
    try {
      const schedule = await SyncSchedule.findByIdAndUpdate(
        scheduleId,
        { 
          isActive: true,
          status: 'active',
          nextRun: this.getNextRunTime(schedule.cronExpression)
        },
        { new: true }
      );

      if (!schedule) {
        throw new Error('Schedule not found');
      }

      await this.startSchedule(schedule);
      
      return schedule;
    } catch (error) {
      logger.error('Error activating schedule:', error);
      throw error;
    }
  }

  /**
   * Deactivate a schedule
   */
  async deactivateSchedule(scheduleId) {
    try {
      await this.stopSchedule(scheduleId);

      const schedule = await SyncSchedule.findByIdAndUpdate(
        scheduleId,
        { 
          isActive: false,
          status: 'inactive'
        },
        { new: true }
      );

      if (!schedule) {
        throw new Error('Schedule not found');
      }

      return schedule;
    } catch (error) {
      logger.error('Error deactivating schedule:', error);
      throw error;
    }
  }

  /**
   * Execute scheduled sync
   */
  async executeScheduledSync(schedule) {
    try {
      logger.info(`Executing scheduled sync: ${schedule.name}`);

      // Update execution tracking
      await SyncSchedule.findByIdAndUpdate(schedule._id, {
        lastRun: new Date(),
        nextRun: this.getNextRunTime(schedule.cronExpression),
        'executionStats.totalRuns': schedule.executionStats.totalRuns + 1
      });

      // Execute the sync
      const syncResult = await syncService.startManualSync(
        schedule.storeId,
        schedule.vendorId,
        schedule.syncConfig.syncType,
        {
          ...schedule.syncConfig.options,
          scheduledSync: true,
          scheduleId: schedule._id
        }
      );

      // Update success stats
      await SyncSchedule.findByIdAndUpdate(schedule._id, {
        'executionStats.successfulRuns': schedule.executionStats.successfulRuns + 1,
        'executionStats.lastSuccess': new Date()
      });

      logger.info(`Scheduled sync completed successfully: ${schedule.name}`);
      return syncResult;
    } catch (error) {
      logger.error(`Scheduled sync failed: ${schedule.name}`, error);

      // Update failure stats
      await SyncSchedule.findByIdAndUpdate(schedule._id, {
        'executionStats.failedRuns': schedule.executionStats.failedRuns + 1,
        'executionStats.lastFailure': new Date(),
        'executionStats.lastError': error.message
      });

      // Handle notifications if configured
      if (schedule.notifications.onFailure) {
        await this.sendFailureNotification(schedule, error);
      }

      throw error;
    }
  }

  /**
   * Get all schedules
   */
  async getSchedules(filters = {}) {
    try {
      const query = {};
      
      if (filters.isActive !== undefined) {
        query.isActive = filters.isActive;
      }
      
      if (filters.storeId) {
        query.storeId = filters.storeId;
      }
      
      if (filters.vendorId) {
        query.vendorId = filters.vendorId;
      }

      const schedules = await SyncSchedule.find(query)
        .populate('storeId', 'name shopDomain')
        .populate('vendorId', 'name')
        .sort({ createdAt: -1 });

      return schedules.map(schedule => ({
        ...schedule.toObject(),
        isRunning: this.activeTasks.has(schedule._id.toString())
      }));
    } catch (error) {
      logger.error('Error getting schedules:', error);
      throw error;
    }
  }

  /**
   * Get running jobs
   */
  getRunningJobs() {
    const runningJobs = [];
    
    for (const [scheduleId, task] of this.activeTasks.entries()) {
      if (task.running) {
        runningJobs.push({
          scheduleId,
          status: 'running',
          startedAt: new Date() // TODO: Track actual start time
        });
      }
    }

    return runningJobs;
  }

  /**
   * Get next run time for cron expression
   */
  getNextRunTime(cronExpression) {
    try {
      const task = cron.schedule(cronExpression, () => {}, { scheduled: false });
      return task.nextDate().toDate();
    } catch (error) {
      logger.error('Error calculating next run time:', error);
      return null;
    }
  }

  /**
   * Validate cron expression
   */
  validateCronExpression(expression) {
    return cron.validate(expression);
  }

  /**
   * Send failure notification
   */
  async sendFailureNotification(schedule, error) {
    try {
      // TODO: Implement notification logic (email, webhook, etc.)
      logger.warn(`Notification: Schedule "${schedule.name}" failed - ${error.message}`);
    } catch (notificationError) {
      logger.error('Error sending failure notification:', notificationError);
    }
  }

  /**
   * Shutdown scheduler
   */
  async shutdown() {
    try {
      logger.info('Shutting down scheduler...');
      
      for (const [scheduleId, task] of this.activeTasks.entries()) {
        task.stop();
      }
      
      this.activeTasks.clear();
      this.initialized = false;
      
      logger.info('Scheduler shutdown complete');
    } catch (error) {
      logger.error('Error shutting down scheduler:', error);
    }
  }
}

module.exports = new SchedulerService();
