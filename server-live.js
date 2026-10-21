const http=require('http');
const fs=require('fs');
const path=require('path');
http.createServer((req,res)=>{
  let p=req.url.split('?')[0];
  if(p==='/') p='/index.html';
  let fp=path.join(__dirname,p);
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);res.end();return;}
    const ext=path.extname(fp);
    const map={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
    res.writeHead(200,{'Content-Type':map[ext]||'text/plain'});
    res.end(d);
  });
}).listen(8082,()=>{console.log('live',8082);});
