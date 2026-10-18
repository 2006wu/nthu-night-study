import http from 'node:http';
import {randomBytes,createDecipheriv} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {nightStatus} from './night-status.mjs';
import {availability} from './availability.mjs';
import {parseNightRemainder} from './remainder.mjs';
import {weeklyService} from './weekly.mjs';
import {bookingService} from './booking.mjs';
import {cancellationService} from './cancellation.mjs';
import {deploymentConfig} from './deployment.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
const deployment=deploymentConfig();
const PORT=deployment.port;
const ORIGIN=deployment.origin;
const API='https://libsms.lib.nthu.edu.tw/RWDAPI_New';
const IDP='https://idm.nthu.ust.edu.tw';
const ENTRY=IDP+'/openid/886UST_NTHU/authorize/?client_id=227897&response_type=code&redirect_uri=https://libsms.lib.nthu.edu.tw/openidcallback.aspx&state=RWD&scope=openid';
const sessions=new Map();
const allowedHosts=new Set(['idm.nthu.ust.edu.tw','libsms.lib.nthu.edu.tw']);
const decode=s=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
function attrs(tag) {const o={};for(const m of tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g))o[m[1]]=decode(m[2]);return o;}
function loginForm(html) {
  const form=html.match(/<form\b[^>]*(?:id\s*=\s*["']form1["']|name\s*=\s*["']form1["'])[^>]*>([\s\S]*?)<\/form>/i);
  if(!form)throw new Error('官方登入頁格式變更，暫時無法登入');
  const fields={};for(const input of form[1].matchAll(/<input\b[^>]*>/gi)){const a=attrs(input[0]);if(a.type==='hidden'&&a.name)fields[a.name]=a.value||'';}
  const image=form[1].match(/<img\b[^>]*id=["']captcha_img["'][^>]*>/i);
  if(!image||!fields.csrfmiddlewaretoken)throw new Error('無法取得官方驗證碼');
  return {fields,action:new URL(attrs(form[0].split('>')[0]).action,IDP).href,image:new URL(attrs(image[0]).src,IDP).href};
}
class RemoteSession {
  cookies=[];
  async request(url,{method='GET',body,headers={}}={},redirects=0) {
    const u=new URL(url);
    if(u.protocol!=='https:'||!allowedHosts.has(u.hostname)||redirects>12)throw new Error('官方登入轉址超出預期範圍');
    const cookies=this.cookies.filter(c=>(u.hostname===c.domain||u.hostname.endsWith('.'+c.domain))&&u.pathname.startsWith(c.path)).map(c=>`${c.name}=${c.value}`).join('; ');
    const r=await fetch(u,{method,body,redirect:'manual',signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0 NTHU-Private-Seat-Viewer/0.1',...(cookies?{Cookie:cookies}:{}),...headers}});
    for(const raw of r.headers.getSetCookie()){
      const [pair,...parts]=raw.split(';');const split=pair.indexOf('=');const c={name:pair.slice(0,split),value:pair.slice(split+1),domain:u.hostname,path:'/'};
      for(const part of parts){const [k,...v]=part.trim().split('=');if(k.toLowerCase()==='domain')c.domain=v.join('=').replace(/^\./,'');if(k.toLowerCase()==='path')c.path=v.join('=');}
      if(!(u.hostname===c.domain||u.hostname.endsWith('.'+c.domain)))continue;
      this.cookies=this.cookies.filter(old=>!(old.name===c.name&&old.domain===c.domain&&old.path===c.path));this.cookies.push(c);
    }
    if([301,302,303,307,308].includes(r.status)&&r.headers.get('location')){
      const next=new URL(r.headers.get('location'),u).href;await r.arrayBuffer();
      return this.request(next,[307,308].includes(r.status)?{method,body,headers}:{},redirects+1);
    }
    if(!r.ok)throw new Error(`官方服務暫時無法回應（${r.status}）`);
    return r;
  }
}
async function prepare(s) {
  s.weekly=null;s.remote=new RemoteSession();s.auth=null;s.userId=null;s.offers=null;s.drafts=null;s.cancelOffers=null;s.cancelDrafts=null;
  const r=await s.remote.request(ENTRY);const html=await r.text();
  s.form=loginForm(html);s.loginURL=r.url;
  const image=await s.remote.request(s.form.image);s.captcha=Buffer.from(await image.arrayBuffer());s.captchaType=image.headers.get('content-type')||'image/png';s.challengeAt=Date.now();
  return {captcha:`data:${s.captchaType};base64,${s.captcha.toString('base64')}`};
}
async function api(s,name,params={},withAuth=true) {
  const u=new URL(API+'/'+name);for(const [k,v]of Object.entries({...params,...(withAuth?s.auth:{}),restype:'json'}))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));
  const r=await s.remote.request(u.href);let data;try{data=JSON.parse(await r.text());}catch{throw new Error('官方回傳非預期資料，請稍後再試');}
  const first=Array.isArray(data)?data[0]:data;
  if(['3','4'].includes(String(first?.rescode))){s.auth=null;throw Object.assign(new Error('官方登入已過期，請重新登入'),{officialRejected:true});}
  if(String(first?.rescode)!=='1')throw Object.assign(new Error(String(first?.resmsg||'官方查詢失敗')),{officialRejected:true});
  return data;
}
let remainderCache={at:0,value:null};
async function currentRemainder() {
  if(remainderCache.value&&Date.now()-remainderCache.at<60000)return remainderCache.value;
  const remote=new RemoteSession();
  const config=await(await remote.request('https://libsms.lib.nthu.edu.tw/build/config.js')).text();
  const account=config.match(/DEVICE_AUTH_ACC:\s*"([^"]+)"/)?.[1];
  const password=config.match(/DEVICE_AUTH_PASS:\s*"([^"]+)"/)?.[1];
  if(!account||!password)throw new Error('官方裝置設定格式已變更');
  const session={remote};
  const device=await api(session,'DeviceAuth.aspx',{account,password},false);
  const sid=device[0]?.resdata?.[0]?.sid;
  if(!sid)throw new Error('無法取得官方目前空位');
  const value=parseNightRemainder(await api(session,'GetRemainderSpace.aspx',{sid},false));
  remainderCache={at:Date.now(),value:{...value,updatedAt:new Date().toISOString()}};
  return remainderCache.value;
}
async function login(s,body) {
  if(!s.form||Date.now()-s.challengeAt>5*60000)throw new Error('驗證碼已過期，請重新取得');
  s.attempts=s.attempts.filter(t=>Date.now()-t<10*60000);
  if(s.attempts.length>=5)throw new Error('已嘗試登入 5 次，請等待 10 分鐘後再試');
  if(!body.account||!body.password)throw new Error('請輸入帳號與密碼');
  let code=String(body.captcha||'').trim();
  if(!/^[A-Za-z0-9]{4}$/.test(code))throw new Error('請輸入 4 碼驗證碼');
  const fields=new URLSearchParams({...s.form.fields,username:String(body.account),password:String(body.password),captcha_value:code});
  s.attempts.push(Date.now());s.form=null;
  const r=await s.remote.request(IDP+'/sso/886UST_NTHU/oidc/login/',{method:'POST',body:fields.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded',Referer:s.loginURL,Origin:IDP}});
  const html=await r.text();
  let raw=r.url.match(/\/checkopenid\/([a-fA-F0-9]+)/)?.[1];
  if(!raw)raw=html.match(/checkopenid\/([a-fA-F0-9]+)/)?.[1];
  if(!raw){
    try {s.form=loginForm(html);s.loginURL=r.url;const image=await s.remote.request(s.form.image);s.captcha=Buffer.from(await image.arrayBuffer());s.captchaType=image.headers.get('content-type')||'image/png';s.challengeAt=Date.now();}catch{}
    throw new Error('登入未成功：請確認帳密與驗證碼；可重新取得驗證碼再試。');
  }
  // 使用官方前端相同的 SSO 回傳解碼流程；僅處理官方登入成功後的回傳。
  const key=Buffer.alloc(24);Buffer.from('(055)2813338microprogram').copy(key);
  const decipher=createDecipheriv('des-ede3-cbc',key,Buffer.alloc(8));
  let values;try{values=Buffer.concat([decipher.update(Buffer.from(raw,'hex')),decipher.final()]).toString('utf8').split('&');}catch{throw new Error('官方登入回傳格式已變更');}
  if(values.length!==5||!values[0])throw new Error('官方登入回傳資料不完整');
  // 裝置認證的設定值來自官方公開 config.js，並非使用者帳密。
  const config=await(await s.remote.request('https://libsms.lib.nthu.edu.tw/build/config.js')).text();
  const account=config.match(/DEVICE_AUTH_ACC:\s*"([^"]+)"/)?.[1];const password=config.match(/DEVICE_AUTH_PASS:\s*"([^"]+)"/)?.[1];
  if(!account||!password)throw new Error('官方裝置設定格式已變更');
  const device=await api(s,'DeviceAuth.aspx',{account,password},false);
  s.auth={sid:device[0].resdata[0].sid,authid:values[0]};s.userId=values[3];s.authAt=Date.now();s.captcha=null;s.bookingUncertain=false;s.cancelUncertain=null;
  await api(s,'GetCanBookSpaceType.aspx');
  return {authenticated:true};
}
async function query(s,body) {
  if(!s.auth)throw new Error('請先登入官方系統');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'')||!/^([01]\d|2[0-3]):[03]0$/.test(body.time||''))throw new Error('請選擇日期與半小時刻度的開始時間');
  const requested=`${body.date}T${body.time}`;
  const target=Date.parse(requested+':00+08:00');
  if(!Number.isFinite(target)||target<Date.now()-1800000)throw new Error('請選擇目前或未來的開始時間');
  const params=(await api(s,'GetParams.aspx',{spacetype:8}))[0].resdata?.[0];
  // 午夜後的時間可能屬於前一晚。兩個營業日都查詢，之後按真正日期合併。
  const day=new Date(body.date+'T12:00:00+08:00');const dates=[body.date];
  if(Number(body.time.slice(0,2))<12){day.setUTCDate(day.getUTCDate()-1);dates.unshift(day.toISOString().slice(0,10));}
  const all=[];const warnings=[];
  for(const date of dates){try{const fetched=await nightStatus(api,s,date);warnings.push(...fetched.warnings);for(const data of fetched.payloads){const normalized=availability(data,requested);for(const r of normalized.results)r.businessDate=date;all.push(normalized);}}catch(e){if(!s.auth)throw e;warnings.push(`${date}：${e.message}`);}}
  if(!all.length)throw new Error(warnings.join('；')||'無法讀取座位');
  const unique=new Map();for(const a of all)for(const r of a.results){const k=`${r.seat}/${r.start}/${r.end}`;unique.set(k,r);}
  const results=[...unique.values()].sort((a,b)=>Number(b.availableAtStart)-Number(a.availableAtStart)||a.waitMinutes-b.waitMinutes||b.minutes-a.minutes||a.seat.localeCompare(b.seat));
  const aSeatMap=new Map();for(const a of all)for(const seat of a.aSeats){const previous=aSeatMap.get(seat.seat);if(!previous||seat.onlineAvailable||previous.message==='官方未提供此時段狀態')aSeatMap.set(seat.seat,seat);}
  s.offers=new Map();for(const r of results){if(!/^\d+$/.test(r.deviceid))continue;const id=randomBytes(16).toString('hex');s.offers.set(id,{...r,at:Date.now()});r.offerId=id;}
  return {results,aSeats:[...aSeatMap.values()].sort((a,b)=>a.seat.localeCompare(b.seat)),seats:Math.max(...all.map(x=>x.seats)),requested,updatedAt:new Date().toISOString(),warnings,params:params?{bookrealeasedays:params.bookrealeasedays}:null};
}
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
const booking=bookingService(api);
const weekly=weeklyService(api);
const cancellation=cancellationService(api);
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.method==='GET'&&req.url==='/healthz'){respond(res,200,{ok:true});return;}
  if(req.headers.host!==deployment.host){respond(res,403,{error:'網址不符'});return;}
  if(deployment.production&&req.headers['x-forwarded-proto']!=='https'){res.writeHead(308,{Location:ORIGIN+req.url});res.end();return;}
  if(req.method==='POST'&&(req.headers.origin!==ORIGIN||!String(req.headers['content-type']).startsWith('application/json'))){respond(res,403,{error:'來源驗證失敗'});return;}
  let id=req.headers.cookie?.split(/;\s*/).find(part=>part.startsWith(deployment.cookieName+'='))?.slice(deployment.cookieName.length+1);
  if(!/^[a-f0-9]{48}$/.test(id||'')||!sessions.has(id)){id=randomBytes(24).toString('hex');sessions.set(id,{attempts:[],last:Date.now()});res.setHeader('Set-Cookie',`${deployment.cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/${deployment.cookieFlags}`);}
  const s=sessions.get(id);s.last=Date.now();
  const path=new URL(req.url,ORIGIN).pathname;
  try{
    if(req.method==='GET'&&path==='/api/status'){respond(res,200,{authenticated:!!s.auth,busy:!!s.busy,version:'0.7.2'});return;}
    if(req.method==='GET'&&path==='/api/remainder'){respond(res,200,await currentRemainder());return;}
    if(req.method==='POST'&&path.startsWith('/api/')){
      if(s.busy){respond(res,409,{error:'上一個操作仍在執行，請稍候'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)throw new Error('輸入資料過長');}const body=JSON.parse(raw||'{}');s.busy=true;
      try{
        if(path==='/api/challenge')respond(res,200,await prepare(s));
        else if(path==='/api/login')respond(res,200,await login(s,body));
        else if(path==='/api/query')respond(res,200,await query(s,body));
        else if(path==='/api/weekly/preview')respond(res,200,await weekly.preview(s,body));
        else if(path==='/api/weekly/confirm')respond(res,200,await weekly.confirm(s,body));
        else if(path==='/api/booking/preview')respond(res,200,await booking.preview(s,body));
        else if(path==='/api/booking/confirm')respond(res,200,await booking.confirm(s,body));
        else if(path==='/api/booking/list')respond(res,200,await cancellation.list(s));
        else if(path==='/api/cancellation/preview')respond(res,200,await cancellation.preview(s,body));
        else if(path==='/api/cancellation/confirm')respond(res,200,await cancellation.confirm(s,body));
        else if(path==='/api/logout'){s.weekly=null;s.auth=null;s.userId=null;s.offers=null;s.drafts=null;s.cancelOffers=null;s.cancelDrafts=null;s.remote=null;s.form=null;s.captcha=null;respond(res,200,{authenticated:false});}
        else respond(res,404,{error:'找不到功能'});
      }finally{s.busy=false;}
      return;
    }
    const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/frog.js':['frog.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
    if(req.method==='GET'&&files[path]){const [file,type]=files[path];res.writeHead(200,{'Content-Type':type});res.end(await readFile(ROOT+file));return;}
    respond(res,404,{error:'找不到頁面'});
  }catch(e){respond(res,400,{error:e.name==='TimeoutError'?'官方網站回應逾時，請稍後再試':e.message||'操作失敗',...(path==='/api/login'?{challengeReusable:!!s.form,captcha:s.form&&s.captcha?`data:${s.captchaType};base64,${s.captcha.toString('base64')}`:null}:{})});}
});
setInterval(()=>{for(const[id,s]of sessions)if(!s.busy&&Date.now()-s.last>30*60000)sessions.delete(id);},60000).unref();
server.listen(PORT,deployment.listen,()=>console.log(`夜讀空位查詢已啟動：${ORIGIN}`));
