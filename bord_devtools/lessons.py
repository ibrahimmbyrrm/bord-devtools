"""Turkish curriculum and executable, editable examples (synthetic unless marked CAD)."""
from copy import deepcopy
from . import runtime as r

ZERO = {'allowance_profiles': {'default': {'performance_percent':100,'pfd_percent':0}}}
OP = {'operation_id':'op-place','component':'Kapak','action':'yerleştir','pmts_context':{'part_reach_cm':30,'assembly_move_cm':20,'inspect_before':False,'inspect_after':False}}
OPS = [dict(operation_id=k, action='yerleştir', observed_duration_sec=t) for k,t in [('a',6),('b',6),('c',4)]]
STEPS = [dict(operation_id='root',component='Kapak montajı',action='yerleştir',observed_duration_sec=6,
    mtm_operations=[dict(operation_id='support',action='al',observed_duration_sec=2)],
    substeps=[dict(operation_id='child',component='Vida',action='sık',observed_duration_sec=4)])]
TREE = {'name':'Demo montaj','children':[
    {'name':'Mil','file_path':'Mil.SLDPRT'},
    {'name':'Vida','instance':1,'file_path':'Vida.SLDPRT'},
    {'name':'Vida','instance':2,'file_path':'Vida.SLDPRT'},
    {'name':'Yedek kapak','file_path':'Yedek.SLDPRT','suppressed':True},
    {'name':'Referans','file_path':'Referans.SLDPRT','excluded_from_bom':True}]}
ASSEMBLY={'assembly':{'tree':{'id':0,'name':'Demo','children':[
    {'id':1,'name':'Base','instance':1,'position':[0,0,0]},
    {'id':2,'name':'Plate','instance':1,'position':[0,0.1,0]},
    {'id':3,'name':'DIN 912 M6 Bolt','instance':1,'position':[0,0.2,0]}]}}}
TASKS=[dict(id=k,seconds=t,predecessors=pr) for k,t,pr in [('a',6,[]),('b',6,['a']),('c',4,['b'])]]
STATIONS=[{'id':'s1','operators':['o1']},{'id':'s2','operators':['o2','o3']}]
LINE={'id':'line','stations':[{'id':'s1','operators':[{'id':'o1','tasks':[dict(id=t['id'],name=t['id'],canonical_total_sec=t['seconds'],predecessorTaskIds=t['predecessors']) for t in TASKS]}]},{'id':'s2','operators':[{'id':'o2','tasks':[]},{'id':'o3','tasks':[]}]}]}
SETTINGS={'taktMode':'manual','manualTakt':10}
LINE_BENCHMARK={'station_count':2,'operator_count':3,
    'takt':{'taktMode':'manual','manualTakt':15,'shiftMinutes':480,'plannedBreakMinutes':30,'demandUnits':1500},
    'jobs':[
        {'number':1,'name':'Gövdeyi al','seconds':4,'predecessors':[]},
        {'number':2,'name':'Gövdeyi yerleştir','seconds':6,'predecessors':[1]},
        {'number':3,'name':'Contayı hazırla','seconds':3,'predecessors':[]},
        {'number':4,'name':'Contayı tak','seconds':5,'predecessors':[2,3]},
        {'number':5,'name':'Vidaları sık','seconds':7,'predecessors':[4]},
        {'number':6,'name':'Kontrol et','seconds':4,'predecessors':[5]}]}
FLOW_CANVAS={
    'takt': {'taktMode':'manual','manualTakt':12},
    'stations': [
        {'id':'S1','name':'Hazırlık','operators':[{'id':'O1','tasks':['1']}]},
        {'id':'S2A','name':'Paralel montaj A','operators':[{'id':'O2','tasks':['2']}]},
        {'id':'S2B','name':'Paralel montaj B','operators':[{'id':'O3','tasks':['3']}]},
        {'id':'S3','name':'Birleştirme ve kontrol','operators':[{'id':'O4','tasks':['4']}]},
    ],
    'parallel_groups': [{'id':'PG1','name':'Paralel montaj','station_ids':['S2A','S2B']}],
    'connections': [
        {'from':'S1','to':'S2A'}, {'from':'S1','to':'S2B'},
        {'from':'S2A','to':'S3'}, {'from':'S2B','to':'S3'},
    ],
    'tasks': [
        {'id':'1','number':1,'name':'Gövdeyi hazırla','seconds':4,'predecessors':[]},
        {'id':'2','number':2,'name':'Sol modülü monte et','seconds':5,'predecessors':['1']},
        {'id':'3','number':3,'name':'Sağ modülü monte et','seconds':4,'predecessors':['1']},
        {'id':'4','number':4,'name':'Birleştir ve kontrol et','seconds':6,'predecessors':['2','3']},
    ],
}
LESSONS=[]

def add(id,group,title,fn,purpose,input,observe,try_it,run,functions,*,variants=None,controls=None,warning='',next=None):
    LESSONS.append(dict(id=id,group=group,title=title,fn=fn,purpose=purpose,input=input,observe=observe,try_it=try_it,
        run=run,functions=functions,variants=variants or [],controls=controls or [],warning=warning,next=next))

def v(label,input): return dict(label=label,input=input)
def c(label,path,min=0,max=100,step=1,unit=''): return dict(label=label,path=path,min=min,max=max,step=step,unit=unit)

def op_run(d):return r.p.calculate_operation(d['operation'],r.config_for(d))
def plan_run(d):return r.p.calculate_plan(d['operations'],r.config_for(d))
def seq_run(d):return r.plan_sequence(d)
def sub_run(d):
    a,b=r.classify_subassembly(d['node'],d['internal_mate_count'],d.get('overrides'))
    return dict(classification=a,reason=b)

