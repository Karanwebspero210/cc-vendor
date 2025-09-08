import * as constants from "./constants";
import * as apis from "./apis";
import { GET } from "../constants/index";
import API_REQUEST from "../request/index";

export const jobList = (data) => async (dispatch) => {
  try {
    console.log("jobList action called with data:", data);
    dispatch({ type: constants.JOBS_LISTING_REQUEST });
    console.log(data, "data in job list");
    const resp = await API_REQUEST(GET, apis.JOBS_LISTING_API, data);
    console.log("API response:", resp);

    if (resp) {
      const history = resp?.data?.data?.history;
      const pagination = resp?.data?.data?.pagination;
      dispatch({
        type: constants.JOBS_LISTING_SUCCESS,
        payload: { history, pagination },
      });
    } else {
      dispatch({
        type: constants.JOBS_LISTING_FAIL,
        payload: resp.error.message,
      });
    }
  } catch (err) {
    dispatch({ type: constants.JOBS_LISTING_FAIL, payload: err.message });
  }
};
