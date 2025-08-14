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
  TextField,
  InputAdornment,
  IconButton,
} from "@mui/material";
import {
  Inventory as InventoryIcon,
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import { productsApi } from "../../api/products";

const Products = () => {
  // console.log("Products component rendering");
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [totalProducts, setTotalProducts] = useState(0);
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

  // Fetch products function
  const fetchProducts = async (
    currentPage = page,
    currentRowsPerPage = rowsPerPage,
    search = debouncedSearchTerm
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
      setTotalProducts(response.data.pagination.total);
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
      debouncedSearchTerm !== ""
    ) {
      fetchProducts(page, rowsPerPage, debouncedSearchTerm);
    } else {
      // Initial load
      initialCallMade.current = true;
      fetchProducts(page, rowsPerPage, debouncedSearchTerm);
    }
  }, [page, rowsPerPage, debouncedSearchTerm]);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleProductClick = (productId) => {
    navigate(`/products/details/${productId}`);
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
    <Box p={3}>
      <Card>
        <CardHeader
          title="Products"
          subheader={`Total Products: ${totalProducts}${
            searchTerm ? ` (Search: "${searchTerm}")` : ""
          }`}
        />
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <TextField
              label="Search Products"
              variant="outlined"
              size="small"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search by SKU, source, status..."
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
                minWidth: 1000,
              },
            }}
          >
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Sync Status</TableCell>
                  <TableCell>Inventory</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Last Synced</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center">
                      <Box py={3}>
                        <Typography variant="body1" color="text.secondary">
                          {searchTerm
                            ? `No products found for "${searchTerm}"`
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
                      <TableCell>
                        <Typography variant="body2" fontWeight="medium">
                          {product.mainSku}
                        </Typography>
                      </TableCell>
                      <TableCell>{getStatusChip(product.status)}</TableCell>
                      <TableCell>
                        {getSyncStatusChip(product.syncStatus)}
                      </TableCell>
                      <TableCell>
                        {getInventoryChip(
                          product.hasInventory,
                          product.totalInventory
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={product.source}
                          size="small"
                          variant="outlined"
                          color="primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(product.lastSynced).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(product.createdAt).toLocaleDateString()}
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
            count={totalProducts}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </CardContent>
      </Card>
    </Box>
  );
};

export default Products;
