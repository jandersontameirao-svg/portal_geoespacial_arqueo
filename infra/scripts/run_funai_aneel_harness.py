import asyncio, json, os, pathlib, signal, subprocess, time, urllib.request
from playwright.async_api import async_playwright
ROOT=pathlib.Path('/home/ubuntu/atena_geoportal_funai_aneel_isolado')
OUT=pathlib.Path('/home/ubuntu/atena_funai_base_local_20261103')
checks=[]
def check(name, passed):
    checks.append({'name':name,'passed':bool(passed)})
    if not passed:raise AssertionError(name)
async def exercise():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=await browser.new_context(viewport={'width':1057,'height':692})
        blocked=[]
        async def route(r):
            if r.request.url.startswith('http://127.0.0.1:4195/'):
                await r.continue_()
            else:
                blocked.append(r.request.url);await r.abort()
        await context.route('**/*',route)
        page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        await page.goto('http://127.0.0.1:4195/funai-aneel-harness.html',wait_until='networkidle')
        await page.wait_for_selector('[data-testid="aneel-siga-card"]')
        card=page.locator('[data-testid="aneel-siga-card"]');funai=page.locator('[data-testid="funai-online-source-card"]')
        calls=lambda:page.evaluate('window.__SOURCE_HARNESS__.calls')
        initial=await calls()
        check('Abrir página não consulta ANEEL ou FUNAI/CMR',not any(c['path'] in ('aneelSiga.query','indeCatalog.layers') for c in initial))
        check('Página preserva cartões legados e IBGE',await page.get_by_test_id('ibge-source-card').count()==1 and await page.get_by_text('Terras Quilombolas',exact=True).count()==1)
        check('Aviso impede alegação de geometria precisa', 'datum/EPSG não declarado' in await card.inner_text())
        await card.get_by_role('button',name='Consultar ANEEL',exact=True).click()
        await card.get_by_text('registros, não usinas únicas',exact=False).wait_for()
        first=[c for c in await calls() if c['path']=='aneelSiga.query']
        check('Consulta explícita envia offset 0 e limite 20',len(first)==1 and first[0]['input']=={'offset':0,'limit':20})
        check('Registros duplicados por CEG são preservados',await card.get_by_text('TESTE.CEG.REPETIDO',exact=True).count()==2)
        check('Campo hostil é texto, não executa HTML',await card.locator('img').count()==0 and await page.evaluate('!window.__XSS__'))
        await page.evaluate('window.__SOURCE_HARNESS__.setMode("error")')
        await card.get_by_role('button',name='Atualizar dados',exact=True).click()
        await card.get_by_text('Dados antigos — não atualizados',exact=True).wait_for()
        after=[c for c in await calls() if c['path']=='aneelSiga.query']
        check('Atualizar dados reconsulta os mesmos parâmetros',len(after)==2 and after[0]['input']==after[1]['input'])
        check('Falha de refresh preserva resultados com rótulo antigo',await card.get_by_text('Usina sintética 1',exact=True).count()==1)
        await page.evaluate('window.__SOURCE_HARNESS__.setMode("ok")')
        await card.get_by_role('button',name='Atualizar dados',exact=True).click()
        await page.wait_for_function('window.__SOURCE_HARNESS__.calls.filter(c=>c.path==="aneelSiga.query").length===3')
        await page.wait_for_timeout(100)
        check('Retry manual recupera estado sem erro antigo',await card.get_by_text('Dados antigos — não atualizados',exact=True).count()==0)
        await card.get_by_role('button',name='Próxima',exact=True).click();await page.wait_for_timeout(100)
        check('Paginação explícita envia offset 20', [c for c in await calls() if c['path']=='aneelSiga.query'][-1]['input']['offset']==20)
        count_before=len([c for c in await calls() if c['path']=='aneelSiga.query'])
        await card.locator('#aneel-siga-uf').select_option('BA');await page.wait_for_timeout(100)
        check('Mudar filtro não dispara consulta automática',len([c for c in await calls() if c['path']=='aneelSiga.query'])==count_before)
        await card.get_by_role('button',name='Consultar ANEEL',exact=True).click();await page.wait_for_timeout(100)
        check('Filtro UF reseta offset e consulta somente após clique',[c for c in await calls() if c['path']=='aneelSiga.query'][-1]['input']=={'offset':0,'limit':20,'uf':'BA'})
        await funai.get_by_role('button',name='Verificar serviço FUNAI/CMR',exact=True).click();await page.wait_for_timeout(100)
        check('FUNAI reusa organização fixa existente',[c for c in await calls() if c['path']=='indeCatalog.layers'][-1]['input']['organizationId']=='inde-service-7780c680bcf29d1b')
        check('Nenhuma mutation, GetMap ou download no ensaio',not any(c['type']!='query' or c['path']=='indeCatalog.mapImage' or c['path'].startswith('baseLayers.download') for c in await calls()))
        await page.set_viewport_size({'width':393,'height':852});await page.wait_for_timeout(100)
        check('Layout de cartões não estoura o documento no celular',await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
        await page.screenshot(path=str(OUT/'COMPONENTES_MOBILE_SINTETICOS.png'),full_page=True)
        await page.evaluate('window.__SOURCE_HARNESS__.setActor(0)');await page.wait_for_timeout(150)
        check('Saída de identidade limpa resultados ANEEL e desabilita consulta',await card.get_by_role('button',name='Consultar ANEEL',exact=True).is_disabled() and await card.get_by_text('registros, não usinas únicas',exact=False).count()==0)
        check('Nenhum erro de runtime de página',not errors)
        (OUT/'HARNESS_VISUAL.json').write_text(json.dumps({'scope':'Componentes reais BaseLayers, fixtures sintéticas e tRPC em memória. Não é OAuth, banco, WMS/API real no navegador ou homologação produtiva. Rede externa bloqueada.','checks':checks,'calls':await calls(),'pageErrors':errors,'blockedExternalUrls':blocked},ensure_ascii=False,indent=2)+'\n')
        await browser.close()
        print('Ensaio visual aprovado:',len(checks),'checagens',flush=True)
if __name__=='__main__':
    log=open(OUT/'harness-vite.log','w')
    server=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'--config','vite.funai-aneel-harness.config.ts'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    try:
        for _ in range(60):
            if server.poll() is not None:raise RuntimeError('Vite encerrou; verificar log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:4195/funai-aneel-harness.html',timeout=1) as response:
                    if response.status==200:break
            except Exception:time.sleep(0.3)
        else:raise RuntimeError('Laboratório não iniciou')
        print('Laboratório pronto em loopback; iniciando Chromium offline',flush=True)
        asyncio.run(exercise())
    except Exception:
        (OUT/'HARNESS_VISUAL_FALHA.json').write_text(json.dumps({'checks':checks,'scope':'Falha de ensaio local; não houve produção'},ensure_ascii=False,indent=2)+'\n');raise
    finally:
        os.killpg(server.pid,signal.SIGTERM)
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(server.pid,signal.SIGKILL);server.wait()
        log.close();print('Servidor local encerrado',flush=True)
