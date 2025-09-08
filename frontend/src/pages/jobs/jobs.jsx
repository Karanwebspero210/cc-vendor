import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  TablePagination,
  Tooltip,
  IconButton,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
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
import * as jobsListingActions from "../../redux/jobs/actions";

import { useDispatch, useSelector } from "react-redux";

const statusColor = (status) => {
  const map = {
    queued: "warning",
    running: "info",
    completed: "success",
    failed: "error",
  };
  return map[status] || "default";
};

// Derive a friendly job name based on metadata tags/type
const getFriendlyJobName = (job) => {
  const tags = job?.metadata?.tags || [];
  if (tags.includes("shopify-sync") || job?.queueName === "shopify-sync") {
    return "Sync with Shopify";
  }
  if (tags.includes("inventory")) {
    return "Sync Inventory";
  }
  if (tags.includes("products")) {
    return "Sync Specific Products";
  }
  return job?.type || "-";
};

// Decide where to navigate for a given job
const getRouteForJob = (job) => {
  const tags = job?.metadata?.tags || [];
  if (tags.includes("shopify-sync") || job?.queueName === "shopify-sync") {
    return "/shopify-sync";
  }
  // For inventory and specific products, navigate to inventory page
  if (tags.includes("inventory") || tags.includes("products")) {
    return "/inventory";
  }
  return null;
};

