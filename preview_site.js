// Tiny static server for previewing the LAYI website (Downloads/Website) in the Browser pane.
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','Website'), PORT=8001;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
http.createServer((req,res)=>{
  let rel=decodeURIComponent(req.url.split('?')[0]);
  if(rel==='/'||rel==='')rel='/index.html';
  const file=path.join(ROOT,rel.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(file,(e,d)=>{
    if(e){res.writeHead(404);console.log('404 '+rel);return res.end('not found');}
    res.writeHead(200,{
      'Content-Type':TYPES[path.extname(file).toLowerCase()]||'application/octet-stream',
      // Never cache during development. Without this a phone holds onto an old
      // index.html and keeps requesting images that have since been renamed or
      // converted — which looks exactly like "the images are broken" when the
      // server is serving them perfectly.
      'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma':'no-cache',
      'Expires':'0'
    });
    res.end(d);
  });
}).listen(PORT,()=>console.log('Site preview running at http://localhost:'+PORT+'/  (serving '+ROOT+')'));
