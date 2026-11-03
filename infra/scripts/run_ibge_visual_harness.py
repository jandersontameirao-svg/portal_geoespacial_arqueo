#!/usr/bin/env python3
"""Offline real-component UI checks. No install, app/backend, login or real geography.
Every invocation preserves a new visual-run-* directory, even on failure.
Reuses CDP utilities only; never invokes an older harness's test suite.
"""
from __future__ import annotations
import base64
import datetime as dt
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path('/home/ubuntu/atena_ibge_impl_20261102_2055/evidence')
PORT, CDP_PORT = 4184, 9231
URL = f'http://127.0.0.1:{PORT}/ibge-visual-harness.html'
SOURCE_PATHS = ['client/src/components/GlobalMapPanels.tsx','client/src/components/InstitutionalMapLayers.tsx','client/src/components/InstitutionalLayersPanel.tsx','client/src/components/IbgeSourceCard.tsx','client/src/lib/institutionalLayers.ts','client/src/ibgeVisualHarness.tsx','client/ibge-visual-harness.html','vite.ibge-harness.config.ts','infra/scripts/run_ibge_visual_harness.py']
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('existing_offline_cdp_utilities', ROOT/'infra/scripts/run_f1f2_visual_harness.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.CDP_PORT = CDP_PORT
save, wait_js = base.save, base.wait_js
class GuardedCDP(base.CDP):
    """Pause every browser request: only this exact loopback origin is authorized."""
    def __init__(self, url):
        super().__init__(url)
        self.blocked=[]
    def call(self, method, params=None):
        self.counter += 1
        wanted=self.counter
        self.send(json.dumps({'id':wanted,'method':method,'params':params or {}}))
        while True:
            message=json.loads(self.receive())
            if message.get('method')=='Fetch.requestPaused':
                self.events.append(message)
                request=message['params'];url=request['request']['url']
                allowed=url.startswith(f'http://127.0.0.1:{PORT}/')
                self.counter+=1
                if not allowed:self.blocked.append(url)
                self.send(json.dumps({'id':self.counter,'method':'Fetch.continueRequest' if allowed else 'Fetch.failRequest','params':{'requestId':request['requestId'],**({} if allowed else {'errorReason':'BlockedByClient'})}}))
                continue
            if message.get('id')==wanted:
                if 'error' in message:raise RuntimeError(f'{method}: {message["error"]}')
                return message.get('result',{})
            if 'method' in message:self.events.append(message)
def hashes():
    return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() if (ROOT/p).exists() else 'NOT_PRESENT' for p in SOURCE_PATHS}
def click(cdp, selector):
    cdp.evaluate('document.querySelector('+json.dumps(selector)+')?.scrollIntoView({block:"center",inline:"nearest"})')
    base.click(cdp,selector)
def button(cdp,label):
    cdp.evaluate('''(()=>{document.querySelectorAll('[data-harness-click]').forEach(e=>e.removeAttribute('data-harness-click'));const matches=[...document.querySelectorAll('button')].filter(e=>e.textContent.trim()===LABEL&&e.getClientRects().length);if(matches.length!==1)throw Error('Expected one button '+LABEL+' got '+matches.length);matches[0].dataset.harnessClick='true';})()'''.replace('LABEL',json.dumps(label)))
    click(cdp,'[data-harness-click=true]')
def snapshot(cdp):
    return cdp.evaluate('''({inspection:window.__IBGE_HARNESS__,body:document.body.innerText,layout:{innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth},cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage),resources:performance.getEntriesByType('resource').map(e=>e.name),checkboxes:[...document.querySelectorAll('[role=checkbox]')].map(e=>({label:e.getAttribute('aria-label'),state:e.getAttribute('data-state')})),buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent,aria:e.getAttribute('aria-label'),disabled:e.disabled})),links:[...document.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.getAttribute('href')}))})''')
def shot(cdp,attempt,name):
    image=base64.b64decode(cdp.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['data'])
    (attempt/name).write_bytes(image)
    return {'file':name,'sha256':hashlib.sha256(image).hexdigest()}
