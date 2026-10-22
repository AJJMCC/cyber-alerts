// Live sources. Names must match the names in scripts/fetch-feeds.mjs.
// A scheduled job saves each feed into feeds/feed.json; this page just reads that file.
const LIVE=["CISA ICS Advisories","CISA Cybersecurity Advisories","CERT/CC Vulnerability Notes","UK NCSC","CERT-EU",
  "Canadian Cyber Centre","CVE.report",
  "cvefeed.io Latest","cvefeed.io High & Critical","Kubernetes CVE Feed","Google News: CVE","ZDI Published",
  "ZDI Upcoming","Exploit-DB","Full Disclosure","Sploitus","VulDB Recent",
  "FortiGuard Outbreak Alerts","FortiGuard Threat Signal",
  "Fortinet PSIRT Advisories","App Control Updates","Antispam Checksum Updates","Antispam URI Updates",
  "Antispam IP Updates","Antivirus Updates","IPS Updates","Web Filtering Updates","FortiWeb Security Updates",
  "Mobile AntiVirus Updates","Endpoint Vulnerability Updates","IP Reputation DB","Botnet Domain Reputation DB",
  "Internet Services DB","OT Security Services","IoT Application Services","OT Application Services",
  "OT IPS Services","Virtual Patching Updates","FortiDAST","Fortinet Firmware Updates"].map(name=>({name}));
const FEED_FILE="feeds/feed.json";
const DAYS=30; // rolling window; keep in step with DAYS in the script
const SOURCES=LIVE.map(l=>l.name);
let FEED=[];
const state={}; // per live source: "loading" | "ok" | "error"
LIVE.forEach(l=>state[l.name]="loading");

const COLORS={critical:"var(--pink)",high:"var(--peach)",medium:"var(--sky)"};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
let sev="all",query="";

// Severity is guessed from keywords, since RSS has no severity field.
const guessSev=t=>/critical|zero-day|actively exploited|ransomware|remote code/i.test(t)?"critical"
  :/high|severe|vulnerabilit|exploit|patch|update/i.test(t)?"high":"medium";
const strip=h=>String(h||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
function mk(src,raw){
  const text=strip(raw.description);
  let d=new Date(raw.pubDate);
  if(isNaN(d))d=new Date(raw.firstSeen); // undated items use the day they were first seen
  return {title:strip(raw.title)||"(untitled)",src,link:raw.link||"#",ts:d.getTime(),
    date:isNaN(d)?"":d.toISOString().slice(0,10),
    sev:guessSev((raw.title||"")+" "+text),tags:(raw.categories||[]).slice(0,4).map(strip),
    text:text.length>240?text.slice(0,237)+"…":text};
}
// Rolling window: hide anything older than DAYS days, even between job runs.
const recent=i=>isNaN(i.ts)||i.ts>=Date.now()-DAYS*864e5;

// Read the saved feed file written by the scheduled job.
let updated="";
async function load(){
  LIVE.forEach(l=>state[l.name]="loading");render();
  let data=null;
  try{const r=await fetch(FEED_FILE+"?t="+Date.now(),{cache:"no-store"});if(r.ok)data=await r.json();}catch(e){}
  updated=data&&data.updated||"";
  LIVE.forEach(l=>{
    const items=data&&data.sources&&data.sources[l.name];
    FEED=FEED.filter(i=>i.src!==l.name);
    if(Array.isArray(items)){ // an empty list is fine: a quiet month
      const ok=items.map(i=>mk(l.name,i)).sort((a,b)=>(b.ts||0)-(a.ts||0));
      FEED=[...ok,...FEED];state[l.name]="ok";
    }else state[l.name]="error";
  });
  render();
}

function hl(text,terms){
  const s=esc(text);
  if(!terms.length)return s;
  return s.replace(new RegExp("("+terms.map(t=>reEsc(esc(t))).join("|")+")","gi"),"<mark>$1</mark>");
}

function card(i,terms){
  return `<article class="item" style="--c:${COLORS[i.sev]||COLORS.medium}">
    <div class="meta"><span class="sev">${i.sev}</span><time datetime="${esc(i.date)}">${esc(i.date)}</time></div>
    <h3><a href="${esc(i.link)}" target="_blank" rel="noopener">${hl(i.title,terms)}</a></h3>
    <p>${hl(i.text,terms)}</p>
    <div class="tags">${i.tags.map(x=>`<span>${hl(x,terms)}</span>`).join("")}</div>
  </article>`;
}

function render(){
  const q=query.trim().toLowerCase();
  const terms=q.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  const pool=FEED.filter(recent);
  const list=pool.filter(i=>(sev==="all"||i.sev===sev)&&
    terms.every(t=>[i.title,i.text,i.src,...i.tags].join(" ").toLowerCase().includes(t)));
  $("feed").innerHTML=SOURCES.map(s=>{
    const items=list.filter(i=>i.src===s);
    const st=state[s];
    let body=items.map(i=>card(i,terms)).join("");
    if(!body){
      body=st==="loading"?`<p class="none">Fetching the latest… 🌊</p>`
        :st==="error"?`<p class="none">No saved copy of this feed yet. <button class="retry" type="button">Retry</button> 🌴</p>`
        :`<p class="none">Nothing in the last ${DAYS} days. Suspiciously quiet. 🌊</p>`;
    }
    return `<section class="col" aria-label="${esc(s)}"><h2><span>${esc(s)}</span><small>${items.length}</small></h2>${body}</section>`;
  }).join("");
  const loading=Object.values(state).includes("loading");
  $("empty").hidden=list.length>0||loading;
  $("status").textContent=q?`${list.length} match${list.length===1?"":"es"} for “${query.trim()}”`:(loading?"":`${pool.length} threats on the radar in the last ${DAYS} days`);
  const u=$("updated"),d=new Date(updated);
  if(u)u.textContent=isNaN(d)?"":`Showing the last ${DAYS} days. Live feeds last refreshed ${d.toLocaleString()}.`;
}

$("searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("q").value;render();});
$("q").addEventListener("input",e=>{query=e.target.value;render();});
$("feed").addEventListener("click",e=>{if(e.target.closest(".retry"))load();});
$("filters").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  sev=b.dataset.sev;
  document.querySelectorAll("#filters button").forEach(x=>x.setAttribute("aria-pressed",x===b));
  render();
});
render();
load();