add('document','CAD → BOP','Dosyanın içini aç','open_document',
    'SolidWorks dosyası henüz bir operasyon değildir. İlk adım ikili konteyneri açıp XML ve geometri akışlarına erişmektir.',{},
    'Depodaki gerçek Rulo_Montaj.SLDASM dosyasının boyutunu, konteyner tipini ve akış listesini gör.',
    'Akışlarda COMPINSTANCETREE adını ara. Bir sonraki fonksiyon bu veriyi bileşen ağacına dönüştürecek.',r.cad_document,[r.open_document],next='assembly')
add('assembly','CAD → BOP','Bileşen ağacını çıkar','read_assembly',
    'Model dosyası ile montaj içindeki örneği farklıdır. Aynı vida dosyasından çok sayıda instance oluşur; konum ve konfigürasyon örneğe aittir.',{},
    'Ağaçta Rulo örneklerini ve BOM içindeki quantity alanını karşılaştır. position metre, dimensions_mm milimetredir.',
    'Ağaç görünümünde aynı adı taşıyan örnekleri aç. BOM sayımı ile BOP operasyon sayısının aynı olmak zorunda olmadığını gözle.',r.cad_assembly,[r.read_assembly,r.Assembly.to_dict],next='mates')
add('mates','CAD → BOP','Bağları seviyesinde oku','collect_assembly_mates',
    'Her alt montajın bağlantıları kendi dosyasındadır. Üst dosyayı okumak iç montaj yöntemini tek başına açıklamaz.',{},
    'resolved ve mates alanlarını incele. Boş mate listesi ile dosyanın çözülememesi farklı durumlardır.',
    'Çağrı izinde collect_assembly_mates → read_mates geçişini aç; hedeflenen dosya ile çıktıyı yan yana incele.',r.cad_mates,[r.collect_assembly_mates],next='bom')
add('bom','CAD → BOP','BOM filtrelerini dene','Assembly.bom',
    'Yaprak parçalar dosyaya göre gruplanır. Bastırılmış parça varsayılan olarak atılır; excluded_from_bom parçası her durumda dışarıda kalır.',
    {'tree':TREE,'include_suppressed':False},'İki Vida örneği tek satırda quantity=2 olur. Yedek ve referans parça varsayılan listede görünmez.',
    'Bastırılmışları dahil et örneğine geç. Referans parça yine gelmemeli. Sonra JSON içindeki excluded_from_bom değerini false yap.',
    r.bom_filter,[r.Assembly.bom,r.Assembly.walk],variants=[v('Bastırılmışları dahil et',{'tree':TREE,'include_suppressed':True})],next='enrich')
add('enrich','CAD → BOP','Kütle ve malzemeyi zenginleştir','enrich_bom → read_part_details',
    'BOM dosya adları, sabit örnek klasördeki parça dosyalarıyla eşleşir. Kütle kaynağı bulunamıyorsa değer uydurulmaz.',
    {'bom':[{'filename':'Rulo_Mili.SLDPRT','file_path':'Rulo_Mili.SLDPRT','quantity':1},{'filename':'bulunamayan.SLDPRT','file_path':'bulunamayan.SLDPRT','quantity':2}]},
    'Mevcut parça ile çözülemeyen parça arasındaki alan farklarını gör. Kütle verisi daha sonra hareket bağlamını etkiler.',
    'quantity değerini değiştir ve tek parça kütlesi/toplam alan ayrımını incele. Bu deney yalnız örnek klasöründeki dosyaları açar.',r.bom_enrich,[r.enrich_bom],next='standard')
add('standard','CAD → BOP','Standart parçayı sınıflandır','classify_row',
    'İsim örüntüsü ve standart kodu kanıttır; kesin üretim kararı değildir. Bir regex eşleşmesinin BOP üzerindeki etkisini anlamadan parçayı gizleme.',
    {'row':{'filename':'DIN 912 M6x20.SLDPRT','quantity':4}},'is_standard, family, confidence ve reason alanlarını incele.',
    'Dosya adını 23045-Govde-Weldment olarak değiştir. Standart parça sınıflandırması ile alt montaj kapatma kuralının ayrı fonksiyonlar olduğunu gör.',
    lambda d:r.classify_row(d['row']),[r.classify_row],next='subassembly')
add('subassembly','CAD → BOP','Alt montaj açılır mı?','classify_subassembly',
    'closed: satın alınmış tek blok; phantom: yapısal klasör; assembled: içeride yapılan alt montaj. Kontroller sırayla çalışır ve ilk karar önemlidir.',
    {'node':{'name':'Govde','instance':1,'children':[{'name':'Plate'},{'name':'Bolt'}]},'internal_mate_count':8},
    'Kararın yanında reason görünür. Sekiz mate varken iç iş olarak ele alınmasını; sıfır mate için phantom olmasını karşılaştır.',
    'Mate sayısını sıfır yap; sonra regresyon bölümündeki parça adı deneyini aç.',sub_run,[r.classify_subassembly],
    controls=[c('İç bağlantı sayısı',['internal_mate_count'],0,20)],next='sequence')
add('sequence','CAD → BOP','Montaj sırasını üret','plan_sequence',
    'Bileşen ağacı, bağlantılar, geometrik öncelikler ve parça rolleri BOP adımlarına dönüşür. Parça adını fiile dönüştüren sezgiler mühendis incelemesi ister.',
    ASSEMBLY,'Her adımın component, action, targets ve fasteners alanlarını aç. CAD parçası ile BOP adımının bire bir olmadığını gör.',
    'DIN 912 M6 Bolt adını düz bir isimle değiştir. Bağlantı gruplama ve aksiyon seçiminin değişip değişmediğini A/B karşılaştır.',seq_run,[r.plan_sequence],next='flatten')