def run_case(cdp,attempt,case):
    print('CASE_START='+case['id'],flush=True)
    cdp.call('Emulation.setDeviceMetricsOverride',{'width':case['width'],'height':case['height'],'deviceScaleFactor':1,'mobile':False})
    cdp.call('Page.navigate',{'url':URL+'?case='+case['id']})
    wait_js(cdp,'window.__IBGE_HARNESS__?.caseId === '+json.dumps(case['id'])+' && Boolean(document.querySelector("[data-testid=ibge-real-harness]"))',timeout=30)
    assertions=[];pictures=[];checkpoints={}
    def check(label,value):assertions.append({'assertion':label,'passed':bool(value)})
    def checkpoint(name):
        data=snapshot(cdp);checkpoints[name]=data
        check(name+': no horizontal overflow',data['layout']['scrollWidth']<=case['width'] and data['layout']['bodyScrollWidth']<=case['width'])
        return data
    if case['id'].startswith('map'):
        wait_js(cdp,'window.__IBGE_HARNESS__.calls.some(c=>c.path==="ogcCatalog.listPublished"&&c.response?.length===2)')
        check('production trigger says Mapa de fundo',cdp.evaluate('document.querySelector("[data-testid=map-panel-toggle-basemap]").innerText.includes("Mapa de fundo")'))
        check('production trigger says GeoServer',cdp.evaluate('document.querySelector("[data-testid=map-panel-toggle-layers]").innerText.includes("GeoServer")'))
        click(cdp,'[data-testid=map-panel-toggle-basemap]')
        wait_js(cdp,'Boolean(document.querySelector("#global-basemap-select"))')
        state=checkpoint('basemap-only')
        check('basemap options contain no IBGE and no thematic layer',cdp.evaluate('[...document.querySelector("#global-basemap-select").options].every(e=>!(/IBGE|FUNAI|INCRA|IPHAN/i).test(e.textContent))'))
        check('visible basemap panel contains no IBGE',cdp.evaluate('!document.querySelector("#global-basemap-select").parentElement.parentElement.innerText.includes("IBGE")'))
        pictures.append(shot(cdp,attempt,case['id']+'-basemap.png'))
        click(cdp,'[data-testid=map-panel-toggle-layers]')
        wait_js(cdp,'document.body.innerText.includes("Camadas institucionais") && document.body.innerText.includes("Bases existentes (cache)") && [...document.querySelectorAll("[role=checkbox]")].some(e=>(e.getAttribute("aria-label")||"").includes("C02_recortes"))')
        wait_js(cdp,'window.__IBGE_HARNESS__.calls.some(c=>c.path==="baseLayers.catalog"&&c.response?.length===4)')
        state=checkpoint('institutional-open')
        check('IBGE, reference 2010, WMS and WFS present',all(text in state['body'] for text in ['IBGE','2010','WMS','WFS']))
        check('source attribution visible','Fonte: IBGE' in state['body'])
        check('health/status visible',any(text in state['body'].lower() for text in ['healthy','saudável','saudavel','disponível','saúde']))
        check('legacy cache section separately labelled', 'Bases existentes (cache)' in state['body'])
        check('four legacy cache fixtures preserved',len(state['inspection']['cacheFixtures'])==4 and all(text in state['body'] for text in ['FUNAI','INCRA','IPHAN','OpenStreetMap']))
        pictures.append(shot(cdp,attempt,case['id']+'-institutional.png'))
        target=cdp.evaluate('''(()=>{const e=[...document.querySelectorAll('[role=checkbox]')].find(e=>(e.getAttribute('aria-label')||'').includes('C02_recortes')&&(e.getAttribute('aria-label')||'').includes('WMS'));if(!e)throw Error('IBGE WMS checkbox not found');e.dataset.harnessIbge='wms';return e.getAttribute('aria-label');})()''')
        ibge_selector='[role=checkbox][aria-label='+json.dumps(target)+']'
        click(cdp,ibge_selector)
        wait_js(cdp,'document.querySelector('+json.dumps(ibge_selector)+')?.getAttribute("data-state")==="checked"')
        enabled=snapshot(cdp)['inspection']['panelState']['enabled']
        check('real institutional provider holds selected IBGE id',9101 in enabled)
        click(cdp,'[data-testid=map-panel-toggle-basemap]')
        selected=cdp.evaluate('document.querySelector("#global-basemap-select").value')
        cdp.evaluate('''(()=>{const e=document.querySelector('#global-basemap-select');const next=[...e.options].find(o=>!o.disabled&&o.value!==e.value);if(!next)throw Error('No alternate basemap');e.value=next.value;e.dispatchEvent(new Event('change',{bubbles:true}));})()''')
        wait_js(cdp,'window.__IBGE_HARNESS__.panelState.basemapId !== '+json.dumps(selected))
        check('switching background preserves institutional state',snapshot(cdp)['inspection']['panelState']['enabled']==enabled)
        click(cdp,'[data-testid=map-panel-toggle-layers]')
        check('IBGE checkbox survives basemap switch',cdp.evaluate('document.querySelector('+json.dumps(ibge_selector)+')?.getAttribute("data-state")==="checked"'))
        click(cdp,'[aria-label="Fechar painel do mapa"]')
        wait_js(cdp,'document.querySelector("[data-testid=map-panel-drawer]").hidden')
        click(cdp,'[data-testid=map-panel-toggle-layers]')
        wait_js(cdp,'document.querySelector("[data-testid=map-panel-drawer]").hidden===false')
        check('IBGE checkbox survives close/reopen',cdp.evaluate('document.querySelector('+json.dumps(ibge_selector)+')?.getAttribute("data-state")==="checked"'))
        pictures.append(shot(cdp,attempt,case['id']+'-selection-preserved.png'))
        cdp.evaluate('''[...document.querySelectorAll('h3')].find(e=>e.textContent.includes('Bases existentes (cache)'))?.scrollIntoView({block:'start'})''')
        pictures.append(shot(cdp,attempt,case['id']+'-legacy-caches.png'))
        time.sleep(.4)
        state=checkpoint('reopened')
        check('opening/closing/switching makes no WFS query or registration',not any(c['path'] in ['ogcCatalog.queryIbgeViewport','ogcCatalog.registerIbge','ogcCatalog.importWfsToProject'] for c in state['inspection']['calls']))
        check('no overlay/map/tile/geography mounted',cdp.evaluate('document.querySelectorAll(".leaflet-container,.leaflet-tile,canvas,img").length===0'))
    else:
        wait_js(cdp,'window.__IBGE_HARNESS__.calls.some(c=>c.path==="ogcCatalog.listPublished"&&Array.isArray(c.response))')
        state=checkpoint('empty-catalog')
        check('empty catalog is explicit fixture',state['inspection']['published']==[] and 'Cadastro remoto pendente' in state['body'])
        check('opening card does not register automatically',not any(c['path']=='ogcCatalog.registerIbge' for c in state['inspection']['calls']))
        pictures.append(shot(cdp,attempt,case['id']+'-empty.png'))
        if 'reader' in case['id']:
            check('reader cannot see register button',not any('Cadastrar IBGE remoto' in b['text'] for b in state['buttons']))
            check('reader cannot see administration link',not any(link['href']=='/admin/ogc-catalog' for link in state['links']))
            check('reader is informed of administrator restriction','Somente um administrador' in state['body'])
        else:
            check('synthetic admin has management link',any(link['href']=='/admin/ogc-catalog' for link in state['links']))
            button(cdp,'Cadastrar IBGE remoto')
            wait_js(cdp,'document.body.innerText.includes("WMS e WFS cadastrados")')
            state=checkpoint('registered-mock')
            calls=state['inspection']['calls'];register=[c for c in calls if c['path']=='ogcCatalog.registerIbge']
            check('one explicit register mutation',len(register)==1 and register[0]['type']=='mutation')
            check('mock mutation returns exactly two services',len(register)==1 and len(register[0]['response']['records'])==2 and {r['serviceType'] for r in register[0]['response']['records']}=={'wms','wfs'})
            check('published catalog refetched from empty to two',len([c for c in calls if c['path']=='ogcCatalog.listPublished'])>=2 and len(state['inspection']['published'])==2)
            check('register button disappears once registered',not any('Cadastrar IBGE remoto' in b['text'] for b in state['buttons']))
            check('transport identified as MOCK','MOCK' in state['inspection']['transport'] and 'MOCK' in state['body'])
            pictures.append(shot(cdp,attempt,case['id']+'-registered.png'))
    after=checkpoint('final')
    check('no cookies or persistent browser storage',not after['cookies'] and not after['localStorageKeys'] and not after['sessionStorageKeys'])
    check('resources restricted to exact loopback origin',all(url.startswith(f'http://127.0.0.1:{PORT}/') for url in after['resources']))
    check('unknown APIs fail, no unknown path observed',not any(c.get('error') for c in after['inspection']['calls']))
    result={'id':case['id'],'viewport':case,'passed':all(a['passed'] for a in assertions),'assertions':assertions,'checkpoints':checkpoints,'screenshots':pictures}
    save(attempt/(case['id']+'.json'),result)
    print('CASE_'+('PASS' if result['passed'] else 'FAIL')+'='+case['id'],flush=True)
    return result

