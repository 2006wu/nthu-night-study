const $=id=>document.getElementById(id);
let authenticated=false,challenge=false,busy=false,data=null,zone='all',aCurrent=null;
let favorites=new Set();
try{favorites=new Set(JSON.parse(localStorage.getItem('seat-favorites')||'[]'));}catch{}
try{const account=localStorage.getItem('seat-account');if(account){$('account').value=account;$('rememberAccount').checked=true;}}catch{}
$('rememberAccount').onchange=()=>{if(!$('rememberAccount').checked){try{localStorage.removeItem('seat-account');}catch{}}};
$('rememberPasswordOption').hidden=!(window.PasswordCredential&&navigator.credentials?.store);
const taipei=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function parts(ms){return taipei.format(new Date(ms)).replace(' ','T');}
const now=parts(Date.now());$('date').value=now.slice(0,10);$('date').min=now.slice(0,10);
for(let i=0;i<48;i++){const value=`${String(Math.floor(i/2)).padStart(2,'0')}:${i%2?'30':'00'}`;const o=document.createElement('option');o.value=o.textContent=value;$('time').append(o);}
$('time').value=now.slice(11,13)+':'+(Number(now.slice(14))<30?'00':'30');
try{const p=JSON.parse(localStorage.getItem('seat-query')||'null');if(p&&p.date>=now.slice(0,10)){$('date').value=p.date;$('time').value=p.time;}}catch{}
function notice(message,success=false){$('notice').textContent=message;$('notice').classList.toggle('success',success);$('notice').hidden=!message;}
function lock(value){busy=value;for(const id of ['search','refresh','manualLogin','logout','refreshReservations'])$(id).disabled=value;}
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok){const e=new Error(d.error||'操作失敗');e.challengeReusable=d.challengeReusable;e.captcha=d.captcha;throw e;}return d;}
function auth(value){authenticated=value;if(!value)$('reservationList').replaceChildren();$('loginPanel').querySelector('summary span').textContent=value?'帳號':'登入';$('connection').textContent=value?'已登入':'未登入';$('connection').classList.toggle('connected',value);$('logout').hidden=!value;$('loginPanel').open=!value;}
async function refresh(){if(busy)return;lock(true);notice('載入中…');try{const d=await api('challenge',{});$('captchaImage').src=d.captcha;$('captchaImage').hidden=false;$('captchaPlaceholder').hidden=true;$('captcha').value='';challenge=true;auth(false);notice('');}catch(e){notice(e.message);}finally{lock(false);}}
$('refresh').onclick=refresh;
async function login(){if(busy)return;if(!$('loginForm').reportValidity())return;if(!challenge){await refresh();return;}if(!$('captcha').value.trim()){notice('請輸入驗證碼');$('captcha').focus();return;}lock(true);notice('登入中…');try{await api('login',{account:$('account').value.trim(),password:$('password').value,captcha:$('captcha').value.trim()});try{if($('rememberAccount').checked)localStorage.setItem('seat-account',$('account').value.trim());else localStorage.removeItem('seat-account');}catch{}if($('rememberPassword').checked&&window.PasswordCredential&&navigator.credentials?.store){const credential=new PasswordCredential({id:$('account').value.trim(),password:$('password').value});navigator.credentials.store(credential).catch(()=>{});}$('password').value='';$('captcha').value='';$('captchaImage').removeAttribute('src');$('captchaImage').hidden=true;challenge=false;auth(true);notice('');}catch(e){notice(e.message);challenge=e.challengeReusable===true;if(e.captcha){$('captchaImage').src=e.captcha;$('captchaImage').hidden=false;$('captchaPlaceholder').hidden=true;$('captcha').value='';}}finally{lock(false);}}
$('loginForm').onsubmit=e=>{e.preventDefault();login();};
$('logout').onclick=async()=>{if(busy)return;lock(true);try{await api('logout',{});auth(false);challenge=false;data=null;render();$('captchaImage').hidden=true;$('captchaPlaceholder').hidden=false;$('password').value='';notice('');}catch(e){notice(e.message);}finally{lock(false);}};
$('search').onclick=async()=>{if(busy)return;if(!authenticated){$('loginPanel').open=true;notice('請先登入');if(!challenge)await refresh();return;}
 lock(true);notice('查詢中…');data=null;render();
 try{const request={date:$('date').value,time:$('time').value};const d=await api('query',request);data=d;try{localStorage.setItem('seat-query',JSON.stringify(request));}catch{}render();notice(d.warnings.length?d.warnings.join('\n'):'',false);}catch(e){notice(e.message);try{auth((await api('status')).authenticated);}catch{}}finally{lock(false);}};
