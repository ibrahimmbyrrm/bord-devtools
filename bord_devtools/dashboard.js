'use strict';
const $=id=>document.getElementById(id), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=x=>JSON.stringify(x,null,2), clone=x=>JSON.parse(JSON.stringify(x)), M=LAB.manifest;
const lessons=M.lessons, sources={...M.sources}, states={}, visited=new Set();
let current=null, activeTab='visual', selectedSource=null, busy=false, requestSerial=0;
const groups=[...new Set(lessons.map(l=>l.group))];
const isLive=LAB.mode==='live';
const flow=[['document','CAD','Dosya'],['assembly','TREE','Örnek ağacı'],['bom','BOM','Parça listesi'],['sequence','BOP','İş sırası'],['flatten','FLAT','Operasyonlar'],['operation','PMTS','Hareket / süre'],['plan','PLAN','Grup toplamı'],['canonical','ROOT','Kök iş'],['balance','LINE','Hat çizelgesi']];
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
 const mapped={mesh:'assembly',geometry:'assembly',feasibility:'sequence',system:'operation','resource-gap':'balance',mates:'assembly',enrich:'bom',standard:'bom',subassembly:'sequence',classify:'operation',context:'operation',expand:'operation',hands:'operation',allowance:'operation',overlap:'operation',allocation:'operation',rowcycle:'canonical',robot:'operation',line:'balance',takt:'balance',schedule:'balance',benchmark:'plan'};
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
 setStatus(s.result?'Önceki deney sonucu korunuyor.':'');renderControls();renderNav();renderFlow();renderFunctions();renderSource();renderResult();
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
function balanceVisual(o){
 let html=`<div class="stats">${stat('Darboğaz',o.bottleneck_sec,'s')}${stat('Takt',o.takt_sec,'s')}${stat('İnsan doluluğu',o.efficiency_percent,'%',o.feasible===false)}</div>`;
 html+=`<span class="pill-small ${o.feasible?'':'red'}">${o.feasible?'Kısıtlara uygun çözüm':'Kapasite / yerleşim sorunu'}</span>`+gantt(o);
 html+=table(o.assignments||[],[['Görev','task_id'],['İstasyon','station_id'],['Operatör','operator_id'],['Başlangıç',r=>number(r.start_sec)],['Bitiş',r=>number(r.finish_sec)]]);
 html+='<p class="note">İstasyonların saatleri yereldir; farklı istasyonlardaki 0 başlangıcı aynı ürünün iki yerde aynı anda işlendiği anlamına gelmez. Hat sürekli çevrim varsayımıyla değerlendirilir. optimality_proven=false.</p>';
 if(o.reasons?.length)html+=`<div class="warning">${o.reasons.map(esc).join('<br>')}</div>`;
 return html;
}
function visual(result){
 const o=result.output;
 if(result.error)return `<div class="error-box"><strong>${esc(result.error.type)}</strong>${esc(result.error.message)}<p>${current.id==='bug-cycle'?'Bu hazır vaka, açık öncelik döngüsünü yeniden üretir. Çağrı izi ve kaynak kodundan son fonksiyonu incele.':'Bu girdi fonksiyon tarafından tamamlanamadı. Çağrı izini açarak sınırı incele; üstteki deney açıklaması varsayılan örnek içindir.'}</p></div>`;
 if(o?.operations&&'coverage_percent'in o)return resultPlan(o,result.input);
 if(o?.elements&&'standard_time_sec'in o)return resultOperation(o);
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
$('input').addEventListener('input',()=>{markDirty();renderControls();});
$('controls').addEventListener('input',event=>{const i=event.target.dataset.control;if(i===undefined)return;try{const data=JSON.parse($('input').value),c=current.controls[Number(i)];setPath(data,c.path,Number(event.target.value));$('input').value=pretty(data);$('control-out-'+i).textContent=event.target.value+' '+c.unit;markDirty();}catch(e){setStatus('Önce JSON biçimini düzelt.',true);}});
$('variant').addEventListener('change',()=>{const s=state();s.variant=Number($('variant').value);$('input').value=pretty(s.variant?current.variants[s.variant-1].input:current.input);markDirty();renderControls();});
$('reset').addEventListener('click',()=>{$('variant').value='0';state().variant=0;$('input').value=pretty(current.input);markDirty();renderControls();});
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
 const names=new Set(['open_document','read_assembly','collect_assembly_mates','compute','check_sequence_feasibility','plan_sequence','_flatten_steps','_apply_canonical_mtm_times','calculate_plan','calculate_operation','validate_operation','classify','derive_context','expand_step','_motion_tmu','apply_element_edits','simultaneous_motion_time','estimate_robot','line_inputs','balance_line','balance','_first_slot','benchmark']);
 const calls=result?.calls.filter(c=>names.has(c.name))||[];
 const unique=[];const seen=new Set();for(const c of calls){if(!seen.has(c.source)){unique.push(c);seen.add(c.source);}}
 $('execution-map').innerHTML='<div class="section-label"><span>BU GİRDİDE FONKSİYONDAN FONKSİYONA</span><span>İlk görülme sırası · tıkla, çağrıyı aç</span></div>'+(result?`<div class="execution-nodes">${unique.map((c,i)=>`<button data-call="${c.id}"><span>${String(i+1).padStart(2,'0')} · ${calls.filter(x=>x.source===c.source).length} çağrı</span><b>${esc(c.name)}</b><small>${esc(Object.keys(c.input).filter(k=>k!=='config').join(', ')||'nesne bağlamı')} → ${esc(Array.isArray(c.output)?'liste':c.output===null?'mutasyon / null':typeof c.output==='object'?'nesne':typeof c.output)}</small></button>`).join('<span class="execution-arrow">→</span>')}</div><p class="note">Oklar ilk çağrıların görülme sırasını gösterir; fonksiyonların tamamı birbirinin doğrudan çağıranı değildir. Tam üst/alt çağrı ilişkisi “Çağrı izi” sekmesindedir.</p>`:'<p class="note">Deneyi çalıştırınca bu girdide gerçekten çalışan fonksiyonlar ve veri türleri burada belirecek.</p>');
}
function geometryVisual(o){
 const offset=o.scene.offset_mm,scale=7,start=50,y=30,size=o.scene.edge_mm*scale;
 return `<svg viewBox="0 0 420 135" role="img" aria-label="İki küpün XY izdüşümü; merkez uzaklığı ${offset} mm" style="width:100%;max-height:180px;background:#f5f8f2;border-radius:6px"><rect x="${start}" y="${y}" width="${size}" height="${size}" fill="#398d7c" fill-opacity=".6" stroke="#26725f"/><rect x="${start+offset*scale}" y="${y}" width="${size}" height="${size}" fill="#e0a46c" fill-opacity=".6" stroke="#b97e47"/><text x="${start}" y="20" font-size="11" fill="#315e53">BlockA</text><text x="${start+offset*scale}" y="120" font-size="11" fill="#95633e">BlockB · ${offset} mm</text></svg><p class="note">XY izdüşümü; her küp 10 × 10 × 10 mm. Görsel yalnız girdinin çizimidir; analiz aşağıdaki gerçek Python çıktısıdır.</p>`+`<div class="tree">${tree(o.analysis,'Geometrik analiz')}</div>`;
}
