// ...existing code...
import React, { useState, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Chip,
  TablePagination,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Button,
} from "@mui/material";
import Checkbox from "@mui/material/Checkbox";
import {
  Inventory as InventoryIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  Visibility as VisibilityIcon,
} from "@mui/icons-material";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import { inventoryApi } from "../../api/inventory";
import {
  shopifyApi,
  updateMismatchedInventory as updateMismatchedInventoryApi,
  updateSelectedInventory as updateSelectedInventoryApi,
} from "../../api/shopify";
import * as toastActions from "../../redux/toast/actions";
import SearchBar from "../../components/base/SearchBar";
import StockRangeFilter from "../../components/base/StockRangeFilter";
import ColumnVisibilityMenu from "../../components/base/ColumnVisibilityMenu";

const SyncInventory = () => {
  // console.log("Inventory component rendering");

  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [updatingMismatched, setUpdatingMismatched] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const initialCallMade = useRef(false);
  const [committedSearchTerm, setCommittedSearchTerm] = useState("");
  const searchTimeoutRef = useRef(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  // selection state
  const [selectedSkus, setSelectedSkus] = useState([]);
  const allSelected =
    inventory.length > 0 &&
    inventory.every((i) => selectedSkus.includes(i.variantSku));
  const someSelected =
    inventory.some((i) => selectedSkus.includes(i.variantSku)) && !allSelected;
  const isAnySelectedNotSynced = inventory.some(
    (i) => selectedSkus.includes(i.variantSku) && i.lastSyncStatus !== "success"
  );
  const isDisabledForSelection =
    selectedSkus.length > 0 && isAnySelectedNotSynced;

  // new states for stock filters
  const [stockQtyMin, setStockQtyMin] = useState("");
  const [stockQtyMax, setStockQtyMax] = useState("");
  const [debouncedStockQtyMin, setDebouncedStockQtyMin] = useState("");
  const [debouncedStockQtyMax, setDebouncedStockQtyMax] = useState("");
  const stockTimeoutRef = useRef(null);

  // new states for status filters (single-select)
  const [selectedStatus, setSelectedStatus] = useState(""); // 'Active' | 'Inactive' | ''
  const [selectedSyncStatus, setSelectedSyncStatus] = useState(""); // 'success' | 'failed' | ''

  // Column visibility setup
  const allColumns = [
    { id: "sku", label: "Sku" },
    { id: "product", label: "Product" },
    { id: "color", label: "Color" },
    { id: "size", label: "Size" },
    { id: "stock", label: "Nox Inventory" },
    { id: "shopifyStock", label: "Shopify Inventory" },
    { id: "status", label: "Status" },
    // { id: "syncStatus", label: "Sync Status" },
    { id: "lastSynced", label: "Last Synced" },
  ];
  const defaultInventoryColumnIds = allColumns.map((c) => c.id);
  const [visibleColumnIds, setVisibleColumnIds] = useState(() => {
    try {
      const raw = localStorage.getItem("inventory.visibleColumns");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) {}
    return defaultInventoryColumnIds;
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "inventory.visibleColumns",
        JSON.stringify(visibleColumnIds)
      );
    } catch (_) {}
  }, [visibleColumnIds]);
  const resetColumns = () => setVisibleColumnIds(defaultInventoryColumnIds);
  const isVisible = (id) => visibleColumnIds.includes(id);

  // Search is committed explicitly via button or Enter key

  // Debounce stock min/max together
  useEffect(() => {
    if (stockTimeoutRef.current) {
      clearTimeout(stockTimeoutRef.current);
    }
    stockTimeoutRef.current = setTimeout(() => {
      setDebouncedStockQtyMin(stockQtyMin === "" ? "" : Number(stockQtyMin));
      setDebouncedStockQtyMax(stockQtyMax === "" ? "" : Number(stockQtyMax));
    }, 500);

    return () => {
      if (stockTimeoutRef.current) {
        clearTimeout(stockTimeoutRef.current);
      }
    };
  }, [stockQtyMin, stockQtyMax]);

  // Debounce search input - auto search after 1 second of inactivity
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setCommittedSearchTerm(searchTerm.trim());
      setPage(0);
    }, 1000);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm]);

  // If navigated with initialSearch in state, prefill and trigger immediate search
  useEffect(() => {
    const initialSearch = location?.state?.initialSearch;
    if (initialSearch) {
      setSearchTerm(initialSearch);
      setCommittedSearchTerm(initialSearch);
      setPage(0);
      // replace history state to prevent re-trigger on back/forward
      navigate(".", { replace: true, state: {} });
    }
  }, [location?.state?.initialSearch]);

  // Fetch inventory function
  const fetchInventory = async (
    currentPage = page,
    currentRowsPerPage = rowsPerPage,
    search = committedSearchTerm,
    stockMin = debouncedStockQtyMin,
    stockMax = debouncedStockQtyMax
  ) => {
    // console.log("Fetching inventory:", {
    //   currentPage,
    //   currentRowsPerPage,
    //   search,
    //   stockMin,
    //   stockMax,
    // });
    try {
      setLoading(true);
      setError(null);

      // build params object; include only if provided
      const params = {};
      if (typeof stockMin === "number" && !Number.isNaN(stockMin)) {
        params.stockQtyMin = stockMin;
      }
      if (typeof stockMax === "number" && !Number.isNaN(stockMax)) {
        params.stockQtyMax = stockMax;
      }
      if (selectedStatus) {
        params.status = selectedStatus;
      }
      if (selectedSyncStatus) {
        params.syncStatus = selectedSyncStatus;
      }

      // pass params as a fourth argument (API should accept an options/params object)
      const response = await inventoryApi.getAllInventory(
        currentPage + 1,
        currentRowsPerPage,
        search,
        params
      );
      setInventory(response.data.items);
      setTotalItems(response.data.pagination.total);
    } catch (err) {
      setError(err.message || "Failed to fetch inventory");
    } finally {
      setLoading(false);
    }
  };

  // Single useEffect for initial load and pagination/search/filter changes
  useEffect(() => {
    // If navigated with an initial search term, skip this cycle
    // to avoid racing the initial full-data fetch vs filtered fetch
    if (location?.state?.initialSearch) {
      return;
    }
    // console.log("useEffect triggered:", {
    //   page,
    //   rowsPerPage,
    //   debouncedSearchTerm,
    //   debouncedStockQtyMin,
    //   debouncedStockQtyMax,
    //   initialCallMade: initialCallMade.current,
    // });

    // Always fetch mismatched inventory
    const params = {};
    if (
      typeof debouncedStockQtyMin === "number" &&
      !Number.isNaN(debouncedStockQtyMin)
    ) {
      params.stockQtyMin = debouncedStockQtyMin;
    }
    if (
      typeof debouncedStockQtyMax === "number" &&
      !Number.isNaN(debouncedStockQtyMax)
    ) {
      params.stockQtyMax = debouncedStockQtyMax;
    }
    if (selectedStatus) params.status = selectedStatus;
    if (selectedSyncStatus) params.syncStatus = selectedSyncStatus;

    if (!initialCallMade.current) {
      initialCallMade.current = true;
    }

    inventoryApi
      .getMismatchedInventory(
        page + 1,
        rowsPerPage,
        committedSearchTerm,
        params
      )
      .then((response) => {
        setInventory(response.data.items);
        setTotalItems(response.data.pagination.total);
      })
      .catch((err) => {
        setError(err.message || "Failed to fetch mismatched inventory");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [
    page,
    rowsPerPage,
    committedSearchTerm,
    debouncedStockQtyMin,
    debouncedStockQtyMax,
    selectedStatus,
    selectedSyncStatus,
    location?.state?.initialSearch,
  ]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRefresh = () => {
    fetchInventory(
      page,
      rowsPerPage,
      committedSearchTerm,
      debouncedStockQtyMin,
      debouncedStockQtyMax
    );
  };

  const handleUpdateAllInventory = async () => {
    try {
      setUpdatingMismatched(true);
      const resp = await updateMismatchedInventoryApi({
        // limit: 100,
        dryRun: false,
      });
      dispatch(
        toastActions.showToast({
          type: "success",
          msg:
            resp?.message ||
            `Updated ${
              resp?.data?.updated ?? resp?.updated ?? 0
            } mismatched item(s)`,
        })
      );
      // Refresh current view with mismatched inventory
      const params = {};
      if (
        typeof debouncedStockQtyMin === "number" &&
        !Number.isNaN(debouncedStockQtyMin)
      ) {
        params.stockQtyMin = debouncedStockQtyMin;
      }
      if (
        typeof debouncedStockQtyMax === "number" &&
        !Number.isNaN(debouncedStockQtyMax)
      ) {
        params.stockQtyMax = debouncedStockQtyMax;
      }
      if (selectedStatus) params.status = selectedStatus;
      if (selectedSyncStatus) params.syncStatus = selectedSyncStatus;
      const response = await inventoryApi.getMismatchedInventory(
        page + 1,
        rowsPerPage,
        committedSearchTerm,
        params
      );
      setInventory(response.data.items);
      setTotalItems(response.data.pagination.total);
    } catch (err) {
      dispatch(
        toastActions.showToast({
          type: "error",
          msg: err?.message || "Failed to update mismatched Shopify inventory",
        })
      );
    } finally {
      setUpdatingMismatched(false);
    }
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      setSelectedSkus(inventory.map((i) => i.variantSku));
    } else {
      setSelectedSkus([]);
    }
  };

  const toggleSelect = (sku, checked) => {
    setSelectedSkus((prev) => {
      const set = new Set(prev);
      if (checked) set.add(sku);
      else set.delete(sku);
      return Array.from(set);
    });
  };

  const handleUpdateSelected = async () => {
    if (!selectedSkus.length) return;
    try {
      setUpdatingMismatched(true);
      const resp = await updateSelectedInventoryApi({
        variantSkus: selectedSkus,
        dryRun: false,
      });
      dispatch(
        toastActions.showToast({
          type: "success",
          msg:
            resp?.message ||
            `Updated ${
              resp?.data?.updated ?? resp?.updated ?? 0
            } selected item(s)`,
        })
      );
      setSelectedSkus([]);
      // Refresh current view with mismatched inventory
      const params = {};
      if (
        typeof debouncedStockQtyMin === "number" &&
        !Number.isNaN(debouncedStockQtyMin)
      ) {
        params.stockQtyMin = debouncedStockQtyMin;
      }
      if (
        typeof debouncedStockQtyMax === "number" &&
        !Number.isNaN(debouncedStockQtyMax)
      ) {
        params.stockQtyMax = debouncedStockQtyMax;
      }
      if (selectedStatus) params.status = selectedStatus;
      if (selectedSyncStatus) params.syncStatus = selectedSyncStatus;
      const response = await inventoryApi.getMismatchedInventory(
        page + 1,
        rowsPerPage,
        committedSearchTerm,
        params
      );
      setInventory(response.data.items);
      setTotalItems(response.data.pagination.total);
    } catch (err) {
      dispatch(
        toastActions.showToast({
          type: "error",
          msg: err?.message || "Failed to update selected Shopify inventory",
        })
      );
    } finally {
      setUpdatingMismatched(false);
    }
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setSelectedSkus([]);
    setPage(0); // Reset to first page when searching
  };

  const clearSearch = () => {
    setSearchTerm("");
    setCommittedSearchTerm("");
    setSelectedSkus([]);
    setPage(0);
  };

  const handleSearchSubmit = () => {
    setCommittedSearchTerm(searchTerm.trim());
    setSelectedSkus([]);
    setPage(0);
  };

  const extractProductId = (input) => {
    const match = input.match(/\d+/); // Regular expression to find numbers
    return match ? match[0] : null; // Returns the first match or null if no match
  };

  const handleViewProduct = (item) => {
    // Extract the product and variant IDs using your existing function
    const productId = extractProductId(item.shopifyProductId);
    const variantId = extractProductId(item.shopifyVariantId);

    console.log(productId, "item.shopifyProductId in handleViewProduct");
    console.log(variantId, "item.shopifyVariantId in handleViewProduct");

    // Construct the Shopify admin URL
    const url = `https://admin.shopify.com/store/devwebsperotest2/products/${productId}/variants/${variantId}`;

    // Navigate to the external URL
    window.open(url, "_blank"); // This will navigate to the external link
  };

  // // handlers for stock filters
  // const handleMinChange = (e) => {
  //   const v = e.target.value;
  //   // allow empty string to clear
  //   setStockQtyMin(v === "" ? "" : v);
  //   setPage(0);
  // };
  // const handleMaxChange = (e) => {
  //   const v = e.target.value;
  //   setStockQtyMax(v === "" ? "" : v);
  //   setPage(0);
  // };
  // const clearMin = () => {
  //   setStockQtyMin("");
  //   setPage(0);
  // };
  // const clearMax = () => {
  //   setStockQtyMax("");
  //   setPage(0);
  // };

  // handlers for status filters (single-select)
  const toggleStatusFilter = (value) => {
    setSelectedStatus((prev) => (prev === value ? "" : value));
    setSelectedSkus([]);
    setPage(0);
  };
  const clearStatusFilters = () => {
    setSelectedStatus("");
    setSelectedSkus([]);
    setPage(0);
  };

  // handlers for sync status filters (single-select)
  const toggleSyncStatusFilter = (value) => {
    setSelectedSyncStatus((prev) => (prev === value ? "" : value));
    setSelectedSkus([]);
    setPage(0);
  };
  const clearSyncStatusFilters = () => {
    setSelectedSyncStatus("");
    setSelectedSkus([]);
    setPage(0);
  };

  const getStatusChip = (status) => {
    if (status === "Active") {
      return <Chip label="Active" color="info" size="small" variant="filled" />;
    } else {
      return (
        <Chip
          label="Inactive"
          style={{ color: "black" }}
          size="small"
          variant="filled"
        />
      );
    }
  };

  const getSyncStatusChip = (syncStatus) => {
    if (syncStatus === "success") {
      return (
        <Chip
          size="small"
          color="success"
          icon={<CheckCircleIcon />}
          label="Synced"
        />
      );
    } else {
      return (
        <Chip
          size="small"
          color="default"
          icon={<ErrorIcon />}
          label="Not Synced"
        />
      );
    }
  };

  const getStockChip = (stockQty) => {
    if (stockQty > 0) {
      return (
        <Chip
          label={`${stockQty} in stock`}
          color="success"
          icon={<InventoryIcon style={{ fontSize: "14px" }} />}
          size="small"
          variant="outlined"
          style={{
            padding: "0 4px",
          }}
        />
      );
    }
    return (
      <Chip
        label="Out of stock"
        // style={{ color: "#e94949"  , borderColor: "#e94949"}}
        color="error"
        size="small"
        variant="outlined"
      />
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  if (loading && inventory.length === 0) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="400px"
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <div className="flex flex-col p-6 ">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Updated Inventory</h1>
          <p className="text-sm text-neutral-600">
            Update the latest nox inventory to the Shopify inventory
          </p>
        </div>
        <div className="flex gap-2 items-end">
          <Tooltip title="Update all Shopify inventory with the latest nox inventory">
            <span>
              <Button
                sx={{
                  backgroundColor: "#e94949",
                  color: "white",
                  textTransform: "none",
                  borderRadius: "8px",
                  fontSize: "12px",
                  height: "auto",
                  "&:hover": {
                    backgroundColor: "black",
                    color: "white",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                  },
                }}
                startIcon={<InventoryIcon />}
                size="medium"
                onClick={handleUpdateAllInventory}
                disabled={loading || updatingMismatched}
                type="button"
              >
                {updatingMismatched ? "Updating..." : "Update All"}
              </Button>
            </span>
          </Tooltip>
          {selectedSkus.length > 0 && (
            <Tooltip
              title={
                isDisabledForSelection
                  ? "Cannot update: selected variants is not synced"
                  : "Update Shopify Inventory for selected synced variants"
              }
            >
              <span>
                <Button
                  sx={{
                    backgroundColor: isDisabledForSelection
                      ? "#9e9e9e"
                      : "#e94949",
                    color: "white",
                    textTransform: "none",
                    borderRadius: "8px",
                    fontSize: "12px",
                    height: "auto",
                    width: selectedSkus.length > 0 ? "auto" : "auto",
                    "&:hover": {
                      backgroundColor: "black",
                      color: "white",
                      boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                    },
                  }}
                  startIcon={<InventoryIcon />}
                  size="medium"
                  onClick={handleUpdateSelected}
                  disabled={
                    loading ||
                    updatingMismatched ||
                    (selectedSkus.length > 0 && isAnySelectedNotSynced)
                  }
                  type="button"
                >
                  {updatingMismatched
                    ? "Updating Selected..."
                    : `Update Selected (${selectedSkus.length})`}
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <Card className="mt-4 border border-black" sx={{ borderRadius: "20px" }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
              gap: 2,
            }}
          >
            <Box className="flex gap-6">
              {/* <StockRangeFilter
                minValue={stockQtyMin}
                maxValue={stockQtyMax}
                onMinChange={handleMinChange}
                onMaxChange={handleMaxChange}
                onClearMin={clearMin}
                onClearMax={clearMax}
                disabled={loading}
                loading={loading}
                size="small"
              /> */}

              {/* Status filter chips */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Status:
                </Typography>
                <Chip
                  label="Active"
                  style={{
                    backgroundColor:
                      selectedStatus === "Active" ? "#e94949" : "transparent",
                    color: selectedStatus === "Active" ? "white" : "black",
                  }}
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleStatusFilter("Active");
                  }}
                  variant={selectedStatus === "Active" ? "filled" : "outlined"}
                />
                <Chip
                  label="Inactive"
                  style={{
                    backgroundColor:
                      selectedStatus === "Inactive" ? "#e94949" : "transparent",
                    color: selectedStatus === "Inactive" ? "white" : "black",
                  }}
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleStatusFilter("Inactive");
                  }}
                  variant={
                    selectedStatus === "Inactive" ? "filled" : "outlined"
                  }
                />
                {selectedStatus && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearStatusFilters();
                    }}
                    disabled={loading}
                    type="button"
                  >
                    <ClearIcon fontSize="small" style={{ color: "black" }} />
                  </IconButton>
                )}
              </Box>

              {/* Sync status filter chips */}
              {/* <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Sync:
                </Typography>
                <Chip
                  label="Synced"
                  style={{
                    backgroundColor:
                      selectedSyncStatus === "success"
                        ? "#e94949"
                        : "transparent",
                    color: selectedSyncStatus === "success" ? "white" : "black",
                  }}
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSyncStatusFilter("success");
                  }}
                  variant={
                    selectedSyncStatus === "success" ? "filled" : "outlined"
                  }
                />
                <Chip
                  label="Not Synced"
                  style={{
                    backgroundColor:
                      selectedSyncStatus === "failed"
                        ? "#e94949"
                        : "transparent",
                    color: selectedSyncStatus === "failed" ? "white" : "black",
                  }}
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSyncStatusFilter("failed");
                  }}
                  variant={
                    selectedSyncStatus === "failed" ? "filled" : "outlined"
                  }
                />
                {selectedSyncStatus && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      clearSyncStatusFilters();
                    }}
                    disabled={loading}
                    type="button"
                  >
                    <ClearIcon fontSize="small" style={{ color: "black" }} />
                  </IconButton>
                )}
              </Box> */}
            </Box>

            <Box>
              <Box className="flex items-center gap-1 ">
                <SearchBar
                  value={searchTerm}
                  onChange={handleSearchChange}
                  onSubmit={handleSearchSubmit}
                  onClear={clearSearch}
                  placeholder="Search by SKU, color, size..."
                  disabled={loading}
                  loading={loading}
                  size="small"
                  sx={{ minWidth: 300, width: 360, maxWidth: "100%" }}
                />
                <ColumnVisibilityMenu
                  allColumns={allColumns}
                  visibleColumnIds={visibleColumnIds}
                  onChange={setVisibleColumnIds}
                  onReset={resetColumns}
                  disabled={loading}
                  buttonLabel="Columns"
                  variant="icon"
                />
              </Box>
            </Box>
          </Box>

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              maxHeight: 620,
              overflow: "auto",
              "& .MuiTable-root": {
                minWidth: 1200,
              },
            }}
          >
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell
                    padding="checkbox"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      icon={
                        <CheckCircleOutlineOutlinedIcon
                          sx={{ color: "black" }}
                        />
                      }
                      checkedIcon={<CheckCircleOutlinedIcon />}
                      indeterminate={someSelected}
                      checked={allSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                      inputProps={{ "aria-label": "select all variants" }}
                    />
                  </TableCell>
                  {allColumns
                    .filter((c) => isVisible(c.id))
                    .map((c) => (
                      <TableCell key={c.id}>{c.label}</TableCell>
                    ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {inventory.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={visibleColumnIds.length + 1}
                      align="center"
                    >
                      <Box py={3}>
                        <Typography variant="body1" color="text.secondary">
                          {committedSearchTerm ||
                          stockQtyMin !== "" ||
                          stockQtyMax !== ""
                            ? `No inventory items found for the current filters`
                            : "No inventory items found"}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  inventory.map((item) => (
                    <TableRow
                      key={item._id}
                      hover
                      onClick={() => handleViewProduct(item)}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell
                        padding="checkbox"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          icon={
                            <CheckCircleOutlineOutlinedIcon
                              sx={{ color: "black" }}
                            />
                          }
                          checkedIcon={<CheckCircleOutlinedIcon />}
                          checked={selectedSkus.includes(item.variantSku)}
                          onChange={(e) =>
                            toggleSelect(item.variantSku, e.target.checked)
                          }
                          inputProps={{
                            "aria-label": `select variant ${item.variantSku}`,
                          }}
                        />
                      </TableCell>
                      {allColumns
                        .filter((c) => isVisible(c.id))
                        .map((c) => {
                          switch (c.id) {
                            case "sku":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    fontWeight="medium"
                                  >
                                    {item.variantSku}
                                  </Typography>
                                </TableCell>
                              );
                            case "product":
                              return (
                                <TableCell key={c.id}>
                                  <Typography variant="body2">
                                    {item.mainSku}
                                  </Typography>
                                </TableCell>
                              );
                            case "color":
                              return (
                                <TableCell key={c.id}>
                                  <Chip
                                    label={item.color}
                                    size="small"
                                    variant="outlined"
                                    style={{
                                      backgroundColor: "lightgrey",
                                      color: "black",
                                      borderRadius: "10px",
                                    }}
                                  />
                                </TableCell>
                              );
                            case "size":
                              return (
                                <TableCell key={c.id}>
                                  <Typography variant="body2">
                                    {item.size}
                                  </Typography>
                                </TableCell>
                              );
                            case "stock":
                              return (
                                <TableCell key={c.id}>
                                  {getStockChip(item.stockQty)}
                                </TableCell>
                              );
                            case "shopifyStock":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
                                    {getStockChip(item.lastKnownShopifyQty)}
                                  </Typography>
                                </TableCell>
                              );
                            case "status":
                              return (
                                <TableCell key={c.id}>
                                  {getStatusChip(item.status)}
                                </TableCell>
                              );
                            case "syncStatus":
                              return (
                                <TableCell key={c.id}>
                                  {getSyncStatusChip(item.lastSyncStatus)}
                                </TableCell>
                              );
                            case "lastSynced":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
                                    {formatDate(item.lastSynced)}
                                  </Typography>
                                </TableCell>
                              );
                            default:
                              return null;
                          }
                        })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={totalItems}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100, 200]}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default SyncInventory;
