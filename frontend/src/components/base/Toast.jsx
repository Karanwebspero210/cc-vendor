import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ToastContainer, toast } from "react-toastify";
import * as toastActions from "../../redux/toast/actions";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import ErrorIcon from "@mui/icons-material/Error";
import WarningIcon from "@mui/icons-material/Warning";

import "react-toastify/dist/ReactToastify.css";

const Toast = () => {
  const dispatch = useDispatch();
  const { open, type, msg } = useSelector((state) => state.toast);

  const CloseButton = ({ closeToast }) => {
    return (
      <div
        onClick={closeToast}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginLeft: "auto",
          height: "100%",
          padding: "0 12px",
          cursor: "pointer",
        }}
      >
        <CloseIcon
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            color: "red",
            border: `1px solid black`,
            borderRadius: "50%",
            fontSize: 16,
            cursor: "pointer",
            marginLeft: "auto",
          }}
        />
      </div>
    );
  };

  useEffect(() => {
    if (open && type === "success" && msg) {
      toast[type](msg, {
        className: "toast-success",
        progressStyle: { background: "#4A9E5C" },
        icon: ({ theme, type }) => (
          <CheckCircleIcon sx={{ color: "black" }} />
        ),
      });
      dispatch(toastActions.resetToast());
    }

    if (type === "error" && msg) {
      toast[type](msg, {
        className: "toast-error",
        progressStyle: { background: "#e74c3c" }, // Red for error
        icon: ({ type }) => <ErrorIcon sx={{ color: "#e74c3c" }} />, // Red for error
      });
      dispatch(toastActions.resetToast());
    }

    if (type === "warning" && msg) {
      toast[type](msg, {
        className: "toast-warning",
        progressStyle: { background: "#f39c12" }, // Yellow-orange for warning
        icon: ({ theme, type }) => <WarningIcon sx={{ color: "#f39c12" }} />, // Yellow-orange for warning
      });
      dispatch(toastActions.resetToast());
    }

    if (type === "info" && msg) {
      toast[type](msg, {
        className: "toast-info",
        progressStyle: { background: "#3498db" }, // Blue for info
        icon: ({ theme, type }) => <ErrorIcon sx={{ color: "#3498db" }} />, // Blue for info
      });
      dispatch(toastActions.resetToast());
    }
  }, [open, type, msg, dispatch]);

  return (
    <ToastContainer
      autoClose={2000}
      position="top-right"
      closeButton={CloseButton}
      hideProgressBar={false}
    />
  );
};

export default Toast;
