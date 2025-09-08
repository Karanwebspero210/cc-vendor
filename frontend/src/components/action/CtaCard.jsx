import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const CtaCard = ({
  title,
  description,
  value,
  icon,
  onClick,
  valueColor = "success.main",
}) => {
  return (
    <Card
      variant="outlined"
      sx={{
        border: "none",
        borderRadius: 4,
        display: "flex",
        // Fixed width in pixels, changes with screen size
        width: { lg: 370, xl: 392 },
        height: { lg: 140, xl: 120 },
        cursor: "pointer",

        "&:hover": {
          boxShadow: "0 0 20px 0 rgba(0, 0, 0, 0.4)",
          transition: "all 0.3s ease",
          backgroundColor: "rgba(0, 0, 0, 0.02)",
        },
      }}
      onClick={onClick}
    >
      <CardContent
        sx={{
          display: "flex",
          alignItems: "center",
          border: "1px solid black", // black border
          borderRadius: 4,
          width: "100%",
          // px: { xs: 2, sm: 3 },
          // py: { xs: 2, sm: 2.5 },
          px: 3,
          "&:last-child": {
            pb: 0,
            pt: 0,
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            height: "100%",
            width: "100%",
            justifyContent: "space-between",
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: { xs: 1, sm: 1.5 },
              flexGrow: 1,
            }}
          >
            <Box>
              <Typography
                sx={{
                  fontSize: { xs: 13, sm: 14 },
                  fontWeight: 400, // not bold
                  lineHeight: 1.3,
                }}
              >
                {title}
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: 11, sm: 12 },
                  color: "text.secondary",
                  fontWeight: 400,
                }}
              >
                {description}
              </Typography>
            </Box>

            <Typography
              sx={{
                fontSize: { xs: 26, sm: 32, md: 36 },
                fontWeight: 400, // not bold
                color: valueColor,
              }}
            >
              {value}
            </Typography>
          </Box>

          {/* Icon responsive sizing */}
          <Box
            sx={{
              ml: "auto",
              "& svg, & img": {
                width: { xs: 26, sm: 34, md: 32 },
                height: { xs: 26, sm: 34, md: 32 },
              },
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

export default CtaCard;
