// Live sources. Names must match the names in scripts/fetch-feeds.mjs.
// A scheduled job saves each feed into feeds/feed.json; this page just reads that file.
const LIVE=[
 ["CISA ICS Advisories","US advisories for industrial control systems. Factories, pipes and power."],
 ["CISA Cybersecurity Advisories","The US government's general security alerts and advisories."],
 ["CERT/CC Vulnerability Notes","Carnegie Mellon's coordinated vulnerability write-ups."],
 ["UK NCSC","Alerts and guidance from the UK's National Cyber Security Centre."],
 ["CERT-EU","Security advisories from the EU institutions' response team."],
 ["Canadian Cyber Centre","Alerts and advisories from Canada. Very polite, still alarming."],
 ["CVE.report","A firehose of freshly published CVE entries."],
 ["cvefeed.io Latest","The newest CVEs, as soon as they're published."],
 ["cvefeed.io High & Critical","Only the high and critical CVEs. No small talk."],
 ["Kubernetes CVE Feed","Official CVEs for Kubernetes. For anyone running containers."],
 ["Google News: CVE","News headlines about CVEs and vulnerabilities."],
 ["ZDI Published","Zero Day Initiative advisories that are now public."],
 ["ZDI Upcoming","ZDI advisories still waiting for their big reveal."],
 ["Exploit-DB","Newly published public exploits. Handle with oven gloves."],
 ["Full Disclosure","The famously chatty security mailing list."],
 ["Sploitus","Exploit and vulnerability search results, served fresh."],
 ["VulDB Recent","Recent entries from the VulDB vulnerability database."],
 ["FortiGuard Outbreak Alerts","Fortinet's alerts for fast-moving threats."],
 ["FortiGuard Threat Signal","Fortinet's short threat briefings."],
 ["Fortinet PSIRT Advisories","Security advisories for Fortinet's own products."],
 ["App Control Updates","Application control signature updates."],
 ["Antispam Checksum Updates","Antispam checksum database updates."],
 ["Antispam URI Updates","Antispam URI database updates."],
 ["Antispam IP Updates","Antispam IP database updates."],
 ["Antivirus Updates","Antivirus signature database updates."],
 ["IPS Updates","Intrusion prevention signature updates."],
 ["Web Filtering Updates","Web filtering service updates."],
 ["FortiWeb Security Updates","FortiWeb application security updates."],
 ["Mobile AntiVirus Updates","Mobile antivirus service updates."],
 ["Endpoint Vulnerability Updates","Endpoint vulnerability signature updates."],
 ["IP Reputation DB","Updates to the IP reputation database."],
 ["Botnet Domain Reputation DB","Updates to the botnet domain reputation database."],
 ["Internet Services DB","Updates to the internet services database."],
 ["OT Security Services","Operational technology security service updates."],
 ["IoT Application Services","IoT application signature updates."],
 ["OT Application Services","OT application signature updates."],
 ["OT IPS Services","OT intrusion prevention updates."],
 ["Virtual Patching Updates","FortiGuard virtual patching service updates."],
 ["FortiDAST","Dynamic application security testing updates."],
 ["Fortinet Firmware Updates","New firmware releases for Fortinet products."]
].map(([name,desc])=>({name,desc}));
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
let sev="all",query="",openSrc=null;

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

// Body of the pop-up window for one source.
function dialogBody(s,items,terms){
  if(items.length)return items.map(i=>card(i,terms)).join("");
  const st=state[s];
  return st==="loading"?`<p class="none">Fetching the latest… 🌊</p>`
    :st==="error"?`<p class="none">No saved copy of this feed yet. <button class="retry" type="button">Retry</button> 🌴</p>`
    :FEED.some(i=>i.src===s&&recent(i))?`<p class="none">Nothing here matches your search or filter. 🌊</p>`
    :`<p class="none">Nothing in the last ${DAYS} days. Suspiciously quiet. 🌊</p>`;
}

function render(){
  const q=query.trim().toLowerCase();
  const terms=q.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  const pool=FEED.filter(recent);
  const list=pool.filter(i=>(sev==="all"||i.sev===sev)&&
    terms.every(t=>[i.title,i.text,i.src,...i.tags].join(" ").toLowerCase().includes(t)));
  const filtering=!!q||sev!=="all";
  let shown=0;
  $("feed").innerHTML=LIVE.map(l=>{
    const n=list.filter(i=>i.src===l.name).length,st=state[l.name];
    if(filtering&&!n&&st==="ok")return ""; // while searching, only show sources with matches
    shown++;
    const badge=st==="loading"?"…":st==="error"?"—":n;
    return `<button type="button" class="tile${st==="error"?" off":""}" data-src="${esc(l.name)}" aria-haspopup="dialog">
      <span class="th"><span>${esc(l.name)}</span><small>${badge}</small></span>
      <span class="td">${esc(l.desc)}</span>
      <span class="go">${st==="error"?"No saved copy yet":"Open feed ▸"}</span></button>`;
  }).join("");
  if(openSrc){
    const l=LIVE.find(x=>x.name===openSrc),items=list.filter(i=>i.src===openSrc);
    $("dtitle").textContent=l.name;$("ddesc").textContent=l.desc;
    $("dcount").textContent=items.length+(items.length===1?" item":" items");
    $("dgrid").innerHTML=dialogBody(openSrc,items,terms);
  }
  const loading=Object.values(state).includes("loading");
  $("empty").hidden=list.length>0||loading;
  $("status").textContent=q?`${list.length} match${list.length===1?"":"es"} for “${query.trim()}” in ${shown} feed${shown===1?"":"s"}`:(loading?"":`${pool.length} threats on the radar in the last ${DAYS} days`);
  const u=$("updated"),d=new Date(updated);
  if(u)u.textContent=isNaN(d)?"":`Showing the last ${DAYS} days. Live feeds last refreshed ${d.toLocaleString()}.`;
}

function openFeed(s){openSrc=s;render();const d=$("dlg");if(!d.open)d.showModal();$("dgrid").scrollTop=0;}

$("searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("q").value;render();});
$("q").addEventListener("input",e=>{query=e.target.value;render();});
$("feed").addEventListener("click",e=>{const t=e.target.closest(".tile");if(t)openFeed(t.dataset.src);});
$("dlg").addEventListener("click",e=>{
  if(e.target.closest(".retry"))return load();
  if(e.target===$("dlg")||e.target.closest("#dclose"))$("dlg").close(); // backdrop or close button
});
$("dlg").addEventListener("close",()=>{openSrc=null;});
$("filters").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b)return;
  sev=b.dataset.sev;
  document.querySelectorAll("#filters button").forEach(x=>x.setAttribute("aria-pressed",x===b));
  render();
});
render();
load();
