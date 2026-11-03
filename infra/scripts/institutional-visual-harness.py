#!/usr/bin/env python3
"""Finite synthetic institutional UI. Requires explicit UI freeze acknowledgement; no main build.
Reuses existing offline CDP/isolation pattern without modifying/running earlier test suites.
"""
from __future__ import annotations
import argparse,base64,datetime as dt,errno,hashlib,importlib.util,json,os,secrets,shutil,signal,socket,subprocess,sys,tempfile,time,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
EVIDENCE=Path('/home/ubuntu/atena_orgaos_remotos_20261102_2116/evidence')
PORT,CDP_PORT=4186,9233
URL=f'http://127.0.0.1:{PORT}/institutional-visual-harness.html'
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('institutional_existing_offline',ROOT/'infra/scripts/run_ibge_visual_harness.py')
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
u.PORT=PORT;u.base.CDP_PORT=CDP_PORT
save,wait_js,click,button,shot=u.save,u.wait_js,u.click,u.button,u.shot
SOURCES=['client/src/components/GlobalMapPanels.tsx','client/src/components/InstitutionalLayersPanel.tsx','client/src/components/InstitutionalMapLayers.tsx','client/src/components/InstitutionalSourcesCard.tsx','client/src/components/IbgeSourceCard.tsx','client/src/lib/institutionalLayers.ts','shared/institutionalOgc.ts','server/institutionalCatalogRouter.ts','client/src/institutional-visual-harness.tsx','client/institutional-visual-harness.html','vite.institutional-harness.config.ts','infra/scripts/institutional-visual-harness.py']
def hashes():return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() if (ROOT/p).exists() else 'NOT_PRESENT' for p in SOURCES}
def snapshot(d):
 return d.evaluate('''({inspection:window.__INSTITUTIONAL_HARNESS__,body:document.body.innerText,layout:{innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth},cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage),resources:performance.getEntriesByType('resource').map(e=>e.name),checkboxes:[...document.querySelectorAll('[role=checkbox]')].map(e=>({label:e.getAttribute('aria-label'),state:e.getAttribute('data-state'),disabled:e.getAttribute('data-disabled')!==null||e.disabled})),buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.trim(),disabled:e.disabled})),xss:window.__INSTITUTIONAL_XSS__||null})''')
