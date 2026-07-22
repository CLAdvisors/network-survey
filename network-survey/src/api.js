import { buildApiUrl as buildSharedApiUrl } from '@network-survey/frontend-shared';

export function buildApiUrl(pathname, queryParams) {
  return buildSharedApiUrl(pathname, queryParams, process.env);
}
