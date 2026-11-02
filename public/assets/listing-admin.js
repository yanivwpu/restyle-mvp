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
  html+='<label class="verified-row"><input type="checkbox" name="confirmPhysicalFacts" required> I confirm these details come from the submitted information or physical inspection; unverified claims must be checked before final approval.</label><div class="editor-actions">';
  html+='<button class="btn btn-outline" name="mode" value="starter" type="submit" '+(draftGates.length?'disabled':'')+'>Create starter draft</button>';
  html+='<button class="btn btn-primary" name="mode" value="ai" type="submit" '+(draftGates.length||!state.aiAvailable?'disabled':'')+' >✨ Generate AI draft</button></div></form>';

  if(d){
   const approved=d.status==='REVIEWED';
   html+='<div class="listing-review-status '+(approved?'is-reviewed':'')+'"><strong>'+(approved?'✓ Staff reviewed — not published':'Draft awaiting staff review')+'</strong><p>'+(approved?'The draft is approved inside SHUKCHIC only. No eBay listing has been created. Editing will return it to draft.':'Check the title and description now. Final approval unlocks after warehouse receipt, inspection, SKU, bin and price/category checks.')+'</p></div>';
   html+='<form id="listingEdit"><h3>Listing details · '+esc(d.source==='ebay_ai'?'eBay AI draft':d.source==='ai'?'AI draft':'starter draft')+'</h3><div class="editor-grid">';
   html+=field('Listing title (80 characters)','title',d.title);
   html+=field('Asking price (USD)','price',d.price_cents?(d.price_cents/100).toFixed(2):'','number');
   html+=field('Category suggestion','categorySuggestion',d.category_hint);
   html+=field('eBay category ID (staff confirmed)','categoryId',d.category_id);
   html+=textarea('Listing description','description',d.description,8);
   html+='</div><p class="detail-meta">Suggested item specifics: '+esc(Object.entries(d.aspects||{}).map(x=>x.join(': ')).join(' · ')||'None')+'</p><p class="detail-meta">To check: '+esc((d.checks||[]).join(' · '))+'</p>';
   if(gates.length)html+='<p class="detail-meta">Final approval pending: '+esc(gates.join(' · '))+'</p>';
   html+='<div class="editor-actions"><button class="btn btn-outline" type="submit">Save edited draft</button><button class="btn btn-primary" type="button" id="listingApprove" '+(approved||gates.length?'disabled':'')+'>'+(approved?'✓ Staff reviewed':'Approve draft (internal only)')+'</button></div>';
   html+='<p class="detail-meta">Category ID and price must be confirmed by staff. This is an internal review only: no listings are sent to eBay.</p></form>';
  }
  html+='<div class="listing-mapping-info"><strong>eBay AI recommendations</strong><p>Uses product details and expiring photo links visible only to anyone holding those temporary links. eBay may process and retain submitted images under its policies. No listing is created.</p><button class="btn btn-outline" type="button" id="mappingStart" '+(draftGates.length?'disabled':'')+'>Generate eBay recommendations</button> <button class="btn btn-outline" type="button" id="mappingCheck">Check results</button><div id="mappingResult" class="save-notice" role="status"></div></div>';
  html+='<p class="detail-meta">'+(state.aiAvailable?'AI drafting enabled. Staff details are sent to the configured provider; customer contact data and photos are not sent.':'AI drafting is not configured yet. OPENAI_API_KEY enables actual AI drafting. eBay AI recommendations are connected; use the results to edit your listing.')+'</p>';
  html+='<div id="listingFeedback" class="save-notice" role="status"></div>';
  div.innerHTML=html;target.insertAdjacentElement('afterend',div);
  const feedback=div.querySelector('#listingFeedback');
  const mappingNode=div.querySelector('#mappingResult');
  async function mapping(op,details){
   mappingNode.textContent='Checking eBay AI…';
   const url='/api/admin/submissions/'+encodeURIComponent(id)+'/ebay-ai'+(op?'/'+op:'');
   const response=await fetch(url,{method:op?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(op?{body:JSON.stringify(details||{})}:{})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'eBay AI unavailable');
   const t=data.task;
   mappingNode.replaceChildren();
   if(!t){mappingNode.textContent='No eBay AI request yet.';return;}
   const message=document.createElement('p');message.textContent='eBay AI: '+t.status+(t.status==='PENDING'?' — check results again after processing':'');mappingNode.append(message);
   if(t.status==='COMPLETED'&&op==='poll'&&data.listing){render(id,data.listing);document.querySelector('#listingFeedback').textContent='eBay AI recommendations are now in the listing fields. Edit them here, then save.';return;}
   if(t.preview){const p=t.preview;
    if(document.querySelector('#listingGenerate')?.elements?.itemType?.value.trim().toLowerCase()==='ear cuff'&&/necklace|pendant/i.test(p.categoryName||'')){
     const warning=document.createElement('p');warning.className='admin-error';warning.style.display='block';warning.textContent='eBay suggested '+p.categoryName+' but this is an Ear Cuff. Verify category before approval.';mappingNode.append(warning);
    }
    const note=document.createElement('p');note.textContent='Recommendations received. They appear in Listing details above. No listing published.';mappingNode.append(note);
   }
  }
  div.querySelector('#mappingStart')?.addEventListener('click',async()=>{
   const form=div.querySelector('#listingGenerate');
   try{
    if(!form.elements.confirmPhysicalFacts.checked)throw Error('Confirm verified item facts first.');
    await mapping('start',{itemType:form.elements.itemType.value,color:form.elements.color.value,material:form.elements.material.value});
   }catch(e){mappingNode.textContent=e.message;}
  });
  div.querySelector('#mappingCheck')?.addEventListener('click',async()=>{try{await mapping('poll',{itemType:div.querySelector('#listingGenerate').elements.itemType.value});}catch(e){mappingNode.textContent=e.message;}});
  mapping('').then(()=>{if(!d&&mappingNode.textContent.includes('COMPLETED'))mapping('poll',{itemType:div.querySelector('#listingGenerate').elements.itemType.value}).catch(e=>{mappingNode.textContent=e.message;});}).catch(e=>{mappingNode.textContent=e.message;});

  async function act(op,payload){
   feedback.textContent='Processing…';
   const result=await fetch(endpoint(id)+'/'+op,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
   const data=await result.json();if(!result.ok)throw Error(data.error||'Unable to complete listing action.');
   render(id,data);const node=document.querySelector('#listingFeedback');if(node)node.textContent='Saved in SHUKCHIC. Nothing has been published on eBay.';
  }
  div.querySelector('#listingGenerate').addEventListener('submit',async event=>{
   event.preventDefault();
   const form=event.currentTarget,submitter=event.submitter,mode=submitter?.value==='ai'?'ai':'starter',b={mode};
   for(const name of ['itemType','size','color','material','measurements','flaws','facts'])b[name]=form.elements[name].value;
   b.confirmPhysicalFacts=form.elements.confirmPhysicalFacts.checked;
   for(const button of form.querySelectorAll('button'))button.disabled=true;
   try{await act('generate',b);}catch(err){feedback.textContent=err.message;for(const button of form.querySelectorAll('button'))button.disabled=false;}
  });
  const edit=div.querySelector('#listingEdit');
  if(edit){
   edit.addEventListener('submit',async event=>{
    event.preventDefault();const b={};for(const name of ['title','price','description','categorySuggestion','categoryId'])b[name]=edit.elements[name].value;
    try{await act('save',b);}catch(err){feedback.textContent=err.message;}
   });
   edit.querySelector('#listingApprove').addEventListener('click',async()=>{try{await act('approve',{});}catch(err){feedback.textContent=err.message;}});
  }
 }
 window.restyleListingPanel={mount:render};
})();
