"""Live teaching adapters around this checkout's engineering functions.

Examples are data, never reimplementations of production calculations. The
canonical BOP pricing helper is called directly with isolated input evidence.
"""
from __future__ import annotations
from copy import deepcopy
from dataclasses import asdict, is_dataclass, fields
import hashlib
import importlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'anvex-webapp'))
from anvex_parser import (open_document, read_assembly, Assembly, Component,
    collect_assembly_mates, default_sibling_resolver)
from anvex_bom import enrich_bom
from anvex_bom.standard_parts import classify_row
from anvex_bom.density import density_for_material
from anvex_sequencing.sequence_planner import plan_sequence, classify_subassembly
from anvex_pdts import planning as p
from anvex_pdts.element_expansion import StepContext, derive_context, expand_step
from anvex_pdts.motion_evidence import simultaneous_motion_time
from anvex_pdts.robot_timing import estimate_robot, motion_seconds
from anvex_pdts.balancing import balance, demand_takt
import method_balance
import timing_evidence

FIXTURE = ROOT / 'anvex-webapp/sample_project/Rulo_Montaj.SLDASM'

# In embedded DEV mode, app.py is already importing this module. In standalone
# mode, importing it here still obtains the same current function objects.
WEBAPP = next(
    (module for key in ('app', 'webapp.app')
     if (module := sys.modules.get(key)) is not None
     and Path(getattr(module, '__file__', '')).resolve() == ROOT / 'anvex-webapp/app.py'),
    None,
) or importlib.import_module('app')
HELPERS = {name: getattr(WEBAPP, name) for name in
           ('_flatten_steps', '_ensure_operation_ids', '_apply_canonical_mtm_times')}

def config_for(data):
    config = deepcopy(p.DEFAULT_CONFIG)
    # Recursive merge allows small meaningful edits without a 200-line config.
    def merge(dst, patch):
        for k, v in patch.items():
            if isinstance(v, dict) and isinstance(dst.get(k), dict): merge(dst[k], v)
            else: dst[k] = deepcopy(v)
    merge(config, data.get('config', {}))
    return p.validate_config(config)


def component(data, serial=None):
    serial = serial or iter(range(1, 10000))
    fields = {k: deepcopy(v) for k,v in data.items() if k in Component.__dataclass_fields__ and k not in ('children','bounding_box')}
    fields.setdefault('name', 'Parça'); fields.setdefault('instance', 1); fields.setdefault('model_id', next(serial))
    node = Component(**fields)
    node.children = [component(c, serial) for c in data.get('children', [])]
    return node


def cad_document(data):
    doc = open_document(FIXTURE)
    return dict(file=str(FIXTURE.relative_to(ROOT)), container=type(doc).__name__, streams=[safe(s) for s in doc.streams], byte_size=FIXTURE.stat().st_size)


def cad_assembly(data):
    return read_assembly(open_document(FIXTURE)).to_dict()


def cad_mates(data):
    doc = open_document(FIXTURE); assembly = read_assembly(doc)
    return [m.to_dict() for m in collect_assembly_mates(assembly, default_sibling_resolver(FIXTURE), root_doc=doc)]


def bom_filter(data):
    assembly = Assembly('Laboratuvar', component(data['tree']))
    return [asdict(b) for b in assembly.bom(include_suppressed=data.get('include_suppressed', False))]


def bom_enrich(data):
    rows = deepcopy(data['bom'])
    # Only fixture siblings are resolvable; no user-supplied paths are opened.
    index = {f.name.lower(): str(f) for f in FIXTURE.parent.iterdir() if f.is_file()}
    enrich_bom(rows, index)
    return rows


def contextualize(data):
    overrides = {k: v for k, v in (data['operation'].get('pmts_context') or {}).items() if k != 'cls' and v is not None}
    overrides.update(data.get('overrides', {}))
    p.validate_context(overrides)
    return derive_context(data['operation'], **overrides).to_dict()


