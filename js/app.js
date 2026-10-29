// Live sources. Names must match the names in scripts/fetch-feeds.mjs.
// A scheduled job saves each feed into feeds/feed.json; this page just reads that file.
const LIVE=[
 ["CISA ICS Advisories","US advisories for industrial control systems. Factories, pipes and power."],
 ["CISA Cybersecurity Advisories","The US government's general security alerts and advisories."],
 ["CERT/CC Vulnerability Notes","Carnegie Mellon's coordinated vulnerability write-ups."],
 ["UK NCSC","Alerts and guidance from the UK's National Cyber Security Centre."],
 ["CERT-EU","Security advisories from the EU institutions' response team."],
 ["Canadian Cyber Centre","Alerts and advisories from Canada. Very polite, still alarming."],
 ["Microsoft Security Update Guide","Microsoft's official patch and vulnerability list. Patch Tuesday, all month."],
 ["Microsoft Security Blog","Microsoft's cybersecurity blog posts, threat research and guidance."],
 ["Hacker News Feed","The Hacker News front page. Tech chatter, hot takes and the odd breach."],
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
 ["Endpoint Vulnerability Updates","Endpoint vulnerability signature updates."],
 ["IP Reputation DB","Updates to the IP reputation database."],
 ["Botnet Domain Reputation DB","Updates to the botnet domain reputation database."],
 ["Virtual Patching Updates","FortiGuard virtual patching service updates."],
 ["FortiDAST","Dynamic application security testing updates."],
 ["Fortinet Firmware Updates","New firmware releases for Fortinet products."]
].map(([name,desc])=>({name,desc}));
const FEED_FILE="feeds/feed.json";
const DAYS=30; // rolling window; keep in step with DAYS in the script
let FEED=[];
const state={}; // per live source: "loading" | "ok" | "error"
LIVE.forEach(l=>state[l.name]="loading");

const COLORS={critical:"var(--pink)",high:"var(--peach)",medium:"var(--sky)"};
const RANK={critical:0,high:1,medium:2};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
let query="",openSrc=null,sortBy="date"; // sortBy: "date" (default) | "sev"

// Severity is guessed from keywords (shown as a badge only), since RSS has no severity field.
const guessSev=t=>/critical|zero-day|actively exploited|ransomware|remote code/i.test(t)?"critical"
  :/high|severe|vulnerabilit|exploit|patch|update/i.test(t)?"high":"medium";

// Auto-tagging: keyword rules run on the title and summary. Add a line to add a tag: [label, pattern].
const TOPICS=[
 ["ransomware",/ransomware|lockbit|blackcat|alphv|akira|\bclop\b|extortion/],
 ["zero-day",/zero[- ]?day|0-day|actively exploited|exploited in the wild|in the wild/],
 ["phishing",/phish|smishing|vishing|business email compromise|\bBEC\b|credential harvest/],
 ["supply chain",/supply[- ]chain|typosquat|dependency confusion|malicious (npm|pypi|packages?)|compromised package/],
 ["cloud",/\b(cloud|aws|azure|gcp|saas|kubernetes|k8s|s3 bucket)\b/],
 ["RCE",/remote code execution|\brce\b/],
 ["privilege escalation",/privilege escalation|elevation of privilege|\blpe\b/],
 ["DoS",/denial[- ]of[- ]service|\bd?dos\b/],
 ["data breach",/data breach|\bbreach(ed|es)?\b|data leak|leaked|stolen data/],
 ["malware",/malware|trojan|botnet|backdoor|infostealer|stealer|spyware|rootkit/],
 ["ICS/OT",/\bics\b|\bscada\b|\bplc\b|industrial control|operational technology/]
];
const VENDORS=[
 ["Microsoft",/microsoft|windows|exchange server|sharepoint|\bazure\b|\boffice 365\b/],
 ["Cisco",/\bcisco\b/],["Fortinet",/fortinet|fortigate|fortios|fortiweb|fortimanager/],
 ["Palo Alto",/palo alto|pan-os|globalprotect/],["Ivanti",/ivanti/],["Citrix",/citrix|netscaler/],
 ["Google",/\bgoogle\b|chrome|chromium|android/],["Apple",/\bapple\b|\bios\b|macos|safari/],
 ["Adobe",/\badobe\b|acrobat/],["Oracle",/\boracle\b/],["VMware",/vmware|esxi|vcenter/],
 ["Linux",/\blinux\b|kernel/],["Kubernetes",/kubernetes|\bk8s\b/],["SAP",/\bsap\b/],
 ["Atlassian",/atlassian|confluence|jira/],["Siemens",/siemens/],["WordPress",/wordpress/],
 ["Apache",/\bapache\b/],["Juniper",/juniper/],["SonicWall",/sonicwall/],["Zyxel",/zyxel/]
];
const autoTags=t=>{
  const pick=(rules,k,n)=>rules.filter(([,re])=>re.test(t)).slice(0,n).map(([l])=>({l,k}));
  return [...pick(TOPICS,"topic",3),...pick(VENDORS,"vendor",2)];
};

