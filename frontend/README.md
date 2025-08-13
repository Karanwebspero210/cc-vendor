# Couture Candy Frontend Dashboard

## Overview
React.js frontend dashboard for managing inventory synchronization between vendor APIs and Shopify stores. Admin-only interface for bulk inventory management.

## Tech Stack
- **Framework**: React.js (v18+)
- **Routing**: React Router DOM
- **State Management**: React Context + useState/useReducer
- **HTTP Client**: Axios
- **Real-time**: Socket.io-client
- **UI Framework**: Tailwind CSS + Headless UI
- **Design System**: Custom CRM-style components
- **Icons**: Heroicons + Lucide React
- **Forms**: React Hook Form
- **Tables**: TanStack Table (React Table v8)
- **Charts**: Recharts
- **Notifications**: React Hot Toast
- **Color Scheme**: Black & White with brand primary #e94949

## Installation & Setup

### Prerequisites
- Node.js (v16+)
- npm or yarn

### Environment Variables
Create a `.env` file in the frontend root:
```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_SOCKET_URL=http://localhost:5000
REACT_APP_THEME=professional-crm
REACT_APP_BRAND_NAME="Couture Candy Admin"
REACT_APP_BRAND_PRIMARY=#e94949
```

### Installation
```bash
cd frontend
npm install
npm start
```

## CRM-Style Application Structure

### Professional Admin Portal Pages
1. **Login Portal** - Sleek admin authentication with modern form design
2. **Executive Dashboard** - CRM-style overview with KPI cards, charts, and real-time metrics
3. **Store Management** - Professional table/card view for Shopify store connections
4. **Vendor Hub** - Modern vendor management with status indicators and API health
5. **Sync Control Panel** - Real-time sync management with professional progress indicators
7. **System Settings** - Admin configuration panel with toggle switches and form controls

### Professional CRM Components

#### Modern Authentication Portal
- Minimalist black & white login interface
- Professional form design with subtle shadows
- Branded admin portal styling
- Secure session management with visual indicators

#### Executive Dashboard Cards
- KPI metric cards with icons and trend indicators
- Real-time sync status widgets
- Revenue impact tracking cards
- System health monitoring panels
- Interactive charts with black/white/gray color palette

#### Professional Data Tables
- **Store Management Table**: Sortable columns, status badges, action dropdowns
- **Vendor Hub Grid**: Card-based layout with connection status indicators
- **Product Mapping Table**: Advanced filtering, bulk selection, drag-and-drop rows
- **Sync History Table**: Expandable rows, export functionality, date range filters

#### Modern Card Layouts
- **Store Cards**: Clean white cards with black borders, status indicators
- **Vendor Cards**: Professional layout with API health badges
- **Product Cards**: Compact design with SKU matching indicators
- **Sync Job Cards**: Progress bars, status badges, action buttons

#### CRM-Style Interface Elements
- **Navigation**: Collapsible sidebar with icons and labels
- **Action Bars**: Top-aligned with search, filters, and bulk actions
- **Modal Dialogs**: Professional forms with validation states
- **Status Indicators**: Color-coded badges (success: black, error: red, warning: gray)
- **Progress Elements**: Modern progress bars and loading states

#### Professional Form Controls
- Clean input fields with floating labels
- Toggle switches for boolean settings
- Dropdown selectors with search functionality
- Multi-select components with tags
- Date/time pickers with modern styling

## Component Structure

### Layout Components
```
components/
├── layout/
│   ├── Header.jsx - Top navigation with logout
│   ├── Sidebar.jsx - Main navigation menu
│   └── Layout.jsx - Main layout wrapper
├── common/
│   ├── LoadingSpinner.jsx
│   ├── ErrorBoundary.jsx
│   ├── ConfirmDialog.jsx
│   └── DataTable.jsx
```

### Feature Components
```
components/
├── auth/
│   └── LoginForm.jsx
├── dashboard/
│   ├── StatsCards.jsx
│   ├── RecentSyncs.jsx
│   └── SyncStatusWidget.jsx
├── stores/
│   ├── StoreList.jsx
│   ├── AddStoreForm.jsx
│   └── StoreCard.jsx
├── vendors/
│   ├── VendorList.jsx
│   ├── AddVendorForm.jsx
│   └── VendorCard.jsx
├── products/
│   ├── ProductMappingTable.jsx
│   ├── SKUMatcher.jsx
│   ├── BulkMappingForm.jsx
│   └── MappingCard.jsx
├── sync/
│   ├── ManualSyncForm.jsx
│   ├── SyncProgress.jsx
│   ├── SyncHistory.jsx
│   └── ScheduleForm.jsx
```

