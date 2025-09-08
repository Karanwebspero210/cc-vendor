import { combineReducers } from "redux";

import authReducer from "../redux/auth/reducers";
import toastReducer from "../redux/toast/reducers";
import jobsReducer from "../redux/jobs/reducers";
import dashboardReducer from "../redux/dashboard/reducers";

export default combineReducers({
  auth: authReducer,
  toast: toastReducer,
  listJobs: jobsReducer,
  dashboard: dashboardReducer,
});
