// "Last updated X ago" timer. Reads the `updated` value that js/app.js loads from feeds/feed.json.
(function(){
  const el=document.getElementById("ago");
  if(!el)return;
  function ago(ms){
    const m=Math.floor(ms/6e4),h=Math.floor(m/60),d=Math.floor(h/24);
    if(m<1)return "just now";
    if(m<60)return m+(m===1?" minute":" minutes")+" ago";
    if(h<24)return h+(h===1?" hour ":" hours ")+(m%60?(m%60)+" min ":"")+"ago";
    return d+(d===1?" day ":" days ")+(h%24?(h%24)+" h ":"")+"ago";
  }
  function tick(){
    const t=new Date(typeof updated==="string"?updated:"");
    if(isNaN(t)){ // no timestamp saved yet: say so instead of hiding the line
      el.textContent="🕒 Last updated: waiting for the first feed refresh";
      el.title="The scheduled job hasn't written a timestamp to feeds/feed.json yet.";
      el.classList.remove("stale");
      return;
    }
    const ms=Math.max(0,Date.now()-t.getTime());
    el.textContent="🕒 Last updated "+ago(ms);
    el.title=t.toLocaleString();
    el.classList.toggle("stale",ms>6*36e5); // older than 6 hours
  }
  tick();
  setInterval(tick,30000); // refresh the wording every 30 seconds
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)tick();});
  setTimeout(tick,1500);setTimeout(tick,5000); // catch the feed file arriving after page load
})();
