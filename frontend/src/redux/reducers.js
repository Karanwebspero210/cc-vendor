import { combineReducers } from "redux";

import authReducer from "../redux/auth/reducers";
import toastReducer from "../redux/toast/reducers";

export default combineReducers({
  auth: authReducer,
  toast: toastReducer
});
