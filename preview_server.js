// Tiny static server for previewing the app live in the Browser pane.
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname, PORT=8000;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  let rel=decodeURIComponent(req.url.split('?')[0]);
  if(rel==='/'||rel==='')rel='/layi_dashboard.html';
  const file=path.join(ROOT,rel.replace(/^\/+/,''));
  if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(file,(e,d)=>{
    if(e){res.writeHead(404);return res.end('not found');}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(file).toLowerCase()]||'application/octet-stream'});
    res.end(d);
  });
}).listen(PORT,()=>console.log('Preview server running at http://localhost:'+PORT+'/  (serving layi_dashboard.html)'));