def calls(s,path):return [c for c in s['inspection']['calls'] if c['path']==path]
def run_case(d,a,case):
 print('CASE_START='+case['id'],flush=True)
 d.call('Emulation.setDeviceMetricsOverride',{'width':case['width'],'height':case['height'],'deviceScaleFactor':1,'mobile':False})
 d.call('Page.navigate',{'url':URL+'?case='+case['id']})
 wait_js(d,'window.__INSTITUTIONAL_HARNESS__?.caseId==='+json.dumps(case['id'])+' && Boolean(document.querySelector("[data-testid=institutional-real-harness]"))',timeout=35)
 wait_js(d,'window.__INSTITUTIONAL_HARNESS__.calls.some(c=>c.path==="institutionalCatalog.listSources"&&(Array.isArray(c.response)||c.error))')
 assertions=[];pictures=[];points={}
 def check(label,value):assertions.append({'assertion':label,'passed':bool(value)})
 def snap(label):
  s=snapshot(d);points[label]=s
  check(label+': no horizontal overflow',s['layout']['scrollWidth']<=case['width'] and s['layout']['bodyScrollWidth']<=case['width'])
  return s
 def picture(name):pictures.append(shot(d,a,case['id']+'-'+name+'.png'))
 def group(pub):return '[data-testid=institutional-layers-panel] [data-publisher='+pub+']'
 def query_count(s):return len(calls(s,'institutionalCatalog.queryViewport'))+len(calls(s,'ogcCatalog.queryIbgeViewport'))
 if case['id'].startswith('card'):
  s=snap('card-open')
  check('card contains IPHAN FUNAI INCRA and preserved IBGE',all(x in s['body'] for x in ['IPHAN','FUNAI','INCRA','IBGE']))
  check('no registration when card opens',not calls(s,'institutionalCatalog.registerSource') and not calls(s,'ogcCatalog.registerIbge'))
  check('FUNAI blocker explicitly TLS',any(x['publisher']=='FUNAI' and x['status']=='blocked' and 'TLS' in (x['blocker'] or '') and not x['registeredTypes'] for x in s['inspection']['sources']))
  check('FUNAI register action absent or disabled',all(b['disabled'] for b in s['buttons'] if 'Cadastrar FUNAI' in b['text']))
  for source in s['inspection']['sources']:
   text=d.evaluate('document.querySelector("[data-testid=institutional-sources-card] [data-publisher='+source['publisher']+']").innerText')
   check(source['publisher']+' reflects registry state',('Origem validada' if source['status']=='validated' else 'Origem bloqueada') in text)
  picture('status-no-auto-register')
  for publisher in ['IPHAN','FUNAI','INCRA']:
   d.evaluate('(()=>{const e=document.querySelector("[data-testid=institutional-sources-card] [data-publisher='+publisher+']");window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-document.querySelector("header").getBoundingClientRect().height-8);})()')
   picture(publisher.lower()+'-card-status')
  if 'reader' in case['id']:
   check('viewer cannot register',not any(b['text'].startswith('Cadastrar ') for b in s['buttons']))
  else:
   source=next((x for x in s['inspection']['sources'] if x['status']=='validated'),None)
   if source:
    button(d,'Cadastrar '+source['publisher']+' remoto')
    wait_js(d,'window.__INSTITUTIONAL_HARNESS__.calls.some(c=>c.path==="institutionalCatalog.registerSource"&&c.response?.success)')
    wait_js(d,'window.__INSTITUTIONAL_HARNESS__.calls.filter(c=>c.path==="institutionalCatalog.listSources"&&c.response).length>=2')
    s=snap('explicit-register-mock');mut=calls(s,'institutionalCatalog.registerSource')
    check('one explicit synthetic registration',len(mut)==1 and mut[0]['type']=='mutation' and mut[0]['input']=={'publisher':source['publisher']} and mut[0]['response']['persisted'] is False)
    picture('explicit-mock-register')
   else:check('all unproven sources stay blocked without synthetic healthy state',not any(b['text'].startswith('Cadastrar ') for b in s['buttons']))
 elif case['id']=='catalog-error-mobile':
  click(d,'[data-testid=map-panel-toggle-layers]');wait_js(d,'document.body.innerText.includes("Erro no catálogo institucional")')
  s=snap('explicit-source-error');check('IBGE remains independent under source API error','IBGE' in s['body'] and any(x['label'].startswith('Habilitar consulta WFS CGEO:') and not x['disabled'] for x in s['checkboxes']));check('no source connected on error',all(not x['selected'] for x in s['inspection']['panelState']['layers'] if x['primary']['publisher']!='IBGE'));picture('catalog-error')
 else:
  check('three menus separately labelled',d.evaluate('[...document.querySelectorAll("[aria-label=\\"Seletores do mapa\\"] button")].map(e=>e.innerText.trim()).join("|")==="Projetos|Mapa de fundo|GeoServer"'))
  click(d,'[data-testid=map-panel-toggle-projects]');wait_js(d,'window.__INSTITUTIONAL_HARNESS__.calls.some(c=>c.path==="projects.list"&&c.response)');s=snap('projects');check('projects are not basemap or institutional catalog',d.evaluate('document.querySelector("#global-map-panel-heading").innerText==="Projetos"') and 'Projeto sintético' in s['body']);picture('projects')
  click(d,'[data-testid=map-panel-toggle-basemap]');wait_js(d,'Boolean(document.querySelector("#global-basemap-select"))');s=snap('basemap');check('basemap options exclude institutional publishers',d.evaluate('[...document.querySelector("#global-basemap-select").options].every(e=>!(/IBGE|FUNAI|INCRA|IPHAN/i).test(e.textContent))'));picture('basemap')
  click(d,'[data-testid=map-panel-toggle-layers]');wait_js(d,'document.body.innerText.includes("Bases existentes (cache)") && window.__INSTITUTIONAL_HARNESS__.calls.some(c=>c.path==="baseLayers.catalog"&&c.response?.length===4)')
  s=snap('institutional-open');check('all four institutional groups visible',all(x in s['body'] for x in ['IBGE','IPHAN','FUNAI','INCRA']));check('external publisher is not selectable',all(x['primary']['publisher']!='EXTERNAL_NOT_ALLOWED' for x in s['inspection']['panelState']['layers']) and 'external_not_allowed' not in s['body']);check('all institutional layers initially off',not s['inspection']['panelState']['enabled']);check('zero WFS without button',query_count(s)==0)
  check('four existing caches preserved separately',len(s['inspection']['cacheFixtures'])==4 and all(x in s['body'] for x in ['FUNAI — cache sintético','INCRA — cache sintético','IPHAN — cache sintético','OpenStreetMap — cache sintético']))
  check('FUNAI TLS not fake-connected',d.evaluate('(()=>{const e=document.querySelector('+json.dumps(group('FUNAI'))+');return e.innerText.includes("TLS")&&e.innerText.includes("Origem bloqueada")&&[...e.querySelectorAll("button")].every(b=>b.disabled)&&[...e.querySelectorAll("[role=checkbox]")].every(b=>b.disabled||b.hasAttribute("data-disabled"));})()'))
  picture('institutional-status')
  for pub in ['IPHAN','FUNAI','INCRA']:
   d.evaluate('document.querySelector('+json.dumps(group(pub))+').scrollIntoView({block:"start"})');picture(pub.lower()+'-status')
  check('no WMS tiles or automatic raster calls',d.evaluate('document.querySelectorAll(".leaflet-tile").length===0'))
  chosen=next((x for x in s['inspection']['panelState']['layers'] if x['selected'] and x['selected']['serviceType']=='wfs' and x['selected']['publisher']!='IBGE'),None)
  if not chosen:chosen=next(x for x in s['inspection']['panelState']['layers'] if x['selected'] and x['selected']['serviceType']=='wfs' and x['selected']['publisher']=='IBGE')
  variant=chosen['selected'];selector='[aria-label='+json.dumps('Habilitar consulta WFS '+variant['remoteLayer'])+']'
  click(d,selector);wait_js(d,'document.querySelector('+json.dumps(selector)+').getAttribute("data-state")==="checked"')
  s=snap('wfs-enabled-not-queried');check('WFS enabling alone sends no query',query_count(s)==0)
  click(d,'[data-testid=map-panel-toggle-basemap]')
  old=d.evaluate('document.querySelector("#global-basemap-select").value')
  d.evaluate('(()=>{const e=document.querySelector("#global-basemap-select");e.value=[...e.options].find(o=>!o.disabled&&o.value!==e.value).value;e.dispatchEvent(new Event("change",{bubbles:true}));})()')
  wait_js(d,'window.__INSTITUTIONAL_HARNESS__.panelState.basemapId!=='+json.dumps(old));check('basemap switch preserves institutional selection',variant['id'] in snapshot(d)['inspection']['panelState']['enabled'])
  click(d,'[data-testid=map-panel-toggle-layers]');click(d,'[aria-label="Fechar painel do mapa"]');click(d,'[data-testid=map-panel-toggle-layers]');check('selection survives close/reopen',d.evaluate('document.querySelector('+json.dumps(selector)+').getAttribute("data-state")==="checked"'));check('navigation still no WFS',query_count(snapshot(d))==0)
  # Activate the real button inside the selected real WFS article, never call provider/query handler directly.
  d.evaluate('(()=>{const e=document.querySelector('+json.dumps(selector)+').closest("article").querySelector("button:not([role=checkbox])");if(!e||e.disabled)throw Error("No enabled real query button");e.dataset.harnessQuery="true";})()')
  click(d,'[data-harness-query=true]');wait_js(d,'Object.values(window.__INSTITUTIONAL_HARNESS__.panelState.statuses).some(s=>s.state==="ready"&&s.featureCount===1)')
  s=snap('wfs-explicit-result');check('exactly one WFS after explicit real button',query_count(s)==1);q=(calls(s,'institutionalCatalog.queryViewport')+calls(s,'ogcCatalog.queryIbgeViewport'))[0];check('viewport query strictly bounded and targeted',q['input']['variantId']==variant['id'] and q['input']['limit']==50 and q['input']['bbox']['east']-q['input']['bbox']['west']<=2 and q['input']['bbox']['north']-q['input']['bbox']['south']<=2)
  check('source attribution and feature count real UI state',s['inspection']['panelState']['statuses'][str(variant['id'])]['state']=='ready');picture('explicit-wfs-result')
  click(d,'[aria-label="Fechar painel do mapa"]');d.evaluate('window.__INSTITUTIONAL_ACTIONS__.pan()');time.sleep(.3);check('moving map sends no automatic WFS',query_count(snapshot(d))==1)
  wait_js(d,'window.__INSTITUTIONAL_ACTIONS__.openPopup()');wait_js(d,'Boolean(document.querySelector(".leaflet-popup-content"))')
  popup=d.evaluate('(()=>{const e=document.querySelector(".leaflet-popup-content");const a=document.querySelector(".leaflet-control-attribution");return {text:e.innerText,html:e.innerHTML,active:e.querySelectorAll("img,script,iframe").length,attribution:a?.innerText,attributionActive:a?.querySelectorAll("img,script,iframe").length};})()')
  points['popup']=popup;check('popup attribution identifies selected institution',('Fonte: '+variant['publisher']) in popup['text']);check('popup hostile property escaped, no active elements',popup['active']==0 and '<img' in popup['text'] and '&lt;img' in popup['html']);check('Leaflet attribution hostile HTML escaped',popup['attributionActive']==0 and ('Fonte: '+variant['publisher']) in popup['attribution'] and '<img' in popup['attribution']);check('no injected script execution',not snapshot(d)['xss']);picture('popup-escaped-attribution')
  click(d,'[data-testid=map-panel-toggle-layers]');click(d,selector);wait_js(d,'!window.__INSTITUTIONAL_HARNESS__.panelState.enabled.includes('+str(variant['id'])+')');check('turning off clears rendered synthetic result',d.evaluate('document.querySelectorAll(".leaflet-overlay-pane path").length===0'))
  d.evaluate('[...document.querySelectorAll("h3")].find(e=>e.textContent.includes("Bases existentes (cache)"))?.scrollIntoView({block:"start"})');picture('legacy-cache-preserved')
 s=snap('final');check('no register except explicit card scenario',case['id'].startswith('card-admin') or not calls(s,'institutionalCatalog.registerSource'));check('no cookies/localStorage/sessionStorage',not s['cookies'] and not s['localStorageKeys'] and not s['sessionStorageKeys']);check('all resources exact HTTP loopback',all(x.startswith(f'http://127.0.0.1:{PORT}/') for x in s['resources']));check('no unexpected mock API errors',all(c.get('error')=='MOCK_LIST_SOURCES_FAILURE_EXPLICIT' and case['id']=='catalog-error-mobile' for c in s['inspection']['calls'] if c.get('error')));check('no external or geographic downloads',not any('/synthetic-never-request/' in x or 'never-synthetic-xss' in x or '/api/trpc' in x for x in s['resources']))
 result={'id':case['id'],'viewport':case,'passed':all(x['passed'] for x in assertions),'assertions':assertions,'checkpoints':points,'screenshots':pictures};save(a/(case['id']+'.json'),result);print('CASE_'+('PASS' if result['passed'] else 'FAIL')+'='+case['id'],flush=True);return result

