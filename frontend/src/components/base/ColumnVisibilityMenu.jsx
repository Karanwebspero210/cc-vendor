import React, { useState, useMemo } from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";

/**
 * ColumnVisibilityMenu
 *
 * Props:
 * - allColumns: Array<{ id: string, label: string }>
 * - visibleColumnIds: string[]
 * - onChange: (nextVisibleIds: string[]) => void
 * - onReset?: () => void
 * - disabled?: boolean
 * - buttonLabel?: string
 * - variant?: 'button' | 'icon'
 */
const ColumnVisibilityMenu = ({
  allColumns,
  visibleColumnIds,
  onChange,
  onReset,
  disabled = false,
  buttonLabel = "Columns",
  variant = "button",
}) => {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const numVisible = visibleColumnIds.length;
  const visibleSet = useMemo(
    () => new Set(visibleColumnIds),
    [visibleColumnIds]
  );

  const handleOpen = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const toggleColumn = (columnId) => {
    const isVisible = visibleSet.has(columnId);
    if (isVisible) {
      // Prevent hiding the last remaining column
      if (numVisible <= 1) return;
      onChange(visibleColumnIds.filter((id) => id !== columnId));
    } else {
      onChange([...visibleColumnIds, columnId]);
    }
  };

  const handleSelectAll = () => {
    onChange(allColumns.map((c) => c.id));
  };

  const handleReset = () => {
    if (onReset) onReset();
  };

  return (
    <>
      {variant === "icon" ? (
        <Tooltip title="Columns">
          <span>
            <IconButton
              onClick={handleOpen}
              disabled={disabled}
              size="small"
              aria-label="toggle columns"
              type="button"
              sx={{
                border: "1px solid black",
                borderRadius: "8px",
                width: 36,
                height: 32,
                backgroundColor: "white",
                "&:hover": {
                  backgroundColor: "black",
                  "& svg": { color: "white" },
                },
                "&.Mui-disabled": {
                  opacity: 0.5,
                },
              }}
            >
              <ViewColumnIcon fontSize="small" sx={{ color: "black" }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button
          variant="outlined"
          size="small"
          onClick={handleOpen}
          disabled={disabled}
          type="button"
          sx={{
            textTransform: "none",
            borderColor: "black",
            color: "black",
            borderRadius: "8px",
            height: 32,
            "&:hover": {
              backgroundColor: "black",
              color: "white",
              borderColor: "black",
            },
          }}
        >
          {buttonLabel}
        </Button>
      )}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        keepMounted
        PaperProps={{
          elevation: 2,
          sx: {
            minWidth: 220,
            borderRadius: 1,
            "& .MuiMenuItem-root": { fontSize: 13, py: 0.5, px: 1.25 },
            "& .MuiCheckbox-root": { p: 0.5 },
            "& .MuiListItemText-root": { m: 0 },
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem onClick={handleSelectAll} disabled={disabled}>
          <Checkbox
            size="small"
            checked={numVisible === allColumns.length}
            indeterminate={numVisible > 0 && numVisible < allColumns.length}
            icon={<RadioButtonUncheckedIcon sx={{ color: "black" }} />}
            checkedIcon={<RadioButtonCheckedIcon sx={{ color: "black" }} />}
            indeterminateIcon={
              <RadioButtonUncheckedIcon sx={{ color: "black" }} />
            }
          />
          <ListItemText
            primary="Select All"
            primaryTypographyProps={{ fontSize: 13 }}
          />
        </MenuItem>
        <Divider />
        {allColumns.map((col) => {
          const checked = visibleSet.has(col.id);
          const disableUncheck = checked && numVisible <= 1;
          return (
            <MenuItem
              key={col.id}
              onClick={() => toggleColumn(col.id)}
              disabled={disabled || disableUncheck}
            >
              <Checkbox
                size="small"
                checked={checked}
                icon={<RadioButtonUncheckedIcon sx={{ color: "black" }} />}
                checkedIcon={<RadioButtonCheckedIcon sx={{ color: "black" }} />}
              />
              <ListItemText
                primary={col.label}
                primaryTypographyProps={{ fontSize: 13 }}
              />
            </MenuItem>
          );
        })}
        {onReset && (
          <>
            <Divider />
            <MenuItem onClick={handleReset} disabled={disabled}>
              <ListItemText
                primary="Reset to default"
                primaryTypographyProps={{ fontSize: 13 }}
              />
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
};

export default ColumnVisibilityMenu;
