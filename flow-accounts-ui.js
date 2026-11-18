(() => {
  const list = document.querySelector('#flowAccountList'), add = document.querySelector('#flowAddAccount');
  if (!list || !add) return;
  const KEY = 'hekaya-flow-accounts-v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const write = items => localStorage.setItem(KEY, JSON.stringify(items));
  const render = () => { const items=read(); list.innerHTML=''; if(!items.length){list.textContent='لسه مفيش حسابات مضافة.';return;}
    items.forEach(item=>{const card=document.createElement('article');card.className='flow-account';const top=document.createElement('div');top.className='flow-account-top';const name=document.createElement('strong');name.className='flow-account-title';name.textContent=item.name;const badge=document.createElement('span');badge.className='subtle';badge.textContent='بيانات محلية';top.append(name,badge);const email=document.createElement('div');email.className='flow-account-meta';email.textContent=item.email||'لم يتم تسجيل بريد';const actions=document.createElement('div');actions.className='flow-account-actions';const open=document.createElement('button');open.type='button';open.textContent='فتح Flow';open.addEventListener('click',()=>window.open('https://labs.google/fx/tools/flow','_blank','noopener'));const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='حذف';remove.addEventListener('click',()=>{write(read().filter(x=>x.id!==item.id));render();});actions.append(open,remove);card.append(top,email,actions);list.append(card);});
  };
  add.addEventListener('click',()=>{const nameEl=document.querySelector('#flowAccountName'),emailEl=document.querySelector('#flowAccountEmail'),status=document.querySelector('#flowAccountStatus'),name=nameEl.value.trim(),email=emailEl.value.trim();if(!name){nameEl.focus();status.textContent='اكتب اسمًا للحساب.';return;}const items=read();if(email&&items.some(x=>x.email.toLowerCase()===email.toLowerCase())){status.textContent='البريد مضاف بالفعل.';return;}items.push({id:crypto.randomUUID(),name,email,createdAt:new Date().toISOString()});write(items);nameEl.value='';emailEl.value='';status.textContent='تم حفظ الحساب في هذا المتصفح.';render();});
  render();
})();
