import * as constants from "./constants";
import * as apis from "./apis";
import * as payloads from "./payloads";
import * as services from "../../services/index";
import * as messages from "../toast/messages";
import { DELETE, GET, POST, PUT, SHOW_TOAST } from "../constants/index";
import API_REQUEST from "../request/index";

export const dashboardInfo = () => async (dispatch) => {
  try {
    dispatch({ type: constants.DASHBOARD_REQUEST });

    const resp = await API_REQUEST(GET, apis.DASHBOARD_API);
    dispatch({ type: constants.DASHBOARD_SUCCESS, payload: resp.data });
    return resp.data;
  } catch (err) {
    console.error("dashboard error:", err);
    const serverData =
      err && err.response && err.response.data ? err.response.data : {};
    const obj = {
      ...serverData,
      status: "error",
    };
    const error = messages.getMessage(obj);
    dispatch({ type: SHOW_TOAST, payload: error });
    dispatch({ type: constants.DASHBOARD_FAIL });
  }
};