## Key Features

### SKU Pattern Handling
- Automatic pattern recognition for SKUs like `noxa_E467W-White-2-CCSALE`
- Extract main product SKU (`E467W`)
- Parse color and size variations
- Smart matching suggestions

### Real-time Sync Tracking
- Live progress updates during sync operations
- Real-time inventory level displays
- Error notifications and retry options
- Success/failure statistics

### Bulk Operations
- Bulk product mapping
- Bulk sync operations
- Batch error handling
- Progress tracking for large operations

### User Experience
- Responsive design for desktop use
- Intuitive navigation
- Clear error messages
- Loading states and feedback
- Confirmation dialogs for destructive actions

## State Management

### Context Providers
```javascript
// AuthContext - User authentication state
// SyncContext - Real-time sync status
// NotificationContext - App-wide notifications
```

### Custom Hooks
```javascript
// useAuth - Authentication logic
// useSocket - Socket.io connection
// useApi - API calls with error handling
// useLocalStorage - Persistent local state
```

## API Integration

### Service Layer
```javascript
// api.service.js - Base API configuration
// auth.service.js - Authentication endpoints
// stores.service.js - Store management
// vendors.service.js - Vendor management
// products.service.js - Product mapping
// sync.service.js - Sync operations
```

### Error Handling
- Global error boundary
- API error interceptors
- User-friendly error messages
- Retry mechanisms

## Real-time Features

### Socket.io Integration
- Connect to backend socket server
- Listen for sync progress updates
- Real-time inventory changes
- Live error notifications

### Event Handling
```javascript
// Sync progress events
socket.on('sync:progress', handleSyncProgress);
socket.on('sync:complete', handleSyncComplete);
socket.on('sync:error', handleSyncError);

// Inventory update events
socket.on('inventory:updated', handleInventoryUpdate);
```

## Professional CRM Design System

### Design Principles
- **Monochromatic Elegance**: Black, white, and gray color palette for professional appearance
- **Modern Minimalism**: Clean lines, ample whitespace, subtle shadows
- **Data-Driven Interface**: Focus on clear data presentation and actionability
- **Responsive CRM Layout**: Desktop-first design optimized for admin workflows
- **Accessibility First**: WCAG 2.1 AA compliance with high contrast ratios
- **Brand Accent Discipline**: Use #e94949 sparingly for primary actions, highlights, and key brand elements against black/white base

### Color Palette
```css
/* Primary Colors */
--primary-black: #000000
--primary-white: #FFFFFF
--brand-primary: #e94949; /* Portal brand primary */
--neutral-50: #FAFAFA
--neutral-100: #F5F5F5
--neutral-200: #E5E5E5
--neutral-300: #D4D4D4
--neutral-400: #A3A3A3
--neutral-500: #737373
--neutral-600: #525252
--neutral-700: #404040
--neutral-800: #262626
--neutral-900: #171717

/* Accent Colors */
--success: #000000 (black for success states)
--error: #DC2626 (red for errors only)
--warning: #737373 (gray for warnings)
```

### Key Screen Designs

#### Executive Dashboard
- **Header**: Black navigation bar with white logo and admin profile
- **KPI Cards**: White cards with black borders, large numbers, trend icons
- **Charts Section**: Clean line charts and bar graphs in grayscale
- **Activity Feed**: Timeline-style layout with status indicators
- **Quick Actions**: Prominent black buttons for common tasks

#### Professional Data Tables
- **Table Header**: Black background with white text
- **Row Styling**: Alternating white/light gray rows with hover effects
- **Action Columns**: Icon buttons with tooltips
- **Pagination**: Modern pagination controls at bottom
- **Filters**: Collapsible filter panel with form controls

#### Store Management Interface
- **Card Grid**: 3-column responsive grid of store cards
- **Store Cards**: White background, black border, status badge in top-right
- **Connection Status**: Green dot for connected, red for disconnected, gray for pending
- **Action Menu**: Three-dot menu with edit/delete/test options

