import React from "react";
import {
  Paper,
  InputBase,
  IconButton,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import { Search as SearchIcon, Clear as ClearIcon } from "@mui/icons-material";

const SearchBar = ({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = "Search...",
  disabled = false,
  loading = false,
  autoFocus = false,
  fullWidth = false,
  size = "small",
  sx = {},
}) => {
  const handleKeyDown = (event) => {
    if (event.key === "Enter" && onSubmit) {
      onSubmit();
    }
  };

  const height = size === "small" ? 32 : 44;

  return (
    <Paper
      variant="outlined"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        height,
        borderRadius: 2,
        boxShadow: "none",
        borderColor: "black",
        backgroundColor: "white",
        transition: (theme) =>
          theme.transitions.create(
            ["box-shadow", "border-color", "background-color", "color"],
            {
              duration: 120,
            }
          ),
        "&:hover": {
          borderColor: "black",
        },
        "&:focus-within": {
          borderColor: "black",
          boxShadow: "0 0 0 2px rgba(0,0,0,0.06)",
        },
        ...(fullWidth ? { width: "100%" } : {}),
        ...sx,
      }}
    >
      <Tooltip title="Search">
        <span>
          <IconButton
            size={size}
            disabled={disabled || loading}
            onClick={onSubmit}
            aria-label="search"
          >
            <SearchIcon sx={{ color: "black" }} />
          </IconButton>
        </span>
      </Tooltip>
      <InputBase
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        sx={{ ml: 1, flex: 1, fontSize: size === "small" ? 13 : 15 }}
        inputProps={{ "aria-label": placeholder }}
      />
      {loading && <CircularProgress size={18} sx={{ mr: 0.5 }} />}
      {value && !loading && (
        <Tooltip title="Clear">
          <span>
            <IconButton
              size={size}
              onClick={onClear}
              disabled={disabled}
              aria-label="clear search"
            >
              <ClearIcon sx={{ color: "black" }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Paper>
  );
};

export default SearchBar;
