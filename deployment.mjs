import {createHash,timingSafeEqual} from 'node:crypto';

export function deploymentConfig(env=process.env){
  const production=env.NODE_ENV==='production'||env.RENDER==='true';
  const port=Number(env.PORT||4317);
  const rawOrigin=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||(!production?`http://127.0.0.1:${port}`:'');
  if(!rawOrigin)throw new Error('雲端部署需設定 PUBLIC_ORIGIN 或 RENDER_EXTERNAL_URL');
  const url=new URL(rawOrigin);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PUBLIC_ORIGIN 必須是完整網站網址，不含路徑或帳密');
  if(production&&url.protocol!=='https:')throw new Error('雲端網址必須使用 HTTPS');
  if(!production&&url.protocol!=='http:')throw new Error('本機模式請使用 HTTP');
  if(production&&!env.APP_ACCESS_PASSWORD)throw new Error('請先設定 APP_ACCESS_PASSWORD 網站入口密碼');
  const authorization=env.APP_ACCESS_PASSWORD?'Basic '+Buffer.from(`owner:${env.APP_ACCESS_PASSWORD}`).toString('base64'):null;
  const expected=authorization?createHash('sha256').update(authorization).digest():null;
  return{production,port,origin:url.origin,host:url.host,listen:production?'0.0.0.0':'127.0.0.1',cookieName:production?'__Host-seat_session':'seat_session',cookieFlags:production?'; Secure':'',authorized(header){if(!expected)return true;const actual=createHash('sha256').update(String(header||'')).digest();return timingSafeEqual(actual,expected);}};
}
