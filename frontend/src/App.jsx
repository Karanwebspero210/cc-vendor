import { Routes, Route, Navigate, Router } from "react-router-dom";
// import AuthLayout from "./layouts/auth-layout/index.jsx";
// import Login from "./pages/auth/Login.jsx";
// // import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
// // import ChangePassword from "./pages/auth/ChangePassword.jsx";
// import Dashboard from "./pages/dashboard/Dashboard.jsx";
// import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import { Provider } from "react-redux";
import store from "./redux/store";
import { Suspense } from "react";
import SplashLoader from "./components/loader/Splash.jsx";
import Pages from "./pages/index.jsx";

const App = () => {
  return (
    <Provider store={store}>
      <Suspense
        fallback={
          <div className="container">
            <SplashLoader />
          </div>
        }
      >
        {/* <Router> */}
          <Pages />
        {/* </Router> */}
      </Suspense>
    </Provider>
  );
};

export default App;
