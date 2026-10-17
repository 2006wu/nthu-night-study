// Use the ordinary reader query; if its all-zone response omits A, ask for A explicitly.
export async function nightStatus(api,session,date){
  const params={spacetype:8,sdate:date.replaceAll('-',''),zoneid:null};
  const all=await api(session,'GetAllBookStatus.aspx',params);
  const payloads=[all],warnings=[];
  if(!all.deviceinfo?.some(d=>String(d.zoneid)==='8_4A'||String(d.zoneid)==='A')){
    try{const a=await api(session,'GetAllBookStatus.aspx',{...params,zoneid:'8_4A'});payloads.push(a);}
    catch(e){if(!session.auth)throw e;warnings.push('A 區：'+e.message);}
  }
  return{payloads,warnings};
}
