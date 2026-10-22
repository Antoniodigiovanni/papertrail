import { thumbnailChecks } from './thumbnail-browser-checks.mjs';
import { chromium, webkit } from 'playwright';
import { pdfStreamCompatibilityChecks } from './pdfjs-browser-checks.mjs';
import { libraryManagementChecks } from './library-browser-checks.mjs';
import { importLibraryChecks } from './import-browser-checks.mjs';
import { desktopLibraryChecks } from './desktop-library-checks.mjs';
import { paperRenameChecks } from './paper-rename-checks.mjs';
import { mobileLibraryChecks } from './mobile-library-checks.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readerPassages, textPdf } from '../dist/tests/tests/fixture.js';
import { assertPainted, assertPassageHighlight, desktopZoomChecks, mobileReaderChecks, readerEvidence, selectFixturePassage } from './reader-browser-checks.mjs';

await mkdir('test-results',{recursive:true});
await writeFile('test-results/reader-browser-evidence.jsonl','');
await writeFile('test-results/library-browser-evidence.jsonl','');
const data=await mkdtemp(path.resolve('test-results/browser-'));
const port=Number(process.env.SMOKE_PORT||3491),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['dist/server/index.js'],{env:{...process.env,AUTH_MODE:'development',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:data,PUBLIC_ORIGIN:base},stdio:['ignore','pipe','pipe']});
let serverOutput='';server.stdout.on('data',b=>serverOutput+=b);server.stderr.on('data',b=>serverOutput+=b);
let browser;
const errors=[];
try{
  let started=false;
  for(let i=0;i<40;i++){
    try{if(server.exitCode===null&&serverOutput.includes(`Papertrail listening on 127.0.0.1:${port} (development)`)&&(await fetch(`${base}/healthz`)).ok){started=true;break;}}catch{}
    if(server.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!started)errors.push(`Live HTTP server could not start/reply:\n${serverOutput}`);
  try{browser=await (process.env.PAPERTRAIL_WEBKIT ? webkit : chromium).launch({headless:true});}catch(e){errors.push(`Browser could not launch:\n${e.message}`);}
  if(errors.length)throw new Error(errors.join('\n\n'));
  if (process.env.PAPERTRAIL_THUMBNAILS_ONLY) {
    await thumbnailChecks(browser,base);
  } else {
  if (!process.env.PAPERTRAIL_PDF_COMPAT_ONLY) {
    if (!process.env.PAPERTRAIL_RESPONSIVE_ONLY) {
      await thumbnailChecks(browser,base);
      await importLibraryChecks(browser,base);
      await libraryManagementChecks(browser,base);
    }
    await paperRenameChecks(browser,base);
    await desktopLibraryChecks(browser,base);
    await mobileLibraryChecks(browser,base);
  }
  if (!process.env.PAPERTRAIL_LIBRARY_ONLY && !process.env.PAPERTRAIL_RESPONSIVE_ONLY) {
  await pdfStreamCompatibilityChecks(browser,base);
  if (!process.env.PAPERTRAIL_PDF_COMPAT_ONLY) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  const favicon=await context.request.get(`${base}/favicon.svg`);assert.equal(favicon.status(),200);assert.match(favicon.headers()['content-type'],/image\/svg\+xml/);assert.match(await favicon.text(),/<svg/);
  await page.goto(base);assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/favicon.svg');await page.getByRole('heading',{name:'Your library',exact:true}).waitFor();
  const initialCopy = await page.locator('body').innerText();
  for (const decorative of ['Private library', 'Online-first · Saved on your server', 'COLLECT. CONNECT. UNDERSTAND.', 'Good ideas deserve a place to stay.', 'A little more understanding, every day.']) assert.equal(initialCopy.includes(decorative), false, `decorative copy removed: ${decorative}`);
  assert.equal(await page.getByRole('heading',{name:'Your library',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Add paper',exact:false}).count(),1);
  for(const name of ['Reading systems','Connected ideas']){
    page.once('dialog',dialog=>dialog.accept(name));await page.getByRole('button',{name:'New project',exact:true}).click();
    await page.getByRole('navigation',{name:'Projects',exact:true}).getByRole('button',{name,exact:true}).waitFor();
  }
  await page.getByRole('button',{name:'Add paper',exact:false}).first().click();
  await page.getByLabel('Upload PDF',{exact:true}).setInputFiles({name:'understanding.pdf',mimeType:'application/pdf',buffer:textPdf()});
  await page.getByRole('dialog').getByLabel('Reading systems',{exact:true}).check();
  await page.getByRole('dialog').getByLabel('Connected ideas',{exact:true}).check();
  await page.getByRole('button',{name:'Add to library',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  await page.locator('.paper-row.revealed').waitFor();
  assert.equal(new URL(page.url()).hash,'','upload stays in the library until the paper is opened');
  await page.locator('.paper-row.revealed .paper-open').click();
  const firstPage=page.locator('.pdf-page[data-page-number="1"]');await firstPage.locator('.textLayer span').first().waitFor();
  await page.getByLabel('General note',{exact:true}).fill('# A connection\n\nEvidence makes ideas stronger.');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.includes('Saved'));
  const paperId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('paper');assert.ok(paperId);
  await selectFixturePassage(page,readerPassages[0],'initial fit-width selection');
  await page.getByLabel('New highlight comment',{exact:true}).fill('A useful connection.');
  await page.getByRole('button',{name:'Save highlight',exact:true}).click();
  await firstPage.locator('.pdf-highlight').first().waitFor();
  await assertPassageHighlight(page);
  const geometry=await firstPage.locator('.pdf-highlight').first().evaluate(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height}));
  await page.getByLabel('PDF zoom',{exact:true}).selectOption('1.5');await assertPainted(page,1);await desktopZoomChecks(page);
  assert.deepEqual(await firstPage.locator('.pdf-highlight').first().evaluate(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height})),geometry);
  await page.getByLabel('Search within PDF',{exact:true}).fill('deeper reading');
  await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-find [role=status]')].some(el=>el.textContent?.includes('1/1')));
  await page.getByLabel('Clear PDF search',{exact:true}).click();
  await page.getByRole('button',{name:'Details',exact:true}).click();
  const paperUrl=`${base}/api/papers/${paperId}`;
  for (const name of ['evidence','reflection','revisit']) {
    await page.getByLabel('Add tag',{exact:true}).fill(name);
    await page.getByRole('button',{name:'Add tag',exact:true}).click();
    await page.getByRole('button',{name:`Remove tag ${name}`,exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.includes('Saved'));
  }
  const evidence=page.getByRole('button',{name:'Remove tag evidence',exact:true});
  const reflection=page.getByRole('button',{name:'Remove tag reflection',exact:true});
  const connected=page.getByLabel('Connected ideas',{exact:true});
  // Hold a real save response so checkbox behavior cannot depend on HTTP speed.
  // All following assignments queue behind it and must use the latest saved IDs.
  let releaseSave;
  const heldSave=new Promise(resolve=>{releaseSave=resolve;});
  const holdReadingSave=async route=>{
    if(route.request().method()!=='PATCH'||route.request().postDataJSON().status!=='Reading')return route.fallback();
    const response=await route.fetch();await heldSave;await route.fulfill({response});
  };
  await page.route(paperUrl,holdReadingSave);
  try{
    const readingRequest=page.waitForRequest(request=>request.url()===paperUrl&&request.method()==='PATCH'&&request.postDataJSON().status==='Reading');
    await page.getByLabel('Reading state',{exact:true}).selectOption('Reading');await readingRequest;
    await evidence.click();
    await page.getByRole('button',{name:'Add tag evidence',exact:true}).click();
    await reflection.click();
    await page.getByRole('button',{name:'Add tag reflection',exact:true}).click();
    await connected.uncheck();assert.equal(await connected.isChecked(),false);
    await connected.check();assert.equal(await connected.isChecked(),true);
    await evidence.waitFor(); await reflection.waitFor();
  }finally{releaseSave();}
  await page.waitForFunction(()=>document.querySelector('.save-state')?.textContent?.includes('Saved'));
  await page.unroute(paperUrl,holdReadingSave);
  await evidence.waitFor();await reflection.waitFor();assert.equal(await connected.isChecked(),true);
  const assignments=await(await context.request.get(paperUrl)).json();
  const labels=await(await context.request.get(`${base}/api/library`)).json();
  const expectedTags=labels.tags.filter(label=>['evidence','reflection','revisit'].includes(label.name)).map(label=>label.id).sort();
  assert.equal(expectedTags.length,3);assert.deepEqual([...assignments.tagIds].sort(),expectedTags);assert.equal(assignments.projectIds.length,2);assert.equal(assignments.status,'Reading');
  await page.getByRole('button',{name:'Remove tag revisit',exact:true}).waitFor();
  await page.getByRole('button',{name:'Toggle paper panel',exact:true}).click();
  await page.locator('.pdf-scroll').evaluate(root=>{const page=root.querySelector('[data-page-number="2"]');root.scrollTop+=page.getBoundingClientRect().top-root.getBoundingClientRect().top+page.clientHeight*.4;});
  await page.waitForTimeout(900);
  const serverPaper=await(await context.request.get(`${base}/api/papers/${paperId}`)).json();assert.equal(serverPaper.position.page,2);assert.ok(serverPaper.position.offset>.35);assert.equal(serverPaper.status,'Reading');assert.equal(serverPaper.projectIds.length,2);assert.equal(serverPaper.annotations[0].comment,'A useful connection.');
  await page.screenshot({path:'test-results/reader-desktop.png',fullPage:true});
  await page.reload();await firstPage.locator('.pdf-highlight').first().waitFor();
  await assertPassageHighlight(page);
  assert.deepEqual(await firstPage.locator('.pdf-highlight').first().evaluate(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height})),geometry);
  await page.getByRole('button',{name:'Details',exact:true}).click();
  for(const name of ['evidence','reflection','revisit'])await page.getByRole('button',{name:`Remove tag ${name}`,exact:true}).waitFor();
  for(const name of ['Reading systems','Connected ideas'])assert.equal(await page.getByLabel(name,{exact:true}).isChecked(),true,name);
  await page.getByRole('button',{name:'Highlights (1)',exact:true}).click();
  await page.locator('.highlight-card .passage').click();await page.getByLabel('Highlight comment page 1',{exact:true}).fill('Revised connection');
  await page.getByRole('button',{name:'Save highlight',exact:true}).click();await page.getByLabel('Highlight comment page 1',{exact:true}).waitFor();
  const other=await browser.newContext({viewport:{width:1366,height:900}});const otherPage=await other.newPage();
  await otherPage.goto(`${base}/#paper=${paperId}`);await otherPage.getByLabel('General note',{exact:true}).waitFor();assert.match(await otherPage.getByLabel('General note',{exact:true}).inputValue(),/Evidence makes ideas stronger/);
  const current=await(await context.request.get(`${base}/api/papers/${paperId}`)).json();
  await context.request.patch(`${base}/api/papers/${paperId}`,{data:{revision:current.revision,note:'Written on another device'}});
  await otherPage.getByLabel('General note',{exact:true}).fill('A stale local draft');await otherPage.getByRole('button',{name:'Save note',exact:true}).click();
  await otherPage.getByRole('button',{name:'Reload latest',exact:true}).waitFor();assert.match(await otherPage.locator('.save-state').innerText(),/Save error/);assert.equal(await otherPage.getByLabel('General note',{exact:true}).inputValue(),'A stale local draft');
  // A rejected assignment must roll back its optimistic checkbox and show failure.
  const tagsBeforeFailure=(await(await context.request.get(paperUrl)).json()).tagIds;
  const failurePage=await context.newPage();await failurePage.goto(`${base}/#paper=${paperId}`);
  await failurePage.getByRole('button',{name:'Details',exact:true}).click();
  let releaseFailure;
  const heldFailure=new Promise(resolve=>{releaseFailure=resolve;});
  await failurePage.route(paperUrl,async route=>{
    if(route.request().method()!=='PATCH'||!route.request().postDataJSON().tagIds)return route.fallback();
    await heldFailure;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Assignment storage unavailable'})});
  });
  const failedTag=failurePage.getByRole('button',{name:'Remove tag evidence',exact:true});
  try{await failedTag.click();await failurePage.getByRole('button',{name:'Add tag evidence',exact:true}).waitFor();}finally{releaseFailure();}
  await failurePage.getByRole('button',{name:'Reload latest',exact:true}).waitFor();
  await failedTag.waitFor();
  assert.match(await failurePage.locator('.save-state').innerText(),/Save error/);
  assert.match(await failurePage.getByRole('alert').innerText(),/Assignment storage unavailable/);
  assert.deepEqual((await(await context.request.get(paperUrl)).json()).tagIds,tagsBeforeFailure);
  await failurePage.close();
  await mobileReaderChecks(browser,base,context.request,serverPaper.annotations[0]);
  const libraryPage=await context.newPage();await libraryPage.goto(base);
  await libraryPage.getByLabel('Search library',{exact:true}).fill('Written on another device');await libraryPage.waitForFunction(() => { const rows = document.querySelectorAll('.paper-row'); return rows.length === 1 && rows[0].textContent.includes('The Architecture'); });
  await libraryPage.getByLabel('Search library',{exact:true}).fill('');await libraryPage.locator('.paper-open').first().click();await libraryPage.getByRole('button',{name:'Details',exact:true}).click();
  await libraryPage.getByRole('button',{name:'Archive paper',exact:true}).click();await libraryPage.getByRole('button',{name:'Permanently delete',exact:true}).waitFor();
  libraryPage.once('dialog',dialog=>dialog.accept());await libraryPage.getByRole('button',{name:'Permanently delete',exact:true}).click();await libraryPage.getByRole('heading',{name:'Your library',exact:true}).waitFor();
  assert.equal((await(await context.request.get(`${base}/api/library?scope=archive`)).json()).papers.length,0);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: real HTTP, PDF.js rendering and text selection, comment persistence, zoom, reload, search, notes, delayed/rapid label assignment and failure rollback, multi-context conflict, real CDP pinch/pan/cancel events, painted canvas/text redraw, offscreen virtualization, split mobile notes and responsive fit width, archive and confirmed deletion.');
  console.log('Screenshots: test-results/reader-desktop.png and reader-mobile-emulation.png. Physical devices were not tested.');
  console.log('Reader evidence: test-results/reader-browser-evidence.jsonl (selection geometry; native diagonal and independent bidirectional pan, scroll bounds, hit-target touch-action chain and event cancellation).');
  await other.close();await context.close();
  }
  }
  }
}catch(e){
  console.error(e.stack||e.message);process.exitCode=1;
  const pages=browser?.contexts().flatMap(context=>context.pages())||[];
  for(const [index,page] of pages.entries()){
    try{
      await readerEvidence(page,`failure page ${index}`);
      await page.screenshot({path:`test-results/reader-failure-${index}.png`});
    }catch(diagnosticError){console.error(`Could not collect browser failure evidence: ${diagnosticError.message}`);}
  }
}
finally{await browser?.close();server.kill('SIGTERM');await writeFile('test-results/browser-server.log',serverOutput);}
