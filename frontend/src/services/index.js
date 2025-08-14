// services/index.js

export const setToken = (token) => {
  localStorage.setItem("cc_admin_token", token);
};

export const getToken = () => {
  return localStorage.getItem("cc_admin_token");
};

export const removeToken = () => {
  localStorage.removeItem("cc_admin_token");
};
