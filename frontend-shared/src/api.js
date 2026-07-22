export function getApiBaseUrl(env) {
  const source = env || {};
  const protocol = source.VITE_API_PROTOCOL || source.REACT_APP_API_PROTOCOL;
  const host = source.VITE_API_HOST || source.REACT_APP_API_HOST;
  const port = source.VITE_API_PORT || source.REACT_APP_API_PORT;

  return `${protocol}://${host}:${port}/api`;
}

export function buildApiUrl(pathname, queryParams, env) {
  const sanitizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${getApiBaseUrl(env)}${sanitizedPath}`);

  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return;
      }

      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
}

export function createAxiosApi(axios, options) {
  const settings = options || {};
  const api = axios.create({
    baseURL: getApiBaseUrl(settings.env),
    withCredentials: settings.withCredentials !== undefined ? settings.withCredentials : true
  });

  if (settings.onForbidden) {
    api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 403) {
          settings.onForbidden(error);
        }
        return Promise.reject(error);
      }
    );
  }

  return api;
}