const Jobs = () => {
  const { jobs, pagination, checkingSync } = useSelector(
    (state) => state.listJobs
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isJobs, setJobs] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const navigate = useNavigate();

  const dispatch = useDispatch();

  // const fetchJobs = async (currentPage = page, currentRows = rowsPerPage) => {
  //   try {
  //     setLoading(true);
  //     setError(null);
  //     const data = {
  //       page: currentPage + 1,
  //       limit: currentRows,
  //     };
  //     const res = await syncJobsActions.listJobs(data);
  //     const history = res?.data?.history || [];
  //     const pagination = res?.data?.pagination || { total: 0 };
  //     setJobs(history);
  //     setTotal(pagination.total || history.length);
  //   } catch (err) {
  //     setError(err.message || "Failed to fetch jobs");
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // useEffect(() => {
  //   const data = {
  //     page: 0,
  //     limit: rowsPerPage,
  //   };

  //   dispatch(syncJobsActions.listJobs(data));
  // }, []);

  useEffect(() => {
    const data = {
      page: page + 1,
      limit: rowsPerPage,
    };
    dispatch(jobsListingActions.jobList(data));
  }, [page, rowsPerPage]);

  const handleChangePage = (event, newPage) => setPage(newPage);
  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRefresh = async () => {
    console.log("Refresh button clicked");
    if (refreshCooldown > 0) {
      console.log("Refresh cooldown active:", refreshCooldown);
      return;
    }
    const data = {
      page: 1,
      limit: rowsPerPage,
      _t: Date.now(), // Add timestamp to bypass cache
    };
    console.log("Dispatching jobList with data:", data);
    dispatch(jobsListingActions.jobList(data));
    setRefreshCooldown(10);
  };

  useEffect(() => {
    if (refreshCooldown <= 0) return;
    const interval = setInterval(() => {
      setRefreshCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [refreshCooldown]);

  useEffect(() => {
    setTotal(pagination?.total ?? 0);
  }, [pagination]);

  return (
    <div className="flex flex-col p-6 ">
      <div className="flex  justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Job History</h1>
          <p className="text-sm text-neutral-600">
            Views the history of sync jobs
          </p>
        </div>
        <div>
          <Tooltip
            title={
              checkingSync
                ? "Refreshing..."
                : refreshCooldown > 0
                ? `Wait ${refreshCooldown}s`
                : "Refresh"
            }
          >
            <span>
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
                onClick={handleRefresh}
                disabled={checkingSync || refreshCooldown > 0}
              >
                {checkingSync ? (
                  <CircularProgress size={20} />
                ) : (
                  <RefreshIcon />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </div>
      </div>
      <div className=" border border-black  bg-white mt-4 rounded-2xl ">
        {/* <CardHeader
          // title="Ongoing Jobs"
          // subheader={`Total: ${total}`}
          action={
            <Tooltip
              title={
                refreshCooldown > 0 ? `Wait ${refreshCooldown}s` : "Refresh"
              }
            >
              <span>
                <IconButton
                  onClick={handleRefresh}
                  disabled={loading || refreshCooldown > 0}
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          }
        /> */}
        <CardContent>
          {checkingSync && jobs?.length === 0 ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <TableContainer
              component={Paper}
              elevation={0}
              sx={{ maxHeight: 660 }}
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
                    <TableCell sx={{ color: "black" }}>Job ID</TableCell>
                    <TableCell sx={{ color: "black" }}>Type</TableCell>
                    <TableCell sx={{ color: "black" }}>Status</TableCell>
                    <TableCell sx={{ color: "black" }}>Progress</TableCell>
                    <TableCell sx={{ color: "black" }}>Created</TableCell>
                    <TableCell sx={{ color: "black" }}>Duration</TableCell>
                    <TableCell sx={{ color: "black" }}>Active</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        No jobs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    jobs?.map((job) => {
                      const pct = job?.progress?.percentage ?? 0;
                      const createdAt = job?.createdAt
                        ? new Date(job.createdAt).toLocaleString()
                        : "-";
                      const duration =
                        typeof job?.duration === "number"
                          ? `${Math.round(job.duration / 1000)}s`
                          : job?.startedAt && job?.completedAt
                          ? `${Math.round(
                              (new Date(job.completedAt) -
                                new Date(job.startedAt)) /
                                1000
                            )}s`
                          : "-";
                      const route = job?._id
                        ? `/jobs/${job._id}`
                        : getRouteForJob(job);
                      return (
                        <TableRow
                          key={job._id}
                          hover
                          onClick={() => {
                            if (route) navigate(route);
                          }}
                          sx={{
                            cursor: route ? "pointer" : "default",
                            // border: "1px solid black",
                          }}
                        >
                          <TableCell>
                            <Tooltip title={job.jobId || job._id}>
                              <span style={{ fontFamily: "monospace" }}>
                                {String(job.jobId || job._id).padStart(10, "0")}
                              </span>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={getFriendlyJobName(job)}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={statusColor(job.status)}
                              label={job.status}
                            />
                          </TableCell>
                          <TableCell sx={{ minWidth: 220 }}>
                            <Box display="flex" alignItems="center" gap={1}>
                              <Box flex={1}>
                                <LinearProgress
                                  variant="determinate"
                                  value={Math.min(100, Math.max(0, pct))}
                                  sx={{
                                    backgroundColor: "#e0e0e0",
                                    "& .MuiLinearProgress-bar": {
                                      backgroundColor: "#1976d2", // Stronger Blue
                                    },
                                  }}
                                />
                              </Box>
                              <Box
                                width={42}
                                textAlign="right"
                                sx={{ fontVariantNumeric: "tabular-nums" }}
                              >
                                {Math.round(pct)}%
                              </Box>
                            </Box>
                            <Box
                              mt={0.5}
                              display="flex"
                              gap={2}
                              color="text.secondary"
                            >
                              <span>✔ {job?.progress?.completed ?? 0}</span>
                              <span>✖ {job?.progress?.failed ?? 0}</span>
                              <span>∑ {job?.progress?.total ?? 0}</span>
                            </Box>
                          </TableCell>
                          <TableCell>{createdAt}</TableCell>
                          <TableCell>{duration}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={job.isActive ? "Yes" : "No"}
                              color={job.isActive ? "success" : "default"}
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100, 200]}
          />
        </CardContent>
      </div>
    </div>
  );
};

export default Jobs;
