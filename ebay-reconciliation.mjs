// eBay REST -> SHUKCHIC read-only reconciliation. This module deliberately cannot
// publish listings, change payout status, or contact eBay. No live credentials yet.
// Never trust total order price: it may contain buyer shipping/tax or multiple items.
const str=x=>String(x??'').trim();
const maybeMoney=(a)=>{
 if(!a||typeof a!=='object'||a.currency!=='USD')return null;
 const v=str(a.value);
 if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(v))return null;
 const [whole,decimal='']=v.split('.');
 return Number(whole)*100+Number((decimal+'00').slice(0,2));
};
const unique=xs=>[...new Set(xs)];
const SHA=/^[A-Za-z0-9._-]{1,90}$/;
export function examineEbayOrder({order,inventory=[]}={}){
 const issues=[];
 if(!order||typeof order!=='object')return {status:'NEEDS_ATTENTION',issues:['MISSING_ORDER'],orderId:null,sku:null,salePriceCents:null,submissionId:null};
 const orderId=str(order.orderId);
 if(!orderId)issues.push('MISSING_ORDER_ID');
 const lines=Array.isArray(order.lineItems)?order.lineItems:[];
 // Multi-line and multi-quantity orders require item-level allocation of discounts/fees/labels.
 if(lines.length!==1)issues.push('COMBINED_ORDER_REQUIRES_ALLOCATION');
 const line=lines.length===1?lines[0]:null;
 const qty=Number(line?.quantity);
 if(line&&qty!==1)issues.push('MULTIPLE_QUANTITY_REQUIRES_ALLOCATION');
 const sku=str(line?.sku);
 if(!sku||!SHA.test(sku))issues.push('MISSING_OR_INVALID_SKU');
 const matched=sku?inventory.filter(x=>str(x.sku)===sku):[];
 if(matched.length!==1)issues.push(matched.length>1?'DUPLICATE_SKU':'SKU_NOT_MAPPED');
 const sub=matched.length===1?matched[0]:null;
 if(sub&&(!sub.received_verified||!['LISTED','SOLD','SHIPPED'].includes(sub.status)))issues.push('INVENTORY_NOT_VERIFIED_OR_LISTED');
 const sale=line?maybeMoney(line.lineItemCost):null;
 if(sale===null)issues.push('MISSING_ITEM_PRICE_USD');
 if(sale!==null&&sale<10000)issues.push('BELOW_PILOT_SALE_MINIMUM');
 if(!['PAID','FULLY_PAID'].includes(str(order.orderPaymentStatus)))issues.push('PAYMENT_NOT_CONFIRMED');
 // eBay shipment fulfillment != carrier-confirmed buyer delivery.
 const fulfillment=str(order.orderFulfillmentStatus);
 if(fulfillment!=='FULFILLED')issues.push('ORDER_NOT_FULFILLED');
 issues.push('FINANCE_RECONCILIATION_REQUIRED');
 issues.push('DELIVERY_CONFIRMATION_REQUIRED');
 return {status:'NEEDS_ATTENTION',orderId:orderId||null,sku:sku||null,submissionId:sub?.id||null,salePriceCents:sale,orderFulfillmentStatus:fulfillment,issues:unique(issues)};
}
export function examineEbayFinances({orderId,transactions,deliveredDate,externalLabelCostCents}={}){
 const issues=[];
 const id=str(orderId);
 if(!id)issues.push('MISSING_ORDER_ID');
 if(!Array.isArray(transactions)||transactions.length===0)issues.push('NO_FINANCIAL_TRANSACTIONS_YET');
 const related=Array.isArray(transactions)?transactions.filter(x=>str(x.orderId)===id):[];
 if(!related.length)issues.push('ORDER_TRANSACTIONS_NOT_FOUND');
 if(!related.some(t=>t.transactionType==='SALE'))issues.push('SALE_FINANCES_NOT_SETTLED');
 // eBay transaction fee handling varies by payment account and type. Keep raw
 // transactions as references; do not add guessed item fees or double-subtract
 // eBay selling fees already netted from transactions.
 const feesConfirmed=false;
 if(!feesConfirmed)issues.push('FEES_NEED_VALIDATED_MAPPING');
 const label=related.filter(t=>t.transactionType==='SHIPPING_LABEL');
 if(!label.length&&externalLabelCostCents==null)issues.push('LABEL_COST_UNKNOWN_OR_BUYER_FUNDED');
 const cases=related.filter(t=>['REFUND','DISPUTE'].includes(t.transactionType));
 if(cases.length)issues.push('REFUND_OR_DISPUTE_REQUIRES_REVIEW');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(str(deliveredDate)))issues.push('CARRIER_DELIVERY_NOT_CONFIRMED');
 return {status:'NEEDS_ATTENTION',orderId:id||null,transactionsSeen:related.length,labelTransactionsSeen:label.length,unresolvedTransactions:cases.length,issues:unique(issues),canPay:false};
}
export function sampleOrderPreview(){
 // Static fixture is a parser demo, NOT a real seller order or financial record.
 const order={orderId:'DEMO-EBAY-ORDER-001',orderPaymentStatus:'PAID',orderFulfillmentStatus:'FULFILLED',lineItems:[{sku:'DEMO-SHUKCHIC-001',quantity:1,lineItemCost:{value:'650.00',currency:'USD'}}]};
 const inventory=[{id:'DEMO-NOT-A-REAL-SUBMISSION',sku:'DEMO-SHUKCHIC-001',status:'LISTED',received_verified:1}];
 const result=examineEbayOrder({order,inventory});
 return {...result,demo:true,nonBinding:true,note:'Illustrative read-only reconciliation. No real eBay account or monetary data is connected.'};
}
