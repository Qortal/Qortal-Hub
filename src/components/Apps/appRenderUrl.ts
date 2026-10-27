/** Encode QDN service/name as individual path segments. A literal '+' is valid
 * in a URL path, so URL parsing alone will not canonicalize it to '%2B', which
 * the isolated guest's app-root policy expects. Routes are appended separately.
 */
export function buildAppRenderRoot(
  baseUrl: string,
  service: string,
  name: string
): string {
  return `${baseUrl}/render/${encodeURIComponent(service)}/${encodeURIComponent(name)}`;
}
