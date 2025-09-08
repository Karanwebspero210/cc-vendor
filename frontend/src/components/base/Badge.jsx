import * as React from "react";
import { Badge as MUIBadge, Box } from "@mui/material";
import { styled } from "@mui/system";

const badgeVariants = {
  default: {
    backgroundColor: "var(--primary)", // Set primary color
    color: "var(--primary-foreground)", // Set foreground text color
    "&:hover": {
      backgroundColor: "var(--primary-hover)", // Hover effect for primary
    },
  },
  secondary: {
    backgroundColor: "var(--secondary)", // Set secondary color
    color: "var(--secondary-foreground)", // Set foreground text color
    "&:hover": {
      backgroundColor: "var(--secondary-hover)", // Hover effect for secondary
    },
  },
  destructive: {
    backgroundColor: "var(--destructive)", // Destructive color
    color: "white",
    "&:hover": {
      backgroundColor: "var(--destructive-hover)", // Hover effect for destructive
    },
  },
  outline: {
    border: "1px solid", // Border for outline variant
    color: "var(--foreground)", // Set foreground color
    "&:hover": {
      backgroundColor: "var(--accent)", // Hover effect for outline
      color: "var(--accent-foreground)", // Hover text color for outline
    },
  },
};

const BadgeWrapper = styled(Box)(({ theme, variant }) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem", // rounded-md
  padding: "0.25rem 0.5rem", // px-2 py-0.5
  fontSize: "0.75rem", // text-xs
  fontWeight: 500, // font-medium
  whiteSpace: "nowrap",
  gap: "0.25rem", // gap-1
  pointerEvents: "none",
  transition: "color 0.2s, box-shadow 0.2s", // smooth transition
  ...badgeVariants[variant], // apply corresponding styles based on variant
}));

const Badge = ({
  variant = "default",
  className,
  children,
  asChild = false,
  ...props
}) => {
  const Component = asChild ? "div" : "span"; // Allows wrapping with different element types

  return (
    <BadgeWrapper
      as={Component}
      className={className}
      variant={variant}
      {...props}
    >
      {children}
    </BadgeWrapper>
  );
};

export { Badge };