add('flatten','PMTS çekirdeği','İş ağacını düzleştir','_flatten_steps',
    'Bu BOM düzleştirmesi değildir. Her kök önce eklenir; mtm_operations gelir; substeps için aynı işlem tekrarlanır. Kimlikler operation_id ile korunur.',
    {'steps':STEPS},'Sıra root → support → child olur. Kök satır atılmaz; kökün kendi işi ile alt işlerin toplamı ayrıdır.',
    'Bir alt adım daha ekle. Çıktıyı calculate_plan girişine aktar; toplamı 6 + 2 + 4 = 12 s olarak kontrol et (bu deneyde PFD=0).',
    lambda d:r.HELPERS['_flatten_steps'](d['steps']),[r.HELPERS['_flatten_steps']],next='plan')
add('classify','PMTS çekirdeği','Fiili aktiviteye eşle','classify',
    'En uzun anahtar kelime eşleşmesi kazanır. Aktivite daha sonra hangi hareketlerin korunacağını belirler; yalnız görünen etiketi değiştirmez.',
    {'action':'hazırla ve yerleştir'},'Birleşik talimat assemble ile eşleşirken yalnız hazırla handle ile eşleşir.',
    'Hazırla örneğine geç ve hareket filtresi deneyinde 0.072 saniyeye neden düştüğünü izle.',
    lambda d:r.p.classify(d['action'],r.config_for(d)),[r.p.classify],variants=[v('Yalnız hazırla',{'action':'hazırla'}),v('Bilinmeyen iş',{'action':'özel reçete adımı'})],next='context')
add('context','PMTS çekirdeği','Hareket bağlamını kur','derive_context',
    'Mesafe, ağırlık, kavrama, geçme ve takım parametreleri hareketleri belirler. Bu bağımsız deney derive_context çağrısını gösterir; calculate_operation ayrıca metin → istasyon → açık giriş önceliğini uygular.',
    {'operation':{'action':'yerleştir','component':'Kapak','weight_kg':1},'overrides':{'part_reach_cm':30,'assembly_move_cm':20}},
    'StepContext alanlarının büyük bölümü varsayılandır. Çıktı üretilmiş olması bunların ölçülmüş olduğu anlamına gelmez.',
    'Uzanma mesafesini 60 cm yap; sonraki deneyde aynı alanı değiştirip R/M öğelerindeki farkı gör.',r.contextualize,[r.derive_context],
    controls=[c('Parçaya uzanma',['overrides','part_reach_cm'],0,100,1,'cm'),c('Montaj yerine taşıma',['overrides','assembly_move_cm'],0,100,1,'cm')],next='expand')
add('expand','PMTS çekirdeği','İşi hareketlere aç','expand_step',
    'Gözlem → erişim → parça → bağlantı → takım → kontrol fazları üretilir. Bu ham genişlemedir; aktivite filtresi ve plan düzeltmeleri henüz uygulanmadı.',
    {'operation':OP},'elements tablosunda code, phase, count, tmu ve total_sec alanlarını gör. R erişim, G kavrama, M taşıma, P konumlandırma, RL bırakmadır.',
    'operation.pmts_context.part_reach_cm ve assembly_move_cm alanlarını değiştir. Kullanılan mesafeleri ve R/M satırlarını izle. Üst düzey context verirsen bu açık bağlam öncelik kazanır. Ham genişleme nihai süre değildir.',r.expand,[r.expand_step,r.derive_context],
    controls=[c('Parçaya uzanma',['operation','pmts_context','part_reach_cm'],1,100,1,'cm'),c('Montaj yerine taşıma',['operation','pmts_context','assembly_move_cm'],1,100,1,'cm')],next='operation')
add('operation','PMTS çekirdeği','Bir operasyonun süresini hesapla','calculate_operation',
    'Düğümün içine gir: doğrula → aktivite → bağlam → hareket genişlemesi → filtre → tablo → düzenlemeler → tekrar → iki el → paylar → insan/makine → birime dağıtım.',
    {'operation':OP},'Hareket tablosu ham TMU’yu, süre merdiveni ise ham insan, standart insan, makine ve nihai süreyi ayrı gösterir. assumed_inputs ve warnings mutlaka okunmalı.',
    'Mesafeyi ve tekrar sayısını değiştir, önce A olarak sakla, sonra yeniden çalıştır. Çağrı izindeki expand_step ile nihai elements arasındaki kaybolan öğeleri incele.',
    op_run,[r.p.calculate_operation,r.p.validate_operation,r.p.classify,r.derive_context,r.expand_step,r.p._motion_tmu],
    controls=[c('Uzanma',['operation','pmts_context','part_reach_cm'],1,100,1,'cm'),c('Tekrar',['operation','repeat_count'],1,6)],next='allowance')
add('allowance','PMTS çekirdeği','Ham süre → standart süre','calculate_operation · allowance',
    'Kodun mevcut hesabı: insan süresi = ham × 100 / performans × (1 + PFD / 100). Deney ölçülmüş 10 saniyeyi kullanır; bu ayarlar süre tanımını değiştirir.',
    {'operation':{'action':'yerleştir','observed_duration_sec':10},'config':{'allowance_profiles':{'default':{'performance_percent':100,'pfd_percent':11}}}},
    'Ham 10 s → standart insan 11.1 s. Mevcut kod observed_duration_sec ve verified_duration_sec girdilerini measurement olarak etiketler; laboratuvara sayı yazmak fiziksel ölçüm kanıtı sağlamaz.',
    'PFD’yi sıfıra çek; ardından performansı değiştir. Ham MTM normal zamanı ile gözleme uygulanan performansın mühendislik anlamını birbirine karıştırma.',
    op_run,[r.p.calculate_operation],controls=[c('PFD',['config','allowance_profiles','default','pfd_percent'],0,30,1,'%'),c('Performans',['config','allowance_profiles','default','performance_percent'],50,150,5,'%')],next='hands')
