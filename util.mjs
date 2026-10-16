// Tiny shared helpers.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}
