(()=>{'use strict';
const $=id=>document.getElementById(id),panel=$('merchantPartnersPanel'),items=$('merchantPartnerList');
const api=async(url,options)=>{const response=await fetch(url,{credentials:'same-origin',...options});const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed.');return result;};
const append=(parent,tag,value,cls)=>{const element=document.createElement(tag);element.textContent=value||'';if(cls)element.className=cls;parent.append(element);return element;};
async function load(){
 if($('dashboard').hidden)return;
 items.textContent='Loading merchant applications…';
 try{
  const data=await api('/api/admin/partners');items.replaceChildren();
  $('merchantApplicationCount').textContent='('+data.applications.filter(x=>x.status==='APPLIED').length+')';
  if(!data.applications.length)append(items,'p','No merchant applications yet. Share the Partner with SHUKCHIC page to start outreach.');
  for(const entry of data.applications){
   const card=append(items,'div','','merchant-admin-card');
   append(card,'strong',entry.business+' · '+entry.status);
   append(card,'p',entry.contact+' · '+entry.email+' · '+entry.city+', '+entry.state+' '+entry.postal_code);
   if(entry.description)append(card,'p',entry.description);
   if(entry.status==='ACTIVE'){
    const account=data.merchants.find(x=>x.application_id===entry.id);
    const region=append(card,'div','','merchant-admin-location');
    if(account?.ebay_location_key){append(region,'p','eBay shipping location verified: '+account.ebay_location_key);}
    else if(account){
     append(region,'p',account.ship_street?'Ready to register boutique shipping location with eBay.':'The merchant must complete Store settings on their mobile account first.');
     const button=append(region,'button','Verify shipping location in eBay','small-button');button.type='button';button.disabled=!account.ship_street;
     const result=append(region,'p','','merchant-admin-status');
     button.addEventListener('click',async()=>{button.disabled=true;result.textContent='Verifying merchant shipping location with eBay…';
      try{const response=await api('/api/admin/partners/'+encodeURIComponent(account.id)+'/location',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
       result.textContent='Verified eBay ship-from: '+response.locationKey+'. Merchant listings can use this location.';
      }catch(err){result.textContent=err.message;}finally{button.disabled=false;}
     });
    }
    continue;
   }
   const wrapper=append(card,'details','','merchant-admin-approval');
   append(wrapper,'summary',entry.status==='INVITED'?'Review invitation':'Review & invite merchant');
   const form=append(wrapper,'form','');
   const commissionLabel=append(form,'label','SHUKCHIC commission (%)','merchant-admin-field');
   const commission=document.createElement('input');commission.type='number';commission.min='0';commission.max='80';commission.step='1';commission.required=true;commissionLabel.append(commission);
   const termsLabel=append(form,'label','Approved master partnership terms (minimum 350 characters)','merchant-admin-field');
   const terms=document.createElement('textarea');terms.required=true;terms.minLength=350;terms.rows=10;terms.placeholder='Paste the reviewed merchant agreement for this specific boutique, including commission basis, payouts, shipping responsibility, returns, liability, term and termination.';termsLabel.append(terms);
   const review=append(form,'label','','merchant-admin-check');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.required=true;
   review.append(checkbox,document.createTextNode(' I reviewed and completed the commercial and legal terms for this merchant.'));
   const button=append(form,'button','Approve & issue invitation','small-button');button.type='submit';
   const result=append(form,'p','','merchant-admin-status');
   form.addEventListener('submit',async e=>{e.preventDefault();result.textContent='';if(!form.reportValidity())return;button.disabled=true;
    try{const response=await api('/api/admin/partners/'+encodeURIComponent(entry.id)+'/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commissionPercent:Number(commission.value),agreementText:terms.value,reviewedTerms:checkbox.checked})});
      result.replaceChildren();append(result,'span',response.emailSent?'Invitation emailed. ':'Invitation created. Share the private activation link securely: ');
      const input=document.createElement('input');input.value=response.inviteUrl;input.readOnly=true;input.setAttribute('aria-label','Merchant private invitation');result.append(input);input.addEventListener('focus',()=>input.select());
    }catch(err){result.textContent=err.message;}finally{button.disabled=false;}
   });
  }
 }catch(err){items.textContent='Could not load partners: '+err.message;}
}
panel?.addEventListener('toggle',()=>{if(panel.open)load();});
$('merchantRefreshApplications')?.addEventListener('click',load);
$('merchantAssignShippingForm')?.addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,output=$('merchantAssignShippingStatus'),button=form.querySelector('button[type=submit]'),file=form.elements.label.files[0];
 if(!file)return;button.disabled=true;output.textContent='Checking the eBay order…';
 try{if(file.size>5*1024*1024)throw Error('Label must be under 5MB.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Cannot read label.'));reader.readAsDataURL(file);});
  await api('/api/admin/merchant-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionId:form.elements.submissionId.value,orderId:form.elements.orderId.value,carrier:form.elements.carrier.value,label:{data}})});
  form.reset();output.textContent='Paid eBay order verified. Label now available in the matching merchant account.';
 }catch(err){output.textContent=err.message;}finally{button.disabled=false;}
});
})();