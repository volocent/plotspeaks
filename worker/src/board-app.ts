// The Plot Speaks screen as an MCP App (the ui:// extension, SEP-1865): what a host that draws screens shows
// beside the voice game, such as Claude in the chat and Alexa+ on an Echo Show (Ben, 2026-10-22). It is
// read-only and draws only what tools return in their result _meta["plotspeaks/screen"] (index.ts
// screenAfter): the story's cover, the menu's covers, the trivia board (watchView), the story timeline
// (timelineView), a dice roll the players heard, or a wind-down's breathing guide. Those views are the watch
// page's own data, so an unplayed clue, a hidden roll or an answer key can never reach it. Hosts without the
// extension ignore all of this.
export const SCREEN_URI = "ui://plotspeaks/screen";
/** The first URI, from the trivia-only board; still served (the same page) for hosts that cached it. */
export const BOARD_APP_URI = "ui://plotspeaks/trivia-board";
export const BOARD_APP_MIME = "text/html;profile=mcp-app";
export const SCREEN_META_KEY = "plotspeaks/screen";

export const BOARD_APP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plot Speaks</title>
<style>
:root{--navy:#14355D;--navy-2:#1E4A7E;--navy-3:#2A5C96;--tile:#F08A2C;--tile-ink:#1B2B44;--sky:#45B3E7;--ink:#F5EFE5;--muted:#AEBDD0;--ok:#3FBF7F;--warn:#F07A5A}
*{box-sizing:border-box;margin:0}
html,body{background:var(--navy);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{padding:16px;min-height:100vh;display:flex;flex-direction:column}
#app{flex:1;display:flex;flex-direction:column;gap:12px}
.brand{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.brand b{color:var(--ink)}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px}
.hero{display:flex;gap:14px;align-items:center}
.hero img{width:76px;height:76px;border-radius:14px;object-fit:cover;flex:none;background:var(--navy-2)}
.hero.big{flex-direction:column;align-items:flex-start}
.hero.big img{width:100%;height:auto;max-height:46vh;aspect-ratio:1/1;max-width:420px}
.hero.big:has(+.grid) img,.hero.big:has(+.strip) img{max-height:30vh;max-width:260px}
h1{font-size:clamp(18px,4.2vw,30px);font-weight:800;line-height:1.15}
.sub{color:var(--muted);font-size:14px;margin-top:3px}
.grid{display:grid;gap:8px;flex:1;grid-auto-rows:minmax(44px,1fr)}
.cat{font-weight:700;font-size:clamp(11px,2.2vw,15px);text-align:center;line-height:1.2;min-height:2.4em;display:flex;align-items:flex-end;justify-content:center;padding:0 2px}
.cell{display:flex;align-items:center;justify-content:center;background:var(--tile);color:var(--tile-ink);border-radius:10px;font-weight:800;font-size:clamp(14px,3.4vw,24px);text-align:center;padding:clamp(6px,1.6vw,12px) 0}
.cell.played{background:transparent;border:2px dashed rgba(174,189,208,.35);color:transparent}
.cell.open{background:var(--sky);color:#0B2540;outline:3px solid #fff}
.strip{background:var(--navy-2);border-radius:12px;padding:12px 14px;font-size:clamp(14px,2.8vw,19px);line-height:1.35}
.k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px}
.ok{color:var(--ok)}.warn{color:var(--warn)}
.scores{display:flex;gap:8px;flex-wrap:wrap}
.score{background:rgba(255,255,255,.08);border-radius:999px;padding:6px 14px;font-weight:700}
.big-n{font-size:clamp(48px,14vw,120px);font-weight:800;line-height:1;color:var(--tile)}
.tally{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.end{background:var(--tile);color:var(--tile-ink);border-radius:14px;padding:14px 16px}
.end h2{font-size:clamp(18px,4vw,26px)}
.end .scores .score{background:rgba(20,53,93,.15)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.card{background:var(--navy-2);border-radius:12px;overflow:hidden}
.card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--navy-3)}
.card p{padding:8px 10px 2px;font-weight:700;font-size:14px;line-height:1.25}
.card span{display:block;padding:0 10px 10px;color:var(--muted);font-size:12px}
ol.tl{list-style:none;padding:0;display:flex;flex-direction:column;gap:6px}
ol.tl li{background:var(--navy-2);border-radius:10px;padding:10px 12px;border-left:4px solid var(--navy-3);font-size:15px;line-height:1.35}
ol.tl li.ok{border-left-color:var(--ok)}ol.tl li.warn{border-left-color:var(--warn)}
ol.tl li.now{border-left-color:var(--sky);background:var(--navy-3)}
.dice{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0}
.die{width:120px;height:120px;border-radius:22px;background:#fff;color:var(--navy);display:flex;align-items:center;justify-content:center;font-size:56px;font-weight:800;box-shadow:0 10px 26px rgba(0,0,0,.3)}
.die.spin{animation:spin .7s ease-out}
@keyframes spin{0%{transform:rotate(-200deg) scale(.6)}70%{transform:rotate(12deg) scale(1.05)}100%{transform:none}}
.breathe{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;min-height:260px}
.orb{width:180px;height:180px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#7FD0F4,var(--sky) 55%,#2A7FB3);animation:breathe 10s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(.6);opacity:.75}45%,55%{transform:scale(1);opacity:1}}
.cue{font-size:20px;color:var(--muted)}
.empty{color:var(--muted);padding:24px 0;text-align:center}
.pic{margin-top:10px;display:flex;justify-content:center}
.pic svg{width:100%;max-width:420px;max-height:34vh;height:auto;display:block;border-radius:6px}
.stars{display:flex;gap:6px;margin-top:10px}
.stars button{font:inherit;font-size:30px;line-height:1;background:none;border:0;color:var(--tile-ink);opacity:.35;cursor:pointer;padding:2px}
.stars button.on{opacity:1}
.stars button:focus-visible{outline:2px solid #fff;border-radius:6px}
.thanks{margin-top:8px;font-weight:700}
.code{font-weight:800;letter-spacing:.02em}
.watch{display:flex;gap:14px;align-items:center;background:var(--navy-2);border-radius:12px;padding:12px}
.watch .qr{width:112px;height:112px;flex:none;background:#fff;border-radius:8px;padding:4px}
.watch .qr svg{width:100%;height:100%;display:block}
</style></head><body>
<div id="app"><p class="empty">Plot Speaks</p></div>
<script>
(function(){
  var nextId=1, pending={}, breath=null;
  function send(m){ window.parent.postMessage(m,"*"); }
  function request(method,params){ var id=nextId++; send({jsonrpc:"2.0",id:id,method:method,params:params}); return new Promise(function(r){ pending[id]=r; }); }
  function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  function size(){ send({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}}); }
  function img(src){ return src?'<img src="'+esc(src)+'" alt="" onerror="this.style.visibility=\\'hidden\\'" onload="window.psSize&&window.psSize()">':''; }
  function meta(s){ return [s.genre, s.minutes?s.minutes+" min":""].filter(Boolean).join(" · "); }
  function top(right){ return '<div class="top"><span></span><span class="brand"><b>PLOT</b> SPEAKS</span></div>'; }
  function hero(s,big){ if(!s) return ''; return '<div class="hero'+(big?' big':'')+'">'+img(s.cover)+'<div><h1>'+esc(s.title)+'</h1><p class="sub">'+esc(meta(s))+'</p></div></div>'; }
  function trivia(v){
    var h="", cats=v.categories||[];
    if(v.ended){
      var sc='';
      if(v.scores&&v.scores.length){ sc+='<div class="scores" style="margin-top:8px">'; v.scores.forEach(function(s){ sc+='<span class="score">'+esc(s.name)+' '+esc(s.score)+'</span>'; }); sc+='</div>'; }
      h+=endCard(v, v.mode==="streak"?"Streak over":(v.tieWinner?esc(v.tieWinner)+" wins the trivia-off":"Final scores"), sc);
    }
    // A trivia-off (no ties): who is in it, and which question.
    if(v.tie&&v.tie.players) h+='<div class="end"><h2>Trivia-off</h2><p style="margin-top:6px">'+v.tie.players.map(esc).join(" vs ")+' &middot; question '+esc(v.tie.round)+'</p></div>';
    // Quick fire and streaks play with no category or value (the category can hint at the answer), so neither shows.
    var quick=v.mode==="quick"||v.mode==="streak";
    // The clue's picture (a flag, a country's outline) comes from the server as a drawing with no name in it.
    // A clue with a picture goes above the board, so the picture is on screen without scrolling.
    var hasPic=Boolean(v.open&&v.open.image&&/^<svg[\\s>]/.test(v.open.image)), picFirst=hasPic||Boolean(v.tie);
    var openH=v.open?'<div class="strip"><span class="k">Now'+(!quick&&v.open.value?" &middot; "+esc(v.open.category)+" for "+esc(v.open.value):"")+'</span>'+esc(v.open.clue)+(hasPic?'<div class="pic">'+v.open.image+'</div>':'')+'</div>':'';
    if(picFirst) h+=openH;
    if(cats.length){
      var rows=0; cats.forEach(function(c){ rows=Math.max(rows,(c.values||[]).length); });
      h+='<div class="grid" style="grid-template-columns:repeat('+cats.length+',minmax(0,1fr))">';
      cats.forEach(function(c){ h+='<div class="cat">'+esc(c.name)+'</div>'; });
      for(var r=0;r<rows;r++) cats.forEach(function(c){
        var x=(c.values||[])[r]; if(!x){ h+='<div></div>'; return; }
        var open=v.open&&v.open.category===c.name&&v.open.value===x.value;
        h+='<div class="cell'+(x.played?" played":"")+(open?" open":"")+'">'+(x.played?"&nbsp;":esc(x.value))+'</div>';
      });
      h+='</div>';
    } else if(v.mode==="quick"||v.mode==="streak"){
      var right=(v.scores||[]).reduce(function(a,s){return a+(+s.score||0);},0), n=(v.asked||0)+(v.open?1:0);
      h+='<div class="strip tally"><span class="big-n">'+esc(v.mode==="streak"?right:n)+'</span><span>'+(v.mode==="streak"?"in a row":(v.quickMax?"of "+esc(v.quickMax)+" questions":"questions"))+(v.mode==="streak"?"":' &middot; <b class="ok">'+esc(right)+' right</b>')+'</span></div>';
    }
    if(v.open&&!picFirst) h+=openH;
    if(v.last) h+='<div class="strip"><span class="k">Last answer</span>'+(v.last.player&&v.last.player!=="You"?esc(v.last.player)+': ':'')+'<span class="'+(v.last.correct?"ok":"warn")+'">'+(v.last.correct?"right":"not quite")+'</span>. The answer was '+esc(v.last.answer)+'.</div>';
    if(!v.ended&&cats.length&&v.scores&&v.scores.length){ h+='<div class="scores">'; v.scores.forEach(function(s){ h+='<span class="score">'+esc(s.name)+' '+esc(s.score)+'</span>'; }); h+='</div>'; }
    return h;
  }
  function timeline(v){
    var h="";
    var lines=[v.summary,v.party].filter(Boolean);
    if(lines.length) h+='<div class="strip">'+lines.map(esc).join("<br>")+'</div>';
    var ev=v.events||[];
    h+='<ol class="tl">'+ev.map(function(e,i){ return '<li class="'+(e.tone||"")+(i===ev.length-1?" now":"")+'">'+esc(e.label)+'</li>'; }).join("")+'</ol>';
    if(v.thin&&!v.ended) h+='<p class="sub">The narrator holds this one in the conversation; the ending shows here when it comes.</p>';
    if(v.ended) h+=endCard(v, "The end", "");
    return h;
  }
  // The end-of-game card: scores, the head-to-head code, and star ratings to tap (rate_story through the host).
  function endCard(v, heading, inner){
    var h='<div class="end"><h2>'+esc(heading)+'</h2>'+inner;
    if(v.challengeCode) h+='<p style="margin-top:10px">Play this same board against a friend: they say <span class="code">"Plot Speaks, play against code '+esc(v.challengeCode)+'"</span>. It lasts 30 days.</p>';
    if(v.slug&&v.playId){
      h+='<p style="margin-top:10px">How many stars?</p><div class="stars" role="group" aria-label="Rate it">';
      for(var n=1;n<=5;n++) h+='<button type="button" data-star="'+n+'" aria-label="'+n+' star'+(n>1?'s':'')+'">&#9733;</button>';
      h+='</div><p class="thanks" id="thanks" hidden></p>';
    }
    return h+'</div>';
  }
  function watchPanel(w){
    if(!w||!w.code) return '';
    return '<div class="watch">'+(w.qr&&/^<svg[\\s>]/.test(w.qr)?'<div class="qr">'+w.qr+'</div>':'')+'<div><span class="k">Watch along</span>A passenger can follow on a phone: scan this, or go to plotspeaks.com/watch and enter <span class="code">'+esc(w.code)+'</span>.</div></div>';
  }
  var host={};
  function rate(n){
    var v=current; if(!v||!v.slug||!v.playId) return;
    var t=document.getElementById("thanks");
    function done(msg){ if(t){ t.hidden=false; t.textContent=msg; } }
    document.querySelectorAll("[data-star]").forEach(function(b){ b.classList.toggle("on", +b.getAttribute("data-star")<=n); b.disabled=true; });
    var said="I'd rate it "+n+" star"+(n>1?"s":"")+".";
    if(host.serverTools){
      request("tools/call",{name:"rate_story",arguments:{slug:v.slug,play_id:v.playId,stars:n}}).then(function(r){
        if(r&&!r.isError){ done("Thanks: "+n+" star"+(n>1?"s":"")+" recorded.");
          if(host.updateModelContext) request("ui/update-model-context",{content:[{type:"text",text:"The player rated this "+n+" star"+(n>1?"s":"")+" on screen, and it is recorded. Don't ask for a star rating again."}]});
        } else { request("ui/message",{role:"user",content:{type:"text",text:said}}); done("Thanks: sent to your assistant."); }
      });
    } else { request("ui/message",{role:"user",content:{type:"text",text:said}}); done("Thanks: sent to your assistant."); }
  }
  document.addEventListener("click",function(e){ var b=e.target.closest&&e.target.closest("[data-star]"); if(b&&!b.disabled) rate(+b.getAttribute("data-star")); });
  var current=null;
  function picker(v){
    return '<h1>'+esc(v.heading||"Pick a story")+'</h1><div class="cards">'+(v.stories||[]).map(function(s){ return '<div class="card">'+img(s.cover)+'<p>'+esc(s.title)+'</p><span>'+esc(meta(s))+'</span></div>'; }).join("")+'</div><p class="sub">Say the one you want.</p>';
  }
  function dice(v){
    return '<div class="dice">'+(v.why?'<p class="k">'+esc(v.why)+'</p>':'')+'<div class="die spin">'+esc(v.total)+'</div><p class="sub">'+esc(v.dice)+' &middot; '+esc(v.result)+'</p></div>';
  }
  function winddown(){
    return '<div class="breathe"><div class="orb"></div><p class="cue" id="cue">Breathe in</p></div>';
  }
  function draw(v){
    if(!v||typeof v!=="object") return;
    current=v;
    if(breath){ clearInterval(breath); breath=null; }
    var s=v.story||null, h=top();
    if(v.kind==="picker") h+=picker(v);
    else {
      h+=hero(s, v.opening&&v.kind!=="winddown" ? true : false);
      if(v.opening) h+=watchPanel(v.watch);
      if(v.kind==="trivia") h+=trivia(v);
      else if(v.kind==="timeline") h+=timeline(v);
      else if(v.kind==="roll") h+=dice(v);
      else if(v.kind==="winddown") h+=winddown();
    }
    document.getElementById("app").innerHTML=h;
    if(v.kind==="winddown"){ var inn=true; breath=setInterval(function(){ inn=!inn; var c=document.getElementById("cue"); if(c) c.textContent=inn?"Breathe in":"Breathe out"; },5000); }
    size();
  }
  window.psSize=size;
  function fromResult(p){
    if(!p) return null;
    var m=p._meta||{};
    if(m["${SCREEN_META_KEY}"]) return m["${SCREEN_META_KEY}"];
    if(m["plotspeaks/board"]) { var b=m["plotspeaks/board"]; return Object.assign({kind:"trivia",story:{title:b.title}},b); }
    return null;
  }
  window.addEventListener("message",function(e){
    var m=e.data; if(!m||m.jsonrpc!=="2.0") return;
    if(m.id!=null&&pending[m.id]&&("result" in m||"error" in m)){ var f=pending[m.id]; delete pending[m.id]; f(m.result||null); return; }
    if(m.method==="ui/notifications/tool-result") draw(fromResult(m.params));
    if(m.id!=null&&m.method==="ping") send({jsonrpc:"2.0",id:m.id,result:{}});
  });
  request("ui/initialize",{protocolVersion:"2025-06-18",appInfo:{name:"Plot Speaks",version:"2.0.0"},appCapabilities:{availableDisplayModes:["inline","fullscreen"]}})
    .then(function(r){ host=(r&&r.hostCapabilities)||{}; send({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}}); size(); });
  window.psDraw=draw;
})();
</script></body></html>`;
