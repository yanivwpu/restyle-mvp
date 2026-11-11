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
  if(batchPublish)batchPublish.disabled=batchSelected.size===0;
  grid.querySelectorAll('input[data-batch-id]').forEach(el=>{el.checked=batchSelected.has(el.dataset.batchId);});
 }
 const selectReviewed=$('#approvedBatchSelectReviewed');
 if(selectReviewed)selectReviewed.addEventListener('click',()=>{
  batchSelected.clear();
  for(const item of batchItems.filter(x=>x.review_status==='REVIEWED'&&x.ebay_offer_state!=='LIVE'&&x.ebay_offer_state!=='UNKNOWN').slice(0,25))batchSelected.add(item.id);
  updateBatchControls();
  batchResult.textContent=batchSelected.size+' reviewed listings selected. Choose Publish selected to eBay when ready.';
 });
 const clearBatch=$('#approvedBatchClear');
 if(clearBatch)clearBatch.addEventListener('click',()=>{batchSelected.clear();updateBatchControls();batchResult.textContent='Selection cleared. No changes made to eBay.';});
 async function runBatchPreflight(){
  if(batchSelected.size<1||batchSelected.size>25)return;
  batchCheck.disabled=true;batchResult.textContent='Checking selected listing drafts…';
  try{
   const response=await fetch('/api/admin/ebay/batch/preflight',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...batchSelected]})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error||'Batch check failed.');
   const failed=(data.items||[]).filter(x=>!x.localReady);
   const summary=data.localReady+' of '+data.total+' passed local review checks. No eBay offers created or published.';
   batchResult.replaceChildren();
   const heading=document.createElement('strong');heading.textContent=summary;batchResult.append(heading);
   if(failed.length){
    const reasons=document.createElement('ul');reasons.className='approved-preflight-issues';
    for(const item of failed){
     const line=document.createElement('li');
     const sku=document.createElement('strong');sku.textContent=(item.sku||item.id)+': ';
     line.append(sku,document.createTextNode((item.blockers||[]).join('; ')||'Needs staff review'));
     reasons.append(line);
    }
    batchResult.append(reasons);
   }
   for(const item of data.items||[]){
    const label=grid.querySelector('[data-batch-result="'+item.id+'"]');
    if(label)label.textContent=item.localReady?'Local checks passed (eBay validation still required)':'Needs edits — see reasons above';
   }
   return data;
  }catch(err){batchResult.textContent='Could not check batch: '+err.message;throw err;}
  finally{updateBatchControls();}
 }
 batchCheck.addEventListener('click',()=>{runBatchPreflight().catch(()=>{});});


 const livePanel=$('#approvedLiveReview'),liveSummary=$('#approvedLiveSummary'),liveProgress=$('#approvedLiveProgress');
 const liveConfirm=$('#approvedLiveConfirm');
 let pendingLiveId=null;
 const itemById=id=>batchItems.find(x=>x.id===id);
 function openLiveReview(id){
  const item=itemById(id);
  if(!item){batchResult.textContent='Refresh the listing queue and select one item.';return;}
  pendingLiveId=id;
  liveSummary.textContent=(item.title||item.sku)+' · '+currency(item.price_cents/100)+' · SKU '+item.sku;
  liveProgress.textContent='Your unpublished eBay offer is ready. No sale is live until you click Publish this item live.';
  livePanel.hidden=false;
  offerForm.hidden=true;
  livePanel.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 $('#approvedLiveCancel').addEventListener('click',()=>{
  pendingLiveId=null;livePanel.hidden=true;liveProgress.textContent='No publication requested.';
 });
 liveConfirm.addEventListener('click',async()=>{
  if(!pendingLiveId)return;
  const id=pendingLiveId;liveConfirm.disabled=true;
  liveProgress.textContent='Checking the unpublished offer and publishing this one item to eBay…';
  try{
   const state=await fetchData('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(id));
   if(state.state!=='PREPARED'||!state.livePublishAvailable)throw Error('This item is not ready for live publication. Check the listing status.');
   const response=await fetch('/api/admin/ebay/offers/publish/'+encodeURIComponent(id),{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'PUBLISH_SELECTED_TO_EBAY'})
   });
   const data=await response.json();if(!response.ok)throw Error(data.error||'eBay rejected publication.');
   if(!/^\d{5,30}$/.test(String(data.listingId||'')))throw Error('No verified eBay listing ID was returned. Check its state before retrying.');
   pendingLiveId=null;livePanel.hidden=true;batchSelected.clear();await load();
   batchResult.replaceChildren(document.createTextNode('Live on eBay. '));
   const link=document.createElement('a');link.href='https://www.ebay.com/itm/'+data.listingId;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View listing '+data.listingId;
   batchResult.append(link);
  }catch(err){
   await load();pendingLiveId=null;livePanel.hidden=true;batchSelected.clear();updateBatchControls();
   batchResult.textContent='Publication stopped: '+err.message+' Review the refreshed listing status before attempting another action.';
  }finally{liveConfirm.disabled=false;}
 });
 const batchPublish=$('#approvedBatchPublish');
 const offerForm=$('#approvedBatchOfferForm'),offerSetup=$('#approvedBatchOfferSetup');
 const offerRows=$('#approvedOfferParcelRows'),offerProgress=$('#approvedOfferProgress'),offerConfirm=$('#approvedOfferConfirm');
 function fillOfferOptions(element,items,placeholder){
  element.replaceChildren();
  const first=document.createElement('option');first.value='';first.textContent=placeholder;element.append(first);
  for(const x of items||[]){const option=document.createElement('option');option.value=x.id;option.textContent=(x.name||x.id)+' ('+x.id+')';element.append(option);}
 }
 offerSetup.addEventListener('click',async()=>{
  if(!batchSelected.size)return;
  offerSetup.disabled=true;
  offerForm.hidden=true;
  livePanel.hidden=true;
  try{
   const statuses=await Promise.all([...batchSelected].map(id=>fetchData('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(id))));
   if(statuses.some(x=>x.state==='UNKNOWN'||x.state==='LIVE'||x.state==='PREPARING'||x.state==='PUBLISHING'))
    throw Error('Selected item has an existing or uncertain eBay state. Review its status before continuing.');
   if(statuses.every(x=>x.state==='PREPARED')){
    if(statuses.every(x=>x.livePublishAvailable)){
     offerSetup.disabled=false;
     openLiveReview([...batchSelected][0]);
    }else{
     batchResult.textContent='Unpublished eBay offers are ready. Live publishing is disabled in this environment.';
    }
    return;
   }
   if(statuses.some(x=>x.state==='PREPARED'))
    throw Error('This selection mixes prepared and new offers. Select only one group at a time.');
   const validation=await runBatchPreflight();
   if(!validation||validation.localReady!==validation.total){
    batchResult.textContent+=' Please edit the flagged listing before publishing.';
    return;
   }
   offerProgress.textContent='Loading your saved eBay settings…';
   const data=await fetchData('/api/admin/ebay/publishing/setup');
   if(!data.connected)throw Error('Reconnect eBay publishing permission first.');
   const selectedItems=[...batchSelected].map(id=>batchItems.find(x=>x.id===id)).filter(Boolean);
   const merchantItems=selectedItems.filter(x=>x.intake_source==='MERCHANT');
   if(merchantItems.length&&selectedItems.length!==1)throw Error('Prepare merchant listings individually so each boutique uses its correct ship-from location.');
   if(merchantItems.length&&!merchantItems[0].merchant_location_key)throw Error('Set up and verify this boutique eBay shipping location under Merchant partners before preparing the listing.');
   const expectedLocation=merchantItems.length?merchantItems[0].merchant_location_key:'US_34778';
   const sources=[
    ['#approvedOfferPayment',data.policies?.payment,'Select payment','SHUKCHIC - Immediate Payment'],
    ['#approvedOfferShipping',data.policies?.fulfillment,'Select shipping','SHUKCHIC - Standard Domestic Shipping'],
    ['#approvedOfferReturns',data.policies?.returns,'Select returns','SHUKCHIC - 30 Day Buyer Paid Returns'],
    ['#approvedOfferLocation',data.locations,'Select eBay location',expectedLocation]
   ];
   const ambiguous=[];
   for(const [id,value,label,preferred] of sources){
    if(!value?.available)throw Error('eBay '+label.toLowerCase()+' details not available.');
    fillOfferOptions($(id),value.items,label);
    const matches=(value.items||[]).filter(x=>id==='#approvedOfferLocation'?
      x.id===preferred||x.name===preferred:x.name===preferred);
    if(matches.length===1)$(id).value=matches[0].id;
    else if((value.items||[]).length===1)$(id).value=value.items[0].id;
    else ambiguous.push(label.toLowerCase());
   }
   $('#approvedOfferAdvanced').open=ambiguous.length>0||merchantItems.length>0;
   $('#approvedOfferDefaultsSummary').textContent=ambiguous.length?
     'Select '+ambiguous.join(', ')+' in the settings below. SHUKCHIC will reuse your choices for this batch.':
     (merchantItems.length?'Using this boutique’s verified ship-from location in eBay. Confirm its shipping policy and actual parcel details.':'Using SHUKCHIC’s existing eBay payment, shipping, return and warehouse settings.');
   offerRows.replaceChildren();
   for(const id of batchSelected){
    const item=batchItems.find(x=>x.id===id);
    const row=document.createElement('div');row.className='approved-parcel-row';row.dataset.offerItem=id;
    const heading=document.createElement('strong');heading.textContent=(item?.sku||id)+' — '+(item?.title||'Item');
    row.append(heading);
    for(const [field,label] of [['weightOz','Packed weight (oz)'],['lengthIn','Length (in)'],['widthIn','Width (in)'],['heightIn','Height (in)']]){
     const wrap=document.createElement('label');wrap.textContent=label;
     const input=document.createElement('input');input.type='number';input.required=true;input.min=field==='weightOz'?'1':'0.1';input.max=field==='weightOz'?'2400':'120';input.step=field==='weightOz'?'1':'0.1';input.dataset.parcelField=field;
     wrap.append(input);row.append(wrap);
    }
    offerRows.append(row);
   }
   $('#approvedOfferFormTitle').textContent='Shipping package details';
   $('#approvedOfferIntro').textContent='Enter the real packed weight rounded UP to whole ounces, and the box dimensions, once. SHUKCHIC automatically reuses your saved eBay policies. This first action saves an unpublished offer; a separate review lets you make it live.';
   offerProgress.textContent='Nothing will go live from this step.';
   offerForm.hidden=false;
   offerConfirm.disabled=false;
  }catch(err){batchResult.textContent='Cannot continue to eBay: '+err.message;offerConfirm.disabled=true;}
  finally{offerSetup.disabled=false;}
 });
 $('#approvedOfferCancel').addEventListener('click',()=>{offerForm.hidden=true;offerProgress.textContent='Preparation cancelled. No listings were created.';});
 offerConfirm.addEventListener('click',async()=>{
  const controls=[['paymentPolicyId','#approvedOfferPayment'],['fulfillmentPolicyId','#approvedOfferShipping'],['returnPolicyId','#approvedOfferReturns']];
  const policies=Object.fromEntries(controls.map(([key,id])=>[key,$(id).value]));
  const merchantLocationKey=$('#approvedOfferLocation').value;
  if(Object.values(policies).some(x=>!x)||!merchantLocationKey){offerProgress.textContent='Choose every eBay policy and location.';return;}
  const selected=[...offerRows.querySelectorAll('[data-offer-item]')];
  const parcels=selected.map(row=>({id:row.dataset.offerItem,parcel:Object.fromEntries([...row.querySelectorAll('[data-parcel-field]')].map(input=>[input.dataset.parcelField,Number(input.value)]))}));
  if(parcels.some(x=>Object.values(x.parcel).some(n=>!Number.isFinite(n)||n<=0)||!Number.isSafeInteger(x.parcel.weightOz))){offerProgress.textContent='Enter actual packed weight rounded UP to whole ounces, plus the package dimensions.';return;}
  // Clicking Create unpublished eBay offer is the explicit in-page authorization; no browser modal.
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
  offerProgress.textContent=completed+' unpublished offers prepared successfully. Checking whether live publishing is enabled…';
  offerSetup.disabled=false;
  await load();
  try{
   const states=await Promise.all(parcels.map(x=>fetchData('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(x.id))));
   if(states.every(x=>x.livePublishAvailable)){
    offerProgress.textContent='Unpublished offers are ready for Samantha’s final publishing confirmation.';
    openLiveReview(parcels[0].id);
   }else{
    offerProgress.textContent=completed+' unpublished offers saved in eBay. Live publishing is disabled in this environment; no buyer can purchase them yet.';
   }
  }catch(err){offerProgress.textContent='Offers prepared, but publish readiness could not be verified: '+err.message;}
 });
 batchPublish.addEventListener('click',async()=>{
  const ids=[...batchSelected];
  if(ids.length!==1){batchResult.textContent='Open one reviewed item at a time to publish.';return;}
  try{
   const state=await fetchData('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(ids[0]));
   if(state.state!=='PREPARED'||!state.livePublishAvailable)throw Error('An authorized, unpublished offer is required.');
   openLiveReview(ids[0]);
  }catch(err){batchResult.textContent='Cannot publish: '+err.message;}
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
     checkbox.setAttribute('aria-label','Select '+item.title+' for batch validation');checkbox.checked=batchSelected.has(item.id);checkbox.disabled=['LIVE','UNKNOWN','BLOCKED_READ_ONLY','PREPARING','PUBLISHING'].includes(item.ebay_offer_state);
     checkbox.addEventListener('change',()=>{
      if(checkbox.checked&&batchSelected.size>=25){checkbox.checked=false;batchResult.textContent='Select up to 25 items at a time.';return;}
      if(checkbox.checked)batchSelected.add(item.id);else batchSelected.delete(item.id);
      updateBatchControls();
      batchResult.textContent=batchSelected.size+' selected. Choose Publish selected to eBay when ready.';
     });
     const button=document.createElement('button');button.type='button';button.className='approved-item';
     const img=item.cover?'<img loading="lazy" src="'+esc(imageUrl(item.cover))+'" alt="">':'<span class="approved-no-photo">No photo</span>';
     button.innerHTML=img+'<span class="approved-item-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.id)+' · '+esc(item.category_hint||'Category to verify')+'</small><b>'+esc(currency(item.price_cents==null?null:item.price_cents/100))+'</b></span><span class="approved-status '+(item.ebay_offer_state==='UNKNOWN'||item.ebay_offer_state==='BLOCKED_READ_ONLY'?'is-blocked':item.review_status==='REVIEWED'?'is-reviewed':'')+'">'+(item.ebay_offer_state==='LIVE'?'Live on eBay':item.ebay_offer_state==='PREPARED'?'Unpublished offer ready':item.ebay_offer_state==='UNKNOWN'?'eBay status needs review':item.ebay_offer_state==='BLOCKED_READ_ONLY'?'eBay validation blocked':item.review_status==='REVIEWED'?'Staff reviewed':'Needs review')+'</span>';
     button.addEventListener('click',()=>show(item.id));
     const feedback=document.createElement('small');feedback.className='approved-batch-feedback';feedback.dataset.batchResult=item.id;
     if(item.ebay_offer_state==='UNKNOWN'){
      feedback.textContent=item.style_fix_available===true?'eBay requires a Style item specific. Confirm the value below to repair the existing unpublished offer.':
       'Publication needs reconciliation. SHUKCHIC will not retry until the saved eBay status is verified.';
     }
     if(item.ebay_offer_state==='UNKNOWN'&&item.weight_fix_available===true){
      feedback.textContent='eBay rejected the saved shipping weight. Enter Samantha’s actual packed weight in whole ounces; the existing unpublished offer will be updated, not recreated.';
      const fixWeight=document.createElement('button');fixWeight.type='button';
      fixWeight.className='small-button approved-style-fix';fixWeight.textContent='Correct shipping weight';
      fixWeight.addEventListener('click',async()=>{
       if(!fixWeight.dataset.ready){
        const field=document.createElement('input');field.type='number';field.min='1';field.max='2400';field.step='1';
        field.placeholder='Packed weight (oz)';field.setAttribute('aria-label','Packed shipping weight in whole ounces');
        field.className='approved-inline-correction';fixWeight.before(field);
        fixWeight.dataset.ready='1';fixWeight.textContent='Save shipping weight';field.focus();return;
       }
       const field=wrapper.querySelector('.approved-inline-correction');
       const oz=Number(field?.value);
       if(!field?.value||!Number.isSafeInteger(oz)||oz<1||oz>2400){batchResult.textContent='Enter the real packed weight rounded up to a whole ounce (1–2400 oz).';return;}
       fixWeight.disabled=true;batchResult.textContent='Verifying existing eBay offer and correcting the package weight…';
       try{
        const res=await fetch('/api/admin/ebay/offers/fix-weight/'+encodeURIComponent(item.id),{
         method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ounces:oz})
        });
        const result=await res.json();
        if(!res.ok)throw Error(result.error||'Weight correction failed.');
        batchSelected.clear();await load();
        batchResult.textContent='Shipping weight updated on the existing unpublished eBay offer. Samantha can now confirm live publication again.';
       }catch(err){batchResult.textContent='Weight correction stopped: '+err.message+' Do not retry until the eBay status is reconciled.';fixWeight.disabled=false;}
      });
      wrapper.append(checkbox,button,fixWeight,feedback);
     }else      if(item.ebay_offer_state==='UNKNOWN'&&item.style_fix_available===true){
      const fix=document.createElement('button');fix.type='button';fix.className='small-button approved-style-fix';
      fix.textContent='Add required Style';
      fix.addEventListener('click',async()=>{
       if(!fix.dataset.ready){
        const input=document.createElement('input');input.type='text';input.maxLength=70;
        input.placeholder='Verified Style';input.setAttribute('aria-label','Verified eBay Style');
        input.className='approved-inline-correction';fix.before(input);
        fix.dataset.ready='1';fix.textContent='Save Style';input.focus();return;
       }
       const style=(wrapper.querySelector('.approved-inline-correction')?.value||'').trim();
       if(!style||style.length>70){batchResult.textContent='Enter Samantha’s verified Style (up to 70 characters).';return;}
       fix.disabled=true;batchResult.textContent='Checking the existing eBay offer and updating Style…';
       try{
        const response=await fetch('/api/admin/ebay/offers/fix-style/'+encodeURIComponent(item.id),{
         method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({style})
        });
        const result=await response.json();
        if(!response.ok)throw Error(result.error||'Style update failed.');
        batchSelected.clear();await load();
        batchResult.textContent='Style saved on the existing eBay inventory item. Offer is ready for Samantha’s final publishing confirmation.';
       }catch(err){batchResult.textContent='Style correction stopped: '+err.message+' Do not retry until the eBay state has been verified.';fix.disabled=false;}
      });
      wrapper.append(checkbox,button,fix,feedback);
     }else wrapper.append(checkbox,button,feedback);
     grid.append(wrapper);
    
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
   preview.innerHTML='<div class="approved-preview-header"><h3>Listing preview</h3><button class="small-button" id="closeApprovedPreview" type="button" aria-label="Close listing preview">Close</button></div><div class="approved-preview-content"><div><div class="approved-image-wrap">'+imgHtml+'</div><div class="approved-image-strip">'+strip+'</div></div><div><h3>'+esc(d.title)+'</h3><strong class="approved-preview-price">'+esc(currency(d.price.amount))+'</strong><p class="detail-meta">Condition: '+esc(d.condition)+'</p><p class="detail-meta">Category: '+esc(d.category.label||'Unconfirmed')+'</p><p class="detail-meta">SKU: '+esc(d.sku)+'</p>'+specificsHtml+'<h4>Description</h4><p class="approved-preview-description">'+esc(d.description)+'</p></div></div><div class="approved-preview-buttons"><button type="button" class="btn btn-outline" id="approvedEdit">Edit listing</button><button class="btn btn-primary" type="button" id="approvedPublish" disabled>Publish to eBay</button></div><p class="detail-meta" id="approvedPublishStatus" role="status">Live publishing remains off. Connect eBay publishing access to verify the seller setup.</p>';
   const publishMessage=$('#approvedPublishStatus');
   publishMessage.textContent='SHUKCHIC automatically checks listing readiness and eBay settings when you publish.';
   const publishButton=$('#approvedPublish');
   let offerState=null;
   try{
    offerState=await fetchData('/api/admin/ebay/unpublished-offers/'+encodeURIComponent(id));
    if(offerState.state==='UNKNOWN'||offerState.state==='PREPARING'||offerState.state==='PUBLISHING'){
     publishMessage.textContent='This listing needs an eBay connection review before another publishing attempt.';
     publishButton.disabled=true;
    }else if(offerState.state==='LIVE'&&/^\d{5,30}$/.test(offerState.listingId||'')){
     const link=document.createElement('a');link.href='https://www.ebay.com/itm/'+offerState.listingId;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View live listing on eBay';
     publishMessage.replaceChildren(link);
     publishButton.disabled=true;
    }else if(d.reviewStatus==='REVIEWED'){
     publishButton.disabled=false;
     publishMessage.textContent=offerState.state==='PREPARED'?
       'Offer prepared. Live publishing will require Samantha’s final approval.':
       'Staff reviewed. Choose Publish to eBay to continue; SHUKCHIC will handle the technical setup.';
    }else{
     publishMessage.textContent='Finish staff review before publishing.';
    }
   }catch(err){publishMessage.textContent='Unable to check eBay listing status: '+err.message;}
   publishButton.addEventListener('click',()=>{
    if(publishButton.disabled)return;
    batchSelected.clear();batchSelected.add(id);updateBatchControls();
    preview.hidden=true;
    offerForm.hidden=true;
    offerSetup.click();
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