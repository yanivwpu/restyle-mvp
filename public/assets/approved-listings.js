(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const approved=$('#approvedListings'),grid=$('#approvedListingsGrid'),preview=$('#approvedListingPreview'),reload=$('#approvedListingsReload'),status=$('#approvedListingsStatus');
 if(!approved||!grid||!preview)return;
 const fetchData=async(url)=>{const response=await fetch(url,{credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;};
 const imageUrl=photo=>'/api/admin/'+(photo.source==='warehouse'?'warehouse-photos/':'photos/')+encodeURIComponent(photo.id);
 const currency=v=>v==null?'Price pending':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 async function load(){
   if(status)status.textContent='Refreshing listings…';
   try{
    const data=await fetchData('/api/admin/approved-listings');
    const list=data.items||[];
    $('#approvedListingsCount').textContent=list.filter(x=>x.review_status==='REVIEWED').length;
    if(status)status.textContent=list.length+' total · '+list.filter(x=>x.review_status==='REVIEWED').length+' staff reviewed · '+list.filter(x=>x.review_status!=='REVIEWED').length+' awaiting review';
    if(!list.length){grid.innerHTML='<p class="detail-meta">No listing drafts yet. Create an AI listing draft from an incoming item to see it here.</p>';return;}
    grid.replaceChildren();
    for(const item of list){
     const button=document.createElement('button');button.type='button';button.className='approved-item';
     const img=item.cover?'<img loading="lazy" src="'+esc(imageUrl(item.cover))+'" alt="">':'<span class="approved-no-photo">No photo</span>';
     button.innerHTML=img+'<span class="approved-item-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.id)+' · '+esc(item.category_hint||'Category to verify')+'</small><b>'+esc(currency(item.price_cents==null?null:item.price_cents/100))+'</b></span><span class="approved-status '+(item.review_status==='REVIEWED'?'is-reviewed':'')+'">'+(item.review_status==='REVIEWED'?'Staff reviewed':'Needs review')+'</span>';
     button.addEventListener('click',()=>show(item.id));
     grid.append(button);
    }
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
   preview.innerHTML='<div class="approved-preview-header"><h3>Listing preview</h3><button class="small-button" id="closeApprovedPreview" type="button" aria-label="Close listing preview">Close</button></div><div class="approved-preview-content"><div><div class="approved-image-wrap">'+imgHtml+'</div><div class="approved-image-strip">'+strip+'</div></div><div><h3>'+esc(d.title)+'</h3><strong class="approved-preview-price">'+esc(currency(d.price.amount))+'</strong><p class="detail-meta">Condition: '+esc(d.condition)+'</p><p class="detail-meta">Category: '+esc(d.category.label||'Unconfirmed')+'</p><p class="detail-meta">SKU: '+esc(d.sku)+'</p>'+specificsHtml+'<h4>Description</h4><p class="approved-preview-description">'+esc(d.description)+'</p></div></div><div class="approved-preview-buttons"><button type="button" class="btn btn-outline" id="approvedEdit">Edit listing</button><button class="btn btn-outline" type="button" id="approvedConnect">Connect eBay publishing</button><button class="btn btn-primary" type="button" id="approvedPublish" disabled>Publish to eBay</button></div><p class="detail-meta" id="approvedPublishStatus" role="status">Live publishing remains off. Connect eBay publishing access to verify the seller setup.</p>';
   const connectionButton=$('#approvedConnect'),publishMessage=$('#approvedPublishStatus');
   let publishingConnected=false;
   try{
    const status=await fetchData('/api/admin/ebay/publishing/status');
    publishingConnected=Boolean(status.connected);
    connectionButton.textContent=publishingConnected?'Check eBay seller setup':'Connect eBay publishing';
    publishMessage.textContent=publishingConnected?'Publishing authorization connected. Check seller settings before eBay offer creation. No listing has been published.':'Connect publishing authorization to prepare an unpublished eBay offer. Nothing will be published during connection.';
   }catch(err){publishMessage.textContent='eBay publishing status could not be checked: '+err.message;}
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
    }catch(err){publishMessage.textContent='eBay setup: '+err.message;}
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