def expand(data):
    step = data['operation']
    if data.get('context') is not None:
        # An explicit complete StepContext remains a separate teaching input.
        p.validate_context(data['context'])
        ctx = StepContext(**data['context'])
        context_source = 'context (operation.pmts_context yerine açık bağlam)'
    else:
        # derive_context does not read the nested UI override object itself.
        # Its real caller calculate_operation unpacks that object into kwargs.
        overrides = {k: v for k, v in (step.get('pmts_context') or {}).items() if k != 'cls' and v is not None}
        p.validate_context(overrides)
        ctx = derive_context(step, **overrides)
        context_source = 'operation.pmts_context + BOP türetimi + varsayılanlar'
    result = expand_step(step, ctx, (step.get('pmts_context') or {}).get('cls') or step.get('cls'))
    # Expose the actual argument passed to expand_step, not a second calculation.
    return dict(result, context=ctx.to_dict(), lab_context_source=context_source)


def canonical(data):
    steps = deepcopy(data['steps'])
    WEBAPP._apply_canonical_mtm_times(
        steps, config=config_for(data), observations=data.get('observations', []),
        masses=data.get('masses', {}))
    return steps


def to_line(steps):
    """Lab adapter: explicit hypothetical placement, not the application's drag/drop."""
    return dict(id='lab-line', stations=[dict(id='s1', operators=[dict(id='o1', tasks=[
        dict(id=s['operation_id'], name=s.get('component'), sourceProjectId='lab', sourceOperationId=s['operation_id'],
             sourceStep=i+1, canonical_total_sec=s['standard_time_sec'], canonical_human_sec=s['unit_human_sec'],
             canonical_machine_sec=s['unit_machine_sec'], actions=[dict(pmts_status=a['status'], calculated_sec=a['seconds']) for a in s['canonical_actions']])
        for i,s in enumerate(steps)])]), dict(id='s2', operators=[dict(id='o2', tasks=[])])])


def pipeline(data):
    """One actual fixture through the real functions; retain every boundary output."""
    doc = open_document(FIXTURE)
    assembly = read_assembly(doc)
    mates = collect_assembly_mates(assembly, default_sibling_resolver(FIXTURE), root_doc=doc)
    document = dict(assembly=assembly.to_dict(), subassembly_mates=[m.to_dict() for m in mates])
    # Sequencer ids use the same pre-order enumeration as world components.
    counter = iter(range(10000))
    def ids(node):
        node['id'] = next(counter)
        for c in node.get('children', []): ids(c)
    ids(document['assembly']['tree'])
    document['assembly']['bom'] = bom_enrich({'bom': document['assembly']['bom']})
    masses = timing_evidence.mass_library([{'id':'lab-cad', 'data':document}])
    geometry = None
    if data.get('geometry', True):
        parts = compose_assembly_parts(assembly, default_sibling_resolver(FIXTURE))
        document['interference_analysis'] = InterferenceMatrix(document['assembly']['tree'], parts, [m for group in mates for m in group.mates], time_budget_sec=1).compute()
        probe = plan_sequence(document)
        document['disassembly_feasibility'] = check_sequence_feasibility(probe, document['assembly']['tree'], parts, precedence=document['interference_analysis'].get('precedence'), time_budget_sec=1)
        geometry = dict(resolved_mesh_count=len(parts), interference=document['interference_analysis'], feasibility=document['disassembly_feasibility'])
    raw_steps = plan_sequence(document)
    for i,s in enumerate(HELPERS['_flatten_steps'](raw_steps)):
        s['operation_id'] = f'cad-op-{i+1}'
        s['pmts_context'] = deepcopy(data.get('context', {}))
        patch = deepcopy(data.get('operation_overrides', {}).get(s['operation_id'], {}))
        if set(patch) - {'observed_duration_sec','pmts_context','action','activity','observed_machine_cycle_sec'}:
            raise ValueError('Bu CAD deneyinde yalnız süre, bağlam ve aktivite alanları değiştirilebilir.')
        s.update(patch)
    flat = deepcopy(HELPERS['_flatten_steps'](raw_steps))
    priced = canonical(dict(steps=raw_steps, config=data.get('config', {}), masses=masses))
    line = to_line(priced)
    try:
        scheduled = method_balance.balance_line(line, {'taktMode':'manual','manualTakt':data.get('takt',30)})
    except ValueError as exc:
        scheduled = dict(blocked=True, reason=str(exc), note='Bilgi gerekli satırlar tamamlanmadan dengeleme açılmaz.')
    return dict(assembly=document['assembly'], mates=document['subassembly_mates'], geometry=geometry, bop=raw_steps,
                flattened=flat, priced=priced, method_line=line, balance=scheduled,
                lab_boundary='Geometri yalnız örnek klasörde çözülen mesh’leri ve 1 saniyelik analiz bütçesini kapsar; eksik/unchecked parçalar doğrulanmış sayılmaz. PMTS varsayımları ve iki istasyon yerleşimi eğitim girdisidir.')


