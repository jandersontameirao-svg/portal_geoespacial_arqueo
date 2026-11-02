#!/usr/bin/env python3
"""Finite offline real-component UI checks; no App, remote API, model or authentication.

Reuses only CDP/namespace utility definitions from run_f1f2_visual_harness.py;
never executes its test suite. Every invocation creates an immutable attempt directory.
No installation, dotenv, node_modules writes, browser MCP or stage/prod navigation.
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
EVIDENCE = Path('/home/ubuntu/atena_integracao_paineis_atena_20261102_1954/visual-offline')
PORT, CDP_PORT = 4183, 9230
URL = f'http://127.0.0.1:{PORT}/panels-atena-visual-harness.html'
SOURCE_PATHS = [
    'client/src/components/GlobalMapPanels.tsx', 'client/src/components/MyProjectsPanel.tsx',
    'client/src/components/LayersTree.tsx', 'client/src/components/BaseLayersPanel.tsx',
    'client/src/components/AtenaPanel.tsx', 'client/src/components/AtenaChatWidget.tsx',
    'client/src/components/InfluenceAreasPanel.tsx', 'client/src/components/ProspectionGenerator.tsx',
    'client/src/components/OfficialBasesPanel.tsx', 'client/src/components/OfficialMapLayers.tsx',
    'client/src/lib/atenaChatCommands.ts', 'client/src/panelsAtenaVisualHarness.tsx',
    'client/panels-atena-visual-harness.html', 'vite.panels-atena-harness.config.ts',
    'infra/scripts/run_panels_atena_visual_harness.py',
]
spec = importlib.util.spec_from_file_location('existing_offline_cdp_utilities', ROOT / 'infra/scripts/run_f1f2_visual_harness.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.CDP_PORT = CDP_PORT
save, wait_js = base.save, base.wait_js

def hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCE_PATHS}

def click(cdp, selector):
    cdp.evaluate('document.querySelector(' + json.dumps(selector) + ')?.scrollIntoView({block:"center",inline:"nearest"})')
    base.click(cdp, selector)

def button(cdp, label):
    selector = 'button[data-harness-click-target="current"]'
    cdp.evaluate('''(() => {
      document.querySelectorAll('[data-harness-click-target]').forEach(e=>e.removeAttribute('data-harness-click-target'));
      const matches=[...document.querySelectorAll('button')].filter(e=>e.textContent.trim()===LABEL && e.getClientRects().length);
      if(matches.length!==1)throw Error('Expected one visible button '+LABEL+'; got '+matches.length);
      matches[0].dataset.harnessClickTarget='current';
    })()'''.replace('LABEL', json.dumps(label)))
    click(cdp, selector)

def fill(cdp, selector, value):
    cdp.evaluate('''(() => {
      const e=document.querySelector(SELECTOR);if(!e)throw Error('Missing input');
      const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,VALUE);
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    })()'''.replace('SELECTOR', json.dumps(selector)).replace('VALUE', json.dumps(value)))

def select(cdp, selector, value):
    cdp.evaluate('''(() => {const e=document.querySelector(SELECTOR);if(!e)throw Error('Missing select');e.value=VALUE;e.dispatchEvent(new Event('change',{bubbles:true}));})()'''.replace('SELECTOR', json.dumps(selector)).replace('VALUE', json.dumps(value)))

def snapshot(cdp):
    return cdp.evaluate('''({
      inspection:window.__PANELS_ATENA_HARNESS__, body:document.body.innerText,
      layout:{innerWidth,innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth},
      cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage),
      resources:performance.getEntriesByType('resource').map(e=>e.name),
      checkboxes:[...document.querySelectorAll('[role=checkbox]')].map(e=>({label:e.getAttribute('aria-label'),state:e.getAttribute('data-state')})),
      links:[...document.querySelectorAll('a')].map(e=>({text:e.textContent,href:e.getAttribute('href')}))
    })''')

def shot(cdp, attempt, name):
    image = base64.b64decode(cdp.call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False})['data'])
    (attempt / name).write_bytes(image)
    return {'file':name,'sha256':hashlib.sha256(image).hexdigest()}

def run_case(cdp, attempt, case):
    print('CASE_START='+case['id'],flush=True)
    cdp.call('Emulation.setDeviceMetricsOverride', {'width':case['width'],'height':case['height'],'deviceScaleFactor':1,'mobile':False})
    cdp.call('Page.navigate', {'url':URL+'?case='+case['id']})
    wait_js(cdp, 'Boolean(window.__PANELS_ATENA_HARNESS__) && Boolean(document.querySelector("[data-testid=panels-atena-real-harness]"))', timeout=35)
    assertions=[]; pictures=[]; checkpoints={}
    def check(label, value): assertions.append({'assertion':label,'passed':bool(value)})
    def checkpoint(name):
        data=snapshot(cdp);checkpoints[name]=data
        check(name+': no horizontal overflow',data['layout']['scrollWidth']<=case['width'] and data['layout']['bodyScrollWidth']<=case['width'])
        return data
    if case['id'].startswith('map'):
        click(cdp,'[data-testid=map-panel-toggle-projects]')
        wait_js(cdp,'Boolean(document.querySelector("input[aria-label=\\\"Buscar projetos autorizados\\\"]"))')
        wait_js(cdp,'document.body.innerText.includes("Projeto Sintético Alfa")')
        checkpoint('projects-open')
        fill(cdp,'input[aria-label="Buscar projetos autorizados"]','QA-ALFA')
        wait_js(cdp,'!document.querySelector("[data-testid=map-panel-drawer]").innerText.includes("Projeto Sintético Beta")')
        check('project search filters synthetic Beta',True)
        state=checkpoint('search')
        check('workspace href preserves real map tab',any(link['href']=='/projects/4242?tab=map' for link in state['links']))
        click(cdp,'[aria-label="Mostrar projeto Projeto Sintético Alfa"]')
        wait_js(cdp,'document.querySelector("[aria-label=\\\"Mostrar projeto Projeto Sintético Alfa\\\"]").getAttribute("data-state")==="unchecked"')
        check('project selection callback updates real checkbox',True)
        click(cdp,'[aria-label="Mostrar projeto Projeto Sintético Alfa"]')
        click(cdp,'[aria-label="Expandir camadas de Projeto Sintético Alfa"]')
        wait_js(cdp,'Boolean(document.querySelector("[role=tree]"))')
        check('real LayersTree group and leaf mounted',cdp.evaluate('document.querySelectorAll("[role=treeitem]").length===2'))
        click(cdp,'[aria-label="Mostrar Grupo sintético somente para mim"]')
        wait_js(cdp,'document.body.innerText.includes("oculta pela hierarquia")')
        state=checkpoint('hierarchy-off')
        check('personal group visibility mutation goes only to memory link',any(call['path']=='layers.setVisibility' and call['input']=={'id':8100,'visible':False} for call in state['inspection']['calls']))
        pictures.append(shot(cdp,attempt,case['id']+'-tree.png'))
        click(cdp,'[aria-label="Mostrar Grupo sintético somente para mim"]')
        wait_js(cdp,'!document.body.innerText.includes("oculta pela hierarquia")')
        click(cdp,'[aria-label="Mostrar Insumo sintético somente para mim"]')
        wait_js(cdp,'document.querySelector("[aria-label=\\\"Mostrar Insumo sintético somente para mim\\\"]").getAttribute("data-state")==="unchecked"')
        click(cdp,'[aria-label="Recolher Grupo sintético"]')
        wait_js(cdp,'document.querySelectorAll("[role=treeitem]").length===1')
        click(cdp,'[aria-label="Expandir Grupo sintético"]')
        check('collapse and expand group keeps leaf state',cdp.evaluate('document.querySelector("[aria-label=\\\"Mostrar Insumo sintético somente para mim\\\"]").getAttribute("data-state")==="unchecked"'))
        click(cdp,'[data-testid=map-panel-toggle-basemap]')
        wait_js(cdp,'Boolean(document.querySelector("#global-basemap-select"))')
        check('map-base menu uses existing catalog, no tiles',cdp.evaluate('document.querySelectorAll("img.leaflet-tile").length===0'))
        checkpoint('basemap-open');pictures.append(shot(cdp,attempt,case['id']+'-basemap.png'))
        click(cdp,'[data-testid=map-panel-toggle-layers]')
        wait_js(cdp,'document.body.innerText.includes("Catálogo carregado sem camadas ativas")')
        checkpoint('layers-open');pictures.append(shot(cdp,attempt,case['id']+'-layers.png'))
        click(cdp,'[data-testid=map-panel-toggle-projects]')
        check('returning to projects preserves search',cdp.evaluate('document.querySelector("input[aria-label=\\\"Buscar projetos autorizados\\\"]").value==="QA-ALFA"'))
        cdp.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape'})
        cdp.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Escape','code':'Escape'})
        wait_js(cdp,'document.querySelector("[data-testid=map-panel-drawer]").hidden')
        check('Escape closes drawer and restores trigger focus',cdp.evaluate('document.activeElement?.getAttribute("data-testid")==="map-panel-toggle-projects"'))
    elif 'unauthorized' in case['id']:
        wait_js(cdp,'document.body.innerText.includes("O contexto solicitado não está disponível")')
        state=checkpoint('unauthorized')
        check('URL candidate never becomes a project-scoped query',not any(isinstance(call['input'],dict) and call['input'].get('projectId')==999999 for call in state['inspection']['calls']))
        check('unknown context reveals no project identity', '999999' not in state['body'])
        pictures.append(shot(cdp,attempt,case['id']+'.png'))
    else:
        wait_js(cdp,'document.querySelector("select[aria-label=\\\"Projeto da Atena\\\"]")?.options.length===3')
        state=checkpoint('before-project-selection')
        check('no atena project calls before authorized selection',not any(call['path'].startswith('atena.') for call in state['inspection']['calls']))
        select(cdp,'select[aria-label="Projeto da Atena"]','4242')
        wait_js(cdp,'document.body.innerText.includes("Pedido e parâmetros") && document.body.innerText.includes("fonte remota bloqueada")')
        checkpoint('authorized-selected')
        fill(cdp,'textarea','buffer de 50 metros na camada de origem')
        button(cdp,'Interpretar pedido')
        wait_js(cdp,'document.body.innerText.includes("interpretação sintética determinística")')
        state=checkpoint('interpreted')
        check('interpretation does not run analysis',not any(call['path']=='atena.run' for call in state['inspection']['calls']))
        button(cdp,'2. Verificar plano')
        wait_js(cdp,'Boolean(document.querySelector("[data-testid=atena-review-plan]"))')
        state=checkpoint('plan-ready')
        check('plan does not run analysis',not any(call['path']=='atena.run' for call in state['inspection']['calls']))
        check('run button disabled before explicit checkbox',cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Confirmar e executar análise")?.disabled'))
        click(cdp,'[data-testid=atena-review-plan] [role=checkbox]')
        state=checkpoint('confirmed-checkbox-only')
        check('checkbox alone still does not run',not any(call['path']=='atena.run' for call in state['inspection']['calls']))
        pictures.append(shot(cdp,attempt,case['id']+'-review.png'))
        # Change one parameter after review; real UI must discard confirmation.
        fill(cdp,'section[aria-label="Pedido e plano de análise"] input[type=number]','60')
        wait_js(cdp,'!document.querySelector("[data-testid=atena-review-plan]")')
        check('editing parameters invalidates reviewed plan and confirmation',True)
        button(cdp,'2. Verificar plano')
        wait_js(cdp,'Boolean(document.querySelector("[data-testid=atena-review-plan]"))')
        check('new plan resets confirmation',cdp.evaluate('document.querySelector("[data-testid=atena-review-plan] [role=checkbox]").getAttribute("data-state")==="unchecked"'))
        click(cdp,'[data-testid=atena-review-plan] [role=checkbox]')
        button(cdp,'Confirmar e executar análise')
        wait_js(cdp,'document.body.innerText.includes("MOCK_EXECUTION_FAILED")')
        state=checkpoint('mock-run-failure')
        run_calls=[call for call in state['inspection']['calls'] if call['path']=='atena.run']
        check('exactly one simulated run after explicit button',len(run_calls)==1)
        check('run uses reviewed request snapshot',len(run_calls)==1 and run_calls[0]['input']['request']['distanceM']==60)
        check('real UI shows failed result, no fake success','MOCK_EXECUTION_FAILED' in state['body'] and 'Resultados retornados pelo servidor' not in state['body'])
        pictures.append(shot(cdp,attempt,case['id']+'-failure.png'))
    after=checkpoint('final')
    check('no cookies or browser storage',not after['cookies'] and not after['localStorageKeys'] and not after['sessionStorageKeys'])
    check('all loaded resources loopback',all(url.startswith(f'http://127.0.0.1:{PORT}/') for url in after['resources']))
    check('memory APIs never fall through to unknown calls',not any(call.get('error') for call in after['inspection']['calls']))
    result={'id':case['id'],'viewport':{'width':case['width'],'height':case['height']},'passed':all(item['passed'] for item in assertions),'assertions':assertions,'checkpoints':checkpoints,'screenshots':pictures}
    save(attempt/(case['id']+'.json'),result)
    print('CASE_'+('PASS' if result['passed'] else 'FAIL')+'='+case['id'],flush=True)
    return result

def inside(attempt):
    os.umask(0o022)
    report={'scope':'offline-real-components-in-memory-trpc','status':'running','cases':[],'authentication':'auth.me returns an explicitly synthetic user in MEMORY ONLY; no App, OAuth, token, cookie or auth provider; NOT real authentication and NOT an application bypass','limits':['No backend/DB/storage validation','No real authorization','No real GIS execution or model','No remote official source or basemap/tile request','Only isolated loopback Vite and local Chromium/CDP'],'sourcesSha256Before':hashes()}
    vite=chrome=cdp=None;handles=[]
    try:
        network={'namespace':os.readlink('/proc/self/ns/net'),'interfaces':json.loads(subprocess.check_output(['ip','-j','addr','show'])),'routesIPv4':json.loads(subprocess.check_output(['ip','-j','route','show'])),'routesIPv6':json.loads(subprocess.check_output(['ip','-j','-6','route','show']))}
        probe=socket.socket();probe.settimeout(1);network['externalDirectProbe']={'destination':'1.1.1.1:443','errno':probe.connect_ex(('1.1.1.1',443))};probe.close();report['network']=network
        if len(network['interfaces'])!=1 or network['interfaces'][0]['ifname']!='lo' or network['routesIPv4'] or network['routesIPv6'] or network['externalDirectProbe']['errno']!=errno.ENETUNREACH:raise RuntimeError('Network namespace is not loopback only')
        with tempfile.TemporaryDirectory(prefix='atena-panels-ui-') as temp:
            temp_path=Path(temp);env={**os.environ,'PANELS_ATENA_VITE_CACHE_DIR':str(temp_path/'vite-cache'),'XDG_CACHE_HOME':str(temp_path/'xdg-cache'),'XDG_CONFIG_HOME':str(temp_path/'xdg-config')}
            for name in ['vite.log','chromium.log']:handles.append((attempt/name).open('w'))
            vite=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.panels-atena-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=handles[0],stderr=subprocess.STDOUT,start_new_session=True)
            try:
                base.wait_http(URL,timeout=60)
                chrome=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1','--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={CDP_PORT}',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp_path/"chrome-profile"}','--window-size=1057,692','about:blank'],cwd=ROOT,env=env,stdout=handles[1],stderr=subprocess.STDOUT,start_new_session=True)
                base.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list')
                target=next(item for item in base.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if item.get('type')=='page')
                cdp=base.CDP(target['webSocketDebuggerUrl'])
                for domain in ['Page','Runtime','Network','Log']:cdp.call(domain+'.enable')
                report['network']['listeners']=subprocess.check_output(['ss','-lntp'],text=True)
                cases=[{'id':'map-desktop','width':1057,'height':692},{'id':'map-mobile','width':390,'height':844},{'id':'atena-desktop','width':1057,'height':692},{'id':'atena-mobile','width':390,'height':844},{'id':'atena-unauthorized','width':390,'height':844}]
                for case in cases:
                    try:report['cases'].append(run_case(cdp,attempt,case))
                    except Exception as exc:
                        failed={'id':case['id'],'passed':False,'error':str(exc),'assertions':[],'traceback':traceback.format_exc()}
                        try:failed['diagnostic']=snapshot(cdp);failed['screenshot']=shot(cdp,attempt,case['id']+'-failed.png')
                        except Exception as diag:failed['diagnosticError']=str(diag)
                        save(attempt/(case['id']+'-failed.json'),failed);report['cases'].append(failed);print('CASE_FAIL='+case['id']+': '+str(exc),flush=True)
                report['network']['observedRequestUrls']=sorted({event['params']['request']['url'] for event in cdp.events if event.get('method')=='Network.requestWillBeSent'})
                report['network']['externalObservedRequests']=[url for url in report['network']['observedRequestUrls'] if not url.startswith(f'http://127.0.0.1:{PORT}/') and not url.startswith('data:')]
                report['consoleExceptions']=[event for event in cdp.events if event.get('method')=='Runtime.exceptionThrown']
                save(attempt/'cdp-events.json',cdp.events)
                report['status']='passed' if all(case['passed'] for case in report['cases']) and not report['consoleExceptions'] and not report['network']['externalObservedRequests'] else 'failed'
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
        report['counts']={'casesExecuted':len(report['cases']),'casesPassed':sum(case['passed'] for case in report['cases']),'assertionsExecuted':sum(len(case['assertions']) for case in report['cases']),'assertionsPassed':sum(item['passed'] for case in report['cases'] for item in case['assertions'])}
        save(attempt/'report.json',report);print('PANELS_ATENA_VISUAL='+report['status'].upper(),flush=True);print('REPORT_DIR='+str(attempt),flush=True)
    return 0 if report['status']=='passed' else 1

def main():
    if len(sys.argv)==3 and sys.argv[1]=='--inside-offline-namespace':return inside(Path(sys.argv[2]))
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    attempt=EVIDENCE/(dt.datetime.now(dt.timezone.utc).strftime('attempt-%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));attempt.mkdir()
    clean={'HOME':'/tmp','PATH':str(Path(shutil.which('node')).resolve().parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8','NO_PROXY':'*','no_proxy':'*'}
    command=['sudo','-n','unshare','--net','/bin/sh','-ec','ip link set lo up; exec /usr/bin/env -i "$@"','panels-atena-offline',*[f'{key}={value}' for key,value in clean.items()],sys.executable,str(Path(__file__).resolve()),'--inside-offline-namespace',str(attempt)]
    save(attempt/'launch.json',{'command':command,'cleanEnvironmentKeys':list(clean),'finiteTimeoutSeconds':300,'parentNetworkNamespace':os.readlink('/proc/self/ns/net')})
    print('PANELS_ATENA_OFFLINE_ATTEMPT='+str(attempt),flush=True)
    with (attempt/'runner.log').open('w') as log:
        try:exit_code=subprocess.run(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,timeout=300).returncode
        except subprocess.TimeoutExpired:exit_code=124;save(attempt/'timeout.json',{'error':'finite harness timeout','seconds':300})
    subprocess.run(['sudo','-n','chown','-R',f'{os.getuid()}:{os.getgid()}',str(attempt)],check=False)
    print((attempt/'runner.log').read_text(),end='',flush=True);save(attempt/'exit.json',{'exitCode':exit_code,'finishedUTC':dt.datetime.now(dt.timezone.utc).isoformat()});return exit_code
if __name__=='__main__':raise SystemExit(main())
