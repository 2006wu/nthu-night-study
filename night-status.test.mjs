import test from 'node:test';
import assert from 'node:assert/strict';
import {nightStatus} from './night-status.mjs';
test('全區已有A不額外查詢；不修改原本查詢參數',async()=>{const calls=[];const api=async(s,name,p)=>{calls.push(p);return{deviceinfo:[{zoneid:'8_4A'}]};};const r=await nightStatus(api,{auth:{}},'2099-10-18');assert.equal(r.payloads.length,1);assert.deepEqual(calls,[{spacetype:8,sdate:'20991018',zoneid:null}]);});
test('全區沒有A時以正常讀者查詢明確要求A',async()=>{const calls=[];const s={auth:{sid:'test'}};const api=async(session,name,p)=>{assert.equal(session,s);assert.equal(name,'GetAllBookStatus.aspx');calls.push(p);return{deviceinfo:p.zoneid?[{zoneid:'8_4A'}]:[{zoneid:'8_4B'}]};};const r=await nightStatus(api,s,'2099-10-18');assert.equal(r.payloads.length,2);assert.equal(calls[1].zoneid,'8_4A');});
test('A查詢拒絕保留其他區資料；登入失效則中止',async()=>{for(const expired of [false,true]){const s={auth:{}};const api=async(s,name,p)=>{if(!p.zoneid)return{deviceinfo:[]};if(expired)s.auth=null;throw new Error('無法查詢');};if(expired)await assert.rejects(()=>nightStatus(api,s,'2099-10-18'));else{const r=await nightStatus(api,s,'2099-10-18');assert.equal(r.payloads.length,1);assert.match(r.warnings[0],/A 區/);}}});