HAND_ELEMENTS=[{'key':'left','code':'R30B','total_sec':2,'total_tmu':2/.036},{'key':'right','code':'M20B','total_sec':3,'total_tmu':3/.036}]
add('hands','PMTS çekirdeği','İki el eşzamanlılığı','simultaneous_motion_time',
    'Yalnız açıkça tanımlanmış, bağımsız sol/sağ el hareketleri örtüşür. Sol toplam 2 s, sağ toplam 3 s ise geçen süre 3 s olur; hareket iş içeriği 5 s kalır.',
    {'elements':HAND_ELEMENTS,'groups':[{'left':['left'],'right':['right'],'method_note':'Sentetik örnek: bağımsız parçalar, ayrı eller.'}]},
    'elapsed_sec ile total_sec farklıdır. İki el örneğinin bağımsızlık notu otomatik uygunluk kanıtı değildir.',
    'groups değerini [] yap. Sonra notu silerek doğrulama hatasını canlı gör.',
    lambda d:dict(zip(('elements','comparisons'),r.simultaneous_motion_time(d['elements'],d['groups']))),[r.simultaneous_motion_time],
    variants=[v('Örtüşme yok',{'elements':HAND_ELEMENTS,'groups':[]})],next='overlap')
add('overlap','Plan → hat','İnsan ile makine örtüşür mü?','calculate_operation · machine_overlap',
    'Operasyon içinde 6 s insan + 10 s makine: sıralıysa 16 s; örtüşüyorsa max(6,10)=10 s. Bu, iki ayrı operasyonun parallel_group hesabından farklıdır.',
    {'operation':{'action':'yerleştir','observed_duration_sec':6,'observed_machine_cycle_sec':10,'machine_overlap':False},'config':ZERO},
    'Nihai geçen süre ile unit_human_sec/unit_machine_sec ayrı kalır. İnsan iş içeriği kaybolmaz.',
    'Örtüşmeli örneğe geç. Sonra 2 saniye loss_sec ekle; nihai toplamın nereye eklendiğini izle.',op_run,[r.p.calculate_operation],
    variants=[v('Örtüşmeli',{'operation':{'action':'yerleştir','observed_duration_sec':6,'observed_machine_cycle_sec':10,'machine_overlap':True},'config':ZERO})],next='allocation')
add('allocation','Plan → hat','Tekrar ile birime dağıtım','calculate_operation · allocation_factor',
    'repeat_count fiziksel tekrarı; frequency / parallel_stations ürün başına dağıtımı ifade eder. parallel_stations bir hat zamanlama algoritması değildir.',
    {'operation':{'action':'yerleştir','observed_duration_sec':10,'frequency':1,'parallel_stations':2},'config':ZERO},
    '10 s iş, bu dağıtım varsayımıyla ürün başına 5 s olur. Operasyonun fiziksel olarak 5 saniyede yapıldığı sonucu çıkarılamaz.',
    'frequency değerini 2 yap. Sonra allocation_in_frequency=true ekle; ikinci kez bölmenin nasıl engellendiğini incele.',op_run,[r.p.calculate_operation],
    controls=[c('Frekans',['operation','frequency'],0.1,5,.1),c('Paralel birim',['operation','parallel_stations'],1,5)],next='plan')
PAR_OPS=deepcopy(OPS);PAR_OPS[0]['parallel_group']='independent';PAR_OPS[1]['parallel_group']='independent'
add('plan','Plan → hat','calculate_plan içini aç','calculate_plan',
    'Bu fonksiyon üç iş yapar: her operasyonu hesaplar; seri/paralel gruplarda süreleri toplar; eksik analiz kapsamını bildirir. İstasyon veya operatör atamaz.',
    {'operations':OPS,'config':ZERO},'6 + 6 + 4 = 16 s. İlk iki satır aynı parallel_group içindeyse max(6,6) + 4 = 10 s. Karttaki grup şemasında bu indirgemeyi gör.',
    'Seri sonucu A olarak sakla. Paralel örneği çalıştır ve farkları aç. Sonra bir aksiyonu bilinmeyen işe çevirip observed_duration_sec alanını kaldır: coverage doğruluk yüzdesi değildir.',
    plan_run,[r.p.calculate_plan,r.p.calculate_operation],variants=[v('İlk iki operasyon paralel',{'operations':PAR_OPS,'config':ZERO}),v('Bir işin verisi eksik',{'operations':[OPS[0],{'operation_id':'unknown','action':'özel reçete'}],'config':ZERO})],next='canonical')
add('canonical','Plan → hat','Kök operasyona toplamı yaz','_apply_canonical_mtm_times',
    'Her kök kendi işini ve alt işlerini sahiplenir. own_standard_time_sec yalnız o satır; standard_time_sec kökün tamamı; canonical_actions ise denetlenebilir alt kırılımdır.',
    {'steps':STEPS,'config':ZERO},'Kökün kendi işi 6 s, support 2 s, child 4 s; kökün plan toplamı 12 s. Kök toplamı ile alt işleri tekrar toplamak çift sayımdır.',
    'Alt iş süresini değiştir ve canonical_actions üzerindeki aynı operation_id’yi takip et. Fonksiyon None döndürür: çıktı, değiştirdiği steps nesnesidir.',
    r.canonical,[r.HELPERS['_apply_canonical_mtm_times'],r.HELPERS['_ensure_operation_ids'],r.HELPERS['_flatten_steps'],r.p.calculate_plan],
    warning='Orijinal app.py fonksiyonları değiştirilmeden çalışır. Ayarlar, kalibrasyon ve kütle sağlayıcıları laboratuvar girdileriyle enjekte edilir; veritabanı açılmaz.',next='line')
