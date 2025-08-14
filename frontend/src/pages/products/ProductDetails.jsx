import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Alert,
  Chip,
  Button,
  Grid,
  Divider,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  Inventory as InventoryIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from "@mui/icons-material";
import { inventoryApi } from "../../api/inventory";

const ProductDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProductDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await inventoryApi.getProductInventory(id);
        setProduct(response.data.product);
        setItems(response.data.items);
      } catch (err) {
        setError(err.message || "Failed to fetch product details");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchProductDetails();
    }
  }, [id]);

  const getStatusChip = (status) => {
    const statusConfig = {
      Active: { color: "success", icon: <CheckCircleIcon /> },
      Inactive: { color: "error", icon: <ErrorIcon /> },
      Pending: { color: "warning", icon: <WarningIcon /> },
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

  if (loading) {
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

  if (!product) {
    return (
      <Box p={3}>
        <Alert severity="warning">Product not found</Alert>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate("/products")}
        sx={{ mb: 2 }}
      >
        Back to Products
      </Button>

      <Grid container spacing={3}>
        {/* Product Summary Card */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardHeader title="Product Summary" />
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {product.mainSku}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Source: {product.source}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Status: {product.status}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Total Inventory: {product.totalInventory}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Sync Status: {product.syncStatus}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Last Synced: {new Date(product.lastSynced).toLocaleDateString()}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Created: {new Date(product.createdAt).toLocaleDateString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Inventory Items */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardHeader
              title="Inventory Variants"
              subheader={`${items.length} variants found`}
            />
            <CardContent>
              <TableContainer
                component={Paper}
                elevation={0}
                sx={{ maxHeight: 400, overflow: "auto" }}
              >
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Variant SKU</TableCell>
                      <TableCell>Color</TableCell>
                      <TableCell>Size</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Stock Quantity</TableCell>
                      <TableCell>Last Synced</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item._id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight="medium">
                            {item.variantSku}
                          </Typography>
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
                        <TableCell>{getStatusChip(item.status)}</TableCell>
                        <TableCell>{getStockChip(item.stockQty)}</TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {item.lastSynced
                              ? new Date(item.lastSynced).toLocaleDateString()
                              : "Never"}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProductDetails;