function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
function duration(min){return `${Math.floor(min/60)?Math.floor(min/60)+' 小時':''}${min%60?' '+min%60+' 分鐘':''}`.trim()||'0 分鐘';}
function clock(ms){return parts(ms).slice(11,16);}
function dayLabel(ms){const day=parts(ms).slice(0,10);return day===data.requested.slice(0,10)?'當日':day;}
function renderACurrent(){const visible=aCurrent&&(zone==='all'||zone==='A');$('aCurrent').hidden=!visible;if(visible)$('aCurrent').textContent=`A 區目前尚有 ${aCurrent.available} 席 · 官方未提供座位編號，請至現場機台選位`;}
function render(){const root=$('results');root.replaceChildren();renderACurrent();if(!data){$('resultTitle').textContent='座位';$('resultMeta').textContent='';root.append(node('div','empty',busy?'查詢中…':'選擇時間後查詢'));return;}
 const rows=data.results.filter(r=>(zone==='all'||r.zone===zone)&&r.minutes>=Number($('minDuration').value)&&($('includeLater').checked||r.availableAtStart)&&(!$('favoriteOnly').checked||favorites.has(r.seat))).sort((a,b)=>Number(favorites.has(b.seat))-Number(favorites.has(a.seat)));
 const seatCount=new Set(rows.map(r=>r.seat)).size;
 $('resultTitle').textContent=`${seatCount} 個座位`;$('resultMeta').textContent=`${data.requested.replace('T',' ')} 起 · ${clock(Date.parse(data.updatedAt))} 更新`;
 const occupiedNames=new Set(rows.map(r=>r.seat));
 const aReadOnly=(zone==='A'||zone==='all')?(data.aSeats||[]).filter(r=>!occupiedNames.has(r.seat)&&!r.onlineAvailable&&(!$('favoriteOnly').checked||favorites.has(r.seat))):[];
 if(zone==='A'&&!data.aSeats?.length&&!rows.length){root.append(node('div','empty',aCurrent?`官方目前回報 A 區尚有 ${aCurrent.available} 席，但座位編號只在現場機台提供`:'官方未回傳 A 區座位資料'));return;}
 if(!rows.length&&!aReadOnly.length){const empty=node('div','empty');empty.append(node('p','','沒有符合條件的座位'));root.append(empty);return;}
 for(const r of rows){const card=node('article','seat'+(r.availableAtStart?'':' later'));const top=node('div','seat-top');const name=node('div');name.append(node('span','seat-id',r.seat),node('span','zone-tag',r.zone+' 區'));const star=node('button','favorite',favorites.has(r.seat)?'★':'☆');star.type='button';star.setAttribute('aria-label',`${favorites.has(r.seat)?'取消收藏':'收藏'} ${r.seat}`);star.setAttribute('aria-pressed',String(favorites.has(r.seat)));star.onclick=()=>{favorites.has(r.seat)?favorites.delete(r.seat):favorites.add(r.seat);try{localStorage.setItem('seat-favorites',JSON.stringify([...favorites]));}catch{}render();};top.append(name,star);
 const sameDay=parts(r.start).slice(0,10)===parts(r.end).slice(0,10);const hours=node('div','seat-hours',`${clock(r.start)} — ${sameDay?'':parts(r.end).slice(5,10)+' '}${clock(r.end)}`);
 const bottom=node('div','seat-bottom');bottom.append(node('span','duration',r.availableAtStart?`可坐 ${duration(r.minutes)}`:`等待 ${duration(r.waitMinutes)}`));const link=node('a','',r.zone+' 區配置圖 ↗');link.href=`https://libsms.lib.nthu.edu.tw/system/zoneData.aspx?zone=8_4${r.zone}`;link.target='_blank';link.rel='noopener noreferrer';bottom.append(link);card.append(top,hours,bottom);
 if(r.offerId){const book=node('button','reserve-button','預約');book.type='button';book.setAttribute('aria-label',`預約 ${r.seat}`);book.onclick=()=>openBooking(r);card.append(book);}
 if(!r.availableAtStart)card.append(node('p','cap-note',`入座後可坐 ${duration(r.minutes)}`));if(r.minutes>480)card.append(node('p','cap-note',`單次最多 8 小時`));root.append(card);}
 for(const r of aReadOnly){const card=node('article','seat');const top=node('div','seat-top');top.append(node('span','seat-id',r.seat),node('span','zone-tag','A 區'));card.append(top,node('p','muted',r.message),node('p','cap-note','請至現場機台確認；此狀態不代表座位已被使用'));root.append(card);}
 if(aReadOnly.length)$('resultTitle').textContent=`${seatCount} 個可預約座位`;
}
for(const b of $('zones').querySelectorAll('button'))b.onclick=()=>{zone=b.dataset.zone;for(const button of $('zones').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button===b));render();};
for(const id of ['minDuration','includeLater','favoriteOnly'])$(id).onchange=render;
api('status').then(d=>{auth(d.authenticated);secondaryAuthenticated=!!d.secondaryAuthenticated;}).catch(()=>notice('本機服務連線失敗，請重新啟動程式。'));
api('remainder').then(d=>{aCurrent=d;renderACurrent();}).catch(()=>{});
let bookingRow=null,bookingDraft=null,bookingBusy=false;
function bookingLock(value){bookingBusy=value;for(const id of ['bookingClose','bookingBack','bookingNext','bookingConfirm'])$(id).disabled=value;}
function bookingError(message){$('bookingError').textContent=message;$('bookingError').hidden=!message;}
function showSelection(){bookingDraft=null;$('bookingTitle').textContent='預約座位';$('bookingSelection').hidden=false;$('bookingReview').hidden=true;$('bookingNext').hidden=false;$('bookingBack').hidden=true;$('bookingConfirm').hidden=true;bookingError('');}
function openBooking(row){if(busy)return;bookingRow=row;showSelection();$('bookingSeat').textContent=`${row.seat} · ${row.zone} 區`;$('bookingStart').textContent=`開始 ${parts(row.usableStart).replace('T',' ')}`;const select=$('bookingEnd');select.replaceChildren();const limit=Math.min(row.end,row.usableStart+8*3600000);for(let end=row.usableStart+1800000;end<=limit;end+=1800000){const option=node('option','',`${parts(end).replace('T',' ')}（${duration((end-row.usableStart)/60000)}）`);option.value=String(end);select.append(option);}select.value=String(limit);$('bookingDialog').showModal();}
$('bookingClose').onclick=()=>{if(!bookingBusy)$('bookingDialog').close();};
$('bookingDialog').addEventListener('cancel',event=>{if(bookingBusy)event.preventDefault();});
$('bookingBack').onclick=showSelection;
$('bookingNext').onclick=async()=>{if(bookingBusy)return;bookingLock(true);bookingError('正在確認空位…');try{bookingDraft=await api('booking/preview',{offerId:bookingRow.offerId,start:bookingRow.usableStart,end:Number($('bookingEnd').value)});$('bookingTitle').textContent='確認預約';$('bookingSelection').hidden=true;$('bookingReview').textContent=`${parts(bookingDraft.start).replace('T',' ')}\n至 ${parts(bookingDraft.end).replace('T',' ')}\n${duration((bookingDraft.end-bookingDraft.start)/60000)}`;$('bookingReview').hidden=false;$('bookingNext').hidden=true;$('bookingBack').hidden=false;$('bookingConfirm').hidden=false;bookingError('');}catch(e){bookingError(e.message);}finally{bookingLock(false);}};
$('bookingConfirm').onclick=async()=>{if(bookingBusy||!bookingDraft)return;bookingLock(true);bookingError('送出中…');try{await api('booking/confirm',{token:bookingDraft.token});$('bookingTitle').textContent='預約成功';$('bookingConfirm').hidden=true;$('bookingBack').hidden=true;bookingError('');data=null;render();notice(`${bookingDraft.seat} 預約成功`,true);}catch(e){bookingError(e.message);$('bookingConfirm').hidden=true;$('bookingBack').hidden=true;}finally{bookingLock(false);}};
let cancelDraft=null,cancelBusy=false;
function reservationTime(value){return value.replace(/\b(\d{4})(\d{2})(\d{2})\b/g,'$1/$2/$3').replace(/(\d{2}:\d{2}):\d{2}/g,'$1');}
async function loadReservations(){if(busy)return;const root=$('reservationList');root.replaceChildren();if(!authenticated){root.append(node('p','muted','請先登入'));return;}lock(true);root.append(node('p','muted','載入中…'));try{const response=await api('booking/list',{});root.replaceChildren();if(!response.reservations.length)root.append(node('p','muted','目前沒有夜讀區預約'));for(const r of response.reservations){const row=node('article','reservation-row');const info=node('div','reservation-info');info.append(node('strong','',`${r.seat} · ${r.zone} 區`),node('p','muted',reservationTime(r.time)),node('span','reservation-status',r.status));row.append(info);if(r.canCancel){const button=node('button','cancel-button','取消');button.setAttribute('aria-label',`取消預約 ${r.seat}`);button.onclick=()=>openCancellation(r);row.append(button);}root.append(row);}}catch(e){root.replaceChildren(node('p','booking-error',e.message));}finally{lock(false);}}
$('refreshReservations').onclick=loadReservations;
$('myReservations').addEventListener('toggle',()=>{if($('myReservations').open)loadReservations();});
function cancelLock(value){cancelBusy=value;for(const id of ['cancelClose','cancelKeep','cancelConfirm'])$(id).disabled=value;}
function cancelError(message){$('cancelError').textContent=message;$('cancelError').hidden=!message;}
async function openCancellation(row){if(busy||cancelBusy)return;cancelDraft=null;$('cancelTitle').textContent='取消預約？';$('cancelSeat').textContent=`${row.seat} · ${row.zone} 區`;$('cancelTime').textContent=reservationTime(row.time);$('cancelConfirm').hidden=false;$('cancelKeep').hidden=false;$('cancelKeep').textContent='保留預約';cancelLock(true);cancelError('確認預約中…');$('cancelDialog').showModal();try{cancelDraft=await api('cancellation/preview',{cancelId:row.cancelId});$('cancelSeat').textContent=`${cancelDraft.seat} · ${cancelDraft.zone} 區`;$('cancelTime').textContent=reservationTime(cancelDraft.time);cancelError('');}catch(e){cancelError(e.message);$('cancelConfirm').hidden=true;}finally{cancelLock(false);}}
for(const id of ['cancelClose','cancelKeep'])$(id).onclick=()=>{if(!cancelBusy)$('cancelDialog').close();};
$('cancelDialog').addEventListener('cancel',event=>{if(cancelBusy)event.preventDefault();});
$('cancelConfirm').onclick=async()=>{if(cancelBusy||!cancelDraft)return;cancelLock(true);cancelError('取消中…');try{await api('cancellation/confirm',{token:cancelDraft.token});$('cancelTitle').textContent='已取消預約';$('cancelConfirm').hidden=true;$('cancelKeep').textContent='關閉';cancelError('');data=null;render();await loadReservations();notice(`${cancelDraft.seat} 已取消`,true);}catch(e){cancelError(e.message);$('cancelConfirm').hidden=true;$('cancelKeep').textContent='關閉';}finally{cancelLock(false);}};

