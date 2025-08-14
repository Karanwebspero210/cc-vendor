import { lazy } from "react";

// Lazily load the components
const Dashboard = lazy(() => import("../pages/dashboard/Dashboard"));
const Settings = lazy(() => import("../pages/settings/Settings"));
const Products = lazy(() => import("../pages/products"));
const ProductDetails = lazy(() => import("../pages/products/ProductDetails"));
const Inventory = lazy(() => import("../pages/inventory"));

const privateRoutes = [
  {
    id: 0,
    title: "Dashboard",
    icon: null,
    path: "/dashboard",
    component: Dashboard,
  },
  {
    id: 1,
    title: "Products",
    icon: null,
    path: "/products",
    component: Products,
  },
  {
    id: 1.1,
    title: "Product Details",
    icon: null,
    path: "/products/details/:id",
    component: ProductDetails,
    hidden: true, // This route won't appear in the sidebar
  },
  {
    id: 2,
    title: "Inventory",
    icon: null,
    path: "/inventory",
    component: Inventory,
  },
  {
    id: 3,
    title: "Settings",
    icon: null,
    path: "/settings",
    component: Settings,
    hidden: true, // This route won't appear in the sidebar
  },
];

export default privateRoutes;
