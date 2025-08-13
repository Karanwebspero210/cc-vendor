# 🎨 Professional CRM Design System - Couture Candy Admin Portal

## 🎯 Design Philosophy

The Couture Candy Admin Portal follows a **Professional CRM Design System** with a monochromatic black and white color scheme, emphasizing clarity, efficiency, and modern aesthetics suitable for business operations.

## 🎨 Visual Identity

### Color Palette
```css
:root {
  /* Primary Colors */
  --primary-black: #000000;
  --primary-white: #FFFFFF;
  
  /* Neutral Scale */
  --neutral-50: #FAFAFA;   /* Lightest background */
  --neutral-100: #F5F5F5;  /* Card backgrounds */
  --neutral-200: #E5E5E5;  /* Borders, dividers */
  --neutral-300: #D4D4D4;  /* Input borders */
  --neutral-400: #A3A3A3;  /* Placeholder text */
  --neutral-500: #737373;  /* Secondary text */
  --neutral-600: #525252;  /* Primary text */
  --neutral-700: #404040;  /* Headings */
  --neutral-800: #262626;  /* Dark elements */
  --neutral-900: #171717;  /* Darkest elements */
  
  /* Semantic Colors */
  --success: #000000;      /* Black for success states */
  --error: #DC2626;        /* Red for errors only */
  --warning: #737373;      /* Gray for warnings */
  --info: #525252;         /* Dark gray for info */
  
  /* Interactive States */
  --hover-bg: #F5F5F5;
  --active-bg: #E5E5E5;
  --focus-ring: #000000;
}
```

### Typography Scale
```css
/* Font Family */
--font-primary: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* Font Sizes */
--text-xs: 0.75rem;      /* 12px - Captions, labels */
--text-sm: 0.875rem;     /* 14px - Body text, forms */
--text-base: 1rem;       /* 16px - Default body */
--text-lg: 1.125rem;     /* 18px - Subheadings */
--text-xl: 1.25rem;      /* 20px - Card titles */
--text-2xl: 1.5rem;      /* 24px - Page titles */
--text-3xl: 1.875rem;    /* 30px - Dashboard metrics */
--text-4xl: 2.25rem;     /* 36px - Large numbers */

/* Font Weights */
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

### Spacing System
```css
/* Spacing Scale */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
--space-20: 5rem;     /* 80px */
```

## 🏗️ Layout Architecture

### Grid System
```css
/* Container Widths */
--container-sm: 640px;
--container-md: 768px;
--container-lg: 1024px;
--container-xl: 1280px;
--container-2xl: 1536px;

/* Grid Columns */
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.grid-cols-12 { grid-template-columns: repeat(12, minmax(0, 1fr)); }
```

### Page Layout Structure
```jsx
// Main Layout Template
<div className="min-h-screen bg-neutral-50">
  {/* Top Navigation */}
  <header className="bg-black text-white border-b border-neutral-200">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center h-16">
        <div className="flex items-center">
          <Logo className="h-8 w-auto" />
          <h1 className="ml-4 text-lg font-semibold">Couture Candy Admin</h1>
        </div>
        <AdminProfile />
      </div>
    </div>
  </header>

  <div className="flex">
    {/* Sidebar Navigation */}
    <aside className="w-64 bg-white border-r border-neutral-200 min-h-screen">
      <Navigation />
    </aside>

    {/* Main Content */}
    <main className="flex-1 p-8">
      <div className="max-w-7xl mx-auto">
        {children}
      </div>
    </main>
  </div>
