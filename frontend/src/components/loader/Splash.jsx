import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";

const Splash = (props) => {
  return (
    <Stack
      display={"flex"}
      alignItems="center"
      justifyContent="center"
      width="100vw"
      height="100vh"
    >
      <CircularProgress
        sx={{
          color:"black",
          animationDuration: "0.5s !important",
        }}
      />
    </Stack>
  );
};

export default Splash;
