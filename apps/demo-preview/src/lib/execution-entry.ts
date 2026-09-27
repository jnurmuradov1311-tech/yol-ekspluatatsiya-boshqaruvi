/** File references must come from an upload receipt for the current order. */
export function isAuthorizedWorkEvidence(orderId: string, url: string, uploadedUrls: readonly string[]): boolean {
  if (!uploadedUrls.includes(url)) return false;
  if (/^browser-file:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url)) return true;
  const prefix = `/api/v1/work-orders/${encodeURIComponent(orderId)}/evidence/`;
  return url.startsWith(prefix) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|pdf)$/i.test(url.slice(prefix.length));
}

export function executionEvidence(orderId: string, url: string, uploadedUrls: readonly string[]): string[] {
  if (!isAuthorizedWorkEvidence(orderId, url, uploadedUrls)) {
    throw new Error("Bajarilgan ish fotosi yoki PDF hujjatini yuklang.");
  }
  return [url];
}
