import test from 'node:test';
import assert from 'node:assert/strict';
import {deploymentConfig} from './deployment.mjs';
test('本機模式維持 loopback 與原有 cookie',()=>{const d=deploymentConfig({});assert.equal(d.listen,'127.0.0.1');assert.equal(d.origin,'http://127.0.0.1:4317');assert.equal(d.cookieName,'seat_session');});
test('雲端缺網址或 HTTPS 會拒絕啟動',()=>{assert.throws(()=>deploymentConfig({NODE_ENV:'production'}));assert.throws(()=>deploymentConfig({NODE_ENV:'production',PUBLIC_ORIGIN:'http://example.com',APP_ACCESS_PASSWORD:'test'}));});
test('Render 網址、Secure Cookie 與雲端監聽',()=>{const d=deploymentConfig({NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://example.onrender.com',APP_ACCESS_PASSWORD:'test',PORT:'10000'});assert.equal(d.host,'example.onrender.com');assert.equal(d.port,10000);assert.equal(d.listen,'0.0.0.0');assert.equal(d.cookieName,'__Host-seat_session');assert.equal(d.cookieFlags,'; Secure');});
test('雲端網址不得帶帳密、查詢、路徑',()=>{for(const value of ['https://user:secret@example.com','https://example.com/path','https://example.com/?secret=value'])assert.throws(()=>deploymentConfig({NODE_ENV:'production',PUBLIC_ORIGIN:value,APP_ACCESS_PASSWORD:'test'}));});
