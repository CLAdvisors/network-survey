import axios from 'axios';
import { createAxiosApi } from '@network-survey/frontend-shared';

const api = createAxiosApi(axios, {
  env: process.env,
  withCredentials: true, // Important! This sends cookies
  onForbidden: (error) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cla:forbidden', {
        detail: error.response.data?.message || error.response.data?.error || 'You do not have permission to perform that action.'
      }));
    }
  }
});

export default api;
