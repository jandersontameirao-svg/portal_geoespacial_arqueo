#!/usr/bin/env python3
"""Optional real WMS UI proof. Catalog/auth synthetic; no WFS or basemap; no image bodies saved."""
import base64,datetime as dt,hashlib,importlib.util,json,os,secrets,shutil,subprocess,sys,tempfile,traceback
from pathlib import Path
from urllib.parse import urlparse,parse_qs
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
EVIDENCE=Path('/home/ubuntu/atena_ibge_impl_20261102_2055/evidence')
PORT,CDP_PORT=4185,9232
URL=f'http://127.0.0.1:{PORT}/ibge-remote-visual-harness.html'
sp=importlib.util.spec_from_file_location('offline',ROOT/'infra/scripts/run_f1f2_visual_harness.py');b=importlib.util.module_from_spec(sp);sp.loader.exec_module(b);b.CDP_PORT=CDP_PORT
FILES=['client/src/components/InstitutionalMapLayers.tsx','client/src/components/InstitutionalLayersPanel.tsx','client/src/components/GlobalMapPanels.tsx','client/src/ibgeRemoteVisualHarness.tsx','client/ibge-remote-visual-harness.html','vite.ibge-remote-harness.config.ts','infra/scripts/run_ibge_remote_visual_harness.py']
def hashes():return {f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in FILES}
class CDP(b.CDP):
 def __init__(self,url):super().__init__(url);self.blocked=[];self.allowed=[]
 def call(self,method,params=None):
  self.counter+=1;wanted=self.counter;self.send(json.dumps({'id':wanted,'method':method,'params':params or {}}))
  while True:
   msg=json.loads(self.receive())
   if msg.get('method')=='Fetch.requestPaused':
    self.events.append(msg);p=msg['params'];url=p['request']['url'];u=urlparse(url);q={k.lower():v for k,v in parse_qs(u.query).items()}
    remote=u.scheme=='https' and u.netloc=='geoservicos.ibge.gov.br' and u.path=='/geoserver/wms' and p.get('resourceType')=='Image' and q.get('service',[''])[0].lower()=='wms' and q.get('request',[''])[0].lower()=='getmap' and q.get('layers')==['CGEO:C02_recortes_territoriais_municipio_2010']
    allowed=url.startswith(f'http://127.0.0.1:{PORT}/') or remote
    (self.allowed if allowed else self.blocked).append(url);self.counter+=1
    self.send(json.dumps({'id':self.counter,'method':'Fetch.continueRequest' if allowed else 'Fetch.failRequest','params':{'requestId':p['requestId'],**({} if allowed else {'errorReason':'BlockedByClient'})}}));continue
   if msg.get('id')==wanted:
    if 'error' in msg:raise RuntimeError(str(msg['error']))
    return msg.get('result',{})
   if 'method' in msg:self.events.append(msg)
