(() => {
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const path=location.pathname.split('/').pop()||'index.html';
  qsa('.nav-links a').forEach(a=>{ if(a.getAttribute('href')===path) a.classList.add('active'); });

  const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');if(e.target.matches('.manifesto p'))e.target.classList.add('in-view')}}),{threshold:.14});
  qsa('.reveal,.manifesto p').forEach(el=>io.observe(el));

  const cursor=qs('.cursor');
  if(cursor && matchMedia('(pointer:fine)').matches){
    addEventListener('pointermove',e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px'});
    qsa('a,button,.game-shell').forEach(el=>{el.addEventListener('pointerenter',()=>cursor.classList.add('big'));el.addEventListener('pointerleave',()=>cursor.classList.remove('big'))});
  }

  const shell=qs('.game-shell');
  if(shell && matchMedia('(pointer:fine)').matches){
    shell.addEventListener('pointermove',e=>{const r=shell.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5;const y=(e.clientY-r.top)/r.height-.5;shell.style.transform=`rotateY(${x*10-5}deg) rotateX(${-y*7+2}deg) translateZ(0)`});
    shell.addEventListener('pointerleave',()=>shell.style.transform='rotateY(-7deg) rotateX(3deg)');
  }

  qsa('[data-parallax]').forEach(el=>addEventListener('pointermove',e=>{const x=e.clientX/innerWidth-.5,y=e.clientY/innerHeight-.5;el.style.transform=`translate3d(${x*18}px,${y*14}px,0)`}));
})();