def serializable_key(func):
    return f'{Path(inspect.getsourcefile(func)).relative_to(ROOT)}:{func.__code__.co_firstlineno}'

SOURCE_CACHE = {}
def source_for(code):
    key = f'{Path(code.co_filename).relative_to(ROOT)}:{code.co_firstlineno}'
    if key not in SOURCE_CACHE:
        try:
            lines, line = inspect.getsourcelines(code)
            SOURCE_CACHE[key] = dict(id=key, name=code.co_name, file=str(Path(code.co_filename).relative_to(ROOT)), line=line, code=''.join(lines))
        except (OSError, TypeError):
            SOURCE_CACHE[key] = dict(id=key, name=code.co_name, file=code.co_filename, line=code.co_firstlineno, code='Kaynak alınamadı.')
    return key


def safe(value, depth=0, limit=70):
    """Bounded *display* snapshots. The actual returned output is not truncated."""
    if value is None or isinstance(value, (str,int,float,bool)): return value if not isinstance(value,str) else value[:5000]
    if depth > 5: return {'_preview':type(value).__name__, '_note':'İz önizlemesi derinlik sınırı; tam sonuç ayrı sekmede.'}
    if isinstance(value, (list,tuple,set)):
        seq=list(value); out=[safe(v,depth+1,limit) for v in seq[:limit]]
        if len(seq)>limit: out.append({'_omitted':len(seq)-limit})
        return out
    if isinstance(value, dict):
        entries=list(value.items()); out={str(k):safe(v,depth+1,limit) for k,v in entries[:limit]}
        if len(entries)>limit: out['_omitted_keys']=len(entries)-limit
        return out
    if isinstance(value, Path): return str(value)
    if is_dataclass(value) and not isinstance(value, type): return safe({f.name:getattr(value,f.name) for f in fields(value)},depth+1,limit)
    if isinstance(value, bytes): return {'bytes':len(value)}
    if not isinstance(value,type) and hasattr(value,'to_dict'): return safe(value.to_dict(),depth+1,limit)
    return {'type':type(value).__name__}


class Trace:
    def __init__(self): self.calls=[]; self.frames={}; self.sources=set(); self.omitted=0; self.counts={}
    def __call__(self, frame, event, arg):
        if event not in ('call','return'): return
        code=frame.f_code; path=code.co_filename
        if not path.startswith(str(ROOT)) or ('/pipeline_lab/' in path and code.co_name not in ('pipeline','to_line')) or '/.venv/' in path: return
        # Leave mechanical conversions out of the main trace; full code remains visible.
        if code.co_name.startswith('<') or code.co_name in ('number','finite','normalized','fold','keyword_hit','to_dict','__init__','_number'): return
        fid=id(frame)
        if event=='call':
            priority = code.co_name in {'calculate_plan','calculate_operation','_apply_canonical_mtm_times','line_inputs','balance_line','balance','read_assembly','collect_assembly_mates','plan_sequence','_flatten_steps'}
            if (len(self.calls)>=500 and not priority) or self.counts.get(code,0)>=6 or len(self.calls)>=600: self.omitted+=1; return
            self.counts[code]=self.counts.get(code,0)+1
            parent=frame.f_back
            while parent is not None and id(parent) not in self.frames: parent=parent.f_back
            key=source_for(code); self.sources.add(key)
            arg_count = code.co_argcount + code.co_kwonlyargcount
            arg_count += bool(code.co_flags & inspect.CO_VARARGS) + bool(code.co_flags & inspect.CO_VARKEYWORDS)
            argnames=code.co_varnames[:arg_count]
            record=dict(id=len(self.calls), parent=self.frames.get(id(parent)), source=key, name=code.co_name,
                        input={k:safe(frame.f_locals[k]) for k in argnames if k in frame.f_locals and k!='self'}, start=time.perf_counter())
            self.frames[fid]=record['id']; self.calls.append(record)
        elif fid in self.frames:
            item=self.calls[self.frames.pop(fid)]
            item['output']=safe(arg); item['ms']=round((time.perf_counter()-item.pop('start'))*1000,3)
            # Mutating functions return None. Show their observable post-call inputs too.
            if arg is None: item['after']={k:safe(frame.f_locals.get(k)) for k in item['input']}


