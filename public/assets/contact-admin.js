(()=>{'use strict';
 const panel=document.querySelector('#contactInboxPanel');
 const list=document.querySelector('#contactInboxList');
 const count=document.querySelector('#contactMessageCount');
 if(!panel||!list)return;
 const render=messages=>{
  list.replaceChildren();
  count.textContent=messages.length?'('+messages.length+')':'(0)';
  if(!messages.length){list.textContent='No contact messages yet.';return;}
  for(const message of messages){
   const item=document.createElement('article');item.className='contact-inbox-item';
   const heading=document.createElement('strong');heading.textContent=message.topic+' — '+message.name;
   const meta=document.createElement('p');meta.className='detail-meta';
   meta.textContent=new Date(message.created_at).toLocaleString()+' · Notification: '+message.email_status+(message.email_error?' · '+message.email_error:'');
   const email=document.createElement('a');email.href='mailto:'+encodeURIComponent(message.email);
   email.textContent=message.email;
   const body=document.createElement('p');body.className='contact-inbox-message';body.textContent=message.message;
   item.append(heading,meta,email,body);list.append(item);
  }
 };
 async function load(){
  list.textContent='Loading contact messages…';
  try{
   const response=await fetch('/api/admin/contact',{credentials:'same-origin'});
   if(response.status===401){list.textContent='Sign in to see contact messages.';return;}
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Unable to load contact messages.');
   render(data.messages||[]);
  }catch(error){list.textContent=error.message;}
 }
 panel.addEventListener('toggle',()=>{if(panel.open)load();});
 document.querySelector('#refreshContactMessages')?.addEventListener('click',load);
})();