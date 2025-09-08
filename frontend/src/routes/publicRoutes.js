import { lazy } from "react";
const Login = lazy(() => import("../pages/auth/Login"));

const publicRoutes = [
  {
    id: 1,
    title: "Login",
    icon: null,
    path: "/login",
    component: Login,
  },
];

export default publicRoutes;
