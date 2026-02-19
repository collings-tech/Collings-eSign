import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

/** Profile image URL from backend path (e.g. "profiles/abc.jpg") */
export function getProfileImageUrl(profileImageUrl) {
  if (!profileImageUrl) return null;
  return `${API_BASE_URL}/uploads/${profileImageUrl}`;
}

export function setAuthToken(token) {
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common.Authorization;
  }
}

