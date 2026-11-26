/* TesteoCDIR 3.0 beta — análisis local, sin enviar imágenes al modelo remoto. */
(function(root){'use strict';
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s.length?s[Math.floor(s.length/2)]:NaN};
const quantile=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.round((s.length-1)*p)]};
function flight(take,land,rate){return (land-take)*rate}
// MP4/MOV no fragmentado: frecuencia media de muestras del track de vídeo.
// No deduce la velocidad física original ni interpreta las listas de edición.
async function metadata(blob){
 const head=async(pos,n)=>new DataView(await blob.slice(pos,pos+n).arrayBuffer());
 const tag=(v,p)=>String.fromCharCode(...Array.from({length:4},(_,i)=>v.getUint8(p+i)));
 let moov=null;
 for(let p=0;p+8<=blob.size;){const h=await head(p,16);let n=h.getUint32(0),skip=8;const type=tag(h,4);if(n===1){if(h.byteLength<16)break;n=Number(h.getBigUint64(8));skip=16}else if(n===0)n=blob.size-p;if(n<skip||p+n>blob.size)break;if(type==='moov'){if(n>32*1024*1024)throw Error('Metadatos demasiado grandes');moov=await head(p+skip,n-skip);break}p+=n}
 if(!moov)return null;
 function boxes(a,b){const arr=[];for(let p=a;p+8<=b;){let n=moov.getUint32(p),h=8;const type=tag(moov,p+4);if(n===1){if(p+16>b)break;n=Number(moov.getBigUint64(p+8));h=16}else if(n===0)n=b-p;if(n<h||p+n>b)break;arr.push({type,a:p+h,b:p+n});p+=n}return arr}
 const child=(box,type)=>box&&boxes(box.a,box.b).find(x=>x.type===type);
 for(const tr of boxes(0,moov.byteLength).filter(x=>x.type==='trak')){const md=child(tr,'mdia'),hd=child(md,'hdlr'),mh=child(md,'mdhd'),st=child(child(child(md,'minf'),'stbl'),'stts');if(!hd||hd.a+12>hd.b||tag(moov,hd.a+8)!=='vide'||!mh||!st)continue;const tsOff=mh.a+(moov.getUint8(mh.a)===1?20:12);if(tsOff+4>mh.b||st.a+8>st.b)continue;const ts=moov.getUint32(tsOff),entries=moov.getUint32(st.a+4);if(!ts||entries>(st.b-st.a-8)/8)continue;let count=0,duration=0,min=Infinity,max=0;for(let i=0;i<entries;i++){let p=st.a+8+i*8,n=moov.getUint32(p),d=moov.getUint32(p+4);if(!n||!d)continue;count+=n;duration+=n*d;min=Math.min(min,d);max=Math.max(max,d)}if(count&&duration)return {fps:count*ts/duration,count,trackDuration:duration/ts,variable:max/min>1.05,hasEdits:!!child(tr,'edts')};}
 return null;
}

