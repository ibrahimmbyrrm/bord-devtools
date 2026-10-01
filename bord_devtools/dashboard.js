'use strict';
const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=x=>JSON.stringify(x,null,2), clone=x=>JSON.parse(JSON.stringify(x)), M=LAB.manifest;
const lessons=M.lessons, sources={...M.sources}, states={}, visited=new Set();
let current=null, activeTab='visual', selectedSource=null, busy=false, requestSerial=0;
let flowSelectedStations=new Set(), flowPointer=null, flowConnectionStart=null;
const groups=[...new Set(lessons.map(l=>l.group))];
const isLive=LAB.mode==='live';
const flow=[['document','CAD','Dosya'],['assembly','TREE','Örnek ağacı'],['bom','BOM','Parça listesi'],['sequence','BOP','İş sırası'],['flatten','FLAT','Operasyonlar'],['operation','PMTS','Hareket / süre'],['plan','PLAN','Grup toplamı'],['canonical','ROOT','Kök iş'],['line-benchmark','LINE','Hat benchmarkı'],['flow-canvas','FLOW','Flow Canvas']];
function state(){return states[current.id]||(states[current.id]={text:pretty(current.input),variant:0,result:null,baseline:null,dirty:false});}
function raw(x){return `<pre class="raw-json">${esc(pretty(x))}</pre>`;}
function number(x){return typeof x==='number'?new Intl.NumberFormat('tr-TR',{maximumFractionDigits:6}).format(x):esc(x??'—');}
function stat(label,value,unit='',warn=false){return `<div class="stat ${warn?'warn':''}"><strong>${number(value)} <small>${esc(unit)}</small></strong><span>${esc(label)}</span></div>`;}
function table(rows,cols){return `<div class="table-scroll"><table class="data-table"><thead><tr>${cols.map(c=>`<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(typeof c[1]==='function'?c[1](r):r[c[1]]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function tree(x,key='çıktı',depth=0){
 if(x===null||typeof x!=='object')return `<div class="tree-leaf"><span class="tree-key">${esc(key)}</span>: ${esc(typeof x==='string'?x:number(x))}</div>`;
 const entries=Object.entries(x), count=entries.length;
 if(depth>3)return `<details><summary>${esc(key)} <span class="tiny">${count} alan / öğe</span></summary>${raw(x)}</details>`;
 return `<details ${depth<1?'open':''}><summary>${esc(key)} <span class="tiny">${Array.isArray(x)?count+' öğe':count+' alan'}</span></summary>${entries.map(([k,v])=>tree(v,k,depth+1)).join('')}</details>`;
}
function renderNav(){
 const q=$('search').value.toLocaleLowerCase('tr');
 $('nav').innerHTML=groups.map(g=>{const list=lessons.filter(l=>l.group===g&&(`${l.title} ${l.fn} ${l.purpose}`).toLocaleLowerCase('tr').includes(q));return list.length?`<div class="nav-group">${esc(g)}</div>${list.map(l=>`<button class="nav-item ${l.id===current?.id?'active':''} ${visited.has(l.id)?'done':''}" data-lesson="${l.id}" ${l.id===current?.id?'aria-current="step"':''}><span class="nav-index">${visited.has(l.id)?'✓':String(lessons.indexOf(l)+1).padStart(2,'0')}</span><span>${esc(l.title)}</span></button>`).join('')}`:'';}).join('')||'<p class="tiny">Eşleşen deney yok.</p>';
 $('progress-label').textContent=`${visited.size} / ${lessons.length} deney incelendi`;
 $('progress').style.width=`${visited.size/lessons.length*100}%`;
}
function renderFlow(){
const mapped={mesh:'assembly',geometry:'assembly',feasibility:'sequence',system:'operation','resource-gap':'line-benchmark',balance:'line-benchmark',mates:'assembly',enrich:'bom',standard:'bom',subassembly:'sequence',classify:'operation',context:'operation',expand:'operation',hands:'operation',allowance:'operation',overlap:'operation',allocation:'operation',rowcycle:'canonical',robot:'operation',line:'line-benchmark',takt:'line-benchmark',schedule:'line-benchmark',benchmark:'plan'};
 const id=mapped[current.id]||current.id;
 $('flow').innerHTML=flow.map(([k,short,title],i)=>`${i?'<span class="flow-arrow" aria-hidden="true">→</span>':''}<button class="flow-node ${id===k?'active':''}" data-lesson="${k}"><b>${short}</b>${title}</button>`).join('');
 $('flow-caption').innerHTML='<b>İki farklı soru:</b> calculate_plan “bu iş ne kadar sürer?” · balance “bu işler hangi kaynakta, ne zaman yapılabilir?”';
}
function setPath(obj,path,value){let at=obj;path.slice(0,-1).forEach(k=>{if(!at[k]||typeof at[k]!=='object')at[k]={};at=at[k];});at[path.at(-1)]=value;}
function getPath(obj,path){return path.reduce((a,k)=>a?.[k],obj);}
function renderControls(){
 let data;try{data=JSON.parse($('input').value);}catch{data={};}
 $('controls').innerHTML=current.controls.map((c,i)=>{const value=getPath(data,c.path)??c.min;return `<div class="control"><label for="control-${i}">${esc(c.label)}</label><output id="control-out-${i}">${esc(value)} ${esc(c.unit)}</output><input id="control-${i}" data-control="${i}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${esc(value)}" ${isLive?'':'disabled'}></div>`;}).join('');
}
function renderBenchmarkEditor(){
 const panel=$('benchmark-editor'), enabled=current.id==='line-benchmark'||current.id==='flow-canvas';panel.hidden=!enabled;
 if(!enabled)return;
 if(current.id==='flow-canvas'){renderFlowEditor(panel);return;}
 const openJobs=[...panel.querySelectorAll('.benchmark-job-extra')].map((node,index)=>node.open?index:-1).filter(index=>index>=0);
 let data;try{data=JSON.parse($('input').value);}catch{panel.innerHTML='<p class="warning">JSON biçimi hatalı. Gelişmiş girdiyi düzeltip tekrar dene.</p>';return;}
 const takt=data.takt||{}, jobs=Array.isArray(data.jobs)?data.jobs:[];
 const field=(label,key,value,min=1,step=1)=>`<label>${esc(label)}<input type="number" min="${min}" step="${step}" data-benchmark-field="${key}" value="${esc(value)}" ${isLive?'':'disabled'}></label>`;
 const textField=(label,key,value,placeholder='')=>`<label>${esc(label)}<input type="text" data-benchmark-field="${key}" value="${esc(value??'')}" placeholder="${esc(placeholder)}" ${isLive?'':'disabled'}></label>`;
 const jobText=(i,label,key,value,placeholder='')=>`<label>${esc(label)}<input type="text" data-job-index="${i}" data-job-field="${key}" value="${esc(value??'')}" placeholder="${esc(placeholder)}" ${isLive?'':'disabled'}></label>`;
 panel.innerHTML=`<div class="benchmark-form"><h3>Hat kaynakları</h3><div class="benchmark-fields">${field('İstasyon sayısı','station_count',data.station_count)}${field('Toplam operatör','operator_count',data.operator_count)}${textField('İstasyon başına operatör (isteğe bağlı)','station_operator_counts',(data.station_operator_counts||[]).join(', '),'2, 1, 1')}</div><p class="small-note">Boşsa operatörler eşit dağıtılır. Doluysa sayı adedi istasyon sayısına, toplamı operatör sayısına eşit olmalı.</p><h3>Takt hesabı</h3><div class="benchmark-fields"><label>Hesap yöntemi<select data-benchmark-field="takt.taktMode" ${isLive?'':'disabled'}><option value="manual" ${takt.taktMode==='manual'?'selected':''}>Elle takt</option><option value="auto" ${takt.taktMode==='auto'?'selected':''}>Talep / net vardiya</option></select></label>${field('Elle takt · saniye','takt.manualTakt',takt.manualTakt,0.01,0.1)}${field('Vardiya · dakika','takt.shiftMinutes',takt.shiftMinutes,1,1)}${field('Planlı mola · dakika','takt.plannedBreakMinutes',takt.plannedBreakMinutes,0,1)}${field('Vardiya talebi · adet','takt.demandUnits',takt.demandUnits,1,1)}</div><p class="small-note">${takt.taktMode==='auto'?'Aktif: (vardiya − mola) × 60 / talep.':'Aktif: elle girilen takt; diğer parametreler saklanır.'}</p><div class="benchmark-jobs-head"><h3>İşler ve öncüller</h3><button type="button" data-benchmark-action="add" ${isLive?'':'disabled'}>+ İş ekle</button></div><p class="small-note">Öncülleri iş numarasıyla yaz. Kaynak / kilit bölümünde robot, insan katılımı ve sabit yerleşim denenebilir.</p><div class="benchmark-jobs">${jobs.map((job,i)=>`<div class="benchmark-job"><div class="benchmark-job-main"><label>İş no<input type="number" min="1" step="1" data-job-index="${i}" data-job-field="number" value="${esc(job.number)}" ${isLive?'':'disabled'}></label>${jobText(i,'İş adı','name',job.name)}<label>Süre · s<input type="number" min="0.01" step="0.1" data-job-index="${i}" data-job-field="seconds" value="${esc(job.seconds)}" ${isLive?'':'disabled'}></label>${jobText(i,'Öncül iş no','predecessors',(job.predecessors||[]).join(', '),'1, 2')}<button type="button" aria-label="${esc(job.number)} numaralı işi sil" data-benchmark-action="remove" data-job-index="${i}" ${isLive?'':'disabled'}>×</button></div><details class="benchmark-job-extra"><summary>Kaynak / kilit</summary><div class="benchmark-fields"><label>İş türü<select data-job-index="${i}" data-job-field="work_type" ${isLive?'':'disabled'}>${['manual','robot','machine'].map(type=>`<option value="${type}" ${(job.work_type||'manual')===type?'selected':''}>${type}</option>`).join('')}</select></label><label>İnsan meşguliyeti · s<input type="number" min="0" step="0.1" data-job-index="${i}" data-job-field="human_seconds" value="${esc(job.human_seconds??((job.work_type||'manual')==='manual'?job.seconds:0))}" ${isLive?'':'disabled'}></label>${jobText(i,'Operatör aralıkları · s','operator_phases',(job.operator_phases||[]).map(([a,b])=>`${a}-${b}`).join(', '),'0-1, 9-10')}${jobText(i,'Başlangıç istasyonu','station_id',job.station_id,'S1')}${jobText(i,'Başlangıç operatörü','operator_id',job.operator_id,'O1')}${jobText(i,'Makine kimliği','machine_resource_id',job.machine_resource_id,'Robot-A')}${jobText(i,'Ek ortak kaynaklar','resources',(job.resources||[]).join(', '),'Fikstür-A, Kamera-1')}<label class="benchmark-check"><input type="checkbox" data-job-index="${i}" data-job-field="station_locked" ${job.station_locked?'checked':''} ${isLive?'':'disabled'}> İstasyonu kilitle</label></div></details></div>`).join('')}</div></div>`;
 openJobs.forEach(index=>{const node=panel.querySelectorAll('.benchmark-job-extra')[index];if(node)node.open=true;});
}
function flowData(){try{return JSON.parse($('input').value);}catch{return null;}}
function flowLayout(data){
 const layout=data.layout||{};let x=40;
 for(const station of data.stations||[]){if(!layout[station.id]){layout[station.id]={x,y:70};x+=300;}}
 data.layout=layout;return layout;
}
function flowTaskMap(data){return new Map((data.tasks||[]).map(t=>[String(t.id),t]));}
function flowUpdate(mutator){
 const data=flowData();if(!data)return;
 try{mutator(data);$('input').value=pretty(data);markDirty();renderFlowEditor($('benchmark-editor'));}
 catch(e){setStatus('Flow Canvas girdisi değiştirilemedi: '+e.message,true);}
}
function flowTaskAssignment(data,id){
 for(const station of data.stations||[])for(const operator of station.operators||[]){if((operator.tasks||[]).map(String).includes(String(id)))return `${station.id} / ${operator.id}`;}
 return 'atanmadı';
}
function renderFlowEditor(panel){
 const data=flowData();if(!data){panel.innerHTML='<p class="warning">JSON biçimi hatalı. Gelişmiş girdiyi düzeltip tekrar dene.</p>';return;}
 const layout=flowLayout(data), tasks=flowTaskMap(data), stations=data.stations||[];
 flowSelectedStations=new Set([...flowSelectedStations].filter(id=>stations.some(s=>s.id===id)));
 const stationWidth=250, boardHeight=Math.max(570,...stations.map(s=>(layout[s.id]?.y||70)+150));
 const edges=(data.connections||[]).map(edge=>{const a=layout[edge.from]||{x:40,y:70},b=layout[edge.to]||{x:340,y:70};const x1=a.x+stationWidth,y1=a.y+56,x2=b.x,y2=b.y+56,mid=(x1+x2)/2;return `<path class="flow-editor-edge" d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}" marker-end="url(#flow-editor-arrow)"/><text x="${mid-12}" y="${(y1+y2)/2-6}">akış</text>`;}).join('');
 const groupBoxes=(data.parallel_groups||[]).map(group=>{const members=group.station_ids.map(id=>layout[id]).filter(Boolean);if(!members.length)return '';const left=Math.min(...members.map(p=>p.x))-18,top=Math.min(...members.map(p=>p.y))-34,right=Math.max(...members.map(p=>p.x))+stationWidth+18,bottom=Math.max(...members.map(p=>p.y))+170;return `<div class="flow-editor-group" style="left:${left}px;top:${top}px;width:${right-left}px;height:${bottom-top}px"><b>${esc(group.name||group.id)}</b><span>paralel</span></div>`;}).join('');
 const nodes=stations.map(station=>{const pos=layout[station.id]||{x:40,y:70};const selected=flowSelectedStations.has(station.id);const operators=(station.operators||[]).map(operator=>`<div class="flow-editor-operator"><div class="flow-editor-operator-head"><b>${esc(operator.id)}</b><span>operatör</span></div><div class="flow-editor-drop" data-flow-drop-station="${esc(station.id)}" data-flow-drop-operator="${esc(operator.id)}">${(operator.tasks||[]).map(id=>{const task=tasks.get(String(id))||{id};return `<span class="flow-editor-task-chip" title="${esc(task.name||'')}">#${esc(id)} ${esc(task.name||'')}</span>`;}).join('')||'<em>Görev ağacından buraya bırak</em>'}</div></div>`).join('');return `<div class="flow-editor-node ${selected?'selected':''}" data-flow-station="${esc(station.id)}" style="left:${pos.x}px;top:${pos.y}px"><button class="flow-editor-port in" data-flow-port="in" data-flow-station="${esc(station.id)}" title="Giriş portu">◀</button><button class="flow-editor-port out" data-flow-port="out" data-flow-station="${esc(station.id)}" title="Çıkış portu">▶</button><div class="flow-editor-node-head" data-flow-drag="${esc(station.id)}"><strong>${esc(station.name||station.id)}</strong><small>${esc(station.id)}</small><button type="button" class="flow-editor-select" data-flow-select="${esc(station.id)}">${selected?'✓ seçildi':'seç'}</button></div><div class="flow-editor-operators">${operators}</div></div>`;}).join('');
 const palette=(data.tasks||[]).map(task=>`<div class="flow-task-palette-item" draggable="true" data-flow-task="${esc(task.id)}"><b>#${esc(task.number??task.id)} ${esc(task.name||'İş')}</b><small>${number(task.seconds)} s · ${esc(flowTaskAssignment(data,task.id))}</small><span>öncül: ${esc((task.predecessors||[]).join(', ')||'yok')}</span></div>`).join('');
 const selectedText=flowSelectedStations.size?`${[...flowSelectedStations].join(', ')} seçili`:'İstasyonları seç';
 panel.innerHTML=`<div class="flow-editor"><div class="flow-editor-toolbar"><button type="button" data-flow-action="add-station" ${isLive?'':'disabled'}>+ İstasyon</button><button type="button" data-flow-action="add-operator" ${isLive?'':'disabled'}>+ Operatör</button><button type="button" data-flow-action="parallel" ${isLive?'':'disabled'}>Paralel grup oluştur</button><span class="flow-editor-status">${flowConnectionStart?`Bağlantı: ${flowConnectionStart} → giriş portu seç`:'Çıkış portuna tıkla, sonra giriş portuna tıkla'}</span><span class="flow-editor-selected">${esc(selectedText)}</span></div><div class="flow-editor-layout"><aside class="flow-task-palette"><h3>Metot ağacı · işler</h3><p class="small-note">Bir görevi sürükleyip istasyon operatörüne bırak. Atama JSON girdisine yazılır.</p>${palette}</aside><div class="flow-editor-board" data-flow-board style="min-height:${boardHeight}px"><svg class="flow-editor-edges" width="1400" height="${boardHeight}" aria-hidden="true"><defs><marker id="flow-editor-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>${edges}</svg>${groupBoxes}${nodes}</div></div><p class="small-note">İstasyon başlığından sürükleyerek yerini değiştir. Port bağlantıları görev öncülleriyle birlikte üretim dengeleme fonksiyonuna gider. İşi kaldırmak için aynı kartı başka operatöre bırak.</p></div>`;
}
function updateBenchmark(mutator,rerender=false){
 try{const data=JSON.parse($('input').value);mutator(data);$('input').value=pretty(data);markDirty();if(rerender)renderBenchmarkEditor();}
 catch(e){setStatus('Benchmark girdisi değiştirilemedi: '+e.message,true);}
}
function setStatus(text,error=false){$('status').textContent=text;$('status').classList.toggle('error-text',error);}
function select(id,scroll=false){
 if(current)state().text=$('input').value;
 current=lessons.find(l=>l.id===id)||lessons.find(l=>l.id==='plan');
 const s=state();selectedSource=current.functions[0];activeTab='visual';
 history.replaceState(null,'','#'+current.id);
 $('lesson-kicker').textContent=`DENEY ${String(lessons.indexOf(current)+1).padStart(2,'0')} / ${current.group.toLocaleUpperCase('tr')}`;
 $('lesson-title').textContent=current.title;$('lesson-fn').textContent=current.fn;$('purpose').textContent=current.purpose;
 $('data-basis').textContent=current.data_basis;
 $('observe').textContent=current.observe;$('try').textContent=current.try_it;
 $('warning').innerHTML=current.warning?`<div class="warning">${esc(current.warning)}</div>`:'';
 $('input').value=s.text;$('input').readOnly=!isLive;
 $('variant').innerHTML=[{label:'Başlangıç örneği'},...current.variants].map((v,i)=>`<option value="${i}">${esc(v.label)}</option>`).join('');$('variant').value=s.variant;
 $('next').disabled=lessons.indexOf(current)===lessons.length-1;
 $('prev').disabled=lessons.indexOf(current)===0;
 $('run').textContent=isLive?'▶ Çalıştır ve izle':'▶ Kayıtlı örneği göster';$('run').disabled=busy;
 $('input').setAttribute('aria-label',current.title+' deney girdisi JSON');
 $('json-details').open=current.id!=='line-benchmark';setStatus(s.result?'Önceki deney sonucu korunuyor.':'');renderControls();renderBenchmarkEditor();renderNav();renderFlow();renderFunctions();renderSource();renderResult();
 if(scroll)$('lesson-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function markDirty(){const s=state();s.text=$('input').value;s.dirty=!!s.result;$('stale').hidden=!s.dirty;$('pin').disabled=s.dirty||!s.result;$('transfer').disabled=s.dirty;setStatus('Girdi değişti; çalıştırarak sonucu yenile.');}
async function runExperiment(){
 if(busy)return;
 const lesson=current,s=state(),serial=++requestSerial;
 let input;try{input=JSON.parse($('input').value);if(!input||Array.isArray(input)||typeof input!=='object')throw new Error('Üst düzey girdi JSON nesnesi olmalı.');}catch(e){setStatus('JSON hatası: '+e.message,true);return;}
 busy=true;$('run').disabled=true;setStatus('Gerçek fonksiyonlar çalışıyor…');
 try{
  let result;
  if(isLive){const resp=await fetch((LAB.api_base||'')+'/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lesson:lesson.id,input})});result=await resp.json();if(!resp.ok)throw new Error(typeof result.error==='string'?result.error:'Sunucu girdiyi reddetti.');}
  else{result=clone(LAB.snapshots[lesson.id+':'+s.variant]);if(pretty(input)!==pretty(result.input))throw new Error('Kayıtlı modda farklı girdi hesaplanamaz. start.command ile canlı laboratuvarı aç.');}
  Object.assign(sources,result.sources||{});s.result=result;
  if(current.id===lesson.id)s.text=$('input').value;
  try{s.dirty=pretty(JSON.parse(s.text))!==pretty(input);}catch{s.dirty=true;}
  visited.add(lesson.id);
  if(current.id===lesson.id&&serial===requestSerial){setStatus(result.error?`Fonksiyon ${result.error.type} döndürdü; aşağıda incele.`:isLive?'Tamamlandı · çalışma kopyasındaki Python kodu çalıştı.':'Kayıtlı yürütme gösteriliyor · yeni hesap yapılmadı.',!!result.error);renderResult();renderFunctions();renderNav();}
 }catch(e){setStatus('Çalıştırılamadı: '+e.message,true);}
 finally{busy=false;$('run').disabled=false;}
}
function resultOperation(o){
 const els=o.elements||[];
 let html=`<div class="stats">${stat('Nihai / birim süre',o.standard_time_sec,'s')}${stat('Ham insan',o.total_sec,'s')}${stat('Durum',o.status||'—','',o.status==='needs_input')}</div>`;
 html+=`<div class="ladder"><div><b>${number(o.total_tmu)}</b><span>TMU · ham insan</span></div><div><b>${number(o.human_standard_sec)} s</b><span>İnsan + paylar</span></div><div><b>${number(o.machine_cycle_sec)} s</b><span>Makine çevrimi</span></div><div><b>× ${number(o.allocation_factor)}</b><span>Birime dağıtım</span></div></div>`;
 html+=`<p class="note">Aktivite: <b>${esc(o.activity)}</b> · yöntem: ${esc(o.time_system)} · dayanak: ${esc(o.timing_basis)}. Ham TMU × 0.036 = ham insan saniyesi. Makine/insan örtüşmesi ve dağıtım son aşamada uygulanır.</p>`;
 if(o.warnings?.length)html+=`<div class="warning">${o.warnings.map(esc).join('<br>')}</div>`;
 if(o.activity==='handle')html+='<div class="warning">handle filtresi yalnız parça fazındaki G/T öğelerini tutar. Ham expand_step çıktısıyla aşağıdaki listeyi karşılaştır.</div>';
 html+=motionTable(els);
 const trace=state().result.calls||[], expanded=trace.find(c=>c.name==='expand_step'&&c.output?.elements&&(!o.operation_id||c.input?.step?.operation_id===o.operation_id));
 if(expanded){html+=`<details class="boundary"><summary>Filtreden önce / sonra · ${expanded.output.elements.length} ham → ${els.length} nihai öğe</summary><p class="note">Ham genişleme çağrısı iz önizlemesidir. Kod filtreyi, tablo hesabını ve düzenlemeleri bundan sonra uygular.</p>${motionTable(expanded.output.elements)}</details>`;}
 html+=`<details class="boundary"><summary>Hangi değerler varsayıldı?</summary>${table(o.assumed_inputs||[],[['Alan','field'],['Değer',r=>r.value],['Kaynak','source']])}<div class="tree">${tree(o.input_provenance||{},'Veri kökeni')}</div></details>`;
 if(o.reference_status)html+=`<details class="boundary"><summary>Referans / destek sınırı</summary>${raw(o.reference_status)}</details>`;
 return html;
}
function motionTable(elements){return table(elements,[['Kod','code'],['Faz','phase'],['Adet','count'],['TMU',e=>number(e.tmu??e.total_tmu)],['Ham s',e=>number(e.total_sec)],['Geçen s',e=>number(e.elapsed_sec??e.total_sec)]]);}
function resultPlan(o,input){
 const groups=new Map();(input.operations||[]).forEach((s,i)=>{let key=s.parallel_group?'parallel:'+String(s.parallel_group):'serial:'+i;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({source:s,result:o.operations[i]});});
 let html=`<div class="stats">${stat('Plan toplamı',o.standard_time_sec,'s')}${stat('Analiz kapsamı',o.coverage_percent,'%',!o.complete)}${stat('Operasyon',o.operations.length)}</div><div class="equation"><small>calculate_plan → gruplar → toplam</small>${[...groups].map(([k,list])=>k.startsWith('parallel')?`max(${list.map(x=>number(x.result.standard_time_sec)).join(', ')})`:number(list[0].result.standard_time_sec)).join(' + ')} = ${number(o.standard_time_sec)} s</div>`;
 groups.forEach((list,key)=>{html+=`<div class="group-row"><div class="group-box">${list.map(x=>`<span>${esc(x.source.operation_id||'satır')} · ${number(x.result.standard_time_sec)} s</span>`).join('')}</div><b>→ ${key.startsWith('parallel')?'max':'seri'}</b></div>`;});
 html+='<p class="note">Paralel grup, bağımsız kaynak varsayımıdır. Bu aşama öncelik veya operatör takvimi çözmez. %100 kapsam, %100 doğruluk anlamına gelmez.</p>';
 html+=table(o.operations,[['Kimlik','operation_id'],['Aktivite','activity'],['Ham s',r=>number(r.total_sec)],['Standart s',r=>number(r.standard_time_sec)],['Durum','status']]);
 html+='<div class="walk-links">'+o.operations.map((x,i)=>`<button data-operation="${i}">${esc(x.operation_id||i+1)} hesabını aç ↘</button>`).join('')+'</div><div id="operation-drill"></div>';
 return html;
}
function gantt(o){
 const assignments=o.assignments||o.schedule||[];if(!assignments.length)return '';
 const max=Math.max(...assignments.map(a=>a.finish_sec),o.takt_sec||0,1), lanes=[...new Set(assignments.map(a=>a.station_id+' / '+a.operator_id))];
 return `<div class="mini-label">Operatör takvimi · saniye</div>${lanes.map(lane=>`<div class="gantt-row"><span>${esc(lane)}</span><div class="gantt-track">${assignments.filter(a=>a.station_id+' / '+a.operator_id===lane).map(a=>`<div class="gantt-block" style="left:${a.start_sec/max*100}%;width:${(a.finish_sec-a.start_sec)/max*100}%" title="${esc(a.task_id)}: ${a.start_sec}–${a.finish_sec} s">${esc(a.task_id)} · ${number(a.finish_sec-a.start_sec)} s</div>`).join('')}</div></div>`).join('')}<div class="gantt-axis"><span>0</span><span>${number(max/2)}</span><span>${number(max)} s</span></div>`;
}
function lineBenchmarkVisual(o){
 const line=o.benchmark_input.line, stations=line.stations, tasks=new Map(stations.flatMap(s=>s.operators.flatMap(op=>op.tasks.map(t=>[t.id,t]))));
 const assignments=o.assignments||[], max=Math.max(o.bottleneck_sec||0,o.takt_sec||0,1)*1.08;
 const emptyStations=stations.filter(s=>!assignments.some(a=>a.station_id===s.id)).map(s=>s.id);
 const taktPosition=Math.min(100,(o.takt_sec||0)/max*100);
 const heads=stations.map(s=>`<div class="line-chart-station-head" style="flex:${s.operators.length}"><b>${esc(s.id)}</b><small>${number(o.station_times?.[s.id]??0)} s çevrim · ${s.operators.length} operatör</small></div>`).join('');
 const groups=stations.map(s=>`<div class="line-chart-station" style="flex:${s.operators.length}">${s.operators.map(op=>{
  const occupied=[], placed=assignments.filter(a=>a.operator_id===op.id).sort((a,b)=>a.start_sec-b.start_sec||a.finish_sec-b.finish_sec).map(a=>{
   let track=occupied.findIndex(end=>end<=a.start_sec+1e-9);if(track<0){track=occupied.length;occupied.push(a.finish_sec);}else occupied[track]=a.finish_sec;
   return {a,track};
  });
  const count=Math.max(1,occupied.length);
  return `<div class="line-chart-operator">${placed.map(({a,track})=>{const task=tasks.get(a.task_id)||{}, dur=a.finish_sec-a.start_sec;return `<div class="line-chart-task" style="bottom:${a.start_sec/max*100}%;height:${dur/max*100}%;left:${5+track*90/count}%;width:${Math.max(1,90/count-2)}%" title="İş ${esc(a.task_id)} · ${esc(task.name||'')} · ${number(a.start_sec)}–${number(a.finish_sec)} s · insan ${number(task.canonical_human_sec??dur)} s · öncül: ${esc((task.predecessorTaskIds||[]).join(', ')||'yok')}" aria-label="İş ${esc(a.task_id)}, ${esc(task.name||'')}, ${number(a.start_sec)} ile ${number(a.finish_sec)} saniye"><b>#${esc(a.task_id)}</b><span>${esc(task.name||'')}</span><small>${number(dur)} s${task.canonical_machine_sec>0?' · makine':''}</small></div>`;}).join('')}</div>`;
 }).join('')}</div>`).join('');
 const foot=stations.map(s=>`<div class="line-chart-station-foot" style="flex:${s.operators.length}">${s.operators.map(op=>`<span>${esc(op.id)}</span>`).join('')}</div>`).join('');
 let html=`<div class="stats">${stat('Hat çevrimi',o.bottleneck_sec,'s',!o.feasible)}${stat('Takt hedefi',o.takt_sec,'s')}${stat('İnsan doluluğu',Math.round(o.efficiency_percent*10)/10,'%',!o.feasible)}${stat('Basit alt sınır',Math.round(o.simple_lower_bound_sec*100)/100,'s')}</div>`;
 html+=`<span class="pill-small ${o.feasible?'':'red'}">${o.feasible?'Takt hedefi karşılandı':o.feasibility_status==='proven_infeasible'?'Modelde hedef imkânsız':'Hedefe uygun çözüm bulunamadı · imkânsızlık kanıtlanmadı'}</span><p class="note">${stations.length-emptyStations.length}/${stations.length} istasyon kullanıldı. Algoritma: ${esc(o.algorithm)} · fizibilite durumu: ${esc(o.feasibility_status||'bilinmiyor')} · kesin arama: ${number(o.feasibility_search_nodes||0)}/${number(o.feasibility_search_limits?.nodes||0)} düğüm. Alt sınır max(en uzun iş, toplam iş / operatör sayısı); kaynak ve öncelik kısıtlarını içermez.</p>`;
 html+=`<div class="mini-label">Hat grafiği · işler gerçek başlangıç/bitiş zamanında · saniye</div><div class="line-chart"><div class="line-chart-head">${heads}</div><div class="line-chart-plot"><div class="line-chart-groups">${groups}</div><div class="line-chart-takt" style="bottom:${taktPosition}%"><span>Takt ${number(o.takt_sec)} s</span></div></div><div class="line-chart-foot">${foot}</div></div>`;
 html+=`<div class="mini-label">İstasyon yükleri</div>${table(stations.map(s=>({id:s.id,operators:s.operators.length,cycle:o.station_times?.[s.id]??0,spare:(o.takt_sec??0)-(o.station_times?.[s.id]??0)})),[['İstasyon','id'],['Operatör','operators'],['Çevrim s',r=>number(r.cycle)],['Takta kalan s',r=>number(r.spare)]])}`;
 html+=`<div class="mini-label">Atamalar ve öncelikler</div>${table(assignments.map(a=>({...a,name:tasks.get(a.task_id)?.name,predecessors:tasks.get(a.task_id)?.predecessorTaskIds||[]})),[['İş no',r=>'#'+r.task_id],['İş','name'],['Öncül no',r=>r.predecessors.length?r.predecessors.map(n=>'#'+n).join(', '):'—'],['İstasyon','station_id'],['Operatör','operator_id'],['Başlangıç s',r=>number(r.start_sec)],['Bitiş s',r=>number(r.finish_sec)]])}`;
 html+='<p class="note">İstasyon saatleri yereldir; farklı istasyonlarda 0 başlangıcı aynı ürünün eşzamanlı işlendiğini göstermez. Makine çubuğu tüm çevrimi gösterir; insan meşguliyeti ayrıca girdide belirtilir. Süreler benchmark girdisidir; laboratuvar bunları yeniden PMTS hesabına sokmaz.</p>';
 if(emptyStations.length)html+=`<div class="warning">Boş kalan istasyon: ${emptyStations.map(esc).join(', ')}. Girilen istasyon sayısı, dengeleyicinin her istasyonu kullanmasını zorunlu kılmaz.</div>`;
 if(o.reasons?.length)html+=`<div class="warning">${o.reasons.map(esc).join('<br>')}</div>`;
 return html;
}
function balanceVisual(o){
 let html=`<div class="stats">${stat('Darboğaz',o.bottleneck_sec,'s')}${stat('Takt',o.takt_sec,'s')}${stat('İnsan doluluğu',o.efficiency_percent,'%',o.feasible===false)}</div>`;
 html+=`<span class="pill-small ${o.feasible?'':'red'}">${o.feasible?'Kısıtlara uygun çözüm':o.feasibility_status==='proven_infeasible'?'Kapasite modelde yetersiz':'Uygun çözüm bulunamadı; imkânsızlık kanıtlanmadı'}</span>`+gantt(o);
 html+=table(o.assignments||[],[['Görev','task_id'],['İstasyon','station_id'],['Operatör','operator_id'],['Başlangıç',r=>number(r.start_sec)],['Bitiş',r=>number(r.finish_sec)]]);
 html+='<p class="note">İstasyonların saatleri yereldir; farklı istasyonlardaki 0 başlangıcı aynı ürünün iki yerde aynı anda işlendiği anlamına gelmez. Hat sürekli çevrim varsayımıyla değerlendirilir. optimality_proven=false.</p>';
 if(o.reasons?.length)html+=`<div class="warning">${o.reasons.map(esc).join('<br>')}</div>`;
 return html;
}
function flowVisual(o){
 const d=o.flow||{}, stations=d.stations||[], byId=new Map(stations.map(s=>[s.id,s])), tasks=new Map((d.task_edges||[]).map(e=>[e.to,e]));
 const assignments=new Map((o.assignments||[]).map(a=>[String(a.task_id),a]));
 const groups=(d.parallel_groups||[]).map(g=>{const members=g.station_ids.map(id=>byId.get(id)).filter(Boolean);if(!members.length)return '';const left=Math.min(...members.map(s=>s.x))-14,top=Math.min(...members.map(s=>s.y))-38,right=Math.max(...members.map(s=>s.x+s.width))+14,bottom=Math.max(...members.map(s=>s.y+s.height))+14;return `<rect class="flow-group-box" x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" rx="12"/><text class="flow-group-label" x="${left+10}" y="${top+18}">${esc(g.name||g.id)} · paralel</text>`;}).join('');
 const edges=(d.connections||[]).map(edge=>{const from=byId.get(edge.from),to=byId.get(edge.to);if(!from||!to)return '';const x1=from.x+from.width,y1=from.y+from.height/2,x2=to.x,y2=to.y+to.height/2,mid=(x1+x2)/2;return `<path class="flow-edge" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" marker-end="url(#flow-arrow)"/><text class="flow-edge-label" x="${mid-14}" y="${(y1+y2)/2-5}">akış</text>`;}).join('');
 const nodes=stations.map(station=>{let row=station.y+58;const taskRows=station.operators.flatMap(op=>op.tasks.map(task=>{const a=assignments.get(String(task.id))||{},h=task.name||task.id;const line=`#${task.id} ${h}`;const out=`${number(a.start_sec??0)}–${number(a.finish_sec??task.canonical_total_sec??0)} s`;const item=`<rect class="flow-task-card" x="${station.x+10}" y="${row}" width="${station.width-20}" height="22" rx="4"/><text class="flow-task-id" x="${station.x+17}" y="${row+15}">${esc(line.length>29?line.slice(0,28)+'…':line)}</text><text class="flow-task-time" x="${station.x+station.width-17}" y="${row+15}" text-anchor="end">${esc(out)}</text>`;row+=28;return item;}));return `<g class="flow-station"><rect x="${station.x}" y="${station.y}" width="${station.width}" height="${station.height}" rx="9"/><text class="flow-station-title" x="${station.x+12}" y="${station.y+23}">${esc(station.name)}</text><text class="flow-station-meta" x="${station.x+12}" y="${station.y+40}">${esc(station.id)} · ${station.operators.length} operatör</text>${taskRows.join('')}</g>`;}).join('');
 let html=`<div class="stats">${stat('Hat çevrimi',o.bottleneck_sec,'s',!o.feasible)}${stat('Takt',o.takt_sec,'s')}${stat('İstasyon',stations.length)}${stat('Paralel grup',(d.parallel_groups||[]).length)}</div>`;
 html+=`<span class="pill-small ${o.feasible?'':'red'}">${o.feasible?'Canvas yerleşimi takta uygun':o.feasibility_status==='proven_infeasible'?'Canvas yerleşimi modelde imkânsız':'Uygun çözüm bulunamadı; imkânsızlık kanıtlanmadı'}</span><p class="note">Kartlar sabit istasyon yerleşimini, oklar kullanıcı tarafından kurulan akışı, kesikli çerçeve paralel grubu gösterir. İçerideki zamanlar gerçek dengeleme çıktısından gelir.</p>`;
 html+=`<div class="flow-canvas-wrap"><svg class="flow-canvas" viewBox="0 0 ${d.width||900} ${d.height||360}" role="img" aria-label="Paralel istasyonlu BORD hat akışı"><defs><marker id="flow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>${groups}${edges}${nodes}</svg></div>`;
 html+=`<div class="mini-label">Atamalar ve öncüller</div>${table((o.assignments||[]).map(a=>{const task=(o.flow_input?.tasks||[]).find(t=>String(t.id)===String(a.task_id))||{};return {...a,name:task.name,predecessors:task.predecessors||[]};}),[['İş no',r=>'#'+r.task_id],['İş','name'],['Öncül',r=>r.predecessors.length?r.predecessors.map(x=>'#'+x).join(', '):'—'],['İstasyon','station_id'],['Başlangıç s',r=>number(r.start_sec)],['Bitiş s',r=>number(r.finish_sec)]])}`;
 if(o.reasons?.length)html+=`<div class="warning">${o.reasons.map(esc).join('<br>')}</div>`;
 return html;
}
function visual(result){
 const o=result.output;
 if(result.error)return `<div class="error-box"><strong>${esc(result.error.type)}</strong>${esc(result.error.message)}<p>${current.id==='bug-cycle'?'Bu hazır vaka, açık öncelik döngüsünü yeniden üretir. Çağrı izi ve kaynak kodundan son fonksiyonu incele.':'Bu girdi fonksiyon tarafından tamamlanamadı. Çağrı izini açarak sınırı incele; üstteki deney açıklaması varsayılan örnek içindir.'}</p></div>`;
 if(o?.operations&&'coverage_percent'in o)return resultPlan(o,result.input);
 if(o?.elements&&'standard_time_sec'in o)return resultOperation(o);
 if(o?.benchmark_input)return lineBenchmarkVisual(o);
 if(o?.flow)return flowVisual(o);
 if(o?.assignments)return balanceVisual(o);
 if(o?.scene && o?.analysis)return geometryVisual(o);
 if(o?.assembly&&o?.priced){
  return `<div class="stats">${stat('BOP kökü',o.bop.length)}${stat('Düz operasyon',o.flattened.length)}${stat('Hat',o.balance.blocked?'engelli':o.balance.feasible?'uygun':'taşıyor','',o.balance.blocked)}</div><p class="note">Aynı çalıştırmanın gerçek ara verileri aşağıdadır. Her sınır sonraki kutuya taşınır; ikinci bir tarayıcı süre hesabı yoktur.</p>`+
  [['assembly','1 · CAD ağacı ve zenginleştirilmiş BOM'],['mates','2 · Bağlantılar'],['geometry','2b · Mesh, geometrik eleme ve erişilebilirlik'],['bop','3 · Sıralanmış BOP'],['flattened','4 · Düz operasyon listesi'],['priced','5 · PMTS / kök toplamları'],['method_line','6 · Eğitim yerleşimi'],['balance','7 · Hat hesabı / engel']].map(([key,title])=>`<details class="boundary"><summary>${esc(title)} ↓</summary>${key==='balance'&&o.balance.assignments?balanceVisual(o.balance):''}<div class="tree">${tree(o[key],key)}</div></details>`).join('')+`<div class="warning">${esc(o.lab_boundary)} ${result.input.operation_overrides?'Bu varyanttaki 4 s değerleri sentetik eğitim girdisidir; gerçek gözlem değildir.':''}</div>`;
 }
 if(o?.schedule_status)return `<div class="stats">${stat('Çizelge',o.schedule_status)}${stat('İstasyon çevrimi',o.stations?.[0]?.calculated_sec,'s')}</div>`+gantt(o)+`<div class="tree">${tree(o,'Sabit yerleşim')}</div>`;
 if(o?.cases)return `<div class="stats">${stat('MAPE',o.mape_percent,'%')}${stat('Değerlendirilen',o.evaluated)}${stat('Dışlanan',o.excluded,'',!!o.excluded)}</div>`+table(o.cases,[['Vaka','id'],['Referans s',r=>number(r.expected_sec)],['Tahmin s',r=>number(r.actual_sec)],['Mutlak %',r=>number(r.absolute_percent)],['Tam mı?','complete']])+`<p class="note">${esc(o.note)} Bu hazır vakalar sentetiktir.</p>`;
 if(o?.elements)return `<div class="stats">${stat('Ham süre',o.total_sec??o.comparisons?.[0]?.elapsed_sec,'s')}${stat('Hareket sayısı',o.elements.length)}</div>`+
  (o.context?`<div class="ladder"><div><b>${number(o.context.part_reach_cm)} cm</b><span>Hesapta kullanılan reach</span></div><div><b>${number(o.context.assembly_move_cm)} cm</b><span>Hesapta kullanılan move</span></div></div><p class="note">Bağlam kaynağı: ${esc(o.lab_context_source)}. Bu değerler doğrudan expand_step fonksiyonuna verilen bağlamdır.</p>`:'')+
  motionTable(o.elements)+`<div class="tree">${tree(o,'Ham hareket çıktısı')}</div>`;
 if(o?.classification)return `<div class="stats">${stat('Karar',o.classification)}${stat('Gerekçe',o.reason)}</div><p class="note">closed = tek satın alınmış blok · phantom = klasör / içeriği aç · assembled = içeride monte edilen alt iş.</p>`;
 if(o?.estimate_sec!==undefined)return `<div class="stats">${stat('Robot tahmini',o.estimate_sec,'s')}${stat('Dayanak',o.basis)}</div>`+table(o.components||[],[['Bileşen','name'],['Süre',r=>number(r.seconds)],['Kaynak','source']])+`<div class="tree">${tree(o,'Kanıt ve belirsizlik')}</div>`;
 if(Array.isArray(o)&&o.some(x=>x.operation_id))return table(o,[['Kimlik','operation_id'],['İş',r=>r.component||r.action],['Kendi s',r=>number(r.own_standard_time_sec??r.observed_duration_sec)],['Kök toplam s',r=>number(r.standard_time_sec)]])+`<div class="tree">${tree(o,'Operasyonlar')}</div>`;
 if(Array.isArray(o)&&o.some(x=>x.filename))return table(o,[['Dosya','filename'],['Adet','quantity'],['Çözüldü','resolved'],['Kütle kg',r=>number(r.mass_kg)]])+`<div class="tree">${tree(o)}</div>`;
 return `<div class="tree">${tree(o)}</div>`;
}
function renderResult(){
 const s=state(),r=s.result;
 renderExecutionMap(r);
 document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===activeTab);b.setAttribute('aria-selected',String(b.dataset.tab===activeTab));});
 $('stale').hidden=!s.dirty;$('pin').disabled=!r||s.dirty;$('transfer').hidden=!['flatten','sequence','line'].includes(current.id)||!r||!!r.error;$('transfer').disabled=s.dirty;
 $('run-meta').textContent=r?`${isLive?'Canlı':'Kayıt'} · ${r.elapsed_ms} ms · ${r.calls.length} çağrı önizlemesi`:'Henüz çalıştırılmadı';
 if(!r){$('result').innerHTML='<div class="empty"><div class="empty-symbol">{ → }</div>Girdiyi incele; <b>Çalıştır ve izle</b> ile gerçek çıktıyı aç.<br>Önce sonucu tahmin et, sonra karşılaştır.</div>';return;}
 if(activeTab==='visual')$('result').innerHTML=visual(r);
 if(activeTab==='raw')$('result').innerHTML=raw(r.error?{error:r.error,input:r.input}:r.output);
 if(activeTab==='trace'){
  const depth=c=>{let n=0,p=c.parent;while(p!==null&&p!==undefined&&n<7){n++;p=r.calls[p]?.parent;}return n;};
  $('result').innerHTML=`<p class="note">Her satır gerçek yürütmeden alınır. Tıkla: kaynak + o çağrının girdisi/çıktısı. Aynı fonksiyonun ilk 6 çağrısı ve en fazla 500 iç çağrı ve 100 ek ana akış çağrısı tutulur. ${r.omitted_calls} tekrar/çağrı önizlemesi atlandı. Süreler izleme yükünü içerir; performans benchmarkı değildir.</p>`+r.calls.map(c=>`<button class="trace-row" data-call="${c.id}" style="--depth:${depth(c)}"><span>${String(c.id+1).padStart(2,'0')}</span><b>${esc(c.name)}</b><span>${number(c.ms)} ms ↘</span></button>`).join('');
 }
 if(activeTab==='compare'){
  if(!s.baseline){$('result').innerHTML='<div class="empty">İlk sonucu <b>A olarak sakla</b>.<br>Bir girdiyi değiştir, yeniden çalıştır ve farkı burada gör.</div>';return;}
  const changes=[];diff(s.baseline.input,r.input,'girdi',changes);diff(s.baseline.output??s.baseline.error,r.output??r.error,'çıktı',changes);
  $('result').innerHTML=`<p class="note">A: ${esc(s.baseline.executed_at)} · B: ${esc(r.executed_at)}. Değişen alanlar aşağıdadır; ilk 120 fark gösterilir.</p>`+(changes.length?changes.slice(0,120).map(c=>`<div class="diff"><b>${esc(c.path)}</b><del>A ${esc(JSON.stringify(c.a)??'(yok)')}</del><br><ins>B ${esc(JSON.stringify(c.b)??'(yok)')}</ins></div>`).join(''):'<p class="note">Girdi ve sonuç aynı.</p>');
 }
}
function diff(a,b,path,out){if(out.length>=121||JSON.stringify(a)===JSON.stringify(b))return;if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],path+'.'+k,out);}else out.push({path,a,b});}
function highlight(code){return code.split('\n').map((line,i)=>{const html=line.replace(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|return|if|elif|else|for|in|import|from|class|and|or|not|None|True|False|raise|with|as|try|except|while|yield|lambda)\b|[^#"']+?(?=#[^\n]*|"|'|\b(?:def|return|if|elif|else|for|in|import|from|class|and|or|not|None|True|False|raise|with|as|try|except|while|yield|lambda)\b|$)/g,token=>token.startsWith('#')?`<span class="comment">${esc(token)}</span>`:/^["']/.test(token)?`<span class="str">${esc(token)}</span>`:/^(def|return|if|elif|else|for|in|import|from|class|and|or|not|None|True|False|raise|with|as|try|except|while|yield|lambda)$/.test(token)?`<span class="kw">${esc(token)}</span>`:esc(token));return `<span class="code-line"><span class="line-no">${(sources[selectedSource]?.line||1)+i}</span>${html}</span>`;}).join('');}
function renderFunctions(){
 const r=state().result;
 $('function-list').innerHTML=current.functions.map(k=>{const src=sources[k];const count=r?.calls.filter(c=>c.source===k).length||0;return `<button class="${selectedSource===k?'active':''}" data-source="${esc(k)}">${esc(src?.name||k)}<small>${count?count+' çağrı · çıktıyı aç':'Örneği çalıştır / kodu aç'}</small></button>`;}).join('');
}
function renderSource(call=null){
 const src=sources[selectedSource];if(!src)return;
 $('source-meta').textContent=`${src.file}:${src.line} · kaynak SHA ${M.source_hashes[src.file]||'çağrı sırasında okundu'}`;
 $('code').innerHTML=highlight(src.code);$('source-details').open=true;
 $('call-detail').innerHTML=call?`<div class="call-heading"><b>#${call.id+1} ${esc(call.name)}</b> · ${number(call.ms)} ms · ${call.parent!==null?'üst çağrı #'+(call.parent+1):'giriş fonksiyonu'}</div><div class="call-io"><div><h4>Bu çağrının girdisi</h4>${raw(call.input)}</div><div><h4>${call.after?'Dönüş: null / değişen girdi':'Bu çağrının dönüş değeri'}</h4>${raw(call.after||call.output)}</div></div><p class="note">Çağrı verileri boyut sınırı olan önizlemelerdir; _preview / _omitted işaretleri kırpılmayı belirtir. Ana deneyin tam çıktısı “Tam JSON” sekmesindedir. İstisnada null dönüş başarılı hesap anlamına gelmez.</p>`:'<p class="note">Fonksiyon düğmesine bas: mevcut çalıştırmadaki örnek çağrıyı aç. Çalıştırma yoksa önce deney çalışır. İç fonksiyonlar üst fonksiyonun gerçek bağlamında yürütülür.</p>';
}
function openCall(id){const c=state().result?.calls[id];if(!c)return;selectedSource=c.source;renderFunctions();renderSource(c);$('source-meta').scrollIntoView({behavior:'smooth',block:'start'});}
async function functionClick(key){
 const startLesson=current.id;selectedSource=key;renderFunctions();renderSource();
 if(!state().result||state().dirty)await runExperiment();
 if(current.id!==startLesson)return;
 const calls=state().result?.calls.filter(c=>c.source===key)||[];
 if(calls.length){openCall(calls[0].id);if(calls.length>1)$('call-detail').insertAdjacentHTML('afterbegin',`<div class="walk-links">${calls.map(c=>`<button data-call="${c.id}">Çağrı #${c.id+1} çıktısı</button>`).join('')}</div>`);}
 else{$('call-detail').innerHTML='<p class="note">Bu fonksiyon için çağrı önizlemesi yok: bu dal çalışmamış veya iz sınırına takılmış olabilir. Kodun varlığı bu girdide çalıştığı anlamına gelmez. Çağrı izi / tam çıktıyı incele.</p>';}
}
function transfer(){
 const r=state().result;if(!r||r.error||state().dirty)return;
 let target,input;
 if(current.id==='flatten'){target='plan';input={operations:clone(r.output),config:{allowance_profiles:{default:{performance_percent:100,pfd_percent:0}}}};}
 if(current.id==='sequence'){target='flatten';input={steps:clone(r.output)};}
 if(current.id==='line'){target='balance';input={tasks:clone(r.output.tasks),stations:clone(r.output.stations),takt:10};}
 if(!target)return;
 states[target]={text:pretty(input),variant:0,result:null,baseline:null,dirty:false};
 select(target,true);setStatus('Önceki fonksiyonun gerçek çıktısı bu girdiye aktarıldı. '+(target==='plan'?'PFD=0 öğretim ayarıdır.':target==='balance'?'Takt=10 s öğretim ayarıdır.':''));
 if(!isLive)setStatus('Aktarılan girdi canlı hesap gerektirir; start.command ile canlı laboratuvarı aç.');
}
function download(){const s=state();const payload={lab:'BORD DEV Laboratuvarı',mode:LAB.mode,revision:M.revision,source_hashes:M.source_hashes,lesson:current.id,current_input_text:$('input').value,result_is_stale:s.dirty,result:s.result,baseline:s.baseline};const url=URL.createObjectURL(new Blob([pretty(payload)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`bord-deney-${current.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('search').addEventListener('input',renderNav);
$('theme-toggle').textContent=document.documentElement.getAttribute('data-theme')==='light'?'Koyu tema':'Açık tema';
$('theme-toggle').addEventListener('click',()=>{const next=document.documentElement.getAttribute('data-theme')==='light'?'dark':'light';document.documentElement.setAttribute('data-theme',next);$('theme-toggle').textContent=next==='light'?'Koyu tema':'Açık tema';try{localStorage.setItem('anvex.theme',next)}catch(e){}});
$('run').addEventListener('click',runExperiment);
$('input').addEventListener('input',()=>{markDirty();renderControls();renderBenchmarkEditor();});
$('controls').addEventListener('input',event=>{const i=event.target.dataset.control;if(i===undefined)return;try{const data=JSON.parse($('input').value),c=current.controls[Number(i)];setPath(data,c.path,Number(event.target.value));$('input').value=pretty(data);$('control-out-'+i).textContent=event.target.value+' '+c.unit;markDirty();}catch(e){setStatus('Önce JSON biçimini düzelt.',true);}});
$('benchmark-editor').addEventListener('input',event=>{
 const field=event.target.dataset.benchmarkField,jobField=event.target.dataset.jobField;
 if(field){updateBenchmark(data=>{if(field==='station_operator_counts'){const values=event.target.value.trim();if(values)data.station_operator_counts=values.split(/[\s,;]+/).map(Number);else delete data.station_operator_counts;return;}const path=field.split('.');setPath(data,path,field==='takt.taktMode'?event.target.value:Number(event.target.value));},field==='takt.taktMode');return;}
 if(jobField){const index=Number(event.target.dataset.jobIndex);let value=event.target.value;
  if(jobField==='predecessors')value=value.split(/[\s,;]+/).filter(Boolean).map(n=>/^\d+$/.test(n)?Number(n):n);
  else if(jobField==='resources')value=value.split(',').map(s=>s.trim()).filter(Boolean);
  else if(jobField==='operator_phases'){const parts=value.trim()?value.split(',').map(s=>s.trim()):[];value=parts.map(part=>{const match=part.match(/^([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)$/);if(!match)return null;return [Number(match[1]),Number(match[2])];});}
  else if(['number','seconds','human_seconds'].includes(jobField))value=Number(value);
  if(jobField==='operator_phases'&&value.some(phase=>!phase)){setStatus('Operatör aralıkları 0-1, 9-10 biçiminde olmalı.',true);return;}
  else if(jobField==='station_locked')value=event.target.checked;
  updateBenchmark(data=>{const job=data.jobs[index];job[jobField]=value;if(jobField==='work_type'){job.human_seconds=value==='manual'?job.seconds:0;delete job.operator_phases;}if(jobField==='operator_phases')job.human_seconds=value.reduce((sum,[a,b])=>sum+b-a,0);},jobField==='work_type');}
});
$('benchmark-editor').addEventListener('click',event=>{const button=event.target.closest('[data-benchmark-action]');if(!button)return;const action=button.dataset.benchmarkAction;updateBenchmark(data=>{if(action==='add'){const numbers=data.jobs.map(j=>Number(j.number)).filter(Number.isFinite);const last=data.jobs.at(-1);data.jobs.push({number:Math.max(0,...numbers)+1,name:'Yeni iş',seconds:5,predecessors:last?[last.number]:[]});}if(action==='remove'){const index=Number(button.dataset.jobIndex),number=data.jobs[index].number;data.jobs.splice(index,1);for(const job of data.jobs)job.predecessors=(job.predecessors||[]).filter(p=>p!==number);}},true);});
$('benchmark-editor').addEventListener('click',event=>{
 if(current?.id!=='flow-canvas')return;
 const port=event.target.closest('[data-flow-port]');
 if(port){const station=port.dataset.flowStation;if(port.dataset.flowPort==='out'){flowConnectionStart=station;renderFlowEditor($('benchmark-editor'));setStatus(`${station} çıkışı seçildi; hedef istasyonun giriş portuna tıkla.`);}else if(flowConnectionStart){const source=flowConnectionStart;flowConnectionStart=null;if(source!==station)flowUpdate(data=>{data.connections=data.connections||[];if(!data.connections.some(e=>e.from===source&&e.to===station))data.connections.push({from:source,to:station});});else renderFlowEditor($('benchmark-editor'));}event.stopPropagation();return;}
 const selectButton=event.target.closest('[data-flow-select]');
 if(selectButton){const id=selectButton.dataset.flowSelect;if(flowSelectedStations.has(id))flowSelectedStations.delete(id);else flowSelectedStations.add(id);renderFlowEditor($('benchmark-editor'));event.stopPropagation();return;}
 const action=event.target.closest('[data-flow-action]')?.dataset.flowAction;if(!action)return;
 if(action==='add-station')flowUpdate(data=>{const ids=(data.stations||[]).map(s=>s.id),numbers=ids.map(id=>Number(String(id).replace(/\D/g,''))).filter(Number.isFinite);const id=`S${Math.max(0,...numbers)+1}`;data.stations.push({id,name:`İstasyon ${id}`,operators:[{id:`O${Date.now().toString().slice(-5)}`,tasks:[]}]});const layout=flowLayout(data);const maxX=Math.max(0,...Object.values(layout).map(p=>p.x||0));layout[id]={x:maxX+300,y:70};});
 if(action==='add-operator')flowUpdate(data=>{const stationId=[...flowSelectedStations][0]||data.stations?.[0]?.id;const station=data.stations.find(s=>s.id===stationId);if(!station)throw new Error('Önce bir istasyon seç');const ids=data.stations.flatMap(s=>(s.operators||[]).map(o=>Number(String(o.id).replace(/\D/g,'')))).filter(Number.isFinite);station.operators.push({id:`O${Math.max(0,...ids)+1}`,tasks:[]});});
 if(action==='parallel'){if(flowSelectedStations.size<2){setStatus('Paralel grup için en az iki istasyon seç.',true);return;}flowUpdate(data=>{data.parallel_groups=data.parallel_groups||[];const ids=[...flowSelectedStations];if(data.parallel_groups.some(g=>ids.every(id=>g.station_ids.includes(id))))return;const numbers=data.parallel_groups.map(g=>Number(String(g.id).replace(/\D/g,''))).filter(Number.isFinite);data.parallel_groups.push({id:`PG${Math.max(0,...numbers)+1}`,name:'Paralel grup',station_ids:ids});});}
 });
$('benchmark-editor').addEventListener('dragstart',event=>{if(current?.id!=='flow-canvas')return;const item=event.target.closest('[data-flow-task]');if(item)event.dataTransfer.setData('text/plain',item.dataset.flowTask);});
$('benchmark-editor').addEventListener('dragover',event=>{if(current?.id==='flow-canvas'&&event.target.closest('[data-flow-drop-station]'))event.preventDefault();});
$('benchmark-editor').addEventListener('drop',event=>{if(current?.id!=='flow-canvas')return;const drop=event.target.closest('[data-flow-drop-station]');if(!drop)return;event.preventDefault();const id=event.dataTransfer.getData('text/plain');if(!id)return;flowUpdate(data=>{for(const station of data.stations||[])for(const operator of station.operators||[])operator.tasks=(operator.tasks||[]).filter(task=>String(task)!==String(id));const station=data.stations.find(s=>s.id===drop.dataset.flowDropStation),operator=station?.operators.find(o=>o.id===drop.dataset.flowDropOperator);if(!operator)throw new Error('Operatör bulunamadı');operator.tasks.push(id);});});
$('benchmark-editor').addEventListener('pointerdown',event=>{if(current?.id!=='flow-canvas')return;const head=event.target.closest('[data-flow-drag]');if(!head||event.target.closest('button'))return;const id=head.dataset.flowDrag,data=flowData(),pos=flowLayout(data)[id]||{x:40,y:70};flowPointer={id,startX:event.clientX,startY:event.clientY,x:pos.x,y:pos.y};head.setPointerCapture?.(event.pointerId);});
$('benchmark-editor').addEventListener('pointermove',event=>{if(!flowPointer)return;const node=document.querySelector(`[data-flow-station="${CSS.escape(flowPointer.id)}"]`);if(!node)return;const x=Math.max(8,flowPointer.x+event.clientX-flowPointer.startX),y=Math.max(8,flowPointer.y+event.clientY-flowPointer.startY);node.style.left=`${x}px`;node.style.top=`${y}px`;});
$('benchmark-editor').addEventListener('pointerup',event=>{if(!flowPointer)return;const p=flowPointer;flowPointer=null;const node=document.querySelector(`[data-flow-station="${CSS.escape(p.id)}"]`);if(!node)return;const x=parseFloat(node.style.left),y=parseFloat(node.style.top);if(Math.abs(x-p.x)+Math.abs(y-p.y)>1)flowUpdate(data=>{flowLayout(data)[p.id]={x,y};});});
$('variant').addEventListener('change',()=>{const s=state();s.variant=Number($('variant').value);$('input').value=pretty(s.variant?current.variants[s.variant-1].input:current.input);markDirty();renderControls();renderBenchmarkEditor();});
$('reset').addEventListener('click',()=>{$('variant').value='0';state().variant=0;$('input').value=pretty(current.input);markDirty();renderControls();renderBenchmarkEditor();});
$('prev').addEventListener('click',()=>select(lessons[Math.max(0,lessons.indexOf(current)-1)].id,true));
$('next').addEventListener('click',()=>select(current.next||lessons[Math.min(lessons.length-1,lessons.indexOf(current)+1)].id,true));
$('whole').addEventListener('click',()=>select('pipeline',true));
$('pin').addEventListener('click',()=>{if(!state().result||state().dirty)return;state().baseline=clone(state().result);setStatus('Bu sonuç A olarak saklandı. Girdiyi değiştirip yeniden çalıştır.');activeTab='compare';renderResult();});
$('transfer').addEventListener('click',transfer);$('export').addEventListener('click',download);
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.lesson)select(b.dataset.lesson);if(b.dataset.tab){activeTab=b.dataset.tab;renderResult();}if(b.dataset.call!==undefined)openCall(Number(b.dataset.call));if(b.dataset.source)functionClick(b.dataset.source);if(b.dataset.operation!==undefined){const o=state().result.output.operations[Number(b.dataset.operation)];$('operation-drill').innerHTML=resultOperation(o);}});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();runExperiment();}});
window.addEventListener('hashchange',()=>select(location.hash.slice(1)));
$('about').addEventListener('click',()=>$('help').showModal());$('close-help').addEventListener('click',()=>$('help').close());
$('help-content').innerHTML=`<p>Bu araç, bu çalışma kopyasının mühendislik hesap yolunu öğretir. Uygulamanın tüm fonksiyonlarının kataloğu değildir: her deneyin ana fonksiyonları ile yürütülen iç çağrılar görünür.</p><p><b>Canlı mod:</b> JSON girdileri yerel Python fonksiyonlarına gönderilir. Kaynak kodu değişince sunucuyu yeniden başlatın. Yeni fonksiyonları kataloğa eklemek için bir deney adaptörü yazılır; mevcut fonksiyon gövdeleri kopyalanmaz.</p><p><b>Bağlantı:</b> CAD/BOM deneylerinden sıralamaya kadar farklı küçük örnekler vardır. Bütün yolun aynı veriyle yürüdüğü örnek <b>Uçtan uca</b> deneyidir. Çıktıyı aktar düğmeleri sequence → flatten → plan ve line_inputs → balance sınırlarını doğrudan bağlar.</p>${table([
 {a:'BOM',b:'Hangi parçadan kaç tane var? İş sırası veya süre değildir.'},{a:'BOP',b:'Ne, hangi sırada, hangi metotla yapılır?'},{a:'PMTS / MTM',b:'İşi hareketlere ve referans zamanlarına ayırır. Kullanılan MTM-1 veri seti sertifikalı/eksiksiz kabul edilmez.'},{a:'TMU',b:'1 TMU = 0.036 saniye. Mesafelerin cm/mm/m birimlerine dikkat et.'},{a:'estimated',b:'Varsayımlı hesap. Sahada doğrulanmış süre değildir.'},{a:'verified',b:'Girdinin ölçüm niteliğinde işaretlendiğini gösterir. Sentetik deneyde gerçek saha ölçümü yapıldığı anlamına gelmez.'},{a:'needs_input',b:'Eksik veya desteklenmeyen veri var. Sayısal sonuç planlamaya hazır olmayabilir.'},{a:'coverage_percent',b:'Tam hesaplanmış operasyon oranı. Doğruluk yüzdesi değildir.'},{a:'parallel_group',b:'Plan içinde bağımsız operasyonların max ile birleştirilmesi.'},{a:'machine_overlap',b:'Tek operasyon içinde insan ve makinenin örtüşmesi.'},{a:'parallel_stations',b:'Birim başına zaman dağıtım katsayısı. Hat dengeleme değildir.'},{a:'Takt / çevrim',b:'Takt talebin hedef aralığıdır; çevrim kaynaklarla elde edilen süredir.'}
 ],[['Kavram','a'],['Anlamı','b']])}<p><b>İzolasyon:</b> üretim veritabanındaki proje ve ayarlar değiştirilmez. Kanonik süre fonksiyonuna laboratuvar ayarı, ölçüm listesi ve kütle haritası açıkça verilir. Uygulama modülü yüklenir; bu ekran giriş/izinler, kayıt/yeniden yükleme ve Ergo/canlı kamera akışını doğrulamaz.</p><p><b>Geometri sınırı:</b> CAD zinciri çözülebilen mesh’lerle InterferenceMatrix ve check_sequence_feasibility çalıştırır. Örnek klasörde eksik olan parçalar ve süre bütçesi nedeniyle unchecked kalanlar doğrulanmış sayılmaz.</p><p>Deney kaydını indir düğmesi girdi, sonuç, A/B kaydı ve kaynak hash’lerini birlikte saklar. Sayfa kapatıldığında çalışma durumu silinir. Klavye: ⌘/Ctrl + Enter ile çalıştır.</p>`;
$('mode').textContent=isLive?'CANLI PYTHON':'KAYITLI ÖRNEKLER';$('mode').classList.toggle('amber',!isLive);
$('revision').textContent='checkout '+M.revision+' · '+M.generated_at.slice(0,10);
$('mode-note').innerHTML=!isLive?'<div class="warning"><b>Çevrimdışı örnek modu.</b> Butonlar gerçek koddan kaydedilmiş çıktıları açar. Kendi girdilerini hesaplamak için aynı klasördeki <b>start.command</b> dosyasını çalıştır; canlı dashboard otomatik açılır.</div>':'';
select(location.hash.slice(1)||'plan');
runExperiment();

function renderExecutionMap(result){
 const names=new Set(['open_document','read_assembly','collect_assembly_mates','compute','check_sequence_feasibility','plan_sequence','_flatten_steps','_apply_canonical_mtm_times','calculate_plan','calculate_operation','validate_operation','classify','derive_context','expand_step','_motion_tmu','apply_element_edits','simultaneous_motion_time','estimate_robot','line_inputs','balance_line','balance','_first_slot','apply_balance_result','annotate_line_schedule','benchmark']);
 const calls=result?.calls.filter(c=>names.has(c.name))||[];
 const unique=[];const seen=new Set();for(const c of calls){if(!seen.has(c.source)){unique.push(c);seen.add(c.source);}}
 $('execution-map').innerHTML='<div class="section-label"><span>BU GİRDİDE FONKSİYONDAN FONKSİYONA</span><span>İlk görülme sırası · tıkla, çağrıyı aç</span></div>'+(result?`<div class="execution-nodes">${unique.map((c,i)=>`<button data-call="${c.id}"><span>${String(i+1).padStart(2,'0')} · ${calls.filter(x=>x.source===c.source).length} çağrı</span><b>${esc(c.name)}</b><small>${esc(Object.keys(c.input).filter(k=>k!=='config').join(', ')||'nesne bağlamı')} → ${esc(Array.isArray(c.output)?'liste':c.output===null?'mutasyon / null':typeof c.output==='object'?'nesne':typeof c.output)}</small></button>`).join('<span class="execution-arrow">→</span>')}</div><p class="note">Oklar ilk çağrıların görülme sırasını gösterir; fonksiyonların tamamı birbirinin doğrudan çağıranı değildir. Tam üst/alt çağrı ilişkisi “Çağrı izi” sekmesindedir.</p>`:'<p class="note">Deneyi çalıştırınca bu girdide gerçekten çalışan fonksiyonlar ve veri türleri burada belirecek.</p>');
}
function geometryVisual(o){
 const offset=o.scene.offset_mm,scale=7,start=50,y=30,size=o.scene.edge_mm*scale;
 return `<svg viewBox="0 0 420 135" role="img" aria-label="İki küpün XY izdüşümü; merkez uzaklığı ${offset} mm" style="width:100%;max-height:180px;background:#f5f8f2;border-radius:6px"><rect x="${start}" y="${y}" width="${size}" height="${size}" fill="#398d7c" fill-opacity=".6" stroke="#26725f"/><rect x="${start+offset*scale}" y="${y}" width="${size}" height="${size}" fill="#e0a46c" fill-opacity=".6" stroke="#b97e47"/><text x="${start}" y="20" font-size="11" fill="#315e53">BlockA</text><text x="${start+offset*scale}" y="120" font-size="11" fill="#95633e">BlockB · ${offset} mm</text></svg><p class="note">XY izdüşümü; her küp 10 × 10 × 10 mm. Görsel yalnız girdinin çizimidir; analiz aşağıdaki gerçek Python çıktısıdır.</p>`+`<div class="tree">${tree(o.analysis,'Geometrik analiz')}</div>`;
}
