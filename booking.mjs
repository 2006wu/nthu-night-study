import {randomBytes} from 'node:crypto';
import {slotBounds} from './availability.mjs';
const HALF=1800000;
export function selectedSlots(rows,start,end){
  if(!Array.isArray(rows))throw new Error('官方時段資料不完整');
  const selected=rows.map(row=>({...row,...slotBounds(row.bookdate,row.booktime)})).filter(row=>row.start>=start&&row.end<=end).sort((a,b)=>a.start-b.start);
  let cursor=start;const values=[];
  for(const row of selected){
    if(row.start!==cursor||String(row.canbook)!=='1'||!/^\d+$/.test(String(row.bookvalue)))throw new Error('時段已不可預約，請重新查詢');
    cursor=row.end;values.push(String(row.bookvalue));
  }
  if(cursor!==end||values.length!==(end-start)/HALF||new Set(values).size!==values.length)throw new Error('時段資料不連續，請重新查詢');
  return values;
}
export function bookingService(api,now=()=>Date.now()){
  const requireAuth=s=>{if(!s.auth||!s.userId)throw new Error('請重新登入後預約');};
  async function check(s,draft){
    if(draft.start<now()-HALF)throw new Error('開始時間已過，請重新查詢');
    const data=await api(s,'BookTimeSegQuery.aspx',{spacetype:8,sdate:draft.businessDate.replaceAll('-','/'),deviceid:draft.deviceid});
    return selectedSlots(data[0]?.resdata,draft.start,draft.end);
  }
  return {
    async preview(s,body){
      requireAuth(s);if(s.bookingUncertain)throw new Error('上次預約結果未確認，請先到官方預約現況查看，再重新登入');
      const offer=s.offers?.get(body.offerId);const {start,end}=body;
      if(!offer||now()-offer.at>10*60000)throw new Error('空位資料已過期，請重新查詢');
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<offer.usableStart||end>offer.end||end<=start||start%HALF||end%HALF||end-start>8*3600000)throw new Error('請選連續半小時時段，單次最多 8 小時');
      const draft={...offer,start,end};
      await check(s,draft);
      const params=(await api(s,'GetParams.aspx',{spacetype:8}))[0]?.resdata?.[0];
      const maxHours=Number(params?.oncecanbooktime);
      if(!Number.isFinite(maxHours)||maxHours<=0||end-start>maxHours*3600000)throw new Error('超過官方單次預約上限');
      const token=randomBytes(24).toString('hex');s.drafts??=new Map();
      for(const[key,value]of s.drafts)if(value.expires<now()&&value.state==='ready')s.drafts.delete(key);
      s.drafts.set(token,{...draft,expires:now()+2*60000,state:'ready'});
      return {token,seat:draft.seat,zone:draft.zone,start,end,expires:now()+2*60000};
    },
    async confirm(s,body){
      requireAuth(s);const draft=s.drafts?.get(body.token);
      if(!draft)throw new Error('請重新確認座位與時段');
      if(draft.state==='done')return draft.result;
      if(draft.state!=='ready')throw new Error(draft.message||'預約已處理，請查看官方預約現況');
      if(draft.expires<now())throw new Error('確認已過期，請重新選位');
      const values=await check(s,draft);
      draft.state='sending';
      try{
        const response=await api(s,'BookAdd.aspx',{spacetype:8,deviceid:draft.deviceid,userid:s.userId,sdate:draft.businessDate.replaceAll('-','/'),booktime:values.join(',')});
        draft.state='done';draft.result={success:true,seat:draft.seat,zone:draft.zone,start:draft.start,end:draft.end,message:String(response[0]?.resmsg||'預約成功')};
        return draft.result;
      }catch(error){
        draft.state=error.officialRejected?'rejected':'unknown';
        draft.message=error.officialRejected?error.message:'送出後未收到明確結果，請先到官方預約現況確認，再重新登入；請勿重複送出';
        if(!error.officialRejected)s.bookingUncertain=true;
        throw new Error(draft.message);
      }
    }
  };
}
