// Downloads RSS/Atom feeds and saves them to feeds/feed.json for the page to read.
// Run with Node 18+:  node scripts/fetch-feeds.mjs
// No dependencies. Add more feeds to SOURCES (names must match LIVE in js/app.js).
// Rolling window: each run merges new items into the saved ones and drops anything older than DAYS.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const DAYS = 30;
const FG = "https://filestore.fortinet.com/fortiguard/rss/";
const SOURCES = [
  { name: "CISA ICS Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/ics-advisories.xml" },
  { name: "CISA Cybersecurity Advisories", url: "https://www.cisa.gov/cybersecurity-advisories/cybersecurity-advisories.xml" },
  { name: "CERT/CC Vulnerability Notes", url: "https://www.kb.cert.org/vuls/atomfeed/" },
  { name: "UK NCSC", url: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml" },
  { name: "CERT-EU", url: "https://cert.europa.eu/publications/security-advisories-rss" },
  { name: "Canadian Cyber Centre", url: "https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en" },
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
  { name: "Mobile AntiVirus Updates", url: FG + "mobile.xml" },
  { name: "Endpoint Vulnerability Updates", url: FG + "epvuln.xml" },
  { name: "IP Reputation DB", url: FG + "irdb.xml" },
  { name: "Botnet Domain Reputation DB", url: FG + "botnetdom.xml" },
  { name: "Internet Services DB", url: FG + "isdb.xml" },
  { name: "OT Security Services", url: FG + "indsec.xml" },
  { name: "IoT Application Services", url: FG + "iotapp.xml" },
  { name: "OT Application Services", url: FG + "otapp.xml" },
  { name: "OT IPS Services", url: FG + "otips.xml" },
  { name: "Virtual Patching Updates", url: FG + "fmwp.xml" },
  { name: "FortiDAST", url: FG + "fortidast.xml" },
  { name: "Fortinet Firmware Updates", url: "https://support.fortinet.com/rss/firmware.xml" },
];
const CONCURRENCY = 4;
const OUT = "feeds/feed.json";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
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
const why = (e) => e.message + (e.cause ? ` (${e.cause.code || e.cause.message})` : "");

// Route 1: Node's built-in fetch.
async function viaFetch(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
// Route 2: curl (different TLS fingerprint, HTTP/2, follows redirects).
async function viaCurl(url) {
  const args = ["-sSL", "--compressed", "--max-time", "25", "--fail", "-A", UA];
  for (const [k, v] of Object.entries(HEADERS)) if (k !== "User-Agent") args.push("-H", `${k}: ${v}`);
  const { stdout } = await run("curl", [...args, url], { maxBuffer: 20e6 });
  return stdout;
}

async function get(name, url) {
  const routes = [["fetch", viaFetch], ["curl", viaCurl]];
  for (let round = 0; round < 2; round++) {
    for (const [label, fn] of routes) {
      try { return parse(await fn(url)); }
      catch (e) { console.error(`  ${name} / ${label} attempt ${round + 1}: ${why(e)}`); }
      await sleep(2000 + Math.random() * 2000); // human-ish pacing
    }
  }
  throw new Error("all routes failed");
}

let previous = { sources: {} };
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

// Start from the saved copy of current sources (removed feeds are dropped), trimmed to the window.
const sources = {};
for (const s of SOURCES) if (previous.sources?.[s.name]) sources[s.name] = merge(previous.sources[s.name], []);
let ok = 0;
const queue = [...SOURCES];
async function worker() {
  while (queue.length) {
    const s = queue.shift();
    try {
      const fresh = await get(s.name, s.url);
      sources[s.name] = merge(previous.sources?.[s.name], fresh);
      ok++;
      console.log(`ok   ${s.name}: ${fresh.length} fetched, ${sources[s.name].length} kept from the last ${DAYS} days`);
    } catch (e) {
      console.error(`FAIL ${s.name}: ${why(e)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (ok === 0 && SOURCES.length) {
  console.error("No feeds fetched; leaving existing file untouched.");
  process.exit(1);
}
// Keep columns in the same order as SOURCES.
const ordered = {};
for (const s of SOURCES) if (sources[s.name]) ordered[s.name] = sources[s.name];
await mkdir("feeds", { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), days: DAYS, sources: ordered }, null, 1));
console.log(`Done: ${ok}/${SOURCES.length} feeds fetched.`);
