import * as constants from "./constants";

// Initial state
const initialState = {
  checkingSync: false,
  isSync: false,
  jobs: [],
  progressDetails: [],
  pagination: {
    total: 0,
    page: 1,
    limit: 10,
  },
};

export default function syncJobsReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case constants.JOBS_LISTING_REQUEST:
      return {
        ...state,
        checkingSync: true,
        isSync: false,
      };

    case constants.JOBS_LISTING_SUCCESS:
      return {
        ...state,
        checkingSync: false,
        isSync: true,
        jobs: payload?.history,
        pagination: payload?.pagination,
        progressDetails: payload?.history.map((item) => ({
          duration: item.duration,
          successRate: item.successRate,
        })),
      };

    case constants.JOBS_LISTING_FAIL:
      return {
        ...state,
        checkingSync: false,
        isSync: false,
      };

    default:
      return state;
  }
}
