import React, { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Button,
  Grid,
  Tooltip,
  IconButton,
  CircularProgress,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableContainer,
  Paper,
  TablePagination,
  Tabs,
  Tab,
} from "@mui/material";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import LinkOffOutlinedIcon from "@mui/icons-material/LinkOffOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import CtaCard from "../../components/action/CtaCard";
import { shopifyApi } from "../../api/shopify";
import { useDispatch } from "react-redux";
import * as toastActions from "../../redux/toast/actions";

const VariantRow = ({ v }) => {
  return (
    <TableRow hover>
      <TableCell>{v.variantSku}</TableCell>
      <TableCell>{v.mainSku}</TableCell>
      <TableCell>{v.color}</TableCell>
      <TableCell>{v.size}</TableCell>
      <TableCell>{v.stockQty}</TableCell>
      <TableCell>
        {v.shopifyVariantId && v.shopifyInventoryItemId ? (
          <Chip
            size="small"
            color="success"
            icon={<LinkOutlinedIcon />}
            label="Linked"
          />
        ) : (
          <Chip
            size="small"
            color="default"
            icon={<LinkOffOutlinedIcon />}
            label="Not Linked"
          />
        )}
      </TableCell>
    </TableRow>
  );
};

const MapInventory = () => {
  const [loading, setLoading] = useState(false);
  // const [maxUpdates, setMaxUpdates] = useState(0);
  const dispatch = useDispatch();
  const [synced, setSynced] = useState([]);
  const [syncedTotal, setSyncedTotal] = useState(0);
  const [syncedPage, setSyncedPage] = useState(0);
  const [syncedRows, setSyncedRows] = useState(10);

  const [unsynced, setUnsynced] = useState([]);
  const [unsyncedTotal, setUnsyncedTotal] = useState(0);
  const [unsyncedPage, setUnsyncedPage] = useState(0);
  const [unsyncedRows, setUnsyncedRows] = useState(10);

  const [counts, setCounts] = useState({ synced: 0, unsynced: 0 });
  const [activeTab, setActiveTab] = useState(0);

  const fetchLists = async () => {
    try {
      setLoading(true);
      const [unsRes, synRes] = await Promise.all([
        shopifyApi.getSyncStatus("unsynced", unsyncedPage + 1, unsyncedRows),
        shopifyApi.getSyncStatus("synced", syncedPage + 1, syncedRows),
      ]);
      const unsItems = unsRes?.data?.items || [];
      const synItems = synRes?.data?.items || [];
      setUnsynced(unsItems);
      setSynced(synItems);
      setCounts(
        unsRes?.data?.counts ||
          synRes?.data?.counts || { synced: 0, unsynced: 0 }
      );
      setUnsyncedTotal(unsRes?.data?.pagination?.total || unsItems.length);
      setSyncedTotal(synRes?.data?.pagination?.total || synItems.length);
    } catch (e) {
      dispatch(
        toastActions.showToast({
          type: "error",
          msg: e?.message || "Failed to fetch sync status",
        })
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedPage, syncedRows, unsyncedPage, unsyncedRows]);

  const handleTriggerSync = async () => {
    try {
      setLoading(true);
      const res = await shopifyApi.triggerSyncWithShopify();
      const msg = res?.data?.message || res?.message || "Sync queued";
      dispatch(
        toastActions.showToast({
          type: "success",
          msg,
        })
      );
    } catch (e) {
      dispatch(
        toastActions.showToast({
          type: "error",
          msg: e?.message || "Failed to trigger sync",
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <div className="flex flex-col p-6 ">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Linked Inventory</h1>
          <p className="text-sm text-neutral-600">
            Link portal variants with Shopify variants
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Tooltip title={"Link Nox Inventory with Shopify"}>
            <span>
              <Button
                sx={{
                  backgroundColor: "#e94949",
                  color: "white",
                  textTransform: "none",
                  borderRadius: "8px",

                  fontSize: "12px",
                  height: 32,
                  width: 160,
                  "&:hover": {
                    backgroundColor: "black",
                    color: "white",
                    boxShadow: "0px 0px 10px 0px rgba(0, 0, 0, 0.1)",
                  },
                }}
                startIcon={
                  loading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <SyncOutlinedIcon />
                  )
                }
                size="medium"
                onClick={handleTriggerSync}
                disabled={loading}
              >
                {loading ? "Linking..." : "Link with Shopify"}
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div>
        <Grid container spacing={2} mt={2}>
          <Grid item>
            <CtaCard
              title="Total Variants"
              value={`${counts.unsynced + counts.synced}`}
              valueColor="black"
              icon={<SyncOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />}
            />
          </Grid>
          <Grid item>
            <CtaCard
              title="Linked Variants"
              value={`${counts.synced}`}
              icon={
                <Inventory2OutlinedIcon sx={{ fontSize: 28, color: "gray" }} />
              }
            />
          </Grid>
          <Grid item>
            <CtaCard
              title="Not Linked Variants"
              value={`${counts.unsynced}`}
              valueColor="#e94949"
              icon={<SyncOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />}
            />
          </Grid>
        </Grid>
      </div>

      <div className="mt-4">
        <Card
          variant="outlined"
          sx={{
            border: "1px solid black",
            borderRadius: "20px",
            width: "100%",
          }}
        >
          <CardContent>
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                sx={{
                  "& .MuiTab-root": {
                    textTransform: "none",
                    fontWeight: 600,
                    fontSize: "16px",
                  },
                  "& .Mui-selected": {
                    color: "#e94949",
                  },
                  "& .MuiTabs-indicator": {
                    backgroundColor: "#e94949",
                  },
                }}
              >
                <Tab
                  label={`Linked Variants (${counts.synced})`}
                  icon={<LinkOutlinedIcon />}
                  iconPosition="start"
                />
                <Tab
                  label={`Not Linked Variants (${counts.unsynced})`}
                  icon={<LinkOffOutlinedIcon />}
                  iconPosition="start"
                />
              </Tabs>
            </Box>

            <Box sx={{ mt: 2 }}>
              {activeTab === 0 && (
                <>
                  <TableContainer
                    component={Paper}
                    elevation={0}
                    sx={{ maxHeight: 500 }}
                  >
                    <Table stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Variant</TableCell>
                          <TableCell>Main SKU</TableCell>
                          <TableCell>Color</TableCell>
                          <TableCell>Size</TableCell>
                          <TableCell>Stock</TableCell>
                          <TableCell>Link</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {synced.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} align="center">
                              No linked variants found
                            </TableCell>
                          </TableRow>
                        ) : (
                          synced.map((v) => <VariantRow key={v._id} v={v} />)
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    count={syncedTotal}
                    page={syncedPage}
                    onPageChange={(e, p) => setSyncedPage(p)}
                    rowsPerPage={syncedRows}
                    onRowsPerPageChange={(e) => {
                      setSyncedRows(parseInt(e.target.value, 10));
                      setSyncedPage(0);
                    }}
                    rowsPerPageOptions={[10, 25, 50]}
                  />
                </>
              )}

              {activeTab === 1 && (
                <>
                  <TableContainer
                    component={Paper}
                    elevation={0}
                    sx={{ maxHeight: 500 }}
                  >
                    <Table stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Variant</TableCell>
                          <TableCell>Main SKU</TableCell>
                          <TableCell>Color</TableCell>
                          <TableCell>Size</TableCell>
                          <TableCell>Stock</TableCell>
                          <TableCell>Link</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {unsynced.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} align="center">
                              No unlinked variants found
                            </TableCell>
                          </TableRow>
                        ) : (
                          unsynced.map((v) => <VariantRow key={v._id} v={v} />)
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <TablePagination
                    component="div"
                    count={unsyncedTotal}
                    page={unsyncedPage}
                    onPageChange={(e, p) => setUnsyncedPage(p)}
                    rowsPerPage={unsyncedRows}
                    onRowsPerPageChange={(e) => {
                      setUnsyncedRows(parseInt(e.target.value, 10));
                      setUnsyncedPage(0);
                    }}
                    rowsPerPageOptions={[10, 25, 50]}
                  />
                </>
              )}
            </Box>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MapInventory;
