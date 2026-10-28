(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
 const dollars=n=>n==null?'0.00':(n/100).toFixed(2);
 const label=(title,name,val='0.00',type='number')=>'<label>'+esc(title)+'<input name="'+esc(name)+'" type="'+type+'" '+(type==='number'?'min="0" step="0.01" ':'')+'value="'+esc(val)+'"></label>';
 function mount(id,s,item){
  document.querySelector('#restyleSettlement')?.remove();
  if(!['SOLD','SHIPPED','PAID'].includes(item.status))return;
  const anchor=document.querySelector('#restyleListing')||document.querySelector('#editForm');if(!anchor)return;
  const node=document.createElement('section');node.className='detail-editor';node.id='restyleSettlement';
  const d=s?.record||{};
  let html='<h3>Consignor payout ledger <span class="pilot-tag">NO AUTOMATIC TRANSFERS</span></h3><p class="detail-meta">SHUKCHIC will import eBay sale prices, fees, label charges and refunds after the seller account is connected. Manual entry below is only a temporary fallback for the pilot or incomplete eBay data.</p>';
  if(s?.pilot)html+='<p class="detail-meta"><strong>Pilot mode:</strong> This is a settlement preview. External payment recording is disabled until the business launches.</p>';
  html+='<details class="settlement-manual"><summary>Manual entry — only when eBay data is unavailable</summary><form id="settlementEdit"><div class="editor-grid">';
  html+=label('Final sale price ($)','salePrice',d.sale_price_cents==null?'':dollars(d.sale_price_cents));
  html+=label('Marketplace/payment fees ($)','marketplaceFee',dollars(d.marketplace_fee_cents));
  html+=label('Outbound shipment / insurance ($)','outboundShipping',dollars(d.outbound_shipping_cents));
  html+=label('Return shipping ($)','returnShipping',dollars(d.return_shipping_cents));
  html+=label('Other disclosed transaction costs ($)','otherCost',dollars(d.other_cost_cents));
  html+=label('Refunds already issued ($)','refund',dollars(d.refund_cents));
  html+=label('Confirmed buyer delivery date','deliveredDate',d.delivered_date||'','date');
  html+='<label>Return/dispute status<select name="caseStatus">'+['CLEAR','OPEN','RESOLVED','REFUNDED'].map(v=>'<option value="'+v+'" '+((d.case_status||'CLEAR')===v?'selected':'')+'>'+esc({CLEAR:'No unresolved case',OPEN:'Open return or dispute',RESOLVED:'Case resolved',REFUNDED:'Sale fully refunded'}[v])+'</option>').join('')+'</select></label>';
  html+='<label class="verified-row"><input type="checkbox" name="fundsCleared" '+(d.funds_cleared?'checked':'')+'> Marketplace funds received and cleared</label>';
  html+='<label class="span-all">Internal notes<textarea name="note" rows="2" maxlength="1000">'+esc(d.note||'')+'</textarea></label>';
  html+='</div><div class="editor-actions"><button class="btn btn-primary" type="submit" '+(d.paid_at?'disabled':'')+'>Save settlement details</button><p>Saving does not release any funds or notify the customer.</p></div></form></details>';
  if(s?.record){
   html+='<div class="detail-meta" style="margin-top:14px"><strong>Sale: $'+dollars(d.sale_price_cents)+'</strong> · Deductions: $'+dollars(s.deductions_cents)+' · Net: $'+dollars(s.net_cents)+'</div>';
   html+='<div class="detail-meta"><strong>Consignor: '+s.split_percent+'% = $'+dollars(s.consignor_cents)+'</strong> · SHUKCHIC: '+s.restyle_percent+'% = $'+dollars(s.restyle_cents)+'</div>';
   html+='<div class="detail-meta"><strong>Payment status:</strong> '+esc(s.state.replace(/_/g,' '))+(s.eligible_at?' · 30-day hold ends '+esc(new Date(s.eligible_at).toLocaleDateString()):'')+'</div>';
   if(s.issues?.length)html+='<p class="detail-meta">Payout holds: '+esc(s.issues.join(' · '))+'</p>';
   if(d.paid_at)html+='<p class="detail-meta">External payment recorded '+esc(new Date(d.paid_at).toLocaleString())+' · Reference '+esc(d.payment_reference)+'</p>';
   else if(!s.pilot)html+='<div class="editor-grid"><label>External payment reference<input id="settlementPaymentRef" placeholder="Bank or payment processor reference"></label><button type="button" class="btn btn-outline" id="settlementPaid" '+(!s.canRecordPayment?'disabled':'')+'>Record external payout</button></div><p class="detail-meta">Only use this after sending money outside SHUKCHIC. This action does not execute a transfer.</p>';
  }
  html+='<div id="settlementFeedback" class="save-notice" role="status"></div>';
  node.innerHTML=html;anchor.insertAdjacentElement('afterend',node);
  const feedback=node.querySelector('#settlementFeedback');
  const form=node.querySelector('#settlementEdit');
  form.addEventListener('submit',async e=>{
   e.preventDefault();const data={};
   for(const n of ['salePrice','marketplaceFee','outboundShipping','returnShipping','otherCost','refund','deliveredDate','caseStatus','note'])data[n]=form.elements[n].value;
   data.fundsCleared=form.elements.fundsCleared.checked;
   const button=form.querySelector('button[type=submit]');button.disabled=true;feedback.textContent='Saving…';
   try{const res=await fetch('/api/admin/submissions/'+encodeURIComponent(id)+'/settlement/save',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await res.json();if(!res.ok)throw Error(result.error||'Unable to save settlement');
    mount(id,result,item);document.querySelector('#settlementFeedback').textContent='Settlement saved. No payment was sent.';
   }catch(err){feedback.textContent=err.message;button.disabled=false;}
  });
  node.querySelector('#settlementPaid')?.addEventListener('click',async()=>{
   if(!confirm('Confirm that you have ALREADY paid the consignor outside SHUKCHIC. This cannot be reversed inside the application.'))return;
   try{const ref=node.querySelector('#settlementPaymentRef')?.value||'';const res=await fetch('/api/admin/submissions/'+encodeURIComponent(id)+'/settlement/record-payment',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentReference:ref})});const result=await res.json();if(!res.ok)throw Error(result.error||'Unable to record payment');location.reload();}catch(err){feedback.textContent=err.message;}
  });
 }
 window.shukchicSettlementPanel={mount};
})();