def inside(attempt):
    report={'scope':'IBGE offline real components, synthetic MemoryTRPCLink','status':'running','cases':[],'authentication':'Synthetic admin/viewer fixture only; NOT actual login or actual authorization','limits':['No backend/DB persistence validation','No real authentication/OAuth or permission enforcement','No mounted real map, tiles, WFS response or image response','No geography, downloads or public replacement','Absence assertions bounded to UI workflow plus 0.4 seconds'],'sourcesSha256Before':hashes()}
    vite=chrome=cdp=None;handles=[]
    try:
        network={'namespace':os.readlink('/proc/self/ns/net'),'interfaces':json.loads(subprocess.check_output(['ip','-j','addr','show'])),'routesIPv4':json.loads(subprocess.check_output(['ip','-j','route','show'])),'routesIPv6':json.loads(subprocess.check_output(['ip','-j','-6','route','show']))}
        probe=socket.socket();probe.settimeout(1);network['externalDirectProbe']={'destination':'1.1.1.1:443','errno':probe.connect_ex(('1.1.1.1',443))};probe.close();report['network']=network
        if len(network['interfaces'])!=1 or network['interfaces'][0]['ifname']!='lo' or network['routesIPv4'] or network['routesIPv6'] or network['externalDirectProbe']['errno']!=errno.ENETUNREACH:raise RuntimeError('Namespace is not loopback-only')
        with tempfile.TemporaryDirectory(prefix='atena-ibge-ui-') as temp:
            temp_path=Path(temp);env={**os.environ,'IBGE_VITE_CACHE_DIR':str(temp_path/'vite-cache'),'XDG_CACHE_HOME':str(temp_path/'xdg-cache'),'XDG_CONFIG_HOME':str(temp_path/'xdg-config')}
            for name in ['vite.log','chromium.log']:handles.append((attempt/name).open('w'))
            vite=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.ibge-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=handles[0],stderr=subprocess.STDOUT,start_new_session=True)
            try:
                base.wait_http(URL,timeout=45)
                chrome=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1','--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={CDP_PORT}',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp_path/"chrome-profile"}','--window-size=1057,692','about:blank'],cwd=ROOT,env=env,stdout=handles[1],stderr=subprocess.STDOUT,start_new_session=True)
                base.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list')
                target=next(item for item in base.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if item.get('type')=='page')
                cdp=GuardedCDP(target['webSocketDebuggerUrl'])
                for domain in ['Page','Runtime','Network','Log']:cdp.call(domain+'.enable')
                cdp.call('Fetch.enable',{'patterns':[{'urlPattern':'*'}]})
                report['network']['listeners']=subprocess.check_output(['ss','-lntp'],text=True)
                report['network']['browserGuard']='CDP Fetch request pause + exact loopback allowlist, DNS resolver rules, network namespace no routes'
                cases=[{'id':'map-desktop','width':1057,'height':692},{'id':'map-mobile','width':375,'height':812},{'id':'card-admin-desktop','width':1057,'height':692},{'id':'card-admin-mobile','width':375,'height':812},{'id':'card-reader-mobile','width':375,'height':812}]
                for case in cases:
                    try:report['cases'].append(run_case(cdp,attempt,case))
                    except Exception as exc:
                        failed={'id':case['id'],'passed':False,'error':str(exc),'assertions':[],'traceback':traceback.format_exc()}
                        try:failed['diagnostic']=snapshot(cdp);failed['screenshot']=shot(cdp,attempt,case['id']+'-failed.png')
                        except Exception as diag:failed['diagnosticError']=str(diag)
                        save(attempt/(case['id']+'-failed.json'),failed);report['cases'].append(failed);print('CASE_FAIL='+case['id']+': '+str(exc),flush=True)
                report['network']['observedRequestUrls']=sorted({e['params']['request']['url'] for e in cdp.events if e.get('method')=='Network.requestWillBeSent'})
                report['network']['externalObservedRequests']=[u for u in report['network']['observedRequestUrls'] if not u.startswith(f'http://127.0.0.1:{PORT}/')]
                report['network']['blockedRequests']=cdp.blocked
                report['consoleExceptions']=[e for e in cdp.events if e.get('method')=='Runtime.exceptionThrown']
                save(attempt/'cdp-events.json',cdp.events)
                report['status']='passed' if all(c['passed'] for c in report['cases']) and not report['consoleExceptions'] and not report['network']['externalObservedRequests'] else 'failed'
            finally:
                if cdp:cdp.close()
                base.terminate_owned(chrome);base.terminate_owned(vite)
                report['cleanup']={'chromiumStopped':chrome is None or chrome.poll() is not None,'viteStopped':vite is None or vite.poll() is not None,'temporaryDirectory':temp}
        report['cleanup']['temporaryDirectoryRemoved']=not Path(report['cleanup']['temporaryDirectory']).exists()
    except Exception as exc:
        report['status']='failed';report['error']=str(exc);report['traceback']=traceback.format_exc();print(report['traceback'],flush=True)
    finally:
        for handle in handles:handle.close()
        report['sourcesSha256After']=hashes();report['sourceFilesStableDuringRun']=report['sourcesSha256Before']==report['sourcesSha256After']
        if not report['sourceFilesStableDuringRun']:report['status']='failed';report['sourceStabilityFailure']='Sources changed during run; evidence is diagnostic only, not a stable proof'
        report['counts']={'casesExecuted':len(report['cases']),'casesPassed':sum(c['passed'] for c in report['cases']),'assertionsExecuted':sum(len(c['assertions']) for c in report['cases']),'assertionsPassed':sum(a['passed'] for c in report['cases'] for a in c['assertions'])}
        save(attempt/'report.json',report);print('IBGE_VISUAL='+report['status'].upper(),flush=True);print('REPORT_DIR='+str(attempt),flush=True)
    return 0 if report['status']=='passed' else 1