// Los tiempos de vídeo son independientes de la velocidad de reproducción del reproductor.
function samplePose(lm,t){
 if(!lm||lm.length<33)return {t,ok:false};
 const good=(i,v=.30)=>lm[i]&&Number.isFinite(lm[i].y)&&Number.isFinite(lm[i].x)&&lm[i].x>-.03&&lm[i].x<1.03&&lm[i].y>-.03&&lm[i].y<1.03&&(lm[i].visibility??1)>=v;
 const hips=[23,24].filter(i=>good(i,.25));
 const hip=hips.length?median(hips.map(i=>lm[i].y)):NaN;
 const feet=[0,1].map(i=>{const toe=31+i,heel=29+i,ankle=27+i;const usable=[toe,heel].filter(j=>good(j));return usable.length?Math.max(...usable.map(j=>lm[j].y)):good(ankle,.5)?lm[ankle].y+.025:NaN});
 const scale=Math.max(...feet.filter(Number.isFinite))-hip;
 return {t,ok:feet.every(Number.isFinite),feet,hip,scale};
}
const finite=Number.isFinite;
function plausible(d,rate){return finite(rate)?d*rate>=.15&&d*rate<=1.05:[1,.5,.25,.2,.125,.1].some(r=>d*r>=.15&&d*r<=1.05)}
function candidate(samples,rate,options={}){
 if(samples.length<8)throw Error('No hay suficientes fotogramas.');
 const step=median(samples.slice(1).map((s,i)=>s.t-samples[i].t));
 const valid=samples.filter(s=>s.ok&&s.feet?.every(finite));
 if(valid.length<8||valid.length/samples.length<.35)throw Error('No se ven los pies en suficientes fotogramas.');
 const scale=median(valid.map(s=>s.scale).filter(v=>finite(v)&&v>.04));
 const eps=options.eps??Math.max(.0035,Math.min(.016,(finite(scale)?scale:.35)*.023));
 // Interpolación únicamente de huecos cortos rodeados por muestras válidas.
 const ss=samples.map(s=>({...s,feet:s.feet?.slice()}));
 for(let i=0;i<ss.length;i++){if(ss[i].ok)continue;let a=i-1,b=i;while(b<ss.length&&!ss[b].ok)b++;if(a>=0&&b<ss.length&&ss[a].ok&&b-i<=3){for(let j=i;j<b;j++){const u=(j-a)/(b-a);ss[j].feet=[0,1].map(k=>ss[a].feet[k]*(1-u)+ss[b].feet[k]*u);ss[j].hip=ss[a].hip*(1-u)+ss[b].hip*u;ss[j].ok=true;ss[j].filled=true}}i=b-1;}
 // Niveles de suelo robustos por pie; el usuario puede aportar referencias explícitas.
 const base=options.base||[0,1].map(k=>quantile(valid.map(s=>s.feet[k]),.86));
 const raw=ss.map(s=>s.ok?Math.min(...s.feet.map((v,k)=>base[k]-v)):NaN);
 const sm=raw.map((v,i)=>finite(v)?median(raw.slice(Math.max(0,i-1),i+2).filter(finite)):NaN);
 const airborne=(i)=>finite(sm[i])&&sm[i]>eps;
 const support=(i)=>finite(raw[i])&&raw[i]<eps*.85;
 const proposals=[];
 for(let i=0;i<ss.length;){if(!airborne(i)){i++;continue}const a=i;let last=i;while(++i<ss.length){if(airborne(i)){last=i;continue}if(i-last<=2&&i+1<ss.length&&airborne(i+1)&&(!finite(sm[i])||sm[i]>eps*.35))continue;break}const b=last+1;
  if(b>=ss.length||a<1||b-a<3)continue;
  const look=Math.max(4,Math.ceil(Math.min(.45,step*12)/step));
  const pre=Array.from({length:Math.min(a,look)},(_,j)=>a-1-j).filter(support);
  const post=Array.from({length:Math.min(ss.length-b,look)},(_,j)=>b+j).filter(support);
  if(!pre.length||!post.length)continue;
  // Busca el cruce más próximo al apoyo, con un umbral menor que el de inicio de vuelo.
  let take=a,land=b;
  while(take>pre[0]+1&&finite(raw[take-1])&&raw[take-1]>eps*.45)take--;
  while(land<post[0]&&finite(raw[land])&&raw[land]>eps*.45)land++;
  if(!finite(raw[take])||!finite(raw[land]))continue;
  const d=ss[land].t-ss[take].t;if(!plausible(d,rate))continue;
  const peak=Math.max(...sm.slice(a,b).filter(finite));if(peak<eps*1.65)continue;
  const middleHip=ss.slice(a,b).map(s=>s.hip).filter(finite),edgeHip=[...ss.slice(Math.max(0,a-4),a),...ss.slice(b,b+4)].map(s=>s.hip).filter(finite);
  const rise=middleHip.length&&edgeHip.length?median(edgeHip)-Math.min(...middleHip):0;
  const coverage=ss.slice(take,land+1).filter(s=>s.ok&&!s.filled).length/(land-take+1);
  if(coverage<.65)continue;
  const score=(peak/eps)*Math.sqrt(b-a)*coverage*(rise>eps?1.2:1);
  proposals.push({take:ss[take].t,land:ss[land].t,score,peak,coverage,gap:step,method:options.method||'pose',uncertain:coverage<.9||!!ss[take].filled||!!ss[land].filled});
 }
 proposals.sort((a,b)=>b.score-a.score);
 if(!proposals.length)throw Error('No se encontró un vuelo con apoyo antes y después. Prueba un tramo corto con un solo salto o el seguimiento de pies.');
 if(proposals.length>1&&proposals[1].score>proposals[0].score*.65)throw Error('Se detectaron varios saltos posibles. Acota el intervalo a uno solo.');
 return {...proposals[0],base,alternatives:proposals.length-1};
}
const CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
const MODEL='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
function timeout(p,ms,msg){let timer;return Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(msg)),ms))]).finally(()=>clearTimeout(timer))}
let modelPromise=null;
async function model(){
 if(!modelPromise){modelPromise=(async()=>{const m=await timeout(import(CDN+'/vision_bundle.mjs'),18000,'No se pudo descargar el motor de visión');const fs=await timeout(m.FilesetResolver.forVisionTasks(CDN+'/wasm'),15000,'No se pudieron cargar las librerías de visión');return timeout(m.PoseLandmarker.createFromOptions(fs,{baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},runningMode:'IMAGE',numPoses:1,minPoseDetectionConfidence:.35,minPosePresenceConfidence:.35,minTrackingConfidence:.35}),25000,'El modelo no pudo iniciarse')})();modelPromise.catch(()=>{modelPromise=null})}return modelPromise;
}
function seek(v,t){return new Promise((resolve,reject)=>{let timer;const finish=(error)=>{clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('loadeddata',done);v.removeEventListener('error',fail);error?reject(error):resolve()};const done=()=>{if(v.readyState>=2&&!v.seeking)finish()},fail=()=>finish(Error('No se pudo decodificar un fotograma'));if(Math.abs(v.currentTime-t)<.0001&&v.readyState>=2&&!v.seeking)return resolve();v.addEventListener('seeked',done);v.addEventListener('loadeddata',done);v.addEventListener('error',fail);timer=setTimeout(()=>finish(Error('El navegador no respondió al buscar un fotograma')),8000);v.currentTime=t;done()})}
function canvasFor(video,limit){const canvas=document.createElement('canvas');const scale=Math.min(1,limit/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));return {canvas,ctx:canvas.getContext('2d',{alpha:false,willReadFrequently:true})}}
async function scan(video,{start,end,fps,progress,cancel},detector){
 const step=1/Math.min(90,Math.max(15,fps||30)),n=Math.floor((end-start)/step)+1;
 if(n>2750)throw Error('Acorta el intervalo de análisis.');
 const {canvas,ctx}=canvasFor(video,640),samples=[];
 for(let i=0;i<n;i++){
  if(cancel())throw Error('Análisis cancelado');const t=Math.min(video.duration-.002,start+i*step);await seek(video,t);if(cancel())throw Error('Análisis cancelado');
  ctx.drawImage(video,0,0,canvas.width,canvas.height);let result=detector.detect(canvas);samples.push(samplePose(result.landmarks?.[0],t));
  if(i%6===0){progress(`Detectando pies y cadera · ${Math.round((i+1)/n*100)} %`);await new Promise(r=>setTimeout(r,0))}
 }
 return samples;
}
// Alternativa sin modelo externo: seguimiento de dos plantillas visuales de los pies.
// Las dos referencias se obtienen en un fotograma de apoyo anterior al salto.
function gray(ctx,w,h){const rgba=ctx.getImageData(0,0,w,h).data,arr=new Uint8Array(w*h);for(let i=0,j=0;i<arr.length;i++,j+=4)arr[i]=(rgba[j]*77+rgba[j+1]*150+rgba[j+2]*29)>>8;return arr}
function patch(img,w,h,x,y,r){const a=[];for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)return null;a.push(img[(y+dy)*w+x+dx])}const m=a.reduce((x,y)=>x+y,0)/a.length;const centered=a.map(v=>v-m),norm=Math.sqrt(centered.reduce((a,v)=>a+v*v,0));return {centered,norm}}
function track(img,w,h,ref,last,r,range){let best=null;const evaluate=(x,y)=>{const p=patch(img,w,h,x,y,r);if(!p||p.norm<12||ref.norm<12)return;let dot=0;for(let j=0;j<p.centered.length;j++)dot+=p.centered[j]*ref.centered[j];const corr=dot/(p.norm*ref.norm);const score=corr-.0014*Math.hypot(x-last.x,y-last.y);if(!best||score>best.score)best={x,y,score,corr}};for(let y=Math.max(r,last.y-range);y<=Math.min(h-r-1,last.y+range);y+=2)for(let x=Math.max(r,last.x-range);x<=Math.min(w-r-1,last.x+range);x+=2)evaluate(x,y);if(best){const b={...best};for(let y=b.y-2;y<=b.y+2;y++)for(let x=b.x-2;x<=b.x+2;x++)evaluate(x,y)}return best&&best.corr>.48?best:null}
async function trackFeet(video,opts){
 const {start,end,fps,rate,progress,cancel,points,reference}=opts;
 if(!points||points.length!==2)throw Error('Marca visualmente los dos pies en apoyo antes de iniciar el seguimiento.');
 const {canvas,ctx}=canvasFor(video,320),w=canvas.width,h=canvas.height,r=Math.max(3,Math.round(h*.014));
 const read=async(t)=>{await seek(video,t);ctx.drawImage(video,0,0,w,h);return gray(ctx,w,h)};
 const first=await read(reference);const origins=points.map(p=>({x:Math.round(p.x*w),y:Math.round(p.y*h)}));const refs=origins.map(p=>patch(first,w,h,p.x,p.y,r));if(refs.some(p=>!p||p.norm<30))throw Error('Los puntos no tienen suficiente contraste. Marca el borde de cada zapatilla.');
 const step=1/Math.min(60,Math.max(20,fps||30)),n=Math.floor((end-reference)/step)+1;const samples=[];let last=origins.map(p=>({...p}));
 for(let i=0;i<n;i++){if(cancel())throw Error('Análisis cancelado');const t=Math.min(video.duration-.002,reference+i*step),img=await read(t);const hits=refs.map((p,j)=>track(img,w,h,p,last[j],r,Math.max(9,Math.round(h*step*1.25))));hits.forEach((hit,j)=>{if(hit)last[j]=hit});const feet=hits.map(p=>p?p.y/h:NaN);samples.push({t,ok:feet.every(finite),feet,scale:.35});if(i%8===0){progress(`Siguiendo ambos pies · ${Math.round((i+1)/n*100)} %`);await new Promise(r=>setTimeout(r,0))}}
 return candidate(samples,rate,{base:origins.map(p=>p.y/h),eps:Math.max(2/h,.005),method:'seguimiento local'});
}
async function analyze(video,opts){
 const {start,end,rate,progress,cancel}=opts;if(!finite(start)||!finite(end)||end-start<.5||end-start>30.01)throw Error('Selecciona entre 0,5 y 30 segundos, con un solo salto.');
 if(opts.points)return trackFeet(video,opts);
 progress('Cargando detector de pose (primera vez requiere internet)…');
 const detector=await model();if(cancel())throw Error('Análisis cancelado');
 const coarseFps=Math.min(30,Math.max(15,opts.fps||30));const samples=await scan(video,{...opts,fps:coarseFps},detector);const first=candidate(samples,rate);if(opts.fps<=coarseFps+1||cancel())return first;try{const margin=Math.max(.25,first.gap*6),refined=await scan(video,{...opts,start:Math.max(start,first.take-margin),end:Math.min(end,first.land+margin),fps:Math.min(90,opts.fps),progress:t=>progress('Afinando marcas · '+t)},detector);return candidate(refined,rate,{base:first.base})}catch(e){if(cancel())throw e;return {...first,uncertain:true}}
}
root.CDIRJump={metadata,analyze,candidate,flight,samplePose,track,patch};if(typeof module!=='undefined')module.exports=root.CDIRJump;
})(typeof window!=='undefined'?window:globalThis);
