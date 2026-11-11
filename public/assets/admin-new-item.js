(()=>{'use strict';
const $=id=>document.getElementById(id);
const form=$('staffItemForm'),drop=$('staffDropZone'),fileInput=$('staffPhotos'),previews=$('staffPreviews'),error=$('staffError'),submit=$('staffSave');
let photos=[],busy=false;
function showError(message){error.textContent=message||'';error.hidden=!message;}
function render(){
 previews.replaceChildren();
 photos.forEach((photo,index)=>{
  const card=document.createElement('div');card.className='staff-preview';
  const picture=document.createElement('img');picture.src=photo.data;picture.alt='Item photo '+(index+1);
  const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove photo '+(index+1));
  remove.addEventListener('click',()=>{if(busy)return;photos.splice(index,1);render();});
  card.append(picture,remove);previews.append(card);
 });
}
function optimize(file){
 return new Promise((resolve,reject)=>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))return reject(Error('Choose JPG, PNG or WebP photos.'));
  const reader=new FileReader();
  reader.onerror=()=>reject(Error('Could not open that photo.'));
  reader.onload=()=>{
   const image=new Image();image.onerror=()=>reject(Error('Could not read that photo.'));
   image.onload=()=>{
    const scale=Math.min(1,1800/Math.max(image.width,image.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',0.82);
    if(data.length>7000000)return reject(Error('Photo is too large. Choose a smaller image.'));
    resolve({name:file.name,data});
   };image.src=reader.result;
  };reader.readAsDataURL(file);
 });
}
async function addFiles(files){
 if(busy)return;
 showError('');
 const incoming=[...files];
 if(photos.length+incoming.length>6)return showError('Maximum six photos per item.');
 for(const file of incoming){try{photos.push(await optimize(file));}catch(e){showError(e.message);}}
 fileInput.value='';render();
}
drop.addEventListener('click',e=>{if(e.target!==fileInput)fileInput.click();});
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInput.click();}});
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');addFiles(e.dataTransfer.files);});
fileInput.addEventListener('change',()=>addFiles(fileInput.files));
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;showError('');
 if(!form.reportValidity())return;
 busy=true;submit.disabled=true;submit.textContent='Saving item…';
 const fields=Object.fromEntries(new FormData(form).entries());
 try{
  const response=await fetch('/api/admin/owned-items',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,photos})});
  let result={};try{result=await response.json();}catch{}
  if(!response.ok)throw Error(response.status===401?'Your staff session expired. Sign in again from the dashboard.':result.error||'Item could not be saved.');
  form.hidden=true;$('staffSaved').hidden=false;$('staffSavedRef').textContent='Inventory reference: '+result.id;
 }catch(err){showError(err.message||'Unable to save item.');}
 finally{busy=false;submit.disabled=false;submit.textContent='Save to inventory';}
});
$('staffAgain').addEventListener('click',()=>{form.reset();photos=[];render();showError('');form.hidden=false;$('staffSaved').hidden=true;form.querySelector('[name=category]').focus();});
})();