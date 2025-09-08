import { lazy } from "react";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SyncIcon from "@mui/icons-material/Sync";
import HistoryToggleOffOutlinedIcon from "@mui/icons-material/HistoryToggleOffOutlined";
import SettingsBackupRestoreOutlinedIcon from "@mui/icons-material/SettingsBackupRestoreOutlined";

// Lazily load the components
const Dashboard = lazy(() => import("../pages/dashboard/Dashboard"));
const Settings = lazy(() => import("../pages/settings/Settings"));
const Inventory = lazy(() => import("../pages/noxInventory"));
const InventoryDetails = lazy(() =>
  import("../pages/noxInventory/InventoryDetails")
);
const SyncInventory = lazy(() => import("../pages/syncInventory"));
const Jobs = lazy(() => import("../pages/jobs"));
const JobDetails = lazy(() => import("../pages/jobs/JobDetails"));
const MapInventory = lazy(() => import("../pages/mapInventory"));


const privateRoutes = [
  {
    id: 0,
    title: "Dashboard",
    subtitle: "Overview & KPIs",
    icon: DashboardOutlinedIcon,
    path: "/dashboard",
    component: Dashboard,
  },
  {
    id: 1,
    title: "Nox Inventory",
    subtitle: "View the Products & Variants",
    icon: Inventory2OutlinedIcon,
    path: "/nox-inventory",
    component: Inventory,
  },
  {
    id: 1.1,
    title: "Inventory Details",
    icon: null,
    path: "/nox-inventory/details/:id",
    component: InventoryDetails,
    hidden: true,
  },
  {
    id: 2,
    title: "Linked Inventory",
    subtitle: "Link inventory with Shopify",
    icon: SettingsBackupRestoreOutlinedIcon,
    path: "/linked-inventory",
    component: MapInventory, 
  },
  {
    id: 3,
    title: "Updated Inventory",
    subtitle: "Update Shopify Inventory",
    icon: SyncIcon,
    path: "/sync-inventory",
    component: SyncInventory, 
  },

  {
    id: 4,
    title: "Job History",
    subtitle: "Previous Operations",
    icon: HistoryToggleOffOutlinedIcon,
    path: "/jobs",
    component: Jobs,
  },
  {
    id: 4.1,
    title: "Job Details",
    icon: null,
    path: "/jobs/:id",
    component: JobDetails,
    hidden: true,
  },
  {
    id: 5,
    title: "Settings",
    icon: null,
    path: "/settings",
    component: Settings,
    hidden: true,
  },
];

export default privateRoutes;
