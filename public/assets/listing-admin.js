(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const endpoint=id=>'/api/admin/submissions/'+encodeURIComponent(id)+'/listing';
 const field=(label,name,value='',type='text')=>'<label>'+esc(label)+'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'" maxlength="900"></label>';
 const textarea=(label,name,value='',rows=4)=>'<label class="span-all">'+esc(label)+'<textarea name="'+name+'" rows="'+rows+'">'+esc(value)+'</textarea></label>';
 function render(id,state){
  const target=document.querySelector('#editForm');if(!target)return;
  document.querySelector('#restyleListing')?.remove();
  const div=document.createElement('section');div.id='restyleListing';div.className='detail-editor';
  const d=state.draft,gates=state.gates||[],draftGates=state.draftGates||gates,facts=d?.verifiedFacts||{};
  let html='<h3>AI eBay Listing Studio <span class="pilot-tag">NO PUBLISHING</span></h3><p>Prepare a factual title, description, category suggestion and item specifics. Samantha reviews every draft before future eBay publishing is enabled.</p>';
  if(draftGates.length)html+='<p class="admin-error" style="display:block">Complete before generating: '+esc(draftGates.join(' · '))+'</p>';
  else html+='<p class="save-notice">Agreement and submission checks passed. You can prepare a preliminary draft; final approval still requires warehouse inspection.</p>';
  html+='<section id="listingPhotoManager" class="listing-photo-manager"><h4>Listing photos</h4><p class="detail-meta">Customer photos remain unchanged. Add warehouse photos and choose which images to use in the listing.</p><div id="listingPhotoGallery" class="listing-photo-gallery">Loading photos…</div><label>Upload warehouse photos (up to 5 at once)<input type="file" id="warehousePhotoInput" accept="image/jpeg,image/png,image/webp" multiple></label><div class="editor-actions"><button class="btn btn-outline" type="button" id="warehouseUploadButton">Upload photos</button><button class="btn btn-outline" type="button" id="listingPhotoSave">Save listing photo selection</button></div><p id="listingPhotoMessage" role="status" class="save-notice"></p></section>';
  html+='<form id="listingGenerate"><div class="editor-grid">'+field('Verified item type','itemType',facts.category||'')+field('Verified color','color',facts.color||'')+'</div><details class="listing-extra-facts"><summary>Additional item details (optional)</summary><div class="editor-grid">'+field('Verified size','size',facts.size||'')+field('Verified material','material',facts.material||'')+textarea('Measurements','measurements',facts.measurements||'',2)+textarea('Observed flaws or wear','flaws',facts.flaws||'',2)+textarea('Other verified details','facts',facts.facts||'',2)+'</div></details>';
  html+='</form>';
  if(d){
   const approved=d.status==='REVIEWED';
   html+='<div class="listing-review-status '+(approved?'is-reviewed':'')+'"><strong>'+(approved?'✓ Staff reviewed — not published':'Draft awaiting staff review')+'</strong><p>'+(approved?'The draft is approved inside SHUKCHIC only. No eBay listing has been created. Editing will return it to draft.':'Check the title and description now. Final approval unlocks after warehouse receipt, inspection, SKU, bin and price/category checks.')+'</p></div>';
   html+='<form id="listingEdit"><h3>Listing details · '+esc(d.source==='ebay_ai'?'eBay AI draft':d.source==='ai'?'AI draft':'starter draft')+'</h3><div class="editor-grid">';
   html+=field('Listing title (80 characters)','title',d.title);
   html+=field('Asking price (USD)','price',d.price_cents?(d.price_cents/100).toFixed(2):'','number');
   html+='<label class="span-all">eBay category<div class="editor-grid" id="ebayCategoryLevels"><select id="ebayCategoryMain"><option value="">Choose category</option></select><select id="ebayCategorySub"><option value="">Choose subcategory</option></select></div><small id="ebayCategoryHint">Finding matching eBay categories…</small><input type="hidden" name="categorySuggestion" value="'+esc(d.category_hint||'')+'"><input type="hidden" name="categoryId" value="'+esc(d.category_id||'')+'"></label>';
   html+=textarea('Listing description','description',d.description,8);
   html+='</div><p class="detail-meta">Suggested item specifics: '+esc(Object.entries(d.aspects||{}).map(x=>x.join(': ')).join(' · ')||'None')+'</p><p class="detail-meta">To check: '+esc((d.checks||[]).join(' · '))+'</p>';
   if(gates.length||!d.price_cents||!d.category_id){
    const remaining=[...gates,...(!d.price_cents?['Save the asking price']:[]),...(!d.category_id?['Select and save the final eBay category']:[])];
    html+='<p class="detail-meta"><strong>Before approval:</strong> '+esc(remaining.join(' · '))+'. Save warehouse changes in the section above, then reopen this item.</p>';
   }else html+='<p class="save-notice">Warehouse and listing requirements are complete. Review the description and click Approve draft (internal only).</p>';
   html+='<div class="editor-actions"><button class="btn btn-outline" type="submit">Save draft</button><button class="btn btn-primary" type="button" id="listingApprove" '+(approved||gates.length||!d.price_cents||!d.category_id?'disabled':'')+'>'+(approved?'✓ Staff reviewed':'Approve draft (internal only)')+'</button></div>';
   html+='<p class="detail-meta">Save your work anytime. Category ID, asking price and warehouse verification are required only for approval. Nothing is published to eBay.</p></form>';
  }
  html+='<div class="listing-mapping-info"><strong>AI listing preparation</strong><p id="mappingResult" role="status">Checking the draft…</p><button class="btn btn-outline" id="mappingRegenerate" type="button">Regenerate AI listing</button></div>';  html+='<div id="listingFeedback" class="save-notice" role="status"></div>';
  div.innerHTML=html;target.insertAdjacentElement('afterend',div);
  const photoGallery=div.querySelector('#listingPhotoGallery'),photoMessage=div.querySelector('#listingPhotoMessage'),photoBase='/api/admin/submissions/'+encodeURIComponent(id)+'/listing-photos';
  let photoPool=null,chosenPhotos=[];
  const photoRequest=async(action,body)=>{
    const r=await fetch(photoBase+(action?'/'+action:''),{method:action?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(action?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(!r.ok)throw Error(data.error||'Photo request failed');return data;
  };
  function showPhotoGallery(){
    if(!photoPool)return;
    photoGallery.replaceChildren();
    const all=[...(photoPool.customer||[]),...(photoPool.warehouse||[])];
    const list=chosenPhotos.filter(p=>all.some(x=>x.id===p));
    const galleryList=document.createElement('div');galleryList.className='listing-photo-grid';
    all.forEach(photo=>{
      const card=document.createElement('div');card.className='listing-photo-card';
      const img=document.createElement('img');img.alt=photo.source==='warehouse'?'Warehouse photo':'Customer photo';
      img.src='/api/admin/'+(photo.source==='warehouse'?'warehouse-photos/':'photos/')+encodeURIComponent(photo.id);
      const selection=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=list.includes(photo.id);
      checkbox.addEventListener('change',()=>{if(checkbox.checked){if(chosenPhotos.length>=12){checkbox.checked=false;photoMessage.textContent='Select no more than 12 photos.';return;}chosenPhotos.push(photo.id);}else chosenPhotos=chosenPhotos.filter(x=>x!==photo.id);showPhotoGallery();});
      selection.append(checkbox,document.createTextNode(' '+(photo.source==='warehouse'?'Warehouse':'Customer')+(list.includes(photo.id)?' · '+(list.indexOf(photo.id)+1):'')));
      const reorder=document.createElement('div');reorder.className='listing-photo-order';
      for(const [label,offset] of [['↑',-1],['↓',1]]){
        const btn=document.createElement('button');btn.type='button';btn.className='small-button';btn.textContent=label;btn.title='Change image order';
        const position=chosenPhotos.indexOf(photo.id);btn.disabled=position<0||position+offset<0||position+offset>=chosenPhotos.length;
        btn.addEventListener('click',()=>{const i=chosenPhotos.indexOf(photo.id),j=i+offset;[chosenPhotos[i],chosenPhotos[j]]=[chosenPhotos[j],chosenPhotos[i]];showPhotoGallery();});
        reorder.append(btn);
      }
      card.append(img,selection,reorder);galleryList.append(card);
    });photoGallery.append(galleryList);
    const tip=document.createElement('p');tip.className='detail-meta';tip.textContent=chosenPhotos.length+' selected · Image #1 is the main listing photo. Changes apply to future AI generation after saving.';
    photoGallery.append(tip);
  }
  async function loadListingPhotos(){
    try{photoPool=await photoRequest();chosenPhotos=(photoPool.effective||[]).map(p=>p.id);showPhotoGallery();}
    catch(err){photoGallery.textContent='Cannot load listing photos: '+err.message;}
  }
  div.querySelector('#warehouseUploadButton').addEventListener('click',async()=>{
    const files=[...(div.querySelector('#warehousePhotoInput').files||[])];
    if(!files.length||files.length>5){photoMessage.textContent='Select 1–5 photos.';return;}
    if(files.some(x=>x.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(x.type))){photoMessage.textContent='Use JPEG, PNG or WebP, each 5MB or less.';return;}
    const btn=div.querySelector('#warehouseUploadButton');btn.disabled=true;photoMessage.textContent='Uploading warehouse photos…';
    try{
      const photos=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({data:reader.result});reader.onerror=()=>reject(new Error('Cannot read image'));reader.readAsDataURL(file);})));
      const before=new Set([...(photoPool?.warehouse||[])].map(p=>p.id));
      photoPool=await photoRequest('upload',{photos});
      // Newly uploaded photos are selected by default; customer originals remain intact.
      chosenPhotos.push(...photoPool.warehouse.filter(p=>!before.has(p.id)).map(p=>p.id));
      if(chosenPhotos.length>12)chosenPhotos=chosenPhotos.slice(0,12);
      showPhotoGallery();div.querySelector('#warehousePhotoInput').value='';
      photoMessage.textContent='Warehouse photos uploaded. Choose/order your listing photos, then save selection.';
    }catch(err){photoMessage.textContent=err.message;}finally{btn.disabled=false;}
  });
  div.querySelector('#listingPhotoSave').addEventListener('click',async()=>{
    if(chosenPhotos.length===0){photoMessage.textContent='Select at least one listing photo.';return;}
    const btn=div.querySelector('#listingPhotoSave');btn.disabled=true;
    try{photoPool=await photoRequest('select',{ids:chosenPhotos});chosenPhotos=photoPool.effective.map(p=>p.id);showPhotoGallery();photoMessage.textContent='Listing photos saved. Customer uploads remain unchanged.';}
    catch(err){photoMessage.textContent=err.message;}finally{btn.disabled=false;}
  });
  loadListingPhotos();
  const feedback=div.querySelector('#listingFeedback');
  const mappingNode=div.querySelector('#mappingResult');
  const aiUrl='/api/admin/submissions/'+encodeURIComponent(id)+'/ebay-ai';
  let stopped=false, attempts=0;
  const status=node=>{if(!stopped)mappingNode.textContent=node;};
  const request=async(op,details={})=>{
    const r=await fetch(aiUrl+(op?'/'+op:''),{method:op?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(op?{body:JSON.stringify(details)}:{})});
    const data=await r.json();if(!r.ok)throw Error(data.error||'eBay AI unavailable');return data;
  };
  async function syncAI(){
    if(stopped||!document.contains(div))return;
    try{
      let data=await request('');
      if(!data.connected){status('Connect eBay AI in connection settings to generate suggestions.');return;}
      if(!data.task){
        if(draftGates.length){status('Waiting for item acceptance, signed agreement and photos.');return;}
        status('Preparing AI listing from your photos and item details…');
        data=await request('start',{itemType:div.querySelector('[name=itemType]')?.value||'',color:div.querySelector('[name=color]')?.value||''});
      }
      if(data.task?.status==='PENDING'){
        status('eBay AI is preparing the listing…');
        data=await request('poll',{itemType:div.querySelector('[name=itemType]')?.value||''});
      }
      if(data.task?.status==='COMPLETED'){
        if(!d && !data.listing)data=await request('poll',{itemType:div.querySelector('[name=itemType]')?.value||''});
        if(!d && data.listing?.draft){stopped=true;render(id,data.listing);return;}
        status('AI draft ready. Review and edit the listing details above.');
        return;
      }
      if(data.task?.status==='REVIEW_REQUIRED'){status('AI needs staff review. Existing draft is unchanged.');return;}
      if(attempts++<15)setTimeout(syncAI,4000);
      else status('AI is still processing. Reopen this item to check again.');
    }catch(err){status('AI listing preparation: '+err.message);}
  }
  div.querySelector('#mappingRegenerate')?.addEventListener('click',async()=>{
    if(!confirm('Generate new recommendations? Your saved edits will be kept until you explicitly choose to replace them.'))return;
    try{
      status('Requesting new AI recommendations…');
      const data=await request('start',{regenerate:true,itemType:div.querySelector('[name=itemType]')?.value||'',color:div.querySelector('[name=color]')?.value||''});
      if(data.task){attempts=0;syncAI();}
    }catch(err){status(err.message);}
  });
  syncAI();
  async function act(op,payload){
   feedback.textContent='Processing…';
   const result=await fetch(endpoint(id)+'/'+op,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
   const data=await result.json();if(!result.ok)throw Error(data.error||'Unable to complete listing action.');
   if(op==='save'){feedback.textContent='Draft saved successfully. You can continue editing later.';feedback.setAttribute('role','status');return;}
   render(id,data);const node=document.querySelector('#listingFeedback');if(node)node.textContent='Draft approved internally. Nothing published to eBay.';
  }
  const edit=div.querySelector('#listingEdit');
  if(edit){
   const main=edit.querySelector('#ebayCategoryMain'),sub=edit.querySelector('#ebayCategorySub'),hint=edit.querySelector('#ebayCategoryHint');
   const itemType=div.querySelector('[name=itemType]')?.value?.trim()||d.category_hint||'jewelry';
   const savedCategoryId=String(d.category_id||'');
   const savedPath=String(d.category_hint||'').includes(' › ')?String(d.category_hint).split(' › '):[];
   let paths=[];
   const wrap=sub.parentNode;
   function clearSelection(){edit.elements.categoryId.value='';}
   function renderLevel(level,prefix){
     // Only final eBay leaf categories can be saved. Non-leaf levels reveal the next dropdown.
     for(const element of [...wrap.querySelectorAll('[data-category-level]')])if(Number(element.dataset.categoryLevel)>=level)element.remove();
     const candidates=paths.filter(p=>prefix.every((name,index)=>p.parts[index]===name));
     const values=[...new Set(candidates.map(p=>p.parts[level]).filter(Boolean))];
     if(!values.length)return;
     const select=level===0?main:level===1?sub:document.createElement('select');
     if(level>1){select.dataset.categoryLevel=String(level);select.setAttribute('aria-label','eBay subcategory level '+(level+1));wrap.append(select);}
     select.replaceChildren(new Option(level===0?'Choose category':'Choose subcategory',''));
     for(const name of values)select.add(new Option(name,name));
     select.onchange=()=>{
       clearSelection();
       for(const el of [...wrap.querySelectorAll('[data-category-level]')])if(Number(el.dataset.categoryLevel)>level)el.remove();
       const value=select.value;
       if(!value){for(const el of [...wrap.querySelectorAll('[data-category-level]')])if(Number(el.dataset.categoryLevel)>level)el.remove();return;}
       const chosen=[...prefix,value];
       edit.elements.categorySuggestion.value=chosen.join(' › ');
       hint.textContent='Selected: '+chosen.join(' › ')+(chosen.length<3?' · continue to a final category':'');
       const match=paths.find(p=>p.parts.length===chosen.length&&chosen.every((name,i)=>p.parts[i]===name));
       if(match){edit.elements.categoryId.value=match.id;hint.textContent='Selected final category: '+chosen.join(' › ');}
       else{hint.textContent='Continue to the final eBay subcategory';renderLevel(level+1,chosen);}
     };
   }
   async function loadCategories(){
     hint.textContent='Loading eBay categories…';
     try{
       const resp=await fetch('/api/admin/ebay/category-suggestions?q='+encodeURIComponent(itemType),{credentials:'same-origin'});
       const data=await resp.json();if(!resp.ok)throw Error(data.error||'eBay categories unavailable');
       paths=(data.categories||[]).map(c=>({id:c.id,name:c.name,parts:[...(c.path||'Jewelry & Watches').split(' › ').filter(Boolean),c.name]}));
       if(!paths.length){hint.textContent='No matching categories found.';return;}
       renderLevel(0,[]);
       const saved=paths.find(p=>p.id===savedCategoryId);
       const restoreParts=saved?.parts||savedPath;
       if(restoreParts.length){
         for(let level=0;level<restoreParts.length;level++){
           const select=level===0?main:level===1?sub:wrap.querySelector('[data-category-level="'+level+'"]');
           if(!select||![...select.options].some(o=>o.value===restoreParts[level]))break;
           select.value=restoreParts[level];
           select.dispatchEvent(new Event('change'));
         }
         if(saved){edit.elements.categoryId.value=saved.id;edit.elements.categorySuggestion.value=saved.parts.join(' › ');}
         hint.textContent=saved?'Selected: '+saved.parts.join(' › '):'Saved selection: '+restoreParts.join(' › ')+' — continue to final category';
       }else if(savedCategoryId){
         edit.elements.categoryId.value=savedCategoryId;
         hint.textContent='Saved eBay category #'+savedCategoryId+' (not in current suggestions).';
       }else hint.textContent='Choose each level until the final subcategory.';
     }catch(err){hint.textContent='eBay category lookup unavailable: '+err.message;}
   }
   if(d.category_id)hint.textContent='Saved eBay category #'+d.category_id+'. Change the dropdowns only if needed.';
   loadCategories();
   edit.addEventListener('submit',async event=>{
    event.preventDefault();const b={};for(const name of ['title','price','description','categorySuggestion','categoryId'])b[name]=edit.elements[name].value;
    const btn=edit.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
    try{await act('save',b);}catch(err){feedback.textContent=err.message;}finally{if(btn)btn.disabled=false;}
   });
   edit.querySelector('#listingApprove').addEventListener('click',async()=>{try{await act('approve',{});}catch(err){feedback.textContent=err.message;}});
  }
 }
 window.restyleListingPanel={mount:render};
})();
