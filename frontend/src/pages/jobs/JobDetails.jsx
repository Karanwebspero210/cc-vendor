import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  CardContent,
  Alert,
  CircularProgress,
  Button,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  Tooltip,
  IconButton,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { getShopifyJobStatus, downloadShopifyJobCsv } from "../../api/shopify";

const StatusChip = ({ status }) => {
  const map = {
    queued: { color: "warning", label: "Queued" },
    active: { color: "info", label: "Running" },
    completed: { color: "success", label: "Completed" },
    failed: { color: "error", label: "Failed" },
    delayed: { color: "default", label: "Paused" },
    cancelled: { color: "default", label: "Cancelled" },
  };
  const cfg = map[status] || { color: "default", label: status || "-" };
  return (
    <Chip size="small" color={cfg.color} label={cfg.label} variant="outlined" />
  );
};

export default function JobDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [job, setJob] = useState(null);

  const fetchJob = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getShopifyJobStatus(id);
      setJob(res?.data?.job || null);
    } catch (e) {
      setError(e.message || "Failed to load job");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const items = job?.result?.data?.items || [];
  const syncedItems = job?.result?.data?.details?.syncedItems || [];
  const unsyncedItems = job?.result?.data?.details?.unsyncedItems || [];
  const counts = job?.result?.data?.counts || null;
  const isShopifySync = Array.isArray(job?.metadata?.tags)
    ? job.metadata.tags.includes("shopify-sync")
    : job?.queueName === "shopify-sync";

  // Derive resolution items for shopify-sync jobs to fit the same table columns
  const resolutionItems = isShopifySync
    ? [
        ...syncedItems.map((it) => ({
          variantSku: it.variantSku,
          shopifyInventoryItemId: it.shopifyInventoryItemId,
          previousQuantity:
            typeof it.lastKnownShopifyQty === "number"
              ? it.lastKnownShopifyQty
              : null,
          toQuantity: null,
          status: "synced",
          error: null,
        })),
        ...unsyncedItems.map((it) => ({
          variantSku: it.variantSku,
          shopifyInventoryItemId: it.shopifyInventoryItemId,
          previousQuantity:
            typeof it.lastKnownShopifyQty === "number"
              ? it.lastKnownShopifyQty
              : null,
          toQuantity: null,
          status: "unsynced",
          error:
            !it.shopifyVariantId || !it.shopifyInventoryItemId
              ? "MISSING_SHOPIFY_FIELDS"
              : null,
        })),
      ]
    : [];

  return (
    <div className="flex flex-col p-6 ">
      <div className="flex  justify-between items-center">
        <div className="flex items-center gap-2">
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
            <h1 className="text-2xl font-semibold">Job Details</h1>
            <p className="text-sm text-neutral-600">
              {job
                ? `Job ID: ${job.jobId}`
                : "View the status and results of this job"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="small"
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
            onClick={async () => {
              try {
                await downloadShopifyJobCsv(job?._id || id, "unsynced");
              } catch (e) {
                alert(e.message || "Failed to export CSV");
              }
            }}
          >
            Export Not Synced CSV
          </Button>
        </div>
      </div>
      <div className=" border border-black  bg-white mt-4 rounded-2xl ">
        <CardContent>
          {loading ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : !job ? (
            <Alert severity="warning">Job not found</Alert>
          ) : (
            <>
              <Box
                mb={2}
                display="flex"
                gap={2}
                flexWrap="wrap"
                alignItems="center"
              >
                <StatusChip status={job.status} />
                <Chip
                  size="small"
                  label={`Progress: ${job?.progress?.percentage ?? 0}% (✔ ${
                    job?.progress?.completed ?? 0
                  } · ✖ ${job?.progress?.failed ?? 0} · ∑ ${
                    job?.progress?.total ?? 0
                  })`}
                  variant="outlined"
                />
                {Array.isArray(job?.metadata?.tags) &&
                  job.metadata.tags.length > 0 && (
                    <Chip
                      size="small"
                      label={job.metadata.tags.join(", ")}
                      variant="outlined"
                    />
                  )}
              </Box>

              <Box mb={2}>
                <Alert severity="info">
                  {job?.result?.message || "Result summary not available yet."}
                </Alert>
              </Box>

              {isShopifySync &&
                (syncedItems.length > 0 || unsyncedItems.length > 0) && (
                  <>
                    {counts && (
                      <Box mb={2} display="flex" gap={2} flexWrap="wrap">
                        <Chip
                          size="small"
                          color="success"
                          label={`Synced: ${counts.synced}`}
                          variant="outlined"
                        />
                        <Chip
                          size="small"
                          color="default"
                          label={`Not Synced: ${counts.unsynced}`}
                          variant="outlined"
                        />
                      </Box>
                    )}

                    <Box mb={3}>
                      <Chip size="small" label="Synced Items" sx={{ mb: 1 }} />
                      <TableContainer
                        component={Paper}
                        elevation={0}
                        sx={{ maxHeight: 300 }}
                      >
                        <Table stickyHeader>
                          <TableHead>
                            <TableRow
                              sx={{
                                backgroundColor: "black",
                                color: "white",
                                fontWeight: "bold",
                              }}
                            >
                              <TableCell sx={{ color: "black" }}>
                                Variant SKU
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Shopify Variant ID
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Inventory Item ID
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Shopify Qty
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Last Sync
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {syncedItems.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} align="center">
                                  No synced items
                                </TableCell>
                              </TableRow>
                            ) : (
                              syncedItems.map((it, idx) => (
                                <TableRow
                                  key={`${it.variantSku || idx}-synced`}
                                >
                                  <TableCell>
                                    <Tooltip title={it.variantSku || "-"}>
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.variantSku || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip title={it.shopifyVariantId || "-"}>
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.shopifyVariantId || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip
                                      title={it.shopifyInventoryItemId || "-"}
                                    >
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.shopifyInventoryItemId || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    {typeof it.lastKnownShopifyQty === "number"
                                      ? it.lastKnownShopifyQty
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    {it.lastSyncAt
                                      ? new Date(it.lastSyncAt).toLocaleString()
                                      : "-"}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>

                    <Box mb={3}>
                      <Chip
                        size="small"
                        label="Not Synced Items"
                        sx={{ mb: 1 }}
                      />
                      <TableContainer
                        component={Paper}
                        elevation={0}
                        sx={{ maxHeight: 300 }}
                      >
                        <Table stickyHeader>
                          <TableHead>
                            <TableRow
                              sx={{
                                backgroundColor: "black",
                                color: "white",
                                fontWeight: "bold",
                              }}
                            >
                              <TableCell sx={{ color: "black" }}>
                                Variant SKU
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Shopify Variant ID
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Inventory Item ID
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Shopify Qty
                              </TableCell>
                              <TableCell sx={{ color: "black" }}>
                                Last Sync
                              </TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {unsyncedItems.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} align="center">
                                  No unsynced items
                                </TableCell>
                              </TableRow>
                            ) : (
                              unsyncedItems.map((it, idx) => (
                                <TableRow
                                  key={`${it.variantSku || idx}-unsynced`}
                                >
                                  <TableCell>
                                    <Tooltip title={it.variantSku || "-"}>
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.variantSku || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip title={it.shopifyVariantId || "-"}>
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.shopifyVariantId || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    <Tooltip
                                      title={it.shopifyInventoryItemId || "-"}
                                    >
                                      <span style={{ fontFamily: "monospace" }}>
                                        {it.shopifyInventoryItemId || "-"}
                                      </span>
                                    </Tooltip>
                                  </TableCell>
                                  <TableCell>
                                    {typeof it.lastKnownShopifyQty === "number"
                                      ? it.lastKnownShopifyQty
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    {it.lastSyncAt
                                      ? new Date(it.lastSyncAt).toLocaleString()
                                      : "-"}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Box>
                  </>
                )}

              {/* Inventory update job details or derived sync details */}
              <TableContainer
                component={Paper}
                elevation={0}
                sx={{ maxHeight: 500 }}
              >
                <Table stickyHeader>
                  <TableHead>
                    <TableRow
                      sx={{
                        backgroundColor: "black",
                        color: "white",
                        fontWeight: "bold",
                      }}
                    >
                      <TableCell sx={{ color: "black" }}>Variant SKU</TableCell>
                      <TableCell sx={{ color: "black" }}>
                        Inventory Item ID
                      </TableCell>
                      <TableCell sx={{ color: "black" }}>
                        Previous Quantity
                      </TableCell>
                      <TableCell sx={{ color: "black" }}>
                        New Quantity
                      </TableCell>
                      <TableCell sx={{ color: "black" }}>Status</TableCell>
                      <TableCell sx={{ color: "black" }}>Error</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.length === 0 && resolutionItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          No item details available yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      (items.length > 0 ? items : resolutionItems).map(
                        (it, idx) => (
                          <TableRow key={`${it.variantSku || idx}-${idx}`}>
                            <TableCell>
                              <Tooltip title={it.variantSku || "-"}>
                                <span style={{ fontFamily: "monospace" }}>
                                  {it.variantSku || "-"}
                                </span>
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              <Tooltip title={it.shopifyInventoryItemId || "-"}>
                                <span style={{ fontFamily: "monospace" }}>
                                  {it.shopifyInventoryItemId || "-"}
                                </span>
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              {typeof it.previousQuantity === "number"
                                ? it.previousQuantity
                                : "-"}
                            </TableCell>
                            <TableCell>
                              {typeof it.toQuantity === "number"
                                ? it.toQuantity
                                : "-"}
                            </TableCell>
                            <TableCell>
                              {it.status === "updated" ? (
                                <Chip
                                  size="small"
                                  color="success"
                                  icon={<CheckCircleIcon />}
                                  label="Updated"
                                  variant="outlined"
                                />
                              ) : it.status ? (
                                <Chip
                                  size="small"
                                  color={
                                    it.status.includes("failed")
                                      ? "error"
                                      : "default"
                                  }
                                  icon={
                                    it.status.includes("failed") ? (
                                      <ErrorIcon />
                                    ) : undefined
                                  }
                                  label={it.status}
                                  variant="outlined"
                                />
                              ) : (
                                <Chip
                                  size="small"
                                  label="-"
                                  variant="outlined"
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <span style={{ color: "#b71c1c" }}>
                                {it.error || ""}
                              </span>
                            </TableCell>
                          </TableRow>
                        )
                      )
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </CardContent>
      </div>
    </div>
  );
}
