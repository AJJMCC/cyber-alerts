// Live sources. Names must match the names in scripts/fetch-feeds.mjs.
// A scheduled job saves each feed into feeds/feed.json; this page just reads that file.
const LIVE=[{name:"CISA ICS Advisories"},{name:"ZDI Upcoming"}];
const FEED_FILE="feeds/feed.json";
// Sample sources, kept as placeholders until their real feeds are added.
const SAMPLE_SOURCES=["Sample Wire","Demo Daily","Threat Pastel"];
const SOURCES=[...LIVE.map(l=>l.name),...SAMPLE_SOURCES];
const SAMPLE=[
  {title:"Router firmware flaw lets strangers redecorate your network",src:"Sample Wire",date:"2025-01-14",sev:"critical",tags:["router","firmware","TP-Link"],text:"A remote code execution bug in popular home routers. Update firmware; unplug your router and plug it back in only after patching."},
  {title:"Browser zero-day: your tabs are being nosy",src:"Demo Daily",date:"2025-01-13",sev:"critical",tags:["Chrome","browser","zero-day"],text:"An actively exploited memory bug in a Chromium-based browser. Restart to apply the fix. Yes, you have 43 tabs. Yes, restart anyway."},
  {title:"Windows patch Tuesday brings 70 fixes and zero chill",src:"Sample Wire",date:"2025-01-12",sev:"high",tags:["Windows","patch","Microsoft"],text:"Several privilege escalation bugs addressed across supported Windows versions."},
  {title:"VPN appliance bug opens the front door, back door and cat flap",src:"Threat Pastel",date:"2025-01-11",sev:"critical",tags:["VPN","Cisco","firewall"],text:"Authentication bypass in an enterprise VPN gateway. Admins should patch immediately and review logs."},
  {title:"Smart bulb botnet is, regrettably, a real thing",src:"Demo Daily",date:"2025-01-10",sev:"medium",tags:["IoT","smart home","bulb"],text:"Cheap IoT devices with default passwords are being recruited into a botnet. Change the password."},
  {title:"Linux kernel bug grants root to the very curious",src:"Threat Pastel",date:"2025-01-09",sev:"high",tags:["Linux","kernel","Ubuntu"],text:"Local privilege escalation in a kernel subsystem. Distribution updates are rolling out."},
  {title:"Phishing kit impersonates your password manager (rude)",src:"Sample Wire",date:"2025-01-08",sev:"medium",tags:["phishing","password manager","email"],text:"Fake login pages target password manager users. Check the URL and use hardware keys where possible."},
  {title:"NAS devices ransomed; backups were, allegedly, a myth",src:"Demo Daily",date:"2025-01-07",sev:"high",tags:["NAS","Synology","ransomware","hardware"],text:"Internet-exposed network storage devices hit by ransomware. Disable remote access you don't need."},
  {title:"PDF reader flaw: the document is not just a document",src:"Threat Pastel",date:"2025-01-06",sev:"medium",tags:["Adobe","PDF","Acrobat"],text:"Malicious PDFs can trigger code execution in outdated readers."}
];
let FEED=[...SAMPLE];
const state={}; // per live source: "loading" | "ok" | "error"
LIVE.forEach(l=>state[l.name]="loading");

const COLORS={critical:"var(--pink)",high:"var(--peach)",medium:"var(--sky)"};
const $=id=>document.getElementById(id);
let sev="all",query="";

const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hl=(s,q)=>{
  s=esc(s);
  if(!q)return s;
  const re=new RegExp("("+q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/&/g,"&amp;")+")","gi");
  return s.replace(re,"<mark>$1</mark>");
};

// Severity is guessed from keywords, since RSS has no severity field.
const guessSev=t=>/critical|zero-day|actively exploited|ransomware|remote code/i.test(t)?"critical"
  :/high|severe|vulnerabilit|exploit|patch|update/i.test(t)?"high":"medium";
const safeUrl=u=>/^https?:\/\//i.test(u||"")?u:"#";
const plain=h=>new DOMParser().parseFromString(h||"","text/html").body.textContent.trim().replace(/\s+/g," ");
function mk(src,i){
  const text=plain(i.description),title=plain(i.title),d=new Date(i.pubDate);
  return {title,src,link:safeUrl(i.link),
    date:isNaN(d)?"":d.toISOString().slice(0,10),
    sev:guessSev(title+" "+text),tags:(i.categories||[]).filter(Boolean).slice(0,4),
    text:text.length>240?text.slice(0,237)+"…":text};
}

// Read the saved feed file written by the scheduled job.
let updated="";
async function load(){
  LIVE.forEach(l=>state[l.name]="loading");render();
  let data=null;
  try{
    const r=await fetch(FEED_FILE+"?t="+Date.now(),{cache:"no-store"});
    if(r.ok)data=await r.json();
  }catch(e){/* handled below */}
  updated=data?.updated||"";
  LIVE.forEach(l=>{
    const items=data?.sources?.[l.name];
    FEED=FEED.filter(i=>i.src!==l.name);
    if(Array.isArray(items)&&items.length){
      FEED=[...items.map(i=>mk(l.name,i)),...FEED];state[l.name]="ok";
    }else state[l.name]="error";
  });
  render();
}

function card(i,q){
  return `<article class="item" style="--c:${COLORS[i.sev]}">
      <div class="meta"><span class="sev">${i.sev}</span><time datetime="${i.date}">${i.date}</time></div>
      <h3><a href="${i.link||"#"}"${i.link?' target="_blank" rel="noopener noreferrer"':""}>${hl(i.title,q)}</a></h3>
      <p>${hl(i.text,q)}</p>
      <div class="tags">${i.tags.map(t=>`<span>${hl(t,q)}</span>`).join("")}</div>
    </article>`;
}

function render(){
  const q=query.trim().toLowerCase();
  const terms=q.split(/\s+/).filter(Boolean);
  const list=FEED.filter(i=>(sev==="all"||i.sev===sev)&&
    terms.every(t=>[i.title,i.text,i.src,...i.tags].join(" ").toLowerCase().includes(t)));
  $("feed").innerHTML=SOURCES.map(s=>{
    const items=list.filter(i=>i.src===s);
    const st=state[s];
    const msg=st==="loading"?"Fetching the latest… 🌊"
      :st==="error"?`No saved copy of this feed yet. The scheduled job may not have run. <button type="button" class="retry" data-src="${esc(s)}">Retry</button> 🌴`
      :"Nothing here. Suspiciously quiet. 🌊";
    return `<section class="col" aria-label="${esc(s)}">
      <h2><span>${esc(s)}</span><small>${items.length}</small></h2>
      ${items.map(i=>card(i,q)).join("")||`<p class="none">${msg}</p>`}
    </section>`;
  }).join("");
  $("empty").hidden=list.length>0;
  $("status").textContent=q?`${list.length} match${list.length===1?"":"es"} for “${query.trim()}”`:`${FEED.length} threats on the radar`;
  const u=$("updated"),d=new Date(updated);
  if(u)u.textContent=isNaN(d)?"":`Live feeds last refreshed ${d.toLocaleString()}.`;
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
