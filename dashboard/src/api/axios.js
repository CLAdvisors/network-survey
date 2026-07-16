import axios from 'axios';

const api = axios.create({
  baseURL: `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api`,
  withCredentials: true  // Important! This sends cookies
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cla:forbidden', {
        detail: error.response.data?.message || error.response.data?.error || 'You do not have permission to perform that action.'
      }));
    }
    return Promise.reject(error);
  }
);

export default api;
