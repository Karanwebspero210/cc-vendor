import * as constants from "./constants";
import * as apis from "./apis";
import * as payloads from "./payloads";
import * as services from "../../services/index";
import * as messages from "../toast/messages";
import { DELETE, GET, POST, PUT, SHOW_TOAST } from "../constants/index";
import API_REQUEST from "../request/index";

export const login = (data) => async (dispatch) => {
  try {
    dispatch({ type: constants.LOGIN_REQUEST });

    const resp = await API_REQUEST(POST, apis.ACCOUNT_LOGIN_API, data);
    const token = resp?.data?.data?.token;

    if (token) {
      services.setToken(token);

      // const res2 = await API_REQUEST(GET, apis.GET_USER_PROFILE_API);

      const msg = messages.getMessage(resp.data);
      dispatch({ type: SHOW_TOAST, payload: msg });

      // if (res2?.data?.data) {
      dispatch({
        type: constants.LOGIN_SUCCESS,
        payload: resp.data.data,
      });
      //   return;
      // }
    } else {
      // Handle non-exceptional login failures (e.g., HTTP 200 with error payload)
      const msg = messages.getMessage(resp?.data);
      const errorToast = {
        ...msg,
        // Coerce to a valid toast type for react-toastify
        type: "error",
      };
      dispatch({ type: SHOW_TOAST, payload: errorToast });
      dispatch({ type: constants.LOGIN_FAIL });
      return;
    }
  } catch (err) {
    console.error("login error:", err);
    const serverData =
      err && err.response && err.response.data ? err.response.data : {};
    const obj = {
      ...serverData,
      status: "error",
    };
    const error = messages.getMessage(obj);
    dispatch({ type: SHOW_TOAST, payload: error });
    dispatch({ type: constants.LOGIN_FAIL });
  }
};

export const logout = () => async (dispatch) => {
  try {
    // Best-effort API logout; ignore failures
    try {
      await API_REQUEST(POST, apis.ACCOUNT_LOGOUT_API);
    } catch (_) {}

    // Clear tokens from both storages (services and legacy utils)
    try {
      services.removeToken?.();
    } catch (_) {}
    try {
      const { clearToken } = await import("../../utils/storage");
      clearToken?.();
    } catch (_) {}
  } finally {
    dispatch({ type: constants.LOGOUT });
  }
};
