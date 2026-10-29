// Downloads RSS/Atom feeds and saves them to feeds/feed.json for the page to read.
// Run with Node 18+:  node scripts/fetch-feeds.mjs
// No dependencies. Add more feeds to SOURCES (names must match LIVE in js/app.js).
// Rolling window: each run merges new items into the saved ones and drops anything older than DAYS.
// Polite fetching: sends If-None-Match / If-Modified-Since using the validators saved from the last
// run (stored under "validators" in feed.json). A 304 means "unchanged", so we keep the saved items.
// Error isolation: each feed is fetched inside its own try/catch. A dead feed logs a warning, keeps its
// previously saved items, and never stops the other feeds or fails the job.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DAYS = 30;
const TIMEOUT = 20000;   // ms per request
const RETRIES = 2;       // extra attempts after the first, for network errors, 408, 429 and 5xx
const MAX_WAIT = 15000;  // never wait longer than this for a retry (even if Retry-After says so)
const FG = "https://filestore.fortinet.com/fortiguard/rss/";
const SOURCES = [
  { name: "CISA ICS Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/ics-advisories.xml" },
  { name: "CISA Cybersecurity Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/cybersecurity-advisories.xml" },
  { name: "CERT/CC Vulnerability Notes", url: "https://www.kb.cert.org/vuls/atomfeed/" },
  { name: "UK NCSC", url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml" },
  { name: "CERT-EU", url: "https://cert.europa.eu/publications/security-advisories-rss" },
  { name: "Canadian Cyber Centre", url: "https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en" },
  { name: "Microsoft Security Update Guide", url: "https://api.msrc.microsoft.com/update-guide/rss" },
  { name: "Microsoft Security Blog", url: "https://www.microsoft.com/security/blog/category/cybersecurity/feed/" },
  { name: "Hacker News Feed", url: "https://news.ycombinator.com/rss" },
  { name: "CVE.report", url: "https://cve.report/cve.rss" },
  { name: "cvefeed.io Latest", url: "https://cvefeed.io/rssfeed/latest.xml" },
  { name: "cvefeed.io High & Critical", url: "https://cvefeed.io/rssfeed/severity/high.xml" },
  { name: "Kubernetes CVE Feed", url: "https://kubernetes.io/docs/reference/issues-security/official-cve-feed/feed.xml" },
  { name: "Google News: CVE", url: "https://news.google.com/news/rss/search/section/q/CVE%20vulnerability/CVE%20vulnerability?hl=en&gl=US&ned=us" },
  { name: "ZDI Published", url: "https://www.zerodayinitiative.com/rss/published/" },
  { name: "ZDI Upcoming", url: "https://www.zerodayinitiative.com/rss/upcoming/" },
  { name: "Exploit-DB", url: "https://www.exploit-db.com/rss.xml" },
  { name: "Full Disclosure", url: "https://seclists.org/rss/fulldisclosure.rss" },
  { name: "Sploitus", url: "https://sploitus.com/rss" },
  { name: "VulDB Recent", url: "https://vuldb.com/?rss.recent" },
  { name: "FortiGuard Outbreak Alerts", url: FG + "outbreakalert.xml" },
  { name: "FortiGuard Threat Signal", url: FG + "threatsignal.xml" },
  { name: "Fortinet PSIRT Advisories", url: FG + "ir.xml" },
  { name: "App Control Updates", url: FG + "appcontrol.xml" },
  { name: "Antispam Checksum Updates", url: FG + "aschecksum.xml" },
  { name: "Antispam URI Updates", url: FG + "asuri.xml" },
  { name: "Antispam IP Updates", url: FG + "asip.xml" },
  { name: "Antivirus Updates", url: FG + "antivirusdatabase.xml" },
  { name: "IPS Updates", url: FG + "ipsdatabase.xml" },
  { name: "Web Filtering Updates", url: FG + "webfiltering.xml" },
  { name: "FortiWeb Security Updates", url: FG + "websecurity.xml" },
  { name: "Endpoint Vulnerability Updates", url: FG + "epvuln.xml" },
  { name: "IP Reputation DB", url: FG + "irdb.xml" },
  { name: "Botnet Domain Reputation DB", url: FG + "botnetdom.xml" },
  { name: "Virtual Patching Updates", url: FG + "fmwp.xml" },
  { name: "FortiDAST", url: FG + "fortidast.xml" },
  { name: "Fortinet Firmware Updates", url: "https://support.fortinet.com/rss/firmware.xml" },
];
const CONCURRENCY = 4;
const OUT = "feeds/feed.json";
// Browser-style prefix (some sources block unknown agents) plus a friendly note for whoever reads their logs.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 (Thankyou from big frog <3)";
const HEADERS = {
  "User-Agent": UA,
  "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Text of the first matching tag in a chunk; unwraps CDATA, otherwise decodes XML entities.
// `tag` may be several alternatives, e.g. "pubDate|published|updated" (first one found wins).
function field(chunk, tag) {
  for (const t of tag.split("|")) {
    const m = chunk.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, "i"));
    if (!m) continue;
    const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    const v = (cdata ? cdata[1] : decode(m[1])).trim();
    if (v) return v;
  }
  return "";
}

