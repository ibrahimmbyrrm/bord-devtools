"""Contract tests: lab results must stay tied to the production functions."""
from copy import deepcopy
import hashlib
import json
import sys
from pathlib import Path
import threading
import urllib.request
import urllib.error
import pytest

sys.path.insert(0,str(Path(__file__).parent))
from bord_devtools import runtime as r
from bord_devtools.lessons import LESSONS, OPS, ZERO
from bord_devtools.server import Handler, HTTPServer
from bord_devtools.asgi import app as dev_app
from fastapi.testclient import TestClient

CASES=[(l,i,d) for l in LESSONS for i,d in enumerate([l['input']]+[v['input'] for v in l['variants']])]

@pytest.mark.parametrize('lesson,index,data',CASES,ids=[f'{l["id"]}-{i}' for l,i,d in CASES])
def test_examples_run_and_json_serialize(lesson,index,data):
    before=deepcopy(data)
    result=r.run(lesson['id'],data)
    assert result['error'] is None,result['error']
    assert data==before
    json.dumps(result,allow_nan=False)
    assert len(result['calls'])<=600
    for c in result['calls']:
        assert c['parent'] is None or c['parent']<c['id']
        assert c['source'] in result['sources']
        assert 'start' not in c


def execute(id,index=0):
    lesson=next(l for l in LESSONS if l['id']==id)
    out=r.run(id,lesson['input'] if index==0 else lesson['variants'][index-1]['input'])
    assert not out['error'],out['error']
    return out['output']


def test_serial_parallel_and_missing_are_real():
    assert execute('plan')['standard_time_sec']==16
    assert execute('plan',1)['standard_time_sec']==10
    missing=execute('plan',2)
    assert missing['coverage_percent']==50 and not missing['complete']
    assert execute('plan')==r.p.calculate_plan(OPS,r.config_for({'config':ZERO}))


def test_flatten_handoff_and_root_ownership():
    flat=execute('flatten')
    assert [x['operation_id'] for x in flat]==['root','support','child']
    assert r.p.calculate_plan(flat,r.config_for({'config':ZERO}))['standard_time_sec']==12
    root=execute('canonical')[0]
    assert root['own_standard_time_sec']==6
    assert root['standard_time_sec']==12
    assert sum(a['seconds'] for a in root['canonical_actions'])==12


def test_single_ownership_of_document_cycle():
    root=execute('rowcycle')[0]
    assert root['standard_time_sec']==12
    assert root['canonical_actions'][1]['seconds']==0
    assert root['mtm_operations'][0]['timing_result']['scope']=='included_in_document_row'


def test_three_distinct_concurrency_models():
    assert execute('hands')['comparisons'][0]['elapsed_sec']==3
    assert execute('hands',1)['comparisons']==[]
    assert execute('overlap')['standard_time_sec']==16
    assert execute('overlap',1)['standard_time_sec']==10
    assert execute('allocation')['standard_time_sec']==5


def test_fixed_schedule_and_resource_gap():
    assert execute('schedule')['stations'][0]['calculated_sec']==10
    schedule=execute('resource-gap')
    assert schedule['feasible'] and schedule['bottleneck_sec']==12
    assert next(a for a in schedule['assignments'] if a['task_id']=='c')['start_sec']==0
    result=execute('balance')
    assert result['station_times']=={'s1':6,'s2':10}
    assert result['efficiency_percent']==pytest.approx(100*16/30)


def test_regressions_and_limits_are_visible():
    assert execute('bug-purchased')['classification']=='assembled'
    assert execute('bug-purchased',1)['classification']=='assembled'
    assert execute('bug-step')['classification']=='assembled'
    assert execute('bug-cycle')
    assert execute('bug-prepare')['status']=='needs_input'
    assert execute('gap-crank')['status']=='needs_input'
    assert execute('gap-crank',1)['status']=='verified'
    assert execute('system',2)['time_system']=='MTM1'


def test_geometry_filter_and_real_mesh_units():
    assert execute('mesh')['triangles']>0
    assert execute('mesh')['bounds_mm'][0]==226
    assert execute('geometry')['analysis']['stats']['detailed_tested']==1
    assert execute('geometry',1)['analysis']['stats']['aabb_eliminated']==1


def test_trace_contains_actual_arguments_returns_and_mutations():
    lesson=next(l for l in LESSONS if l['id']=='canonical')
    result=r.run('canonical',lesson['input'])
    call=next(c for c in result['calls'] if c['name']=='_apply_canonical_mtm_times')
    assert 'standard_time_sec' not in call['input']['steps'][0]
    assert call['after']['steps'][0]['standard_time_sec']==12
    assert result['sources'][call['source']]['file']=='anvex-webapp/app.py'


