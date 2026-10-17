const TZ = '+08:00';
export function parseDate(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})[/-]?(\d{2})[/-]?(\d{2})/);
  if (!m) throw new Error('官方回傳的日期格式無法辨識');
  return `${m[1]}-${m[2]}-${m[3]}`;
}
export function slotBounds(date, time) {
  const m = String(time).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*[~～\-–]\s*(\d{1,2}):(\d{2})/);
  if (!m) throw new Error('官方回傳的時段格式無法辨識');
  const d = parseDate(date);
  const start = Date.parse(`${d}T${m[1].padStart(2,'0')}:${m[2]}:00${TZ}`);
  let end = Date.parse(`${d}T${m[3].padStart(2,'0')}:${m[4]}:00${TZ}`);
  // 官方以 17:00~17:29 表示一個完整半小時，輸出使用不含結束點的區間。
  if (end < start) end += 86400000;
  if (end - start === 29 * 60000) end += 60000;
  if (!Number.isFinite(start) || end <= start || end - start !== 1800000) throw new Error('官方時段不是預期的半小時，暫停計算以避免誤報');
  return {start,end};
}
export function availability(data, requested) {
  if (!Array.isArray(data.deviceinfo) || !Array.isArray(data.booktime) || !Array.isArray(data.bookdate)) throw new Error('官方資料結構已變更，請勿將本次結果當成空位');
  const target = Date.parse(`${requested}:00${TZ}`);
  if (!Number.isFinite(target)) throw new Error('請輸入有效日期與開始時間');
  const bounds = data.booktime.map((t,i)=>slotBounds(data.bookdate[i],t));
  const results=[],aSeats=[]; let seats=0;
  for (const device of data.deviceinfo) {
    const zone = String(device.zoneid || '').match(/(?:8_4)?([ABCDE])$/)?.[1];
    if (!zone) continue;
    seats++;
    if (!Array.isArray(device.canbook) || device.canbook.length !== bounds.length) throw new Error('座位時段資料不完整，請重新查詢');
    if(zone==='A'){
      const index=bounds.findIndex(b=>b.start<=target&&target<b.end);
      const raw=index<0?null:device.canbook[index];
      const reason=index<0?'':String(device.reason?.[index]||'');
      aSeats.push({seat:String(device.devicename),deviceid:String(device.deviceid||''),zone,onlineAvailable:String(raw)==='1',message:index<0?'官方未提供此時段狀態':String(raw)==='1'?'可網路預約':reason&&!/^\d+$/.test(reason)?reason:'官方未開放此時段網路預約'});
    }
    let range=null; const runs=[];
    bounds.forEach((b,i)=>{
      if (String(device.canbook[i]) === '1') {
        if (range && range.end === b.start) range.end=b.end;
        else {range={...b};runs.push(range);}
      } else range=null;
    });
    for (const run of runs) {
      if (run.end<=target) continue;
      const usableStart=Math.max(run.start,target);
      results.push({seat:String(device.devicename),deviceid:String(device.deviceid||''),zone,start:run.start,end:run.end,usableStart,availableAtStart:run.start<=target && target<run.end,minutes:(run.end-usableStart)/60000,waitMinutes:Math.max(0,(run.start-target)/60000),bookingEnd:Math.min(run.end,usableStart+8*3600000)});
    }
  }
  results.sort((a,b)=>Number(b.availableAtStart)-Number(a.availableAtStart)||a.waitMinutes-b.waitMinutes||b.minutes-a.minutes||a.seat.localeCompare(b.seat));
  return {results,aSeats,seats,requested,target,coverage:bounds.length?{start:Math.min(...bounds.map(b=>b.start)),end:Math.max(...bounds.map(b=>b.end))}:null};
}
