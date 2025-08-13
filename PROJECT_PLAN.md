# Couture Candy Vendor Inventory Management App

## Project Overview
An admin-only application to manage bulk inventory updates for Shopify stores by integrating with vendor APIs (starting with Noxa). The system automates inventory synchronization between vendor stock levels and Shopify product variants.

## Tech Stack
- **Backend**: Node.js with Express.js
- **Frontend**: React.js
- **Database**: MongoDB (Local)
- **Authentication**: Admin password-based login
- **Scheduling**: Node-cron for automated tasks
- **Real-time Updates**: Socket.io for sync status

## Core Features

### 1. Admin Authentication
- Simple password-based login system
- Session management
- Admin-only access to all features

### 2. Shopify Store Connection
- Connect Shopify stores via custom app access tokens
- Store connection validation
- Multiple store support

### 3. Vendor API Integration
- Noxa API integration (expandable to other vendors)
- Manual vendor API configuration (API endpoint + access token)
- Vendor product data fetching and storage

### 4. Product Mapping & SKU Management
- Map vendor products to Shopify variants
- Handle SKU patterns (e.g., `noxa_E467W-White-2-CCSALE` → main product `E467W`)
- Support for color/size variations
- Bulk mapping capabilities

### 5. Inventory Synchronization
- **Manual Sync**: Select specific SKUs for immediate update
- **Automated Sync**: Cron-based scheduled updates for all products
- Real-time sync progress tracking
- Error handling and retry mechanisms

### 6. Dashboard & Monitoring
- Real-time sync status display
- Inventory level comparisons (vendor vs Shopify)
- Sync history and logs
- Product mapping overview

## Application Architecture

### Backend Structure (Node.js)
```
backend/
├── src/
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── shopify.controller.js
│   │   ├── vendor.controller.js
│   │   ├── inventory.controller.js
│   │   └── sync.controller.js
│   ├── models/
│   │   ├── Store.js
│   │   ├── Vendor.js
│   │   ├── Product.js
│   │   ├── ProductMapping.js
│   │   └── SyncLog.js
│   ├── services/
│   │   ├── shopify.service.js
│   │   ├── noxa.service.js
│   │   ├── inventory.service.js
│   │   └── sync.service.js
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   └── validation.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── shopify.routes.js
│   │   ├── vendor.routes.js
│   │   └── inventory.routes.js
│   ├── utils/
│   │   ├── database.js
│   │   ├── logger.js
│   │   └── scheduler.js
│   └── app.js
├── config/
│   └── database.config.js
├── package.json
└── README.md
```

### Frontend Structure (React)
```
frontend/
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   └── LoadingSpinner.jsx
│   │   ├── auth/
│   │   │   └── Login.jsx
│   │   ├── dashboard/
│   │   │   ├── Dashboard.jsx
│   │   │   └── SyncStatus.jsx
│   │   ├── stores/
│   │   │   ├── StoreList.jsx
│   │   │   └── AddStore.jsx
│   │   ├── vendors/
│   │   │   ├── VendorList.jsx
│   │   │   └── AddVendor.jsx
│   │   ├── products/
│   │   │   ├── ProductMapping.jsx
│   │   │   └── InventoryView.jsx
│   │   └── sync/
│   │       ├── ManualSync.jsx
│   │       └── SyncHistory.jsx
│   ├── pages/
│   │   ├── DashboardPage.jsx
│   │   ├── StoresPage.jsx
│   │   ├── VendorsPage.jsx
│   │   ├── ProductsPage.jsx
│   │   └── SyncPage.jsx
│   ├── services/
│   │   ├── api.service.js
│   │   ├── auth.service.js
│   │   └── socket.service.js
│   ├── hooks/
│   │   ├── useAuth.js
│   │   └── useSocket.js
│   ├── context/
│   │   └── AuthContext.js
│   ├── utils/
│   │   └── helpers.js
│   └── App.js
├── public/
├── package.json
└── README.md
```

## Database Schema (MongoDB)

### Collections

