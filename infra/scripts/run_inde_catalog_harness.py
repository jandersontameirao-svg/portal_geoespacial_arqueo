#!/usr/bin/env python3
"""Finite offline visual evaluation of real INDE components (no App/server/OAuth).

Preparation is safe without running. Execution REQUIRES main's explicit frozen
confirmation: python3 infra/scripts/run_inde_catalog_harness.py --frozen-confirmed NAME
Installs nothing, imports only CDP/helpers from the old runner, never its cases.
Each invocation creates a unique visual-* directory, preserving every failed run.
"""
from __future__ import annotations
import argparse
import base64
import datetime as dt
import errno
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.parse import urlparse
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path('/home/ubuntu/atena_inde_catalogo_20261102_2243/evidence')
PORT, CDP_PORT = 4191, 9244
URL = f'http://127.0.0.1:{PORT}/inde-catalog-harness.html'
SOURCES = [
    'client/src/components/BasemapQuickSelector.tsx', 'client/src/components/GlobalMapPanels.tsx',
    'client/src/components/IndeCatalogLayers.tsx', 'client/src/components/IndeCatalogPanel.tsx',
    'client/src/components/InstitutionalMapLayers.tsx', 'client/src/components/InstitutionalLayersPanel.tsx',
    'client/src/components/InstitutionalGlobeOverlays.tsx', 'client/src/components/IndeGlobeLayers.tsx', 'client/src/lib/indeCatalogState.ts',
    'shared/indeCatalog.ts', 'shared/institutionalGlobeProjection.ts', 'server/indeCatalogRouter.ts',
    'server/indeCatalogService.ts', 'server/routers.ts',
    'client/inde-catalog-harness.html', 'client/src/indeCatalogHarness.tsx',
    'vite.inde-harness.config.ts', 'infra/scripts/run_inde_catalog_harness.py',
]
spec = importlib.util.spec_from_file_location('inde_cdp_reference', ROOT / 'infra/scripts/run_f1f2_visual_harness.py')
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)  # guarded __main__; no legacy cases are executed
reference.CDP_PORT = CDP_PORT  # inherited WebSocket handshake must use this harness origin


def save(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES}


