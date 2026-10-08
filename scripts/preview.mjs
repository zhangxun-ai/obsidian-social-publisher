import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const base=process.cwd();
await build({entryPoints:['src/demo.ts'],bundle:true,platform:'browser',format:'esm',outfile:'dist/demo.js',target:'es2022'});
const port=Number(process.env.PUBLISHER_PREVIEW_PORT||4173);
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(path==='/favicon.ico'){res.statusCode=204;res.end();return;}
    const relative=path==='/'?'preview.html':path==='/demo.js'?'dist/demo.js':path.startsWith('/fixtures/')?`tests${path}`:path.slice(1);
    const target=resolve(base,relative);
    if(!target.startsWith(base+sep)||!['.html','.css','.js','.png'].includes(extname(target)))throw new Error();
    const data=await readFile(target);res.setHeader('Content-Type',({'.html':'text/html;charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png'})[extname(target)]);res.end(data);
  }catch{res.statusCode=404;res.end('Not found');}
});server.listen(port,'127.0.0.1',()=>console.log(`合成界面预览：http://127.0.0.1:${port}`));