let weeklyDraft=null,weeklyBusy=false;
function weeklyLock(value){weeklyBusy=value;lock(value);for(const id of ['weeklyClose','weeklyPreview','weeklyConfirm'])$(id).disabled=value;}
function weeklyError(message){$('weeklyError').textContent=message;$('weeklyError').hidden=!message;}
function renderWeekly(){
  const root=$('weeklyDays');root.replaceChildren();if(!weeklyDraft)return;
  const states={existing:'已有預約',ready:'待預約',done:'已預約',unavailable:'無法安排',failed:'失敗',unknown:'待確認',sending:'送出中'};
  const seats=new Set(weeklyDraft.days.filter(d=>d.seat).map(d=>d.seat));
  const ready=weeklyDraft.days.filter(d=>d.state==='ready').length,done=weeklyDraft.days.filter(d=>d.state==='done').length;
  $('weeklySummary').textContent=`${weeklyDraft.startDate} 起 · ${seats.size===1?'固定座位 '+[...seats][0]:seats.size?'需要使用 '+seats.size+' 個座位':'尚無可安排座位'}${done?' · 已成功 '+done+' 天':''}`;
  for(const d of weeklyDraft.days){const row=node('div','weekly-row');const info=node('div');info.append(node('strong','',`${d.date.slice(5).replace('-','/')}　${d.seat||'—'}`));if(d.message)info.append(node('small','muted',d.message));row.append(info,node('span',d.state==='done'?'weekly-done':'muted',states[d.state]));root.append(row);}
  $('weeklyConfirm').hidden=!ready||weeklyDraft.stopped;
  $('weeklyConfirm').textContent=`確認預約 ${ready} 天`;
}
$('frogWeekly').onclick=async()=>{
  $('frogPanel').hidden=true;$('frogToggle').setAttribute('aria-expanded','false');
  if(busy)return;
  if(!authenticated){$('loginPanel').open=true;notice('先登入，小蛙才能幫你安排一週');if(!challenge)await refresh();return;}
  weeklyDraft=null;renderWeekly();$('weeklySummary').textContent='優先固定座位';$('weeklyConfirm').hidden=true;weeklyError('');$('weeklyDialog').showModal();await previewWeekly();
};
async function previewWeekly(){if(weeklyBusy)return;weeklyLock(true);weeklyError('正在查看七天空位…');$('weeklyConfirm').hidden=true;try{weeklyDraft=await api('weekly/preview',{favorites:[...favorites]});renderWeekly();weeklyError(weeklyDraft.days.some(d=>d.state==='unavailable')?'部分日期無法安排，確認只會預約上方「待預約」日期。':'');}catch(e){weeklyDraft=null;$('weeklyDays').replaceChildren();weeklyError(e.message);}finally{weeklyLock(false);}}
$('weeklyPreview').onclick=previewWeekly;
$('weeklyClose').onclick=()=>{if(!weeklyBusy)$('weeklyDialog').close();};
$('weeklyDialog').addEventListener('cancel',e=>{if(weeklyBusy)e.preventDefault();});
$('weeklyConfirm').onclick=async()=>{
  if(weeklyBusy||!weeklyDraft)return;
  weeklyLock(true);weeklyError('依序預約中，請稍候…');
  try{
    for(let index=0;index<7;index++){
      if(weeklyDraft.days[index].state!=='ready')continue;
      weeklyError(`正在預約 ${weeklyDraft.days[index].date}…`);
      weeklyDraft=await api('weekly/confirm',{token:weeklyDraft.token,index});renderWeekly();
      if(weeklyDraft.stopped)break;
    }
    const done=weeklyDraft.days.filter(d=>d.state==='done').length;
    weeklyError(weeklyDraft.stopped?'已停止，後續日期尚未送出。請查看各日結果。':'');
    $('weeklyConfirm').hidden=true;notice(`七天安排：成功預約 ${done} 天`,done>0);data=null;render();
  }catch(e){weeklyError(`${e.message}。已停止；請查看「我的預約」確認結果後再操作。`);$('weeklyConfirm').hidden=true;}
  finally{weeklyLock(false);}
};