</div>
```

## 📊 Component Library

### 1. Cards

#### Metric Card
```jsx
const MetricCard = ({ title, value, trend, icon, className = "" }) => (
  <div className={`bg-white border border-neutral-200 rounded-lg p-6 ${className}`}>
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-neutral-600">{title}</p>
        <p className="text-3xl font-bold text-neutral-900 mt-2">{value}</p>
        {trend && (
          <p className="text-sm text-neutral-500 mt-1">
            <span className="font-medium">{trend}</span> from last month
          </p>
        )}
      </div>
      <div className="p-3 bg-neutral-100 rounded-lg">
        {icon}
      </div>
    </div>
  </div>
);
```

#### Status Card
```jsx
const StatusCard = ({ title, status, lastUpdate, actions = [] }) => (
  <div className="bg-white border border-neutral-200 rounded-lg p-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
      <StatusBadge status={status} />
    </div>
    <p className="text-sm text-neutral-500 mb-4">Last updated: {lastUpdate}</p>
    <div className="flex space-x-2">
      {actions.map((action, index) => (
        <Button key={index} variant="outline" size="sm">
          {action}
        </Button>
      ))}
    </div>
  </div>
);
```

### 2. Data Tables

#### Professional Data Table
```jsx
const DataTable = ({ 
  columns, 
  data, 
  pagination = true, 
  sorting = true, 
  filtering = true,
  bulkActions = []
}) => (
  <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
    {/* Table Header with Actions */}
    <div className="px-6 py-4 border-b border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {bulkActions.length > 0 && (
            <BulkActionDropdown actions={bulkActions} />
          )}
          {filtering && <SearchInput placeholder="Search..." />}
        </div>
        <div className="flex items-center space-x-2">
          <FilterButton />
          <ExportButton />
        </div>
      </div>
    </div>

    {/* Table */}
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-neutral-200">
        <thead className="bg-black">
          <tr>
            <th className="px-6 py-3 text-left">
              <input type="checkbox" className="rounded border-neutral-300" />
            </th>
            {columns.map((column) => (
              <th key={column.key} className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                <div className="flex items-center space-x-1">
                  <span>{column.title}</span>
                  {sorting && <SortIcon />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-neutral-200">
          {data.map((row, index) => (
            <tr key={index} className="hover:bg-neutral-50">
              <td className="px-6 py-4">
                <input type="checkbox" className="rounded border-neutral-300" />
              </td>
              {columns.map((column) => (
                <td key={column.key} className="px-6 py-4 whitespace-nowrap text-sm text-neutral-900">
                  {renderCell(row[column.key], column.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Pagination */}
    {pagination && (
      <div className="px-6 py-4 border-t border-neutral-200 bg-neutral-50">
        <Pagination />
      </div>
    )}
  </div>
);
```

### 3. Forms

#### Professional Form Components
```jsx
// Form Field
const FormField = ({ label, error, children, required = false }) => (
  <div className="space-y-2">
    <label className="block text-sm font-medium text-neutral-700">
      {label}
      {required && <span className="text-error ml-1">*</span>}
    </label>
    {children}
    {error && <p className="text-sm text-error">{error}</p>}
  </div>
);

// Input Field
const Input = ({ className = "", ...props }) => (
  <input
    className={`
      block w-full px-3 py-2 border border-neutral-300 rounded-md
      focus:outline-none focus:ring-2 focus:ring-black focus:border-black
      placeholder-neutral-400 text-neutral-900
      ${className}
    `}
    {...props}
  />
);

// Toggle Switch
const ToggleSwitch = ({ label, checked, onChange }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-neutral-700">{label}</span>
    <button
      type="button"
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${checked ? 'bg-black' : 'bg-neutral-200'}
      `}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${checked ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  </div>
);
```

### 4. Buttons

#### Button Variants
```jsx
const Button = ({ 
  variant = 'primary', 
  size = 'md', 
  children, 
  className = "", 
  ...props 
}) => {
  const baseClasses = "inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  
  const variants = {
    primary: "bg-black text-white hover:bg-neutral-800 focus:ring-black",
    secondary: "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50 focus:ring-black",
    outline: "bg-transparent text-neutral-700 border border-neutral-300 hover:bg-neutral-50 focus:ring-black",
    ghost: "bg-transparent text-neutral-700 hover:bg-neutral-100 focus:ring-black",
    danger: "bg-error text-white hover:bg-red-700 focus:ring-error"
  };
  
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
    xl: "px-8 py-4 text-lg"
  };
  
  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
```

### 5. Status Indicators

#### Status Badge
```jsx
const StatusBadge = ({ status, size = 'md' }) => {
  const statusConfig = {
    connected: { color: 'bg-black text-white', label: 'Connected' },
    disconnected: { color: 'bg-error text-white', label: 'Disconnected' },
    pending: { color: 'bg-neutral-400 text-white', label: 'Pending' },
    syncing: { color: 'bg-neutral-600 text-white', label: 'Syncing' },
    error: { color: 'bg-error text-white', label: 'Error' }
  };
  
  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base'
  };
  
  const config = statusConfig[status] || statusConfig.pending;
  
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${config.color} ${sizes[size]}`}>
      <div className="w-2 h-2 bg-current rounded-full mr-2"></div>
      {config.label}
    </span>
  );
};
```

## 📱 Screen-Specific Designs

### Executive Dashboard
```jsx
const ExecutiveDashboard = () => (
  <div className="space-y-8">
    {/* Page Header */}
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Dashboard</h1>
        <p className="text-neutral-600">Welcome back, Admin</p>
      </div>
      <div className="flex space-x-3">
        <Button variant="outline">Export Report</Button>
        <Button>Sync Now</Button>
      </div>
    </div>

    {/* KPI Cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <MetricCard 
        title="Total Products" 
        value="1,247" 
        trend="+12%" 
        icon={<PackageIcon />} 
      />
      <MetricCard 
        title="Active Stores" 
        value="3" 
        trend="+1" 
        icon={<StoreIcon />} 
      />
      <MetricCard 
        title="Sync Success Rate" 
        value="98.5%" 
        trend="+2.1%" 
        icon={<CheckIcon />} 
      />
      <MetricCard 
        title="Last Sync" 
        value="2 min ago" 
        trend="On schedule" 
        icon={<ClockIcon />} 
      />
    </div>

    {/* Charts Section */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-neutral-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-neutral-900 mb-4">Sync Activity</h3>
        <SyncActivityChart />
      </div>
      <div className="bg-white border border-neutral-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-neutral-900 mb-4">Inventory Levels</h3>
        <InventoryChart />
      </div>
    </div>

    {/* Recent Activity */}
    <div className="bg-white border border-neutral-200 rounded-lg">
      <div className="px-6 py-4 border-b border-neutral-200">
        <h3 className="text-lg font-semibold text-neutral-900">Recent Activity</h3>
      </div>
      <ActivityFeed />
    </div>
  </div>
);
```

### Store Management Interface
```jsx
const StoreManagement = () => (
  <div className="space-y-6">
    {/* Page Header */}
    <div className="flex items-center justify-between">
      <h1 className="text-2xl font-bold text-neutral-900">Store Management</h1>
      <Button>Add New Store</Button>
    </div>

    {/* Store Cards Grid */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {stores.map((store) => (
        <div key={store.id} className="bg-white border border-neutral-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-neutral-900">{store.name}</h3>
            <StatusBadge status={store.status} />
          </div>
          <div className="space-y-2 text-sm text-neutral-600">
            <p>Domain: {store.domain}</p>
            <p>Products: {store.productCount}</p>
            <p>Last Sync: {store.lastSync}</p>
          </div>
          <div className="flex space-x-2 mt-4">
            <Button variant="outline" size="sm">Test Connection</Button>
            <Button variant="outline" size="sm">Edit</Button>
            <Button variant="outline" size="sm">Remove</Button>
          </div>
        </div>
      ))}
    </div>
  </div>
);
```

## 🎭 Interactive States

### Hover Effects
```css
/* Card Hover */
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease-in-out;
}

/* Button Hover */
.btn-hover:hover {
  transform: translateY(-1px);
  transition: transform 0.1s ease-in-out;
}

/* Table Row Hover */
.table-row:hover {
  background-color: var(--neutral-50);
}
```

### Loading States
```jsx
const LoadingSpinner = ({ size = 'md' }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };
  
  return (
    <div className={`animate-spin rounded-full border-2 border-neutral-300 border-t-black ${sizes[size]}`} />
  );
};

const LoadingSkeleton = ({ className = "" }) => (
  <div className={`animate-pulse bg-neutral-200 rounded ${className}`} />
);
```

## 📐 Responsive Design

### Breakpoints
```css
/* Mobile First Approach */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
@media (min-width: 1536px) { /* 2xl */ }
```

### Mobile Adaptations
- Collapsible sidebar navigation
- Stack cards vertically on mobile
- Simplified table views with expandable rows
- Touch-friendly button sizes (minimum 44px)
- Optimized form layouts for mobile input

This design system ensures a consistent, professional, and modern CRM experience that emphasizes functionality while maintaining visual elegance through the monochromatic color scheme.
