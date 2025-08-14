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
    const response = await axios({
      headers,
      method,
      url: `${BASE_URL}/${url}`,
      data,
      onUploadProgress: (progressEvent) => {
        if (dispatch && onUploadProgress) {
          // handle progress
        }
      },
    });

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
      // Optionally redirect: window.location.href = '/signin';
    }
    throw error;
  }
};

export default API_REQUEST;