#### Product Mapping Center
- **Split Layout**: 50/50 vendor products (left) vs Shopify products (right)
- **Mapping Lines**: Visual connectors between mapped products
- **Search Bars**: Top-aligned search for both sides
- **Bulk Actions**: Checkbox selection with bulk mapping toolbar
- **SKU Matching**: Highlighted matching suggestions with confidence scores

#### Sync Control Panel
- **Control Header**: Black bar with sync status and controls
- **Progress Section**: Large progress bar with percentage and ETA
- **Job Queue**: Table showing queued, running, and completed jobs
- **Real-time Logs**: Scrollable log panel with timestamp and status
- **Manual Sync**: Modal dialog with product selection and options

### Component Library

#### Cards
```jsx
// Metric Card
<MetricCard 
  title="Total Products" 
  value="1,247" 
  trend="+12%" 
  icon={<PackageIcon />}
  className="bg-white border border-black"
/>

// Status Card
<StatusCard 
  title="Store Connection" 
  status="connected" 
  lastUpdate="2 minutes ago"
  actions={["Test", "Edit", "Remove"]}
/>
```

#### Tables
```jsx
// Professional Data Table
<DataTable 
  columns={columns}
  data={data}
  theme="professional" // Black header, alternating rows
  pagination={true}
  sorting={true}
  filtering={true}
  bulkActions={["Export", "Delete", "Archive"]}
/>
```

#### Forms
```jsx
// CRM-Style Form
<Form className="space-y-6">
  <FormField 
    label="Store Name" 
    type="text" 
    className="border-neutral-300 focus:border-black"
  />
  <ToggleSwitch 
    label="Enable Auto Sync" 
    className="accent-black"
  />
  <Button 
    variant="primary" 
    className="bg-[#e94949] text-white hover:bg-[#d13e3e]"
  >
    Save Changes
  </Button>
</Form>
```

## Frontend Milestones (aligned with backend)

### Phase 1: Foundation and Auth (Week 1)
- **Auth Portal**: `components/auth/LoginForm.jsx`, session handling with `AuthContext`
- **Layout Shell**: `components/layout/Header.jsx`, `Sidebar.jsx`, `Layout.jsx`
- **Theme Bootstrapping**: Tailwind config tokens for black/white base and brand `#e94949`

### Phase 2: Core Management UIs (Weeks 2-3)
- **Stores UI**: List/add/test stores using `GET/POST /stores`
- **Vendors UI**: Configure vendors and test API health using `GET/POST /vendors`
- **Service Layer**: `stores.service.js`, `vendors.service.js`, API error interceptors

### Phase 3: Product Mapping (Weeks 4-5)
- **Mapping Center**: Split-view vendor vs Shopify with advanced filters
- **SKU Tools**: `SKUMatcher.jsx` using backend SKU parsing patterns
- **Bulk Mapping**: `POST /mappings/bulk`, validation and conflict states

### Phase 4: Sync Control (Weeks 6-7)
- **Manual Sync**: Single/multi product selection `POST /sync/manual`
- **Queue & Status**: Real-time progress, history `GET /sync/status/:id`, `GET /sync/history`
- **Controls**: Pause/resume/cancel actions where supported

### Phase 5: Real-time + UX Polish (Weeks 8-9)
- **Socket.io Client**: Live sync progress and inventory updates
- **KPI Dashboard**: Executive metrics, charts, and activity feed
- **Accessibility & Performance**: Focus rings, keyboard flows, lazy load

### Phase 6: QA, Security, and Release (Weeks 10-11)
- **Testing**: Jest + React Testing Library, basic Cypress flows
- **Hardening**: Auth guard routes, API guards, error boundaries
- **Deployment**: Build, envs, reverse proxy, HTTPS

## Development

### Running in Development
```bash
npm start
```

### Building for Production
```bash
npm run build
```

### Testing
```bash
npm test
```

### Code Quality
- ESLint configuration
- Prettier formatting
- Component testing with Jest
- E2E testing with Cypress

## Deployment
- Build optimized production bundle
- Configure environment variables
- Set up CDN for static assets
- Configure reverse proxy
- Enable HTTPS
