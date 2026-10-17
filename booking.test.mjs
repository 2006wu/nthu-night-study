import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingService,selectedSlots} from './booking.mjs';
const start=Date.parse('2099-10-17T23:00:00+08:00'),half=1800000;
const rows=[{bookdate:'2099/10/17',booktime:'23:00~23:29',bookvalue:'22',canbook:'1'},{bookdate:'2099/10/17',booktime:'23:30~23:59',bookvalue:'23',canbook:'1'},{bookdate:'2099/10/18',booktime:'00:00~00:29',bookvalue:'24',canbook:'1'}];
function setup(mode='success'){
  const calls=[];let current=structuredClone(rows);
  const api=async(s,name,params)=>{calls.push({name,params});if(name==='BookTimeSegQuery.aspx')return[{resdata:current}];if(name==='GetParams.aspx')return[{resdata:[{oncecanbooktime:'8'}]}];if(name==='BookAdd.aspx'){if(mode==='timeout')throw new Error('timeout');if(mode==='rejected')throw Object.assign(new Error('已被預約'),{officialRejected:true});return[{rescode:'1',resmsg:'success'}];}throw new Error('unexpected endpoint');};
  const service=bookingService(api,()=>start-3600000);
  const s={auth:{},userId:'self-test',offers:new Map([['offer',{deviceid:'218',seat:'M154',zone:'E',businessDate:'2099-10-17',usableStart:start,end:start+3*half,at:start-3600000}]])};
  return{service,s,calls,change:fn=>{current=fn(current);}};
}
test('時段代碼正確跨午夜',()=>assert.deepEqual(selectedSlots(rows,start,start+3*half),['22','23','24']));
test('中間缺格及已被預約皆阻擋',()=>{assert.throws(()=>selectedSlots([rows[0],rows[2]],start,start+3*half));const changed=structuredClone(rows);changed[1].canbook='0';assert.throws(()=>selectedSlots(changed,start,start+3*half));});
test('預覽不送出；確認才送出；同一確認不重複建立',async()=>{const {service,s,calls}=setup();const draft=await service.preview(s,{offerId:'offer',start,end:start+3*half});assert.equal(calls.some(c=>c.name==='BookAdd.aspx'),false);await service.confirm(s,{token:draft.token});await service.confirm(s,{token:draft.token});const submits=calls.filter(c=>c.name==='BookAdd.aspx');assert.equal(submits.length,1);assert.equal(submits[0].params.userid,'self-test');assert.equal(submits[0].params.booktime,'22,23,24');assert.equal(submits[0].params.sdate,'2099/10/17');});
test('預覽後空位改變，確認時不送出',async()=>{const {service,s,calls,change}=setup();const draft=await service.preview(s,{offerId:'offer',start,end:start+3*half});change(rows=>rows.map(r=>({...r,canbook:'0'})));await assert.rejects(()=>service.confirm(s,{token:draft.token}),/不可預約/);assert.equal(calls.some(c=>c.name==='BookAdd.aspx'),false);});
test('逾時結果未知，不允許同一確認再次送出',async()=>{const {service,s,calls}=setup('timeout');const draft=await service.preview(s,{offerId:'offer',start,end:start+half});await assert.rejects(()=>service.confirm(s,{token:draft.token}),/未收到明確結果/);await assert.rejects(()=>service.confirm(s,{token:draft.token}),/未收到明確結果/);assert.equal(calls.filter(c=>c.name==='BookAdd.aspx').length,1);assert.equal(s.bookingUncertain,true);});
test('官方明確拒絕仍只送出一次',async()=>{const {service,s,calls}=setup('rejected');const draft=await service.preview(s,{offerId:'offer',start,end:start+half});await assert.rejects(()=>service.confirm(s,{token:draft.token}),/已被預約/);await assert.rejects(()=>service.confirm(s,{token:draft.token}),/已被預約/);assert.equal(calls.filter(c=>c.name==='BookAdd.aspx').length,1);assert.notEqual(s.bookingUncertain,true);});
test('不接受偽造座位、超過上限、非半小時與其他工作階段 token',async()=>{const {service,s}=setup();await assert.rejects(()=>service.preview(s,{offerId:'forged',start,end:start+half}));await assert.rejects(()=>service.preview(s,{offerId:'offer',start,end:start+9*3600000}));await assert.rejects(()=>service.preview(s,{offerId:'offer',start:start+1,end:start+half}));await assert.rejects(()=>service.confirm({auth:{},userId:'other'},{token:'forged'}));});

test('其他預約結果未知時，已建立的單日確認也不得送出',async()=>{const {service,s,calls}=setup();const draft=await service.preview(s,{offerId:'offer',start,end:start+half});s.bookingUncertain=true;await assert.rejects(()=>service.confirm(s,{token:draft.token}),/未確認/);assert.equal(calls.some(c=>c.name==='BookAdd.aspx'),false);});
