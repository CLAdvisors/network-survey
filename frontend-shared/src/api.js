function getApiBaseUrl(env) {
  const source = env || (typeof process !== 'undefined' ? process.env : {});
  return `${source.REACT_APP_API_PROTOCOL}://${source.REACT_APP_API_HOST}:${source.REACT_APP_API_PORT}/api`;
}

function buildApiUrl(pathname, queryParams, env) {
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

function createAxiosApi(axios, options) {
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

module.exports = {
  getApiBaseUrl,
  buildApiUrl,
  createAxiosApi
};
