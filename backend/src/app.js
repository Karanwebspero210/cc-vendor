require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import utilities
const logger = require('./utils/logger');
const database = require('../config/database');
const { ResponseHelper } = require('./utils/helpers');

// Import routes
const authRoutes = require('./routes/auth.routes');
const storeRoutes = require('./routes/store.routes');
const syncRoutes = require('./routes/sync.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const shopifyRoutes = require('./routes/shopify.routes');
const cronRoutes = require('./routes/cron.routes');
const queueRoutes = require('./routes/queue.routes');
const productRoutes = require('./routes/product.routes');

// Import middleware
// Note: Sessions removed; JWT is used for auth

class App {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 5000;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3000',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
      message: {
        success: false,
        error: {
          message: 'Too many requests from this IP, please try again later.',
          code: 'RATE_LIMIT_EXCEEDED'
        }
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Sessions removed: using stateless JWT auth

    // Request logging middleware
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.api(`${req.method} ${req.path}`, {
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      });
      
      next();
    });

    // Health check endpoint (before auth)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0'
      });
    });
  }

  setupRoutes() {
    // API routes - Order matters! Specific routes before catch-all
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/stores', storeRoutes);
    this.app.use('/api/sync', syncRoutes);
    this.app.use('/api/inventory', inventoryRoutes);
    this.app.use('/api/shopify', shopifyRoutes);
    this.app.use('/api/cron', cronRoutes);
    this.app.use('/api/queue', queueRoutes);
    this.app.use('/api/products', productRoutes);

    // API root - provides API documentation
    this.app.get('/api', (req, res) => {
      ResponseHelper.success(res, {
        message: 'Couture Candy Vendor API',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        endpoints: {
          auth: '/api/auth',
          stores: '/api/stores',
          sync: '/api/sync',
          inventory: '/api/inventory',
          shopify: '/api/shopify',
          cron: '/api/cron',
          queue: '/api/queue',
          products: '/api/products'
        }
      });
    });

    // Catch all for undefined API routes - MUST be after all specific routes
    this.app.use('/api/*', (req, res) => {
      ResponseHelper.error(
        res,
        `API endpoint ${req.path} not found`,
        404,
        'ENDPOINT_NOT_FOUND'
      );
    });

    // Root route
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Couture Candy Vendor Management API',
        version: '1.0.0',
        documentation: '/api',
        health: '/health'
      });
    });
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use('*', (req, res) => {
      ResponseHelper.error(
        res,
        `Route ${req.originalUrl} not found`,
        404,
        'ROUTE_NOT_FOUND'
      );
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error('Unhandled error:', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      // Don't leak error details in production
      const message = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message;

      ResponseHelper.error(
        res,
        message,
        error.status || 500,
        'INTERNAL_ERROR',
        process.env.NODE_ENV !== 'production' ? error.stack : undefined
      );
    });
  }

  async start() {
    try {
      // Connect to database
      await database.connect();
      logger.info('Database connected successfully');

      // Start server
      this.server = this.app.listen(this.port, () => {
        logger.info(`Server running on port ${this.port}`, {
          environment: process.env.NODE_ENV || 'development',
          port: this.port
        });
      });

    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }  

  getApp() {
    return this.app;
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new App();
  app.start();
}

module.exports = App;
