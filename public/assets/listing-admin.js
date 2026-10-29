(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const endpoint=id=>'/api/admin/submissions/'+encodeURIComponent(id)+'/listing';
 const field=(label,name,value='',type='text')=>'<label>'+esc(label)+'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'" maxlength="900"></label>';
 const textarea=(label,name,value='',rows=4)=>'<label class="span-all">'+esc(label)+'<textarea name="'+name+'" rows="'+rows+'">'+esc(value)+'</textarea></label>';
 function render(id,state){
  const target=document.querySelector('#editForm');if(!target)return;
  document.querySelector('#restyleListing')?.remove();
  const div=document.createElement('section');div.id='restyleListing';div.className='detail-editor';
  const d=state.draft,gates=state.gates||[],facts=d?.verifiedFacts||{};
  let html='<h3>AI eBay Listing Studio <span class="pilot-tag">NO PUBLISHING</span></h3><p>Prepare a factual title, description, category suggestion and item specifics. Samantha reviews every draft before future eBay publishing is enabled.</p>';
  if(gates.length)html+='<p class="admin-error" style="display:block">Complete before generating: '+esc(gates.join(' · '))+'</p>';
  else html+='<p class="save-notice">Warehouse and agreement checks passed. Verify item facts below before generating.</p>';
  html+='<form id="listingGenerate"><div class="editor-grid">'+field('Verified size','size',facts.size||'')+field('Verified color','color',facts.color||'')+field('Verified material','material',facts.material||'')+textarea('Measurements','measurements',facts.measurements||'',2)+textarea('Observed flaws or wear','flaws',facts.flaws||'',2)+textarea('Other verified details','facts',facts.facts||'',2)+'</div>';
  html+='<label class="verified-row"><input type="checkbox" name="confirmPhysicalFacts" required> I have physically verified the brand, condition and any details entered above.</label><div class="editor-actions">';
  html+='<button class="btn btn-outline" name="mode" value="starter" type="submit" '+(gates.length?'disabled':'')+'>Create starter draft</button>';
  html+='<button class="btn btn-primary" name="mode" value="ai" type="submit" '+(gates.length||!state.aiAvailable?'disabled':'')+'>✨ Generate AI draft</button></div>';
  html+='<p class="detail-meta">'+(state.aiAvailable?'AI drafting enabled. Staff details are sent to the configured provider; customer contact data and photos are not sent.':'AI drafting is not configured yet. OPENAI_API_KEY enables actual AI drafting. eBay Inventory Mapping will be a later integration.')+'</p></form>';
  if(d){
   const approved=d.status==='REVIEWED';
   html+='<div class="listing-review-status '+(approved?'is-reviewed':'')+'"><strong>'+(approved?'✓ Staff reviewed — not published':'Draft awaiting staff review')+'</strong><p>'+(approved?'The draft is approved inside SHUKCHIC only. No eBay listing has been created. Editing will return it to draft.':'Check the title, exact item condition, recommended category and price before marking it reviewed.')+'</p></div>';
   html+='<form id="listingEdit"><h3>Review listing draft · '+esc(d.source==='ai'?'AI suggestion':'starter template')+'</h3><div class="editor-grid">';
   html+=field('Listing title (80 characters)','title',d.title);
   html+=field('Asking price (USD)','price',d.price_cents?(d.price_cents/100).toFixed(2):'','number');
   html+=field('Category suggestion','categorySuggestion',d.category_hint);
   html+=field('eBay category ID (staff confirmed)','categoryId',d.category_id);
   html+=textarea('Listing description','description',d.description,8);
   html+='</div><p class="detail-meta">Suggested item specifics: '+esc(Object.entries(d.aspects||{}).map(x=>x.join(': ')).join(' · ')||'None')+'</p><p class="detail-meta">To check: '+esc((d.checks||[]).join(' · '))+'</p>';
   html+='<div class="editor-actions"><button class="btn btn-outline" type="submit">Save edited draft</button><button class="btn btn-primary" type="button" id="listingApprove" '+(approved?'disabled':'')+'>'+(approved?'✓ Staff reviewed':'Approve draft (internal only)')+'</button></div>';
   html+='<p class="detail-meta">Category ID and price must be confirmed by staff. This is an internal review only: no listings are sent to eBay.</p></form>';
  }
  html+='<div id="listingFeedback" class="save-notice" role="status"></div>';
  div.innerHTML=html;target.insertAdjacentElement('afterend',div);
  const feedback=div.querySelector('#listingFeedback');
  async function act(op,payload){
   feedback.textContent='Processing…';
   const result=await fetch(endpoint(id)+'/'+op,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
   const data=await result.json();if(!result.ok)throw Error(data.error||'Unable to complete listing action.');
   render(id,data);const node=document.querySelector('#listingFeedback');if(node)node.textContent='Saved in SHUKCHIC. Nothing has been published on eBay.';
  }
  div.querySelector('#listingGenerate').addEventListener('submit',async event=>{
   event.preventDefault();
   const form=event.currentTarget,submitter=event.submitter,mode=submitter?.value==='ai'?'ai':'starter',b={mode};
   for(const name of ['size','color','material','measurements','flaws','facts'])b[name]=form.elements[name].value;
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