// Atom links are <link href="..."/>; prefer rel="alternate" (or no rel).
function atomLink(chunk) {
  const tags = [...chunk.matchAll(/<link\s[^>]*>/gi)].map((m) => m[0]);
  const pick = tags.find((t) => !/rel=/i.test(t) || /rel=["']alternate["']/i.test(t)) || tags[0];
  const h = pick && pick.match(/href=["']([^"']+)["']/i);
  return h ? decode(h[1]) : "";
}

function parse(xml) {
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  if (!items.length) throw new Error("no <item> or <entry> elements found (got: " + xml.slice(0, 120).replace(/\s+/g, " ") + ")");
  return items.map((it) => ({
    title: field(it, "title"),
    link: field(it, "link") || atomLink(it),
    description: field(it, "description|summary|content"),
    pubDate: field(it, "pubDate|published|updated|dc:date"),
    categories: [...it.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>|<category\s[^>]*term=["']([^"']+)["']/gi)]
      .map((c) => decode((c[1] || c[2] || "").replace(/<!\[CDATA\[|\]\]>/g, "")).trim()).filter(Boolean),
  }));
}

// Item time: its pubDate, or (if missing/unreadable) the day we first saw it.
const stamp = (i) => {
  const t = Date.parse(i.pubDate);
  return isNaN(t) ? Date.parse(i.firstSeen) : t;
};

// Merge fresh items into saved ones (matched by link), then keep only the last DAYS days.
function merge(old = [], fresh) {
  const now = new Date().toISOString();
  const cutoff = Date.now() - DAYS * 864e5;
  const seen = new Map();
  for (const i of old) seen.set(i.link || i.title, { ...i, firstSeen: i.firstSeen || now });
  for (const i of fresh) {
    const k = i.link || i.title;
    seen.set(k, { ...i, firstSeen: seen.get(k)?.firstSeen || now });
  }
  return [...seen.values()]
    .filter((i) => stamp(i) >= cutoff)
    .sort((a, b) => stamp(b) - stamp(a))
    .slice(0, 150);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const why = (e) => (e?.message || String(e)) + (e?.cause ? ` (${e.cause.code || e.cause.message})` : "");

// Seconds or HTTP-date in Retry-After -> milliseconds (0 if absent or unreadable).
function retryAfter(res) {
  const v = res.headers.get("retry-after");
  if (!v) return 0;
  const ms = /^\d+$/.test(v) ? +v * 1000 : Date.parse(v) - Date.now();
  return isNaN(ms) ? 0 : Math.max(0, ms);
}

// Route 1: Node's built-in fetch, with conditional headers when we have validators.
// Returns { notModified: true } on 304, or { xml, validator } on 200.
async function viaFetch(url, v) {
  const headers = { ...HEADERS };
  if (v?.etag) headers["If-None-Match"] = v.etag;
  if (v?.lastModified) headers["If-Modified-Since"] = v.lastModified;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}`);
    e.retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    e.wait = retryAfter(res);
    throw e;
  }
  return {
    xml: await res.text(),
    validator: { etag: res.headers.get("etag") || undefined, lastModified: res.headers.get("last-modified") || undefined },
  };
}
// Route 2 (fallback): curl has a different TLS fingerprint, uses HTTP/2 and follows redirects.
// Always a full download, so it returns no validators.
async function viaCurl(url) {
  const args = ["-sSL", "--compressed", "--max-time", "25", "--fail", "-A", UA];
  for (const [k, val] of Object.entries(HEADERS)) if (k !== "User-Agent") args.push("-H", `${k}: ${val}`);
  const { stdout } = await run("curl", [...args, url], { maxBuffer: 20e6 });
  return { xml: stdout };
}

// Try fetch (with retries and backoff), then curl (same). Returns { items, validator, notModified }.
async function get(name, url, validator) {
  const routes = [["fetch", (u) => viaFetch(u, validator)], ["curl", viaCurl]];
  for (const [label, fn] of routes) {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const r = await fn(url);
        if (r.notModified) return { notModified: true, validator };
        return { items: parse(r.xml), validator: r.validator };
      } catch (e) {
        const last = attempt === RETRIES || e.retryable === false;
        console.error(`  ${name} / ${label} attempt ${attempt + 1}: ${why(e)}${last ? "" : " (retrying)"}`);
        if (last) break; // give up on this route (e.g. 403/404), try the next one
        await sleep(Math.min(MAX_WAIT, e.wait || 1500 * 2 ** attempt) + Math.random() * 1000);
      }
    }
  }
  throw new Error("all routes failed");
}

let previous = { sources: {} };
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

// Start from the saved copy of current sources (removed feeds are dropped), trimmed to the window.
// A feed that fails below simply keeps this saved copy, so its column doesn't vanish from the page.
const sources = {};
const validators = {};
for (const s of SOURCES) {
  try {
    if (previous.sources?.[s.name]) sources[s.name] = merge(previous.sources[s.name], []);
    if (previous.validators?.[s.name]) validators[s.name] = previous.validators[s.name];
  } catch (e) {
    console.error(`::warning::Saved data for ${s.name} was unreadable and was dropped: ${why(e)}`);
  }
}
let ok = 0, unchanged = 0;
const failed = [];
const queue = [...SOURCES];
async function worker() {
  while (queue.length) {
    const s = queue.shift();
    try {
      // Only send validators if we hold a saved copy to fall back on.
      const v = previous.sources?.[s.name] ? previous.validators?.[s.name] : undefined;
      const r = await get(s.name, s.url, v);
      if (r.notModified) {
        ok++; unchanged++;
        console.log(`304  ${s.name}: not modified, ${sources[s.name]?.length ?? 0} kept`);
        continue;
      }
      const merged = merge(previous.sources?.[s.name], r.items);
      // Commit results only after everything for this feed has worked.
      sources[s.name] = merged;
      if (r.validator?.etag || r.validator?.lastModified) validators[s.name] = r.validator;
      else delete validators[s.name];
      ok++;
      console.log(`ok   ${s.name}: ${r.items.length} fetched, ${merged.length} kept from the last ${DAYS} days`);
    } catch (e) {
      // One dead URL must never fail the whole refresh: warn (shows as an annotation in GitHub Actions) and move on.
      failed.push(s.name);
      const kept = sources[s.name]?.length;
      console.error(`::warning title=Feed failed::${s.name}: ${why(e)}${kept ? ` (keeping ${kept} saved items)` : " (no saved items)"}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (ok === 0 && SOURCES.length) {
  // Every feed failed, which usually means a network problem rather than dead feeds. Keep the old file.
  console.error("No feeds fetched; leaving existing file untouched.");
  process.exit(1);
}
// Keep columns in the same order as SOURCES.
const ordered = {};
for (const s of SOURCES) if (sources[s.name]) ordered[s.name] = sources[s.name];
await mkdir("feeds", { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), days: DAYS, validators, sources: ordered }, null, 1));
console.log(`Done: ${ok}/${SOURCES.length} feeds checked (${unchanged} not modified, ${ok - unchanged} downloaded, ${failed.length} failed).`);
if (failed.length) console.log(`Failed feeds: ${failed.join(", ")}`);
