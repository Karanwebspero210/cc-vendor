import * as constants from "./constants";

// Initial state
const initialState = {
  checkingDashboard: false,
  isDashboard: null,
};

export default function dashboardReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    // Removed GET_PROFILE_* cases per undo request
    case constants.DASHBOARD_REQUEST:
      return {
        ...state,
        checkingDashboard: true,
        isDashboard: false,
      };

    case constants.DASHBOARD_SUCCESS:
      return {
        ...state,
        checkingDashboard: false,
        isDashboard: payload,
      };

    case constants.DASHBOARD_FAIL:
      return {
        ...state,
        checkingDashboard: false,
      };

    default:
      return state;
  }
}
