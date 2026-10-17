import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyService,chooseSeats,taipeiDate,reservationBounds} from './weekly.mjs';
const start=Date.parse('2099-10-17T12:00:00+08:00');
const a={seat:'M001',deviceid:'1'},b={seat:'M002',deviceid:'2'},c={seat:'M003',deviceid:'3'};
test('七天優先同座位，收藏只在換位次數相同時優先',()=>{const options=[[a,b],[a,b],[a],[a,b],[a,b],[a,b],[a,b]];assert.deepEqual(chooseSeats(options,['M002']).map(x=>x.seat),Array(7).fill('M001'));});
test('無共同座位時最少換位；缺日保留空白',()=>{assert.deepEqual(chooseSeats([[a,b],[b],[],[b,c],[c]]).map(x=>x?.seat),['M002','M002',undefined,'M002','M003']);});
function setup(mode='success'){
  let time=start;const calls=[];
  const s={auth:{},userId:'self',authAt:start};
  const api=async(s,name,p)=>{
    calls.push({name,p});
    if(name==='GetBookInfo.aspx')return[{resdata:mode==='existing'?[{spacetype:8,userid:'self',usestatus:0,devname:'M001',deviceid:'1',bookedatetime:'20991017 21:00:00~23:59:59'}]:[]}];
    if(name==='GetParams.aspx')return[{resdata:[{oncecanbooktime:8}]}];
    if(name==='GetAllBookStatus.aspx'){
      const date=p.sdate;return{bookdate:Array(6).fill(date),booktime:Array.from({length:6},(_,i)=>`${21+Math.floor(i/2)}:${i%2?'30':'00'}~${21+Math.floor(i/2)}:${i%2?'59':'29'}`),deviceinfo:[{deviceid:'1',devicename:'M001',zoneid:'8_4B',canbook:Array(6).fill('1')}]};
    }
    if(name==='BookTimeSegQuery.aspx')return[{resdata:Array.from({length:6},(_,i)=>({bookdate:p.sdate,booktime:`${21+Math.floor(i/2)}:${i%2?'30':'00'}~${21+Math.floor(i/2)}:${i%2?'59':'29'}`,bookvalue:i,canbook:mode==='taken'?'0':'1'}))}];
    if(name==='BookAdd.aspx'){if(mode==='timeout')throw new Error('timeout');if(mode==='rejected')throw Object.assign(new Error('超過預約上限'),{officialRejected:true});return[{rescode:1}];}
    throw new Error('unexpected '+name);
  };
  return{s,calls,service:weeklyService(api,()=>time),setTime:t=>time=t};
}
test('依登入當天跨月份排七天，21:00至隔日00:00，預覽不送出',async()=>{
  const {s,calls,service}=setup();s.authAt=Date.parse('2099-10-29T08:00:00+08:00');const plan=await service.preview(s,{});
  assert.equal(plan.days.length,7);assert.equal(plan.days[6].date,'2099-11-04');assert.equal(taipeiDate(plan.days[6].end),'2099-11-05');assert.equal(plan.days[0].end-plan.days[0].start,10800000);assert.equal(calls.some(c=>c.name==='BookAdd.aspx'),false);
});
test('逐日重新檢查，六格時段，重送不會重複，不能跨 session 使用',async()=>{
  const {s,calls,service}=setup();const plan=await service.preview(s,{});
  await assert.rejects(()=>service.confirm(s,{token:plan.token,index:1}),/依序/);
  await assert.rejects(()=>service.confirm({auth:{},userId:'other'},{token:plan.token,index:0}),/重新查看/);
  for(let index=0;index<7;index++)await service.confirm(s,{token:plan.token,index});
  await service.confirm(s,{token:plan.token,index:0});
  const submits=calls.filter(c=>c.name==='BookAdd.aspx');assert.equal(submits.length,7);assert.equal(submits[0].p.booktime,'0,1,2,3,4,5');assert.equal(submits[0].p.userid,'self');
});
for(const mode of ['timeout','rejected','taken'])test(`${mode} 停止後續日期且不會重送`,async()=>{
  const {s,calls,service}=setup(mode);const plan=await service.preview(s,{});const result=await service.confirm(s,{token:plan.token,index:0});assert.equal(result.stopped,true);assert.equal(result.days[0].state,mode==='timeout'?'unknown':'failed');
  await assert.rejects(()=>service.confirm(s,{token:plan.token,index:0}));await assert.rejects(()=>service.confirm(s,{token:plan.token,index:1}));assert.equal(calls.filter(c=>c.name==='BookAdd.aspx').length,mode==='taken'?0:1);
});
test('過去的21點不改時段、未登入與過期都擋下',async()=>{
  const {s,calls,service,setTime}=setup();await assert.rejects(()=>service.preview({},{}),/登入/);setTime(start+10*3600000);const plan=await service.preview(s,{});assert.equal(plan.days[0].state,'unavailable');setTime(start+11*3600000);await assert.rejects(()=>service.confirm(s,{token:plan.token,index:1}),/過期/);assert.equal(calls.some(c=>c.name==='BookAdd.aspx'),false);
});

test('既有整晚預約不重複送出且優先維持座位',async()=>{
  const {s,service,calls}=setup('existing');const plan=await service.preview(s,{});assert.equal(plan.days[0].state,'existing');await assert.rejects(()=>service.confirm(s,{token:plan.token,index:0}),/依序/);await service.confirm(s,{token:plan.token,index:1});assert.equal(calls.filter(c=>c.name==='BookAdd.aspx').length,1);
});
test('既有預約時間支援午夜及完整結束日期',()=>{
  assert.equal(reservationBounds('20991017 21:00:00~23:59:59').end-reservationBounds('20991017 21:00:00~23:59:59').start,10800000);
  assert.equal(reservationBounds('2099/10/17 21:00:00~2099/10/18 00:00:00').end-reservationBounds('20991017 21:00:00~23:59:59').start,10800000);
  assert.throws(()=>reservationBounds('unknown'));
});
