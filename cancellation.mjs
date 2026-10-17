import {randomBytes} from 'node:crypto';
const statuses={'-1':'尚未審核','0':'預約成功','1':'尚未簽到','2':'已簽到','3':'預約未到','4':'提早離開','5':'多日未到','6':'違規停權','7':'證件失效','8':'提早結束'};
const cancellable=row=>['-1','0','1'].includes(String(row.usestatus));
const own=(row,s)=>String(row.spacetype)==='8'&&String(row.userid||'').toUpperCase().split('|').includes(String(s.userId).toUpperCase());
const fingerprint=row=>JSON.stringify([row.bookid,row.devname,row.zoneid,row.bookedatetime,row.userid,row.spacetype]);
function summary(row){return{seat:String(row.devname||''),zone:String(row.zoneid||'').match(/8_4([ABCDE])$/)?.[1]||String(row.zonename||'夜讀區'),time:String(row.bookedatetime||''),status:statuses[String(row.usestatus)]||'不可取消',canCancel:cancellable(row)};}
export function cancellationService(api,now=()=>Date.now()){
  function auth(s){if(!s.auth||!s.userId)throw new Error('請先登入');}
  async function records(s){auth(s);const response=await api(s,'GetBookInfo.aspx');const rows=response[0]?.resdata;if(rows==null)return[];if(!Array.isArray(rows))throw new Error('官方預約資料格式已變更');return rows.filter(row=>own(row,s));}
  async function current(s,draft){const row=(await records(s)).find(row=>String(row.bookid)===draft.bookid);if(!row)throw new Error('這筆預約已不存在，請更新清單');if(!cancellable(row))throw new Error('這筆預約目前無法取消，請查看官方預約現況');if(fingerprint(row)!==draft.fingerprint)throw new Error('預約內容已變更，請重新確認');return row;}
  return{
    async list(s){const rows=await records(s);s.cancelOffers=new Map();return{reservations:rows.map(row=>{const cancelId=randomBytes(16).toString('hex');s.cancelOffers.set(cancelId,{bookid:String(row.bookid),fingerprint:fingerprint(row),at:now()});return{...summary(row),cancelId};})};},
    async preview(s,body){auth(s);const offer=s.cancelOffers?.get(body.cancelId);if(!offer||now()-offer.at>10*60000)throw new Error('請更新我的預約後再試');if(s.cancelUncertain?.has(offer.bookid))throw new Error('上次取消結果未確認，請先查看官方現況，再重新登入');const row=await current(s,offer);const token=randomBytes(24).toString('hex');s.cancelDrafts??=new Map();for(const[key,draft]of s.cancelDrafts)if(draft.state==='ready'&&draft.expires<now())s.cancelDrafts.delete(key);s.cancelDrafts.set(token,{...offer,expires:now()+2*60000,state:'ready'});return{...summary(row),token};},
    async confirm(s,body){auth(s);const draft=s.cancelDrafts?.get(body.token);if(!draft)throw new Error('請重新確認要取消的預約');if(draft.state==='done')return draft.result;if(draft.state!=='ready')throw new Error(draft.message||'取消請求已處理');if(s.cancelUncertain?.has(draft.bookid))throw new Error('上次取消結果未確認，請先查看官方現況，再重新登入');if(draft.expires<now())throw new Error('確認已過期，請重新選擇');await current(s,draft);draft.state='sending';try{await api(s,'BookDel.aspx',{bookid:draft.bookid});draft.state='done';draft.result={success:true};return draft.result;}catch(error){draft.state=error.officialRejected?'rejected':'unknown';draft.message=error.officialRejected?error.message:'取消後未收到明確結果，請先查看官方預約現況，再重新登入；請勿重複送出';if(!error.officialRejected){s.cancelUncertain??=new Set();s.cancelUncertain.add(draft.bookid);}throw new Error(draft.message);}}
  };
}
