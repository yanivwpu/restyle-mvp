(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const approved=$('#approvedListings'),grid=$('#approvedListingsGrid'),preview=$('#approvedListingPreview'),reload=$('#approvedListingsReload'),status=$('#approvedListingsStatus');
 if(!approved||!grid||!preview)return;
 const fetchData=async(url)=>{const response=await fetch(url,{credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;};
 const imageUrl=photo=>'/api/admin/'+(photo.source==='warehouse'?'warehouse-photos/':'photos/')+encodeURIComponent(photo.id);
 const currency=v=>v==null?'Price pending':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 const batchSelected=new Set();
 let batchItems=[];
 const batchCount=$('#approvedBatchSelected'),batchCheck=$('#approvedBatchPreflight'),batchResult=$('#approvedBatchResults');
 function updateBatchControls(){
  batchCount.textContent=batchSelected.size+' selected (maximum 25)';
  batchCheck.disabled=batchSelected.size===0;
  if(offerSetup)offerSetup.disabled=batchSelected.size===0;
  grid.querySelectorAll('input[data-batch-id]').forEach(el=>{el.checked=batchSelected.has(el.dataset.batchId);});
 }
 const selectReviewed=$('#approvedBatchSelectReviewed');
 if(selectReviewed)selectReviewed.addEventListener('click',()=>{
  batchSelected.clear();
  for(const item of batchItems.filter(x=>x.review_status==='REVIEWED').slice(0,25))batchSelected.add(item.id);
  updateBatchControls();
 });
 const clearBatch=$('#approvedBatchClear');
 if(clearBatch)clearBatch.addEventListener('click',()=>{batchSelected.clear();updateBatchControls();batchResult.textContent='Selection cleared. No changes made to eBay.';});
 batchCheck.addEventListener('click',async()=>{
  if(batchSelected.size<1||batchSelected.size>25)return;
  batchCheck.disabled=true;batchResult.textContent='Checking selected listing drafts…';
  try{
   const response=await fetch('/api/admin/ebay/batch/preflight',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...batchSelected]})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Batch check failed.');
   const failed=(data.items||[]).filter(x=>!x.localReady);
   batchResult.textContent=data.localReady+' of '+data.total+' passed local review checks. '+(failed.length?failed.map(x=>x.sku||x.id).slice(0,5).join(', ')+' need edits. ':'')+'No eBay offers created or published.';
   for(const item of data.items||[]){
    const label=grid.querySelector('[data-batch-result="'+item.id+'"]');
    if(label)label.textContent=item.localReady?'Local checks passed (eBay validation still required)':item.blockers.join('; ');
   }
  }catch(err){batchResult.textContent='Could not check batch: '+err.message;}
  finally{updateBatchControls();}
 });


 const offerForm=$('#approvedBatchOfferForm'),offerSetup=$('#approvedBatchOfferSetup');
 const offerRows=$('#approvedOfferParcelRows'),offerProgress=$('#approvedOfferProgress'),offerConfirm=$('#approvedOfferConfirm');
 function fillOfferOptions(element,items,placeholder){
  element.replaceChildren();
  const first=document.createElement('option');first.value='';first.textContent=placeholder;element.append(first);
  for(const x of items||[]){const option=document.createElement('option');option.value=x.id;option.textContent=(x.name||x.id)+' ('+x.id+')';element.append(option);}
 }
 offerSetup.addEventListener('click',async()=>{
  offerProgress.textContent='Reading eBay policies and locations…';
  offerForm.hidden=false;
  try{
   const data=await fetchData('/api/admin/ebay/publishing/setup');
   if(!data.connected)throw Error('Reconnect eBay publishing permission first.');
   const sources=[['#approvedOfferPayment',data.policies?.payment,'Select payment'],['#approvedOfferShipping',data.policies?.fulfillment,'Select shipping'],['#approvedOfferReturns',data.policies?.returns,'Select returns'],['#approvedOfferLocation',data.locations,'Select eBay location']];
   for(const [id,value,label] of sources){
    if(!value?.available)throw Error('eBay '+label.toLowerCase()+' details not available.');
    fillOfferOptions($(id),value.items,label);
   }
   offerRows.replaceChildren();
   for(const id of batchSelected){
    const item=batchItems.find(x=>x.id===id);
    const row=document.createElement('div');row.className='approved-parcel-row';row.dataset.offerItem=id;
    const heading=document.createElement('strong');heading.textContent=(item?.sku||id)+' — '+(item?.title||'Item');
    row.append(heading);
    for(const [field,label] of [['weightLb','Weight (lb)'],['lengthIn','Length (in)'],['widthIn','Width (in)'],['heightIn','Height (in)']]){
     const wrap=document.createElement('label');wrap.textContent=label;
     const input=document.createElement('input');input.type='number';input.required=true;input.min='0.01';input.max='150';input.step='0.01';input.dataset.parcelField=field;
     wrap.append(input);row.append(wrap);
    }
    offerRows.append(row);
   }
   offerProgress.textContent='No eBay offer has been created. Confirm the actual packed dimensions before preparing.';
  }catch(err){offerProgress.textContent='Cannot prepare eBay offers: '+err.message;offerConfirm.disabled=true;return;}
  offerConfirm.disabled=false;
 });
 $('#approvedOfferCancel').addEventListener('click',()=>{offerForm.hidden=true;offerProgress.textContent='Preparation cancelled. No listings were created.';});
 offerConfirm.addEventListener('click',async()=>{
  const controls=[['paymentPolicyId','#approvedOfferPayment'],['fulfillmentPolicyId','#approvedOfferShipping'],['returnPolicyId','#approvedOfferReturns']];
  const policies=Object.fromEntries(controls.map(([key,id])=>[key,$(id).value]));
  const merchantLocationKey=$('#approvedOfferLocation').value;
  if(Object.values(policies).some(x=>!x)||!merchantLocationKey){offerProgress.textContent='Choose every eBay policy and location.';return;}
  const selected=[...offerRows.querySelectorAll('[data-offer-item]')];
  const parcels=selected.map(row=>({id:row.dataset.offerItem,parcel:Object.fromEntries([...row.querySelectorAll('[data-parcel-field]')].map(input=>[input.dataset.parcelField,Number(input.value)]))}));
  if(parcels.some(x=>Object.values(x.parcel).some(n=>!Number.isFinite(n)||n<=0))){offerProgress.textContent='Enter the actual weight and dimensions for every selected item.';return;}
  if(!window.confirm('Prepare '+parcels.length+' UNPUBLISHED eBay offers? Inventory records and photos will be sent to eBay, but no listing will go live.'))return;
  offerConfirm.disabled=true;offerSetup.disabled=true;
  let completed=0;
  for(const entry of parcels){
   offerProgress.textContent='Preparing '+(completed+1)+' of '+parcels.length+'…';
   try{
    const response=await fetch('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(entry.id),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:{policies,merchantLocationKey,parcel:entry.parcel}})});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'eBay preparation failed.');
    completed++;
    const label=grid.querySelector('[data-batch-result="'+entry.id+'"]');
    if(label)label.textContent='Unpublished eBay offer '+data.offerId+' created. Not live.';
   }catch(err){
    offerProgress.textContent='Stopped after '+completed+' of '+parcels.length+' prepared. '+entry.id+': '+err.message+' Do not retry uncertain eBay writes until reconciled.';
    offerSetup.disabled=false;return;
   }
  }
  offerProgress.textContent=completed+' unpublished offers prepared successfully. Nothing has been published.';
  offerSetup.disabled=false;
 });
 async function load(){
   if(status)status.textContent='Refreshing listings…';
   try{
    const data=await fetchData('/api/admin/approved-listings');
    const list=data.items||[];
    batchItems=list;for(const id of [...batchSelected])if(!list.some(x=>x.id===id))batchSelected.delete(id);
    $('#approvedListingsCount').textContent=list.filter(x=>x.review_status==='REVIEWED').length;
    if(status)status.textContent=list.length+' total · '+list.filter(x=>x.review_status==='REVIEWED').length+' staff reviewed · '+list.filter(x=>x.review_status!=='REVIEWED').length+' awaiting review';
    if(!list.length){grid.innerHTML='<p class="detail-meta">No listing drafts yet. Create an AI listing draft from an incoming item to see it here.</p>';return;}
    grid.replaceChildren();
    for(const item of list){
     const wrapper=document.createElement('div');wrapper.className='approved-batch-row';
     const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.batchId=item.id;
     checkbox.setAttribute('aria-label','Select '+item.title+' for batch validation');checkbox.checked=batchSelected.has(item.id);
     checkbox.addEventListener('change',()=>{
      if(checkbox.checked&&batchSelected.size>=25){checkbox.checked=false;batchResult.textContent='Select up to 25 items at a time.';return;}
      if(checkbox.checked)batchSelected.add(item.id);else batchSelected.delete(item.id);
      updateBatchControls();
     });
     const button=document.createElement('button');button.type='button';button.className='approved-item';
     const img=item.cover?'<img loading="lazy" src="'+esc(imageUrl(item.cover))+'" alt="">':'<span class="approved-no-photo">No photo</span>';
     button.innerHTML=img+'<span class="approved-item-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.id)+' · '+esc(item.category_hint||'Category to verify')+'</small><b>'+esc(currency(item.price_cents==null?null:item.price_cents/100))+'</b></span><span class="approved-status '+(item.review_status==='REVIEWED'?'is-reviewed':'')+'">'+(item.review_status==='REVIEWED'?'Staff reviewed':'Needs review')+'</span>';
     button.addEventListener('click',()=>show(item.id));
     const feedback=document.createElement('small');feedback.className='approved-batch-feedback';feedback.dataset.batchResult=item.id;
     wrapper.append(checkbox,button,feedback);grid.append(wrapper);
    
    }
    updateBatchControls();
   }catch(err){if(status)status.textContent='Could not refresh: '+err.message; if(!grid.children.length)grid.textContent='Unable to load listings: '+err.message;}
 }
 async function show(id){
  preview.hidden=false;preview.innerHTML='<p class="detail-meta">Preparing listing preview…</p>';
  try{
   const d=await fetchData('/api/admin/approved-listings/'+encodeURIComponent(id)+'/preview');
   const images=d.photos||[],primary=images[0];
   const imgHtml=primary?'<img class="approved-preview-hero" src="'+esc(primary.url)+'" alt="Main listing photograph">':'<div class="approved-no-photo">No listing photo</div>';
   const strip=images.map((x,i)=>'<img src="'+esc(x.url)+'" alt="Listing photo '+(i+1)+'" loading="lazy">').join('');
   const specifics=Object.entries(d.itemSpecifics||{}).filter(([key,value])=>value!=null&&String(value).trim()&&['Color','Item type','Size','Material','Measurements','Known wear / flaws'].includes(key));
   const specificsHtml=specifics.length?'<div class="approved-specifics"><h4>Item details</h4><dl>'+specifics.map(([name,value])=>'<div><dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl></div>':'';
   // Keep all advisory checks on the server for future API validation, not as a to-do list in Samantha's preview.
   preview.innerHTML='<div class="approved-preview-header"><h3>Listing preview</h3><button class="small-button" id="closeApprovedPreview" type="button" aria-label="Close listing preview">Close</button></div><div class="approved-preview-content"><div><div class="approved-image-wrap">'+imgHtml+'</div><div class="approved-image-strip">'+strip+'</div></div><div><h3>'+esc(d.title)+'</h3><strong class="approved-preview-price">'+esc(currency(d.price.amount))+'</strong><p class="detail-meta">Condition: '+esc(d.condition)+'</p><p class="detail-meta">Category: '+esc(d.category.label||'Unconfirmed')+'</p><p class="detail-meta">SKU: '+esc(d.sku)+'</p>'+specificsHtml+'<h4>Description</h4><p class="approved-preview-description">'+esc(d.description)+'</p></div></div><div class="approved-preview-buttons"><button type="button" class="btn btn-outline" id="approvedEdit">Edit listing</button><button class="btn btn-outline" type="button" id="approvedConnect">Connect eBay publishing</button><button class="btn btn-outline" type="button" id="approvedRenewPublishing" hidden>Renew eBay publishing access</button><button class="btn btn-primary" type="button" id="approvedPublish" disabled>Publish to eBay</button></div><p class="detail-meta" id="approvedPublishStatus" role="status">Live publishing remains off. Connect eBay publishing access to verify the seller setup.</p>';
   const connectionButton=$('#approvedConnect'),renewPublishingButton=$('#approvedRenewPublishing'),publishMessage=$('#approvedPublishStatus');
   let publishingConnected=false;
   try{
    const status=await fetchData('/api/admin/ebay/publishing/status');
    publishingConnected=Boolean(status.connected);
    renewPublishingButton.hidden=!publishingConnected;
    connectionButton.textContent=publishingConnected?'Check eBay seller setup':'Connect eBay publishing';
    publishMessage.textContent=publishingConnected?'Publishing authorization connected. Check seller settings before eBay offer creation. No listing has been published.':'Connect publishing authorization to prepare an unpublished eBay offer. Nothing will be published during connection.';
   }catch(err){publishMessage.textContent='eBay publishing status could not be checked: '+err.message;}
   // A renamed seller can invalidate the separate publishing refresh token even when the standard seller token is healthy.
   // Starting consent again replaces the publishing token only after eBay verifies the same immutable seller ID.
   renewPublishingButton.addEventListener('click',async()=>{
    renewPublishingButton.disabled=true;
    publishMessage.textContent='Opening eBay to renew publishing authorization. No listing will be published.';
    try{
     const response=await fetch('/api/admin/ebay/oauth/publishing-start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
     const result=await response.json();
     if(!response.ok)throw Error(result.error||'Unable to start publishing authorization renewal.');
     if(!result.authorizationUrl||!result.authorizationUrl.startsWith('https://auth.ebay.com/'))throw Error('Invalid eBay authorization destination.');
     window.location.assign(result.authorizationUrl);
    }catch(err){publishMessage.textContent='eBay publishing authorization: '+err.message;renewPublishingButton.disabled=false;}
   });
   connectionButton.addEventListener('click',async()=>{
    connectionButton.disabled=true;
    publishMessage.textContent=publishingConnected?'Checking eBay seller policies and inventory locations…':'Opening eBay publishing authorization…';
    try{
     if(!publishingConnected){
      const response=await fetch('/api/admin/ebay/oauth/publishing-start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Unable to start eBay authorization.');
      if(!result.authorizationUrl||!result.authorizationUrl.startsWith('https://auth.ebay.com/'))throw Error('Invalid eBay authorization destination.');
      window.location.assign(result.authorizationUrl);
     }else{
      const data=await fetchData('/api/admin/ebay/publishing/setup');
      const types=[['shipping',data.policies?.fulfillment],['payment',data.policies?.payment],['returns',data.policies?.returns],['inventory locations',data.locations]];
      publishMessage.textContent=types.map(([name,value])=>{
       if(value?.available)return name+': '+value.items.length+' available';
       return name+': '+(value?.status?'eBay HTTP '+value.status:'connection issue')+(value?.codes?.length?' (error '+value.codes.join(', ')+')':'');
      }).join(' · ')+'. No listing created.';
      const failedPolicies=types.slice(0,3).filter(([_,value])=>!value?.available);
      if(failedPolicies.length){
       const allForbidden=failedPolicies.every(([_,value])=>value?.status===403);
       publishMessage.textContent+=' '+(allForbidden?'eBay has denied business-policy access. Check whether this seller is enrolled in eBay Business Policies and whether the app has Account API access.':'The error codes above will help identify missing permissions or seller setup.');
      }
     }
    }catch(err){publishMessage.textContent='eBay setup: '+err.message+(String(err.message||'').includes('invalid_grant')?' Renew the separate eBay publishing access, then recheck seller setup.':'');}
    finally{connectionButton.disabled=false;}
   });
   $('#closeApprovedPreview').addEventListener('click',()=>{preview.hidden=true;});
   $('#approvedEdit').addEventListener('click',()=>{
    approved.hidden=true;approved.setAttribute('aria-hidden','true');document.body.classList.remove('approved-modal-open');
    const row=Array.from(document.querySelectorAll('#itemList .item-row')).find(b=>b.dataset.submissionId===id);
    if(row){row.click();}
    else{
      // Set review filters to all; the list already has the submission.
      const filt=$('#filter'),search=$('#search');if(filt)filt.value='';if(search)search.value='';
      if(typeof window.shukchicOpenSubmission==='function')window.shukchicOpenSubmission(id);
    }
   });
  }catch(err){preview.innerHTML='<p class="admin-error">'+esc(err.message)+'</p>';}
 }
 const close=()=>{approved.hidden=true;approved.setAttribute('aria-hidden','true');document.body.classList.remove('approved-modal-open');};
 $('#showApprovedListings').addEventListener('click',()=>{approved.hidden=false;approved.removeAttribute('aria-hidden');document.body.classList.add('approved-modal-open');load();});
 $('#showIncomingItems').addEventListener('click',close);
 $('#approvedListingsClose')?.addEventListener('click',close);
 approved.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 reload?.addEventListener('click',load);
 window.shukchicRefreshApprovedListings=load;
})();