class OfflineCDP(reference.CDP):
    """Every paused request is decided before navigating; only this Vite origin is allowed."""
    def __init__(self, url):
        super().__init__(url)
        self.blocked = []
        self.allowed = []

    def call(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        self.send(json.dumps({'id': request_id, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(self.receive())
            if message.get('method') == 'Fetch.requestPaused':
                p = message['params']
                url = p['request']['url']
                parsed = urlparse(url)
                allowed = (parsed.scheme in ('data', 'blob', 'about') or
                           parsed.scheme == 'http' and parsed.hostname == '127.0.0.1' and parsed.port == PORT)
                (self.allowed if allowed else self.blocked).append({'url': url, 'resourceType': p.get('resourceType'), 'method': p['request']['method']})
                self.counter += 1
                self.send(json.dumps({'id': self.counter, 'method': 'Fetch.continueRequest' if allowed else 'Fetch.failRequest',
                                      'params': {'requestId': p['requestId'], **({} if allowed else {'errorReason': 'BlockedByClient'})}}))
            if message.get('id') == request_id:
                if 'error' in message:
                    raise RuntimeError(f'{method}: {message["error"]}')
                return message.get('result', {})
            self.events.append(message)


def wait(cdp, expression, timeout=18):
    # Esperas testam existência/estado, não precisam serializar nós DOM/React.
    return reference.wait_js(cdp, f'Boolean({expression})', timeout)


def pump(cdp, seconds):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        cdp.evaluate('true')
        time.sleep(.06)


def click(cdp, selector):
    cdp.evaluate('document.querySelector(' + json.dumps(selector) + ')?.scrollIntoView({block:"nearest",inline:"nearest"})')
    return reference.click(cdp, selector)


def click_text(cdp, text):
    selector = cdp.evaluate('''(() => {const e=[...document.querySelectorAll('button,summary')].find(e=>e.textContent.trim()===TEXT);if(!e)throw Error('Missing text button '+TEXT);e.setAttribute('data-harness-click-target','yes');return '[data-harness-click-target="yes"]';})()'''.replace('TEXT', json.dumps(text)))
    click(cdp, selector)
    cdp.evaluate("document.querySelector('[data-harness-click-target]')?.removeAttribute('data-harness-click-target')")


def key(cdp, value):
    cdp.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': value, 'code': value})
    cdp.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': value, 'code': value})


def snapshot(cdp):
    return cdp.evaluate('''({inspection:window.__INDE_HARNESS__,body:document.body.innerText,
      cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage),
      overflow:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,innerHeight},
      images:[...document.querySelectorAll('.leaflet-image-layer')].map(e=>({complete:e.complete,naturalWidth:e.naturalWidth,naturalHeight:e.naturalHeight,opacity:getComputedStyle(e).opacity,srcScheme:e.src.split(',')[0],bounds:(()=>{let r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};})()})),
      resources:performance.getEntriesByType('resource').map(e=>e.name),
      alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText)})''')


def shot(cdp, attempt, name, canvas=False):
    filename = attempt / f'{name}.png'
    filename.write_bytes(base64.b64decode(cdp.call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False})['data']))
    if canvas:
        data = cdp.evaluate("document.querySelector('[data-testid=harness-map-host] canvas')?.toDataURL('image/png')")
        if data:
            (attempt / f'{name}-three-canvas.png').write_bytes(base64.b64decode(data.split(',')[1]))
    return str(filename)


def pixel_diff(before, after, crop=None):
    a, b = Image.open(before).convert('RGB'), Image.open(after).convert('RGB')
    if crop:
        a, b = a.crop(crop), b.crop(crop)
    diff = ImageChops.difference(a, b)
    values = list(diff.getdata())
    changed = sum(max(v) > 16 for v in values)
    return {'width':a.width,'height':a.height,'changedPixelsThreshold16':changed,'ratio':changed/len(values),'maxChannelDelta':max(max(v) for v in values)}


def open_catalog(cdp):
    if not cdp.evaluate("document.querySelector('[data-testid=map-panel-toggle-layers]')?.getAttribute('aria-expanded')==='true'"):
        click(cdp, '[data-testid=map-panel-toggle-layers]')
    wait(cdp,"document.querySelector('[data-testid=inde-org-orgA]')")


def open_org(cdp, org='orgA'):
    selector = f'[data-testid="inde-org-{org}"] > button'
    if cdp.evaluate('document.querySelector('+json.dumps(selector)+')?.getAttribute("aria-expanded")!=="true"'):
        click(cdp, selector)
    return selector


def layer_selector(number):
    return f'[data-testid="inde-layer-orgA:synthetic%3Alayer{number}"] [role="checkbox"]'


def close_panel(cdp):
    key(cdp, 'Escape')
    pump(cdp,.15)


def run_ui(cdp, attempt, label, width, height):
    result = {'id':label,'viewport':{'width':width,'height':height},'assertions':[],'screenshots':[],'errors':[]}
    def check(name, condition, detail=None):
        result['assertions'].append({'check':name,'passed':bool(condition),**({'detail':detail} if detail is not None else {})})
        save(attempt/f'{label}-progress.json',result)
        print(('PASS ' if condition else 'FAIL ')+label+' '+name,flush=True)
    def picture(name, canvas=False):
        path=shot(cdp,attempt,f'{label}-{name}',canvas);result['screenshots'].append(path);return path
    cdp.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':height,'deviceScaleFactor':1,'mobile':False})
    cdp.call('Page.navigate',{'url':URL+'?case='+label})
    wait(cdp,"window.__INDE_HARNESS__?.state?.identity==='9901' && document.querySelector('[data-testid=map-panel-toggle-basemap]') && window.__INDE_HARNESS__.map")
    pump(cdp,.35)
    if not ONLY_3D:
        initial=snapshot(cdp);save(attempt/f'{label}-initial.json',initial)
        check('No INDE organization/capability/image query before opening',not any(c['path'].startswith('indeCatalog.') for c in initial['inspection']['calls']))
        check('No session/cookie/storage persisted',initial['cookies']=='' and not initial['localStorageKeys'] and not initial['sessionStorageKeys'])
        check('One basemap trigger',cdp.evaluate("document.querySelectorAll('[data-testid=map-panel-toggle-basemap]').length===1"))
        initial_map=initial['inspection']['map']
        picture('initial-2d')
        click(cdp,'[data-testid=map-panel-toggle-basemap]')
        wait(cdp,"document.querySelectorAll('[data-testid^=basemap-option-]').length===5")
        pump(cdp,.4)
        check('Five mutually exclusive real options',cdp.evaluate("document.querySelectorAll('[data-testid^=basemap-option-]').length===5 && document.querySelectorAll('[data-testid^=basemap-option-][aria-pressed=true]').length===1"))
        check('Five accessible toggle buttons expose selected state',cdp.evaluate("[...document.querySelectorAll('[data-testid^=basemap-option-]')].every(e=>e.tagName==='BUTTON' && ['true','false'].includes(e.getAttribute('aria-pressed')))"),'Native buttons with aria-pressed; keyboard and exclusive selection are checked separately; no DOM relabeling')
        focus_before=cdp.evaluate('document.activeElement?.dataset.testid')
        key(cdp,'ArrowDown');focus_after=cdp.evaluate('document.activeElement?.dataset.testid')
        check('Arrow key moves option focus',focus_before!=focus_after and bool(focus_after and focus_after.startswith('basemap-option-')))
        picture('basemap-open')
        menu_box=cdp.evaluate("(() => {const r=document.querySelector('[data-testid=basemap-quick-selector]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()")
        cdp.call('Input.dispatchMouseEvent',{'type':'mouseWheel',**menu_box,'deltaX':0,'deltaY':600})
        pump(cdp,.15)
        check('Popover wheel scroll does not create body overflow',cdp.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'))
        pick=cdp.evaluate("[...document.querySelectorAll('[data-testid^=basemap-option-]')].find(e=>e.getAttribute('aria-pressed')==='false').dataset.testid")
        click(cdp,f'[data-testid="{pick}"]')
        wait(cdp,"!document.querySelector('[data-testid=basemap-quick-selector]')")
        check('Single click chooses and closes',cdp.evaluate('window.__INDE_HARNESS__.harness.basemapId')==pick.removeprefix('basemap-option-'))
        after_map=cdp.evaluate('window.__INDE_HARNESS__.map')
        check('Basemap preserves Leaflet center and zoom',initial_map['center']==after_map['center'] and initial_map['zoom']==after_map['zoom'])
        click(cdp,'[data-testid=map-panel-toggle-basemap]');wait(cdp,"document.querySelector('[data-testid=basemap-quick-selector]')")
        check('Only one choice stays active after reopen',cdp.evaluate("document.querySelectorAll('[data-testid^=basemap-option-][aria-pressed=true]').length===1"))
        key(cdp,'Escape');wait(cdp,"!document.querySelector('[data-testid=basemap-quick-selector]')")
        check('Escape closes basemap',True)
        click(cdp,'[data-testid=map-panel-toggle-basemap]');wait(cdp,"document.querySelector('[data-testid=basemap-quick-selector]')")
        cdp.call('Input.dispatchMouseEvent',{'type':'mousePressed','x':width-8,'y':height-100,'button':'left','clickCount':1});cdp.call('Input.dispatchMouseEvent',{'type':'mouseReleased','x':width-8,'y':height-100,'button':'left','clickCount':1})
        wait(cdp,"!document.querySelector('[data-testid=basemap-quick-selector]')")
        check('Outside click closes basemap',True)
        check('No body horizontal/vertical overflow',cdp.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'))
        open_catalog(cdp)
        wait(cdp,"window.__INDE_HARNESS__.calls.some(c=>c.path==='indeCatalog.organizations'&&c.response)")
        check('Opening GeoServer loads list only, no capabilities',not cdp.evaluate("window.__INDE_HARNESS__.calls.some(c=>c.path==='indeCatalog.layers'||c.path==='indeCatalog.mapImage')"))
        check('Organizations grouped by administrative level',cdp.evaluate("document.querySelectorAll('[aria-label^=\"Instituições —\"]').length===3"))
        check('GeoServer drawer and basemap selector separated',cdp.evaluate("!!document.querySelector('[data-testid=map-panel-drawer]') && !document.querySelector('[data-testid=basemap-quick-selector]')"))
        open_org(cdp,'HTTPblocked');pump(cdp,.2)
        check('HTTP blocked org visible without any capability request',not cdp.evaluate("window.__INDE_HARNESS__.calls.some(c=>c.input?.organizationId==='HTTPblocked')"))
        open_org(cdp,'orgA');wait(cdp,'document.querySelector('+json.dumps(layer_selector(1))+')')
        check('Only chosen organization fetched capabilities',cdp.evaluate("window.__INDE_HARNESS__.calls.filter(c=>c.path==='indeCatalog.layers').every(c=>c.input.organizationId==='orgA')"))
        check('Capabilities alone do not load map',not cdp.evaluate("window.__INDE_HARNESS__.calls.some(c=>c.path==='indeCatalog.mapImage')"))
        picture('catalog-capabilities')
        click(cdp,layer_selector(1));wait(cdp,"Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready')")
        ready=snapshot(cdp);save(attempt/f'{label}-2d-ready.json',ready)
        check('One checkbox loads one 3857 image',len([c for c in ready['inspection']['calls'] if c['path']=='indeCatalog.mapImage'])==1 and next(c for c in ready['inspection']['calls'] if c['path']=='indeCatalog.mapImage')['input']['crs']=='EPSG:3857')
        check('Real Leaflet ImageOverlay decoded, visible and ready',len(ready['images'])==1 and ready['images'][0]['complete'] and ready['images'][0]['naturalWidth']>0 and float(ready['images'][0]['opacity'])>0)
        close_panel(cdp);overlay=picture('2d-overlay');base=attempt/f'{label}-initial-2d.png'
        diff=pixel_diff(base,overlay,(0,150,width,height-45));result['pixelComparison2D']=diff
        check('2D screenshot contains changed map pixels',diff['changedPixelsThreshold16']>1000,diff)
        n=cdp.evaluate("window.__INDE_HARNESS__.calls.filter(c=>c.path==='indeCatalog.mapImage').length")
        cdp.evaluate('void window.__INDE_ACTIONS__.pan()')
        wait(cdp,"window.__INDE_HARNESS__.calls.filter(c=>c.path==='indeCatalog.mapImage').length>"+str(n))
        wait(cdp,"Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready')")
        maps=cdp.evaluate("window.__INDE_HARNESS__.calls.filter(c=>c.path==='indeCatalog.mapImage').map(c=>c.input)")
        check('Panning requests changed projected bbox',maps[-1]['bounds']!=maps[-2]['bounds'])
        open_catalog(cdp);open_org(cdp)
        click(cdp,layer_selector(1));wait(cdp,"window.__INDE_HARNESS__.state.selected.length===0 && document.querySelectorAll('.leaflet-image-layer').length===0")
        check('Turning off removes real image',True)
        cdp.evaluate('window.__INDE_ACTIONS__.delay(500)')
        click(cdp,layer_selector(1));wait(cdp,"window.__INDE_HARNESS__.state.selected.length===1")
        click(cdp,layer_selector(1));pump(cdp,.85)
        check('500ms stale response never reattaches image',cdp.evaluate("window.__INDE_HARNESS__.state.selected.length===0 && document.querySelectorAll('.leaflet-image-layer').length===0"))
        cdp.evaluate('window.__INDE_ACTIONS__.delay(35)')
        # Keep selected section growth from obscuring lower checkbox targets by scrolling each into view.
        for i in range(1,5):
            click(cdp,layer_selector(i));pump(cdp,.12)
        wait(cdp,"window.__INDE_HARNESS__.state.selected.length===4")
        check('Four-layer limit disables fifth',cdp.evaluate('document.querySelector('+json.dumps(layer_selector(5))+').disabled && window.__INDE_HARNESS__.state.selected.length===4'))
        picture('four-layer-limit')
        click(cdp,'button[aria-label="Desativar todas as camadas INDE"]');wait(cdp,"window.__INDE_HARNESS__.state.selected.length===0")
        open_org(cdp,'orgB');wait(cdp,"document.querySelector('[data-testid=\"inde-layer-orgB:synthetic%3Afailure\"] [role=checkbox]')")
        click(cdp,'[data-testid="inde-layer-orgB:synthetic%3Afailure"] [role=checkbox]')
        wait(cdp,"Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='error')")
        check('Failed endpoint is error, never false healthy/ready',cdp.evaluate("Object.values(window.__INDE_HARNESS__.state.statuses).every(s=>s.state==='error') && document.querySelectorAll('.leaflet-image-layer').length===0"))
        picture('image-failure')
        click(cdp,'button[aria-label="Desativar todas as camadas INDE"]')
        # The legacy section must remain reachable, collapsed initially, without auto-loading its WMS.
        check('Legacy IBGE/IPHAN hidden behind details by default',cdp.evaluate("[...document.querySelectorAll('[data-testid=institutional-layers-panel] > details')].some(d=>!d.open && d.innerText.includes('IBGE') && d.innerText.includes('IPHAN'))"))
        click_text(cdp,'Conectores cadastrados · IBGE, IPHAN, FUNAI e INCRA')
        check('Legacy IBGE and IPHAN accessible after explicit details',cdp.evaluate("!!document.querySelector('[data-publisher=IBGE] [role=checkbox]') && !!document.querySelector('[data-publisher=IPHAN] [role=checkbox]')"))
        picture('legacy-details')
        click_text(cdp,'Conectores cadastrados · IBGE, IPHAN, FUNAI e INCRA')
        click(cdp,layer_selector(1));wait(cdp,"Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready')")
        # Closing/reopening preserves provider selection, and mode switch reuses the same provider.
        close_panel(cdp);open_catalog(cdp)
        check('Drawer closure preserves selected INDE layer',cdp.evaluate("window.__INDE_HARNESS__.state.selected.length===1"))
        close_panel(cdp)
    else:
        open_catalog(cdp);open_org(cdp)
        wait(cdp,'document.querySelector('+json.dumps(layer_selector(1))+')')
        click(cdp,layer_selector(1))
        wait(cdp,"Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready')")
        close_panel(cdp)
    click(cdp,'[data-testid=harness-3d]')
    wait(cdp,"window.__INDE_HARNESS__.harness.ready && window.__INDE_HARNESS__.scene?.overlays.length===1 && Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready'&&s.viewMode==='3d')",35)
    pump(cdp,.7)
    scene_ready=snapshot(cdp);save(attempt/f'{label}-3d-ready.json',scene_ready)
    check('3D selection preserved and real SphereGeometry installed',scene_ready['inspection']['state']['selected'][0]['layerName']=='synthetic:layer1' and scene_ready['inspection']['scene']['overlays'][0]['type']=='SphereGeometry')
    check('Actual react-globe.gl WebGL renderer and nonempty base globe',scene_ready['inspection']['scene']['webgl'] and scene_ready['inspection']['scene']['globeRadius']>0 and cdp.evaluate("document.querySelector('[data-testid=harness-map-host] canvas').width>100"))
    check('3D PNG decoded at 512x256',scene_ready['inspection']['scene']['overlays'][0]['imageWidth']==512 and scene_ready['inspection']['scene']['overlays'][0]['imageHeight']==256)
    check('Lon/lat helpers match globe.getCoords and actual sphere matrix',all(a['helperError']<1e-7 and a['sphereMatrixError']<1e-7 and a['actualMeshMatrixError'] is not None and a['actualMeshMatrixError']<1e-7 for a in scene_ready['inspection']['anchoring']),scene_ready['inspection']['anchoring'])
    geo=scene_ready['inspection']['geographicPixels']
    check('Geographic Brasil mark visible magenta at projected lon/lat',bool(geo and geo[0]['rgba'] and geo[0]['rgba'][0]>geo[0]['rgba'][1]+35 and geo[0]['rgba'][2]>geo[0]['rgba'][1]+35),geo)
    overlay3d=picture('3d-overlay',True)
    before_points=scene_ready['inspection']['scene']['pointCount']
    before_nodes=scene_ready['inspection']['scene']['nonOverlayUuids']
    cdp.evaluate('void window.__INDE_ACTIONS__.lookAt(0,0)');pump(cdp,.4)
    greenwich=cdp.evaluate('window.__INDE_HARNESS__.geographicPixels')
    check('Geographic Greenwich mark visible yellow at projected lon/lat',bool(greenwich and greenwich[1]['rgba'] and greenwich[1]['rgba'][0]>greenwich[1]['rgba'][2]+35 and greenwich[1]['rgba'][1]>greenwich[1]['rgba'][2]+35),greenwich)
    picture('3d-greenwich',True)
    cdp.evaluate('void window.__INDE_ACTIONS__.lookAt(-15,-48)');pump(cdp,.4)
    open_catalog(cdp);click(cdp,'button[aria-label="Desativar todas as camadas INDE"]');wait(cdp,"window.__INDE_HARNESS__.scene.overlays.length===0")
    close_panel(cdp);pump(cdp,.5)
    base3d=picture('3d-base',True)
    canvas_base=attempt/f'{label}-3d-base-three-canvas.png';canvas_overlay=attempt/f'{label}-3d-overlay-three-canvas.png'
    diff3=pixel_diff(canvas_base,canvas_overlay);result['pixelComparison3D']=diff3
    check('Real Three canvas changes with overlay (not empty fake globe)',diff3['changedPixelsThreshold16']>500,diff3)
    # Nonuniform base scene proof: actual captured canvas contains many RGB values.
    im=Image.open(canvas_base).convert('RGB');colors=len(im.getcolors(maxcolors=1000000) or [])
    check('Base globe is visually nonempty synthetic equirectangular texture',colors>50,{'uniqueColors':colors})
    check('Disable disposes geometry material and texture',len(scene_ready['inspection']['disposals'])<len(cdp.evaluate('window.__INDE_HARNESS__.disposals')) and {d['kind'] for d in cdp.evaluate('window.__INDE_HARNESS__.disposals')}>={'geometry','material','texture'})
    for cycle in range(3):
        open_catalog(cdp);open_org(cdp);click(cdp,layer_selector(1))
        wait(cdp,"window.__INDE_HARNESS__.scene.overlays.length===1 && Object.values(window.__INDE_HARNESS__.state.statuses).some(s=>s.state==='ready')")
        cdp.evaluate('window.__INDE_HARNESS__.scene') # attach only passive dispose listeners
        click(cdp,'button[aria-label="Desativar todas as camadas INDE"]');wait(cdp,"window.__INDE_HARNESS__.scene.overlays.length===0")
    check('Repeated 3D toggles have no overlay sphere leak',cdp.evaluate("window.__INDE_HARNESS__.scene.overlays.length===0 && window.__INDE_HARNESS__.disposals.filter(d=>d.kind==='geometry').length>=4"))
    check('3D project marker input count preserved',cdp.evaluate('window.__INDE_HARNESS__.scene.pointCount')==before_points==3)
    check('Existing Three scene objects preserved across overlay toggles',before_nodes==cdp.evaluate('window.__INDE_HARNESS__.scene.nonOverlayUuids'))
    close_panel(cdp)
    # Choosing a 2D basemap from 3D must not change globe texture/mode or invoke callback.
    click(cdp,'[data-testid=map-panel-toggle-basemap]');wait(cdp,"document.querySelector('[data-testid=basemap-quick-selector]')")
    before_requests=cdp.evaluate('window.__INDE_HARNESS__.harness.requests2D')
    other=cdp.evaluate("[...document.querySelectorAll('[data-testid^=basemap-option-]')].find(e=>e.getAttribute('aria-pressed')==='false').dataset.testid")
    click(cdp,f'[data-testid="{other}"]');pump(cdp,.15)
    check('3D basemap choice does not invoke request2D or modify mode',cdp.evaluate('window.__INDE_HARNESS__.harness.mode')=='3d' and cdp.evaluate('window.__INDE_HARNESS__.harness.requests2D')==before_requests)
    click(cdp,'[data-testid=map-panel-toggle-basemap]');wait(cdp,"document.querySelector('[data-testid=basemap-quick-selector]')")
    click_text(cdp,'Abrir mapa 2D com o fundo selecionado');wait(cdp,"window.__INDE_HARNESS__.harness.mode==='2d'")
    check('Only explicit Open 2D invokes request2D',cdp.evaluate('window.__INDE_HARNESS__.harness.requests2D')==before_requests+1)
    final=snapshot(cdp);save(attempt/f'{label}-final.json',final)
    check('Unknown API paths fail, none silently stubbed',not any('MOCK_UNKNOWN_PATH' in c.get('error','') for c in final['inspection']['calls']))
    check('No OAuth HTTP tRPC server was verified',final['inspection']['transport']=='MemoryTRPCLink — NO HTTP')
    check('Final body stays within viewport',final['overflow']['scrollWidth']<=width and final['overflow']['scrollHeight']<=height)
    check('No cookies or persistent storage after all interactions',final['cookies']=='' and not final['localStorageKeys'] and not final['sessionStorageKeys'])
    result['final']=final;result['passed']=all(a['passed'] for a in result['assertions'])
    save(attempt/f'{label}-result.json',result)
    return result


def inside(attempt):
    def stop_signal(signum, frame):
        raise TimeoutError(f'Owned harness received termination signal {signum}; cleanup in finally')
    signal.signal(signal.SIGTERM,stop_signal)
    report={'scope':'offline-real-components-synthetic-fixtures','status':'running','cases':[],
            'authentication':'No OAuth or real tRPC server verified. App not mounted. No cookie/token/session/login.',
            'transport':'MemoryTRPCLink; no backend or remote WMS transport',
            'limits':['Not OAuth homologation','Not real server tRPC authorization','Not DB or persistence','Not real remote WMS availability','Basemap tiles intentionally absent; previews may be blocked with explicit fallback','Synthetic PNG geographic marks are fixtures, not official cartography','3D adapter runs in an actual react-globe.gl scene; normal full App is not mounted'],
            'sourcesSha256Before':hashes(),'screenshots':[],'errors':[]}
    vite=chrome=cdp=None;handles=[];temp_path=None
    try:
        interfaces=json.loads(subprocess.check_output(['ip','-j','addr','show']))
        routes=json.loads(subprocess.check_output(['ip','-j','route','show']))
        routes6=json.loads(subprocess.check_output(['ip','-j','-6','route','show']))
        probe=socket.socket();probe.settimeout(.5);external=probe.connect_ex(('1.1.1.1',443));probe.close()
        report['network']={'namespace':os.readlink('/proc/self/ns/net'),'interfaces':interfaces,'routes':routes,'routes6':routes6,'externalDirectProbeErrno':external,'protection':'network namespace + Chromium DNS + pre-navigation CDP Fetch allowlist'}
        if len(interfaces)!=1 or interfaces[0]['ifname']!='lo' or routes or routes6 or external!=errno.ENETUNREACH:
            raise RuntimeError('Unsafe network namespace: expected loopback only and no route')
        report['environment']={'keys':sorted(os.environ),'appEnvKeysPresent':[k for k in os.environ if k.startswith(('VITE_','DATABASE_','OAUTH_','JWT_','BUILT_IN_'))]}
        if report['environment']['appEnvKeysPresent']:raise RuntimeError('App/credential environment must be absent')
        with tempfile.TemporaryDirectory(prefix='atena-inde-visual-') as temp:
            temp_path=Path(temp)
            env={**os.environ,'INDE_HARNESS_CACHE_DIR':str(temp_path/'vite-cache'),'XDG_CACHE_HOME':str(temp_path/'xdg-cache'),'XDG_CONFIG_HOME':str(temp_path/'xdg-config')}
            handles=[(attempt/'vite.log').open('w'),(attempt/'chromium.log').open('w')]
            vite=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.inde-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=handles[0],stderr=subprocess.STDOUT,start_new_session=True)
            save(attempt/'owned-processes.json',{'viteProcessGroup':vite.pid})
            reference.wait_http(URL,50)
            chrome=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={CDP_PORT}',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp_path/"chromium"}','--window-size=1057,692','about:blank'],cwd=ROOT,env=env,stdout=handles[1],stderr=subprocess.STDOUT,start_new_session=True)
            save(attempt/'owned-processes.json',{'viteProcessGroup':vite.pid,'chromiumProcessGroup':chrome.pid})
            try:
                reference.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list',30)
                target=next(t for t in reference.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if t.get('type')=='page')
                cdp=OfflineCDP(target['webSocketDebuggerUrl'])
                for domain in ['Page','Runtime','Network','Log']:cdp.call(domain+'.enable')
                cdp.call('Network.setCacheDisabled',{'cacheDisabled':True})
                cdp.call('Fetch.enable',{'patterns':[{'urlPattern':'*','requestStage':'Request'}]})
                for label,w,h in [('desktop',1057,692),('mobile',390,844)]:
                    try:report['cases'].append(run_ui(cdp,attempt,label,w,h))
                    except Exception as exc:
                        case={'id':label,'passed':False,'error':str(exc),'traceback':traceback.format_exc(),'assertions':[],'screenshots':[]}
                        progress=attempt/f'{label}-progress.json'
                        if progress.exists():
                            partial=json.loads(progress.read_text());case['assertions']=partial.get('assertions',[]);case['screenshots']=partial.get('screenshots',[])
                        try:
                            case['snapshot']=snapshot(cdp);case['screenshots'].append(shot(cdp,attempt,label+'-failed',True))
                        except Exception as diagnostic:case['diagnosticError']=str(diagnostic)
                        save(attempt/f'{label}-failed.json',case);report['cases'].append(case);report['errors'].append(str(exc));print('CASE_FAIL '+label+' '+str(exc),flush=True)
                # Separate capability failure case: no healthy fallback or blank success.
                cdp.call('Page.navigate',{'url':URL+'?case=caps-failure'})
                wait(cdp,"window.__INDE_HARNESS__?.state?.identity==='9901'")
                open_catalog(cdp);open_org(cdp,'orgB');wait(cdp,"document.body.innerText.includes('MOCK_CAPABILITIES_UNAVAILABLE')")
                failure=snapshot(cdp);save(attempt/'caps-failure.json',failure)
                report['cases'].append({'id':'caps-failure','passed':not any(c['path']=='indeCatalog.mapImage' for c in failure['inspection']['calls']),'assertions':[{'check':'Capabilities failure explicit and no image request','passed':not any(c['path']=='indeCatalog.mapImage' for c in failure['inspection']['calls'])}],'screenshots':[shot(cdp,attempt,'caps-failure')]})
                report['resourcesBlocked']=cdp.blocked
                report['resourcesAllowed']=cdp.allowed
                report['consoleExceptions']=[e for e in cdp.events if e.get('method')=='Runtime.exceptionThrown']
                report['unknownPathErrors']=[c for case in report['cases'] for c in case.get('final',{}).get('inspection',{}).get('calls',[]) if 'MOCK_UNKNOWN_PATH' in c.get('error','')]
                report['externalImageRequestsExceptBasemapPreviews']=[r for r in cdp.blocked if any(x in r['url'].lower() for x in ['cloud','earth','globe','wms','trpc','oauth'])]
                save(attempt/'cdp-events.json',cdp.events)
                report['status']='passed' if all(c['passed'] for c in report['cases']) and not report['consoleExceptions'] and not report['unknownPathErrors'] and not report['externalImageRequestsExceptBasemapPreviews'] else 'failed'
            finally:
                if cdp:cdp.close()
                reference.terminate_owned(chrome);reference.terminate_owned(vite)
                report['cleanup']={'chromiumStopped':chrome is None or chrome.poll() is not None,'viteStopped':vite is None or vite.poll() is not None,'temporaryDirectory':str(temp_path)}
        report['cleanup']['temporaryDirectoryRemoved']=not temp_path.exists()
    except Exception as exc:
        report['status']='failed';report['errors'].append(str(exc));report['traceback']=traceback.format_exc();print(report['traceback'],flush=True)
    finally:
        reference.terminate_owned(chrome);reference.terminate_owned(vite)
        for handle in handles:handle.close()
        report['sourcesSha256After']=hashes();report['sourceFilesStableDuringRun']=report['sourcesSha256Before']==report['sourcesSha256After']
        if not report['sourceFilesStableDuringRun']:report['status']='failed';report['errors'].append('Source files changed during run; results not frozen')
        report['screenshots']=sorted(str(p) for p in attempt.glob('*.png'))
        assertions=[a for c in report['cases'] for a in c['assertions']]
        report['counts']={'cases':len(report['cases']),'casesPassed':sum(c['passed'] for c in report['cases']),'checks':len(assertions),'checksPassed':sum(a['passed'] for a in assertions),'checksFailed':sum(not a['passed'] for a in assertions),'screenshots':len(report['screenshots'])}
        report['cleanup']=report.get('cleanup',{'chromiumStopped':chrome is None or chrome.poll() is not None,'viteStopped':vite is None or vite.poll() is not None,'temporaryDirectoryRemoved':temp_path is None or not temp_path.exists()})
        save(attempt/'SUMMARY.json',report)
        (attempt/'README.md').write_text('# Harness visual INDE — limites\n\nExecução finita, offline, com componentes React/Leaflet/Three reais e MemoryTRPCLink. PNGs sintéticos geográficos são dados de avaliação; não são cartografia oficial. Sem App normal, servidor tRPC, DB, OAuth, sessão, cookie ou token. **OAuth e autorização de servidor não foram homologados.** Nenhum WMS remoto real é transportado neste harness; os testes remotos pertencem à validação separada do agente principal.\n\nPré-visualizações remotas dos fundos são bloqueadas antes do transporte, com o fallback textual real “Sem prévia”. O globo usa exclusivamente textura PNG data URL sintética; nenhuma imagem de nuvem ou terra externa deve ser solicitada. Prontidão exige ImageOverlay carregado ou textura/malha real na cena Three. Comparações de pixels e descarte de recursos constam no SUMMARY.json. Resultados incompletos ou falsos são reportados como falha, nunca como aprovação.\n',encoding='utf-8')
        print('INDE_VISUAL_STATUS='+report['status'].upper(),flush=True);print('SUMMARY='+str(attempt/'SUMMARY.json'),flush=True)
    return 0 if report['status']=='passed' else 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only-3d',action='store_true',help='Retoma somente os cenários 3D após revisão do main')
    parser.add_argument('--frozen-confirmed',help='Explicit main approval identifier; required before any launch')
    parser.add_argument('--inside-offline-namespace',type=Path)
    args=parser.parse_args()
    global ONLY_3D
    ONLY_3D=args.only_3d
    if args.inside_offline_namespace:return inside(args.inside_offline_namespace)
    if not args.frozen_confirmed:parser.error('Execution blocked: main must confirm backend + UI + 3D source freeze first')
    hashes() # fail before launch if required real source files are missing
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    existing=[p for p in EVIDENCE.glob('visual-*') if (p/'launch.json').exists()]
    if len(existing)>=3 and not args.only_3d:raise SystemExit('Three full attempts reached; use only-3d after main review')
    if args.only_3d and sum(json.loads((p/'launch.json').read_text()).get('only3D',False) for p in existing)>=4:raise SystemExit('Four targeted 3D attempts reached; inspect before further work')
    attempt=EVIDENCE/('visual-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));attempt.mkdir()
    clean={'HOME':'/tmp','PATH':str(Path(shutil.which('node')).resolve().parent)+':/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8','NO_PROXY':'*','no_proxy':'*'}
    command=['sudo','-n','unshare','--net','/bin/sh','-ec','ip link set lo up; exec /usr/bin/env -i "$@"','inde-offline',*[f'{k}={v}' for k,v in clean.items()],sys.executable,str(Path(__file__).resolve()),'--inside-offline-namespace',str(attempt)]
    if args.only_3d:command.append('--only-3d')
    save(attempt/'launch.json',{'only3D':args.only_3d,'command':command,'frozenApproval':args.frozen_confirmed,'cleanEnvironmentKeys':list(clean),'parentNamespace':os.readlink('/proc/self/ns/net'),'finiteTimeoutSeconds':360})
    print('INDE_OFFLINE_ATTEMPT='+str(attempt),flush=True)
    with (attempt/'runner.log').open('w') as handle:
        process=subprocess.Popen(command,cwd=ROOT,stdout=handle,stderr=subprocess.STDOUT,start_new_session=True)
        try:code=process.wait(timeout=360)
        except subprocess.TimeoutExpired:
            subprocess.run(['sudo','-n','kill','-TERM','--',str(-process.pid)],check=False)
            try:process.wait(timeout=12)
            except subprocess.TimeoutExpired:
                subprocess.run(['sudo','-n','kill','-KILL','--',str(-process.pid)],check=False)
            manifest=attempt/'owned-processes.json'
            if manifest.exists():
                for group in json.loads(manifest.read_text()).values():
                    subprocess.run(['sudo','-n','kill','-TERM','--',str(-group)],check=False)
            code=124;save(attempt/'timeout.json',{'error':'finite harness timeout','seconds':360,'cleanup':'signalled only owned groups recorded by this attempt'})
    subprocess.run(['sudo','-n','chown','-R',f'{os.getuid()}:{os.getgid()}',str(attempt)],check=False)
    print((attempt/'runner.log').read_text(),end='',flush=True)
    save(attempt/'exit.json',{'exitCode':code,'finishedUTC':dt.datetime.now(dt.timezone.utc).isoformat()})
    return code


if __name__=='__main__':
    raise SystemExit(main())
