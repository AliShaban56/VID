// Magic Hour API helper: server-only key rotation and transient retry.
const keys = () => [process.env.MAGICHOUR_API_KEYS, process.env.MAGICHOUR_API_KEY].filter(Boolean).flatMap(v => v.split(/[\\n,;]+/)).map(v => v.trim()).filter(Boolean);
export async function magicHourRequest(path, body, method='POST') {
  const list=keys(); if(!list.length) throw new Error('Magic Hour API key is not configured.');
  const url='https://api.magichour.ai'+path; let last;
  for(let i=0;i<list.length;i++) {
    try {
      const response=await fetch(url,{method,headers:{Authorization:'Bearer '+list[i],Accept:'application/json','Content-Type':'application/json'}, ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
      const raw=await response.text(); let data; try{data=JSON.parse(raw)}catch{data={raw}};
      if(response.ok) return {data,responseStatus:response.status,keyIndex:i};
      last=new Error(data?.error?.message||data?.message||('Magic Hour HTTP '+response.status));
      if(![401,403,408,429].includes(response.status)&&response.status<500) throw last;
    } catch(e) { last=e; }
  }
  throw last||new Error('Magic Hour request failed');
}
export const magicHourConfigured=()=>keys().length>0;