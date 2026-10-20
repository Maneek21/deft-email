export function unreadSummary(result){
 const row=result?.outcome==='completed'&&result.items?.length===1?result.items[0]:null,s=row?.summary;
 if(row?.store_key!=='mailbox_status'||!s||typeof s.count_ready!=='boolean'||typeof s.coverage_complete!=='boolean')return null;
 if(!s.count_ready)return {ready:false,complete:s.coverage_complete,count:null};
 const count=s.coverage_complete?s.unread_count:s.cached_unread_count;
 return Number.isSafeInteger(count)&&count>=0?{ready:true,complete:s.coverage_complete,count}:null;
}
export function unreadLabel(values){
 if(!values.length||values.some(value=>!value))return 'Unread count unavailable';
 if(values.some(value=>!value.ready))return 'Counting unread messages…';
 const count=values.reduce((sum,value)=>sum+value.count,0);
 return values.every(value=>value.complete)?`${count} unread`:`${count} unread so far · still syncing`;
}
