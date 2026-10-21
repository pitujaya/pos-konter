const http=require('http');
const fs=require('fs');
const path=require('path');
http.createServer((req,res)=>{
  let p=req.url.split('?')[0];
  if(p==='/') p='/index.html';
  let fp=path.join(__dirname,p);
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);res.end('404');return;}
    const ext=path.extname(fp);
    const m={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':m[ext]||'text/plain'});
    res.end(d);
  });
}).listen(8088,'0.0.0.0',()=>{console.log('ok');});
