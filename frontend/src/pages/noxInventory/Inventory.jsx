import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  Button,
  Grid,
} from "@mui/material";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
// import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import {
  Inventory as InventoryIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import { productsApi } from "../../api/products";
import { inventoryApi } from "../../api/inventory";
import SearchBar from "../../components/base/SearchBar";
import ColumnVisibilityMenu from "../../components/base/ColumnVisibilityMenu";
import { useDispatch } from "react-redux";
import { SHOW_TOAST } from "../../redux/constants";
import * as toastMessages from "../../redux/toast/messages";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import CtaCard from "../../components/action/CtaCard";

const Inventory = () => {
  // console.log("Products component rendering");
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalVariants, setTotalVariants] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const initialCallMade = useRef(false);
  const [committedSearchTerm, setCommittedSearchTerm] = useState("");
  // Persist selections across pages: map productId -> sku
  const [selectedById, setSelectedById] = useState({});
  const [syncStarting, setSyncStarting] = useState(false);
  const dispatch = useDispatch();

  const cards = [
    {
      title: "Total Products",
      description: "Total number of products by Vendor",
      value: `${totalProducts}`,
      valueColor: "black",
      icon: <Inventory2OutlinedIcon sx={{ fontSize: 28, color: "gray" }} />,
    },
    {
      title: "Total Variants",
      description: "Total number of products synced successfully",
      value: `${totalVariants}`,
      valueColor: "#e94949",
      icon: <SyncOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />,
    },
  ];

  // Column visibility setup
  const allColumns = [
    { id: "select", label: "Select" },
    { id: "product", label: "Product" },
    { id: "status", label: "Status" },
    { id: "syncStatus", label: "Sync Status" },
    { id: "source", label: "Source" },
    { id: "lastSynced", label: "Last Synced" },
    { id: "created", label: "Created" },
  ];
  const defaultProductColumnIds = allColumns.map((c) => c.id);
  const [visibleColumnIds, setVisibleColumnIds] = useState(() => {
    try {
      const raw = localStorage.getItem("products.visibleColumns");
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) {}
    return defaultProductColumnIds;
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "products.visibleColumns",
        JSON.stringify(visibleColumnIds)
      );
    } catch (_) {}
  }, [visibleColumnIds]);

  const resetColumns = () => setVisibleColumnIds(defaultProductColumnIds);
  const isVisible = (id) => visibleColumnIds.includes(id);

  // Search is committed explicitly by button or Enter key

  // Fetch products function
  const fetchProducts = async (
    currentPage = page,
    currentRowsPerPage = rowsPerPage,
    search = committedSearchTerm
  ) => {
    // console.log("Fetching products:", {
    //   currentPage,
    //   currentRowsPerPage,
    //   search,
    // });
    try {
      setLoading(true);
      setError(null);
      const response = await productsApi.getProducts(
        currentPage + 1,
        currentRowsPerPage,
        search
      );
      setProducts(response.data.products);
      setTotalProducts(response.data.productInfo.totalProducts);
      setTotalVariants(response.data.productInfo.totalVariants);
    } catch (err) {
      setError(err.message || "Failed to fetch products");
    } finally {
      setLoading(false);
    }
  };

  // Single useEffect for initial load and pagination/search changes
  useEffect(() => {
    // console.log("useEffect triggered:", {
    //   page,
    //   rowsPerPage,
    //   debouncedSearchTerm,
    //   initialCallMade: initialCallMade.current,
    // });

    // Only fetch if we have initialized or if it's a pagination/search change
    if (
      initialCallMade.current ||
      page > 0 ||
      rowsPerPage !== 20 ||
      committedSearchTerm !== ""
    ) {
      fetchProducts(page, rowsPerPage, committedSearchTerm);
    } else {
      // Initial load
      initialCallMade.current = true;
      fetchProducts(page, rowsPerPage, committedSearchTerm);
    }
  }, [page, rowsPerPage, committedSearchTerm]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleProductClick = (productId) => {
    navigate(`/nox-inventory/details/${productId}`);
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setPage(0); // Reset to first page when searching
  };

  // Debounce search: automatically commit search after 5 seconds of inactivity
  useEffect(() => {
    // If the term already matches committed value, do nothing
    if (searchTerm === committedSearchTerm) return;

    const timeoutId = setTimeout(() => {
      setCommittedSearchTerm(searchTerm.trim());
      setPage(0);
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const clearSearch = () => {
    setSearchTerm("");
    setCommittedSearchTerm("");
    setPage(0);
  };

  const handleSearchSubmit = () => {
    setCommittedSearchTerm(searchTerm.trim());
    setPage(0);
  };

  // export handlers
  const handleExportProducts = async () => {
    try {
      await productsApi.downloadProductsCsv({ search: committedSearchTerm });
    } catch (err) {
      const error = toastMessages.getMessage({
        status: "error",
        message: err.message,
      });
      dispatch({ type: SHOW_TOAST, payload: error });
    }
  };

  const handleExportInventory = async () => {
    try {
      await inventoryApi.downloadInventoryCsv({ search: committedSearchTerm });
    } catch (err) {
      const error = toastMessages.getMessage({
        status: "error",
        message: err.message,
      });
      dispatch({ type: SHOW_TOAST, payload: error });
    }
  };

  // FIXED selection handlers
  const toggleSelectAll = (event) => {
    event.stopPropagation(); // Prevent any unwanted propagation

    const isAllSelected =
      products.length > 0 && products.every((p) => !!selectedById[p._id]);

    if (isAllSelected) {
      // Deselect all current page items
      setSelectedById((prev) => {
        const next = { ...prev };
        for (const p of products) {
          delete next[p._id];
        }
        return next;
      });
    } else {
      // Select all current page items
      setSelectedById((prev) => {
        const next = { ...prev };
        for (const p of products) {
          next[p._id] = p.mainSku;
        }
        return next;
      });
    }
  };

  const toggleSelectOne = (event, product) => {
    event.stopPropagation();
    setSelectedById((prev) => {
      const next = { ...prev };
      if (next[product._id]) {
        delete next[product._id];
      } else {
        next[product._id] = product.mainSku;
      }
      return next;
    });
  };

  // start sync / update inventory
  const handleStartSync = async () => {
    try {
      setSyncStarting(true);
      const selectedCount = Object.keys(selectedById).length;
      if (selectedCount > 0) {
        const selectedSkus = Object.values(selectedById).filter(Boolean);

        const resp = await productsApi.updateInventoryBySKUs(selectedSkus);
        const msg = toastMessages.getMessage(resp);
        dispatch({ type: SHOW_TOAST, payload: msg });
        // Clear selection after successful sync of selected items
        setSelectedById({});
      } else {
        const resp = await productsApi.startProductSync(1, 100);
        const msg = toastMessages.getMessage(resp);
        dispatch({ type: SHOW_TOAST, payload: msg });
      }
    } catch (err) {
      const error = toastMessages.getMessage({
        status: "error",
        message: err.message,
      });
      dispatch({ type: SHOW_TOAST, payload: error });
    } finally {
      setSyncStarting(false);
    }
  };

  const getStatusChip = (status) => {
    const statusConfig = {
      active: { color: "success", icon: <CheckCircleIcon /> },
      inactive: { color: "error", icon: <ErrorIcon /> },
      pending: { color: "warning", icon: <WarningIcon /> },
    };

    const config = statusConfig[status] || { color: "default", icon: null };

    return (
      <Chip
        label={status}
        color={config.color}
        icon={config.icon}
        size="small"
        variant="outlined"
      />
    );
  };

  const getSyncStatusChip = (syncStatus) => {
    const syncConfig = {
      synced: { color: "success", icon: <CheckCircleIcon /> },
      syncing: { color: "warning", icon: <SyncIcon /> },
      failed: { color: "error", icon: <ErrorIcon /> },
    };

    const config = syncConfig[syncStatus] || { color: "default", icon: null };

    return (
      <Chip
        label={syncStatus}
        color={config.color}
        icon={config.icon}
        size="small"
        variant="outlined"
      />
    );
  };

  const getInventoryChip = (hasInventory, totalInventory) => {
    if (hasInventory && totalInventory > 0) {
      return (
        <Chip
          label={`${totalInventory} in stock`}
          color="success"
          icon={<InventoryIcon />}
          size="small"
          variant="outlined"
        />
      );
    }
    return (
      <Chip
        label="Out of stock"
        color="error"
        size="small"
        variant="outlined"
      />
    );
  };

  // Calculate selection states for header checkbox
  const isAllSelected =
    products.length > 0 && products.every((p) => !!selectedById[p._id]);
  const isIndeterminate =
    products.some((p) => !!selectedById[p._id]) && !isAllSelected;

  if (loading && products.length === 0) {
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
          <h1 className="text-2xl font-semibold">Nox Inventory</h1>
          <p className="text-sm text-neutral-600">
            Real-time inventory of Nox products and variants
          </p>
        </div>
        <div className="flex gap-2">
          <div>
            {/* Selected Products Text below the Sync button
            {Object.keys(selectedById).length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {Object.keys(selectedById).length} selected
                </Typography>
              </Box>
            )} */}
          </div>
          <div>
            <Tooltip
              title={
                Object.keys(selectedById).length > 0
                  ? "Update inventory for selected products"
                  : "Start full product sync from vendor"
              }
            >
              <Button
                sx={{
                  backgroundColor: "white",
                  color: "black",
                  textTransform: "none",
                  borderRadius: "8px",
                  border: "1px solid black",
                  fontSize: "12px",
                  height: "32px",
                  width: "auto",
                  "&:hover": {
                    backgroundColor: "black",
                    color: "white",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                  },
                }}
                startIcon={<SyncOutlinedIcon />}
                size="medium"
                onClick={handleStartSync}
                disabled={syncStarting}
              >
                {syncStarting
                  ? Object.keys(selectedById).length > 0
                    ? "Updating Inventory..."
                    : "Fetching Inventory..."
                  : Object.keys(selectedById).length > 0
                  ? `Fetch Selected (${Object.keys(selectedById).length})`
                  : "Fetch Inventory"}
              </Button>
            </Tooltip>
          </div>
          <div>
            <Tooltip title={"Export all products as CSV"}>
              <Button
                sx={{
                  backgroundColor: "#e94949",
                  color: "white",
                  textTransform: "none",
                  borderRadius: "8px",
                  fontSize: "12px",
                  height: "32px",
                  width: "140px",
                  "&:hover": {
                    backgroundColor: "black",
                    color: "white",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                  },
                }}
                startIcon={<FileDownloadOutlinedIcon />}
                size="medium"
                onClick={handleExportProducts}
                disabled={loading}
              >
                Export Products
              </Button>
            </Tooltip>
          </div>
          <div>
            <Tooltip title={"Export all variants as CSV"}>
              <Button
                sx={{
                  backgroundColor: "#e94949",
                  color: "white",
                  textTransform: "none",
                  borderRadius: "8px",
                  fontSize: "12px",
                  height: "32px",
                  width: "140px",
                  "&:hover": {
                    backgroundColor: "black",
                    color: "white",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                  },
                }}
                startIcon={<FileDownloadOutlinedIcon />}
                size="medium"
                onClick={handleExportInventory}
                disabled={loading}
              >
                Export Variants
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>
      <div>
        <Grid container spacing={2} mt={2}>
          {cards.map((card, index) => (
            <Grid item key={index}>
              <CtaCard
                title={card.title}
                // description={card.description}
                valueColor={card.valueColor}
                value={card.value}
                icon={card.icon}
                onClick={card.onClick}
              />
            </Grid>
          ))}
        </Grid>
      </div>
      <Card className="mt-4 border border-black" sx={{ borderRadius: "20px" }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mb: 2,
              gap: 2,
              justifyContent: "flex-end",
            }}
          >
            <SearchBar
              value={searchTerm}
              onChange={handleSearchChange}
              onSubmit={handleSearchSubmit}
              onClear={clearSearch}
              placeholder="Search by SKU, source, status..."
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

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              maxHeight: 480,
              overflow: "auto",
              "& .MuiTable-root": {
                minWidth: 1000,
              },
            }}
          >
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  {allColumns
                    .filter((c) => isVisible(c.id))
                    .map((c) => {
                      if (c.id === "select") {
                        return (
                          <TableCell key={c.id} padding="checkbox">
                            <Checkbox
                              icon={
                                <CheckCircleOutlineOutlinedIcon
                                  sx={{ color: "black" }}
                                />
                              }
                              checkedIcon={<CheckCircleOutlinedIcon />}
                              indeterminate={isIndeterminate}
                              checked={isAllSelected}
                              onChange={toggleSelectAll}
                              inputProps={{
                                "aria-label": "select all products",
                              }}
                            />
                          </TableCell>
                        );
                      }
                      return <TableCell key={c.id}>{c.label}</TableCell>;
                    })}
                </TableRow>
              </TableHead>
              <TableBody>
                {products.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={visibleColumnIds.length} align="center">
                      <Box py={3}>
                        <Typography variant="body1" color="text.secondary">
                          {committedSearchTerm
                            ? `No products found for "${committedSearchTerm}"`
                            : "No products found"}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  products.map((product) => (
                    <TableRow
                      key={product._id}
                      hover
                      onClick={() => handleProductClick(product._id)}
                      sx={{ cursor: "pointer" }}
                    >
                      {allColumns
                        .filter((c) => isVisible(c.id))
                        .map((c) => {
                          switch (c.id) {
                            case "select":
                              return (
                                <TableCell
                                  key={c.id}
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
                                    checked={!!selectedById[product._id]}
                                    onChange={(e) =>
                                      toggleSelectOne(e, product)
                                    }
                                    inputProps={{
                                      "aria-label": `select product ${product.mainSku}`,
                                    }}
                                  />
                                </TableCell>
                              );
                            case "product":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    fontWeight="medium"
                                  >
                                    {product.mainSku}
                                  </Typography>
                                </TableCell>
                              );
                            case "status":
                              return (
                                <TableCell key={c.id}>
                                  {getStatusChip(product.status)}
                                </TableCell>
                              );
                            case "syncStatus":
                              return (
                                <TableCell key={c.id}>
                                  {getSyncStatusChip(product.syncStatus)}
                                </TableCell>
                              );
                            // case "inventory":
                            //   return (
                            //     <TableCell key={c.id}>
                            //       {getInventoryChip(
                            //         product.hasInventory,
                            //         product.totalInventory
                            //       )}
                            //     </TableCell>
                            //   );
                            case "source":
                              return (
                                <TableCell key={c.id}>
                                  <Chip
                                    label={product.source}
                                    size="small"
                                    variant="outlined"
                                    color="primary"
                                  />
                                </TableCell>
                              );
                            case "lastSynced":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
                                    {new Date(
                                      product.lastSynced
                                    ).toLocaleDateString()}
                                  </Typography>
                                </TableCell>
                              );
                            case "created":
                              return (
                                <TableCell key={c.id}>
                                  <Typography
                                    variant="body2"
                                    color="text.secondary"
                                  >
                                    {new Date(
                                      product.createdAt
                                    ).toLocaleDateString()}
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
            count={totalProducts}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Inventory;
