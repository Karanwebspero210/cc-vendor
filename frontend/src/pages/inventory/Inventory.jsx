import React, { useState, useEffect, useRef } from "react";
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
} from "@mui/material";
import {
  Inventory as InventoryIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import { inventoryApi } from "../../api/inventory";

const Inventory = () => {
  // console.log("Inventory component rendering");

  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [totalItems, setTotalItems] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const initialCallMade = useRef(false);
  const searchTimeoutRef = useRef(null);

  // Debounce search term
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm]);

  // Fetch inventory function
  const fetchInventory = async (
    currentPage = page,
    currentRowsPerPage = rowsPerPage,
    search = debouncedSearchTerm
  ) => {
    // console.log("Fetching inventory:", {
    //   currentPage,
    //   currentRowsPerPage,
    //   search,
    // });
    try {
      setLoading(true);
      setError(null);
      const response = await inventoryApi.getAllInventory(
        currentPage + 1,
        currentRowsPerPage,
        search
      );
      setInventory(response.data.items);
      setTotalItems(response.data.pagination.total);
    } catch (err) {
      setError(err.message || "Failed to fetch inventory");
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
      rowsPerPage !== 50 ||
      debouncedSearchTerm !== ""
    ) {
      fetchInventory(page, rowsPerPage, debouncedSearchTerm);
    } else {
      // Initial load
      initialCallMade.current = true;
      fetchInventory(page, rowsPerPage, debouncedSearchTerm);
    }
  }, [page, rowsPerPage, debouncedSearchTerm]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRefresh = () => {
    fetchInventory(page, rowsPerPage, debouncedSearchTerm);
  };

  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
    setPage(0); // Reset to first page when searching
  };

  const clearSearch = () => {
    setSearchTerm("");
    setPage(0);
  };

  const getStatusChip = (status) => {
    const statusConfig = {
      active: { color: "success", icon: <CheckCircleIcon /> },
      inactive: { color: "error", icon: <ErrorIcon /> },
      pending: { color: "warning", icon: <WarningIcon /> },
    };

    const config = statusConfig[status?.toLowerCase()] || {
      color: "default",
      icon: null,
    };

    return (
      <Chip
        label={status || "Unknown"}
        color={config.color}
        icon={config.icon}
        size="small"
        variant="outlined"
      />
    );
  };

  const getSyncStatusChip = (syncStatus) => {
    if (!syncStatus) {
      return (
        <Chip
          label="Not Synced"
          color="default"
          size="small"
          variant="outlined"
        />
      );
    }

    const syncConfig = {
      synced: { color: "success", icon: <CheckCircleIcon /> },
      syncing: { color: "warning", icon: <SyncIcon /> },
      failed: { color: "error", icon: <ErrorIcon /> },
    };

    const config = syncConfig[syncStatus.toLowerCase()] || {
      color: "default",
      icon: null,
    };

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

  const getStockChip = (stockQty) => {
    if (stockQty > 0) {
      return (
        <Chip
          label={`${stockQty} in stock`}
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
    <Box p={3}>
      <Card>
        <CardHeader
          title="Inventory"
          subheader={`Total Variants: ${totalItems}${
            searchTerm ? ` (Search: "${searchTerm}")` : ""
          }`}
          action={
            <Tooltip title="Refresh">
              <IconButton onClick={handleRefresh} disabled={loading}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          }
        />
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <TextField
              label="Search Variants"
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by SKU, color, size..."
              sx={{ minWidth: 300 }}
              disabled={loading}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    {loading && <CircularProgress size={20} />}
                    {searchTerm && !loading && (
                      <IconButton onClick={clearSearch} size="small">
                        <ClearIcon />
                      </IconButton>
                    )}
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              maxHeight: 400,
              overflow: "auto",
              "& .MuiTable-root": {
                minWidth: 1200,
              },
            }}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Variant SKU</TableCell>
                  <TableCell>Main SKU</TableCell>
                  <TableCell>Color</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Stock Quantity</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Sync Status</TableCell>
                  <TableCell>Last Synced</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inventory.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center">
                      <Box py={3}>
                        <Typography variant="body1" color="text.secondary">
                          {searchTerm
                            ? `No inventory items found for "${searchTerm}"`
                            : "No inventory items found"}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  inventory.map((item) => (
                    <TableRow key={item._id} hover>
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {item.variantSku}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{item.mainSku}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={item.color}
                          size="small"
                          variant="outlined"
                          color="primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{item.size}</Typography>
                      </TableCell>
                      <TableCell>{getStockChip(item.stockQty)}</TableCell>
                      <TableCell>{getStatusChip(item.status)}</TableCell>
                      <TableCell>
                        {getSyncStatusChip(item.lastSyncStatus)}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatDate(item.lastSynced)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {formatDate(item.createdAt)}
                        </Typography>
                      </TableCell>
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
            rowsPerPageOptions={[25, 50, 100]}
          />
        </CardContent>
      </Card>
    </Box>
  );
};

export default Inventory;
