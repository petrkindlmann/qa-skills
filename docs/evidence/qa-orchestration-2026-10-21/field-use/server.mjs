import http from 'node:http';
import {quote} from './quote.mjs';
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.method==='GET' && req.url==='/health'){res.end(JSON.stringify({status:'ready'}));return;}
  if(req.method==='POST' && req.url==='/quote'){
    try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new Error('Body too large');}const data=JSON.parse(body);res.end(JSON.stringify(quote(data.subtotal,data.method)));}
    catch(error){res.statusCode=400;res.end(JSON.stringify({error:'Invalid quote input'}));}
    return;
  }
  res.statusCode=404;res.end(JSON.stringify({error:'Not found'}));
});
server.listen(Number(process.env.PORT||4179),'127.0.0.1',()=>console.log('Parcel Desk ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
