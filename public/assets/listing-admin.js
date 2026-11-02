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
  html+='<form id="listingGenerate"><div class="editor-grid">'+field('Verified item type','itemType',facts.category||'')+field('Verified color','color',facts.color||'')+'</div><details class="listing-extra-facts"><summary>Additional item details (optional)</summary><div class="editor-grid">'+field('Verified size','size',facts.size||'')+field('Verified material','material',facts.material||'')+textarea('Measurements','measurements',facts.measurements||'',2)+textarea('Observed flaws or wear','flaws',facts.flaws||'',2)+textarea('Other verified details','facts',facts.facts||'',2)+'</div></details>';
  html+='</form>';
  if(d){
   const approved=d.status==='REVIEWED';
   html+='<div class="listing-review-status '+(approved?'is-reviewed':'')+'"><strong>'+(approved?'✓ Staff reviewed — not published':'Draft awaiting staff review')+'</strong><p>'+(approved?'The draft is approved inside SHUKCHIC only. No eBay listing has been created. Editing will return it to draft.':'Check the title and description now. Final approval unlocks after warehouse receipt, inspection, SKU, bin and price/category checks.')+'</p></div>';
   html+='<form id="listingEdit"><h3>Listing details · '+esc(d.source==='ebay_ai'?'eBay AI draft':d.source==='ai'?'AI draft':'starter draft')+'</h3><div class="editor-grid">';
   html+=field('Listing title (80 characters)','title',d.title);
   html+=field('Asking price (USD)','price',d.price_cents?(d.price_cents/100).toFixed(2):'','number');
   html+='<label class="span-all">eBay category<div class="editor-grid"><select id="ebayCategoryMain"><option value="">Choose category</option></select><select id="ebayCategorySub"><option value="">Choose subcategory</option></select></div><small id="ebayCategoryHint">Finding matching eBay categories…</small><input type="hidden" name="categorySuggestion" value="'+esc(d.category_hint||'')+'"><input type="hidden" name="categoryId" value="'+esc(d.category_id||'')+'"></label>';
   html+=textarea('Listing description','description',d.description,8);
   html+='</div><p class="detail-meta">Suggested item specifics: '+esc(Object.entries(d.aspects||{}).map(x=>x.join(': ')).join(' · ')||'None')+'</p><p class="detail-meta">To check: '+esc((d.checks||[]).join(' · '))+'</p>';
   if(gates.length)html+='<p class="detail-meta">Final approval pending: '+esc(gates.join(' · '))+'</p>';if(!d.price_cents||!d.category_id)html+='<p class="detail-meta">Before approval: enter an asking price and confirm the correct eBay category ID. You can save now without them.</p>';
   html+='<div class="editor-actions"><button class="btn btn-outline" type="submit">Save draft</button><button class="btn btn-primary" type="button" id="listingApprove" '+(approved||gates.length||!d.price_cents||!d.category_id?'disabled':'')+'>'+(approved?'✓ Staff reviewed':'Approve draft (internal only)')+'</button></div>';
   html+='<p class="detail-meta">Save your work anytime. Category ID, asking price and warehouse verification are required only for approval. Nothing is published to eBay.</p></form>';
  }
  html+='<div class="listing-mapping-info"><strong>AI listing preparation</strong><p id="mappingResult" role="status">Checking the draft…</p><button class="btn btn-outline" id="mappingRegenerate" type="button">Regenerate AI listing</button></div>';  html+='<div id="listingFeedback" class="save-notice" role="status"></div>';
  div.innerHTML=html;target.insertAdjacentElement('afterend',div);
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
   render(id,data);const node=document.querySelector('#listingFeedback');if(node)node.textContent=op==='save'?'Draft saved successfully. You can continue editing later.':'Draft approved internally. Nothing published to eBay.';
  }
  const edit=div.querySelector('#listingEdit');
  if(edit){
   const main=edit.querySelector('#ebayCategoryMain'),sub=edit.querySelector('#ebayCategorySub'),hint=edit.querySelector('#ebayCategoryHint');
   const itemType=div.querySelector('[name=itemType]')?.value?.trim()||d.category_hint||'jewelry';
   let results=[];
   async function loadCategories(){
    hint.textContent='Finding eBay categories…';
    try{
     const resp=await fetch('/api/admin/ebay/category-suggestions?q='+encodeURIComponent(itemType),{credentials:'same-origin'});
     const payload=await resp.json();if(!resp.ok)throw Error(payload.error||'eBay category search unavailable');
     results=payload.categories||[];
     main.replaceChildren(new Option('Choose category',''));
     const categories=[...new Set(results.map(c=>(c.path||'Jewelry & Watches').split(' › ')[0]))];
     for(const c of categories)main.add(new Option(c,c));
     hint.textContent=results.length?'Choose category, then subcategory.':'No category matches. Verify item type and reopen listing.';
     if(results.length===1){main.value=categories[0];main.dispatchEvent(new Event('change'));}
    }catch(err){hint.textContent='Could not load eBay categories: '+err.message;}
   }
   main.addEventListener('change',()=>{
     sub.replaceChildren(new Option('Choose subcategory',''));
     for(const c of results.filter(c=>(c.path||'Jewelry & Watches').split(' › ')[0]===main.value)){
       sub.add(new Option((c.path?c.path+' › ':'')+c.name,c.id));
     }
   });
   sub.addEventListener('change',()=>{
     const c=results.find(x=>x.id===sub.value);if(!c)return;
     edit.elements.categoryId.value=c.id;edit.elements.categorySuggestion.value=c.name;
     hint.textContent='Selected: '+c.name;
   });
   if(d.category_id){hint.textContent='Saved category ID '+d.category_id+'. Choose a new category to change it.';}
   loadCategories();
   edit.addEventListener('submit',async event=>{
    event.preventDefault();const b={};for(const name of ['title','price','description','categorySuggestion','categoryId'])b[name]=edit.elements[name].value;
    try{await act('save',b);}catch(err){feedback.textContent=err.message;}
   });
   edit.querySelector('#listingApprove').addEventListener('click',async()=>{try{await act('approve',{});}catch(err){feedback.textContent=err.message;}});
  }
 }
 window.restyleListingPanel={mount:render};
})();
