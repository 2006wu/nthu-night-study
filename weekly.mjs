import {randomBytes} from 'node:crypto';
import {nightStatus} from './night-status.mjs';
import {availability} from './availability.mjs';
import {selectedSlots} from './booking.mjs';
const DAY=86400000,HOUR=3600000;
export const taipeiDate=ms=>new Date(ms+8*HOUR).toISOString().slice(0,10);
// Minimize seat changes across all seven nights; favorites break ties only.
export function chooseSeats(options,favorites=[]){
  let paths=[{cost:0,rows:[],last:null}];
  for(const seats of options){
    if(!seats.length){paths=paths.map(p=>({...p,rows:[...p.rows,null]}));continue;}
    paths=seats.map(seat=>{
      let best;
      for(const p of paths){const candidate={cost:p.cost+(p.last&&p.last!==seat.seat?100:0)+(favorites.includes(seat.seat)?0:1),rows:[...p.rows,seat],last:seat.seat};if(!best||candidate.cost<best.cost)best=candidate;}
      return best;
    });
  }
  return paths.sort((a,b)=>a.cost-b.cost)[0].rows;
}
export function reservationBounds(value){
  const m=String(value).match(/^(\d{4})[/-]?(\d{2})[/-]?(\d{2})\s+(\d{1,2}:\d{2})(?::(\d{2}))?\s*[~～]\s*(?:(\d{4})[/-]?(\d{2})[/-]?(\d{2})\s+)?(\d{1,2}:\d{2})(?::(\d{2}))?$/);
  if(!m)throw new Error('既有預約時間格式無法辨識，請先查看官方現況');
  const date=`${m[1]}-${m[2]}-${m[3]}`;
  const start=Date.parse(`${date}T${m[4].padStart(5,'0')}:${m[5]||'00'}+08:00`);
  let end=Date.parse(`${m[6]?`${m[6]}-${m[7]}-${m[8]}`:date}T${m[9].padStart(5,'0')}:${m[10]||'00'}+08:00`);
  if(!m[6]&&end<start)end+=DAY;
  // Official ranges end inclusively at xx:29:59 / xx:59:59.
  if(m[10]==='59')end+=1000;else if(!m[10]&&/[25]9$/.test(m[9]))end+=60000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('既有預約時間無效，請先查看官方現況');
  return{start,end};
}
export function weeklyService(api,now=()=>Date.now()){
  function auth(s){if(!s.auth||!s.userId)throw new Error('請先登入');if(s.bookingUncertain)throw new Error('上次預約結果未確認，請先查看官方現況，再重新登入');}
  function view(batch){return{token:batch.token,startDate:batch.startDate,expires:batch.expires,stopped:batch.stopped,days:batch.days.map(({date,start,end,seat,zone,state,message})=>({date,start,end,seat,zone,state,message}))};}
  return{
    async preview(s,body={}){
      auth(s);
      const startDate=taipeiDate(s.authAt||now());
      const first=Date.parse(startDate+'T21:00:00+08:00');
      const params=(await api(s,'GetParams.aspx',{spacetype:8}))[0]?.resdata?.[0];
      if(!(Number(params?.oncecanbooktime)>=3))throw new Error('官方單次預約上限不足 3 小時');
      const records=(await api(s,'GetBookInfo.aspx'))[0]?.resdata;
      if(records!=null&&!Array.isArray(records))throw new Error('官方預約資料格式已變更');
      const existing=(records||[]).filter(r=>String(r.spacetype)==='8'&&String(r.userid||'').toUpperCase().split('|').includes(String(s.userId).toUpperCase())&&['-1','0','1','2'].includes(String(r.usestatus))).map(r=>({...r,...reservationBounds(r.bookedatetime)}));
      const days=[],options=[];
      for(let i=0;i<7;i++){
        const start=first+i*DAY,end=start+3*HOUR,date=taipeiDate(start);
        const day={date,start,end,state:'unavailable',message:''};days.push(day);
        const overlap=existing.find(r=>r.start<end&&r.end>start);
        if(overlap){
          if(overlap.start<=start&&overlap.end>=end){day.state='existing';day.seat=String(overlap.devname||'已預約');day.message='已有預約，不重複送出';options.push([{seat:day.seat,deviceid:String(overlap.deviceid||'existing-'+day.seat)}]);}
          else{day.message='與既有預約重疊，請先查看我的預約';options.push([]);}continue;
        }
        if(start<now()){ day.message='21:00 已過，不自動更改時段';options.push([]);continue;}
        try{
          const fetched=await nightStatus(api,s,date);
          const unique=new Map();for(const raw of fetched.payloads)for(const r of availability(raw,date+'T21:00').results)unique.set(r.deviceid+'/'+r.start+'/'+r.end,r);
          const rows=[...unique.values()].filter(r=>/^\d+$/.test(r.deviceid)&&r.availableAtStart&&r.end>=end);
          options.push(rows);if(!rows.length)day.message='尚未開放或沒有完整 3 小時空位';
        }catch(e){if(!s.auth)throw e;options.push([]);day.message=e.message;}
      }
      const favorites=Array.isArray(body.favorites)?body.favorites.filter(x=>typeof x==='string').slice(0,100):[];
      const chosen=chooseSeats(options,favorites);
      chosen.forEach((seat,i)=>{if(seat&&days[i].state!=='existing')Object.assign(days[i],{deviceid:seat.deviceid,seat:seat.seat,zone:seat.zone,businessDate:days[i].date,state:'ready'});});
      const batch={token:randomBytes(24).toString('hex'),startDate,expires:now()+10*60000,days,stopped:false};
      // One session owns one current preview. Re-preview invalidates older confirmations.
      s.weekly=batch;return view(batch);
    },
    async confirm(s,{token,index}){
      auth(s);const batch=s.weekly;
      if(!batch||batch.token!==token)throw new Error('請重新查看七天安排');
      if(!Number.isInteger(index)||index<0||index>6)throw new Error('日期不正確');
      const day=batch.days[index];
      if(day.state==='done')return view(batch);
      if(batch.stopped)throw new Error('已停止預約，請查看已完成項目與官方現況');
      if(batch.expires<now())throw new Error('安排已過期，請重新查看');
      if(day.state!=='ready'||batch.days.slice(0,index).some(d=>d.state==='ready'||d.state==='sending'))throw new Error('請依序預約');
      try{
        if(day.start<now())throw new Error('開始時間已過');
        const raw=await api(s,'BookTimeSegQuery.aspx',{spacetype:8,sdate:day.businessDate.replaceAll('-','/'),deviceid:day.deviceid});
        const values=selectedSlots(raw[0]?.resdata,day.start,day.end);
        day.state='sending';
        await api(s,'BookAdd.aspx',{spacetype:8,deviceid:day.deviceid,userid:s.userId,sdate:day.businessDate.replaceAll('-','/'),booktime:values.join(',')});
        day.state='done';day.message='預約成功';
      }catch(e){
        const unknown=day.state==='sending'&&!e.officialRejected;
        day.state=unknown?'unknown':'failed';batch.stopped=true;
        day.message=unknown?'結果未確認，請查看官方現況，勿重複送出':e.message;
        if(unknown)s.bookingUncertain=true;
      }
      return view(batch);
    }
  };
}