add('robot','Plan → hat','Robot: hareket ve kanıt','estimate_robot',
    'Robot işi insan MTM hareketlerine çevrilmez. Fiziksel model, kalibrasyon, belge referansı veya ölçüm farklı kanıt seviyeleridir.',
    {'operation':{'action':'transfer','work_type':'robot','use_training_prior':False,'robot_parameters':{'process':'move','distance_mm':500,'speed_mm_s':500,'accel_mm_s2':1000}}},
    'Trapez/üçgen hız profilinden 1.5 s fiziksel hareket hesaplanır. physical_model ölçülmüş çevrim değildir; eksik proses süreleri ayrıca gerekir.',
    'Mesafeyi 100 mm yap. Sonra speed_mm_s alanını sil ve tahminin neden durduğunu gör; use_training_prior=false bu deneyde eğitim önselini kapatır.',
    lambda d:r.estimate_robot(d['operation']),[r.estimate_robot,r.motion_seconds],controls=[c('Hareket',['operation','robot_parameters','distance_mm'],0,1500,50,'mm')],next='rowcycle')
add('rowcycle','Plan → hat','Belge çevrimini bir kez say','_apply_canonical_mtm_times · document_row',
    'Robotun belge satırı toplamı her alt harekete kopyalanamaz. Tüm satır robot/makine ise çevrim kökte sahiplenilir; alt işler dahil kabul edilir.',
    {'steps':[{'operation_id':'robot-root','action':'transfer','work_type':'robot','source_row_duration_sec':12,'mtm_operations':[{'operation_id':'robot-child','action':'transfer','work_type':'robot'}]}]},
    'Kök 12 s, alt iş 0 s ve scope=included_in_document_row. 0 burada iş yok anlamına gelmez; toplamın içinde demektir.',
    'Satır süresini 20 s yap ve yalnız kökün ücretlendiğini gör. Sonra alt işin work_type değerini manual yap; karma satırın uyarısını incele.',r.canonical,[r.HELPERS['_apply_canonical_mtm_times']],next='line')
add('line','Plan → hat','BOP → hat görevleri','line_inputs',
    'Hat ağacı tasks + stations + origins sözleşmesine çevrilir. Kaynak BOP sırası korunur; makine işi mevcut istasyona ve kaynağa bağlanır.',
    {'line':LINE},'predecessors, seconds, human_seconds ve kaynak kilitlerini incele. Bu dönüşüm süre hesaplamaz; kanonik süreyi tüketir.',
    'Göreve canonical_machine_sec=3 ekle; resources ve locked_station alanlarını gör. predecessorTaskIds alanları kaldırılırsa manuel listedeki sıra korunur.',
    lambda d:dict(zip(('tasks','stations','origins'),r.method_balance.line_inputs(d['line']))),[r.method_balance.line_inputs],next='takt')
add('takt','Plan → hat','Talep → takt','demand_takt',
    'Takt müşteri talebinden gelir; operasyon sürelerinden türetilmez. Net vardiya saniyesi / talep adedi.',
    {'settings':{'shiftMinutes':480,'plannedBreakMinutes':30,'demandUnits':2700}},
    '(480 − 30) × 60 / 2700 = 10 s/adet. Sıfır talep tahmin edilen bir takt üretmez; null döner.',
    'Talebi iki katına çıkar: izin verilen süre yarıya inmeli. Mola vardiyadan büyük olduğunda hata beklenir.',
    lambda d:dict(takt_sec=r.demand_takt(d['settings'])),[r.demand_takt],controls=[c('Talep',['settings','demandUnits'],0,6000,100,'adet')],next='balance')
add('balance','Plan → hat','Öncelik ve kaynaklarla dengele','balance',
    'Bölünemez görevler, önceki işler ve operatör/kaynak takvimleriyle yerleşir. Aynı istasyonda önceki işin bitişi beklenir; başka istasyondaki sıfır başlangıcı hat çevriminin yerel zamanıdır.',
    {'tasks':TASKS,'stations':STATIONS,'takt':10},
    'İstasyonlar 6 ve 10 s; darboğaz 10 s; toplam insan işi 16 s. Üç operatörde doluluk 16/(3×10)=%53.33. Ek operatör bağımlılıkları yok etmez.',
    'b → c bağını kaldırıp çizelgeyi karşılaştır. Taktı 5 s yapınca overloads ve feasible=false gör. Bu sezgisel algoritma optimum bulma garantisi vermez.',
    lambda d:r.balance(d['tasks'],d['stations'],d['takt']),[r.balance],controls=[c('Takt',['takt'],1,30,1,'s')],next='line-benchmark')
add('line-benchmark','Plan → hat','Hat dengeleme benchmarkı','balance_line → balance',
    'İş numarası, süre, öncül işler, robot/makine kaynakları ve operatör kadrosuyla gerçek hat dengeleme yolunu çalıştırır. Manuel işlerde açık öncül listesi kullanılır; boş liste bağımsız işi belirtir.',
    LINE_BENCHMARK,
    'İş numaralarının hangi operatöre, hangi saniyede atandığını; istasyon çevrimlerini ve takt çizgisini karşılaştır. İstasyon kadrosunu ve makine kimliğini de açıkça girebilirsin.',
    'Bir işi gözetimsiz robot yapıp insan meşguliyetini 0 ve tam çevrim arasında değiştir. Aynı sonucu A olarak saklayıp farklı kaynak ve taleple B sonucunu karşılaştır. Başarısız sezgisel sonuç kanıtlı imkânsızlık değildir.',
    r.line_benchmark,[r.method_balance.balance_line,r.method_balance.line_inputs,r.demand_takt,r.balance,r.method_balance.apply_balance_result,r.method_balance.annotate_line_schedule],
    variants=[v('Sıkı takt',dict(LINE_BENCHMARK,takt=dict(LINE_BENCHMARK['takt'],manualTakt=9))),
              v('Talebe göre takt',dict(LINE_BENCHMARK,takt=dict(LINE_BENCHMARK['takt'],taktMode='auto')))],
    warning='Girilen iş süreleri benchmark girdisidir; PMTS hesabı veya saha ölçümü olarak doğrulanmaz.',next='schedule')
