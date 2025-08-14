import * as constants from "../constants/index";

export const showToast = (payload) => async (dispatch) => {
  try {
    if (payload) dispatch({ type: constants.SHOW_TOAST, payload });
    else {
      dispatch({ type: constants.HIDE_TOAST });
    }
  } catch (err) {
    dispatch({ type: constants.HIDE_TOAST });
  }
};

export const resetToast = () => async (dispatch) => {
  dispatch({ type: constants.RESET_TOAST });
};