def inside(a):
 report={'status':'running','scope':'HARNESS institutional synthetic UI; real components, explicit MemoryTRPCLink only','cases':[],'limits':['No backend/DB proof','No actual login, OAuth/session, or authorization proof','No original geography or remote availability proof','WMS never enabled; WFS synthetic response only after real button','Absence after navigation/pan bounded to UI sequence plus 0.3 seconds'],'sourcesSha256Before':hashes()}
 v=c=d=None;handles=[]
 try:
  n={'namespace':os.readlink('/proc/self/ns/net'),'interfaces':json.loads(subprocess.check_output(['ip','-j','addr','show'])),'routesIPv4':json.loads(subprocess.check_output(['ip','-j','route','show'])),'routesIPv6':json.loads(subprocess.check_output(['ip','-j','-6','route','show']))}
  probe=socket.socket();probe.settimeout(1);n['externalDirectProbeErrno']=probe.connect_ex(('1.1.1.1',443));probe.close();report['network']=n
  if len(n['interfaces'])!=1 or n['interfaces'][0]['ifname']!='lo' or n['routesIPv4'] or n['routesIPv6'] or n['externalDirectProbeErrno']!=errno.ENETUNREACH:raise RuntimeError('Not loopback-only namespace')
  mounts=subprocess.check_output(['findmnt','-J','-T',str((ROOT/'node_modules').resolve())],text=True);report['nodeModulesMount']=json.loads(mounts)
  if 'ro' not in report['nodeModulesMount']['filesystems'][0]['options'].split(','):raise RuntimeError('node_modules not mounted read-only')
  with tempfile.TemporaryDirectory(prefix='atena-institutional-ui-') as temp:
   env={**os.environ,'HOME':temp,'INSTITUTIONAL_VITE_CACHE_DIR':temp+'/vite-cache','XDG_CACHE_HOME':temp+'/cache','XDG_CONFIG_HOME':temp+'/config'}
   handles=[(a/'vite.log').open('w'),(a/'chromium.log').open('w')]
   try:
    v=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.institutional-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=handles[0],stderr=subprocess.STDOUT,start_new_session=True)
    u.base.wait_http(URL,timeout=45)
    c=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={CDP_PORT}',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp}/chrome','about:blank'],cwd=ROOT,env=env,stdout=handles[1],stderr=subprocess.STDOUT,start_new_session=True)
    u.base.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list');target=next(x for x in u.base.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if x.get('type')=='page');d=u.GuardedCDP(target['webSocketDebuggerUrl'])
    for domain in ['Page','Runtime','Network','Log']:d.call(domain+'.enable')
    d.call('Network.setCacheDisabled',{'cacheDisabled':True});d.call('Fetch.enable',{'patterns':[{'urlPattern':'*'}]})
    report['network']['listeners']=subprocess.check_output(['ss','-lntp'],text=True);report['network']['browserGuard']='CDP Fetch exact loopback allowlist + CSP self + DNS block + private network namespace no routes'
    cases=[{'id':name,'width':w,'height':h} for name,w,h in [('map-desktop',1057,692),('map-mobile',390,844),('card-admin-desktop',1057,692),('card-admin-mobile',390,844),('card-reader-mobile',390,844),('catalog-error-mobile',390,844)]]
    for case in cases:
     try:report['cases'].append(run_case(d,a,case))
     except Exception as exc:
      failed={'id':case['id'],'passed':False,'error':str(exc),'traceback':traceback.format_exc(),'assertions':[]}
      try:failed['diagnostic']=snapshot(d);failed['screenshot']=shot(d,a,case['id']+'-failed.png')
      except Exception as diag:failed['diagnosticError']=str(diag)
      save(a/(case['id']+'-failed.json'),failed);report['cases'].append(failed);print('CASE_FAIL='+case['id']+': '+str(exc),flush=True)
    report['network']['observedRequestUrls']=sorted({e['params']['request']['url'] for e in d.events if e.get('method')=='Network.requestWillBeSent'})
    report['network']['externalObservedRequests']=[x for x in report['network']['observedRequestUrls'] if not x.startswith(f'http://127.0.0.1:{PORT}/')]
    report['network']['blockedRequests']=d.blocked;report['consoleExceptions']=[e for e in d.events if e.get('method')=='Runtime.exceptionThrown'];report['consoleErrors']=[e for e in d.events if e.get('method')=='Runtime.consoleAPICalled' and e.get('params',{}).get('type')=='error'];save(a/'cdp-events.json',d.events)
    report['logErrors']=[e for e in d.events if e.get('method')=='Log.entryAdded' and e.get('params',{}).get('entry',{}).get('level')=='error']
    report['status']='passed' if all(x['passed'] for x in report['cases']) and not report['consoleExceptions'] and not report['consoleErrors'] and not report['logErrors'] and not report['network']['externalObservedRequests'] else 'failed'
   finally:
    if d:d.close()
    u.base.terminate_owned(c);u.base.terminate_owned(v)
    report['cleanup']={'chromiumStopped':c is None or c.poll() is not None,'viteStopped':v is None or v.poll() is not None,'temporaryDirectory':temp}
  report['cleanup']['temporaryDirectoryRemoved']=not Path(temp).exists()
 except Exception as exc:report.update({'status':'failed','error':str(exc),'traceback':traceback.format_exc()});print(report['traceback'],flush=True)
 finally:
  for h in handles:h.close()
  report['sourcesSha256After']=hashes();report['sourceFilesStableDuringRun']=report['sourcesSha256Before']==report['sourcesSha256After']
  if not report['sourceFilesStableDuringRun']:report['status']='failed';report['sourceStabilityFailure']='Files changed during run; diagnostic evidence only, rerun after composition freeze'
  report['counts']={'casesExecuted':len(report['cases']),'casesPassed':sum(c['passed'] for c in report['cases']),'assertionsExecuted':sum(len(c['assertions']) for c in report['cases']),'assertionsPassed':sum(x['passed'] for c in report['cases'] for x in c['assertions'])};save(a/'report.json',report);print('INSTITUTIONAL_VISUAL='+report['status'].upper(),flush=True);print('REPORT_DIR='+str(a),flush=True)
 return 0 if report['status']=='passed' else 1