add('flow-canvas','Plan → hat','Flow Canvas: paralel hat örneği','flow_canvas → balance_line → balance',
    'İstasyonları düğüm olarak kur, görevleri operatörlere yerleştir, akışı iki kola ayır ve tekrar birleştir. Bu ilk örnek görsel yerleşimi üretim dengeleme sözleşmesine çevirerek aynı dengeleme motoruyla simüle eder.',
    FLOW_CANVAS,
    'S1’den S2A/S2B’ye ayrılan akışı, iki paralel istasyonun S3’te birleşmesini ve her görevin öncül oklarını gör. Kartlarda gerçek başlangıç/bitiş ve takt sonucu görünür.',
    'JSON içindeki `connections` alanında bir kolu silip tekrar çalıştır. Sonra S2B görevini S2A’ya taşıyarak operatör ve takt etkisini karşılaştır.',
    r.flow_canvas,[r.flow_canvas,r.method_balance.balance_line,r.method_balance.line_inputs,r.balance],
    warning='DEV canvasında istasyon kartlarını sürükleyebilir, portlarla akış kurabilir, metot ağacındaki işleri operatörlere bırakabilir ve seçili istasyonları paralel grup yapabilirsin. Değişiklikler yalnız JSON deney girdisine yazılır; üretim hattı ve veritabanı değişmez.',next='schedule')
add('schedule','Plan → hat','Yerleşimin gerçek çevrimi','annotate_line_schedule',
    'Mevcut operatör sırası sabitlenerek takvim yeniden hesaplanır. Ekranda max(operatör yükleri) almak, operatörler arasındaki bağımlı beklemeyi gizleyebilir.',
    {'line':{'id':'fixed','stations':[{'id':'s1','operators':[{'id':'o1','tasks':[{'id':'a','canonical_total_sec':6,'predecessorTaskIds':[]}]},{'id':'o2','tasks':[{'id':'b','canonical_total_sec':4,'predecessorTaskIds':['a']}]}]}]}},
    'İki operatör olmasına rağmen b, a’dan sonra başlar; istasyon çevrimi 10 s olur, 6 s olmaz.',
    'b için predecessorTaskIds=[] yap; bağımsız işler 0’dan başlayabilir ve çevrim 6 s olur. Aynı süreler farklı bağımlılıklarla farklı kapasite verir.',
    lambda d:annotate(d),[r.method_balance.annotate_line_schedule,r.method_balance.line_inputs,r.balance],next='benchmark')
def annotate(d):
    line=deepcopy(d['line']);r.method_balance.annotate_line_schedule(line);return line
add('benchmark','Plan → hat','Referansla karşılaştır','benchmark',
    'Tahmin ile aynı kapsamlı referans saniyesi karşılaştırılır. Eksik analizli vakalar hata metriğinden çıkarılır; coverage analizin tamamlanmasıdır, doğruluk değildir.',
    {'cases':[{'id':'sentetik-tam','expected_sec':20,'operations':OPS},{'id':'sentetik-eksik','expected_sec':10,'operations':[{'action':'özel reçete'}]}],'config':ZERO},
    '16 s tahmin / 20 s referans → %20 mutlak hata. Eksik vaka excluded olur. Buradaki sayılar öğretim amaçlı sentetiktir; AVIX başarısı iddiası değildir.',
    'Referansı 16 yap: MAPE sıfır olur. Ardından operasyonların kapsamını değiştir; yalnız metriğin iyi görünmesinin yeterli olmadığını gör.',
    lambda d:r.p.benchmark(d['cases'],r.config_for(d)),[r.p.benchmark,r.p.calculate_plan])

BUG_NODE={'name':'23045-Govde-Weldment','instance':1,'children':[{'name':'Plate'},{'name':'Bolt'}]}
add('bug-purchased','Sınır ve regresyon deneyleri','Parça adı iç işleri kapatıyor mu?','classify_subassembly · in_house',
    '23… ile başlayan parça adının iç montajı yanlışlıkla kapatmaması gerekir.',
    {'node':BUG_NODE,'internal_mate_count':8},'Güncel sonuç assembled / in_house olmalı; iç bağlantılar korunur.',
    'Mühendis override örneğini de çalıştır. Bu girdide karar aynı kalır; başka vakalarda açık override kullanılabilir.',sub_run,[r.classify_subassembly],
    variants=[v('Mühendis override',{'node':BUG_NODE,'internal_mate_count':8,'overrides':{'23045-Govde-Weldment-1':'assembled'}})],warning='Regresyon örneği: çıktı değişirse sınıflandırma kuralını inceleyin.')
add('bug-step','Sınır ve regresyon deneyleri','STEP adı iç işleri kapatıyor mu?','classify_subassembly · in_house',
    'STEP uzantısı tek başına satın alınmış montaj kanıtı değildir.',
    {'node':{'name':'InHouseFrame','instance':1,'children':[{'name':'Plate.step'},{'name':'Bolt.step'}]},'internal_mate_count':8},
    'Güncel sonuç assembled / in_house olmalı. İç bağlantı sayısını düşürerek karar sınırını dene.',
    'A’yı sakla, yalnız uzantıları sil, B’yi çalıştır. Ad değişikliğinin kararı değiştirmediğini gör.',sub_run,[r.classify_subassembly],warning='Regresyon örneği: yalnız dosya uzantısından satın alma kararı verilmemeli.')
CYCLE=deepcopy(ASSEMBLY);CYCLE['assembly']['tree']['children'][1]['name']='Ust_Kapak';CYCLE['assembly']['tree']['children'][2]['name']='Alt_Kapak';CYCLE['interference_analysis']={'geometric_precedence':{'Ust_Kapak-1':['Alt_Kapak-1']}}
add('bug-cycle','Sınır ve regresyon deneyleri','Kapak önceliği döngü üretiyor mu?','plan_sequence · precedence',
    'Geometrik öncelik ile parça adı sezgisinin birleşmesi döngü oluşturmamalı.',
    CYCLE,'Güncel plan hatasız oluşmalı. Çıktıda adım sırası ve öncülleri incele.',
    'Ust_Kapak adını Panel yap; aynı geometrik bağı güncelle ve karşılaştır.',seq_run,[r.plan_sequence],warning='Regresyon örneği: PrecedenceError dönerse sıralama tekrar bozulmuş olabilir.')
