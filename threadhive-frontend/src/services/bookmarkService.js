import axiosInstance from '../api/axiosInstance.js';
import { BOOKMARK_API } from '../config/apiConfig.js';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const fetchBookmarks = async () => {
  const res = await axiosInstance.get(BOOKMARK_API.GET_ALL, {
    headers: getAuthHeaders(),
  });
  return res.data.data;
};

export const fetchBookmarkIds = async () => {
  const res = await axiosInstance.get(BOOKMARK_API.GET_IDS, {
    headers: getAuthHeaders(),
  });
  return res.data.data;
};

export const saveBookmark = async (threadId) => {
  const res = await axiosInstance.put(BOOKMARK_API.BY_THREAD(threadId), null, {
    headers: getAuthHeaders(),
  });
  return res.data.data;
};

export const unsaveBookmark = async (threadId) => {
  const res = await axiosInstance.delete(BOOKMARK_API.BY_THREAD(threadId), {
    headers: getAuthHeaders(),
  });
  return res.data.data;
};
