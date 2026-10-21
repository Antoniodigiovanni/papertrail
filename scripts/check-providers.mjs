import { importReference } from '../dist/server/providers.js';
for(const reference of ['1706.03762v7','10.1038/s41586-021-03819-2']){
  const started=Date.now();
  try{const result=await importReference(reference);console.log(JSON.stringify({reference,elapsedMs:Date.now()-started,title:result.meta.title,pdfBytes:result.pdf?.length||0,warning:result.warning||null}));}
  catch(e){console.error(JSON.stringify({reference,elapsedMs:Date.now()-started,error:e.message}));process.exitCode=1;}
}
