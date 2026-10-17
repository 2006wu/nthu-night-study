export function parseNightRemainder(data) {
  const first = Array.isArray(data) ? data[0] : data;
  if (String(first?.rescode) !== '1' || !Array.isArray(first?.resdata)) throw new Error('官方目前空位資料格式已變更');
  const row = first.resdata.find(item => String(item.zoneid) === '8_4A');
  if (!row || !/^\d+$/.test(String(row.count))) throw new Error('官方未提供 A 區目前空位數量');
  return {zone:'A', name:String(row.zonename || '4F-夜讀區A'), available:Number(row.count)};
}
