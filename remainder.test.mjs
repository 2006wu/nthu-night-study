import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNightRemainder} from './remainder.mjs';

test('只取官方 A 區目前空位數量',()=>{
  const data=[{rescode:'1',resdata:[{zoneid:'8_4B',count:'20'},{zoneid:'8_4A',zonename:'4F-夜讀區A',count:'36'}]}];
  assert.deepEqual(parseNightRemainder(data),{zone:'A',name:'4F-夜讀區A',available:36});
});

test('缺少 A 區或數量異常時不猜測',()=>{
  assert.throws(()=>parseNightRemainder([{rescode:'1',resdata:[]}]),/未提供/);
  assert.throws(()=>parseNightRemainder([{rescode:'1',resdata:[{zoneid:'8_4A',count:'?'}]}]),/未提供/);
  assert.throws(()=>parseNightRemainder([{rescode:'4'}]),/格式已變更/);
});