add('bug-prepare','Sınır ve regresyon deneyleri','Belirsiz “hazırla” işi','calculate_operation · unknown',
    'Genel hazırlık komutu hangi hareketlerin yapılacağını söylemez; sessizce çok küçük süre üretmemeli.',
    {'operation':{'operation_id':'prepare','action':'hazırla'}},'Güncel sonuç needs_input ve veri açığı olmalı. 0 saniye tamamlanmış süre anlamına gelmez.',
    'Aktiviteyi açık assemble yap örneğiyle hareket farkını gör. Bu da ancak iş gerçekten bu kapsamdaysa geçerlidir.',op_run,[r.p.classify,r.expand_step,r.p.calculate_operation],
    variants=[v('Aktiviteyi açık assemble yap',{'operation':{'operation_id':'prepare','action':'hazırla','activity':'assemble'}})],warning='Regresyon örneği: belirsiz hazırlık işi needs_input kalmalı.')
add('gap-crank','Sınır ve regresyon deneyleri','Eksik tabloyu sıfır sanma','calculate_operation · Crank',
    'Crank referans tablosu mevcut değil. Sistem Turn ile uydurma ikame yapmaz; needs_input üretir. Sıfır görünen süre tamamlanmış analiz değildir.',
    {'operation':{'action':'sık','rotation_method':'crank'}},'warnings ve data_gaps alanlarında referans/ölçüm gereğini gör. Plan kapsamı eksik kalmalıdır.',
    'Ölçüm örneğini çalıştır: verified_duration_sec=8 ayrı kanıt sağlar. Bu deneydeki ölçüm sentetiktir.',op_run,[r.p.calculate_operation],
    variants=[v('Sentetik ölçümle tamamla',{'operation':{'action':'sık','rotation_method':'crank','verified_duration_sec':8}})],warning='Bilinen kapsam sınırı: lisanslı metrik MTM kartı sağlanmadı; destek/sertifikasyon iddiası yok.')
add('bug-density','Sınır ve regresyon deneyleri','Malzeme yazımı kütleyi etkiliyor','density_for_material',
    'Malzeme adının yazımı eşleşmeyi değiştirebilir. Eksik yoğunluk, geometriden kütle tahmininin kopmasına yol açar.',
    {'materials':['PA6-GF30','PA 6-GF30','Bronze plated steel']},'İlk iki yazımın null/yoğunluk farkını karşılaştır. Bronze plated steel için kodun gerçekten döndürdüğü değeri gör.',
    'Kendi sentetik malzeme adlarını listeye ekle. Sonuçların gözlem değil, sözlük/örüntü eşleşmesi olduğunu unutma.',
    lambda d:[{'material':x,'density_kg_m3':r.density_for_material(x)} for x in d['materials']],[r.density_for_material],warning='Açık: malzeme normalizasyonu / kaplamalı malzeme belirsizliği.')
add('pipeline','Uçtan uca','Gerçek CAD ile tüm zincir','CAD → BOP → PMTS → hat',
    'Depodaki Rulo örneğini tek çalıştırmada oku. Her sınırın verisini aç; bir sonraki fonksiyonun hangi çıktıyı tükettiğini izle. Bu zincirde gerçek CAD, varsayılan metot parametreleri kullanılır.',
    {'context':{'part_reach_cm':30,'assembly_move_cm':20},'takt':30,'geometry':True},
    'assembly → mates → bop → flattened → priced → method_line → balance. needs_input varsa dengeleme gerekçeyle engellenir; hazırmış gibi gösterilmez.',
    'Uzanma mesafesini değiştirip A/B karşılaştır. Kök toplamları, canonical_actions ve görev sürelerinde aynı farkın izini sür.',r.pipeline,
    [r.pipeline,r.read_assembly,r.collect_assembly_mates,r.plan_sequence,r.HELPERS['_flatten_steps'],r.p.calculate_plan,r.HELPERS['_apply_canonical_mtm_times'],r.method_balance.line_inputs,r.method_balance.balance_line],
    controls=[c('Uzanma',['context','part_reach_cm'],1,100,1,'cm'),c('Takt',['takt'],1,120,1,'s')],
    warning='Geometri yalnız çözülebilen mesh’ler için çalışır; 1 saniyelik bütçe ve unchecked alanlarını incele. Üretim UI/veritabanı bu deneyde çalıştırılmaz.')

add('mesh','CAD → BOP','Mesh, hacim ve birimler','extract_mesh',
    'Üçgenlerin koordinatı metredir. Sınır kutusu boyutları mm olarak raporlanır. Hacim, kütle tahmininde yoğunluk ile çarpılır; kutu hacmi malzeme hacmi değildir.',{},
    'Gerçek Rulo_Mili parçasındaki üçgen sayısı, mm boyutları ve m³ hacmi ayrı ayrı oku.',
    'triangle_sample koordinatlarını bounds_mm ile karşılaştır. Hacim sonucunun kapalı/yönlendirilmiş mesh varsayımı taşıdığını kaynak kodunda incele.',r.mesh_preview,[r.extract_mesh,r.Mesh.bounds_mm.fget,r.Mesh.volume_m3.fget],next='geometry')
add('geometry','CAD → BOP','Geometrik çift elemesi','InterferenceMatrix.compute',
    'İki 10 mm küp üzerinde gerçek geometrik analiz çalışır. AABB kutuları örtüşmüyorsa çift elenir; örtüşüyorsa altı yönde 2D izdüşüm testi yapılır. Bu tam CAD çarpışma çözümü değildir.',
    {'offset_mm':8},'8 mm merkez uzaklığında kutular örtüşür; detailed_tested=1 olur. 20 mm olduğunda aabb_eliminated=1 olur.',
    'Uzaklığı kaydır ve eleme sayısını izle. matrix içindeki yön booleanları ikinci isimli parçanın bloke olmasını gösterir; true serbest demek değildir.',
    r.geometry_run,[r.InterferenceMatrix.compute,r.InterferenceMatrix._aabb_overlap,r.InterferenceMatrix._blocked],
    controls=[c('Küp merkezleri arası',['offset_mm'],0,30,1,'mm')],variants=[v('Ayrık kutular',{'offset_mm':20})],next='feasibility')
