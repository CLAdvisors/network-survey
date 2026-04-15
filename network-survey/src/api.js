const apiBaseUrl = `${process.env.REACT_APP_API_PROTOCOL}://${process.env.REACT_APP_API_HOST}:${process.env.REACT_APP_API_PORT}/api`;

export function buildApiUrl(pathname, queryParams) {
  const sanitizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${apiBaseUrl}${sanitizedPath}`);

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