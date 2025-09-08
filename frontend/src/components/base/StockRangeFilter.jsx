import React from "react";
import {
  Paper,
  InputBase,
  IconButton,
  Tooltip,
  CircularProgress,
  Box,
} from "@mui/material";
import {
  Inventory as InventoryIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";

const StockRangeFilter = ({
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  onClearMin,
  onClearMax,
  disabled = false,
  loading = false,
  size = "small",
  placeholderMin = "Min",
  placeholderMax = "Max",
  sx = {},
}) => {
  const height = size === "small" ? 36 : 48;

  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        height,
        borderRadius: 999,
        boxShadow: "none",
        transition: (theme) =>
          theme.transitions.create(["box-shadow", "border-color"], {
            duration: 120,
          }),
        "&:focus-within": {
          boxShadow: (theme) => theme.shadows[2],
          borderColor: (theme) => theme.palette.primary.main,
        },
        ...sx,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          color: "text.secondary",
          ml: 0.5,
        }}
      >
        <InventoryIcon fontSize="small" />
      </Box>

      <InputBase
        value={minValue}
        onChange={onMinChange}
        placeholder={placeholderMin}
        disabled={disabled}
        type="number"
        sx={{ ml: 1, width: 80, fontSize: size === "small" ? 13 : 16 }}
        inputProps={{
          "aria-label": "min stock",
          inputMode: "numeric",
          step: 1,
        }}
      />

      {minValue !== "" && !loading && (
        <Tooltip title="Clear min">
          <span>
            <IconButton
              size={size}
              onClick={onClearMin}
              disabled={disabled}
              aria-label="clear min"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}

      <Box sx={{ width: 8 }} />
      <Box sx={{ color: "text.disabled", fontSize: 18, lineHeight: 1 }}>–</Box>
      <Box sx={{ width: 8 }} />

      <InputBase
        value={maxValue}
        onChange={onMaxChange}
        placeholder={placeholderMax}
        disabled={disabled}
        type="number"
        sx={{ width: 80, fontSize: size === "small" ? 13 : 16 }}
        inputProps={{
          "aria-label": "max stock",
          inputMode: "numeric",
          step: 1,
        }}
      />

      {loading && <CircularProgress size={18} sx={{ mx: 0.5 }} />}
      {maxValue !== "" && !loading && (
        <Tooltip title="Clear max">
          <span>
            <IconButton
              size={size}
              onClick={onClearMax}
              disabled={disabled}
              aria-label="clear max"
            >
              <ClearIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Paper>
  );
};

export default StockRangeFilter;
