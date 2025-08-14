import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import PrivateLayout from "../layouts/private-layout";
import privateRoutes from "../routes/privateRoutes";
import { getToken } from "../utils/storage";

const PrivateRoute = ({ isAuth, children, ...props }) => {
  const location = useLocation();

  const userSideBar = privateRoutes?.filter((e) => !e?.hidden);
  const hiddenRoute = privateRoutes?.filter((e) => e?.hidden);

  if (!(isAuth || Boolean(getToken()))) {
    return <Navigate to={"/login"} state={{ from: location }} />;
  }

  return (
    <PrivateLayout sidebar={userSideBar} {...props}>
      {children}
    </PrivateLayout>
  );
};

export default PrivateRoute;
