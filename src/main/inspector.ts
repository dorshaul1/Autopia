// What runs in the preview while you point at things, and only then: an overlay in a shadow root that takes the
// mouse, and goes away completely when you stop. It reads the DOM and whatever development metadata the framework
// already put there, and changes nothing else in your app.

import { WATCHED_STYLES } from '@shared/inspect'

const PICK = String.raw`(function(){
  if (window.__autopiaInspect) window.__autopiaInspect.stop(null);
  var WATCH=${JSON.stringify(WATCHED_STYLES)};
  var host=document.createElement('div');host.setAttribute('data-autopia-inspect','');host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  var root=host.attachShadow({mode:'closed'});
  root.innerHTML='<style>.b{position:fixed;border:2px solid #5cc8ff;background:rgba(92,200,255,.14);border-radius:3px;display:none;box-sizing:border-box}.l{position:fixed;font:600 11px -apple-system,sans-serif;background:#16181d;color:#fff;padding:3px 7px;border-radius:5px;display:none;white-space:nowrap}</style><div class=b id=b></div><div class=l id=l></div>';
  var box=root.getElementById('b'),label=root.getElementById('l');(document.documentElement).appendChild(host);
  var deepAt=function(x,y){var d=document,el=d.elementFromPoint(x,y),ox=0,oy=0;
    while(el){
      if(el.shadowRoot){var i=el.shadowRoot.elementFromPoint(x-ox,y-oy);if(i&&i!==el){el=i;continue}}
      if(el.tagName==='IFRAME'){try{var cd=el.contentDocument;if(cd){var r=el.getBoundingClientRect();ox+=r.left;oy+=r.top;var n=cd.elementFromPoint(x-ox,y-oy);if(n){el=n;continue}}}catch(e){}}
      break}
    return {el:el,ox:ox,oy:oy}};
  var cssEsc=function(s){return (window.CSS&&CSS.escape)?CSS.escape(s):s};
  var selectorOf=function(el){var doc=el.ownerDocument;
    var unique=function(s){try{return doc.querySelectorAll(s).length===1}catch(e){return false}};
    var t=el.getAttribute&&(el.getAttribute('data-testid')||el.getAttribute('data-test'));
    if(t){var q='['+(el.hasAttribute('data-testid')?'data-testid':'data-test')+'="'+t+'"]';if(unique(q))return q}
    if(el.id&&unique('#'+cssEsc(el.id)))return '#'+cssEsc(el.id);
    var parts=[],cur=el;
    for(var i=0;cur&&cur.nodeType===1&&cur!==doc.documentElement&&i<7;i++){var tag=cur.tagName.toLowerCase(),p=cur.parentElement;if(!p){parts.unshift(tag);break}
      var same=[].filter.call(p.children,function(c){return c.tagName===cur.tagName});parts.unshift(same.length>1?tag+':nth-of-type('+(same.indexOf(cur)+1)+')':tag);
      var s=parts.join(' > ');if(unique(s))return s;cur=p}
    return parts.join(' > ')};
  var frameworks=function(el){var names=[],reported=[],seen={};var add=function(f,l,fw){if(f&&!seen[f+l]){seen[f+l]=1;reported.push({file:String(f),line:l||null,framework:fw})}};
    var key=Object.keys(el).find(function(k){return k.indexOf('__reactFiber$')===0||k.indexOf('__reactInternalInstance$')===0});
    if(key){for(var f=el[key],n=0;f&&n<60&&names.length<6;f=f.return,n++){
      var ty=f.type,nm=typeof ty==='function'?(ty.displayName||ty.name):(ty&&typeof ty==='object'&&(ty.displayName||(ty.render&&(ty.render.displayName||ty.render.name))));
      if(nm&&names.indexOf(nm)<0)names.push(nm);
      if(f._debugSource)add(f._debugSource.fileName,f._debugSource.lineNumber,'React')}}
    for(var v=el;v&&names.length<6;v=v.parentElement){var c=v.__vueParentComponent;if(c){for(;c&&names.length<6;c=c.parent){var t=c.type||{},vn=t.name||t.__name;if(vn&&names.indexOf(vn)<0)names.push(vn);if(t.__file)add(t.__file,null,'Vue')}break}
      if(v.__svelte_meta&&v.__svelte_meta.loc){add(v.__svelte_meta.loc.file,v.__svelte_meta.loc.line,'Svelte');break}}
    return {names:names,reported:reported.slice(0,6)}};
  var snap=function(el){var cs=el.ownerDocument.defaultView.getComputedStyle(el),r=el.getBoundingClientRect(),styles={};WATCH.forEach(function(k){styles[k]=cs.getPropertyValue(k)});
    return {text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,240),width:Math.round(r.width),height:Math.round(r.height),styles:styles}};
  var nearOf=function(el){for(var p=el.parentElement,i=0;p&&i<12;p=p.parentElement,i++){var h=p.querySelector&&p.querySelector('h1,h2,h3');var lm=/^(HEADER|NAV|MAIN|FOOTER|ASIDE|SECTION|FORM|DIALOG)$/.test(p.tagName);if(lm||h){var txt=h?(h.innerText||'').trim().slice(0,50):'';return p.tagName.toLowerCase()+(txt?' “'+txt+'”':'')}}return ''};
  var describe=function(el){var a={};[].slice.call(el.attributes||[]).forEach(function(x){if(!/^(style|class|id)$/.test(x.name)&&x.value.length<120&&Object.keys(a).length<10)a[x.name]=x.value});
    var fw=frameworks(el);return {tag:el.tagName.toLowerCase(),selector:selectorOf(el),id:el.id||null,classes:[].slice.call(el.classList||[]).slice(0,10),attrs:a,components:fw.names,reported:fw.reported,near:nearOf(el),page:location.pathname+location.hash,snapshot:snap(el),opaque:/^(CANVAS|IFRAME|EMBED|OBJECT|VIDEO)$/.test(el.tagName)||el.ownerDocument!==document||el.getRootNode()!==el.ownerDocument}};
  var rectOf=function(h){var r=h.el.getBoundingClientRect();return {x:r.left+h.ox,y:r.top+h.oy,width:r.width,height:r.height}};
  var place=function(b,r,t){b.style.display='block';b.style.left=r.x+'px';b.style.top=r.y+'px';b.style.width=r.width+'px';b.style.height=r.height+'px';
    label.textContent=t;label.style.display=t?'block':'none';label.style.left=Math.max(4,r.x)+'px';label.style.top=(r.y>26?r.y-24:r.y+r.height+4)+'px'};
  var EVENTS=['mousemove','mousedown','mouseup','click','pointerdown','pointerup','pointermove','pointerover','pointerout','pointerenter','pointerleave','mouseover','mouseout','mouseenter','mouseleave','dblclick','auxclick','contextmenu','dragstart','touchstart','touchend','keydown','keyup','keypress','submit'];
  var done,down=null,last=null,raf=0;var result=new Promise(function(res){done=res});
  var stop=function(v){EVENTS.forEach(function(t){window.removeEventListener(t,on,true)});window.removeEventListener('scroll',rerun,true);host.remove();delete window.__autopiaInspect;
    // the browser's click still follows this mouseup: it must not reach the app
    var swallow=function(ev){ev.preventDefault();ev.stopImmediatePropagation()};window.addEventListener('click',swallow,true);setTimeout(function(){window.removeEventListener('click',swallow,true)},400);
    done(v)};
  var rerun=function(){if(last&&last.el&&last.el.isConnected)place(box,rectOf(last),'')};
  var on=function(e){
    if(e.type==='keydown'&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stop(null);return}
    // cancelling a pointer event makes the browser drop the mouse events that follow it, and those are what pick
    if(e.type.indexOf('pointer')!==0)e.preventDefault();e.stopImmediatePropagation();
    if(e.type==='mousemove'){var x=e.clientX,y=e.clientY;
      if(down){var dx=x-down.x,dy=y-down.y;if(Math.abs(dx)>6||Math.abs(dy)>6){down.drag=true;place(box,{x:Math.min(x,down.x),y:Math.min(y,down.y),width:Math.abs(dx),height:Math.abs(dy)},Math.abs(dx)+' × '+Math.abs(dy))}return}
      if(raf)return;raf=requestAnimationFrame(function(){raf=0;var h=deepAt(x,y);if(!h.el||h.el===host)return;last=h;var r=rectOf(h);var fw=frameworks(h.el);place(box,r,(fw.names[0]?fw.names[0]+' · ':'')+h.el.tagName.toLowerCase())});return}
    if(e.type==='mousedown'&&e.button===0){down={x:e.clientX,y:e.clientY};return}
    if(e.type==='mouseup'&&down){var d=down;down=null;
      if(d.drag){stop({kind:'region',rect:{x:Math.min(e.clientX,d.x),y:Math.min(e.clientY,d.y),width:Math.abs(e.clientX-d.x),height:Math.abs(e.clientY-d.y)},page:location.pathname+location.hash});return}
      var h=deepAt(e.clientX,e.clientY);if(h.el&&h.el!==document.documentElement&&h.el!==document.body){stop({kind:'element',rect:rectOf(h),element:describe(h.el)})}else{stop({kind:'region',rect:{x:0,y:0,width:innerWidth,height:innerHeight},page:location.pathname+location.hash})}}};
  EVENTS.forEach(function(t){window.addEventListener(t,on,true)});
  window.addEventListener('scroll',rerun,true);
  window.__autopiaInspect={stop:stop};
  return result;
})()`

