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
  IconButton,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  Inventory as InventoryIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  CheckCircle,
  LockClock,
  AlignVerticalBottom,
} from "@mui/icons-material";
import { inventoryApi } from "../../api/inventory";
import CtaCard from "../../components/action/CtaCard";
import { Badge } from "../../components/base/Badge";

const InventoryDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const goToSyncWithSearch = (sku) => {
    if (!sku) return;
    navigate("/sync-inventory", { state: { initialSearch: sku } });
  };

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

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatTimeAgo = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60)
    );

    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)}h ago`;
    } else {
      return `${Math.floor(diffInMinutes / 1440)}d ago`;
    }
  };

  const getVariantStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "inactive":
        return "bg-neutral-100 text-neutral-600 border-neutral-200";
      default:
        return "bg-neutral-100 text-neutral-600 border-neutral-200";
    }
  };

  const totalVariants = items.length;
  const activeVariants = items.filter(
    (it) => String(it.status).toLowerCase() === "active"
  ).length;
  const inactiveVariants = items.filter(
    (it) => String(it.status).toLowerCase() === "inactive"
  ).length;

  return (
    <div className="flex flex-col p-6 ">
      <div className="flex items-center gap-4">
        <IconButton
          sx={{
            backgroundColor: "white",
            color: "black",
            textTransform: "none",
            borderRadius: "8px",
            border: "1px solid black",
            height: "auto",
            width: "auto",
            "&:hover": {
              backgroundColor: "black",
              color: "white",
            },
          }}
          onClick={() => navigate(-1)}
        >
          <ArrowBackIcon />
        </IconButton>
        <div>
          <h1 className="text-2xl font-semibold">Product Details</h1>
          <p className="text-sm text-neutral-600">
            Detailed view of product and variants
          </p>
        </div>
      </div>

      <Grid item xs={12} md={4} mt={4}>
        <div className="border border-black rounded-2xl bg-white">
          <div className="flex items-center gap-2 p-4 ">
            <InventoryIcon sx={{ fontSize: 18, color: "black" }} />
            Product Information
          </div>

          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {/* First Column */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-600">Main SKU</p>
                  <p className="font-mono font-medium">{product.mainSku}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600">Source</p>
                  <p className="font-mono font-medium">{product.source}</p>
                </div>
              </div>

              {/* Second Column */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-600">Status</p>
                  <p className="font-mono font-medium">{product.status}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600">Sync Status</p>
                  <p className="font-mono font-medium">{product.syncStatus}</p>
                </div>
              </div>

              {/* Third Column */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-600">Total Variants</p>
                  <p className="text-2xl font-medium">{totalVariants}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600">In Stock</p>
                  <p className="font-mono font-medium">
                    {product.inStock ? "Yes" : "No"}
                  </p>
                </div>
              </div>

              {/* Fourth Column */}
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-neutral-600">Last Synced</p>
                  <p className="font-medium">
                    {formatTimeAgo(product.lastSynced)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600">Updated</p>
                  <p className="font-medium">{formatDate(product.updatedAt)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </div>
      </Grid>

      <Card className="mt-4 border border-black" sx={{ borderRadius: "20px" }}>
        <CardContent>
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
                      <Typography
                        variant="body2"
                        fontWeight="medium"
                        sx={{ cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => goToSyncWithSearch(item.variantSku)}
                      >
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
    </div>
  );
};

export default InventoryDetails;