def test_cad_pipeline_reaches_timing_adapter_and_reports_gaps():
    lesson=next(l for l in LESSONS if l['id']=='pipeline');result=r.run('pipeline',lesson['input']);out=result['output']
    assert not result['error']
    assert out['geometry']['resolved_mesh_count']>0
    assert len(out['bop'])==len(out['priced'])>0
    assert out['balance']['blocked'] # missing timing input must remain visible
    names={c['name'] for c in result['calls']}
    assert {'calculate_plan','line_inputs','balance_line'}<=names
    for root,task in zip(out['priced'],out['method_line']['stations'][0]['operators'][0]['tasks']):
        assert root['standard_time_sec']==task['canonical_total_sec']
        assert root['operation_id']==task['sourceOperationId']


def test_lab_does_not_write_project_database():
    path=r.ROOT/'anvex-webapp/anvex.db'
    before=hashlib.sha256(path.read_bytes()).hexdigest()
    execute('pipeline');execute('canonical')
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before


def test_http_contract_rejects_cross_origin_and_keeps_math_real():
    server=HTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url=f'http://127.0.0.1:{server.server_port}/api/run'
    try:
        payload=json.dumps({'lesson':'plan','input':{'operations':OPS,'config':ZERO}}).encode()
        req=urllib.request.Request(url,data=payload,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as resp: assert json.load(resp)['output']['standard_time_sec']==16
        req=urllib.request.Request(url,data=payload,headers={'Content-Type':'application/json','Origin':'https://unrelated.example'})
        with pytest.raises(urllib.error.HTTPError) as error: urllib.request.urlopen(req)
        assert error.value.code==403
    finally: server.shutdown();server.server_close();thread.join()


def test_embedded_dev_routes_are_live_and_local_only():
    body={'lesson':'plan','input':{'operations':OPS,'config':ZERO}}
    local=TestClient(dev_app,client=('127.0.0.1',1234))
    assert local.get('/').status_code==200
    assert local.post('/api/run',json=body).json()['output']['standard_time_sec']==16
    assert local.post('/api/run',json=body,headers={'origin':'https://elsewhere.example'}).status_code==403
    remote=TestClient(dev_app,client=('198.51.100.10',1234))
    assert remote.get('/').status_code==404


def test_cad_completion_does_not_hide_capacity_overload():
    tight=execute('pipeline',1)['balance']
    relaxed=execute('pipeline',2)['balance']
    assert not tight.get('blocked') and not tight['feasible'] and tight['overloads']
    assert relaxed['feasible'] and not relaxed['overloads']


@pytest.mark.parametrize('field,prefix', [('part_reach_cm', 'R'), ('assembly_move_cm', 'M')])
@pytest.mark.parametrize('scale', [100, 1000])
def test_expansion_uses_edited_distances(field, prefix, scale):
    lesson = next(l for l in LESSONS if l['id'] == 'expand')
    data = deepcopy(lesson['input'])
    before = r.expand(data)
    data['operation']['pmts_context'][field] *= scale
    result = r.run('expand', data)
    assert result['error'] is None
    after = result['output']
    assert after['context'][field] == data['operation']['pmts_context'][field]
    assert after['total_sec'] > before['total_sec']
    old_motion = next(e for e in before['elements'] if e['code'].startswith(prefix) and e['code'][1].isdigit())
    new_motion = next(e for e in after['elements'] if e['code'].startswith(prefix) and e['code'][1].isdigit())
    assert new_motion['total_sec'] > old_motion['total_sec']
    context_call = next(c for c in result['calls'] if c['name'] == 'derive_context')
    assert context_call['input']['overrides'][field] == after['context'][field]
    assert context_call['output'][field] == after['context'][field]


def test_expansion_context_priority_and_validation():
    data = {'operation': {'action': 'yerleştir', 'pmts_context': {'part_reach_cm': 9000}},
            'context': {'part_reach_cm': 10, 'assembly_move_cm': 15}}
    assert r.expand(data)['context']['part_reach_cm'] == 10
    with pytest.raises(ValueError):
        r.expand({'operation': {'pmts_context': {'part_reach_cm': -1}}})
    with pytest.raises(ValueError):
        r.expand({'operation': {}, 'context': {'part_reach_cm': -1}})


def test_context_lesson_preserves_operation_overrides():
    assert r.contextualize({'operation': {'pmts_context': {'part_reach_cm': 75}}})['part_reach_cm'] == 75
    assert r.contextualize({'operation': {'pmts_context': {'part_reach_cm': 75}},
                           'overrides': {'part_reach_cm': 25}})['part_reach_cm'] == 25
