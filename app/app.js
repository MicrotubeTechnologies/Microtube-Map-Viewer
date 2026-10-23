(function(){
  const BR = {hexr:'hexr', flexr:'flexr', aris:'aris'};
  const BRANCH_ANGLE = {hexr:180, flexr:90, aris:0};
  const SPARE_ANGLES = [270, 225, 315, 135, 45];      // degrees, screen coords (90 = down)
  const DEFAULT_VMSG = 'Videos of any length are compressed when you add them. Pictures are resized to 2000 px.';
  let db=null, assets=null, canEdit=false;
  let nodes = {};            // id -> data from the store
  let pos = {};              // id -> {x,y} centre, effective
  let openId = null;
  let view = {x:0, y:0, k:1};
  let fitted = false;
  let dragging = null;       // active node drag
  let pendingRender = false;
  let selected = null, editing = null, connecting = null, pendingEdit = null;
  let xlinks = {}, selLink = null, knobDrag = null;
  const els = {};            // id -> node element
  const $ = id => document.getElementById(id);
  const vp=$('vp'), world=$('world'), links=$('links');
  const el = (tag, cls, text) => { const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; };

  /* ---------- language: English or Simplified Chinese. Product names stay in English. ---------- */
  // Interface text a viewer sees. Editor-only tools stay in English.
  const ZH={ 'Media':'媒体', 'Available on':'适用平台', 'Loading the map':'正在加载地图', 'Opening your project.':'正在打开项目。',
    'Zoom in':'放大', 'Zoom out':'缩小', 'Fit map to screen':'适应屏幕', 'Close panel':'关闭面板', 'Close player':'关闭播放器',
    'Previous video':'上一个', 'Next video':'下一个', 'Company':'公司', 'Category':'类别', 'Item':'项目', 'Untitled':'未命名',
    'No media yet.':'暂无媒体。', 'Video':'视频', 'Picture':'图片', 'Link':'链接', 'Expand':'全屏', 'Play':'播放', 'Open':'打开',
    'This opens in your web browser.':'将在浏览器中打开。', 'Open link':'打开链接', 'Published':'发布于', 'Switch language':'切换语言',
    'Drag to move around · scroll or pinch to zoom · tap a card for details · tap a thumbnail to play':'拖动以移动 · 滚动或双指缩放 · 点击卡片查看详情 · 点击缩略图播放',
    'Drag the background to move around · scroll or pinch to zoom · drag cards to rearrange · click a card for tools · double-click to edit text':'拖动背景移动 · 滚动或双指缩放 · 拖动卡片重新排列 · 点击卡片打开工具 · 双击编辑文字' };
  // Common status tags, kickers and connector labels, so they don't need translating card by card.
  const ZH_WORDS={ 'hardware':'硬件', 'software':'软件', 'live':'已上线', 'demo':'演示', 'built':'已完成', 'in dev':'开发中', 'grant':'资助项目',
    'custom':'定制', 'tool':'工具', 'patent':'专利', 'r&d':'研发', 'external':'外部合作', 'proof of concept':'概念验证', 'concept':'概念',
    'not developed':'未开发', 'paused':'已暂停', 'on hold':'搁置', 'delayed':'延期', 'uses':'使用', 'backend connected':'后端连接' };
  let lang='en';
  try{ lang=localStorage.getItem('mapLang') || ''; }catch(e){}
  if(lang!=='en' && lang!=='zh') lang = /^zh/i.test(navigator.language||'') ? 'zh' : 'en';
  const ui = s => (lang==='zh' && ZH[s]) || s;
  const word = s => (lang==='zh' && s && ZH_WORDS[String(s).trim().toLowerCase()]) || s;
  // A card's text in the current language: its own Chinese version, else a known word, else the English.
  function tx(id, f){
    const d=nodes[id]; if(!d) return '';
    const en = f==='kicker' ? (d.kicker==null ? 'Hardware' : d.kicker) : (d[f]||'');
    if(lang!=='zh') return en;
    const z=d.zh && d.zh[f]; if(z) return z;
    return f==='tag'||f==='kicker' ? word(en) : en;
  }
  function counts(nV,nI,nL){
    const p=[];
    if(lang==='zh'){ if(nV) p.push(nV+' 个视频'); if(nI) p.push(nI+' 张图片'); if(nL) p.push(nL+' 个链接'); }
    else { if(nV) p.push(nV===1?'1 video':nV+' videos'); if(nI) p.push(nI===1?'1 picture':nI+' pictures'); if(nL) p.push(nL===1?'1 link':nL+' links'); }
    return p.join(' · ');
  }

  /* ---------- data helpers ---------- */
  function kids(pid){ return Object.keys(nodes).filter(id=>nodes[id].parent===pid).sort((a,b)=>(nodes[a].order??0)-(nodes[b].order??0)); }
  function topOf(id){ let cur=id, g=0; while(cur && g++<30){ if(nodes[cur]?.parent==='microtube') return cur; cur=nodes[cur]?.parent; } return null; }
  function branchOf(id){ const c=nodes[id]?.color; if(c&&c!=='auto') return c==='silver'?'other':c; const t=topOf(id); return BR[t] || BR[nodes[t]?.family] || 'other'; }
  function themeOf(id){ const t=topOf(id); return BR[t] || BR[nodes[t]?.family] || 'other'; }
  function kindOf(id){ if(id==='microtube') return 'root'; if(nodes[id]?.parent==='microtube') return 'branch'; return kids(id).length ? 'group' : 'card'; }
  function videos(id){ return Array.isArray(nodes[id]?.videos) ? nodes[id].videos : []; }
  let mediaBase='';
  function mediaUrl(rel){ return mediaBase + String(rel||'').split('/').map(encodeURIComponent).join('/'); }
  function fileUrl(v){ return mediaUrl(v.file); }
  function safeLink(u){ try{ const x=new URL(u); return (x.protocol==='https:'||x.protocol==='http:')? x.href : null; }catch(e){ return null; } }
  function descendants(id){ const out=[]; const st=[id]; while(st.length){ const c=st.pop(); kids(c).forEach(k=>{ out.push(k); st.push(k); }); } return out; }
  function hasSaved(id){ const d=nodes[id]; return d && typeof d.x==='number' && typeof d.y==='number'; }

  /* ---------- automatic radial layout ---------- */
  function leaves(id){ const ks=kids(id); return ks.length ? ks.reduce((a,k)=>a+leaves(k),0) : 1; }
  function autoLayout(){
    const out={};
    if(!nodes.microtube) return out;
    out.microtube={x:0,y:0};
    const R=[0, 540, 430, 370, 330];
    function placeKids(id, angleDeg, depth, span){
      const ks=kids(id); if(!ks.length) return;
      const w=ks.map(leaves); const total=w.reduce((a,b)=>a+b,0);
      const maxStep = depth===1 ? 36 : 32;
      const useSpan = total>1 ? Math.min(span, maxStep * total) : 0;
      const start = angleDeg - useSpan/2; let acc=0;
      ks.forEach((k,i)=>{
        const share = total>1 ? (w[i]/total)*useSpan : 0;
        const ang = total>1 ? start + acc + share/2 : angleDeg;
        acc += share;
        const rad = ang*Math.PI/180, r = R[Math.min(depth+1,R.length-1)];
        out[k]={x: out[id].x + Math.cos(rad)*r, y: out[id].y + Math.sin(rad)*r};
        placeKids(k, ang, depth+1, Math.max(40, (w[i]/total)*useSpan + 30));
      });
    }
    const bs=kids('microtube');
    bs.forEach((b,i)=>{
      const ang = BRANCH_ANGLE[b] ?? SPARE_ANGLES[bs.filter(x=>!(x in BRANCH_ANGLE)).indexOf(b) % SPARE_ANGLES.length];
      const rad=ang*Math.PI/180;
      out[b]={x:Math.cos(rad)*R[1], y:Math.sin(rad)*R[1]};
      placeKids(b, ang, 1, 150);
    });
    // anything unattached: park it below
    let ox=-600; Object.keys(nodes).forEach(id=>{ if(!out[id]){ out[id]={x:ox, y:1300}; ox+=280; } });
    return out;
  }
  function computePositions(){
    const auto=autoLayout(); const next={};
    Object.keys(nodes).forEach(id=>{ next[id] = hasSaved(id) ? {x:nodes[id].x, y:nodes[id].y} : auto[id]; });
    if(dragging){ dragging.ids.forEach(id=>{ if(pos[id]) next[id]=pos[id]; }); }
    pos=next;
  }

  /* ---------- rendering ---------- */
  function playIcon(){ const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('width','18'); s.setAttribute('height','18'); s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('aria-hidden','true'); const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d','M8 5v14l11-7z'); p.setAttribute('fill','currentColor'); s.appendChild(p); return s; }
  function vidStrip(id){
    const vs=videos(id); if(!vs.length) return null;
    const wrap=el('div','vids');
    const visual=vs.find(v=>v.kind==='file'&&v.poster) || vs.find(v=>v.kind==='image');
    if(visual){ const th=el('div','thumb'); const im=document.createElement('img'); im.src = visual.kind==='image' ? fileUrl(visual) : mediaUrl(visual.poster); im.alt=''; im.loading='lazy'; im.draggable=false; th.appendChild(im);
      if(visual.kind==='file'){ const pl=el('div','play'); pl.appendChild(playIcon()); th.appendChild(pl); } wrap.appendChild(th); }
    const nV=vs.filter(v=>v.kind==='file').length, nI=vs.filter(v=>v.kind==='image').length, nL=vs.filter(v=>v.kind==='link').length;
    const vc=el('span','vcount'); vc.appendChild(playIcon()); vc.appendChild(document.createTextNode(counts(nV,nI,nL)));
    wrap.appendChild(vc); wrap.dataset.play='1'; wrap.title = ui(nV ? 'Play' : 'Open');
    return wrap;
  }
  /* platforms: generic device glyphs with the platform name */
  const PLATFORMS=[{id:'ios',label:'iOS',g:'phone'},{id:'android',label:'Android',g:'phone'},{id:'mac',label:'Mac',g:'laptop'},{id:'windows',label:'Windows',g:'monitor'},{id:'quest',label:'Quest',g:null},{id:'pico',label:'Pico',g:null}];
  const GLYPH={
    phone:'<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    laptop:'<rect x="4" y="5" width="16" height="10.5" rx="1.5"/><path d="M2 19h20"/>',
    monitor:'<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>'
  };
  function glyph(g){ const s=document.createElementNS('http://www.w3.org/2000/svg','svg'); s.setAttribute('width','12'); s.setAttribute('height','12'); s.setAttribute('viewBox','0 0 24 24'); s.setAttribute('fill','none'); s.setAttribute('stroke','currentColor'); s.setAttribute('stroke-width','2'); s.setAttribute('stroke-linecap','round'); s.setAttribute('stroke-linejoin','round'); s.setAttribute('aria-hidden','true'); s.innerHTML=GLYPH[g]; return s; }
  function platformsOf(id){ const p=nodes[id]?.platforms; if(!Array.isArray(p)) return []; const known=PLATFORMS.filter(x=>p.includes(x.id)); const custom=p.filter(v=>!PLATFORMS.some(x=>x.id===v)).map(v=>({id:v,label:String(v),g:null})); return known.concat(custom); }
  function platChip(x){ const c=el('span','plat'); if(x.g) c.appendChild(glyph(x.g)); else c.style.paddingLeft='7px'; c.appendChild(document.createTextNode(x.label)); return c; }
  function platStrip(id){ const ps=platformsOf(id); if(!ps.length) return null; const w=el('span','plats'); w.style.display='flex'; ps.forEach(x=>w.appendChild(platChip(x))); return w; }
  function fillPlatforms(kind){
    const id=openId, ps=platformsOf(id), view=$('platView'), pick=$('platPick');
    const show = canEdit ? true : ps.length>0;
    $('platSec').hidden=!show; if(!show) return;
    view.textContent=''; view.hidden=canEdit; ps.forEach(x=>view.appendChild(platChip(x)));
    pick.hidden=!canEdit; if(!canEdit) return;
    if(pick.dataset.for!==id){ pick.dataset.for=id; pick.textContent='';
      PLATFORMS.forEach(x=>{ const lab=el('label'); const cb=document.createElement('input'); cb.type='checkbox'; cb.id='plat-'+x.id; cb.value=x.id;
        cb.addEventListener('change',savePlatforms); lab.appendChild(cb); if(x.g) lab.appendChild(glyph(x.g)); lab.appendChild(document.createTextNode(x.label)); pick.appendChild(lab); }); }
    PLATFORMS.forEach(x=>{ const cb=$('plat-'+x.id); if(cb) cb.checked=ps.some(p=>p.id===x.id); });
  }
  async function savePlatforms(){
    const id=openId; const custom=(nodes[id].platforms||[]).filter(v=>!PLATFORMS.some(x=>x.id===v)); const list=PLATFORMS.filter(x=>$('plat-'+x.id).checked).map(x=>x.id).concat(custom);
    try{ await db.doc('nodes/'+id).update({platforms:list}); }catch(e){ const m=$('pMsg'); m.hidden=false; m.textContent='Could not save. Try again.'; m.classList.add('err'); }
  }
  function fillNode(btn, id, kind){
    const d=nodes[id]; btn.textContent='';
    const inner=el('span','in');
    const title=tx(id,'title')||ui('Untitled'), note=tx(id,'note'), tag=tx(id,'tag');
    if(kind==='root'||kind==='branch'){
      if(kind==='branch'){ const kick=tx(id,'kicker'); const kr=el('span','krow'); if(kick) kr.appendChild(el('span','k',kick)); if(tag) kr.appendChild(el('span','pill',tag)); if(kr.childNodes.length) inner.appendChild(kr); }
      inner.appendChild(el('span','t',title)); if(note){ const s=el('span','s',note); s.style.display='block'; inner.appendChild(s); }
    } else if(kind==='group'){
      const row=el('span','row'); row.appendChild(el('span','t',title)); if(tag) row.appendChild(el('span','pill',tag)); inner.appendChild(row); if(note){ const n=el('span','n',note); n.style.display='block'; inner.appendChild(n); }
    } else {
      const row=el('span','row'); row.appendChild(el('span','t',title));
      if(tag) row.appendChild(el('span','pill'+(/delay|paused|on hold/i.test(d.tag||'')?' muted':''),tag));
      inner.appendChild(row);
      if(note){ const n=el('span','n',note); n.style.display='block'; inner.appendChild(n); }
    }
    const ps=platStrip(id); if(ps) inner.appendChild(ps);
    const vs=vidStrip(id); if(vs) inner.appendChild(vs);
    btn.appendChild(inner);
    if(canEdit){ const k=el('span','knob'); k.title='Drag to another card to connect'; k.setAttribute('aria-hidden','true'); k.addEventListener('pointerdown',e=>startKnob(e,id)); btn.appendChild(k); }
  }
  function render(){
    if(dragging){ pendingRender=true; return; }
    $('state').hidden = !!nodes.microtube;
    if(!nodes.microtube){ $('state').querySelector('h2').textContent='No map yet'; $('state').querySelector('p').textContent='Ask Claude to set up the Microtube products and projects.'; }
    document.documentElement.lang = lang==='zh' ? 'zh-CN' : 'en';
    computePositions();
    // remove stale
    Object.keys(els).forEach(id=>{ if(!nodes[id]){ els[id].remove(); delete els[id]; } });
    Object.keys(nodes).forEach(id=>{
      const kind=kindOf(id);
      let b=els[id];
      if(!b){ b=document.createElement('div'); b.setAttribute('role','button'); b.tabIndex=0; b.dataset.id=id; world.appendChild(b); els[id]=b; attachNode(b); }
      const box=(kind==='card'||kind==='group') && nodes[id].box && nodes[id].box!=='auto' ? ' box-'+nodes[id].box : '';
      b.className='node '+kind+' '+branchOf(id)+box+(id===selected?' selected':'')+(id===editing?' editing':'');
      const sig=kind+'|'+lang+'|'+JSON.stringify([nodes[id].title,nodes[id].note,nodes[id].tag,nodes[id].videos,nodes[id].platforms,nodes[id].kicker,nodes[id].zh]);
      if(b.dataset.sig!==sig && id!==editing){ b.dataset.sig=sig; fillNode(b,id,kind); }
      b.setAttribute('aria-label',(tx(id,'title')||ui('Untitled'))+(videos(id).length?', '+counts(videos(id).length,0,0):''));
      place(id);
    });
    if(selected && !nodes[selected]) select(null);
    drawLinks();
    positionTbar();
    if(pendingEdit && els[pendingEdit]){ const id=pendingEdit; pendingEdit=null; select(id); requestAnimationFrame(()=>startEdit(id)); }
    if(!fitted && nodes.microtube){ fitted=true; requestAnimationFrame(()=>fitView(false)); }
    if(openId) fillDrawer(false);
  }
  function place(id){ const b=els[id], p=pos[id]; if(b&&p){ b.style.left=p.x+'px'; b.style.top=p.y+'px'; } }
  function drawLinks(){
    links.textContent='';
    Object.keys(nodes).forEach(id=>{
      const pid=nodes[id].parent; if(!pid||!pos[pid]||!pos[id]) return;
      const a=pos[pid], c=pos[id];
      const dx=c.x-a.x, dy=c.y-a.y; let d;
      if(Math.abs(dx)>=Math.abs(dy)){ const mx=a.x+dx/2; d=`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${c.y}, ${c.x} ${c.y}`; }
      else { const my=a.y+dy/2; d=`M ${a.x} ${a.y} C ${a.x} ${my}, ${c.x} ${my}, ${c.x} ${c.y}`; }
      const p=document.createElementNS('http://www.w3.org/2000/svg','path');
      p.setAttribute('d',d);
      const br=branchOf(id);
      p.setAttribute('stroke', br==='hexr'?'rgba(242,102,26,.55)':br==='flexr'?'rgba(157,134,242,.6)':br==='aris'?'rgba(229,53,43,.6)':'rgba(201,203,209,.5)');
      links.appendChild(p);
    });
    Object.keys(xlinks).forEach(lid=>{
      const L=xlinks[lid]; const a=pos[L.from], c=pos[L.to]; if(!a||!c) return;
      const mx=(a.x+c.x)/2, my=(a.y+c.y)/2, dx=c.x-a.x, dy=c.y-a.y, len=Math.hypot(dx,dy)||1;
      const bow=Math.min(120,len*0.18), qx=mx-dy/len*bow, qy=my+dx/len*bow;
      const d=`M ${a.x} ${a.y} Q ${qx} ${qy} ${c.x} ${c.y}`;
      const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d',d); p.setAttribute('class','xlink'+(lid===selLink?' sel':'')); links.appendChild(p);
      const label=linkLabel(L);
      if(label){ const t=document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x',(mx+qx)/2); t.setAttribute('y',(my+qy)/2+4); t.textContent=label; links.appendChild(t); }
      if(canEdit){ const h=document.createElementNS('http://www.w3.org/2000/svg','path'); h.setAttribute('d',d); h.setAttribute('class','hit'); h.dataset.lid=lid;
        h.addEventListener('pointerdown',e=>{ e.stopPropagation(); }); h.addEventListener('click',e=>{ e.stopPropagation(); selectLink(lid,e); }); links.appendChild(h); }
    });
    if(ghost) links.appendChild(ghost);
  }

  /* ---------- view: pan + zoom ---------- */
  function applyView(){
    world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.k})`;
    positionTbar();
    const g=24*view.k; vp.style.backgroundSize=`${g}px ${g}px`; vp.style.backgroundPosition=`${view.x}px ${view.y}px`;
  }
  function zoomAt(cx, cy, factor){
    const k=Math.min(2.2, Math.max(0.2, view.k*factor)); const f=k/view.k;
    view.x = cx - (cx - view.x)*f; view.y = cy - (cy - view.y)*f; view.k=k; applyView();
  }
  function bounds(){
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    Object.keys(pos).forEach(id=>{ const b=els[id]; if(!b) return; const w=b.offsetWidth/2, h=b.offsetHeight/2, p=pos[id];
      x0=Math.min(x0,p.x-w); x1=Math.max(x1,p.x+w); y0=Math.min(y0,p.y-h); y1=Math.max(y1,p.y+h); });
    return {x0,y0,x1,y1};
  }
  function fitView(){
    const b=bounds(); if(!isFinite(b.x0)) return;
    const W=vp.clientWidth, H=vp.clientHeight, pad=64, top=72;
    const k=Math.min(1, Math.max(0.2, Math.min((W-pad*2)/(b.x1-b.x0), (H-pad-top-56)/(b.y1-b.y0))));
    view.k=k; view.x = W/2 - (b.x0+b.x1)/2*k; view.y = top + (H-top-56)/2 - (b.y0+b.y1)/2*k; applyView();
  }
  $('zin').addEventListener('click',()=>zoomAt(vp.clientWidth/2, vp.clientHeight/2, 1.25));
  $('zout').addEventListener('click',()=>zoomAt(vp.clientWidth/2, vp.clientHeight/2, 0.8));
  $('fit').addEventListener('click',()=>fitView());
  vp.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=vp.getBoundingClientRect();
    if(e.ctrlKey || e.metaKey || Math.abs(e.deltaY)>=50 && e.deltaMode===0 && !e.deltaX){ zoomAt(e.clientX-r.left, e.clientY-r.top, Math.exp(-e.deltaY*(e.ctrlKey?0.01:0.0015))); }
    else { view.x-=e.deltaX; view.y-=e.deltaY; applyView(); }
  },{passive:false});

  // pointers on the background: pan (one finger / mouse) and pinch (two fingers)
  const pts=new Map(); let pan=null, pinch=null;
  vp.addEventListener('pointerdown',e=>{
    const nodeEl=e.target.closest('.node');
    if(nodeEl && canEdit) return;
    vp.setPointerCapture(e.pointerId); pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){ pan={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false,node:nodeEl?nodeEl.dataset.id:null,play:!!e.target.closest('[data-play]')}; vp.classList.add('panning'); }
    if(pts.size===2){ const [a,b]=[...pts.values()]; pinch={d:Math.hypot(a.x-b.x,a.y-b.y), k:view.k}; pan=null; }
  });
  vp.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId)) return; pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch && pts.size===2){ const [a,b]=[...pts.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y); const r=vp.getBoundingClientRect();
      zoomAt((a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top,(pinch.k*d/pinch.d)/view.k); }
    else if(pan){ if(Math.hypot(e.clientX-pan.x,e.clientY-pan.y)>4) pan.moved=true; view.x=pan.vx+(e.clientX-pan.x); view.y=pan.vy+(e.clientY-pan.y); applyView(); }
  });
  function endPointer(e){ if(e.type==='pointerup' && pan && !pan.moved && pts.size===1){
      if(pan.node && !canEdit){ if(pan.play) openPlayer(pan.node,0); else openDrawer(pan.node); }
      else if(connecting) cancelConnect(); else if(editing) commitEdit(); else { select(null); selectLink(null); } }
    pts.delete(e.pointerId); if(pts.size<2) pinch=null; if(!pts.size){ pan=null; vp.classList.remove('panning'); } }
  vp.addEventListener('pointerup',endPointer); vp.addEventListener('pointercancel',endPointer);

  /* ---------- node drag (moves the card and everything under it) ---------- */
  function attachNode(b){
    b.addEventListener('pointerdown',e=>{
      if(e.button!==0 && e.pointerType==='mouse') return;
      if(!canEdit) return;   // viewers: the background handler pans and opens cards
      e.stopPropagation();
      const id=b.dataset.id;
      if(editing===id && e.target.closest('[contenteditable]')) return;   // let the text cursor work
      if(editing && editing!==id) commitEdit();
      if(connecting) return;
      b.setPointerCapture(e.pointerId);
      const ids=[id, ...descendants(id)];
      dragging={id, ids, sx:e.clientX, sy:e.clientY, start:Object.fromEntries(ids.map(i=>[i,{...pos[i]}])), moved:false, pid:e.pointerId, play:!!e.target.closest('[data-play]')};
    });
    b.addEventListener('pointermove',e=>{
      if(!dragging || dragging.pid!==e.pointerId) return;
      const dx=(e.clientX-dragging.sx)/view.k, dy=(e.clientY-dragging.sy)/view.k;
      if(!dragging.moved && Math.hypot(e.clientX-dragging.sx, e.clientY-dragging.sy) < 5) return;
      if(!dragging.moved){ dragging.moved=true; b.classList.add('dragging'); }
      dragging.ids.forEach(i=>{ const s=dragging.start[i]; pos[i]={x:s.x+dx, y:s.y+dy}; place(i); });
      drawLinks(); positionTbar();
    });
    const finish=async e=>{
      if(!dragging || dragging.pid!==e.pointerId) return;
      const dg=dragging; dragging=null; b.classList.remove('dragging');
      if(!dg.moved){ if(e.type==='pointerup'){ if(dg.play && !connecting) openPlayer(dg.id,0); else tapNode(dg.id); } if(pendingRender){ pendingRender=false; render(); } return; }
      await savePositions(dg.ids);
      if(pendingRender){ pendingRender=false; render(); }
    };
    b.addEventListener('pointerup',finish); b.addEventListener('pointercancel',finish);
    b.addEventListener('pointerup',e=>{ if(connecting && e.button===0){ e.stopPropagation(); finishConnect(b.dataset.id); } });
    b.addEventListener('pointerenter',()=>{ if((connecting && b.dataset.id!==connecting.id && validTarget(connecting.id,b.dataset.id)) || (knobDrag && b.dataset.id!==knobDrag.from && validLink(knobDrag.from,b.dataset.id))) b.classList.add('target'); });
    b.addEventListener('pointerleave',()=>b.classList.remove('target'));
    b.addEventListener('dblclick',e=>{ if(canEdit && !connecting){ e.preventDefault(); select(b.dataset.id); startEdit(b.dataset.id); } });
    b.addEventListener('keydown',e=>{
      if(editing===b.dataset.id) return;
      if(e.key==='Enter'||e.key===' '){ e.preventDefault(); if(connecting) finishConnect(b.dataset.id); else tapNode(b.dataset.id); }
      if(e.key==='F2' && canEdit){ e.preventDefault(); select(b.dataset.id); startEdit(b.dataset.id); }
    });
  }
  async function savePositions(movedIds){
    if(!canEdit) return;
    // first move freezes the whole layout so nothing else jumps later
    const ids = Object.keys(nodes).some(id=>!hasSaved(id)) ? Object.keys(nodes) : movedIds;
    try{
      await Promise.all(ids.map(id=>{ const p=pos[id]; if(!p) return null; nodes[id]={...nodes[id], x:Math.round(p.x), y:Math.round(p.y)}; return db.doc('nodes/'+id).update({x:Math.round(p.x), y:Math.round(p.y)}); }));
    }catch(err){ toast('Could not save the new position. Try again.'); }
  }
  $('tidy').addEventListener('click',async()=>{
    const b=$('tidy');
    if(!b.dataset.armed){ b.dataset.armed='1'; b.textContent='Confirm tidy'; toast('This resets every card to the automatic layout.'); setTimeout(()=>{ delete b.dataset.armed; b.textContent='Tidy layout'; },4000); return; }
    delete b.dataset.armed; b.textContent='Tidy layout';
    try{ await Promise.all(Object.keys(nodes).filter(hasSaved).map(id=>db.doc('nodes/'+id).update({x:null,y:null}))); fitted=false; toast('Layout tidied.'); }
    catch(e){ toast('Could not tidy the layout. Try again.'); }
  });

  let toastT=null;
  function toast(t){ const el=$('toast'); el.textContent=t; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>{ el.hidden=true; },3200); }

  /* ---------- drawer ---------- */
  function openDrawer(id){ closeStylePop(); $('tbar').hidden=true; openId=id; fillDrawer(true); $('scrim').hidden=false; $('drawer').hidden=false; $('dClose').focus(); setMsg('vMsg',''); setMsg('eMsg',''); }
  function closeDrawer(){ const id=openId; openId=null; $('scrim').hidden=true; $('drawer').hidden=true; document.querySelectorAll('#vList video').forEach(v=>v.pause()); if(id&&els[id]) els[id].focus({preventScroll:true}); positionTbar(); }
  function setMsg(id,t,err){ const m=$(id); if(id==='vMsg'&&!t) t=DEFAULT_VMSG; m.textContent=t; m.classList.toggle('err',!!err); }
  function fillDrawer(full){
    const d=nodes[openId]; if(!d){ closeDrawer(); return; }
    const br=branchOf(openId), kind=kindOf(openId);
    const tag=$('dTag'); tag.className='pill '+br;
    tag.textContent = kind==='root' ? ui('Company') : kind==='branch' ? word('Hardware') : kind==='group' ? ui('Category') : (tx(openId,'tag')||({hexr:'HexR',flexr:'FlexR',aris:'ARIS'}[br]||ui('Item')));
    $('dTitle').textContent=tx(openId,'title')||ui('Untitled');
    const list=$('vList'); const sig=lang+JSON.stringify(videos(openId));
    if(full || list.dataset.sig!==sig){
      list.dataset.sig=sig; list.textContent='';
      const vs=videos(openId);
      if(!vs.length) list.appendChild(el('div','empty', canEdit ? 'Nothing here yet. Add a video, a picture or a link.' : ui('No media yet.')));
      vs.forEach((v,i)=>{
        const item=el('div','vitem');
        if(v.kind==='file'){ const vid=document.createElement('video'); vid.src=fileUrl(v); if(v.poster) vid.poster=mediaUrl(v.poster); vid.controls=true; vid.preload='metadata'; vid.playsInline=true; item.appendChild(vid); }
        if(v.kind==='image'){ const im=document.createElement('img'); im.src=fileUrl(v); im.alt=v.name||'Picture'; im.className='vimg'; im.loading='lazy'; im.addEventListener('click',()=>openPlayer(openId,i)); item.appendChild(im); }
        const meta=el('div','vmeta');
        const kindIcon=el('span','vkind', ui(v.kind==='file'?'Video':v.kind==='image'?'Picture':'Link')); meta.appendChild(kindIcon);
        if(v.kind==='link'){ const href=safeLink(v.url); const a=el('a','name', v.name||v.url); if(href){a.href=href; a.target='_blank'; a.rel='noopener noreferrer';} meta.appendChild(a); }
        else {
          const nm=el('span','name', (v.name||ui(v.kind==='image'?'Picture':'Video')) + (v.duration?' · '+fmtDur(v.duration):''));
          meta.appendChild(nm);
          const ex=el('button','btn small',ui('Expand')); ex.type='button'; ex.addEventListener('click',()=>{ item.querySelector('video')?.pause(); openPlayer(openId,i); }); meta.appendChild(ex);
        }
        if(canEdit){
          const up=el('button','btn small','↑'); up.type='button'; up.setAttribute('aria-label','Move up'); up.disabled=i===0; up.addEventListener('click',()=>moveMedia(i,-1)); meta.appendChild(up);
          const rn=el('button','btn small','Rename'); rn.type='button'; rn.addEventListener('click',()=>renameMedia(i, meta)); meta.appendChild(rn);
          const rm=el('button','btn small danger','Remove'); rm.type='button';
          rm.addEventListener('click',()=>{ if(rm.dataset.armed){ removeVideo(i); } else { rm.dataset.armed='1'; rm.textContent='Confirm remove'; setTimeout(()=>{ if(rm.isConnected){ delete rm.dataset.armed; rm.textContent='Remove'; } },4000);} });
          meta.appendChild(rm);
        }
        item.appendChild(meta); list.appendChild(item);
      });
    }
    $('vAdd').hidden = !canEdit;
    $('editSec').hidden = !canEdit;
    if(canEdit){
      if(full || document.activeElement!==$('eTitle')) $('eTitle').value=d.title||'';
      if(full || document.activeElement!==$('eTag')) $('eTag').value=d.tag||'';
      if(full || document.activeElement!==$('eNote')) $('eNote').value=d.note||'';
      const z=d.zh||{};
      if(full || document.activeElement!==$('eTitleZh')) $('eTitleZh').value=z.title||'';
      if(full || document.activeElement!==$('eTagZh')) $('eTagZh').value=z.tag||'';
      if(full || document.activeElement!==$('eNoteZh')) $('eNoteZh').value=z.note||'';
      $('eTagZh').parentElement.hidden = kind==='root';
      const fixed = kind==='root' || !!BR[openId];
      $('eDel').hidden = fixed;
      $('eTag').parentElement.hidden = kind==='root';
    }
    fillPlatforms(kind);
  }
  async function writeVideos(id, list){ await db.doc('nodes/'+id).update({videos:list}); }
  function fmtDur(t){ t=Math.round(t||0); const h=Math.floor(t/3600), m=Math.floor(t%3600/60), s=t%60; return (h? h+':'+String(m).padStart(2,'0') : m)+':'+String(s).padStart(2,'0'); }
  function fmtSize(b){ return b>1e9 ? (b/1e9).toFixed(2)+' GB' : b>1e6 ? (b/1e6).toFixed(1)+' MB' : Math.max(1,Math.round(b/1e3))+' KB'; }
  async function removeVideo(i){
    const id=openId; const vs=videos(id).slice(); const v=vs[i]; if(!v) return;
    vs.splice(i,1);
    try{ await writeVideos(id,vs); deleteFiles([v]); setMsg('vMsg','Removed.'); }
    catch(e){ setMsg('vMsg','Could not remove it. Try again.',true); }
  }
  function deleteFiles(items){ if(!window.mapAPI) return; const files=[]; items.forEach(v=>{ if(v.file) files.push(v.file); if(v.poster) files.push(v.poster); }); if(files.length) window.mapAPI.deleteMedia(files); }
  async function moveMedia(i,dir){ const id=openId; const vs=videos(id).slice(); const j=i+dir; if(j<0||j>=vs.length) return; [vs[i],vs[j]]=[vs[j],vs[i]]; await writeVideos(id,vs); }
  function renameMedia(i, meta){
    const id=openId; const v=videos(id)[i]; if(!v) return;
    meta.textContent=''; const f=el('form','vrename'); const inp=document.createElement('input'); inp.type='text'; inp.value=v.name||''; inp.maxLength=120; inp.setAttribute('aria-label','Name');
    const ok=el('button','btn small','Save'); ok.type='submit'; const cancel=el('button','btn small','Cancel'); cancel.type='button';
    f.appendChild(inp); f.appendChild(ok); f.appendChild(cancel); meta.appendChild(f); inp.focus(); inp.select();
    cancel.addEventListener('click',()=>fillDrawer(true));
    inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape'){ e.preventDefault(); fillDrawer(true); } });
    f.addEventListener('submit',async e=>{ e.preventDefault(); const vs=videos(id).slice(); vs[i]={...vs[i], name:inp.value.trim()}; await writeVideos(id,vs); fillDrawer(true); });
  }

  /* pictures: compressed to WebP, up to 2000 px */
  $('vImgBtn').addEventListener('click',async()=>{
    if(!window.mapAPI||!openId) return; const id=openId;
    const picks=await window.mapAPI.pickImages(); if(!picks.length) return;
    const btn=$('vImgBtn'); btn.disabled=true;
    let done=0; const added=[];
    for(const p of picks){
      setMsg('vMsg','Adding picture '+(done+1)+' of '+picks.length+'…');
      try{ const r=await window.mapAPI.importImage({src:p.src}); added.push({...r, name:p.name}); }
      catch(e){ setMsg('vMsg','Could not read '+p.name+'. Try a JPG or PNG.',true); }
      done++;
    }
    if(added.length){ await writeVideos(id, videos(id).concat(added)); setMsg('vMsg', added.length===1?'Picture added.':added.length+' pictures added.'); }
    btn.disabled=false;
  });

  /* links: any web address, with an optional title */
  $('vLinkBtn').addEventListener('click',async()=>{
    const href=safeLink($('vLink').value.trim());
    if(!href){ setMsg('vMsg','Paste a full link starting with https://',true); return; }
    let name=$('vLinkName').value.trim();
    if(!name){ try{ const u=new URL(href); name=u.hostname.replace(/^www\./,'')+(u.pathname.length>1?u.pathname.slice(0,32):''); }catch(e){ name=href; } }
    const vs=videos(openId).slice(); vs.push({kind:'link', url:href, name});
    try{ await writeVideos(openId,vs); $('vLink').value=''; $('vLinkName').value=''; setMsg('vMsg','Link added.'); }catch(e){ setMsg('vMsg','Could not add the link. Try again.',true); }
  });
  ['vLink','vLinkName'].forEach(i=>$(i).addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); $('vLinkBtn').click(); } }));

  /* ---------- full-screen player: videos, pictures and links ---------- */
  const P={id:null,i:0,ret:null};
  function openPlayer(id,i){
    if(!videos(id).length) return;
    P.id=id; P.ret=document.activeElement; closeStylePop();
    $('player').hidden=false; showVideo(i); $('pClose').focus();
  }
  function showVideo(i){
    const vs=videos(P.id); if(!vs.length){ closePlayer(); return; }
    P.i=(i+vs.length)%vs.length; const v=vs[P.i];
    $('pTitle').textContent=tx(P.id,'title')||ui('Media');
    $('pSub').textContent=(v.name||ui(v.kind==='image'?'Picture':v.kind==='link'?'Link':'Video'))+(vs.length>1?'  ·  '+(P.i+1)+(lang==='zh'?' / ':' of ')+vs.length:'');
    const body=$('pBody'); body.querySelectorAll('video').forEach(x=>x.pause()); body.textContent='';
    if(v.kind==='file'){ const vid=document.createElement('video'); vid.src=fileUrl(v); if(v.poster) vid.poster=mediaUrl(v.poster); vid.controls=true; vid.playsInline=true; vid.autoplay=true; vid.loop=vs.length===1;
      vid.addEventListener('ended',()=>{ const next=vs.findIndex((x,k)=>k>P.i && x.kind==='file'); if(next>0) showVideo(next); }); body.appendChild(vid); vid.play().catch(()=>{}); }
    else if(v.kind==='image'){ const im=document.createElement('img'); im.src=fileUrl(v); im.alt=v.name||'Picture'; im.className='pimg'; body.appendChild(im); }
    else { const box=el('div','plink'); box.appendChild(el('p',null,ui('This opens in your web browser.'))); const href=safeLink(v.url); const a=el('a',null, v.name ? ui('Open')+' '+v.name : ui('Open link')); if(href){ a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; } box.appendChild(a); const u=el('p','purl',v.url||''); box.appendChild(u); body.appendChild(box); }
    const multi=vs.length>1; $('pPrev').hidden=!multi; $('pNext').hidden=!multi;
    const th=$('pThumbs'); th.textContent=''; th.hidden=!multi;
    if(multi) vs.forEach((x,k)=>{ const b=el('button'); b.type='button'; b.setAttribute('aria-label','Show '+(x.name||'item '+(k+1))); if(k===P.i) b.setAttribute('aria-current','true');
      const src = x.kind==='image' ? fileUrl(x) : x.poster ? mediaUrl(x.poster) : null;
      if(src){ const im=document.createElement('img'); im.src=src; im.alt=''; b.appendChild(im); } else b.textContent = ui(x.kind==='link' ? 'Link' : 'Video');
      b.addEventListener('click',()=>showVideo(k)); th.appendChild(b); });
  }
  function closePlayer(){ $('pBody').querySelectorAll('video').forEach(x=>x.pause()); $('pBody').textContent=''; $('player').hidden=true; if(P.ret&&P.ret.focus) P.ret.focus({preventScroll:true}); P.id=null; }
  $('pClose').addEventListener('click',closePlayer);
  $('pPrev').addEventListener('click',()=>showVideo(P.i-1)); $('pNext').addEventListener('click',()=>showVideo(P.i+1));
  $('player').addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape') closePlayer(); if(e.target.tagName!=='VIDEO'){ if(e.key==='ArrowRight') showVideo(P.i+1); if(e.key==='ArrowLeft') showVideo(P.i-1); } });
  $('player').addEventListener('click',e=>{ if(e.target.id==='player'||e.target.classList.contains('pstage')||e.target.id==='pBody') closePlayer(); });

  /* ---------- add video: preview, trim, choose quality, compress with ffmpeg ---------- */
  const T={info:null, id:null, dur:0, s:0, e:0, busy:false, stopAt:null, jobId:null, canPreview:true};
  const tv=$('tv');
  const fmt=t=>{ t=Math.max(0,t); const h=Math.floor(t/3600), m=Math.floor(t%3600/60), x=t-h*3600-m*60; return (h?h+':'+String(m).padStart(2,'0'):m)+':'+(x<10?'0':'')+x.toFixed(1); };
  $('vUploadBtn').addEventListener('click',async()=>{
    if(!window.mapAPI||!openId) return;
    try{ const info=await window.mapAPI.pickVideo(); if(info) openTrimmer(info, openId); }
    catch(e){ setMsg('vMsg',(e&&e.message||'').replace(/^Error invoking remote method[^:]*: (Error: )?/,'')||'Could not open that file.',true); }
  });
  function openTrimmer(info, id){
    Object.assign(T,{info, id, dur:info.duration||0, s:0, e:info.duration||0, busy:false, stopAt:null, jobId:null, canPreview:true});
    tv.src=info.url; tv.muted=false;
    $('tName').value=info.name||'Video';
    $('tSound').checked=!!info.hasAudio; $('tSound').disabled=!info.hasAudio;
    $('tSrcInfo').textContent=[info.width&&info.height?info.width+'×'+info.height:null, fmtDur(info.duration), info.size?fmtSize(info.size):null].filter(Boolean).join(' · ');
    $('tPreviewBits').hidden=false; $('tNoPreview').hidden=true;
    $('tProg').hidden=true; setTrimBusy(false);
    $('tMsg').textContent='Keep the whole video, or drag the orange handles to keep only part of it.'; $('tMsg').classList.remove('err');
    drawTrim(); $('trim').hidden=false; $('trimClose').focus();
  }
  tv.addEventListener('loadedmetadata',()=>{ if(!T.info) return; if(!T.dur && tv.duration && isFinite(tv.duration)){ T.dur=tv.duration; T.e=T.dur; } drawTrim(); });
  tv.addEventListener('error',()=>{ if($('trim').hidden||!T.info) return; T.canPreview=false; $('tPreviewBits').hidden=true; $('tNoPreview').hidden=false; });
  tv.addEventListener('timeupdate',()=>{ drawTrim(); if(T.stopAt!=null && tv.currentTime>=T.stopAt){ tv.pause(); T.stopAt=null; } });
  tv.addEventListener('play',()=>{ $('tPlay').textContent='Pause'; }); tv.addEventListener('pause',()=>{ $('tPlay').textContent='Play'; });
  function drawTrim(){
    if(!T.dur) return; const L=v=>(v/T.dur*100)+'%';
    $('tlsel').style.left=L(T.s); $('tlsel').style.width=((T.e-T.s)/T.dur*100)+'%';
    $('hs').style.left=L(T.s); $('he').style.left=L(T.e); $('tlhead').style.left=L(tv.currentTime||0);
    const len=T.e-T.s, whole = T.s<=0.05 && T.e>=T.dur-0.05;
    $('tInfo').textContent= whole ? 'Whole video · '+fmtDur(T.dur) : fmt(T.s)+' – '+fmt(T.e)+' · '+fmtDur(len);
    $('hs').setAttribute('aria-valuetext',fmt(T.s)); $('he').setAttribute('aria-valuetext',fmt(T.e));
    $('tReset').hidden = whole;
  }
  function setRange(s,e,which){
    s=Math.max(0,Math.min(s,T.dur)); e=Math.max(0,Math.min(e,T.dur));
    if(e-s<0.5){ if(which==='s') s=Math.max(0,e-0.5); else e=Math.min(T.dur,s+0.5); }
    T.s=s; T.e=e; drawTrim();
  }
  function timeAt(clientX){ const r=$('tl').getBoundingClientRect(); return Math.max(0,Math.min(1,(clientX-r.left)/r.width))*T.dur; }
  ['hs','he'].forEach(h=>{
    const btn=$(h);
    btn.addEventListener('pointerdown',e=>{ if(T.busy||!T.dur) return; e.preventDefault(); e.stopPropagation(); btn.setPointerCapture(e.pointerId);
      const mv=ev=>{ const t=timeAt(ev.clientX); if(h==='hs') setRange(t,T.e,'s'); else setRange(T.s,t,'e'); tv.currentTime=h==='hs'?T.s:T.e; };
      const up=()=>{ btn.removeEventListener('pointermove',mv); btn.removeEventListener('pointerup',up); btn.removeEventListener('pointercancel',up); };
      btn.addEventListener('pointermove',mv); btn.addEventListener('pointerup',up); btn.addEventListener('pointercancel',up); });
    btn.addEventListener('keydown',e=>{ const d=e.shiftKey?1:0.1; let dv=0; if(e.key==='ArrowLeft') dv=-d; if(e.key==='ArrowRight') dv=d; if(!dv) return; e.preventDefault(); e.stopPropagation();
      if(h==='hs') setRange(T.s+dv,T.e,'s'); else setRange(T.s,T.e+dv,'e'); tv.currentTime=h==='hs'?T.s:T.e; });
  });
  $('tl').addEventListener('pointerdown',e=>{ if(T.busy||!T.dur||e.target.classList.contains('hd')) return; tv.currentTime=timeAt(e.clientX); drawTrim(); });
  $('tPlay').addEventListener('click',()=>{ if(T.busy) return; T.stopAt=null; tv.paused?tv.play():tv.pause(); });
  $('tSetS').addEventListener('click',()=>{ if(!T.busy) setRange(tv.currentTime, Math.max(T.e, tv.currentTime+0.5),'s'); });
  $('tSetE').addEventListener('click',()=>{ if(!T.busy) setRange(Math.min(T.s, tv.currentTime-0.5), tv.currentTime,'e'); });
  $('tPrev').addEventListener('click',()=>{ if(T.busy) return; tv.currentTime=T.s; T.stopAt=T.e; tv.play(); });
  $('tReset').addEventListener('click',()=>{ if(!T.busy){ setRange(0,T.dur,'e'); } });
  function closeTrimmer(){ if(T.busy) return; tv.pause(); $('trim').hidden=true; tv.removeAttribute('src'); tv.load(); T.info=null; $('vUploadBtn').focus(); }
  $('trimClose').addEventListener('click',closeTrimmer);
  $('tCancel').addEventListener('click',async()=>{ if(T.busy && T.jobId){ await window.mapAPI.cancelImport(T.jobId); return; } closeTrimmer(); });
  $('trim').addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape' && !T.busy) closeTrimmer(); });
  function setTrimBusy(on,text){
    ['tSave','tPlay','tSetS','tSetE','tPrev','tReset','trimClose','tQuality','tSound','tName'].forEach(i=>{ $(i).disabled=on; });
    $('tCancel').textContent = on ? 'Stop' : 'Cancel';
    if(text){ $('tMsg').textContent=text; $('tMsg').classList.remove('err'); }
  }
  if(window.mapAPI) window.mapAPI.onProgress(d=>{ if(d.jobId!==T.jobId) return; const pct=Math.round(d.fraction*100); $('tBar').style.width=pct+'%'; $('tMsg').textContent='Compressing… '+pct+'%'; });
  $('tSave').addEventListener('click',async()=>{
    if(T.busy||!T.info) return;
    const id=T.id, whole = T.s<=0.05 && T.e>=T.dur-0.05;
    const opts={ jobId:'j'+Date.now(), src:T.info.src, preset:$('tQuality').value, keepAudio:$('tSound').checked && !$('tSound').disabled,
      start: whole?0:T.s, end: whole?null:T.e };
    T.jobId=opts.jobId; T.busy=true; tv.pause(); setTrimBusy(true,'Compressing… 0%'); $('tProg').hidden=false; $('tBar').style.width='0%';
    try{
      const r=await window.mapAPI.importVideo(opts);
      const item={...r, name:($('tName').value.trim()||'Video')};
      await writeVideos(id, videos(id).concat([item]));
      T.busy=false; setTrimBusy(false); closeTrimmer(); setMsg('vMsg','Video added · '+fmtDur(r.duration)+' · '+fmtSize(r.size)+'.');
    }catch(err){
      T.busy=false; setTrimBusy(false); $('tProg').hidden=true;
      const msg=String(err&&err.message||'');
      $('tMsg').textContent = /Cancelled/i.test(msg) ? 'Stopped. Nothing was added.' : 'Could not convert this video. '+msg.replace(/^Error invoking remote method[^:]*: (Error: )?/,'').slice(0,200);
      $('tMsg').classList.toggle('err', !/Cancelled/i.test(msg));
    }
  });
  $('eSave').addEventListener('click',async()=>{
    const patch={title:$('eTitle').value.trim()||'Untitled', note:$('eNote').value.trim()};
    if(!$('eTag').parentElement.hidden) patch.tag=$('eTag').value.trim();
    const zh={...(nodes[openId].zh||{}), title:$('eTitleZh').value.trim(), note:$('eNoteZh').value.trim()};
    if(!$('eTagZh').parentElement.hidden) zh.tag=$('eTagZh').value.trim();
    Object.keys(zh).forEach(k=>{ if(!zh[k]) delete zh[k]; }); patch.zh=zh;
    try{ await db.doc('nodes/'+openId).update(patch); setMsg('eMsg','Saved.'); }catch(e){ setMsg('eMsg','Could not save. Try again.',true); }
  });
  $('eChild').addEventListener('click',()=>{ const pid=openId; closeDrawer(); addChild(pid); });
  async function addChild(pid){
    const ks=kids(pid); const order=ks.length? Math.max(...ks.map(k=>nodes[k].order??0))+1 : 1;
    const body={title:'New item', note:'', tag:'', parent:pid, order, videos:[]};
    if(hasSaved(pid)){ // layout is frozen: place the new card just outside its parent
      const p=pos[pid], g=pos[nodes[pid].parent] || {x:p.x, y:p.y-1};
      let ax=p.x-g.x, ay=p.y-g.y; const L=Math.hypot(ax,ay)||1; ax/=L; ay/=L;
      const n=ks.length, off=(n%2?1:-1)*Math.ceil(n/2)*0.45, ca=Math.cos(off), sa=Math.sin(off);
      body.x=Math.round(p.x+(ax*ca-ay*sa)*330); body.y=Math.round(p.y+(ax*sa+ay*ca)*330);
    }
    try{ const ref=db.collection('nodes').doc(); pendingEdit=ref.id; await ref.set(body); }
    catch(e){ pendingEdit=null; toast(e&&e.code==='quota_exceeded'?'The map is full.':'Could not add the item. Try again.'); }
  }
  $('eDel').addEventListener('click',async()=>{
    const b=$('eDel');
    if(kids(openId).length){ setMsg('eMsg','Delete or move its sub-items first.',true); return; }
    if(!b.dataset.armed){ b.dataset.armed='1'; b.textContent='Confirm delete'; setMsg('eMsg','This also removes its videos.'); setTimeout(()=>{ delete b.dataset.armed; b.textContent='Delete item'; },4000); return; }
    delete b.dataset.armed; b.textContent='Delete item';
    deleteNode(openId);
  });
  $('dClose').addEventListener('click',closeDrawer);
  $('scrim').addEventListener('click',closeDrawer);
  $('drawer').addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });
  window.addEventListener('resize',()=>{ if(!dragging) applyView(); });

  /* ---------- selection toolbar ---------- */
  function tapNode(id){ if(canEdit) select(id===selected?id:id); else openDrawer(id); }
  function select(id){
    selected=id; closeStylePop(); if(id && selLink){ selLink=null; $('lbar').hidden=true; drawLinks(); }
    Object.keys(els).forEach(k=>els[k].classList.toggle('selected',k===id));
    positionTbar();
  }
  function positionTbar(){
    const t=$('tbar');
    if(!selected || !els[selected] || connecting || !canEdit){ t.hidden=true; return; }
    const kind=kindOf(selected), core=selected==='microtube'||!!BR[selected];
    $('tLink').hidden = selected==='microtube';
    $('tDel').hidden = core; $('tbar').querySelector('.sep').hidden = core;
    $('tStyle').hidden = !(kind==='card'||kind==='group');
    const n=videos(selected).length; $('tVideosLabel').textContent = n ? 'Media ('+n+')' : 'Media';
    t.hidden=false;
    const r=els[selected].getBoundingClientRect(), tw=t.offsetWidth, th=t.offsetHeight;
    let x=r.left+r.width/2-tw/2; x=Math.max(8,Math.min(window.innerWidth-tw-8,x));
    let y=r.top-th-12; if(y<72) y=r.bottom+12;
    y=Math.max(8,Math.min(window.innerHeight-th-8,y));
    t.style.left=x+'px'; t.style.top=y+'px';
    if(!$('stylepop').hidden || !$('platpop').hidden) placePop();
  }
  $('tVideos').addEventListener('click',()=>{ if(selected) openDrawer(selected); });
  $('tEdit').addEventListener('click',()=>{ if(selected) startEdit(selected); });
  $('tAdd').addEventListener('click',()=>{ if(selected) addChild(selected); });
  $('tLink').addEventListener('click',()=>{ if(selected) beginConnect(selected,'parent'); });
  $('tFree').addEventListener('click',()=>{ if(selected) beginConnect(selected,'link'); });
  $('tDel').addEventListener('click',()=>{
    const b=$('tDel'), id=selected; if(!id) return;
    if(kids(id).length){ toast('Delete or move its sub-items first.'); return; }
    if(!b.dataset.armed){ b.dataset.armed='1'; b.textContent='Confirm delete'; toast('This also removes its videos.'); setTimeout(()=>{ delete b.dataset.armed; b.textContent='Delete'; positionTbar(); },4000); positionTbar(); return; }
    delete b.dataset.armed; b.textContent='Delete'; deleteNode(id);
  });
  async function deleteNode(id){
    const vs=videos(id);
    try{ await db.doc('nodes/'+id).delete(); if(selected===id) select(null);
      for(const k of Object.keys(xlinks)){ if(xlinks[k].from===id||xlinks[k].to===id){ delete xlinks[k]; try{ await db.doc('links/'+k).delete(); }catch(e){} } } if(openId===id) closeDrawer();
      deleteFiles(vs); toast('Deleted.'); }
    catch(e){ toast('Could not delete. Try again.'); }
  }

  /* ---------- box style + colour, from the Microtube palette ---------- */
  const BOXES=[{id:'card',label:'Card'},{id:'soft',label:'Tint'},{id:'solid',label:'Solid'},{id:'outline',label:'Outline'}];
  const COLORS=[{id:'auto',label:'Auto'},{id:'hexr',label:'Orange',sw:'linear-gradient(115deg,#F2661A,#FF9D45)'},{id:'flexr',label:'Purple',sw:'linear-gradient(115deg,#C79BEA,#9D86F2 55%,#8AB0F2)'},{id:'aris',label:'Red',sw:'linear-gradient(115deg,#E5352B,#F04A3A)'},{id:'silver',label:'Silver',sw:'linear-gradient(115deg,#F1F2F4,#B9BCC4)'}];
  const THEME_SW={hexr:COLORS[1].sw,flexr:COLORS[2].sw,aris:COLORS[3].sw,other:COLORS[4].sw};
  function boxOf(id){ const b=nodes[id]?.box; return b&&b!=='auto' ? b : (kindOf(id)==='group'?'soft':'card'); }
  function swatchFor(boxId, br){
    const s=el('span','sw'); const cls={hexr:'hexr',flexr:'flexr',aris:'aris',other:'other'}[br]; s.className='sw '+cls;
    if(boxId==='card'){ s.style.background='var(--surface)'; s.style.border='1px solid var(--line)'; }
    if(boxId==='soft'){ s.style.background='linear-gradient(var(--soft),var(--soft)),var(--surface)'; s.style.border='1px solid var(--cl)'; }
    if(boxId==='solid'){ s.style.background='var(--c)'; }
    if(boxId==='outline'){ s.style.background='var(--bg)'; s.style.border='1.5px dashed var(--cl)'; }
    return s;
  }
  function openStylePop(){
    const id=selected; if(!id) return;
    const br=branchOf(id), cur=boxOf(id), col=nodes[id].color||'auto';
    const bo=$('boxOpts'); bo.textContent='';
    BOXES.forEach(x=>{ const b=el('button'); b.type='button'; b.setAttribute('aria-pressed',String(x.id===cur)); b.appendChild(swatchFor(x.id,br)); b.appendChild(document.createTextNode(x.label));
      b.addEventListener('click',()=>saveStyle({box:x.id})); bo.appendChild(b); });
    const co=$('colorOpts'); co.textContent='';
    COLORS.forEach(x=>{ const b=el('button'); b.type='button'; b.setAttribute('aria-pressed',String(x.id===col)); const d=el('span','dot'); d.style.background = x.sw || THEME_SW[themeOf(id)]; if(x.id==='auto') d.style.boxShadow='inset 0 0 0 2px var(--surface)'; b.appendChild(d); b.appendChild(document.createTextNode(x.label));
      b.addEventListener('click',()=>saveStyle({color:x.id})); co.appendChild(b); });
    $('stylepop').hidden=false; $('tStyle').setAttribute('aria-expanded','true'); placePop();
  }
  function closeStylePop(){ $('stylepop').hidden=true; $('tStyle').setAttribute('aria-expanded','false'); $('platpop').hidden=true; $('tPlat').setAttribute('aria-expanded','false'); }
  function placePop(){ const p=$('stylepop').hidden?$('platpop'):$('stylepop'), t=$('tbar').getBoundingClientRect(); const pw=p.offsetWidth, ph=p.offsetHeight;
    let x=Math.max(8,Math.min(window.innerWidth-pw-8,t.left)); let y=t.bottom+6; if(y+ph>window.innerHeight-8) y=t.top-ph-6; p.style.left=x+'px'; p.style.top=Math.max(8,y)+'px'; }
  $('tStyle').addEventListener('click',()=>{ const was=$('stylepop').hidden; closeStylePop(); if(was) openStylePop(); });
  $('tPlat').addEventListener('click',()=>{ const was=$('platpop').hidden; closeStylePop(); if(was) openPlatPop(); });
  function openPlatPop(){
    const id=selected; if(!id) return;
    const cur=Array.isArray(nodes[id].platforms)?nodes[id].platforms:[];
    const box=$('platToggles'); box.textContent='';
    const all=PLATFORMS.concat(cur.filter(v=>!PLATFORMS.some(x=>x.id===v)).map(v=>({id:v,label:v,g:null})));
    all.forEach(x=>{ const b=el('button'); b.type='button'; const on=cur.includes(x.id); b.setAttribute('aria-pressed',String(on));
      b.appendChild(el('span','chk')); if(x.g) b.appendChild(glyph(x.g)); b.appendChild(document.createTextNode(x.label));
      b.addEventListener('click',()=>togglePlatform(x.id)); box.appendChild(b); });
    $('platpop').hidden=false; $('tPlat').setAttribute('aria-expanded','true'); placePop();
  }
  async function togglePlatform(pid){
    const id=selected; if(!id) return;
    const cur=Array.isArray(nodes[id].platforms)?nodes[id].platforms.slice():[];
    const i=cur.indexOf(pid); if(i>=0) cur.splice(i,1); else cur.push(pid);
    nodes[id]={...nodes[id], platforms:cur}; render(); openPlatPop();
    try{ await db.doc('nodes/'+id).update({platforms:cur}); }catch(e){ toast('Could not save. Try again.'); }
  }
  $('platAdd').addEventListener('submit',e=>{
    e.preventDefault(); const v=$('platCustom').value.replace(/\s+/g,' ').trim(); if(!v||!selected) return;
    const known=PLATFORMS.find(x=>x.label.toLowerCase()===v.toLowerCase()); const pid=known?known.id:v;
    const cur=nodes[selected].platforms||[]; $('platCustom').value=''; if(cur.includes(pid)) return; togglePlatform(pid);
  });
  $('platCustom').addEventListener('keydown',e=>e.stopPropagation());
  async function saveStyle(patch){
    const id=selected; if(!id) return;
    nodes[id]={...nodes[id],...patch}; render(); openStylePop();
    try{ await db.doc('nodes/'+id).update(patch); }catch(e){ toast('Could not save the style. Try again.'); }
  }

  /* ---------- inline text editing ---------- */
  function editable(span, ph){ try{ span.contentEditable='plaintext-only'; }catch(e){ span.contentEditable='true'; } if(span.contentEditable!=='plaintext-only') span.contentEditable='true'; span.dataset.ph=ph; span.spellcheck=true; }
  function startEdit(id){
    if(!canEdit || !els[id]) return;
    if(editing && editing!==id) commitEdit();
    closeStylePop();
    const b=els[id]; editing=id; b.classList.add('editing');
    const inner=b.querySelector('.in'); const t=inner.querySelector('.t');
    let n=inner.querySelector('.n, .s');
    if(!n){ n=el('span', (kindOf(id)==='root'||kindOf(id)==='branch')?'s':'n'); n.dataset.added='1'; const after=inner.querySelector('.row')||t; after.insertAdjacentElement('afterend',n); }
    const kind=kindOf(id); const fields=[];
    if(kind==='branch'){
      let kr=inner.querySelector('.krow'); if(!kr){ kr=el('span','krow'); inner.insertBefore(kr,t); }
      let k=kr.querySelector('.k'); if(!k){ k=el('span','k'); kr.insertBefore(k,kr.firstChild); }
      editable(k,'Label'); fields.push(k);
    }
    editable(t,'Name'); fields.push(t);
    if(kind!=='root'){
      let tg=inner.querySelector('.pill');
      if(!tg){ tg=el('span','pill'); const host = kind==='branch' ? inner.querySelector('.krow') : inner.querySelector('.row'); if(host) host.appendChild(tg); else t.insertAdjacentElement('afterend',tg); }
      tg.classList.add('tagf'); editable(tg,'Add tag'); fields.push(tg);
    }
    editable(n,'Add a note'); fields.push(n);
    fields.sort((x,y)=> x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    b._fields=fields;
    fields.forEach(sp=>{
      sp.addEventListener('keydown',onEditKey); sp.addEventListener('paste',onPaste);
      sp.addEventListener('pointerdown',ev=>ev.stopPropagation());
    });
    b.addEventListener('focusout',onEditBlur);
    t.focus(); const r=document.createRange(); r.selectNodeContents(t); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
    positionTbar();
  }
  function onPaste(e){ e.preventDefault(); const txt=(e.clipboardData||window.clipboardData).getData('text/plain').replace(/\s+/g,' '); document.execCommand('insertText',false,txt); }
  function onEditKey(e){
    e.stopPropagation();
    if(e.key==='Escape'){ e.preventDefault(); cancelEdit(); }
    else if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); const f=els[editing]?._fields||[]; const i=f.indexOf(e.target); const nx=f[i+1];
      if(nx){ nx.focus(); const r=document.createRange(); r.selectNodeContents(nx); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return; } commitEdit(); }
  }
  function onEditBlur(e){ const b=els[editing]; if(b && e.relatedTarget && b.contains(e.relatedTarget)) return; setTimeout(()=>{ if(editing && !(els[editing]||{}).contains?.(document.activeElement)) commitEdit(); },0); }
  function endEditUI(){ const id=editing; editing=null; const b=els[id]; if(b){ b.classList.remove('editing'); b.removeEventListener('focusout',onEditBlur); delete b.dataset.sig; } render(); if(b) b.focus({preventScroll:true}); }
  function cancelEdit(){ if(!editing) return; endEditUI(); }
  async function commitEdit(){
    if(!editing) return; const id=editing, b=els[id];
    const t=b?.querySelector('.in .t'), n=b?.querySelector('.in .n, .in .s');
    const title=(t?.textContent||'').replace(/\s+/g,' ').trim()||'Untitled';
    const note=(n?.textContent||'').replace(/\s+/g,' ').trim();
    const clean=x=>(x?.textContent||'').replace(/\s+/g,' ').trim();
    const patch={title, note}; const d0=nodes[id]||{};
    const tg=b?.querySelector('.in .tagf'); if(tg) patch.tag=clean(tg);
    const k=b?.querySelector('.in .krow .k'); if(k && kindOf(id)==='branch') patch.kicker=clean(k);
    if(lang==='zh'){   // editing what's shown in Chinese changes only the Chinese version
      const shown={title:tx(id,'title')||ui('Untitled'), note:tx(id,'note'), tag:tx(id,'tag'), kicker:tx(id,'kicker')};
      const zh={...(d0.zh||{})}; let changedZh=false;
      Object.keys(patch).forEach(key=>{ if((patch[key]||'')!==(shown[key]||'')){ if(patch[key]) zh[key]=patch[key]; else delete zh[key]; changedZh=true; } });
      if(changedZh && nodes[id]) nodes[id]={...nodes[id], zh};
      endEditUI();
      if(changedZh){ try{ await db.doc('nodes/'+id).update({zh}); }catch(e){ toast('Could not save the text. Try again.'); } }
      return;
    }
    const changed = Object.keys(patch).some(key=> (patch[key]||'') !== ((key==='kicker' && d0.kicker==null) ? 'Hardware' : (d0[key]||'')));
    if(changed && nodes[id]) nodes[id]={...nodes[id], ...patch};
    endEditUI();
    if(changed){ try{ await db.doc('nodes/'+id).update(patch); }catch(e){ toast('Could not save the text. Try again.'); } }
  }

  /* ---------- reconnecting a card to a new parent ---------- */
  function validParent(id, target){ return target && target!==id && nodes[target] && !descendants(id).includes(target); }
  let ghost=null;
  function validTarget(id,target){ return connecting && connecting.mode==='link' ? validLink(id,target) : validParent(id,target); }
  function beginConnect(id, mode){
    if(editing) commitEdit();
    closeStylePop(); selectLink(null); connecting={id, mode:mode||'parent', made:0}; vp.classList.add('connecting');
    $('bText').textContent = connecting.mode==='link' ? 'Click cards to connect them to '+(nodes[id].title||'this card')+'. Add as many as you like.' : 'Click the card this should sit under';
    $('bCancel').textContent = connecting.mode==='link' ? 'Done' : 'Cancel';
    $('banner').hidden=false; positionTbar();
    Object.keys(els).forEach(k=>els[k].classList.toggle('invalid', k!==id && !validTarget(id,k)));
    ghost=document.createElementNS('http://www.w3.org/2000/svg','path'); ghost.setAttribute('class','ghost'); links.appendChild(ghost);
    $('bCancel').focus();
  }
  function cancelConnect(){
    if(!connecting) return; const id=connecting.id; connecting=null; vp.classList.remove('connecting'); $('banner').hidden=true;
    Object.values(els).forEach(b=>b.classList.remove('invalid','target')); if(ghost){ ghost.remove(); ghost=null; } select(id);
  }
  async function finishConnect(target){
    if(!connecting) return; const id=connecting.id;
    if(connecting.mode==='link'){
      if(target===id) return;
      if(!validLink(id,target)){ toast('Those two cards are already connected.'); return; }
      await addLink(id,target); els[target]?.classList.add('invalid'); els[target]?.classList.remove('target'); return;
    }
    if(!validParent(id,target)){ if(target===id) return; toast('A card can’t sit under itself or its own sub-items.'); return; }
    cancelConnect();
    if(nodes[id].parent===target){ return; }
    const ks=kids(target); const order=ks.length? Math.max(...ks.map(k=>nodes[k].order??0))+1 : 1;
    nodes[id]={...nodes[id], parent:target, order}; render();
    try{ await db.doc('nodes/'+id).update({parent:target, order}); toast('Moved under '+(nodes[target].title||'that card')+'.'); }
    catch(e){ toast('Could not reconnect. Try again.'); }
  }
  window.addEventListener('pointermove',e=>{
    const from = connecting ? connecting.id : knobDrag ? knobDrag.from : null;
    if(!from||!ghost||!pos[from]) return;
    const r=vp.getBoundingClientRect(); const wx=(e.clientX-r.left-view.x)/view.k, wy=(e.clientY-r.top-view.y)/view.k; const a=pos[from];
    ghost.setAttribute('d',`M ${a.x} ${a.y} L ${wx} ${wy}`);
  });
  $('bCancel').addEventListener('click',cancelConnect);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape') return;
    if(connecting){ cancelConnect(); return; }
    if(selLink){ selectLink(null); return; }
    if(!$('stylepop').hidden || !$('platpop').hidden){ closeStylePop(); return; }
    if(selected && $('drawer').hidden && !editing) select(null);
  });
  window.addEventListener('resize',positionTbar);

  /* ---------- free connectors (any card to any card, as many as you like) ---------- */
  function linkBetween(a,b){ return Object.keys(xlinks).find(k=>{ const L=xlinks[k]; return (L.from===a&&L.to===b)||(L.from===b&&L.to===a); }); }
  function validLink(a,b){ return a && b && a!==b && nodes[a] && nodes[b] && !linkBetween(a,b); }
  async function addLink(a,b){
    try{ const ref=db.collection('links').doc(); xlinks[ref.id]={from:a,to:b,label:''}; drawLinks(); await ref.set({from:a,to:b,label:''}); }
    catch(e){ toast(e&&e.code==='quota_exceeded'?'The map is full.':'Could not add the connector. Try again.'); }
  }
  function startKnob(e,id){
    if(!canEdit) return; e.stopPropagation(); e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    knobDrag={from:id}; vp.classList.add('connecting');
    Object.keys(els).forEach(k=>els[k].classList.toggle('invalid', k!==id && !validLink(id,k)));
    ghost=document.createElementNS('http://www.w3.org/2000/svg','path'); ghost.setAttribute('class','ghost'); links.appendChild(ghost);
    const up=ev=>{
      e.target.removeEventListener('pointerup',up); e.target.removeEventListener('pointercancel',up);
      const from=knobDrag.from; knobDrag=null; vp.classList.remove('connecting');
      Object.values(els).forEach(b=>b.classList.remove('invalid','target')); if(ghost){ ghost.remove(); ghost=null; }
      const hit=document.elementFromPoint(ev.clientX, ev.clientY); const n=hit&&hit.closest&&hit.closest('.node');
      if(ev.type==='pointerup' && n && n.dataset.id!==from){ if(validLink(from,n.dataset.id)) addLink(from,n.dataset.id); else toast('Those two cards are already connected.'); }
    };
    e.target.addEventListener('pointerup',up); e.target.addEventListener('pointercancel',up);
  }
  function selectLink(lid, ev){
    selLink=lid; const bar=$('lbar');
    if(lid){ select(null); }
    drawLinks();
    showLabelForm(false);
    if(!lid){ bar.hidden=true; return; }
    bar.hidden=false;
    $('lLabel').textContent = xlinks[lid] && linkLabel(xlinks[lid]) ? 'Edit label' : 'Add label';
    const bw=bar.offsetWidth, bh=bar.offsetHeight; const x=Math.max(8,Math.min(window.innerWidth-bw-8,(ev?ev.clientX:window.innerWidth/2)-bw/2)); const y=Math.max(8,(ev?ev.clientY:window.innerHeight/2)-bh-14);
    bar.style.left=x+'px'; bar.style.top=y+'px';
  }
  $('lDel').addEventListener('click',async()=>{
    const lid=selLink; if(!lid) return; delete xlinks[lid]; selectLink(null);
    try{ await db.doc('links/'+lid).delete(); }catch(e){ toast('Could not delete the connector. Try again.'); }
  });
  function showLabelForm(on){ $('lLabel').hidden=on; $('lDel').hidden=on; $('lForm').hidden=!on; }
  function linkLabel(L){ return lang==='zh' ? (L.zh&&L.zh.label) || word(L.label) || '' : L.label || ''; }
  $('lLabel').addEventListener('click',()=>{ const lid=selLink; if(!lid) return; showLabelForm(true); $('lInput').value=linkLabel(xlinks[lid]); $('lInput').focus(); $('lInput').select(); });
  $('lInput').addEventListener('keydown',ev=>{ ev.stopPropagation(); if(ev.key==='Escape'){ showLabelForm(false); selectLink(null); } });
  $('lForm').addEventListener('submit',async ev=>{
    ev.preventDefault(); const lid=selLink; if(!lid) return; const label=$('lInput').value.replace(/\s+/g,' ').trim();
    const patch = lang==='zh' ? {zh:{...(xlinks[lid].zh||{}), label}} : {label};
    xlinks[lid]={...xlinks[lid],...patch}; showLabelForm(false); selectLink(null);
    try{ await db.doc('links/'+lid).update(patch); }catch(e){ toast('Could not save the label. Try again.'); }
  });

  /* ---------- local storage layer (same shape the map code expects) ---------- */
  let saveTimer=null, savePending=false, mapTitle='Product & project map', mapTitleZh='';
  function setSave(state){ const e=$('saveState'); if(!e) return; e.dataset.state=state; e.textContent = state==='saving'?'Saving…':state==='error'?'Not saved. Check the project folder.':'All changes saved'; }
  function makeDB(initial, persist){
    const store={nodes:{...(initial.nodes||{})}, links:{...(initial.links||{})}};
    const subs={nodes:[],links:[]};
    const snap=c=>({docs:Object.entries(store[c]).map(([id,d])=>({id,exists:true,data:()=>d}))});
    const flush=async()=>{ clearTimeout(saveTimer); saveTimer=null; if(!savePending) return; savePending=false;
      try{ await persist({title:mapTitle, titleZh:mapTitleZh, nodes:store.nodes, links:store.links}); setSave('saved'); }catch(e){ setSave('error'); } };
    const changed=c=>{ subs[c].forEach(f=>f(snap(c))); if(persist){ savePending=true; setSave('saving'); clearTimeout(saveTimer); saveTimer=setTimeout(flush,400); } };
    const rid=()=>Math.random().toString(36).slice(2,12)+Date.now().toString(36).slice(-6);
    const ref=(c,id)=>({ id,
      async set(d){ store[c][id]={...d}; changed(c); },
      async update(p){ if(!store[c][id]) throw Object.assign(new Error('Missing'),{code:'invalid_argument'}); store[c][id]={...store[c][id],...p}; changed(c); },
      async delete(){ delete store[c][id]; changed(c); } });
    return { doc:path=>{ const [c,id]=path.split('/'); return ref(c,id); },
      collection:c=>({ doc:id=>ref(c,id||rid()), onSnapshot:f=>{ subs[c].push(f); setTimeout(()=>f(snap(c)),0); return ()=>{}; } }),
      touch:()=>changed('nodes'), flush, data:()=>({title:mapTitle, titleZh:mapTitleZh, nodes:store.nodes, links:store.links}) };
  }

  /* ---------- map title (double-click to rename in the editor) ---------- */
  function showTitle(){ const t = lang==='zh' && mapTitleZh || mapTitle; $('mapTitle').textContent=t; document.title=t+' · Microtube'; }
  $('mapTitle').addEventListener('dblclick',()=>{
    if(!canEdit) return; const t=$('mapTitle'); editable(t,'Map name'); t.focus(); const r=document.createRange(); r.selectNodeContents(t); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const done=keep=>{ t.removeAttribute('contenteditable'); t.onkeydown=null; t.onblur=null; if(keep){ const v=t.textContent.replace(/\s+/g,' ').trim(); if(v){ if(lang==='zh') mapTitleZh=v; else mapTitle=v; db.touch(); } } showTitle(); };
    t.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); done(true); } if(e.key==='Escape'){ e.preventDefault(); done(false); } };
    t.onblur=()=>done(true);
  });

  /* ---------- publish ---------- */
  async function runPublish(){
    if(!window.mapAPI) return;
    await db.flush();
    $('pubModal').hidden=false; $('pubResult').hidden=true; $('pubWork').hidden=false; $('pubBar').style.width='0%'; $('pubText').textContent='Choose where to save the viewer…';
    try{
      const r=await window.mapAPI.publish();
      if(!r){ $('pubModal').hidden=true; return; }
      $('pubWork').hidden=true; $('pubResult').hidden=false;
      $('pubSummary').textContent=`${r.mediaCount} media file${r.mediaCount===1?'':'s'} · zip ${fmtSize(r.zipSize)}`;
      $('pubZip').textContent=r.zip; $('pubFolder').textContent=r.folder;
      $('pubShowZip').onclick=()=>window.mapAPI.showInFolder(r.zip);
      $('pubShowFolder').onclick=()=>window.mapAPI.showInFolder(r.folder);
    }catch(e){ $('pubText').textContent='Publishing failed: '+String(e&&e.message||e).replace(/^Error invoking remote method[^:]*: (Error: )?/,''); }
  }
  if(window.mapAPI) window.mapAPI.onPublishProgress(d=>{ $('pubText').textContent=d.text; $('pubBar').style.width=Math.round(d.fraction*100)+'%'; });
  $('publishBtn').addEventListener('click',runPublish);
  $('pubClose').addEventListener('click',()=>{ $('pubModal').hidden=true; });
  $('pubModal').addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Escape') $('pubModal').hidden=true; });

  /* ---------- language button ---------- */
  let publishedAt=null;
  function applyLang(){
    document.documentElement.lang = lang==='zh' ? 'zh-CN' : 'en';
    // Fixed page text is tagged in index.html; its English is kept so it can be switched back.
    document.querySelectorAll('[data-i18n]').forEach(e=>{ if(!e.dataset.en) e.dataset.en=e.textContent; e.textContent=ui(e.dataset.en); });
    document.querySelectorAll('[data-i18n-aria]').forEach(e=>{ if(!e.dataset.enAria) e.dataset.enAria=e.getAttribute('aria-label'); e.setAttribute('aria-label',ui(e.dataset.enAria)); });
    const b=$('langBtn'); b.textContent = lang==='zh' ? 'EN' : '中文'; b.lang = lang==='zh' ? 'en' : 'zh-CN';
    b.setAttribute('aria-label', lang==='zh' ? 'Switch to English' : '切换到中文');
    $('hint').textContent = ui(canEdit
      ? 'Drag the background to move around · scroll or pinch to zoom · drag cards to rearrange · click a card for tools · double-click to edit text'
      : 'Drag to move around · scroll or pinch to zoom · tap a card for details · tap a thumbnail to play');
    if(publishedAt){ const d=new Date(publishedAt); $('pubDate').textContent=ui('Published')+' '+d.toLocaleDateString(lang==='zh'?'zh-CN':undefined,{day:'numeric',month:'short',year:'numeric'}); $('pubDate').hidden=false; }
    showTitle();
  }
  $('langBtn').addEventListener('click',()=>{
    if(editing) commitEdit();
    lang = lang==='zh' ? 'en' : 'zh';
    try{ localStorage.setItem('mapLang',lang); }catch(e){}
    applyLang(); render();
    if(P.id) showVideo(P.i);
    if(selLink) selectLink(null);
  });

  /* ---------- start ---------- */
  applyView();
  (async function start(){
    let data;
    if(window.mapAPI){
      try{ const proj=await window.mapAPI.getProject(); data=proj.data; mediaBase=proj.mediaBase;
        const q=$('tQuality'); q.textContent=''; Object.entries(proj.presets).forEach(([k,label])=>{ const o=document.createElement('option'); o.value=k; o.textContent=label; q.appendChild(o); });
        const o=document.createElement('option'); o.value='original'; o.textContent='Original · no compression'; q.appendChild(o); q.value='high';
        $('projPath').textContent=proj.dir; }
      catch(e){ showState('The project could not open','Check that the project folder still exists, then reopen the app.'); return; }
      canEdit=true; assets=true;
      db=makeDB(data, d=>window.mapAPI.save(d));
      window.mapAPI.onMenu(cmd=>{ if(cmd==='publish') runPublish(); if(cmd==='fit') fitView();
        if(cmd==='clean') db.flush().then(()=>window.mapAPI.cleanUnused(db.data())).then(n=>toast(n?`Removed ${n} unused file${n===1?'':'s'}.`:'No unused files.')); });
      window.addEventListener('beforeunload',()=>{ if(savePending) db.flush(); });
    } else if(window.MAP_DATA){
      data=window.MAP_DATA; mediaBase=''; canEdit=false;
      db=makeDB(data, null);
      publishedAt=data.publishedAt||null;
    } else { showState('No map found','Open this file from a published Microtube Map folder.'); return; }
    mapTitle=data.title||mapTitle; mapTitleZh=data.titleZh||'';
    document.body.classList.toggle('viewer',!canEdit);
    $('tidy').hidden = !canEdit; $('publishBtn').hidden=!canEdit; $('saveState').hidden=!canEdit;
    document.body.classList.toggle('can-edit',canEdit);
    applyLang();
    db.collection('links').onSnapshot(snap=>{
      const next={}; snap.docs.forEach(d=>{ if(d.exists){ const v=d.data(); if(v&&v.from&&v.to) next[d.id]=v; } }); xlinks=next; if(selLink&&!xlinks[selLink]) selectLink(null); else drawLinks();
    });
    db.collection('nodes').onSnapshot(snap=>{
      const next={}; snap.docs.forEach(d=>{ if(d.exists) next[d.id]=d.data(); }); nodes=next; render();
    });
  })();
  function showState(h,p){ const s=$('state'); s.hidden=false; s.querySelector('h2').textContent=h; s.querySelector('p').textContent=p; }
})();