def main():
 EVIDENCE.mkdir(exist_ok=True,parents=True);a=EVIDENCE/(dt.datetime.now(dt.timezone.utc).strftime('visual-run-remote-wms-%Y%m%dT%H%M%S.%fZ')+'-'+secrets.token_hex(3));a.mkdir()
 r={'status':'running','scope':'Real IBGE WMS images, synthetic metadata/auth only; no WFS/basemap','sourcesBefore':hashes(),'limits':['NOT real authentication/OAuth or backend/DB proof','No WFS, source download, response body persistence or real basemap','PNG is UI evidence only'],'assertions':[]};v=c=d=None
 try:
  with tempfile.TemporaryDirectory(prefix='ibge-real-wms-') as temp:
   env={'HOME':temp,'PATH':os.environ['PATH'],'LANG':'C.UTF-8','IBGE_REMOTE_VITE_CACHE_DIR':temp+'/vite-cache','XDG_CACHE_HOME':temp+'/cache','XDG_CONFIG_HOME':temp+'/config'}
   with (a/'vite.log').open('w') as vl,(a/'chromium.log').open('w') as cl:
    v=subprocess.Popen([shutil.which('node'),str(ROOT/'node_modules/vite/bin/vite.js'),'--config','vite.ibge-remote-harness.config.ts','--configLoader','runner'],cwd=ROOT,env=env,stdout=vl,stderr=subprocess.STDOUT,start_new_session=True)
    try:
     b.wait_http(URL,timeout=35)
     c=subprocess.Popen(['/usr/bin/chromium','--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-client-side-phishing-detection','--disable-features=OptimizationHints,MediaRouter','--disk-cache-size=0','--media-cache-size=0','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE geoservicos.ibge.gov.br',f'--remote-debugging-port={CDP_PORT}','--remote-debugging-address=127.0.0.1',f'--remote-allow-origins=http://127.0.0.1:{CDP_PORT}',f'--user-data-dir={temp}/chrome','about:blank'],cwd=ROOT,env=env,stdout=cl,stderr=subprocess.STDOUT,start_new_session=True)
     b.wait_http(f'http://127.0.0.1:{CDP_PORT}/json/list');target=next(x for x in b.http_json(f'http://127.0.0.1:{CDP_PORT}/json/list') if x.get('type')=='page');d=CDP(target['webSocketDebuggerUrl'])
     for domain in ['Page','Runtime','Network','Log']:d.call(domain+'.enable')
     d.call('Network.setCacheDisabled',{'cacheDisabled':True});d.call('Fetch.enable',{'patterns':[{'urlPattern':'*'}]});d.call('Emulation.setDeviceMetricsOverride',{'width':1057,'height':692,'deviceScaleFactor':1,'mobile':False});d.call('Page.navigate',{'url':URL})
     b.wait_js(d,'document.querySelector("[data-testid=map-panel-toggle-layers]") && window.__IBGE_HARNESS__',timeout=30)
     b.click(d,'[data-testid=map-panel-toggle-layers]');sel='[aria-label="Exibir WMS CGEO:C02_recortes_territoriais_municipio_2010"]';b.wait_js(d,'Boolean(document.querySelector('+json.dumps(sel)+'))');b.click(d,sel)
     try:b.wait_js(d,'Object.values(window.__IBGE_HARNESS__.panelState.statuses).some(s=>s.state==="ready"||s.state==="error")',timeout=45)
     except Exception as e:r['remoteWaitError']=str(e)
     state=d.evaluate('({inspection:window.__IBGE_HARNESS__,body:document.body.innerText,tiles:[...document.querySelectorAll("img.leaflet-tile")].map(e=>({src:e.src,complete:e.complete,naturalWidth:e.naturalWidth})),cookies:document.cookie,localStorageKeys:Object.keys(localStorage),sessionStorageKeys:Object.keys(sessionStorage)})');b.save(a/'snapshot.json',state)
     statuses=list(state['inspection']['panelState']['statuses'].values());requests=[e['params']['request']['url'] for e in d.events if e.get('method')=='Network.requestWillBeSent'];responses=[{k:e['params']['response'].get(k) for k in ['url','status','mimeType']} for e in d.events if e.get('method')=='Network.responseReceived'];failures=[e['params'] for e in d.events if e.get('method')=='Network.loadingFailed']
     def check(name,value):r['assertions'].append({'assertion':name,'passed':bool(value)})
     check('WMS reports images ready',any(s['state']=='ready' and 'Imagens WMS carregadas' in s['message'] for s in statuses));check('no WMS error status',not any(s['state']=='error' for s in statuses));check('real image tiles have decoded pixels',bool(state['tiles']) and all(t['complete'] and t['naturalWidth']>0 for t in state['tiles']));check('only WMS IBGE tiles',all(t['src'].startswith('https://geoservicos.ibge.gov.br/geoserver/wms?') for t in state['tiles']));check('no WFS or registration calls',all(x['path'] not in ['ogcCatalog.queryIbgeViewport','ogcCatalog.registerIbge'] for x in state['inspection']['calls']));check('no unknown memory paths',not any(x.get('error') for x in state['inspection']['calls']));check('no persistent storage',not state['cookies'] and not state['localStorageKeys'] and not state['sessionStorageKeys'])
     r.update({'statuses':statuses,'allowedRequests':d.allowed,'blockedRequests':d.blocked,'requestUrls':requests,'responseMetadata':responses,'networkFailures':failures,'consoleExceptions':[e for e in d.events if e.get('method')=='Runtime.exceptionThrown']})
     image=base64.b64decode(d.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['data']);(a/'remote-wms-ui.png').write_bytes(image);r['screenshotSha256']=hashlib.sha256(image).hexdigest();r['status']='passed' if all(x['passed'] for x in r['assertions']) and not r['consoleExceptions'] else 'unavailable-or-failed'
    finally:
     if d:d.close()
     b.terminate_owned(c);b.terminate_owned(v)
  r['cleanup']={'chromiumStopped':c is None or c.poll() is not None,'viteStopped':v is None or v.poll() is not None,'temporaryProfileRemoved':not Path(temp).exists()}
 except Exception as e:r.update({'status':'unavailable-or-failed','error':str(e),'traceback':traceback.format_exc()})
 r['sourcesAfter']=hashes();r['sourceFilesStableDuringRun']=r['sourcesBefore']==r['sourcesAfter']
 if not r['sourceFilesStableDuringRun']:r['status']='unstable-sources'
 b.save(a/'report.json',r);print('REMOTE_WMS='+r['status'].upper());print('REPORT_DIR='+str(a));print(json.dumps(r.get('statuses',r.get('error')),ensure_ascii=False));return 0 if r['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