add('feasibility','CAD → BOP','Sıra gerçekten uygulanabilir mi?','check_sequence_feasibility',
    'Sıra önerisi, fiziksel erişilebilirlik kontrolünden ayrıdır. Riskli adımda mesh süpürme, stabilite ve takım verisi değerlendirilir; eksik kanıt unchecked olarak kalabilir.',
    {'offset_mm':20},'analysis.results ve stats içinde checked, blocked ve çözülemeyen alanları aç. Her parçaya aynı güven etiketi verilmez.',
    'Uzaklığı 8 mm yap; iki katı parça örtüşürken çıkan blokaj sonucunu karşılaştır. Bir geometrik çiftin elenmesi tüm montaj metodunun doğruluğunu kanıtlamaz.',
    r.feasibility_run,[r.check_sequence_feasibility],controls=[c('Küp merkezleri arası',['offset_mm'],0,30,1,'mm')],next='sequence')
# Keep geometry next to its inputs in the guided curriculum.
extra=LESSONS[-3:];del LESSONS[-3:];LESSONS[3:3]=extra

add('resource-gap','Plan → hat','Ortak makinenin boş aralığını kullan','balance · _first_slot',
    'F denetiminde düzeltilen takvim vakası: makine 10–12 s aralığında doluysa 0–2 s işi yine sığar. Yalnız son bitiş zamanını tutmak yanlış biçimde 12–14 s sonucunu verirdi.',
    {'tasks':[{'id':'a','seconds':10,'locked_station':'s1','locked_operator':'o1'},
              {'id':'b','seconds':2,'predecessors':['a'],'resources':['machine'],'locked_station':'s1','locked_operator':'o1'},
              {'id':'c','seconds':2,'resources':['machine'],'locked_station':'s1','locked_operator':'o2'}],
     'stations':[{'id':'s1','operators':['o1','o2']}],'takt':12},
    'Çizelgede c=0–2 ve b=10–12 aynı makineyi çakışmadan kullanır. İstasyon çevrimi 12 s; yapay 14 s değil.',
    'c süresini 11 s yap. Boş aralığa sığmayan görev 12’den sonra başlamalı; kapasite sorunu gizlenmemeli.',
    lambda d:r.balance(d['tasks'],d['stations'],d['takt']),[r.balance],warning='Düzeltilmiş davranışın tekrar deneyi. Bu, bütün F kapsamının tek testle kanıtlandığı anlamına gelmez.',next='benchmark')
add('system','PMTS çekirdeği','Zaman sistemi seçimini karşılaştır','calculate_operation · time_system',
    'Aynı iş seçilen sisteme göre farklı öğeler üretir. AVIX Basic aktivite sınıfları MTM hareket kodlarıyla aynı sınıflandırma değildir.',
    {'operation':OP,'config':{'system':'MTM1'}},
    'MTM1 örneğinde hareket tablosunu, AVIX örneğinde aktivite sürelerini karşılaştır. Mevcut kod MTM2 seçimini MTM1’e yönlendirir; bağımsız MTM-2 hesabı sanma.',
    'MTM1 sonucunu A olarak sakla, AVIX seç ve çalıştır. Sonra MTM2 isteği örneğinde time_system çıktısının MTM1 olduğunu gör.',op_run,[r.p.calculate_operation],
    variants=[v('AVIX Basic',{'operation':OP,'config':{'system':'AVIX'}}),v('MTM2 isteği / mevcut yönlendirme',{'operation':OP,'config':{'system':'MTM2'}})],warning='Sistem seçimi gerçek ölçümün yerini tutmaz. Lisanslı kartla doğrulama yapılmadı.',next='plan')

# Display and keyboard navigation follow the same group order.
_group_order={g:i for i,g in enumerate(['CAD → BOP','PMTS çekirdeği','Plan → hat','Sınır ve regresyon deneyleri','Uçtan uca'])}
LESSONS.sort(key=lambda l:_group_order[l['group']])
for lesson in LESSONS:
    lesson['data_basis']='Depodaki gerçek CAD örneği' if lesson['id'] in {'document','assembly','mates','mesh','enrich','pipeline'} else 'Sentetik, düzenlenebilir eğitim girdisi'
    if lesson['id']=='mates': lesson['next']='mesh'
    if lesson['id']=='feasibility': lesson['next']='bom'

for lesson in LESSONS:
    if lesson['id']=='pipeline':
        lesson['variants'].append(v('Eksik iki işe sentetik gözlem ekle',{'context':{'part_reach_cm':30,'assembly_move_cm':20},'takt':30,'geometry':True,'operation_overrides':{'cad-op-5':{'observed_duration_sec':4},'cad-op-14':{'observed_duration_sec':4}}}))
        lesson['try_it'] += ' Eksik iki işe sentetik gözlem ekle varyantı, yalnız eğitim için 4 saniyelik değerlerle engelin kalkmasını gösterir; gerçek CAD metodu ölçülmüş sayılmaz.'

for lesson in LESSONS:
    if lesson['id']=='pipeline':
        relaxed=deepcopy(lesson['variants'][0]['input']);relaxed['takt']=120
        lesson['variants'].append(v('Sentetik veri tamam, takt 120 s',relaxed))
        lesson['observe'] += ' İlk sentetik gözlem varyantında analiz tamamlanır ama 30 s takt aşılır; 120 s varyantı kapasite farkını gösterir.'