const strip=h=>String(h||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
function mk(src,raw){
  const text=strip(raw.description),title=strip(raw.title);
  let d=new Date(raw.pubDate);
  if(isNaN(d))d=new Date(raw.firstSeen); // undated items use the day they were first seen
  const tags=autoTags((title+" "+text).toLowerCase());
  const have=new Set(tags.map(x=>x.l.toLowerCase()));
  for(const c of (raw.categories||[]).map(strip)){ // the feed's own categories fill the rest
    if(c&&tags.length<7&&!have.has(c.toLowerCase())){have.add(c.toLowerCase());tags.push({l:c,k:"cat"});}
  }
  return {title:title||"(untitled)",src,link:raw.link||"#",ts:d.getTime(),
    date:isNaN(d)?"":d.toISOString().slice(0,10),
    sev:guessSev((raw.title||"")+" "+text),tags,
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
    <div class="tags">${i.tags.map(x=>`<button type="button" class="tag k-${x.k}" data-tag="${esc(x.l)}" title="Search for ${esc(x.l)}">${hl(x.l,terms)}</button>`).join("")}</div>
  </article>`;
}

// Body of the pop-up window for one source.
function dialogBody(s,items,terms){
  if(items.length)return items.map(i=>card(i,terms)).join("");
  const st=state[s];
  return st==="loading"?`<p class="none">Fetching the latest… 🌊</p>`
    :st==="error"?`<p class="none">No saved copy of this feed yet. <button class="retry" type="button">Retry</button> 🌴</p>`
    :FEED.some(i=>i.src===s&&recent(i))?`<p class="none">Nothing here matches your search. 🌊</p>`
    :`<p class="none">Nothing in the last ${DAYS} days. Suspiciously quiet. 🌊</p>`;
}

// Date: newest first. Severity: critical first, newest first within each level.
const sorter=()=>sortBy==="sev"
  ?(a,b)=>(RANK[a.sev]-RANK[b.sev])||((b.ts||0)-(a.ts||0))
  :(a,b)=>(b.ts||0)-(a.ts||0);

function render(){
  const q=query.trim().toLowerCase();
  const terms=q.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
  const pool=FEED.filter(recent);
  const list=pool.filter(i=>terms.every(t=>[i.title,i.text,i.src,...i.tags.map(x=>x.l)].join(" ").toLowerCase().includes(t)));
  let shown=0;
  $("feed").innerHTML=LIVE.map(l=>{
    const n=list.filter(i=>i.src===l.name).length,st=state[l.name];
    if(q&&!n&&st==="ok")return ""; // while searching, only show sources with matches
    shown++;
    const badge=st==="loading"?"…":st==="error"?"—":n;
    return `<button type="button" class="tile${st==="error"?" off":""}" data-src="${esc(l.name)}" aria-haspopup="dialog">
      <span class="th"><span>${esc(l.name)}</span><small>${badge}</small></span>
      <span class="td">${esc(l.desc)}</span>
      <span class="go">${st==="error"?"No saved copy yet":"Open feed ▸"}</span></button>`;
  }).join("");
  if(openSrc){
    const l=LIVE.find(x=>x.name===openSrc),items=list.filter(i=>i.src===openSrc).sort(sorter());
    $("dtitle").textContent=l.name;$("ddesc").textContent=l.desc;
    $("dcount").textContent=items.length+(items.length===1?" item":" items");
    document.querySelectorAll(".sortbtn").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.sort===sortBy)));
    $("dgrid").innerHTML=dialogBody(openSrc,items,terms);
  }
  const loading=Object.values(state).includes("loading");
  $("empty").hidden=list.length>0||loading;
  $("status").textContent=q?`${list.length} match${list.length===1?"":"es"} for “${query.trim()}” in ${shown} feed${shown===1?"":"s"}`:(loading?"":`${pool.length} threats on the radar in the last ${DAYS} days`);
  const u=$("updated"),d=new Date(updated);
  if(u)u.textContent=isNaN(d)?"":`Showing the last ${DAYS} days. Live feeds last refreshed ${d.toLocaleString()}.`;
}

function openFeed(s){openSrc=s;sortBy="date";render();const d=$("dlg");if(!d.open)d.showModal();$("dgrid").scrollTop=0;}

// Search is automatic as you type; Enter just keeps the form from reloading the page.
$("searchForm").addEventListener("submit",e=>{e.preventDefault();query=$("q").value;render();});
$("q").addEventListener("input",e=>{query=e.target.value;render();});
$("feed").addEventListener("click",e=>{const t=e.target.closest(".tile");if(t)openFeed(t.dataset.src);});
$("dlg").addEventListener("click",e=>{
  if(e.target.closest(".retry"))return load();
  const tg=e.target.closest(".tag"); // clicking a tag searches for it
  if(tg){query=tg.dataset.tag;$("q").value=query;render();$("dgrid").scrollTop=0;return;}
  const sb=e.target.closest(".sortbtn");
  if(sb){sortBy=sb.dataset.sort;render();$("dgrid").scrollTop=0;return;}
  if(e.target===$("dlg")||e.target.closest("#dclose"))$("dlg").close(); // backdrop or close button
});
$("dlg").addEventListener("close",()=>{openSrc=null;});

// "How search works" overlay
$("infoBtn").addEventListener("click",()=>$("idlg").showModal());
$("idlg").addEventListener("click",e=>{
  if(e.target===$("idlg")||e.target.closest("#iclose"))$("idlg").close();
});
render();
load();