#### 1. Stores
```javascript
{
  _id: ObjectId,
  name: String,
  shopifyDomain: String,
  accessToken: String (encrypted),
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

#### 2. Vendors
```javascript
{
  _id: ObjectId,
  name: String,
  apiEndpoint: String,
  accessToken: String (encrypted),
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

#### 3. Products
```javascript
{
  _id: ObjectId,
  vendorId: ObjectId,
  vendorProductId: String,
  mainSku: String, // e.g., "E467W"
  name: String,
  description: String,
  variants: [{
    vendorVariantId: String,
    sku: String,
    color: String,
    size: String,
    inventory: Number,
    lastUpdated: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

#### 4. ProductMappings
```javascript
{
  _id: ObjectId,
  storeId: ObjectId,
  vendorId: ObjectId,
  vendorProductId: String,
  vendorVariantId: String,
  shopifyProductId: String,
  shopifyVariantId: String,
  vendorSku: String,
  shopifySku: String,
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

#### 5. SyncLogs
```javascript
{
  _id: ObjectId,
  type: String, // "manual" | "automated"
  storeId: ObjectId,
  vendorId: ObjectId,
  status: String, // "pending" | "running" | "completed" | "failed"
  totalProducts: Number,
  processedProducts: Number,
  successCount: Number,
  errorCount: Number,
  errors: [String],
  startTime: Date,
  endTime: Date,
  createdAt: Date
}
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Admin logout
- `GET /api/auth/verify` - Verify session

### Shopify Stores
- `GET /api/stores` - List connected stores
- `POST /api/stores` - Connect new store
- `PUT /api/stores/:id` - Update store
- `DELETE /api/stores/:id` - Remove store
- `GET /api/stores/:id/products` - Get store products

### Vendors
- `GET /api/vendors` - List vendors
- `POST /api/vendors` - Add vendor
- `PUT /api/vendors/:id` - Update vendor
- `DELETE /api/vendors/:id` - Remove vendor
- `GET /api/vendors/:id/products` - Get vendor products
- `POST /api/vendors/:id/sync-products` - Fetch latest vendor products

### Product Mapping
- `GET /api/mappings` - List product mappings
- `POST /api/mappings` - Create mapping
- `PUT /api/mappings/:id` - Update mapping
- `DELETE /api/mappings/:id` - Remove mapping
- `POST /api/mappings/bulk` - Bulk create mappings

### Inventory Sync
- `POST /api/sync/manual` - Start manual sync
- `GET /api/sync/status/:id` - Get sync status
- `GET /api/sync/history` - Get sync history
- `POST /api/sync/schedule` - Update cron schedule

## SKU Pattern Handling

### Pattern Recognition
The system will handle various SKU patterns:
- Main product: `E467W`, `6015`
- Shopify variants: `noxa_E467W-White-2-CCSALE`, `noxa_6015-NUDE-XS`
- Pattern parsing: Extract main SKU, color, size from variant SKUs

### Mapping Logic
1. Extract main SKU from Shopify variant SKU
2. Match with vendor product by main SKU
3. Map color/size combinations
4. Handle special cases and prefixes

## Development Milestones

### Phase 1: Foundation (Week 1-2)
- [ ] Set up project structure (backend & frontend folders)
- [ ] Initialize Node.js backend with Express
- [ ] Initialize React frontend
- [ ] Set up MongoDB connection
- [ ] Implement basic authentication system
- [ ] Create database models and schemas

### Phase 2: Core Integration (Week 3-4)
- [ ] Implement Shopify API integration
- [ ] Implement Noxa vendor API integration
- [ ] Create product fetching and storage logic
- [ ] Build basic admin dashboard
- [ ] Implement store connection functionality

### Phase 3: Product Mapping (Week 5-6)
- [ ] Develop SKU pattern recognition
- [ ] Build product mapping interface
- [ ] Implement bulk mapping capabilities
- [ ] Create mapping validation logic
- [ ] Add mapping management UI

### Phase 4: Inventory Sync (Week 7-8)
- [ ] Implement manual sync functionality
- [ ] Build automated cron-based sync
- [ ] Add real-time sync status tracking
- [ ] Implement error handling and retry logic
- [ ] Create sync history and logging

### Phase 5: Enhancement & Testing (Week 9-10)
- [ ] Add real-time updates with Socket.io
- [ ] Implement comprehensive error handling
- [ ] Add data validation and sanitization
- [ ] Performance optimization
- [ ] Security enhancements
- [ ] Testing and bug fixes

### Phase 6: Deployment & Documentation (Week 11-12)
- [ ] Deployment setup
- [ ] User documentation
- [ ] API documentation
- [ ] Performance monitoring
- [ ] Backup and recovery procedures

## Security Considerations
- Encrypt stored access tokens
- Implement rate limiting
- Input validation and sanitization
- Secure session management
- API endpoint protection
- Environment variable management

## Performance Optimization
- Database indexing strategy
- Caching for frequently accessed data
- Batch processing for bulk operations
- Connection pooling
- Efficient SKU matching algorithms

## Monitoring & Logging
- Comprehensive error logging
- Sync operation tracking
- Performance metrics
- API usage monitoring
- Alert system for failed syncs

## Future Enhancements
- Support for additional vendor APIs
- Advanced SKU mapping rules
- Inventory forecasting
- Multi-admin support
- Mobile responsive design
- Webhook support for real-time updates
