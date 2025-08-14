import * as constants from "./constants";

// Initial state
const initialState = {
  checkingAuth: false,
  loading: false,
  registered: false,
  isAuth: false,
  user: null,
  fetchRegister: false,
};

export default function authReducer(state = initialState, action) {
  const { type, payload } = action;

  switch (type) {
    case constants.LOGIN_REQUEST:
      return {
        ...state,
        loading: true,
        fetchRegister: false,
        registered: false,
      };

    case constants.LOGIN_SUCCESS:
      return {
        ...state,
        loading: false,
        fetchRegister: false,
        isAuth: true,
        user: payload,
      };

    case constants.LOGIN_FAIL:
      return {
        ...state,
        loading: false,
        checkingAuth: false,
      };

    case constants.LOGOUT:
      return {
        ...initialState,
      };

    default:
      return state;
  }
}