export const pickScript = PICK
export const cancelScript = `window.__autopiaInspect&&window.__autopiaInspect.stop(null);1`

/** Small numbered dots on what you've marked, kept in place while the page scrolls. Nothing else on the page changes. */
export function markersScript(items: { n: number; selector: string | null; rect: { x: number; y: number } }[]): string {
  return String.raw`(function(){
    if(window.__autopiaMarks)window.__autopiaMarks();
    var items=${JSON.stringify(items)};if(!items.length)return 0;
    var host=document.createElement('div');host.setAttribute('data-autopia-marks','');host.style.cssText='position:fixed;inset:0;z-index:2147483646;pointer-events:none';
    var root=host.attachShadow({mode:'closed'});root.innerHTML='<style>i{position:fixed;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#5cc8ff;color:#0e1116;font:700 11px/18px -apple-system,sans-serif;text-align:center;font-style:normal;box-shadow:0 1px 4px rgba(0,0,0,.45)}</style>';
    var dots=items.map(function(it){var d=document.createElement('i');d.textContent=it.n;root.appendChild(d);return d});
    var place=function(){items.forEach(function(it,i){var el=null;try{el=it.selector&&document.querySelector(it.selector)}catch(e){}var r=el?el.getBoundingClientRect():null;dots[i].style.left=(r?r.left:it.rect.x)+'px';dots[i].style.top=(r?r.top:it.rect.y)+'px';dots[i].style.display=(it.selector&&!el)?'none':'block'})};
    document.documentElement.appendChild(host);place();window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
    window.__autopiaMarks=function(){window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);host.remove();delete window.__autopiaMarks};
    return items.length})()`
}

/** The element as it is now, in the same terms as when you picked it. null: it isn't on the page. */
export function snapshotScript(selector: string): string {
  return String.raw`(function(){var el=null;try{el=document.querySelector(${JSON.stringify(selector)})}catch(e){}if(!el)return null;var cs=getComputedStyle(el),r=el.getBoundingClientRect(),styles={};${JSON.stringify(WATCHED_STYLES)}.forEach(function(k){styles[k]=cs.getPropertyValue(k)});return {text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,240),width:Math.round(r.width),height:Math.round(r.height),styles:styles}})()`
}