def main():
 if len(sys.argv)==3 and sys.argv[1]=='--inside-offline-namespace':return inside(Path(sys.argv[2]))
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--ack-ui-freeze',required=True,help='Explicit UI freeze timestamp from main; metadata registry hashes still checked');args=parser.parse_args()
 EVIDENCE.mkdir(parents=True,exist_ok=True);a=EVIDENCE/(dt.datetime.now(dt.timezone.utc).strftime('visual-institutional-%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));a.mkdir()
 clean={'HOME':'/tmp','PATH':str(Path(shutil.which('node')).resolve().parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8','NO_PROXY':'*','no_proxy':'*'}
 deps=str((ROOT/'node_modules').resolve())
 script='mount --make-rprivate /; mount --bind "$1" "$1"; mount -o remount,bind,ro "$1"; shift; ip link set lo up; exec /usr/bin/env -i "$@"'
 cmd=['sudo','-n','unshare','--mount','--net','/bin/sh','-ec',script,'institutional-offline',deps,*[f'{k}={v}' for k,v in clean.items()],sys.executable,str(Path(__file__).resolve()),'--inside-offline-namespace',str(a)]
 save(a/'launch.json',{'command':cmd,'uiFreezeAcknowledged':args.ack_ui_freeze,'cleanEnvironmentKeys':list(clean),'finiteTimeoutSeconds':300,'parentNetworkNamespace':os.readlink('/proc/self/ns/net'),'sourcesSha256AtLaunch':hashes(),'noNodeModulesWrite':'private mount namespace remount read-only'})
 print('INSTITUTIONAL_OFFLINE_ATTEMPT='+str(a),flush=True)
 with (a/'runner.log').open('w') as log:
  p=subprocess.Popen(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=p.wait(timeout=300)
  except subprocess.TimeoutExpired:
   code=124;subprocess.run(['sudo','-n','kill','-TERM','--','-'+str(p.pid)],check=False);save(a/'timeout.json',{'error':'finite harness timeout','seconds':300,'evidencePreserved':True});p.wait(timeout=10)
 subprocess.run(['sudo','-n','chown','-R',f'{os.getuid()}:{os.getgid()}',str(a)],check=False)
 print((a/'runner.log').read_text(),end='',flush=True);save(a/'exit.json',{'exitCode':code,'finishedUTC':dt.datetime.now(dt.timezone.utc).isoformat()});return code
if __name__=='__main__':raise SystemExit(main())
