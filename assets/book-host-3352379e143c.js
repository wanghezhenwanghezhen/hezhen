(() => {
  if (new URL(location.href).searchParams.get('edition') === 'paper' || window.GameArtBook) return;
  const channel='game-art-handbook-v1';
  let opened=null;
  function openBook(href,trigger=document.activeElement,anchor='') {
    const url=new URL(href,location.href);
    if (!['https:','http:','file:'].includes(url.protocol) || opened) return;
    const start=anchor||decodeURIComponent(url.hash.slice(1));
    url.hash='';url.searchParams.set('edition','paper');
    const destination=url.protocol==='file:'?'*':url.origin;
    const host=document.createElement('div');
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
    :host{all:initial}.shelf{--ink:#f8f5e9;box-sizing:border-box;position:fixed;inset:0;margin:auto;border:0;outline:0;padding:0;background:transparent;color:var(--ink);width:100%;height:100%;max-width:none;max-height:none;font:14px/1.4 Arial,"Microsoft YaHei",sans-serif}
    .shelf[open]{display:grid;place-items:center}.shelf::backdrop{background:rgba(22,28,29,.63);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}
    .desk{position:relative;width:min(1240px,calc(100% - 88px));height:min(900px,calc(100% - 114px));min-height:0;display:grid;grid-template-rows:minmax(0,1fr) 40px;gap:12px}
    .binding{position:relative;isolation:isolate;min-width:0;min-height:0;padding:3px 4px 6px;border-radius:6px 8px 7px 5px;background:#294c42;box-shadow:0 24px 56px #05120e88,0 5px 12px #06130e80}
    .binding::before{content:"";position:absolute;inset:5px 2px 0;background:repeating-linear-gradient(to bottom,#b4ac96 0 1px,#ece6d4 1px 3px);border-radius:5px;z-index:-1}
    iframe{width:100%;height:100%;display:block;border:0;border-radius:3px;background:#faf8ef}.close{box-sizing:border-box;position:absolute;right:-20px;top:-45px;width:38px;height:38px;background:#151e1df2;color:white;border:1px solid #fff8;border-radius:50%;font:30px/1 Arial;display:grid;place-items:center;cursor:pointer}
    .tools{display:flex;align-items:center;justify-content:center;gap:10px;min-width:0}.tools button,.tools select{box-sizing:border-box;min-height:36px;background:#202927;color:#fff;border:1px solid #d7decd6b;border-radius:4px;font:600 13px/1.2 Arial,"Microsoft YaHei",sans-serif;padding:6px 11px;cursor:pointer}.tools select{max-width:175px}.tools button:disabled{opacity:.4;cursor:default}.count{min-width:80px;text-align:center;font-variant-numeric:tabular-nums;color:white}.hint{position:absolute;z-index:1;inset:42% 0 auto;text-align:center;color:#423e31}.hint[hidden]{display:none}button:focus-visible,select:focus-visible{outline:3px solid #ffdc20;outline-offset:2px}
    @media(max-width:700px){.desk{width:calc(100% - 22px);height:calc(100% - 94px - env(safe-area-inset-top) - env(safe-area-inset-bottom));gap:10px;grid-template-rows:minmax(0,1fr) 42px}.close{top:-41px;right:0;width:35px;height:35px}.tools{gap:5px}.tools select{min-width:0;max-width:105px}.tools button,.tools select{font-size:12px;padding:6px 8px}.count{min-width:48px;font-size:12px}}
    @media(max-height:480px){.desk{height:calc(100% - 52px);width:calc(100% - 100px);gap:4px;grid-template-rows:minmax(0,1fr) 34px}.close{right:-43px;top:0}}
    </style><dialog class="shelf" aria-label="游戏视觉设计手册 · 翻页阅读"><div class="desk"><button class="close" type="button" aria-label="关闭手册，返回原页面" title="关闭手册（Esc）">×</button><div class="binding"><span class="hint">正在排版…</span><iframe title="游戏视觉设计手册 · 书页"></iframe></div><nav class="tools" aria-label="翻页工具"><select aria-label="跳转章节"><option>目录</option></select><button data-action="prev" type="button" disabled>← 上一页</button><span class="count" aria-live="polite">—</span><button data-action="next" type="button" disabled>下一页 →</button></nav></div></dialog>`;
    document.body.append(host);
    const dialog=shadow.querySelector('dialog'),frame=shadow.querySelector('iframe'),close=shadow.querySelector('.close'),select=shadow.querySelector('select');
    const prev=shadow.querySelector('[data-action=prev]'),next=shadow.querySelector('[data-action=next]');
    // Deployed editions can be a scrolling handbook or a paginated one.
    const tools=shadow.querySelector('.tools'), hint=shadow.querySelector('.hint');
    let paginated=false, editionTimer;
    frame.addEventListener('load',()=>{
      clearTimeout(editionTimer);
      editionTimer=setTimeout(()=>{
        if(paginated||!dialog.open)return;
        hint.hidden=true;tools.style.visibility='hidden';
        if(start && url.origin===location.origin)frame.contentDocument?.getElementById(start)?.scrollIntoView();
      },350);
    });
    const send=(act,extra={})=>frame.contentWindow?.postMessage({channel,act,...extra},destination);
    const scroll=document.documentElement.style.overflow;
    document.documentElement.style.overflow='hidden';
    function finish(){if(opened!==dialog)return;opened=null;clearTimeout(editionTimer);window.removeEventListener('message',receive);host.remove();document.documentElement.style.overflow=scroll;trigger?.focus?.({preventScroll:true})}
    function receive(ev){
      if(ev.source!==frame.contentWindow || (url.protocol!=='file:'&&ev.origin!==url.origin) || ev.data?.channel!==channel)return;
      const msg=ev.data;
      if(msg.act==='ready'||msg.act==='state'){paginated=true;hint.hidden=true;tools.style.visibility=''}
      if(msg.act==='ready'){send('init',{anchor:start});shadow.querySelector('.hint').hidden=true}
      if(msg.act==='state'){
        prev.disabled=!msg.canPrev;next.disabled=!msg.canNext;shadow.querySelector('.count').textContent=msg.label;
        if(!select.dataset.ready){select.replaceChildren(...msg.chapters.map(([id,title])=>new Option(title,id)));select.dataset.ready='1'}
        select.value=msg.section;
      }
      if(msg.act==='close')dialog.close();
    }
    window.addEventListener('message',receive);dialog.addEventListener('close',finish,{once:true});
    dialog.addEventListener('cancel',e=>{e.preventDefault();dialog.close()});
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
    dialog.addEventListener('keydown',e=>{if(e.target===select)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();send(e.key==='ArrowLeft'?'prev':'next')}});
    close.onclick=()=>dialog.close();prev.onclick=()=>send('prev');next.onclick=()=>send('next');
    select.onchange=()=>send('goto',{anchor:select.value});opened=dialog;dialog.showModal();close.focus();frame.src=url.href;
  }
  function bookAnchor(ev){
    if(ev.defaultPrevented||ev.button!==0||ev.ctrlKey||ev.metaKey||ev.altKey||ev.shiftKey)return;
    const link=ev.target.closest?.('a[href]');if(!link||link.hasAttribute('download'))return;
    const known=/儿童怎样读懂一个游戏世界_研究图册\.html$/u;
    let named=false;try{const target=new URL(link.href);named=known.test(decodeURIComponent(target.pathname))||(target.origin===location.origin&&/\/projects\/project-03\/(?:index\.html)?$/.test(target.pathname))}catch{}
    if(!link.hasAttribute('data-game-art-book')&&(!named||link.getAttribute('href').startsWith('#')))return;
    ev.preventDefault();openBook(link.href,link,link.dataset.bookStart||'');
  }
  document.addEventListener('click',bookAnchor);
  window.GameArtBook=Object.freeze({open:openBook});
  if(location.hash.startsWith('#flipbook')&&document.querySelector('.book-open')){
    const button=document.querySelector('.book-open');
    openBook(location.href.split('#')[0],button,location.hash.split('/')[1]||'cover');
  }
})();