def main():
    if len(sys.argv)==3 and sys.argv[1]=='--inside-offline-namespace':return inside(Path(sys.argv[2]))
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    attempt=EVIDENCE/(dt.datetime.now(dt.timezone.utc).strftime('visual-run-%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));attempt.mkdir()
    # Bounded current-task readiness poll; no daemon/schedule/addon and no production service.
    deadline=time.monotonic()+180
    while True:
        source=(ROOT/'client/src/components/GlobalMapPanels.tsx').read_text()
        ready='InstitutionalLayersPanel' in source and 'GeoServer' in source and 'Mapa de fundo' in source and (ROOT/'client/src/components/InstitutionalLayersPanel.tsx').exists()
        if ready:break
        if time.monotonic()>=deadline:
            save(attempt/'readiness-timeout.json',{'status':'blocked','reason':'Institutional GlobalMapPanels integration absent after bounded 180 seconds'});print('IBGE_HARNESS_READY=prepared; components timeout; '+str(attempt),flush=True);return 2
        print('IBGE_HARNESS_READY=prepared; waiting for institutional components',flush=True);time.sleep(5)
    print('IBGE_HARNESS_READY=components present; running offline',flush=True)
    clean={'HOME':'/tmp','PATH':str(Path(shutil.which('node')).resolve().parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8','NO_PROXY':'*','no_proxy':'*'}
    command=['sudo','-n','unshare','--net','/bin/sh','-ec','ip link set lo up; exec /usr/bin/env -i "$@"','ibge-offline',*[f'{k}={v}' for k,v in clean.items()],sys.executable,str(Path(__file__).resolve()),'--inside-offline-namespace',str(attempt)]
    save(attempt/'launch.json',{'command':command,'cleanEnvironmentKeys':list(clean),'finiteTimeoutSeconds':240,'parentNetworkNamespace':os.readlink('/proc/self/ns/net')})
    print('IBGE_OFFLINE_ATTEMPT='+str(attempt),flush=True)
    with (attempt/'runner.log').open('w') as log:
        try:exit_code=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=240).returncode
        except subprocess.TimeoutExpired:exit_code=124;save(attempt/'timeout.json',{'error':'finite harness timeout','seconds':240})
    subprocess.run(['sudo','-n','chown','-R',f'{os.getuid()}:{os.getgid()}',str(attempt)],check=False)
    print((attempt/'runner.log').read_text(),end='',flush=True);save(attempt/'exit.json',{'exitCode':exit_code,'finishedUTC':dt.datetime.now(dt.timezone.utc).isoformat()});return exit_code
if __name__=='__main__':raise SystemExit(main())
