import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const PublicRoute = ({ isAuth, auth, children }) => {
  const location = useLocation();

  if (isAuth) {
    return (
      <Navigate
        to={'/products'}
        state={{ from: location }}
      />
    );
  }
  return <>{children}</>;
};

export default PublicRoute;
