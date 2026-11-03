#!/usr/bin/env python3
"""Finite, offline Leaflet/MapPrintPreview harness. Existing dependencies only.

IMPORTANT: run only after the coordinator confirms a source freeze:
  python3 infra/scripts/run_print_layout_harness.py --sources-frozen 'coordinator confirmation'
No source-file readiness polling. New evidence directory for every actual attempt.
The real exporter provides PDF bytes; this harness never builds a substitute PDF.
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
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import traceback

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path('/home/ubuntu/atena_impressao_layouts_20261102_2153/evidence/visual-NEWATTEMPT')
PORT, CDP_PORT = 4187, 9234
URL = f'http://127.0.0.1:{PORT}/print-layout-harness.html'
SOURCE_PATHS = [
    'client/print-layout-harness.html', 'client/src/printLayoutHarness.tsx',
    'vite.print-layout-harness.config.ts', 'infra/scripts/run_print_layout_harness.py',
    'client/src/components/MapPrintPreview.tsx', 'client/src/lib/captureMapSnapshot.ts',
    'shared/mapPrint.ts', 'shared/mapPrintLayouts.ts', 'client/src/lib/trpc.ts',
    'client/src/lib/mapPrintRender.ts', 'client/src/index.css',
]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('print_cdp_builtins_only', ROOT / 'infra/scripts/run_f1f2_visual_harness.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.CDP_PORT = CDP_PORT
save, wait_js = base.save, base.wait_js

class GuardedCDP(base.CDP):
    """Only this exact loopback origin (and browser-internal data/blob) is allowed."""
    def __init__(self, url):
        super().__init__(url)
        self.blocked = []
    def call(self, method, params=None):
        self.counter += 1
        wanted = self.counter
        self.send(json.dumps({'id': wanted, 'method': method, 'params': params or {}}))
        while True:
            message = json.loads(self.receive())
            if message.get('method') == 'Fetch.requestPaused':
                self.events.append(message)
                request = message['params']; url = request['request']['url']
                allowed = url.startswith(f'http://127.0.0.1:{PORT}/') and '/api/' not in url
                self.counter += 1
                if not allowed: self.blocked.append(url)
                self.send(json.dumps({'id': self.counter, 'method': 'Fetch.continueRequest' if allowed else 'Fetch.failRequest', 'params': {'requestId': request['requestId'], **({} if allowed else {'errorReason': 'BlockedByClient'})}}))
                continue
            if message.get('id') == wanted:
                if 'error' in message: raise RuntimeError(f'{method}: {message["error"]}')
                return message.get('result', {})
            if 'method' in message: self.events.append(message)

def hashes():
    return {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() if (ROOT / p).exists() else 'NOT_PRESENT' for p in SOURCE_PATHS}

def click(cdp, selector):
    cdp.evaluate('document.querySelector(' + json.dumps(selector) + ')?.scrollIntoView({block:"center",inline:"nearest"})')
    base.click(cdp, selector)

def text_button(cdp, label):
    cdp.evaluate('''(()=>{document.querySelectorAll('[data-print-click]').forEach(e=>e.removeAttribute('data-print-click'));const rows=[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&(e.textContent.trim()===LABEL||e.getAttribute('aria-label')===LABEL));if(rows.length!==1)throw Error('Expected one button '+LABEL+', got '+rows.length);rows[0].dataset.printClick='true';})()'''.replace('LABEL', json.dumps(label)))
    click(cdp, '[data-print-click=true]')

def choose(cdp, label, value):
    """Actual native change or actual Radix option click; never a React handler call."""
    mode = cdp.evaluate('''(()=>{const label=LABEL,value=VALUE;document.querySelectorAll('[data-print-select]').forEach(e=>e.removeAttribute('data-print-select'));const labels=[...document.querySelectorAll('label')];const l=labels.find(e=>e.textContent.trim()===label);let e=l?.htmlFor?document.getElementById(l.htmlFor):null;if(!e)e=l?.parentElement?.querySelector('select,[role=combobox]');if(!e)e=document.querySelector('[aria-label="'+label+'"]');if(!e)throw Error('Missing select '+label);e.dataset.printSelect='true';if(e.tagName==='SELECT'){const o=[...e.options].find(o=>o.value===value||o.textContent.trim()===value);if(!o)throw Error('Missing native option '+value);e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return 'native';}return 'radix';})()'''.replace('LABEL', json.dumps(label)).replace('VALUE', json.dumps(value)))
    if mode == 'radix':
        click(cdp, '[data-print-select=true]')
        cdp.evaluate('''(()=>{const value=VALUE;const e=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===value||e.textContent.trim().startsWith(value+' '));if(!e)throw Error('Missing Radix option '+value);e.dataset.printOption='true';})()'''.replace('VALUE', json.dumps(value)))
        click(cdp, '[data-print-option=true]')
    time.sleep(.15)

def snapshot(cdp):
    return cdp.evaluate('''(()=>{const h=window.__PRINT_HARNESS__;return {inspection:h?{...h,snapshot:h.snapshot?{...h.snapshot,imageDataUrl:'[saved separately]'}:null,downloads:h.downloads.map(d=>({...d,dataUrl:d.dataUrl?'[saved separately]':null}))}:null,body:document.body.innerText,layout:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,dialog:[...document.querySelectorAll('[role=dialog]')].map(e=>({rect:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}))},buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>({text:e.textContent.trim(),aria:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid'),disabled:e.disabled})),selects:[...document.querySelectorAll('select,[role=combobox]')].map(e=>({id:e.id,aria:e.getAttribute('aria-label'),value:e.value,text:e.textContent})),inputs:[...document.querySelectorAll('input')].map(e=>({id:e.id,placeholder:e.placeholder,value:e.value})),svgs:[...document.querySelectorAll('[role=dialog] svg[viewBox]')].map(e=>({testid:e.getAttribute('data-testid'),viewBox:e.getAttribute('viewBox'),rect:e.getBoundingClientRect().toJSON(),images:e.querySelectorAll('image').length})),resources:performance.getEntriesByType('resource').map(e=>e.name),cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)};})()''')

def shot(cdp, attempt, name, clip=None):
    params = {'format': 'png', 'captureBeyondViewport': False}
    if clip: params['clip'] = {**clip, 'scale': 1}
    data = base64.b64decode(cdp.call('Page.captureScreenshot', params)['data'])
    (attempt / name).write_bytes(data)
    return {'file': name, 'sha256': hashlib.sha256(data).hexdigest()}

def color_counts(path):
    from PIL import Image
    image = Image.open(path).convert('RGB')
    counts = {'blue': 0, 'violet': 0, 'green': 0, 'yellow': 0}
    for r, g, b in image.getdata():
        if b > 130 and b > r * 1.5 and b > g * 1.2: counts['blue'] += 1
        if r > 90 and b > 110 and r > g * 1.45 and b > g * 1.5: counts['violet'] += 1
        if g > 100 and g > r * 1.6 and g > b * 1.3: counts['green'] += 1
        if r > 160 and g > 140 and b < 110: counts['yellow'] += 1
    return {'size': image.size, 'counts': counts, 'fractions': {k: v / (image.width * image.height) for k, v in counts.items()}}

def compare_pixels(actual, captured, masks=()):
    from PIL import Image, ImageChops, ImageStat, ImageDraw
    a, b = Image.open(actual).convert('RGB'), Image.open(captured).convert('RGB')
    if b.size != a.size: b = b.resize(a.size)
    for rect in masks:
        box = (max(0, rect['x']-1), max(0, rect['y']-1), min(a.width, rect['x']+rect['width']+1), min(a.height, rect['y']+rect['height']+1))
        ImageDraw.Draw(a).rectangle(box, fill='white')
        ImageDraw.Draw(b).rectangle(box, fill='white')
    # Mean error is reported, not used as an exact-equality requirement: browser anti-aliasing differs.
    error = ImageStat.Stat(ImageChops.difference(a, b)).mean
    # Color fractions use the same control mask on both images; no cartographic layer is excluded.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='print-comparison-') as temp:
        ap, bp = Path(temp)/'a.png', Path(temp)/'b.png'
        a.save(ap); b.save(bp); ac, bc = color_counts(ap), color_counts(bp)
    differences = {k: abs(ac['fractions'][k] - bc['fractions'][k]) for k in ac['fractions']}
    return {'source': ac, 'snapshot': bc, 'excludedAttributionControlRects': masks, 'meanAbsoluteRgbDifference': error, 'fractionDifferences': differences, 'passed': all(v > 20 for v in bc['counts'].values()) and all(v < .035 for v in differences.values()) and max(error) < 18}

def save_capture(cdp, attempt, case_id, map_image):
    h = cdp.evaluate('window.__PRINT_HARNESS__')
    data = h['snapshot']['imageDataUrl']
    output = attempt / (case_id + '-captured-map.png')
    output.write_bytes(base64.b64decode(data.split(',', 1)[1]))
    (attempt / (case_id + '-leaflet-vector.svg')).write_text(h['map']['svg'] + '\n')
    mask_path = attempt / (case_id + '-excluded-control-rects.json')
    masks = json.loads(mask_path.read_text()) if mask_path.exists() else []
    comparison = compare_pixels(map_image, output, masks)
    save(attempt / (case_id + '-pixel-comparison.json'), comparison)
    return comparison

def preview_info(cdp, attempt, name):
    wait_js(cdp, 'Boolean(document.querySelector("[role=dialog] img[alt^=Prévia]"))')
    data = cdp.evaluate('''(()=>{const e=document.querySelector('[role=dialog] img[alt^=Prévia]');const source=decodeURIComponent(e.src.split(',').slice(1).join(','));const svg=new DOMParser().parseFromString(source,'image/svg+xml');const image=svg.querySelector('image');const snapshot=window.__PRINT_HARNESS__.snapshot;return {source,viewBox:svg.documentElement.getAttribute('viewBox'),mapRect:{x:+image.getAttribute('x'),y:+image.getAttribute('y'),width:+image.getAttribute('width'),height:+image.getAttribute('height')},sameCapturedImage:image.getAttribute('href')===snapshot.imageDataUrl,capturedSize:[snapshot.width,snapshot.height],selectedModel:document.querySelector('#map-print-model').value,paper:document.querySelector('#map-print-paper').value,orientation:document.querySelector('#map-print-orientation').value};})()''')
    (attempt / (name + '-preview.svg')).write_text(data.pop('source') + '\n')
    rect = data['mapRect']; width, height = data['capturedSize']
    data['aspectPassed'] = abs(rect['width'] / rect['height'] - width / height) < 1e-9
    save(attempt / (name + '-preview-geometry.json'), data)
    return data

def open_advanced(cdp):
    if not cdp.evaluate('Boolean(document.querySelector("[role=dialog] details")?.open)'):
        click(cdp, '[role=dialog] summary')

def export_pdf(cdp, attempt, name, expected_mm):
    from PIL import Image, ImageChops
    from pypdf import PdfReader
    preview = preview_info(cdp, attempt, name)
    before = cdp.evaluate('window.__PRINT_HARNESS__.downloads.length')
    text_button(cdp, 'Baixar PDF')
    wait_js(cdp, f'window.__PRINT_HARNESS__.downloads.length>{before} && Boolean(window.__PRINT_HARNESS__.downloads[{before}].dataUrl)', timeout=45)
    item = cdp.evaluate(f'window.__PRINT_HARNESS__.downloads[{before}]')
    pdf = attempt / (name + '.pdf'); pdf.write_bytes(base64.b64decode(item['dataUrl'].split(',', 1)[1]))
    info = subprocess.check_output(['pdfinfo', str(pdf)], text=True); (attempt / (name + '-pdfinfo.txt')).write_text(info)
    match = re.search(r'Page size:\s*([\d.]+) x ([\d.]+) pts', info)
    actual_mm = [float(value) * 25.4 / 72 for value in match.groups()] if match else []
    raster = attempt / (name + '-pdf-render')
    subprocess.run(['pdftoppm', '-f', '1', '-singlefile', '-scale-to', '1400', '-png', str(pdf), str(raster)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=40)
    colors = color_counts(raster.with_suffix('.png'))
    prefix = attempt / (name + '-embedded')
    subprocess.run(['pdfimages', '-png', str(pdf), str(prefix)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=20)
    extracted = sorted(attempt.glob(name + '-embedded-*.png'))
    captured = Image.open(io.BytesIO(base64.b64decode(cdp.evaluate('window.__PRINT_HARNESS__.snapshot.imageDataUrl').split(',',1)[1]))).convert('RGB')
    image_identity = any((lambda image: image.size == captured.size and ImageChops.difference(image, captured).getbbox() is None)(Image.open(path).convert('RGB')) for path in extracted)
    page = PdfReader(str(pdf)).pages[0]
    matrix = None; placements = []
    for operands, operator in page.get_contents().operations:
        if operator == b'cm': matrix = [float(n) for n in operands]
        if operator == b'Do' and matrix:
            placements.append({'widthMm':abs(matrix[0])*25.4/72,'heightMm':abs(matrix[3])*25.4/72})
    same_geometry = any(abs(p['widthMm']-preview['mapRect']['width'])<1e-6 and abs(p['heightMm']-preview['mapRect']['height'])<1e-6 for p in placements)
    return {'pdf': pdf.name, 'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(), 'bytes': pdf.stat().st_size, 'download': {k:v for k,v in item.items() if k != 'dataUrl'}, 'expectedMm': expected_mm, 'actualMm': actual_mm, 'pageSizePassed': len(actual_mm) == 2 and all(abs(a-b) < .2 for a,b in zip(actual_mm, expected_mm)), 'onePage': bool(re.search(r'Pages:\s+1\b', info)), 'renderedPixels': colors, 'mapPixelsPassed': all(v > 5 for v in colors['counts'].values()), 'preview':preview,'embeddedPngEqualsCapture':image_identity,'pdfImagePlacements':placements,'samePreviewPdfGeometry':same_geometry}

def run_case(cdp, attempt, case, include_a0=False):
    case_id = case['id']; print('CASE_START=' + case_id, flush=True)
    cdp.call('Emulation.setDeviceMetricsOverride', {'width':case['width'],'height':case['height'],'deviceScaleFactor':1,'mobile':False})
    cdp.call('Page.navigate', {'url': URL + '?case=' + case_id})
    wait_js(cdp, 'window.__PRINT_HARNESS__?.caseId === ' + json.dumps(case_id) + ' && window.__PRINT_HARNESS__.mapReady', timeout=35)
    # Pump CDP until real local fixture image requests settle; not source-file polling.
    wait_js(cdp, 'document.querySelectorAll(".leaflet-tile").length>0 && [...document.querySelectorAll(".leaflet-tile")].every(e=>e.complete)', timeout=12)
    assertions, pictures, checkpoints, pdfs = [], [], {}, []
    def check(label, value): assertions.append({'assertion':label, 'passed':bool(value)})
    def checkpoint(name):
        state = snapshot(cdp); checkpoints[name] = state
        check(name + ': no page/dialog horizontal overflow', state['layout']['scrollWidth'] <= case['width'] and state['layout']['bodyScrollWidth'] <= case['width'] and all(d['scrollWidth'] <= d['clientWidth'] + 1 and d['rect']['x'] >= -1 and d['rect']['right'] <= case['width'] + 1 for d in state['layout']['dialog']))
        return state
    rect = cdp.evaluate('window.__PRINT_HARNESS__.map.rect')
    clip = {key:rect[key] for key in ['x','y','width','height']}
    map_image = attempt / (case_id + '-full-map-before-open.png')
    excluded = cdp.evaluate('''(()=>{const map=document.querySelector('[data-testid=real-leaflet-fixture]');const m=map.getBoundingClientRect();return [...map.querySelectorAll('.leaflet-control-attribution')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x-m.x,y:r.y-m.y,width:r.width,height:r.height};});})()''')
    save(attempt / (case_id + '-excluded-control-rects.json'), excluded)
    pictures.append(shot(cdp, attempt, map_image.name, clip))
    click(cdp, '[data-testid=harness-open-print]')
    wait_js(cdp, 'Boolean(document.querySelector("[role=dialog]"))')
    if case_id == 'cancel':
        wait_js(cdp, 'window.__PRINT_HARNESS__.captures.length===1')
        text_button(cdp, 'Cancelar')
        wait_js(cdp, '!document.querySelector("[role=dialog]") && !window.__PRINT_HARNESS__.open')
        time.sleep(1.5); cdp.evaluate('0')
        state = checkpoint('cancelled-after-settlement')
        check('cancel stays closed; no stale snapshot/download', not state['inspection']['open'] and state['inspection']['snapshot'] is None and len(state['inspection']['downloads']) == 0)
        check('real capture request aborted', any(c.get('aborted') for c in state['inspection']['captures']))
        click(cdp, '[data-testid=harness-open-print]')
        wait_js(cdp, 'window.__PRINT_HARNESS__.snapshot !== null', timeout=20)
        check('reopen initiates fresh capture', cdp.evaluate('window.__PRINT_HARNESS__.captures.length===2'))
        checkpoint('reopened-fresh')
        pictures.append(shot(cdp, attempt, case_id + '-reopened.png'))
    elif case_id == 'tile-failure':
        wait_js(cdp, 'window.__PRINT_HARNESS__.captures.some(c=>c.error)', timeout=20)
        state = checkpoint('real-tile-failure')
        check('real capture failure gives no successful snapshot', state['inspection']['snapshot'] is None)
        exports = [b for b in state['buttons'] if b['text'] == 'Baixar PDF']
        check('export unavailable after tile failure', len(exports) == 1 and exports[0]['disabled'])
        check('no PDF blob on negative capture', len(state['inspection']['downloads']) == 0)
        pictures.append(shot(cdp, attempt, case_id + '-blocked.png'))
    else:
        wait_js(cdp, 'window.__PRINT_HARNESS__.snapshot !== null', timeout=25)
        state = checkpoint('automatic-preview')
        check('open automatically invokes real capture once', len(state['inspection']['captures']) == 1)
        preview = preview_info(cdp, attempt, case_id + '-automatic')
        check('preview displays exact captured PNG and original aspect without separate preview click', preview['sameCapturedImage'] and preview['aspectPassed'])
        comparison = save_capture(cdp, attempt, case_id, map_image)
        check('blue tile, violet image, green SVG polygon and yellow line match full map pixels', comparison['passed'])
        check('local WMS tile requests actually executed', any('/__print_fixture__/wms?' in u for u in state['resources']))
        check('actual Leaflet SVG contains green vector', '#16c45c' in state['inspection']['map']['svg'])
        pictures.append(shot(cdp, attempt, case_id + '-vista-livre.png'))
        if case_id == 'desktop':
            # Default download before any separate preview action or layout selection.
            pdfs.append(export_pdf(cdp, attempt, case_id + '-vista-livre-A4-landscape', [297,210]))
        original_viewbox = preview['viewBox']
        # Built-in models are real controls, not stand-ins or pre-rendered fixtures.
        for model in ['Técnico','Apresentação','Vista livre']:
            choose(cdp, 'Modelo de layout', model)
            state = checkpoint(model)
            preview = preview_info(cdp, attempt, case_id + '-' + {'Técnico':'tecnico','Apresentação':'apresentacao','Vista livre':'vista-livre-final'}[model])
            check(model + ': preview preserves exact captured image and aspect', preview['sameCapturedImage'] and preview['aspectPassed'])
            if case['width'] < 600:
                cdp.evaluate('document.querySelector("[role=dialog] img[alt^=Prévia]").scrollIntoView({block:"center"})')
            pictures.append(shot(cdp, attempt, case_id + '-' + {'Técnico':'tecnico','Apresentação':'apresentacao','Vista livre':'vista-livre-final'}[model] + '.png'))
            if model == 'Apresentação':
                check('portrait model changes paper aspect/layout', preview['viewBox'] != original_viewbox)
            if case_id == 'desktop' and model == 'Técnico':
                open_advanced(cdp)
                choose(cdp, 'Papel', 'A3')
                choose(cdp, 'Orientação', 'Retrato')
                pdfs.append(export_pdf(cdp, attempt, case_id + '-tecnico-A3-portrait', [297,420]))
            if case_id == 'desktop' and model == 'Apresentação':
                pdfs.append(export_pdf(cdp, attempt, case_id + '-apresentacao-A4-portrait', [210,297]))
        check('three models do not recapture or fabricate map pixels', cdp.evaluate('window.__PRINT_HARNESS__.captures.length===1'))
        if case_id == 'desktop':
            open_advanced(cdp)
            check('no automatic template mutation on open, export or model selection', cdp.evaluate('!window.__PRINT_HARNESS__.calls.some(c=>c.type==="mutation")'))
            cdp.evaluate('''(()=>{const e=document.querySelector('#map-print-save-name');if(!e)throw Error('Missing model name input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(e,'Modelo local explícito');e.dispatchEvent(new Event('input',{bubbles:true}));})()''')
            text_button(cdp, 'Salvar modelo')
            wait_js(cdp, 'window.__PRINT_HARNESS__.calls.some(c=>c.path==="atlas.templates.create"&&c.pending)')
            wait_js(cdp, '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Salvar modelo"&&b.disabled)')
            pending = checkpoint('save-pending')
            check('save visibly pending and disabled', any(b['disabled'] and ('Salvando' in b['text'] or 'Salvar modelo' in b['text']) for b in pending['buttons']))
            pictures.append(shot(cdp, attempt, case_id + '-save-pending.png'))
            wait_js(cdp, 'window.__PRINT_HARNESS__.calls.filter(c=>c.path==="atlas.templates.list"&&c.response).length>=2 && window.__PRINT_HARNESS__.templates.length===2', timeout=10)
            state = checkpoint('save-requeried')
            create = [c for c in state['inspection']['calls'] if c['path']=='atlas.templates.create']
            check('one explicit create, memory append and requery', len(create)==1 and len(state['inspection']['templates'])==2)
            check('legacy template remains byte-for-byte unchanged', state['inspection']['templates'][0] == state['inspection']['legacyTemplate'])
            check('saved configuration contains no captured raster payload', 'data:image' not in json.dumps(create) and bool(create[0]['input'].get('config',{}).get('printLayout')))
            pictures.append(shot(cdp, attempt, case_id + '-saved-model.png'))
            if include_a0:
                choose(cdp, 'Papel', 'A0'); choose(cdp, 'Orientação', 'Retrato')
                pdfs.append(export_pdf(cdp, attempt, case_id + '-A0-portrait', [841,1189]))
        if case_id == 'client':
            open_advanced(cdp)
            cdp.evaluate('document.querySelector("#map-print-save-name").scrollIntoView({block:"center"})')
            state = checkpoint('synthetic-client')
            check('synthetic client sees disabled save model control', any(b['text']=='Salvar modelo' and b['disabled'] for b in state['buttons']))
            check('client performs no template mutation', not any(c['type']=='mutation' for c in state['inspection']['calls']))
            pictures.append(shot(cdp, attempt, case_id + '-save-disabled.png'))
    for pdf in pdfs:
        check(pdf['pdf'] + ': real PDF has expected page size and one page', pdf['pageSizePassed'] and pdf['onePage'])
        check(pdf['pdf'] + ': rendered PDF retains all four map colors', pdf['mapPixelsPassed'])
        check(pdf['pdf'] + ': extracted PDF PNG exactly equals captured PNG', pdf['embeddedPngEqualsCapture'])
        check(pdf['pdf'] + ': preview and PDF use same physical map dimensions/aspect', pdf['samePreviewPdfGeometry'] and pdf['preview']['sameCapturedImage'] and pdf['preview']['aspectPassed'])
    final = checkpoint('final')
    check('no cookies or persistent browser storage', not final['cookies'] and not final['localStorageKeys'] and not final['sessionStorageKeys'])
    check('no unknown mock API path', not any(c.get('error') for c in final['inspection']['calls']))
    result = {'id':case_id,'viewport':case,'assertions':assertions,'passed':all(a['passed'] for a in assertions),'checkpoints':checkpoints,'screenshots':pictures,'pdfs':pdfs}
    save(attempt / (case_id + '.json'), result)
    print('CASE_' + ('PASS=' if result['passed'] else 'FAIL=') + case_id, flush=True)
    return result

def inside(attempt, freeze_notice, include_a0):
    report = {'scope':'real MapPrintPreview + captureMapSnapshot + Leaflet; local synthetic pixels; MemoryTRPCLink', 'status':'running','cases':[], 'freezeNotice':freeze_notice,'sourcesSha256Before':hashes(), 'limits':['No real OAuth/login/authorization', 'No HTTP API/backend or database persistence', 'No real GIS backend/production/remote availability or remote CORS compatibility', 'Local WMS fixture only, not a GIS service', 'Synthetic local pixels are not cartography', 'Abort/absence observation is bounded to 1.5 seconds after cancellation', 'PDF bytes are observed from actual exporter Blob, not CDP printToPDF or replacement PDF']}
    vite = chrome = cdp = None; handles=[]
    def interrupted(signum, frame): raise RuntimeError('Harness interrupted: ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    try:
        network = {'namespace':os.readlink('/proc/self/ns/net'),'interfaces':json.loads(subprocess.check_output(['ip','-j','addr','show'])),'routesIPv4':json.loads(subprocess.check_output(['ip','-j','route','show'])),'routesIPv6':json.loads(subprocess.check_output(['ip','-j','-6','route','show']))}
        probe = socket.socket(); probe.settimeout(1); network['externalDirectProbe']={'destination':'1.1.1.1:443','errno':probe.connect_ex(('1.1.1.1',443))}; probe.close(); report['network']=network
        if len(network['interfaces'])!=1 or network['interfaces'][0]['ifname']!='lo' or network['routesIPv4'] or network['routesIPv6'] or network['externalDirectProbe']['errno']!=errno.ENETUNREACH: raise RuntimeError('Network namespace must be loopback-only with no routes')
        if any(value=='NOT_PRESENT' for key,value in report['sourcesSha256Before'].items() if key in ['client/src/lib/captureMapSnapshot.ts','client/src/components/MapPrintPreview.tsx']): raise RuntimeError('Frozen source is absent; no polling or substitute implementation allowed')
        with tempfile.TemporaryDirectory(prefix='atena-print-layout-') as temp:
            temp_path=Path(temp)
            env={**os.environ,'PRINT_LAYOUT_VITE_CACHE_DIR':str(temp_path/'vite-cache'),'XDG_CACHE_HOME':str(temp_path/'xdg-cache'),'XDG_CONFIG_HOME':str(temp_path/'xdg-config')}
            for name in ['vite.log','chromium.log']: handles.append((attempt/name).open('w'))
            vite=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.print-layout-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=handles[0],stderr=subprocess.STDOUT,start_new_session=True)
            try:
                base.wait_http(URL,timeout=45)
                chrome=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--metrics-recording-only','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1','--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={CDP_PORT}',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp_path/"chrome-profile"}','--window-size=1057,692','about:blank'],cwd=ROOT,env=env,stdout=handles[1],stderr=subprocess.STDOUT,start_new_session=True)
                base.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list')
                target=next(t for t in base.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if t.get('type')=='page')
                cdp=GuardedCDP(target['webSocketDebuggerUrl'])
                for domain in ['Page','Runtime','Network','Log']: cdp.call(domain+'.enable')
                cdp.call('Fetch.enable',{'patterns':[{'urlPattern':'*'}]})
                cdp.call('Browser.setDownloadBehavior',{'behavior':'allow','downloadPath':str(attempt),'eventsEnabled':True})
                report['network']['listeners']=subprocess.check_output(['ss','-lntp'],text=True)
                cases=[{'id':'desktop','width':1057,'height':692},{'id':'mobile','width':375,'height':812},{'id':'cancel','width':1057,'height':692},{'id':'tile-failure','width':1057,'height':692},{'id':'client','width':375,'height':812}]
                for case in cases:
                    try: report['cases'].append(run_case(cdp,attempt,case,include_a0))
                    except Exception as exc:
                        failed={'id':case['id'],'passed':False,'error':str(exc),'traceback':traceback.format_exc(),'assertions':[]}
                        try: failed['diagnostic']=snapshot(cdp);failed['screenshot']=shot(cdp,attempt,case['id']+'-failed.png')
                        except Exception as diag: failed['diagnosticError']=str(diag)
                        save(attempt/(case['id']+'-failed.json'),failed);report['cases'].append(failed);print('CASE_FAIL='+case['id']+': '+str(exc),flush=True)
                urls=sorted({e['params']['request']['url'] for e in cdp.events if e.get('method')=='Network.requestWillBeSent'})
                report['network'].update({'observedRequestUrls':urls,'externalObservedRequests':[u for u in urls if not u.startswith(f'http://127.0.0.1:{PORT}/') and not u.startswith(('data:','blob:'))],'blockedRequests':cdp.blocked,'apiRequests':[u for u in urls if '/api/' in u], 'browserGuard':'Exact loopback CDP allowlist + DNS restrictions + no-route network namespace'})
                report['consoleExceptions']=[e for e in cdp.events if e.get('method')=='Runtime.exceptionThrown']
                save(attempt/'cdp-events.json',cdp.events)
                report['status']='passed' if all(c['passed'] for c in report['cases']) and not report['network']['externalObservedRequests'] and not report['network']['apiRequests'] and not report['consoleExceptions'] else 'failed'
            finally:
                if cdp: cdp.close()
                base.terminate_owned(chrome);base.terminate_owned(vite)
                report['cleanup']={'chromiumStopped':chrome is None or chrome.poll() is not None,'viteStopped':vite is None or vite.poll() is not None,'temporaryDirectory':temp}
        report['cleanup']['temporaryDirectoryRemoved']=not Path(report['cleanup']['temporaryDirectory']).exists()
    except Exception as exc:
        report['status']='failed'; report['error']=str(exc);report['traceback']=traceback.format_exc();print(report['traceback'],flush=True)
    finally:
        for handle in handles: handle.close()
        report['sourcesSha256After']=hashes();report['sourceFilesStableDuringRun']=report['sourcesSha256Before']==report['sourcesSha256After']
        if not report['sourceFilesStableDuringRun']: report['status']='failed';report['sourceStabilityFailure']='Sources changed; this attempt is diagnostic only'
        report['counts']={'casesExecuted':len(report['cases']),'casesPassed':sum(c['passed'] for c in report['cases']),'assertionsExecuted':sum(len(c['assertions']) for c in report['cases']),'assertionsPassed':sum(a['passed'] for c in report['cases'] for a in c['assertions'])}
        save(attempt/'report.json',report);print('PRINT_LAYOUT_HARNESS='+report['status'].upper(),flush=True);print('REPORT_DIR='+str(attempt),flush=True)
    return 0 if report['status']=='passed' else 1

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-frozen', help='Explicit coordinator source-freeze confirmation; no automatic readiness polling')
    parser.add_argument('--include-a0', action='store_true', help='Optional real-export A0 portrait check')
    parser.add_argument('--inside-offline-namespace', type=Path, help=argparse.SUPPRESS)
    args=parser.parse_args()
    if not args.sources_frozen or not args.sources_frozen.strip():
        print('PREPARED_NOT_EXECUTED: waiting for explicit parent source-freeze notice. No servers/browser started.');return 2
    if args.inside_offline_namespace: return inside(args.inside_offline_namespace,args.sources_frozen,args.include_a0)
    EVIDENCE.mkdir(parents=True,exist_ok=True)
    attempt=EVIDENCE/(dt.datetime.now(dt.timezone.utc).strftime('attempt-%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));attempt.mkdir()
    clean={'HOME':'/tmp','PATH':str(Path(shutil.which('node')).resolve().parent)+':/usr/bin:/bin:/usr/sbin:/sbin','LANG':'C.UTF-8','NO_PROXY':'*','no_proxy':'*'}
    command=['sudo','-n','unshare','--net','/bin/sh','-ec','cd "$1"; shift; ip link set lo up; exec /usr/bin/env -i "$@"','print-layout-offline',str(ROOT),*[f'{k}={v}' for k,v in clean.items()],sys.executable,str(Path(__file__).resolve()),'--inside-offline-namespace',str(attempt),'--sources-frozen',args.sources_frozen]
    if args.include_a0: command.append('--include-a0')
    save(attempt/'launch.json',{'command':command,'cleanEnvironmentKeys':list(clean),'finiteTimeoutSeconds':360,'parentNetworkNamespace':os.readlink('/proc/self/ns/net'),'sourceFreezeNotice':args.sources_frozen})
    print('PRINT_LAYOUT_OFFLINE_ATTEMPT='+str(attempt),flush=True)
    with (attempt/'runner.log').open('w') as log:
        process=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        try: exit_code=process.wait(timeout=360)
        except subprocess.TimeoutExpired:
            # Signal the namespace owner first so its finally stops only its own Vite/Chromium groups.
            subprocess.run(['sudo','-n','kill','-TERM','--',f'-{process.pid}'],check=False)
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:subprocess.run(['sudo','-n','kill','-KILL','--',f'-{process.pid}'],check=False)
            exit_code=124;save(attempt/'timeout.json',{'error':'finite harness timeout','seconds':360})
    subprocess.run(['sudo','-n','chown','-R',f'{os.getuid()}:{os.getgid()}',str(attempt)],check=False)
    print((attempt/'runner.log').read_text(),end='',flush=True);save(attempt/'exit.json',{'exitCode':exit_code,'finishedUTC':dt.datetime.now(dt.timezone.utc).isoformat()});return exit_code
if __name__=='__main__': raise SystemExit(main())
