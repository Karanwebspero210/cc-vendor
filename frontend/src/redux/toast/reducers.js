import * as constants from '../constants/index';

const initialState = {
  open: false,
  type: '',
  msg: '',
};

export default function toastReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case constants.SHOW_TOAST:
      return {
        ...state,
        open: true,
        type: payload?.type,
        msg: payload?.msg,
      };

    case constants.HIDE_TOAST:
    case constants.RESET_TOAST:
      return {
        ...state,
        open: false,
        type: '',
        msg: '',
      };

    default:
      return state;
  }
}