// 雙帳號相鄰座位：第二個官方登入狀態獨立保存於伺服器 session。
let secondaryAuthenticated=false,secondaryChallenge=false,dualDraft=null,dualBusy=false;
const secondPanel=document.createElement('details');secondPanel.id='secondLoginPanel';secondPanel.className='login-panel';secondPanel.innerHTML='<summary><span>第二帳號（雙人連位）</span></summary><div class="login-inner"><form id="secondLoginForm"><div class="credentials"><label>帳號<input id="secondAccount" autocomplete="username" required placeholder="第二個學號"></label><label>密碼<input id="secondPassword" type="password" autocomplete="current-password" required placeholder="輸入密碼"></label></div><div class="captcha-row"><div class="captcha-image"><img id="secondCaptchaImage" alt="官方登入驗證碼" hidden><span id="secondCaptchaPlaceholder">驗證碼</span></div><button id="secondRefresh" type="button" class="secondary">更新圖片</button><label>驗證碼<input id="secondCaptcha" autocomplete="off" maxlength="4" placeholder="4 個字元"></label></div><div class="login-actions"><button id="secondLogin" class="primary" type="submit">登入第二帳號</button><button id="secondLogout" type="button" class="text-button" hidden>登出</button></div><p id="secondNotice" class="muted" hidden></p></form></div>';
$('loginPanel').after(secondPanel);
const dualButton=document.createElement('button');dualButton.id='dualBook';dualButton.className='primary dual-book';dualButton.type='button';dualButton.textContent='找相鄰座位 · 雙人預約';dualButton.hidden=true;$('aCurrent').after(dualButton);
const dualDialog=document.createElement('dialog');dualDialog.id='dualDialog';dualDialog.innerHTML='<div class="booking-header"><h2>雙人相鄰座位</h2><button id="dualClose" class="text-button" type="button">✕</button></div><p id="dualSummary" class="muted"></p><label>配對<select id="dualPair"></select></label><label>結束時間<select id="dualEnd"></select></label><p id="dualError" class="booking-error" role="status" hidden></p><div class="booking-actions"><button id="dualConfirm" class="primary" type="button">確認預約兩個座位</button></div>';document.body.append(dualDialog);
function secondNotice(message){$('secondNotice').textContent=message;$('secondNotice').hidden=!message;}
async function secondRefresh(){try{const d=await api('secondary/challenge',{});$('secondCaptchaImage').src=d.captcha;$('secondCaptchaImage').hidden=false;$('secondCaptchaPlaceholder').hidden=true;secondaryChallenge=true;secondNotice('');}catch(e){secondNotice(e.message);}}
$('secondRefresh').onclick=secondRefresh;
$('secondLoginForm').onsubmit=async e=>{e.preventDefault();if(!secondaryChallenge){await secondRefresh();return;}if(!$('secondCaptcha').value.trim())return secondNotice('請輸入驗證碼');$('secondLogin').disabled=true;secondNotice('登入中…');try{await api('secondary/login',{account:$('secondAccount').value.trim(),password:$('secondPassword').value,captcha:$('secondCaptcha').value.trim()});secondaryAuthenticated=true;$('secondLogout').hidden=false;$('secondLogin').hidden=true;$('secondPassword').value='';$('secondCaptcha').value='';secondNotice('第二帳號已登入');dualButton.hidden=!authenticated;}catch(e){secondNotice(e.message);secondaryChallenge=e.challengeReusable===true;}finally{$('secondLogin').disabled=false;}};
$('secondLogout').onclick=async()=>{await api('secondary/logout',{});secondaryAuthenticated=false;dualButton.hidden=true;$('secondLogout').hidden=true;$('secondLogin').hidden=false;secondNotice('');};
function dualError(message){$('dualError').textContent=message;$('dualError').hidden=!message;}
dualButton.onclick=async()=>{if(dualBusy)return;dualBusy=true;dualDialog.showModal();dualError('正在找相鄰座位…');$('dualConfirm').disabled=true;try{dualDraft=await api('dual/preview',{date:$('date').value,time:$('time').value});const select=$('dualPair');select.replaceChildren();for(const [i,p] of dualDraft.pairs.entries()){const o=document.createElement('option');o.value=String(i);o.textContent=`${p.zone}區 ${p.first.seat}＋${p.second.seat}`;select.append(o);}if(!dualDraft.pairs.length){dualError(dualDraft.message);return;}function fill(){const p=dualDraft.pairs[Number(select.value)];$('dualSummary').textContent=`${p.zone}區　${p.first.seat}＋${p.second.seat}　開始 ${parts(p.start).replace('T',' ')}`;$('dualEnd').replaceChildren();for(let end=p.start+1800000;end<=Math.min(p.end,p.start+8*3600000);end+=1800000){const o=document.createElement('option');o.value=String(end);o.textContent=`至 ${parts(end).replace('T',' ')}`;$('dualEnd').append(o);} }select.onchange=fill;fill();dualError('');$('dualConfirm').disabled=false;}catch(e){dualError(e.message);}finally{dualBusy=false;}};
$('dualClose')?.addEventListener('click',()=>{if(!dualBusy)dualDialog.close();});
$('dualConfirm').onclick=async()=>{if(!dualDraft||dualBusy)return;dualBusy=true;$('dualConfirm').disabled=true;dualError('依序預約兩個座位中…');try{const p=dualDraft.pairs[Number($('dualPair').value)];const result=await api('dual/confirm',{token:dualDraft.token,end:Number($('dualEnd').value)});dualError(`完成：${result.first.seat}、${result.second.seat}`);dualDraft=null;notice('雙人相鄰座位預約成功',true);}catch(e){dualError(e.message);}finally{dualBusy=false;$('dualConfirm').disabled=false;}};
