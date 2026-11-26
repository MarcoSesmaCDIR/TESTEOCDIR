(()=>{'use strict';
const $=id=>document.getElementById(id),G=9.81;
const S={db:null,persistent:true,teams:[],players:[],tests:[],page:'dashboard',profileId:null,videoBlob:null,videoId:null,videoName:'',videoUrl:null,videoReady:false,take:null,land:null,reviewId:null,busy:false};
const video=$('video');
const uid=()=> (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const isoToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dateLabel=v=>{if(!v)return '—';let p=v.split('-');return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:v};
const num=(v,d=1)=>Number(v).toLocaleString('es-ES',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byName=(a,b)=>a.name.localeCompare(b.name,'es');
const getTeam=id=>S.teams.find(x=>x.id===id);
const getPlayer=id=>S.players.find(x=>x.id===id);
const getTests=id=>S.tests.filter(t=>t.playerId===id).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||''));
const sortLatest=arr=>[...arr].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
const kindBadge=t=>`<span class="pilltype ${t==='Abalakov'?'abk':t==='SJ'?'sj':''}">${esc(t)}</span>`;
const baselineHeight=(p,type)=>{const key=type==='CMJ'?'cmjCm':type==='Abalakov'?'abalakovCm':null;const v=key?p?.evaluationBaseline?.tests?.[key]:null;return typeof v==='number'&&Number.isFinite(v)&&v>0?v:null};

const blank=(title,sub)=>`<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`;
let toastTimer;
function notify(msg,error=false){let t=$('toast');t.textContent=msg;t.className='toast'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4500)}
function busy(on,title='Procesando...',msg='Mantén esta pestaña abierta.'){S.busy=on;$('loading').classList.toggle('hidden',!on);$('loadingTitle').textContent=title;$('loadingMessage').textContent=msg}
function openModal(id){let d=$(id);if(!d.open)d.showModal()}
function closeModal(id){if($(id).open)$(id).close()}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.close)));
// IndexedDB: datos y vídeos se almacenan localmente; sin servidor ni servicios externos.
const stores=['teams','players','tests','videos','sessions','attendance','tombstones','videoRefs'];
function openDatabase(){return new Promise((res,rej)=>{if(!('indexedDB'in window)){rej(new Error('IndexedDB no disponible'));return}const request=indexedDB.open('TesteoCDIR_v1',2);request.onupgradeneeded=()=>{const db=request.result;for(const name of stores)if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'})};request.onsuccess=()=>res(request.result);request.onerror=()=>rej(request.error)})}
const volatile=Object.fromEntries(stores.map(k=>[k,new Map()]));
function dbRead(store,id){if(!S.db)return Promise.resolve(volatile[store].get(id));return new Promise((res,rej)=>{const tx=S.db.transaction(store,'readonly'),r=tx.objectStore(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function dbAll(store){if(!S.db)return Promise.resolve([...volatile[store].values()]);return new Promise((res,rej)=>{const tx=S.db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const syncedStores=new Set(['teams','players','tests','sessions','attendance']);
function commit(operations,{remote=false}={}){
 const ts=new Date().toISOString(),ops=[];
 for(const [op,store,value] of operations){
  if(op==='put'&&syncedStores.has(store)&&!remote){ops.push(['put',store,{...value,updatedAt:ts}]);ops.push(['delete','tombstones',store+':'+value.id]);}
  else {ops.push([op,store,value]); if(op==='delete'&&syncedStores.has(store)&&!remote)ops.push(['put','tombstones',{id:store+':'+value,store,recordId:value,deletedAt:ts}]);}
 }
 let result;
 if(!S.db){for(const [op,store,value] of ops){if(op==='clear')volatile[store].clear();else if(op==='put')volatile[store].set(value.id,value);else if(op==='delete')volatile[store].delete(value)}result=Promise.resolve()}
 else result=new Promise((resolve,reject)=>{const names=[...new Set(ops.map(x=>x[1]))];let tx;try{tx=S.db.transaction(names,'readwrite');for(const [op,store,value] of ops){const os=tx.objectStore(store);if(op==='put')os.put(value);else if(op==='delete')os.delete(value);else if(op==='clear')os.clear()}tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('Error al guardar'));tx.onabort=()=>reject(tx.error||new Error('Operación cancelada'))}catch(e){reject(e)}});
 if(!remote&&ops.some(op=>syncedStores.has(op[1])||op[1]==='videos'))return result.then(()=>{scheduleSync();return undefined});
 return result;
}
async function reload(){[S.teams,S.players,S.tests,S.sessions,S.attendance]=await Promise.all(['teams','players','tests','sessions','attendance'].map(dbAll));S.teams.sort(byName);S.players.sort(byName);S.sessions.sort((a,b)=>b.date.localeCompare(a.date))}
function page(name){S.page=name;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id==='page-'+name));document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));render();window.scrollTo({top:0,behavior:'instant'})}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>page(b.dataset.page)));
function optionsFor(select,items,selected,allLabel,placeholder){let out='';if(allLabel!==null)out+=`<option value="all">${esc(allLabel)}</option>`;if(placeholder)out+=`<option value="">${esc(placeholder)}</option>`;out+=items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');select.innerHTML=out;if(selected!==null&&[...select.options].some(o=>o.value===selected))select.value=selected}
function render(){if(S.page==='dashboard')renderDashboard();if(S.page==='players')renderPlayers();if(S.page==='profile')renderProfile();if(S.page==='measure')renderMeasureOptions();if(S.page==='history')renderHistory();if(S.page==='weekly')renderWeekly();if(S.page==='cloud')renderCloud()}
function renderDashboard(){
 $('dashTeams').textContent=S.teams.length;$('dashPlayers').textContent=S.players.length;$('dashTests').textContent=S.tests.length;
 $('dashDate').textContent=S.tests.length?dateLabel(sortLatest(S.tests)[0].date):'—';$('welcomeImport').classList.toggle('hidden',S.players.length>0);
 $('dashTeamList').innerHTML=S.teams.length?S.teams.map(t=>{const count=S.players.filter(p=>p.teamId===t.id).length,tests=S.tests.filter(x=>getPlayer(x.playerId)?.teamId===t.id).length;return `<div class="teamitem"><div><div class="teamname">${esc(t.name)}</div><div class="teammeta">${esc(t.category||'Sin categoría')} · ${tests} test</div></div><span class="count">${count} jugadores</span></div>`}).join(''):blank('Todavía no hay equipos','Añade tu primer equipo para comenzar.');
 let recent=sortLatest(S.tests).slice(0,6);$('dashRecent').innerHTML=recent.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Jugador</th><th>Tipo</th><th>Altura</th></tr></thead><tbody>${recent.map(t=>`<tr><td>${dateLabel(t.date)}</td><td>${esc(getPlayer(t.playerId)?.name||'Jugador eliminado')}</td><td>${kindBadge(t.type)}</td><td class="strong mono">${num(t.height)} cm</td></tr>`).join('')}</tbody></table></div>`:renderDashboardBaseline()}
function renderDashboardBaseline(){
 const p=S.players.filter(p=>baselineHeight(p,'CMJ')!=null||baselineHeight(p,'Abalakov')!=null);
 if(!p.length)return blank('Sin mediciones','Importa la evaluación del CMA o realiza un test para ver resultados.');
 const nCMJ=p.filter(p=>baselineHeight(p,'CMJ')!=null).length,nABK=p.filter(p=>baselineHeight(p,'Abalakov')!=null).length;
 return `<div class="baseline-alert"><strong>Referencias de pretemporada 2026/27</strong><p class="small">${nCMJ} resultados CMJ · ${nABK} Abalakov · fecha exacta no disponible</p><p class="small">Abre una ficha de jugador o entra en Historial para verlos. No cuentan como tests semanales fechados.</p></div>`;
}
function renderPlayers(){const teamSelect=$('filterPlayerTeam');optionsFor(teamSelect,S.teams,teamSelect.value||'all','Todos los equipos');const search=$('searchPlayers').value.trim().toLocaleLowerCase('es');const group=teamSelect.value;const players=S.players.filter(p=>(group==='all'||p.teamId===group)&&((p.name+' '+(p.number||'')).toLocaleLowerCase('es').includes(search)));
 $('playersList').innerHTML=players.length?players.map(p=>{
 const tests=getTests(p.id),cmj=tests.filter(t=>t.type==='CMJ').at(-1),abk=tests.filter(t=>t.type==='Abalakov').at(-1);
 const metric=(t,type)=>{const pre=baselineHeight(p,type);return `<strong>${t?num(t.height)+' cm':pre!=null?num(pre)+' cm':'—'}</strong>${!t&&pre!=null?'<span class="baseline-tag">Pretemporada · sin fecha</span>':t?'<span class="baseline-tag">Último test fechado</span>':''}`};
 return `<button class="player-card" data-profile="${esc(p.id)}"><div class="person-head"><span class="avatar">${esc((p.name.trim()[0]||'?').toUpperCase())}</span><div style="min-width:0"><b>${esc(p.name)}</b><span class="teamtext">${esc(getTeam(p.teamId)?.name||'Sin equipo')}${p.number?' · #'+esc(p.number):''}</span></div></div><div class="person-stats"><span>CMJ${metric(cmj,'CMJ')}</span><span>Abalakov${metric(abk,'Abalakov')}</span><span>${tests.length} test fechados</span></div><div class="tiny muted" style="margin-top:10px">${p.heightCm!=null?num(p.heightCm)+' cm':'Altura —'} · ${p.weightKg!=null?num(p.weightKg)+' kg':'Peso —'}</div></button>`
 }).join(''):blank('No hay jugadores para mostrar','Crea un jugador o modifica los filtros.');
 document.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>openProfile(b.dataset.profile)))}
function openProfile(id){if(!getPlayer(id))return;S.profileId=id;page('profile')}
function progressPair(tests,type){
 const data=tests.filter(x=>x.type===type);
 if(!data.length)return {last:null,first:null,previous:null,delta:null,pct:null};
 const last=data.at(-1),first=data[0],previous=[...data].reverse().find(x=>x.date<last.date)||null;
 const delta=previous?last.height-previous.height:null;
 return {last,first,previous,delta,pct:previous&&previous.height>0?delta/previous.height*100:null};
}
function changeLabel(v){return (v>0?'+':'')+num(v,1)}
function weeklyChange(test,playerId,type,date){
 if(!test)return '—';
 const previous=getTests(playerId).filter(x=>x.type===type&&x.date<date).at(-1);
 if(!previous||previous.height<=0)return '<span class="tiny muted">Primera prueba</span>';
 const percentage=(test.height-previous.height)/previous.height*100;
 const css=percentage>0.0001?'change-up':percentage<-.0001?'change-down':'change-even';
 return `<span class="${css} strong mono">${changeLabel(percentage)} %</span><br><span class="tiny muted">vs ${dateLabel(previous.date)}</span>`;
}
function renderProfile(){let p=getPlayer(S.profileId);if(!p){page('players');return}const tests=getTests(p.id),cmj=progressPair(tests,'CMJ'),abk=progressPair(tests,'Abalakov');$('profileName').textContent=p.name;$('profileTeam').textContent=getTeam(p.teamId)?.name||'Sin equipo';$('profileDetails').textContent=[p.number?'Dorsal '+p.number:null,p.position||null,p.birth?'Nacimiento: '+dateLabel(p.birth):null].filter(Boolean).join(' · ')||'Ficha de jugador';
 for(const [type,data,label,delta] of [['CMJ',cmj,'profileCMJ','profileCMJDelta'],['Abalakov',abk,'profileABK','profileABKDelta']]){
  const baseline=baselineHeight(p,type);
  $(label).textContent=data.last?num(data.last.height)+' cm':baseline!=null?num(baseline)+' cm':'—';
  $(delta).textContent=data.last?(data.previous?`${changeLabel(data.delta)} cm (${changeLabel(data.pct)} %) vs ${dateLabel(data.previous.date)}`:baseline!=null?`Último: ${dateLabel(data.last.date)} · ${changeLabel((data.last.height-baseline)/baseline*100)} % frente a pretemporada`:`Primera prueba · ${dateLabel(data.last.date)}`):baseline!=null?'Referencia de pretemporada · sin fecha exacta':'Sin registros';
 }
 const combined=[...tests.map(x=>({height:x.height,type:x.type,tag:dateLabel(x.date)})),...['CMJ','Abalakov'].map(type=>({height:baselineHeight(p,type),type,tag:'Pretemporada · sin fecha'})).filter(x=>x.height!=null)];
 const best=combined.sort((a,b)=>b.height-a.height)[0];$('profileBest').textContent=best?num(best.height)+' cm':'—';$('profileBestType').textContent=best?`${best.type} · ${best.tag}`:'—';$('profileCount').textContent=tests.length;
 renderBaseline(p,cmj,abk);drawChart(tests,$('chartType').value,p);$('profileHistory').innerHTML=renderTestsTable(sortLatest(tests),true);attachTestEvents($('profileHistory'))}

const showMetric=(value,suffix='',decimals=1)=>value==null||value===''?'—':`${num(value,decimals)}${suffix?' '+suffix:''}`;
function renderBaseline(p,cmj,abk){
 const b=p.evaluationBaseline, el=$('profileBaseline');
 const current=$('profilePhysicalCurrent');
 current.innerHTML=`<div class="physical-grid">${[['Estatura',p.heightCm,'cm'],['Peso',p.weightKg,'kg'],['Envergadura',p.wingspanCm,'cm'],['Edad en pretemporada',p.ageAtBaseline,'años']].map(([label,value,unit])=>`<div class="physical-item"><span>${esc(label)}</span><b>${showMetric(value,unit,label==='Edad en pretemporada'?0:1)}</b></div>`).join('')}</div>`;
 if(!b){el.innerHTML='<p class="small muted">No hay una evaluación de pretemporada importada para este jugador.</p>';$('physicalHistory').innerHTML='<p class="small muted">No hay registros históricos.</p>';return}
 const t=b.tests||{};
 const val=(v,unit,decimals=1)=>typeof v==='string'?(v||'—'):showMetric(v,unit,decimals);
 const groups=[
 ['Saltos', [['CMJ',t.cmjCm,'cm'],['Abalakov',t.abalakovCm,'cm'],['Single hop izquierdo',t.singleHopLeftCm,'cm'],['Single hop derecho',t.singleHopRightCm,'cm']]],
 ['Fuerza', [['Hand grip izquierdo',t.handGripLeft,''],['Hand grip derecho',t.handGripRight,''],['ISO belt squat',t.isoBeltSquat,''],['VBT sentadilla · velocidad',t.vbtSquatSpeed,''],['VBT sentadilla · carga',t.vbtSquatLoadKg,'kg']]],
 ['Carrera', [['1 vuelta al Nieto',t.routeTimeSeconds==null?null:`${Math.floor(t.routeTimeSeconds/60)}:${String(t.routeTimeSeconds%60).padStart(2,'0')}`,'']]]
 ];
 const baselineDelta=(data,ref)=>data.last&&ref>0?` <span class="${data.last.height>=ref?'change-up':'change-down'}">(${changeLabel((data.last.height-ref)/ref*100)} % respecto a pretemporada)</span>`:'';
 const chg=`<p class="helper">Referencia de salto: CMJ ${val(t.cmjCm,'cm')} ${baselineDelta(cmj,t.cmjCm)} · Abalakov ${val(t.abalakovCm,'cm')} ${baselineDelta(abk,t.abalakovCm)}</p>`;
 el.innerHTML=`<div class="helper" style="margin-bottom:13px">${esc(b.period||'Pretemporada')} · Fecha exacta no consignada · Página ${esc(b.sourcePage??'—')} del PDF original</div><div class="baseline-grid">${groups.map(([heading,rows])=>`<div><h3 style="margin:0 0 7px">${heading}</h3><div class="table-wrap"><table class="data-table"><tbody>${rows.map(([label,value,unit])=>`<tr><td>${esc(label)}</td><td class="strong mono">${esc(val(value,unit))}</td></tr>`).join('')}</tbody></table></div></div>`).join('')}</div>${chg}<p class="tiny muted">«—» indica que el dato no figura o aparece sin confirmar. Sin fecha exacta: los resultados se muestran como referencia separada en la gráfica individual, no como mediciones semanales fechadas. Los resultados Grip e ISO conservan las unidades tal como aparecen en la fuente (sin unidad explícita). ${esc(b.notes||'')}</p>`;
 const history=[...(p.physicalHistory||[])];
 $('physicalHistory').innerHTML=history.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha / periodo</th><th>Altura</th><th>Peso</th><th>Envergadura</th></tr></thead><tbody>${history.map(x=>`<tr><td>${esc(x.date?dateLabel(x.date):x.period||'Sin fecha')}</td><td>${val(x.heightCm,'cm')}</td><td>${val(x.weightKg,'kg')}</td><td>${val(x.wingspanCm,'cm')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="small muted">No hay registros antropométricos.</p>';
}

function drawChart(all,type,player=null){
 const holder=$('jumpChart'),tests=all.filter(t=>type==='all'||t.type===type);
 const baselines=['CMJ','Abalakov'].filter(t=>type==='all'||type===t).map(t=>({type:t,height:baselineHeight(player,t)})).filter(x=>x.height!=null);
 if(!tests.length&&!baselines.length){holder.innerHTML=blank('No hay datos para la gráfica','Importa la evaluación de pretemporada o registra un salto para comenzar.');return}
 const w=900,h=315,left=53,right=22,top=23,bottom=58,values=[...tests.map(t=>t.height),...baselines.map(t=>t.height)];
 let mi=Math.max(0,Math.floor((Math.min(...values)-5)/5)*5),ma=Math.ceil((Math.max(...values)+5)/5)*5;if(ma-mi<10)ma=mi+10;
 const day=s=>new Date(s+'T12:00:00').getTime(),xs=tests.map(t=>day(t.date)),minX=xs.length?Math.min(...xs):0,maxX=xs.length?Math.max(...xs):0;
 const hasBaseline=baselines.length>0,baseX=97,datedLeft=hasBaseline?214:left,datedRight=w-right;
 const xFor=t=>maxX===minX?(datedLeft+datedRight)/2:datedLeft+(day(t.date)-minX)/(maxX-minX)*(datedRight-datedLeft);
 const yFor=v=>top+(ma-v)/(ma-mi)*(h-top-bottom);
 let body='';for(let i=0;i<=4;i++){let v=mi+(ma-mi)*i/4,y=yFor(v);body+=`<line x1="${left}" y1="${y}" x2="${w-right}" y2="${y}" stroke="#34475a" stroke-dasharray="3 5"/><text x="${left-11}" y="${y+4}" text-anchor="end" font-size="12" fill="#9ab0c2">${num(v,0)}</text>`}
 if(hasBaseline){body+=`<line x1="162" y1="${top}" x2="162" y2="${h-bottom+12}" stroke="#7a8fa7" stroke-dasharray="5 6" opacity=".7"/><text x="${baseX}" y="${h-29}" text-anchor="middle" font-size="11" fill="#9ab0c2">Pretemporada</text><text x="${baseX}" y="${h-13}" text-anchor="middle" font-size="10" fill="#9ab0c2">sin fecha</text>`}
 let labels=[...new Set(tests.map(t=>t.date))].sort();if(labels.length>5){labels=[labels[0],labels[Math.round((labels.length-1)/4)],labels[Math.round((labels.length-1)/2)],labels[Math.round((labels.length-1)*3/4)],labels.at(-1)]}
 for(const s of labels){body+=`<text x="${xFor({date:s})}" y="${h-20}" text-anchor="middle" font-size="11" fill="#9ab0c2">${dateLabel(s).slice(0,5)}</text>`}
 const colors={CMJ:'#68ebbb',Abalakov:'#ae9af6',SJ:'#ffcf81'};
 for(const t of baselines){const y=yFor(t.height),color=colors[t.type];body+=`<rect x="${baseX-5}" y="${y-5}" width="10" height="10" fill="${color}" stroke="#162638" stroke-width="2" transform="rotate(45 ${baseX} ${y})"><title>${esc(t.type)} · Pretemporada 2026/27 · sin fecha exacta · ${num(t.height)} cm</title></rect>`}
 for(const type2 of ['CMJ','Abalakov','SJ']){let series=tests.filter(x=>x.type===type2).sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||''));if(!series.length)continue;let coords=series.map(t=>`${xFor(t)},${yFor(t.height)}`).join(' ');if(series.length>1)body+=`<polyline points="${coords}" stroke="${colors[type2]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".9"/>`;for(const t of series){let x=xFor(t),y=yFor(t.height);body+=`<circle cx="${x}" cy="${y}" r="6" fill="${colors[type2]}" stroke="#162638" stroke-width="2"><title>${esc(t.type)} · ${dateLabel(t.date)} · ${num(t.height)} cm</title></circle>`}}
 holder.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfica de salto: la pretemporada sin fecha se representa aparte de las mediciones fechadas">${body}<text x="16" y="17" fill="#9ab0c2" font-size="11">cm</text></svg>`}
function renderTestsTable(tests,isProfile=false){if(!tests.length)return blank('Sin resultados','Todavía no hay saltos registrados.');return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th>${isProfile?'':'<th>Jugador / equipo</th>'}<th>Tipo</th><th>Altura</th><th>Vuelo</th><th>Vídeo</th><th>Acciones</th></tr></thead><tbody>${tests.map(t=>{let p=getPlayer(t.playerId);return `<tr><td class="mono">${dateLabel(t.date)}</td>${isProfile?'':`<td><span class="strong">${esc(p?.name||'—')}</span><br><span class="tiny muted">${esc(getTeam(p?.teamId)?.name||'—')}</span></td>`}<td>${kindBadge(t.type)}</td><td class="strong mono">${num(t.height)} cm</td><td class="mono">${num(t.flight*1000,0)} ms</td><td>${t.videoId?'🎥 Sí':'—'}</td><td><div style="display:flex;gap:6px"><button class="btn ghost smallbtn" data-viewtest="${esc(t.id)}">Ver</button><button class="btn danger smallbtn" data-deletetest="${esc(t.id)}">×</button></div></td></tr>`}).join('')}</tbody></table></div>`}
function attachTestEvents(root){root.querySelectorAll('[data-viewtest]').forEach(b=>b.addEventListener('click',()=>reviewTest(b.dataset.viewtest)));root.querySelectorAll('[data-deletetest]').forEach(b=>b.addEventListener('click',()=>deleteTest(b.dataset.deletetest)))}
function renderHistory(){optionsFor($('histTeam'),S.teams,$('histTeam').value||'all','Todos los equipos');updateHistPlayers();const team=$('histTeam').value,player=$('histPlayer').value,type=$('histType').value;let tests=sortLatest(S.tests.filter(t=>(team==='all'||getPlayer(t.playerId)?.teamId===team)&&(player==='all'||t.playerId===player)&&(type==='all'||t.type===type)));
 const preseason=S.players.filter(p=>(team==='all'||p.teamId===team)&&(player==='all'||p.id===player)).flatMap(p=>['CMJ','Abalakov'].filter(t=>(type==='all'||type===t)&&baselineHeight(p,t)!=null).map(t=>({p,type:t,value:baselineHeight(p,t)})));
 const early=preseason.length?`<div class="prehistory"><h3>Resultados de pretemporada 2026/27 <span class="tiny muted">(sin fecha exacta)</span></h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Periodo</th><th>Jugador</th><th>Tipo</th><th>Altura</th></tr></thead><tbody>${preseason.map(x=>`<tr><td>Pretemporada 2026/27</td><td>${esc(x.p.name)}</td><td>${kindBadge(x.type)}</td><td class="strong mono">${num(x.value)} cm</td></tr>`).join('')}</tbody></table></div><p class="tiny muted">Estas mediciones proceden del PDF original y no tienen fecha exacta ni vídeo asociado. Se muestran como referencia, sin asignarles una fecha inventada.</p></div>`:'';
 $('historyTable').innerHTML=early+'<div class="weekly-history-title"><h3>Pruebas semanales con fecha</h3></div>'+renderTestsTable(tests);attachTestEvents($('historyTable'))}
function updateHistPlayers(){let team=$('histTeam').value,players=S.players.filter(p=>team==='all'||p.teamId===team);optionsFor($('histPlayer'),players,$('histPlayer').value||'all','Todos los jugadores')}
// Team and athlete management
function newTeam(id=null){const t=id?getTeam(id):null;$('teamId').value=t?.id||'';$('teamName').value=t?.name||'';$('teamCategory').value=t?.category||'';$('teamDialogTitle').textContent=t?'Editar equipo':'Nuevo equipo';closeModal('teamsManager');openModal('teamDialog')}
async function saveTeam(e){e.preventDefault();let id=$('teamId').value||uid(),name=$('teamName').value.trim(),category=$('teamCategory').value.trim();if(!name)return; if(S.teams.some(t=>t.id!==id&&t.name.toLowerCase()===name.toLowerCase())){notify('Ya existe un equipo con ese nombre.',true);return}try{await commit([['put','teams',{id,name,category}]]);await reload();closeModal('teamDialog');render();notify('Equipo guardado.')}catch(err){notify('No se pudo guardar el equipo: '+err.message,true)}}
function newPlayer(id=null){if(!S.teams.length){notify('Primero crea un equipo.',true);newTeam();return}const p=id?getPlayer(id):null;$('playerId').value=p?.id||'';$('playerName').value=p?.name||'';$('playerNumber').value=p?.number||'';$('playerBirth').value=p?.birth||'';$('playerPosition').value=p?.position||'';$('playerAgeBaseline').value=p?.ageAtBaseline??'';$('playerWeight').value=p?.weightKg??'';$('playerHeight').value=p?.heightCm??'';$('playerWingspan').value=p?.wingspanCm??'';$('playerPhysicalDate').value=isoToday();optionsFor($('playerTeam'),S.teams,p?.teamId||S.teams[0]?.id,null,null);$('playerDialogTitle').textContent=p?'Editar jugador':'Nuevo jugador';openModal('playerDialog')}
async function savePlayer(e){
 e.preventDefault();
 const id=$('playerId').value||uid(),existing=getPlayer(id),date=$('playerPhysicalDate').value;
 const parsed=id=>$(id).value.trim()===''?null:Number($(id).value);
 const phys={weightKg:parsed('playerWeight'),heightCm:parsed('playerHeight'),wingspanCm:parsed('playerWingspan')};
 const p={...(existing||{}),id,name:$('playerName').value.trim(),number:$('playerNumber').value.trim(),birth:$('playerBirth').value,position:$('playerPosition').value.trim(),teamId:$('playerTeam').value,ageAtBaseline:parsed('playerAgeBaseline'),...phys};
 if(!p.name||!getTeam(p.teamId)){notify('Selecciona un nombre y un equipo.',true);return}
 if(Object.values(phys).some(x=>x!==null&&(!Number.isFinite(x)||x<0||x>350))){notify('Revisa altura, peso y envergadura.',true);return}
 if(p.ageAtBaseline!==null&&(!Number.isInteger(p.ageAtBaseline)||p.ageAtBaseline<0||p.ageAtBaseline>100)){notify('Revisa la edad de pretemporada.',true);return}
 const physicalChanged=['weightKg','heightCm','wingspanCm'].some(k=>phys[k]!==null&&phys[k]!==existing?.[k]);
 p.physicalHistory=[...(existing?.physicalHistory||[])];
 if(physicalChanged){
  if(!date){notify('Selecciona la fecha para la nueva medición física.',true);return}
  p.physicalHistory.push({id:uid(),date,period:'Medición manual',...phys});
 }
 try{await commit([['put','players',p]]);await reload();closeModal('playerDialog');render();notify('Jugador guardado.')}catch(err){notify('No se pudo guardar: '+err.message,true)}
}
function renderTeamManager(){$('managerTeamList').innerHTML=S.teams.length?S.teams.map(t=>`<div class="teamitem"><div><strong>${esc(t.name)}</strong><div class="small muted">${esc(t.category)}</div></div><div style="display:flex;gap:6px"><button class="btn smallbtn" data-editteam="${esc(t.id)}">Editar</button><button class="btn danger smallbtn" data-delteam="${esc(t.id)}">×</button></div></div>`).join(''):blank('Sin equipos','Crea un equipo para empezar.');$('managerTeamList').querySelectorAll('[data-editteam]').forEach(b=>b.addEventListener('click',()=>newTeam(b.dataset.editteam)));$('managerTeamList').querySelectorAll('[data-delteam]').forEach(b=>b.addEventListener('click',()=>deleteTeam(b.dataset.delteam)))}
async function deleteTeam(id){const t=getTeam(id);if(!t)return;let pids=S.players.filter(p=>p.teamId===id).map(p=>p.id),tests=S.tests.filter(x=>pids.includes(x.playerId));if(!confirm(`¿Eliminar «${t.name}», ${pids.length} jugadores y ${tests.length} test? Esta acción no se puede deshacer.`))return;
 const removed=new Set(tests.map(x=>x.id)),videoIds=new Set(tests.map(x=>x.videoId).filter(Boolean)),keepVideoIds=new Set(S.tests.filter(x=>!removed.has(x.id)).map(x=>x.videoId));let ops=[['delete','teams',id],...pids.map(id=>['delete','players',id]),...tests.map(x=>['delete','tests',x.id]),...S.sessions.filter(x=>x.teamId===id).map(x=>['delete','sessions',x.id]),...S.attendance.filter(x=>pids.includes(x.playerId)).map(x=>['delete','attendance',x.id]),...[...videoIds].filter(id=>!keepVideoIds.has(id)).map(id=>['delete','videos',id])];try{await commit(ops);await reload();renderTeamManager();render();notify('Equipo eliminado.')}catch(e){notify(e.message,true)}}
async function deletePlayer(id){const p=getPlayer(id);if(!p)return;let tests=S.tests.filter(x=>x.playerId===id);if(!confirm(`¿Eliminar a «${p.name}» y sus ${tests.length} mediciones y vídeos exclusivos? No se puede deshacer.`))return;const removed=new Set(tests.map(x=>x.id));const remainVideo=new Set(S.tests.filter(x=>!removed.has(x.id)).map(x=>x.videoId));const vids=[...new Set(tests.map(t=>t.videoId).filter(Boolean))].filter(v=>!remainVideo.has(v));try{await commit([['delete','players',id],...tests.map(t=>['delete','tests',t.id]),...S.attendance.filter(a=>a.playerId===id).map(a=>['delete','attendance',a.id]),...vids.map(v=>['delete','videos',v])]);await reload();S.profileId=null;page('players');notify('Jugador y registros eliminados.')}catch(e){notify(e.message,true)}}
async function deleteTest(id){let t=S.tests.find(t=>t.id===id);if(!t||!confirm(`¿Eliminar el test ${t.type} de ${dateLabel(t.date)} (${num(t.height)} cm)?`))return;const lastVideo=t.videoId&&!S.tests.some(o=>o.id!==id&&o.videoId===t.videoId);try{await commit([['delete','tests',id],...(lastVideo?[['delete','videos',t.videoId]]:[])]);await reload();render();notify('Medición eliminada.')}catch(e){notify(e.message,true)}}
// Video review and analysis
const fpsVideo=()=>Number($('playbackFps').value),fpsCapture=()=>Number($('captureFps').value),validFps=()=>fpsVideo()>0&&fpsVideo()<=960&&fpsCapture()>0&&fpsCapture()<=960;
const timeMode=()=>$('timeMode').value, timeRate=()=>timeMode()==='legacy'?fpsVideo()/fpsCapture():timeMode()==='unknown'?NaN:Number(timeMode());
function clearTiming(){S.take=null;S.land=null;S.takeTime=null;S.landTime=null;S.autoPending=false;$('autoReviewLabel').classList.add('hidden')}
function setMark(which,t=video.currentTime){S[which+'Time']=t;S[which]=Math.round(t*fpsVideo());refreshMeasure()}
function syncMarks(){for(const k of ['take','land']){if(Number.isFinite(S[k+'Time']))S[k]=Math.round(S[k+'Time']*fpsVideo());}}
const maxFrame=()=>S.videoReady?Math.max(0,Math.floor(Math.max(0,(video.duration||0)-.00001)*fpsVideo())):0;
const frame=()=>validFps()?Math.min(maxFrame(),Math.max(0,Math.round(video.currentTime*fpsVideo()))):0;
const frameTime=n=>Math.min(Math.max(0,video.duration-.00001),Math.max(0,n/fpsVideo()));
function timer(s){if(!Number.isFinite(s))return '00:00,000';const ms=Math.max(0,Math.round(s*1000));return `${String(Math.floor(ms/60000)).padStart(2,'0')}:${String(Math.floor(ms%60000/1000)).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`}
function renderMeasureOptions(){let team=$('measureTeam').value,player=$('measurePlayer').value;optionsFor($('measureTeam'),S.teams,team&&getTeam(team)?team:S.teams[0]?.id||'',null,!S.teams.length?'Crea un equipo':'Selecciona equipo');updateMeasurePlayers(player);updateMeasureSessions();jumpHint();refreshMeasure()}
function updateMeasurePlayers(selected){const list=S.players.filter(p=>p.teamId===$('measureTeam').value),select=$('measurePlayer');optionsFor(select,list,selected&&list.some(p=>p.id===selected)?selected:list[0]?.id||'',null,list.length?'Selecciona jugador':'Añade un jugador')}
function jumpHint(){let text={CMJ:'CMJ (Countermovement Jump): salto con contramovimiento, manos en las caderas y sin balanceo de brazos.',Abalakov:'Abalakov: salto con contramovimiento y utilización libre de los brazos. Se analiza el mismo tiempo de vuelo, pero es una prueba diferente.',SJ:'SJ (Squat Jump): salida desde una posición estática de flexión, sin contramovimiento previo y con manos en las caderas.'};$('jumpInstruction').textContent=text[$('measureType').value]}
function releaseVideo(){video.pause();if(S.videoUrl){URL.revokeObjectURL(S.videoUrl);S.videoUrl=null}video.removeAttribute('src');video.load();S.videoReady=false;clearTiming();S.videoBlob=null;S.videoId=null;S.videoName='';S.reviewId=null}
async function loadVideo(blob,id=null,name=null){if(!blob)return;video.pause();if(S.videoUrl)URL.revokeObjectURL(S.videoUrl);S.videoBlob=blob;S.videoId=id;S.videoName=name||blob.name||'Vídeo';clearTiming();S.videoReady=false;S.videoMeta=null;$('aiStatus').textContent='Aún sin analizar.';$('fpsDetected').textContent='Leyendo metadatos…';if(!id){$('timeMode').value='unknown';$('playbackFps').value=30;$('captureFps').value=30;}$('aiStart').value=0;$('aiEnd').value=0;S.videoUrl=URL.createObjectURL(blob);video.src=S.videoUrl;video.load();$('videoFileInfo').textContent=S.videoName+' · '+num(blob.size/1048576,1)+' MB';$('videoPlaceholder').classList.add('hidden');$('videoStatus').textContent='Cargando...';refreshMeasure();CDIRJump.metadata(blob).then(m=>{if(S.videoBlob!==blob)return;S.videoMeta=m;if(!m){$('fpsDetected').textContent='No se pudo leer la frecuencia del contenedor. FPS de avance manuales.';return}const rate=Math.round(m.fps*1000)/1000;if(!id&&rate>=1&&rate<=960)$('playbackFps').value=rate;$('fpsDetected').textContent=`Pista de vídeo: ${num(rate,3)} FPS medios${m.variable?' · frecuencia variable':''}${m.hasEdits?' · contiene lista de edición':''}. No confirma ralentización física. Si hay ediciones o FPS variables, el avance es aproximado.`;refreshMeasure()}).catch(()=>{if(S.videoBlob===blob)$('fpsDetected').textContent='Metadatos no disponibles. Introduce FPS de referencia si los conoces.'})}
function stageSize(){if(video.videoWidth&&video.videoHeight)$('videoStage').style.setProperty('--video-ratio',video.videoWidth+' / '+video.videoHeight);$('videoStage').classList.toggle('native',$('originalRatio').checked)}
function seekTo(n){if(!S.videoReady||!validFps())return;video.pause();video.currentTime=frameTime(Math.min(maxFrame(),Math.max(0,Math.round(n))));refreshMeasure()}
function step(n){seekTo(frame()+n)}
function calc(){if(!S.videoReady||!validFps()||!Number.isFinite(S.takeTime)||!Number.isFinite(S.landTime)||S.landTime<=S.takeTime||!Number.isFinite(timeRate())||timeRate()<=0||timeRate()>1)return null;const count=Math.round((S.landTime-S.takeTime)*fpsVideo()),T=CDIRJump.flight(S.takeTime,S.landTime,timeRate());return{frames:count,flight:T,height:G*T*T/8*100}}
function saveAllowed(c){return !!(c&&c.flight>=.15&&c.flight<=1.05&&getPlayer($('measurePlayer').value)&&$('measureDate').value&&!S.busy&&!S.aiRunning)}
async function autoJump(){if(!S.videoReady||S.aiRunning)return;const start=Number($('aiStart').value),end=Number($('aiEnd').value),rate=timeRate();if(!Number.isFinite(rate)||rate<=0||rate>1){notify('Confirma primero una velocidad temporal válida.',true);return}if(start<0||end>video.duration+.01||end<=start){notify('Revisa el intervalo del vídeo.',true);return}const blob=S.videoBlob;clearTiming();S.aiRunning=true;S.aiCancel=false;video.pause();$('cancelJump').classList.remove('hidden');$('videoFile').disabled=true;for(const id of ['timeMode','playbackFps','captureFps','aiStart','aiEnd','aiStartHere','aiEndHere'])$(id).disabled=true;refreshMeasure();try{const r=await CDIRJump.analyze(video,{start,end,fps:fpsVideo(),rate,progress:t=>$('aiStatus').textContent=t,cancel:()=>S.aiCancel||S.videoBlob!==blob});if(S.aiCancel||S.videoBlob!==blob)return;setMark('take',r.take);setMark('land',r.land);S.autoPending=true;$('autoReviewLabel').classList.remove('hidden');$('aiStatus').textContent='Propuesta experimental. Revisa ambos apoyos con los botones Ir y ajusta las marcas si es necesario. Resolución de muestreo aproximada: '+num(r.gap*1000,1)+' ms de vídeo.';video.currentTime=r.take;}catch(e){$('aiStatus').textContent=e.message+' Selección manual disponible.';}finally{S.aiRunning=false;$('cancelJump').classList.add('hidden');$('videoFile').disabled=false;for(const id of ['timeMode','playbackFps','captureFps','aiStart','aiEnd','aiStartHere','aiEndHere'])$(id).disabled=false;refreshMeasure()}}
function refreshMeasure(){syncMarks();const v=S.videoReady;$('autoJump').disabled=!v||S.aiRunning||!Number.isFinite(timeRate())||timeRate()<=0;$('clearMarks').disabled=!!S.aiRunning;$('timeWarning').textContent=timeMode()==='unknown'?'Confirma cómo está ralentizado el archivo importado. Si la velocidad cambia dentro del vuelo, no utilices esta medición.':`Factor temporal: ${num(timeRate()*100,2)} %. Solo válido si es uniforme durante todo el vuelo. La velocidad de reproducción de la app no influye.`;for(const id of ['stepMinus5','stepMinus1','videoPlay','stepPlus1','stepPlus5','videoSeek','setTakeoff','setLanding'])$(id).disabled=!v||!validFps()||S.aiRunning;$('goTakeoff').disabled=!v||S.take===null||S.aiRunning;$('goLanding').disabled=!v||S.land===null||S.aiRunning;
 $('videoStatus').textContent=v?'Vídeo listo':S.videoBlob?'Cargando...':'Sin vídeo';$('videoClock').textContent=timer(video.currentTime||0)+' · frame aprox. '+(v&&validFps()?frame():'—');$('videoPosition').textContent=timer(video.currentTime||0);$('videoDuration').textContent=timer(v?video.duration:0);$('videoSeek').value=v&&video.duration?Math.round(video.currentTime/video.duration*1000):0;$('videoPlay').textContent=video.paused?'▶':'⏸';
 $('takeoffValue').textContent=S.take===null?'Sin marcar':`Frame aprox. ${S.take} · ${timer(S.takeTime)}`;$('landingValue').textContent=S.land===null?'Sin marcar':`Frame aprox. ${S.land} · ${timer(S.landTime)}`;
 for(const [key,n] of [['takeTick',S.take],['landTick',S.land]]){const el=$(key);el.classList.toggle('hidden',!v||n===null);if(v&&n!==null)el.style.left=(maxFrame()?n/maxFrame()*100:0)+'%'}
 const c=calc();$('heightValue').textContent=c?num(c.height,2):'—';$('flightValue').textContent=c?num(c.flight*1000,1)+' ms':'— ms';$('frameValue').textContent=c?c.frames:'—';const canSave=saveAllowed(c);$('saveTest').disabled=!canSave;$('replaceTest').classList.toggle('hidden',!S.reviewId);$('replaceTest').disabled=!canSave||!S.reviewId;$('saveHint').textContent=!getPlayer($('measurePlayer').value)?'Primero selecciona un jugador.':!v?'Carga un vídeo para analizar.':!validFps()?'Introduce unos FPS válidos.':S.take===null||S.land===null?'Marca el despegue y el aterrizaje.':!Number.isFinite(timeRate())?'Confirma la velocidad temporal del archivo.':!c?'El aterrizaje debe ser posterior al despegue.':c.flight<.15||c.flight>1.05?'Tiempo de vuelo fuera del rango de seguridad (150–1050 ms). Revisa la ralentización y las marcas.':S.autoPending?'Propuesta automática: revisa ambos fotogramas. Se pedirá tu confirmación al guardar.':'Resultado listo para revisar y confirmar al guardar.'}
async function saveTest(replace=false){const c=calc(),p=getPlayer($('measurePlayer').value);if(!saveAllowed(c)||!p||!S.videoBlob)return;const old=replace?S.tests.find(t=>t.id===S.reviewId):null;if(replace&&!old)return;video.pause();const summary=[replace?'¿Confirmas la actualización de esta medición?':'¿Confirmas que esta medición es correcta?',p.name+' · '+$('measureType').value+' · '+dateLabel($('measureDate').value),'Altura: '+num(c.height,2)+' cm · Vuelo: '+num(c.flight*1000,1)+' ms','Despegue: '+timer(S.takeTime)+' · Aterrizaje: '+timer(S.landTime),'Velocidad temporal del archivo: '+num(timeRate()*100,2)+' %',S.autoPending?'Origen: propuesta automática (experimental).':'Origen: marcas manuales o revisadas.','Confirma solo si has revisado ambos apoyos y la ralentización.',replace?'El valor previo se conservará como referencia.':'Cancelar no guarda ningún dato.'].join('\n\n');if(!window.confirm(summary))return;const isNewVideo=!S.videoId,videoId=S.videoId||uid();const test={...old,id:old?.id||uid(),playerId:p.id,teamId:p.teamId,date:$('measureDate').value,type:$('measureType').value,height:c.height,flight:c.flight,frames:c.frames,playbackFps:fpsVideo(),captureFps:fpsCapture(),take:S.take,land:S.land,takeTime:S.takeTime,landTime:S.landTime,timeMode:timeMode(),timeRate:timeRate(),autoSuggested:!!S.autoPending,reviewedByUser:true,reviewedAt:new Date().toISOString(),previousMeasurement:old?{height:old.height,flight:old.flight,take:old.take,land:old.land,timeMode:old.timeMode||"legacy"}:undefined,notes:$('measureNotes').value.trim(),sessionId:$('measureSession').value||null,videoId,videoName:S.videoName,createdAt:old?.createdAt||new Date().toISOString()};
 try{busy(true,'Guardando medición...',isNewVideo?'Se almacenará el vídeo original en este navegador.':'Registrando otra medición del mismo vídeo.');await commit([...(isNewVideo?[['put','videos',{id:videoId,blob:S.videoBlob,name:S.videoName,type:S.videoBlob.type||''}]]:[]),['put','tests',test],...(test.sessionId?[['put','attendance',{id:test.sessionId+'_'+p.id,sessionId:test.sessionId,playerId:p.id,status:'present',notes:''}]]:[])]);S.videoId=videoId;S.reviewId=null;$('reviewBanner').classList.add('hidden');await reload();busy(false);notify(`${test.type}: ${num(test.height,2)} cm guardados para ${p.name}.`);clearTiming();$('measureNotes').value='';refreshMeasure()}catch(e){busy(false);notify('No se pudo guardar. Comprueba el espacio libre del navegador. '+e.message,true)}}
async function reviewTest(id){const t=S.tests.find(t=>t.id===id);if(!t)return;const p=getPlayer(t.playerId);S.reviewId=id;page('measure');if(p){$('measureTeam').value=p.teamId;updateMeasurePlayers(p.id)}$('measureType').value=t.type;$('measureDate').value=t.date;$('playbackFps').value=t.playbackFps||30;$('captureFps').value=t.captureFps||t.playbackFps||30;$('timeMode').value=t.timeMode||'legacy';$('measureNotes').value=t.notes||'';updateMeasureSessions(t.sessionId||'');jumpHint();if(!t.videoId){releaseVideo();$('videoFileInfo').textContent='Esta medición no tiene vídeo';notify('Esta medición no tiene vídeo asociado.',true);return}
 let rec=await dbRead('videos',t.videoId);if(!rec?.blob&&cloud.token){try{rec=await fetchCloudVideo(t.videoId)}catch(e){notify('No se pudo descargar el vídeo desde Drive: '+e.message,true)}}if(!rec?.blob){releaseVideo();$('videoFileInfo').textContent='Vídeo no disponible';notify('El vídeo no está disponible aquí. Conecta Drive o restaura una copia.',true);return}await loadVideo(rec.blob,t.videoId,rec.name);S.take=t.take;S.land=t.land;S.takeTime=Number.isFinite(t.takeTime)?t.takeTime:Number.isFinite(t.take)?t.take/fpsVideo():null;S.landTime=Number.isFinite(t.landTime)?t.landTime:Number.isFinite(t.land)?t.land/fpsVideo():null;$('reviewBanner').innerHTML=`Revisando: <b>${esc(p?.name||'Jugador')} · ${esc(t.type)} · ${dateLabel(t.date)}</b>. Puedes ver los fotogramas guardados. «Guardar» crea otra medición; «Actualizar medición revisada» sustituye su valor conservando el anterior como referencia.`;$('reviewBanner').classList.remove('hidden');refreshMeasure()}
// CSV export
function exportCsv(){const fields=['Fecha','Equipo','Jugador','Dorsal','Test','Altura_cm','Vuelo_ms','Frames','FPS_archivo','FPS_grabacion','Fotograma_despegue','Fotograma_aterrizaje','Notas','Nombre_video','Sesion_ID','Despegue_video_s','Aterrizaje_video_s','Modo_temporal','Factor_temporal','Propuesta_IA'];const csv=[fields,...sortLatest(S.tests).map(t=>{const p=getPlayer(t.playerId);return [t.date,getTeam(p?.teamId)?.name||'',p?.name||'',p?.number||'',t.type,t.height.toFixed(2),(t.flight*1000).toFixed(1),t.frames,t.playbackFps,t.captureFps,t.take,t.land,t.notes||'',t.videoName||'',t.sessionId||'',t.takeTime??'',t.landTime??'',t.timeMode||'legacy',t.timeRate??'',t.autoSuggested?'Sí':'No']})].map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'TesteoCDIR_resultados_'+isoToday()+'.csv');notify('CSV descargado. No incluye los archivos de vídeo.')}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),120000)}
// ZIP estándar sin compresión y sin librerías externas. Contiene datos.json + vídeos originales.
const te=new TextEncoder();const td=new TextDecoder();
const crcTable=(()=>{let t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
async function crcBlob(blob){let c=0xffffffff;for(let p=0;p<blob.size;p+=4*1048576){let arr=new Uint8Array(await blob.slice(p,Math.min(blob.size,p+4*1048576)).arrayBuffer());for(let i=0;i<arr.length;i++)c=crcTable[(c^arr[i])&255]^(c>>>8)}return (c^0xffffffff)>>>0}
const extFor=(name,type)=>{let m=String(name||'').match(/\.(mp4|mov|m4v|webm|avi)$/i);if(m)return m[1].toLowerCase();return type.includes('webm')?'webm':type.includes('quicktime')?'mov':'mp4'};
const u16=(v,p,n)=>v.setUint16(p,n,true),u32=(v,p,n)=>v.setUint32(p,n,true);
async function makeZip(entries){let parts=[],central=[],offset=0;for(const entry of entries){const path=te.encode(entry.path);const blob=entry.blob; if(path.byteLength>65535||blob.size>0xffffffff||offset>0xffffffff)throw Error('ZIP superior a 4 GB no compatible');let crc=await crcBlob(blob),local=new Uint8Array(30),d=new DataView(local.buffer);u32(d,0,0x04034b50);u16(d,4,20);u16(d,6,0x800);u16(d,8,0);u32(d,14,crc);u32(d,18,blob.size);u32(d,22,blob.size);u16(d,26,path.length);parts.push(local,path,blob);
 let header=new Uint8Array(46),c=new DataView(header.buffer);u32(c,0,0x02014b50);u16(c,4,20);u16(c,6,20);u16(c,8,0x800);u16(c,10,0);u32(c,16,crc);u32(c,20,blob.size);u32(c,24,blob.size);u16(c,28,path.length);u32(c,42,offset);central.push(header,path);offset+=local.length+path.length+blob.size}
 let centralSize=central.reduce((a,x)=>a+x.byteLength,0),end=new Uint8Array(22),e=new DataView(end.buffer);u32(e,0,0x06054b50);u16(e,8,entries.length);u16(e,10,entries.length);u32(e,12,centralSize);u32(e,16,offset);return new Blob([...parts,...central,end],{type:'application/zip'})}
async function readZip(zip){let map=new Map(),offset=0;while(offset+30<=zip.size){const head=new DataView(await zip.slice(offset,offset+30).arrayBuffer());if(head.getUint32(0,true)!==0x04034b50)break;let flags=head.getUint16(6,true),method=head.getUint16(8,true),sz=head.getUint32(18,true),nameLen=head.getUint16(26,true),extraLen=head.getUint16(28,true);if(method!==0||flags&8)throw Error('Formato ZIP no compatible. Usa una copia exportada por TesteoCDIR.');const path=td.decode(await zip.slice(offset+30,offset+30+nameLen).arrayBuffer()),start=offset+30+nameLen+extraLen;if(start+sz>zip.size)throw Error('Archivo ZIP incompleto');map.set(path,zip.slice(start,start+sz));offset=start+sz;if(map.size>20000)throw Error('Copia demasiado grande')}return map}
async function backup(){closeModal('backupDialog');try{busy(true,'Creando copia de seguridad...','Generando ZIP. Los vídeos grandes pueden tardar en procesarse.');const full=$('backupMode').value==='full',videoIds=[...new Set(S.tests.map(t=>t.videoId).filter(Boolean))],entries=[],videos=[],vMeta=[];if(full){for(const id of videoIds){let rec=await dbRead('videos',id);if(!rec?.blob&&cloud.token)rec=await fetchCloudVideo(id);if(!rec?.blob)throw Error('Falta el vídeo '+id+'. Conecta Drive y sincroniza antes de exportar una copia completa.');if(rec?.blob){let path='videos/'+encodeURIComponent(id)+'.'+extFor(rec.name,rec.type||'');entries.push({path,blob:rec.blob});vMeta.push({id,name:rec.name,type:rec.type,path})}}}
 const data={app:'TesteoCDIR',version:1,club:'CDI ROZASBASKET',sessions:S.sessions,attendance:S.attendance,videoRefs:await dbAll('videoRefs'),exportedAt:new Date().toISOString(),hasVideos:full,teams:S.teams,players:S.players,tests:S.tests,videos:vMeta};entries.unshift({path:'datos.json',blob:new Blob([JSON.stringify(data)],{type:'application/json'})});let zip=await makeZip(entries);download(zip,'TesteoCDIR_copia_'+isoToday()+(full?'_completa':'_datos')+'.zip');busy(false);notify('Copia ZIP creada. Guárdala en una ubicación segura.')}catch(e){busy(false);notify('No se pudo crear la copia: '+e.message,true)}}
async function restoreBackup(file){if(!file)return;let data,map;try{busy(true,'Leyendo copia...','Validando datos antes de restaurar.');if(file.name.toLowerCase().endsWith('.json')){data=JSON.parse(await file.text());map=new Map()}else{map=await readZip(file);if(!map.has('datos.json'))throw Error('No se encontró datos.json');data=JSON.parse(await map.get('datos.json').text())}
 if(data.app!=='TesteoCDIR'||data.version!==1||!Array.isArray(data.teams)||!Array.isArray(data.players)||!Array.isArray(data.tests))throw Error('Copia de seguridad no válida');if(!data.teams.every(x=>x?.id&&x.name)||!data.players.every(x=>x?.id&&x.name&&x.teamId)||!data.tests.every(x=>x?.id&&x.playerId&&x.date&&x.type))throw Error('Registros incompletos');const teamIds=new Set(data.teams.map(x=>x.id)),playerIds=new Set(data.players.map(x=>x.id));if(data.players.some(x=>!teamIds.has(x.teamId))||data.tests.some(x=>!playerIds.has(x.playerId)))throw Error('La copia contiene referencias inconsistentes');const videoOps=[];for(const v of data.videos||[]){let blob=map.get(v.path);if(!blob)throw Error('Falta un vídeo de la copia: '+v.path);videoOps.push(['put','videos',{id:v.id,blob,name:v.name||'',type:v.type||''}])}
 busy(false);if(!confirm(`¿Restaurar esta copia con ${data.teams.length} equipos, ${data.players.length} jugadores y ${data.tests.length} pruebas? Se REEMPLAZARÁN todos los datos actuales de este navegador.`))return;
 busy(true,'Restaurando...',`Copiando ${videoOps.length} vídeos al almacenamiento local.`);
 await commit([...stores.map(store=>['clear',store]),...data.teams.map(x=>['put','teams',x]),...data.players.map(x=>['put','players',x]),...data.tests.map(x=>['put','tests',x]),...(data.sessions||[]).map(x=>['put','sessions',x]),...(data.attendance||[]).map(x=>['put','attendance',x]),...(data.videoRefs||[]).map(x=>['put','videoRefs',x]),...videoOps]);await reload();releaseVideo();$('videoFileInfo').textContent='Ningún vídeo cargado';$('videoPlaceholder').classList.remove('hidden');S.profileId=null;S.reviewId=null;busy(false);page('dashboard');notify('Copia restaurada correctamente.')}catch(e){busy(false);notify('Error al restaurar: '+e.message,true)}finally{$('restoreInput').value=''}}
// UI event wiring
$('teamForm').addEventListener('submit',saveTeam);$('playerForm').addEventListener('submit',savePlayer);
for(const id of ['addTeamDash','addTeamBtn'])$(id).addEventListener('click',()=>newTeam());for(const id of ['addPlayerBtn','quickPlayer'])$(id).addEventListener('click',()=>newPlayer());
$('manageTeamsBtn').addEventListener('click',()=>{renderTeamManager();openModal('teamsManager')});$('managerAddTeam').addEventListener('click',()=>newTeam());
$('searchPlayers').addEventListener('input',renderPlayers);$('filterPlayerTeam').addEventListener('change',renderPlayers);$('clearPlayerFilters').addEventListener('click',()=>{$('searchPlayers').value='';$('filterPlayerTeam').value='all';renderPlayers()});
$('backPlayers').addEventListener('click',()=>page('players'));$('editProfileBtn').addEventListener('click',()=>newPlayer(S.profileId));$('deletePlayerBtn').addEventListener('click',()=>deletePlayer(S.profileId));$('chartType').addEventListener('change',renderProfile);
function toTest(playerId=null){page('measure');if(playerId){const p=getPlayer(playerId);if(p){$('measureTeam').value=p.teamId;updateMeasurePlayers(playerId)}}$('measureDate').value=isoToday();updateMeasureSessions()}
$('measureProfileBtn').addEventListener('click',()=>toTest(S.profileId));for(const id of ['quickTest','newFromHistory'])$(id).addEventListener('click',()=>toTest());
$('measureTeam').addEventListener('change',()=>{updateMeasurePlayers();updateMeasureSessions();refreshMeasure()});$('measurePlayer').addEventListener('change',refreshMeasure);$('measureType').addEventListener('change',jumpHint);$('measureDate').addEventListener('change',()=>{updateMeasureSessions();refreshMeasure()});
$('histTeam').addEventListener('change',()=>{$('histPlayer').value='all';renderHistory()});$('histPlayer').addEventListener('change',renderHistory);$('histType').addEventListener('change',renderHistory);
$('videoFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const likelyVideo=file.type.startsWith('video/')||/\.(mov|mp4|m4v|webm|avi)$/i.test(file.name);if(!likelyVideo){notify('Selecciona un archivo de vídeo compatible.',true);return}S.reviewId=null;$('reviewBanner').classList.add('hidden');await loadVideo(file);e.target.value=''});
video.addEventListener('loadedmetadata',()=>{if(!Number.isFinite(video.duration)||video.duration<=0){notify('El navegador no puede leer la duración de este vídeo.',true);return}S.videoReady=true;$('aiEnd').value=Math.min(30,Math.max(0,video.duration-.001)).toFixed(3);stageSize();refreshMeasure()});video.addEventListener('error',()=>{S.videoReady=false;refreshMeasure();notify('El navegador no puede reproducir este formato. Prueba a convertirlo a MP4 H.264.',true)});video.addEventListener('timeupdate',refreshMeasure);video.addEventListener('seeked',refreshMeasure);video.addEventListener('play',refreshMeasure);video.addEventListener('pause',refreshMeasure);
$('videoPlay').addEventListener('click',()=>{if(video.paused)video.play().catch(e=>notify('No se pudo reproducir: '+e.message,true));else video.pause()});for(const [id,n] of [['stepMinus5',-5],['stepMinus1',-1],['stepPlus1',1],['stepPlus5',5]])$(id).addEventListener('click',()=>step(n));$('videoSeek').addEventListener('input',()=>{if(S.videoReady)video.currentTime=(Number($('videoSeek').value)/1000)*video.duration});
$('videoSpeed').addEventListener('change',()=>{video.playbackRate=Number($('videoSpeed').value)});
for(const id of ['playbackFps','captureFps','timeMode'])$(id).addEventListener('input',refreshMeasure);$('autoJump').addEventListener('click',autoJump);$('cancelJump').addEventListener('click',()=>{S.aiCancel=true;$('aiStatus').textContent='Cancelando…'});for(const [id,target] of [['aiStartHere','aiStart'],['aiEndHere','aiEnd']])$(id).addEventListener('click',()=>{$(target).value=video.currentTime.toFixed(3)});$('originalRatio').addEventListener('change',stageSize);
$('setTakeoff').addEventListener('click',()=>{video.pause();setMark('take')});$('setLanding').addEventListener('click',()=>{video.pause();setMark('land')});$('goTakeoff').addEventListener('click',()=>{video.pause();video.currentTime=S.takeTime});$('goLanding').addEventListener('click',()=>{video.pause();video.currentTime=S.landTime});$('clearMarks').addEventListener('click',()=>{clearTiming();refreshMeasure()});$('saveTest').addEventListener('click',()=>saveTest(false));$('replaceTest').addEventListener('click',()=>saveTest(true));
document.addEventListener('keydown',e=>{const inField=['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName),modal=document.querySelector('dialog[open]');if(S.aiRunning||S.page!=='measure'||inField||modal||!S.videoReady||e.ctrlKey||e.altKey||e.metaKey)return;if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}else if(e.key==='ArrowRight'){e.preventDefault();step(1)}else if(e.key.toLowerCase()==='t'){setMark('take')}else if(e.key.toLowerCase()==='l'){setMark('land')}else if(e.code==='Space'){e.preventDefault();$('videoPlay').click()}});
for(const id of ['exportCsvBtn','exportCsvHistory'])$(id).addEventListener('click',exportCsv);
$('backupBtn').addEventListener('click',async()=>{let videoIds=[...new Set(S.tests.map(t=>t.videoId).filter(Boolean))],size=0;for(const id of videoIds){let v=await dbRead('videos',id);size+=v?.blob?.size||0}$('backupSize').textContent=`${videoIds.length} vídeos asociados · ${num(size/1048576,1)} MB aprox. La copia completa puede ser grande.`;openModal('backupDialog')});$('confirmBackup').addEventListener('click',backup);$('restoreBtn').addEventListener('click',()=>$('restoreInput').click());$('restoreInput').addEventListener('change',e=>restoreBackup(e.target.files?.[0]));
// TesteoCDIR 2.0: sesiones, plantilla de equipo, sincronizacion Drive y actualización PWA.
const RELEASE='3.0.1';
const cloud={token:'',email:'',name:'',folderId:null,dataFileId:null,busy:false,timer:null,last:null};
let activeSessionId=null, installPrompt=null,swRegistration=null;
const cadeteRoster=[]; // Los datos del club se importan privadamente.
async function seedCadeteA(){
 if(!cadeteRoster.length||localStorage.getItem('cdir_plantilla_2026'))return;
 const team=S.teams.find(x=>x.name.toLocaleLowerCase('es').includes('cadete')&&x.name.toLocaleLowerCase('es').includes('masculino')&&x.name.toLocaleLowerCase('es').includes('a'));
 const teamId=team?.id||'cdir-cadete-masculino-a-2026';
 const base='2026-11-18T00:00:00.000Z',ops=[];
 if(!team)ops.push(['put','teams',{id:teamId,name:'Cadete Masculino A',category:'CDI ROZASBASKET · 2026/27',updatedAt:base}]);
 for(const [number,name] of cadeteRoster){
  if(S.players.some(p=>p.teamId===teamId&&p.name.trim().toLocaleLowerCase('es')===name.toLocaleLowerCase('es')))continue;
  ops.push(['put','players',{id:'cdir-2026-cad-a-'+name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-'),teamId,number,name,birth:'',position:'',updatedAt:base}]);
 }
 if(ops.length)await commit(ops,{remote:true});
 localStorage.setItem('cdir_plantilla_2026','1');
}
function updateMeasureSessions(selected=null){
 const sel=$('measureSession');if(!sel)return;
 const old=selected!==null?selected:sel.value;
 const matches=(S.sessions||[]).filter(x=>x.teamId===$('measureTeam').value&&x.date===$('measureDate').value);
 sel.innerHTML='<option value="">Sin sesión semanal</option>'+matches.map(x=>`<option value="${esc(x.id)}">${dateLabel(x.date)} · ${esc(x.notes||'Sesión de test')}</option>`).join('');
 if(matches.some(x=>x.id===old))sel.value=old;
 else if(matches.length===1)sel.value=matches[0].id;
}
function renderWeekly(){
 const teamSel=$('sessionTeam');optionsFor(teamSel,S.teams,teamSel.value&&getTeam(teamSel.value)?teamSel.value:S.teams[0]?.id||'',null,'Selecciona equipo');
 const all=S.sessions.filter(x=>x.teamId===teamSel.value);
 const picker=$('sessionPicker');picker.innerHTML='<option value="">Abrir sesión guardada…</option>'+all.map(x=>`<option value="${esc(x.id)}">${dateLabel(x.date)} · ${esc(x.notes||'Sesión semanal')}</option>`).join('');
 if(activeSessionId&&all.some(x=>x.id===activeSessionId))picker.value=activeSessionId;
 const current=S.sessions.find(x=>x.id===activeSessionId);
 if(!current||current.teamId!==teamSel.value){$('sessionCurrentTitle').textContent='Asistencia y resultados';$('sessionCounts').textContent='Sin sesión seleccionada';$('sessionInstructions').textContent='Selecciona un equipo y crea o abre una sesión.';$('sessionTable').innerHTML=blank('Selecciona una sesión','El historial individual seguirá intacto aunque un jugador falte.');return}
 $('sessionCurrentTitle').textContent=`${dateLabel(current.date)} · ${getTeam(current.teamId)?.name||'Equipo'}`;
 const people=S.players.filter(x=>x.teamId===current.teamId).sort((a,b)=>(Number(a.number||999)-Number(b.number||999))||byName(a,b));
 const getAttend=p=>S.attendance.find(a=>a.sessionId===current.id&&a.playerId===p.id);
 const getFor=(p,type)=>getTests(p.id).filter(t=>(t.sessionId===current.id||(!t.sessionId&&t.date===current.date))&&t.type===type).at(-1);
 const present=people.filter(p=>getAttend(p)?.status==='present'||!!getFor(p,'CMJ')||!!getFor(p,'Abalakov')).length;
 const absent=people.filter(p=>getAttend(p)?.status==='absent'&&!getFor(p,'CMJ')&&!getFor(p,'Abalakov')).length;
 $('sessionCounts').textContent=`${present} presentes · ${absent} ausentes · ${people.length-present-absent} sin marcar`;
 $('sessionInstructions').textContent='Marca Presente o Falta. Sin marcar significa que todavía no hay información. Se puede añadir un resultado más adelante sin alterar las semanas anteriores.';
 $('sessionTable').innerHTML=people.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Dorsal</th><th>Jugador</th><th>Asistencia</th><th>CMJ</th><th>Δ CMJ</th><th>Abalakov</th><th>Δ Abalakov</th><th>Nuevo test</th></tr></thead><tbody>${people.map(p=>{
 const cmj=getFor(p,'CMJ'),abk=getFor(p,'Abalakov'),a=getAttend(p);
 const status=cmj||abk?'present':a?.status||'pending';
 return `<tr><td class="strong mono">${esc(p.number||'—')}</td><td class="strong">${esc(p.name)}</td><td><div class="attendance">${[['present','Presente'],['absent','Falta'],['pending','Pendiente']].map(([v,l])=>`<button class="attendbtn ${status===v?'active-'+v:''}" data-attend="${esc(p.id)}" data-status="${v}" ${status==='present'&&v==='absent'&&(cmj||abk)?'disabled title="Tiene mediciones guardadas"':''}>${l}</button>`).join('')}</div></td><td class="mono">${cmj?num(cmj.height,2)+' cm':'—'}</td><td>${weeklyChange(cmj,p.id,'CMJ',current.date)}</td><td class="mono">${abk?num(abk.height,2)+' cm':'—'}</td><td>${weeklyChange(abk,p.id,'Abalakov',current.date)}</td><td><button class="btn smallbtn" data-newsessiontest="${esc(p.id)}">+ Medir</button></td></tr>`}).join('')}</tbody></table></div>`:blank('Este equipo no tiene jugadores','Añade jugadores en el apartado Jugadores.');
 $('sessionTable').querySelectorAll('[data-attend]').forEach(b=>b.addEventListener('click',async()=>{
  const pid=b.dataset.attend,status=b.dataset.status,id=current.id+'_'+pid;
  if(status==='absent'&&S.tests.some(t=>t.playerId===pid&&(t.sessionId===current.id||(!t.sessionId&&t.date===current.date)))){notify('Este jugador ya tiene resultados de esta sesión.',true);return}
  try{await commit([['put','attendance',{id,sessionId:current.id,playerId:pid,status,notes:''}]]);await reload();renderWeekly()}catch(e){notify(e.message,true)}
 }));
 $('sessionTable').querySelectorAll('[data-newsessiontest]').forEach(b=>b.addEventListener('click',()=>{
  toTest(b.dataset.newsessiontest);$('measureDate').value=current.date;updateMeasureSessions(current.id);refreshMeasure();
 }));
}
// Importación de plantilla privada: mantener este fichero fuera del repositorio web público.

// Actualización privada de datos CMA: nunca se empaqueta con la PWA ni se envía a GitHub Pages.
async function importCmaEvaluation(data){
 if(data.app!=='TesteoCDIR-CMA-evaluacion'||!Array.isArray(data.players)||data.players.length!==16)throw Error('Formato o número de jugadores de la evaluación incorrecto');
 const wanted=data.team||{id:'cdir-cadete-masculino-a-2026',name:'Cadete Masculino A',category:'2026/27'};
 const team=S.teams.find(x=>x.id===wanted.id)||S.teams.find(x=>x.name.toLocaleLowerCase('es')===wanted.name.toLocaleLowerCase('es'));
 const teamId=team?.id||wanted.id,ops=[];
 if(!team)ops.push(['put','teams',{...wanted,id:teamId}]);
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
 let created=0,updated=0;
 for(const r of data.players){
  if(!r.id||!r.name||!r.evaluationBaseline||r.teamId!==wanted.id)throw Error('Ficha inválida: '+(r.name||'sin nombre'));
  const old=S.players.find(x=>x.id===r.id)||S.players.find(x=>x.teamId===teamId&&r.number&&x.number===r.number)||S.players.find(x=>x.teamId===teamId&&[r.name,r.originalShortName].some(n=>norm(n)===norm(x.name)));
  const useId=old?.id||r.id;
  const wasShort=old&&norm(old.name)===norm(r.originalShortName);
  const next={...(old||{}),id:useId,teamId,number:old?.number||r.number||'',name:(!old||wasShort)?r.name:old.name,
   birth:old?.birth||'',position:old?.position||'',ageAtBaseline:old?.ageAtBaseline??r.ageAtBaseline,
   heightCm:old?.heightCm??r.heightCm,weightKg:old?.weightKg??r.weightKg,wingspanCm:old?.wingspanCm??r.wingspanCm,
   evaluationBaseline:r.evaluationBaseline};
  const history=(old?.physicalHistory||[]).filter(x=>x.id!=='cma-pre-2026-27');
  next.physicalHistory=[...(r.physicalHistory||[]),...history];
  ops.push(['put','players',next]);
  if(old)updated++;else created++;
 }
 await commit(ops);await reload();render();notify(`Datos de pretemporada importados: ${updated} actualizados · ${created} nuevos. Se han conservado los test y vídeos existentes.`);
}

$('importRosterBtn').addEventListener('click',()=>$('rosterFile').click());
$('rosterFile').addEventListener('change',async e=>{
 const file=e.target.files?.[0];e.target.value='';if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  if(data.app==='TesteoCDIR-CMA-evaluacion'){await importCmaEvaluation(data);return}
  if(data.app!=='TesteoCDIR-plantilla'||!Array.isArray(data.teams)||!Array.isArray(data.players))throw Error('Archivo de plantilla no válido');
  const teams=new Map(S.teams.map(x=>[x.id,x])),players=new Map(S.players.map(x=>[x.id,x]));
  const ops=[];
  for(const t of data.teams){if(!t.id||!t.name)throw Error('Equipo incorrecto');if(!teams.has(t.id))ops.push(['put','teams',t]);}
  for(const p of data.players){if(!p.id||!p.name||!p.teamId)throw Error('Jugador incompleto');if(!players.has(p.id))ops.push(['put','players',p]);}
  if(!ops.length){notify('La plantilla ya está importada.');return}
  await commit(ops);await reload();render();notify('Plantilla privada importada: '+data.players.length+' jugadores disponibles.');
 }catch(err){notify('No se pudo importar la plantilla: '+err.message,true)}
});
$('exportAttendanceBtn').addEventListener('click',()=>{
 const rows=[['Fecha','Equipo','Jugador','Dorsal','Asistencia','CMJ_cm','Abalakov_cm']];
 for(const sess of [...S.sessions].sort((a,b)=>a.date.localeCompare(b.date))){
  for(const p of S.players.filter(x=>x.teamId===sess.teamId)){
   const tests=getTests(p.id).filter(t=>t.sessionId===sess.id||(!t.sessionId&&t.date===sess.date));
   const att=S.attendance.find(x=>x.sessionId===sess.id&&x.playerId===p.id);
   const stat=tests.length?'present':att?.status||'pending';
   rows.push([sess.date,getTeam(sess.teamId)?.name||'',p.name,p.number||'',stat,tests.filter(t=>t.type==='CMJ').at(-1)?.height?.toFixed(2)||'',tests.filter(t=>t.type==='Abalakov').at(-1)?.height?.toFixed(2)||'']);
  }
 }
 const csv=rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
 download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'TesteoCDIR_asistencia_'+isoToday()+'.csv');notify('Asistencia exportada en CSV.');
});
$('sessionCreate').addEventListener('click',async()=>{
 const team=$('sessionTeam').value,date=$('sessionDate').value,notes=$('sessionNotes').value.trim();
 if(!getTeam(team)||!/^\d{4}-\d{2}-\d{2}$/.test(date)){notify('Selecciona equipo y fecha válidos.',true);return}
 let session=S.sessions.find(x=>x.teamId===team&&x.date===date);
 if(!session){session={id:uid(),teamId:team,date,notes,createdAt:new Date().toISOString()};await commit([['put','sessions',session]]);await reload();notify('Sesión semanal creada.')}
 activeSessionId=session.id;renderWeekly();
});
$('sessionPicker').addEventListener('change',e=>{activeSessionId=e.target.value||null;renderWeekly()});
$('sessionTeam').addEventListener('change',()=>{activeSessionId=null;renderWeekly()});

// Google Drive sync: token solo en memoria; contenido de Drive privado al propietario de la cuenta.
function setCloudStatus(message,error=false){$('cloudState').textContent=message;$('cloudState').style.color=error?'#ffbdbe':'';$('cloudWho').textContent=cloud.email?`Cuenta conectada: ${cloud.email}`:'Sin cuenta conectada. El guardado local sigue funcionando.';}
function renderCloud(){
 $('cloudSyncNow').disabled=!cloud.token||cloud.busy;
 $('cloudLogout').disabled=!cloud.token;
 $('cloudLogin').disabled=cloud.busy;
 $('cloudLast').textContent=cloud.last?`Última sincronización: ${new Date(cloud.last).toLocaleString('es-ES')}`:'Los cambios se sincronizan tras guardar, si la sesión de Google está activa y hay conexión.';
}
function scheduleSync(){if(!cloud.token)return;clearTimeout(cloud.timer);cloud.timer=setTimeout(()=>syncCloud(false),1400)}
async function loadGIS(){if(window.google?.accounts?.oauth2)return;
 await new Promise((resolve,reject)=>{
  const old=document.querySelector('script[data-gis]');if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',()=>reject(Error('No se cargó Google Identity Services')),{once:true});return}
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.dataset.gis='1';script.onload=resolve;script.onerror=()=>reject(Error('No se pudo cargar el acceso de Google'));document.head.appendChild(script);
 });
}
async function googleSignIn(){
 const clientId=$('oauthClientId').value.trim();
 if(!clientId.endsWith('.apps.googleusercontent.com')){notify('Introduce el ID de cliente OAuth de tu proyecto Google Cloud.',true);return}
 if(location.protocol!=='https:'&&location.hostname!=='localhost'){notify('Publica la app en HTTPS para conectar con Google. El archivo local solo guarda en este dispositivo.',true);return}
 localStorage.setItem('cd_OAuthClient',clientId);
 try{await loadGIS()}catch(e){notify(e.message,true);return}
 const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'openid email https://www.googleapis.com/auth/drive.file',callback:async r=>{
  if(r.error||!r.access_token){setCloudStatus('Error de acceso',true);notify('Google no autorizó el acceso.',true);return}
  cloud.token=r.access_token;cloud.folderId=null;cloud.dataFileId=null;
  try{
   const info=await driveFetch('https://www.googleapis.com/oauth2/v3/userinfo',{raw:true});
   const who=await info.json();cloud.email=who.email||'';
   const prior=localStorage.getItem('cd_DriveOwner');
   if(prior&&cloud.email&&prior!==cloud.email){cloud.token='';setCloudStatus('Cuenta distinta',true);notify('Hay datos locales vinculados a '+prior+'. Para evitar mezclarlos, usa esa cuenta o exporta una copia y borra los datos del navegador antes de cambiar.',true);renderCloud();return}
   if(cloud.email)localStorage.setItem('cd_DriveOwner',cloud.email);
   setCloudStatus('Conectado');renderCloud();await syncCloud(true);
  }catch(e){setCloudStatus('Error de sincronización',true);notify('Acceso autorizado, pero la sincronización falló: '+e.message,true);renderCloud()}
 },error_callback:e=>{notify('La ventana de acceso de Google se cerró o fue bloqueada.',true)}});
 client.requestAccessToken({prompt:'select_account'});
}
async function driveFetch(url,{method='GET',body=null,headers={},raw=false}={}){
 if(!cloud.token)throw Error('Debes iniciar sesión con Google.');
 let res;
 try{res=await fetch(url,{method,headers:{Authorization:'Bearer '+cloud.token,...headers},body})}
 catch(e){throw Error('No hay conexión con Google. '+e.message)}
 if(!res.ok){let d={};try{d=await res.json()}catch(e){}if(res.status===401){cloud.token='';setCloudStatus('Sesión caducada',true)}throw Error(d.error?.message||`Google Drive devolvió ${res.status}`)}
 return raw?res:res.json();
}
async function driveList(q){
 const u='https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=100&fields='+encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime)')+'&q='+encodeURIComponent(q);
 const data=await driveFetch(u);return data.files||[];
}
async function ensureDriveFolder(){if(cloud.folderId)return cloud.folderId;
 const files=await driveList("name='TesteoCDIR' and mimeType='application/vnd.google-apps.folder' and trashed=false");
 if(files.length){cloud.folderId=files[0].id;return cloud.folderId}
 const data=await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',body:JSON.stringify({name:'TesteoCDIR',mimeType:'application/vnd.google-apps.folder'}),headers:{'Content-Type':'application/json'}});
 cloud.folderId=data.id;return data.id;
}
async function ensureDriveDataFile(folderId){
 if(cloud.dataFileId)return cloud.dataFileId;
 const files=await driveList("name='testeo-cdir-datos.json' and '"+folderId+"' in parents and trashed=false");
 cloud.dataFileId=files[0]?.id||null;return cloud.dataFileId;
}
async function driveUploadJson(data,folderId){
 const content=new Blob([JSON.stringify(data)],{type:'application/json'});
 if(cloud.dataFileId){await driveFetch('https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(cloud.dataFileId)+'?uploadType=media',{method:'PATCH',body:content,headers:{'Content-Type':'application/json'}});return cloud.dataFileId}
 const boundary='cdir'+Math.random().toString(36).slice(2);
 const metadata={name:'testeo-cdir-datos.json',mimeType:'application/json',parents:[folderId]};
 const blob=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n',content,'\r\n--'+boundary+'--'],{type:'multipart/related; boundary='+boundary});
 const result=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',body:blob,headers:{'Content-Type':blob.type}});
 cloud.dataFileId=result.id;return result.id;
}
function ts(x){return String(x?.updatedAt||x?.createdAt||'2026-11-18T00:00:00.000Z')}
async function syncCloud(manual=false){
 if(!cloud.token||cloud.busy)return;if(!navigator.onLine){setCloudStatus('Sin conexión');return}
 clearTimeout(cloud.timer);cloud.busy=true;setCloudStatus('Sincronizando');renderCloud();
 try{
  const folderId=await ensureDriveFolder();await ensureDriveDataFile(folderId);
  let remote={};if(cloud.dataFileId){const res=await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(cloud.dataFileId)+'?alt=media',{raw:true});remote=await res.json();if(remote.app!=='TesteoCDIR')throw Error('El fichero de Drive no pertenece a TesteoCDIR')}
  const local={},merged={},ops=[];
  for(const store of syncedStores)local[store]=await dbAll(store);
  local.tombstones=await dbAll('tombstones');local.videoRefs=await dbAll('videoRefs');
  const tomb=new Map();for(const x of [...(remote.tombstones||[]),...local.tombstones])if(!tomb.has(x.id)||tomb.get(x.id).deletedAt<x.deletedAt)tomb.set(x.id,x);
  for(const store of syncedStores){
   const lm=new Map(local[store].map(x=>[x.id,x])),rm=new Map((remote[store]||[]).map(x=>[x.id,x])),all=new Map();
   for(const x of [...lm.values(),...rm.values()]){const prev=all.get(x.id);if(!prev||ts(x)>ts(prev))all.set(x.id,x)}
   merged[store]=[];
   for(const [id,x] of all){const death=tomb.get(store+':'+id);if(death&&death.deletedAt>=ts(x)){if(lm.has(id))ops.push(['delete',store,id]);continue}merged[store].push(x);if(!lm.has(id)||ts(lm.get(id))<ts(x))ops.push(['put',store,x])}
  }
  merged.tombstones=[...tomb.values()];for(const x of merged.tombstones){const cur=local.tombstones.find(y=>y.id===x.id);if(!cur||cur.deletedAt<x.deletedAt)ops.push(['put','tombstones',x])}
  const refs=new Map();for(const x of [...local.videoRefs,...(remote.videoRefs||[])]){const previous=refs.get(x.id);if(!previous||ts(x)>ts(previous))refs.set(x.id,x)}
  const activeVideoIds=[...new Set(merged.tests.map(x=>x.videoId).filter(Boolean))];
  for(const id of activeVideoIds){if(refs.has(id))continue;const v=await dbRead('videos',id);if(!v?.blob)continue;
   setCloudStatus('Subiendo vídeos');const uploadedId=await uploadCloudVideo(v,folderId);
   const ref={id,cloudId:uploadedId,name:v.name,type:v.type||'video/mp4',size:v.blob.size,updatedAt:new Date().toISOString()};refs.set(id,ref);ops.push(['put','videoRefs',ref]);
  }
  merged.videoRefs=[...refs.values()];
  if(ops.length)await commit(ops,{remote:true});
  const payload={app:'TesteoCDIR',schema:2,club:'CDI ROZASBASKET',syncedAt:new Date().toISOString(),...merged};
  await driveUploadJson(payload,folderId);
  cloud.last=new Date().toISOString();await reload();render();setCloudStatus('Sincronizado');renderCloud();if(manual)notify('Datos sincronizados con Google Drive.');
 }catch(e){setCloudStatus('Pendiente / error',true);notify('No se ha podido sincronizar: '+e.message,true);renderCloud()}
 finally{cloud.busy=false;renderCloud()}
}
async function uploadCloudVideo(videoRec,folderId){
 const blob=videoRec.blob;
 const init=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{method:'POST',body:JSON.stringify({name:videoRec.name||'salto.mp4',mimeType:blob.type||'video/mp4',parents:[folderId]}),headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':blob.type||'video/mp4','X-Upload-Content-Length':String(blob.size)},raw:true});
 const location=init.headers.get('Location');if(!location)throw Error('Google Drive no devolvió la dirección de subida para el vídeo');
 const completed=await driveFetch(location,{method:'PUT',body:blob,headers:{'Content-Type':blob.type||'application/octet-stream'},raw:true});
 const info=await completed.json();if(!info.id)throw Error('Google Drive no confirmó el vídeo');return info.id;
}
async function fetchCloudVideo(id){
 const ref=await dbRead('videoRefs',id);if(!ref?.cloudId)throw Error('No hay referencia de este vídeo en Drive.');
 const r=await driveFetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(ref.cloudId)+'?alt=media',{raw:true});
 const blob=await r.blob();const rec={id,blob,name:ref.name||'salto.mp4',type:ref.type||blob.type};await commit([['put','videos',rec]],{remote:true});return rec;
}
$('cloudLogin').addEventListener('click',googleSignIn);
$('cloudSyncNow').addEventListener('click',()=>syncCloud(true));
$('cloudLogout').addEventListener('click',()=>{cloud.token='';cloud.email='';cloud.folderId=null;cloud.dataFileId=null;clearTimeout(cloud.timer);setCloudStatus('Desconectado');renderCloud();notify('Sesión desconectada de la app.')});
$('oauthClientId').addEventListener('change',()=>localStorage.setItem('cd_OAuthClient',$('oauthClientId').value.trim()));
window.addEventListener('online',scheduleSync);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){scheduleSync();swRegistration?.update().catch(()=>{})}});

