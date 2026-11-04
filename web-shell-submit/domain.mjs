// Tier 1, free, no API key: RDAP + DNS domain age / availability.
// Replaces the broken KWscanner Domain Age checker (Tools-page bug) for
// the web shell: check a domain on demand, cache it, and recompute the
// young-domain signal from real registration dates.
// RDAP notes (honest limits):
// - A 200 response with a registration event = registered, age is real.
// - A 404, or a closed connection + no DNS records, = "likely available",
//   NOT a guarantee — only a registrar check at purchase time is definitive.
// - Some registries close the connection for unregistered names instead
//   of returning 404, which is why DNS is used as a second signal.
// - Rate: sequential checks, 400ms apart, cached for 30 days in
//   data/domain-cache.json, so re-checks are free and instant.
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "domain-cache.json");
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch { cache = {}; }
function saveCache() {
  try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Strip subdomains to the registrable domain: portalmx.infonavit.org.mx -> infonavit.org.mx,
// www.example.com -> example.com. Handles two-level suffixes like com.mx / org.mx / co.uk.
export function registrableDomain(domain) {
  const d = String(domain || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  const parts = d.split(".").filter(Boolean);
  if (parts.length <= 2) return d;
  const secondLevel = new Set(["com", "org", "net", "edu", "gov", "co", "ac", "gob"]);
  if (parts.length >= 3 && secondLevel.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function parseCpc(cpc) {
  if (cpc == null) return null;
  const v = parseFloat(String(cpc).replace(/[^0-9.]/g, ""));
  return Number.isFinite(v) ? v : null;
}
// Revenue estimate, labelled as an estimate in the UI, never a guarantee:
// Assume the site captures 2% (low) to 10% (high) of monthly searches,
// publisher keeps ~68% of the CPC (AdSense publisher share).
export function revenueEstimate(volume, cpc) {
  const c = parseCpc(cpc);
  if (volume == null || c == null || c === 0) return null;
  return { low: Math.round(volume * 0.02 * c * 0.68), high: Math.round(volume * 0.10 * c * 0.68), assumptions: "2–10% of searches captured, 68% of CPC to publisher" };
}

export async function lookupDomain(rawDomain) {
  const domain = registrableDomain(rawDomain);
  if (!domain || !domain.includes(".")) return { domain, status: "unknown", note: "Not a valid domain" };
  // Invalidate old (pre-fix) cache entries that wrongly labelled .mx domains
  // as likely_available from a "No RDAP service" 404 — those must be re-checked.
  const hit = cache[domain];
  if (hit && hit.note && hit.note.includes("No RDAP record") && /\.(mx|com\.mx|org\.mx|gob\.mx)$/.test(domain)) {
    // old buggy entry — fall through and re-check
  } else if (hit && Date.now() - new Date(hit.checkedAt).getTime() < 30 * 24 * 3600 * 1000) {
    return { ...hit, cached: true };
  }
  let rdapStatus = null, registration = null, expiration = null, rdapError = null, rdapServiceUnavailable = false, rdapNotFound = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`https://rdap.org/domain/${domain}`, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" }, signal: ctrl.signal });
    clearTimeout(timer);
    rdapStatus = res.status;
    if (res.ok) {
      const j = await res.json();
      for (const ev of j.events || []) {
        if (ev.eventAction === "registration") registration = ev.eventDate;
        if (ev.eventAction === "expiration") expiration = ev.eventDate;
      }
    } else {
      try {
        const j = await res.json();
        const title = String(j.title || "");
        if (/No RDAP service/i.test(title)) rdapServiceUnavailable = true;
        if (/not found|no such/i.test(title)) rdapNotFound = true;
        rdapError = title.slice(0, 120);
      } catch { /* non-JSON error body */ }
    }
  } catch (e) {
    rdapError = String(e.message || e).slice(0, 120);
  }
  let dnsFound = null;
  // Try A first (NS queries are refused on some networks), then NS.
  for (const fn of [() => dns.resolve4(domain), () => dns.resolveNs(domain)]) {
    try { await fn(); dnsFound = true; break; }
    catch (e) { if (e.code === "ENOTFOUND" || e.code === "ENODATA") dnsFound = false; }
  }
  let status, ageDays = null, young = null, note;
  if (rdapStatus === 200 && registration) {
    status = "registered";
    ageDays = Math.floor((Date.now() - new Date(registration).getTime()) / 86400000);
    young = ageDays < 365;
    note = `Registered ${registration.slice(0, 10)} (${ageDays.toLocaleString()} days old)`;
  } else if (rdapServiceUnavailable) {
    // CRITICAL FIX: .mx (and some other registries) return 404 "No RDAP service
    // is available" for EVERY domain, registered or not. That is NOT "available".
    if (dnsFound === true) {
      status = "registered";
      note = "RDAP not supported for this TLD (.mx etc.) — has DNS, so registered, but age unknown via RDAP";
    } else {
      status = "unknown";
      note = "RDAP not supported for this TLD (.mx etc.) — age/availability cannot be verified via RDAP; check at a registrar";
    }
  } else if (rdapNotFound || (rdapStatus === 404 && !rdapServiceUnavailable)) {
    status = "likely_available";
    note = "RDAP says domain not found — likely available (confirm at a registrar before buying)";
  } else if (rdapStatus == null && dnsFound === false) {
    status = "likely_available";
    note = "No RDAP record and no DNS — likely available (confirm at a registrar before buying)";
  } else if (dnsFound === true) {
    status = "registered";
    note = "Has DNS records, but RDAP did not return a registration date — age unknown";
  } else {
    status = "unknown";
    note = `Could not verify (RDAP ${rdapStatus ?? "no response"}${rdapError ? `, ${rdapError}` : ""}, DNS ${dnsFound}) — try again later`;
  }
  const out = { domain, status, registration, expiration, ageDays, young, dnsFound, checkedAt: new Date().toISOString(), note };
  cache[domain] = out;
  saveCache();
  return out;
}

export async function lookupDomains(domains, max = 10) {
  const uniq = [...new Set((domains || []).map((d) => registrableDomain(d)).filter((d) => d.includes(".")))].slice(0, max);
  const out = [];
  for (const d of uniq) {
    out.push(await lookupDomain(d));
    await sleep(400);
  }
  return out;
}

export function exactMatchDomain(keyword) {
  return String(keyword || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".com";
}
