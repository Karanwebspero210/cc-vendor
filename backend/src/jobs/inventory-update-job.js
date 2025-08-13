const logger = require('../config/logger');
const noxaService = require('../services/noxa.service');

class InventoryUpdateJob {
  constructor(skus) {
    this.skus = skus;
    this.status = 'pending';
    this.result = null;
    this.error = null;
    this.startedAt = null;
    this.completedAt = null;
  }

  async execute() {
    this.status = 'processing';
    this.startedAt = new Date();
    
    try {
      logger.info(`Starting inventory update for SKUs: ${this.skus.join(', ')}`);
      
      const response = await noxaService.getInventoryBySKUs(this.skus);
      
      if (!response.Result) {
        throw new Error(response.Message || 'Failed to update inventory');
      }
      
      this.result = {
        success: true,
        message: `Successfully updated inventory for ${this.skus.length} SKU(s)`,
        updatedAt: new Date()
      };
      this.status = 'completed';
    } catch (error) {
      logger.error('Error in InventoryUpdateJob:', error);
      this.status = 'failed';
      this.error = {
        message: error.message,
        stack: error.stack
      };
      throw error;
    } finally {
      this.completedAt = new Date();
      logger.info(`Inventory update job ${this.status} in ${this.completedAt - this.startedAt}ms`);
    }
    
    return this.getStatus();
  }
  
  getStatus() {
    return {
      status: this.status,
      skus: this.skus,
      result: this.result,
      error: this.error,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.startedAt && this.completedAt 
        ? this.completedAt - this.startedAt 
        : null
    };
  }
}

module.exports = InventoryUpdateJob;
