import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as authActions from "../../redux/auth/actions";
import validationSchema from "../validations/login";

import { setToken, getToken } from "../../utils/storage";
import {
  TextField,
  Button,
  CircularProgress,
  Typography,
  Box,
  Container,
  IconButton,
  FormControlLabel,
  Checkbox,
  Link,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";

import { useFormik } from "formik";

const Login = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();

  const { loading } = useSelector((state) => state.auth);

  const [showPassword, setShowPassword] = useState(false);

  const formik = useFormik({
    initialValues: {
      email: "",
      password: "",
    },
    validationSchema,
    onSubmit: (values) => {
      handleSubmit(values);
    },
  });

  useEffect(() => {
    const token = getToken();
    if (token) {
      navigate("/products", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = (values) => {
    if (values) {
      dispatch(authActions.login(values));
    }
  };

  const handleChangeField = (event) => {
    const { name, value } = event.target;
    formik.setFieldValue(name, value);
  };

  return (
    <Box px={{ xs: 2, sm: 3 }} py={{ xs: 2, sm: 4 }}>
      <form onSubmit={formik.handleSubmit}>
        <Box display="flex" flexDirection="column" gap={{ xs: 2, sm: 2.5 }}>
          <TextField
            id="email"
            label="Email"
            name="email"
            type="email"
            color="black"
            value={formik.values.email}
            onChange={handleChangeField}
            variant="outlined"
            fullWidth
            autoFocus
            required
            error={formik.touched.email && Boolean(formik.errors.email)}
            helperText={formik.touched.email && formik.errors.email}
          />

          <TextField
            id="password"
            name="password"
            label="Password"
            color="black"
            type={showPassword ? "text" : "password"}
            value={formik.values.password}
            onChange={handleChangeField}
            variant="outlined"
            fullWidth
            required
            error={formik.touched.password && Boolean(formik.errors.password)}
            helperText={formik.touched.password && formik.errors.password}
            sx={{ borderRadius: "10px" }}
          />

          {/* <Box
            mt={0}
            display="flex"
            alignItems="center"
            justifyContent="end"
            flexWrap="wrap"
            gap={1}
          >
            <Link
              fontSize={{ xs: 13, sm: "body2.fontSize" }}
              sx={{
                cursor: "pointer",
                color: "black",
                textDecoration: "underline",
                "&:hover": {
                  textDecoration: "none",
                },
              }}
            >
              Forgot password ?
            </Link>
          </Box> */}

          <Button
            type="submit"
            variant="contained"
            size="medium"
            fullWidth
            disabled={loading}
            loading={loading}
            loadingText="Submitting..."
            sx={{
              background: "black",
              "&:hover": {
                background: "grey",
                color: "black",
              },
              mt: 2,
              fontSize: { xs: 13, sm: 16 },
              py: { xs: 1.25, sm: 1.5 },
            }}
          >
            Sign in
          </Button>
        </Box>
      </form>
    </Box>
  );
};

export default Login;
