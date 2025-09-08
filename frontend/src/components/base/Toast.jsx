import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Snackbar, Alert } from "@mui/material";
import Slide from "@mui/material/Slide";
import * as toastActions from "../../redux/toast/actions";

const TransitionDown = (props) => {
  return <Slide {...props} direction="down" />;
};

const Toast = () => {
  const dispatch = useDispatch();
  const { open, type, msg } = useSelector((state) => state.toast);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    dispatch(toastActions.resetToast());
  };

  // useEffect(() => {
  //   if (open) {
  //     // You can perform additional actions here if needed
  //   }
  // }, [open, type, msg]);

  return (
    <Snackbar
      open={open}
      autoHideDuration={2000}
      onClose={handleClose}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      TransitionComponent={TransitionDown}
      TransitionProps={{
        onExited: () => setIsClosing(false),
      }}
    >
      <Alert
        onClose={handleClose}
        severity={type} // MUI Alert will handle success, error, info, and warning styles automatically
        sx={{
          width: "100%",
          backgroundColor
            : type === "success"
            ? "#4A9E5C"
            : type === "error"
            ? "#e74c3c"
            : type === "warning"
            ? "#f39c12"
            : "",
        }}
      >
        {msg}
      </Alert>
    </Snackbar>
  );
};

export default Toast;