def run(name, data):
    from .lessons import LESSONS
    lesson=next((x for x in LESSONS if x['id']==name), None)
    if lesson is None: raise ValueError('Bilinmeyen deney')
    trace=Trace(); start=time.perf_counter(); old=sys.getprofile()
    try:
        sys.setprofile(trace)
        output=lesson['run'](deepcopy(data)); error=None
    except Exception as exc:
        output=None; error=dict(type=type(exc).__name__, message=str(exc))
    finally: sys.setprofile(old)
    for item in trace.calls:
        if 'start' in item: item['ms']=round((time.perf_counter()-item.pop('start'))*1000,3)
    return dict(lesson=name, input=data, output=output, error=error, calls=trace.calls,
                sources={k:SOURCE_CACHE[k] for k in trace.sources}, omitted_calls=trace.omitted,
                elapsed_ms=round((time.perf_counter()-start)*1000,2), executed_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'))


def manifest():
    from .lessons import LESSONS
    lessons=[]; sources={}
    for x in LESSONS:
        item={k:v for k,v in x.items() if k not in ('run','functions')}
        item['functions']=[]
        for func in x['functions']:
            key=source_for(func.__code__); item['functions'].append(key); sources[key]=SOURCE_CACHE[key]
        lessons.append(item)
    revision=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=ROOT,text=True).strip()
    digests={v['file']:hashlib.sha256((ROOT/v['file']).read_bytes()).hexdigest()[:12] for v in sources.values()}
    return dict(lessons=lessons,sources=sources,revision=revision,source_hashes=digests, generated_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'))

# Geometry laboratories: synthetic solids, real parser/sequencing functions.
from anvex_parser import extract_mesh, compose_assembly_parts, InterferenceMatrix
from anvex_parser.assembly_mesh import PartMesh
from anvex_parser.mesh import Mesh
from anvex_sequencing.disassembly import check_sequence_feasibility


def mesh_preview(data):
    mesh=extract_mesh(open_document(FIXTURE.parent/'Rulo_Mili.SLDPRT'))
    return dict(file='Rulo_Mili.SLDPRT',triangles=len(mesh.triangles),bounds_mm=mesh.bounds_mm,
                volume_m3=mesh.volume_m3,triangle_sample=mesh.triangles[:4],
                note='Örnek üçgenler metre cinsinden. bounds_mm milimetredir; hacim kapalı mesh varsayımına bağlıdır.')


def geometry_scene(data):
    offset=p.number(data.get('offset_mm',8),'offset_mm',0,200)/1000
    def cube(cx):
        h=.005
        vertices=[(cx+x*h,y*h,z*h) for z in (-1,1) for y in (-1,1) for x in (-1,1)]
        faces=[(0,2,3),(0,3,1),(4,5,7),(4,7,6),(0,1,5),(0,5,4),(2,6,7),(2,7,3),(0,4,6),(0,6,2),(1,3,7),(1,7,5)]
        return [tuple(vertices[i] for i in tri) for tri in faces]
    nodes=[dict(id=1,name='BlockA',instance=1,children=[]),dict(id=2,name='BlockB',instance=1,children=[])]
    tree=dict(id=0,name='Demo',instance=1,children=nodes)
    parts=[PartMesh(n['id'],n['name'],n['name']+'.SLDPRT',1,None,Mesh(cube(x))) for n,x in zip(nodes,[0,offset])]
    return tree,parts


def geometry_run(data):
    tree,parts=geometry_scene(data)
    matrix=InterferenceMatrix(tree,parts,[],time_budget_sec=1).compute()
    return dict(scene=dict(edge_mm=10,offset_mm=data.get('offset_mm',8),names=['BlockA-1','BlockB-1']),analysis=matrix)


def feasibility_run(data):
    tree,parts=geometry_scene(data)
    steps=[dict(step=1,component='BlockA-1'),dict(step=2,component='BlockB-1',is_closure=True,insert_dir=[1,0,0])]
    return dict(scene=dict(edge_mm=10,offset_mm=data.get('offset_mm',8),names=['BlockA-1','BlockB-1']),
                analysis=check_sequence_feasibility(steps,tree,parts,time_budget_sec=1))