// Actualización de la aplicación (PWA). Requiere HTTPS/localhost y publicación en el mismo URL.
function setupPWA(){
 $('appVersionInfo').textContent='TesteoCDIR · Versión '+RELEASE;
 if('serviceWorker' in navigator&& (location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>{
   swRegistration=r;r.update().catch(()=>{});
   function offerUpdate(){if(!r.waiting)return;if(S.page!=='measure'&&!S.videoBlob&&!S.busy&&!S.aiRunning){r.waiting.postMessage('SKIP_WAITING');return}$('updateAppBtn').classList.remove('hidden');notify('Hay una nueva versión disponible. Pulsa Actualizar app.')}
   if(r.waiting)offerUpdate();r.addEventListener('updatefound',()=>{const worker=r.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate()})});
  }).catch(e=>notify('No se pudo activar el modo sin conexión: '+e.message,true));
  let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload()});
 }
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installAppBtn').classList.remove('hidden')});
 $('installAppBtn').addEventListener('click',async()=>{if(!installPrompt){notify('Utiliza Instalar aplicación del navegador. En iPhone: Safari → Compartir → Añadir a pantalla de inicio.');return}installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installAppBtn').classList.add('hidden')});
 $('updateAppBtn').addEventListener('click',()=>{if(swRegistration?.waiting)swRegistration.waiting.postMessage('SKIP_WAITING');else location.reload()});
 $('manualUpdateCheck').addEventListener('click',async()=>{if(!swRegistration){notify('Las actualizaciones automáticas requieren publicar la app por HTTPS.');return}await swRegistration.update();if(swRegistration.waiting){$('updateAppBtn').classList.remove('hidden');notify('Actualización disponible. Pulsa Actualizar app.')}else notify('No hay una actualización nueva disponible.')});
}

(async()=>{try{S.db=await openDatabase();await reload();await seedCadeteA();await reload();$('storageChip').textContent='Almacenamiento local';if(navigator.storage?.persist){navigator.storage.persist().catch(()=>{})}}catch(e){S.persistent=false;$('storageChip').textContent='Solo esta sesión';$('storageChip').style.color='#ffd297';notify('Este navegador no permite guardar permanentemente. Los datos de esta sesión se perderán al cerrar.',true)}$('measureDate').value=isoToday();$('sessionDate').value=isoToday();$('oauthClientId').value=window.TESTEO_CDIR_CLIENT_ID||localStorage.getItem('cd_OAuthClient')||'';render();setupPWA()})();
})();
