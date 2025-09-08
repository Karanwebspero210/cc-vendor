import React, { useEffect, useRef, lazy, useState } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import * as authActions from "../redux/auth/actions";
import publicRoutes from "../routes/publicRoutes";
import privateRoutes from "../routes/privateRoutes";
import SplashLoader from "../components/loader/Splash";

// import Toast from "components/base/Toast";
import PublicRoute from "../pages/PublicRoute";
import PrivateRoute from "../pages/PrivateRoute";
import AuthLayout from "../layouts/auth-layout";
// import { logout } from "utils/utils";
// import LogoutDialog from "components/ConfirmModal";

const NotFound = lazy(() => import("../pages/NotFound"));
import { getToken } from "../utils/storage";
import Toast from "../components/base/Toast";

function Pages() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const auth = useSelector((state) => state.auth);

  const [allRoutes, setAllRoutes] = useState([]);
  const [openModal, setOpenModal] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const checkingAuth = auth?.checkingAuth;
  const isAuth = auth?.isAuth || Boolean(getToken());

  const handleMenu = (menu) => {
    switch (menu.id) {
      case 1:
        handleProfile();
        break;

      case 2:
        // handleLogout();
        handleOpenModal();
        break;

      default:
        break;
    }
  };

  //   const handleProfile = () => {
  //     // navigate(`/settings/user-profile`);
  //     navigate(`/settings#profile`);
  //   };

  const handleLogout = () => {
    logout();
  };

  const handleOpenModal = () => {
    setOpenModal(true);
  };

  const handleCloseModal = () => {
    setOpenModal(false);
  };

  //   //logic to handle primaryMerchantID for reference
  //   useEffect(() => {
  //     dispatch(authActions.getUser());

  //     if (auth?.user?.primaryMerchantId?._id && !localStorage.getItem("userID")) {
  //       localStorage.setItem("userID", auth.user.primaryMerchantId._id);
  //     }
  //   }, [dispatch, auth?.user?.primaryMerchantId?._id]);

  useEffect(() => {
    setAllRoutes(privateRoutes);
  }, [setAllRoutes, auth?.user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInitialLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  // if(openModal){
  //   return(
  //     <LogoutDialog
  //       open={openModal}
  //       handleClose={handleCloseModal}
  //       titleHead={'Are you sure you want to log out?'}
  //       handleSubmit={handleLogout}
  //       btnMsg={'Confirm'}
  //     />
  //   )
  // }

  if (checkingAuth || initialLoading) {
    return (
      <div className="container">
        <SplashLoader />
      </div>
    );
  }
  //   console.log(privateRoutes,publicRoutes, "isAuth");

  //   console.log(isAuth,"isAuth")

  return (
    <>
      <Toast />

      {/* <LogoutDialog
        open={openModal}
        handleClose={handleCloseModal}
        titleHead={"Are you sure you want to log out?"}
        handleSubmit={handleLogout}
        btnMsg={"Confirm"}
      /> */}

      <Routes>
        <Route
          path="/"
          element={
            isAuth ? <Navigate to="/dashboard" /> : <Navigate to="/login" />
          }
        />

        {publicRoutes.map((ele) => {
          return (
            <Route
              key={ele.id}
              exact
              path={ele.path}
              element={
                <PublicRoute isAuth={isAuth} auth={auth}>
                  <AuthLayout>
                    <ele.component />
                  </AuthLayout>
                </PublicRoute>
              }
            />
          );
        })}

        {allRoutes.map((ele) => {
          return (
            <Route
              key={ele.id}
              exact
              path={ele.path}
              element={
                <PrivateRoute
                  handleMenu={handleMenu}
                  initials={auth?.user?.name}
                  isAuth={isAuth}
                  auth={auth}
                >
                  <ele.component />
                </PrivateRoute>
              }
            />
          );
        })}

        {/* Not Found */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default Pages;
