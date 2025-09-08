// API_REQUEST.js
import axios from "axios";
import { GET } from "../constants/index";
import * as services from "../../services/index";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Cache object to store responses
const cache = {};

// Updated: Get token dynamically
const getHeaders = (dispatch, onUploadProgress) => {
  const token = services.getToken(); // <-- always get fresh token
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  if (dispatch && onUploadProgress) {
    return {
      "Content-Type": "multipart/form-data",
      ...authHeader,
    };
  }
  return {
    "Content-Type": "application/json",
    ...authHeader,
  };
};

// Generate cache key
const generateCacheKey = (method, url, data) => {
  return `${method}-${url}-${JSON.stringify(data)}`;
};

// Final method
const API_REQUEST = async (
  method,
  url,
  data,
  dispatch = null,
  onUploadProgress = null
) => {
  const headers = getHeaders(dispatch, onUploadProgress);
  const cacheKey = generateCacheKey(method, url, data);

  if (
    method === GET &&
    cache[cacheKey] &&
    Date.now() - cache[cacheKey].timestamp < CACHE_TIMEOUT
  ) {
    return cache[cacheKey].response;
  } else if (method !== GET) {
    Object.keys(cache).forEach((key) => delete cache[key]);
  }
  try {
    const axiosConfig = {
      headers,
      method,
      url: `${BASE_URL}/${url}`,
      onUploadProgress: (progressEvent) => {
        if (dispatch && onUploadProgress) {
          // handle progress
        }
      },
    };

    // For GET requests, send params via query string instead of request body
    if (method === GET) {
      axiosConfig.params = data;
    } else {
      axiosConfig.data = data;
    }

    const response = await axios(axiosConfig);
    // Global auth error handling for success responses that carry error payloads
    try {
      const payload = response && response.data ? response.data : {};
      const isFailureFlag =
        payload && (payload.success === false || payload.status === "error");
      const errorObj = payload && (payload.error || {});
      const errorCode = errorObj && errorObj.code ? errorObj.code : undefined;
      const errorMessage =
        errorObj && errorObj.message
          ? errorObj.message
          : payload && payload.message
          ? payload.message
          : "";
      const tokenExpired = /token has expired/i.test(
        String(errorMessage || "")
      );
      const isAuthError = errorCode === "AUTH_ERROR" || tokenExpired;
      if (isFailureFlag && isAuthError) {
        services.removeToken();
        try {
          window.location.href = "/login";
        } catch (_) {}
        // Prevent caching this response and signal error to callers
        throw new Error("AUTH_ERROR");
      }
    } catch (_) {}

    if (method === GET) {
      cache[cacheKey] = {
        response,
        timestamp: Date.now(),
      };
    }
    return response;
  } catch (error) {
    if (
      error.response &&
      (error.response.status === 403 || error.response.status === 401)
    ) {
      services.removeToken();
      try {
        window.location.href = "/login";
      } catch (_) {}
    }
    throw error;
  }
};

export default API_REQUEST;
