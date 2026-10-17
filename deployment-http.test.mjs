import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
test('雲端 HTTP：直接開啟、HTTPS cookie 與跨站阻擋',async()=>{
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('.',import.meta.url)),env:{...process.env,NODE_ENV:'production',PORT:String(port),PUBLIC_ORIGIN:'https://example.onrender.com',APP_ACCESS_PASSWORD:'integration-test-only'},stdio:['ignore','pipe','pipe']});
  try{
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('server startup timeout')),5000);timer.unref();})]);
    const request=(path,options={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path,...options},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(options.body);});
    const headers={Host:'example.onrender.com','X-Forwarded-Proto':'https'};
    assert.equal((await request('/healthz')).status,200);
    const page=await request('/',{headers});assert.equal(page.status,200);assert.equal(page.headers['www-authenticate'],undefined);assert.match(page.headers['set-cookie'][0],/^__Host-seat_session=.*HttpOnly; SameSite=Strict; Path=\/; Secure$/);
    const redirect=await request('/',{headers:{...headers,'X-Forwarded-Proto':'http'}});assert.equal(redirect.status,308);assert.equal(redirect.headers.location,'https://example.onrender.com/');
    const rejected=await request('/api/booking/list',{method:'POST',headers:{...headers,Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'});assert.equal(rejected.status,403);
    const allowed=await request('/api/booking/list',{method:'POST',headers:{...headers,Origin:'https://example.onrender.com','Content-Type':'application/json'},body:'{}'});assert.equal(allowed.status,400);assert.match(JSON.parse(allowed.text).error,/登入/);
  }finally{child.kill();await once(child,'exit');}
});
