import test from 'node:test';
import assert from 'node:assert/strict';
import {cancellationService} from './cancellation.mjs';
function setup(mode='success'){
  const calls=[];let rows=[{bookid:'b1',userid:'self',spacetype:'8',devname:'M154',zoneid:'8_4E',bookedatetime:'20991017 23:00:00~23:59:59',usestatus:'0'}];
  let clock=1000;
  const api=async(s,name,params)=>{calls.push({name,params});if(name==='GetBookInfo.aspx')return[{resdata:structuredClone(rows)}];if(name==='BookDel.aspx'){if(mode==='timeout')throw new Error('timeout');if(mode==='rejected')throw Object.assign(new Error('官方拒絕'),{officialRejected:true});rows=[];return[{rescode:'1'}];}throw new Error('unexpected');};
  return{service:cancellationService(api,()=>clock),s:{auth:{},userId:'self'},calls,setRows:value=>{rows=value;},getRows:()=>rows,advance:ms=>{clock+=ms;}};
}
async function draft(context){const list=await context.service.list(context.s);return context.service.preview(context.s,{cancelId:list.reservations[0].cancelId});}
test('只列登入者本人的夜讀區預約，已簽到不提供取消',async()=>{const c=setup();c.setRows([...c.getRows(),{...c.getRows()[0],bookid:'b2',userid:'other'},{...c.getRows()[0],bookid:'b3',spacetype:'2'},{...c.getRows()[0],bookid:'b4',usestatus:'2'}]);const list=await c.service.list(c.s);assert.equal(list.reservations.length,2);assert.equal(list.reservations[1].canCancel,false);assert.equal(list.reservations.some(r=>'bookid'in r||'userid'in r),false);});
test('預覽不取消；確認取消一次；重複確認回傳相同結果',async()=>{const c=setup();const d=await draft(c);assert.equal(c.calls.some(x=>x.name==='BookDel.aspx'),false);await c.service.confirm(c.s,{token:d.token});await c.service.confirm(c.s,{token:d.token});assert.deepEqual(c.calls.filter(x=>x.name==='BookDel.aspx'),[{name:'BookDel.aspx',params:{bookid:'b1'}}]);});
test('不能使用偽造識別碼或別人工作階段的確認碼',async()=>{const c=setup();await assert.rejects(()=>c.service.preview(c.s,{cancelId:'b1'}));const d=await draft(c);await assert.rejects(()=>c.service.confirm({auth:{},userId:'other'},{token:d.token}));assert.equal(c.calls.some(x=>x.name==='BookDel.aspx'),false);});
test('確認前重查：已簽到、消失、內容變動皆不取消',async()=>{for(const mode of ['status','absent','changed']){const c=setup();const d=await draft(c);c.setRows(mode==='absent'?[]:c.getRows().map(r=>({...r,...(mode==='status'?{usestatus:'2'}:{bookedatetime:'different'})})));await assert.rejects(()=>c.service.confirm(c.s,{token:d.token}));assert.equal(c.calls.some(x=>x.name==='BookDel.aspx'),false);}});
test('確認碼過期不得取消',async()=>{const c=setup();const d=await draft(c);c.advance(121000);await assert.rejects(()=>c.service.confirm(c.s,{token:d.token}),/過期/);assert.equal(c.calls.some(x=>x.name==='BookDel.aspx'),false);});
test('逾時不重送，也阻止同一預約的其他確認碼',async()=>{const c=setup('timeout');const d1=await draft(c),d2=await draft(c);await assert.rejects(()=>c.service.confirm(c.s,{token:d1.token}),/未收到明確結果/);await assert.rejects(()=>c.service.confirm(c.s,{token:d1.token}));await assert.rejects(()=>c.service.confirm(c.s,{token:d2.token}),/未確認/);assert.equal(c.calls.filter(x=>x.name==='BookDel.aspx').length,1);});
test('官方拒絕不當作成功，也不重送',async()=>{const c=setup('rejected');const d=await draft(c);await assert.rejects(()=>c.service.confirm(c.s,{token:d.token}),/官方拒絕/);await assert.rejects(()=>c.service.confirm(c.s,{token:d.token}),/官方拒絕/);assert.equal(c.calls.filter(x=>x.name==='BookDel.aspx').length,1);});
