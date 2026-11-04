(function(){
 const $=s=>document.querySelector(s);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const approved=$('#approvedListings'),grid=$('#approvedListingsGrid'),preview=$('#approvedListingPreview'),reload=$('#approvedListingsReload');
 if(!approved||!grid||!preview)return;
 const fetchData=async(url)=>{const response=await fetch(url,{credentials:'same-origin'});const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;};
 const imageUrl=photo=>'/api/admin/'+(photo.source==='warehouse'?'warehouse-photos/':'photos/')+encodeURIComponent(photo.id);
 const currency=v=>v==null?'Price pending':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
 async function load(){
   grid.textContent='Loading approved items…';preview.hidden=true;
   try{
    const data=await fetchData('/api/admin/approved-listings');
    const list=data.items||[];
    $('#approvedListingsCount').textContent=list.length;
    if(!list.length){grid.innerHTML='<p class="detail-meta">No internally approved listings yet. Review a draft to add it here.</p>';return;}
    grid.replaceChildren();
    for(const item of list){
     const button=document.createElement('button');button.type='button';button.className='approved-item';
     const img=item.cover?'<img loading="lazy" src="'+esc(imageUrl(item.cover))+'" alt="">':'<span class="approved-no-photo">No photo</span>';
     button.innerHTML=img+'<span class="approved-item-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.id)+' · '+esc(item.category_hint||'Category to verify')+'</small><b>'+esc(currency(item.price_cents==null?null:item.price_cents/100))+'</b></span><span class="approved-item-action">Preview</span>';
     button.addEventListener('click',()=>show(item.id));
     grid.append(button);
    }
   }catch(err){grid.textContent='Unable to load reviewed listings: '+err.message;}
 }
 async function show(id){
  preview.hidden=false;preview.innerHTML='<p class="detail-meta">Preparing listing preview…</p>';
  try{
   const d=await fetchData('/api/admin/approved-listings/'+encodeURIComponent(id)+'/preview');
   const images=d.photos||[],primary=images[0];
   const imgHtml=primary?'<img class="approved-preview-hero" src="'+esc(primary.url)+'" alt="Main listing photograph">':'<div class="approved-no-photo">No listing photo</div>';
   const strip=images.map((x,i)=>'<img src="'+esc(x.url)+'" alt="Listing photo '+(i+1)+'" loading="lazy">').join('');
   const review=(d.checks||[]).length?'<div class="approved-checks"><strong>Fix before publishing preparation</strong><ul>'+(d.checks||[]).map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul></div>':'<p class="approved-ready">Internal data checks passed. eBay policy and item-specific validation still required.</p>';
   preview.innerHTML='<div class="approved-preview-header"><h3>eBay listing preview</h3><button class="small-button" id="closeApprovedPreview" type="button" aria-label="Close listing preview">Close</button></div><p class="detail-meta">Private SHUKCHIC preview. Nothing has been sent to eBay.</p><div class="approved-preview-content"><div><div class="approved-image-wrap">'+imgHtml+'</div><div class="approved-image-strip">'+strip+'</div></div><div><h3>'+esc(d.title)+'</h3><strong class="approved-preview-price">'+esc(currency(d.price.amount))+'</strong><p class="detail-meta">Condition: '+esc(d.condition)+'</p><p class="detail-meta">Category: '+esc(d.category.label||'Unconfirmed')+'</p><p class="detail-meta">SKU: '+esc(d.sku)+'</p><h4>Description</h4><p class="approved-preview-description">'+esc(d.description)+'</p></div></div>'+review+'<details class="approved-live-checklist"><summary>What remains before live eBay publishing</summary><ul>'+(d.requiredBeforeLive||[]).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details><div class="approved-preview-buttons"><button type="button" class="btn btn-outline" id="approvedEdit">Edit in Listing Studio</button><button class="btn btn-primary" disabled type="button">Publish to eBay · disabled</button></div>';
   $('#closeApprovedPreview').addEventListener('click',()=>{preview.hidden=true;});
   $('#approvedEdit').addEventListener('click',()=>{
    approved.hidden=true;$('#dashboardWorkArea').hidden=false;
    const row=Array.from(document.querySelectorAll('#itemList .item-row')).find(b=>b.dataset.submissionId===id);
    if(row){row.click();$('#detailPanel').scrollIntoView({behavior:'smooth',block:'start'});}
    else{
      // Set review filters to all; the list already has the submission.
      const filt=$('#filter'),search=$('#search');if(filt)filt.value='';if(search)search.value='';
      if(typeof window.shukchicOpenSubmission==='function')window.shukchicOpenSubmission(id);
    }
   });
  }catch(err){preview.innerHTML='<p class="admin-error">'+esc(err.message)+'</p>';}
 }
 $('#showApprovedListings').addEventListener('click',()=>{approved.hidden=false;$('#dashboardWorkArea').hidden=true;load();});
 $('#showIncomingItems').addEventListener('click',()=>{approved.hidden=true;$('#dashboardWorkArea').hidden=false;});
 reload?.addEventListener('click',load);
 window.shukchicRefreshApprovedListings=load;
})();