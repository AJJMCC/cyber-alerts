// Downloads RSS feeds and saves them to feeds/feed.json for the page to read.
// Run with Node 18+:  node scripts/fetch-feeds.mjs
// No dependencies. Add more feeds to SOURCES (names must match LIVE in js/app.js).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SOURCES = [
  { name: "ACSC Alerts", url: "https://www.cyber.gov.au/rss/alerts" },
];
const OUT = "feeds/feed.json";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  "Accept-Language": "en-AU,en;q=0.9",
};

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// Text of the first <tag> in a chunk; unwraps CDATA, otherwise decodes XML entities.
function field(chunk, tag) {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decode(m[1])).trim();
}

function parse(xml) {
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  if (!items.length) throw new Error("no <item> elements found (got: " + xml.slice(0, 120).replace(/\s+/g, " ") + ")");
  return items.slice(0, 30).map((it) => ({
    title: field(it, "title"),
    link: field(it, "link"),
    description: field(it, "description"),
    pubDate: field(it, "pubDate"),
    categories: [...it.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((c) => decode(c[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim()).filter(Boolean),
  }));
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

async function get(url) {
  const routes = [["fetch", viaFetch], ["curl", viaCurl]];
  for (let round = 0; round < 2; round++) {
    for (const [label, fn] of routes) {
      try { return parse(await fn(url)); }
      catch (e) { console.error(`  ${label} attempt ${round + 1}: ${why(e)}`); }
      await sleep(2000 + Math.random() * 2000); // human-ish pacing
    }
  }
  throw new Error("all routes failed");
}

let previous = { sources: {} };
try { previous = JSON.parse(await readFile(OUT, "utf8")); } catch {}

const sources = { ...previous.sources }; // keep the last good copy if a fetch fails
let ok = 0;
for (const s of SOURCES) {
  console.log(`Fetching ${s.name}`);
  try {
    sources[s.name] = await get(s.url);
    ok++;
    console.log(`ok   ${s.name}: ${sources[s.name].length} items`);
  } catch (e) {
    console.error(`FAIL ${s.name}: ${why(e)}`);
  }
}

if (ok === 0 && SOURCES.length) {
  console.error("No feeds fetched; leaving existing file untouched.");
  process.exit(1);
}
await mkdir("feeds", { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), sources }, null, 1));
