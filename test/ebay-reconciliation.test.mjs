import test from 'node:test';
import assert from 'node:assert/strict';
import { examineEbayOrder, examineEbayFinances, sampleOrderPreview } from '../ebay-reconciliation.mjs';

const baseOrder=()=>({
 orderId:'99-00001-00001',orderPaymentStatus:'PAID',orderFulfillmentStatus:'FULFILLED',
 pricingSummary:{total:{value:'718.00',currency:'USD'}},
 lineItems:[{sku:'SC-BAG-001',quantity:1,lineItemCost:{value:'650.00',currency:'USD'}}]
});
const inventory=[{id:'RS-1111111111',sku:'SC-BAG-001',received_verified:1,status:'LISTED'}];

test('matches a single paid eBay order by unique SKU and excludes order tax/shipping from sale price',()=>{
 const result=examineEbayOrder({order:baseOrder(),inventory});
 assert.equal(result.orderId,'99-00001-00001');
 assert.equal(result.submissionId,'RS-1111111111');
 assert.equal(result.salePriceCents,65000);
 assert.equal(result.status,'NEEDS_ATTENTION');
 assert.ok(result.issues.includes('FINANCE_RECONCILIATION_REQUIRED'));
 assert.ok(result.issues.includes('DELIVERY_CONFIRMATION_REQUIRED'));
});
test('never auto-allocates combined-order fees or multiple quantity sales',()=>{
 const order=baseOrder();order.lineItems.push({sku:'SC-BAG-002',quantity:1,lineItemCost:{value:'90.00',currency:'USD'}});
 assert.ok(examineEbayOrder({order,inventory}).issues.includes('COMBINED_ORDER_REQUIRES_ALLOCATION'));
 const quantity=baseOrder();quantity.lineItems[0].quantity=2;
 assert.ok(examineEbayOrder({order:quantity,inventory}).issues.includes('MULTIPLE_QUANTITY_REQUIRES_ALLOCATION'));
});
test('missing SKU, unverified storage or duplicate matching block automatic payout',()=>{
 const missing=baseOrder();delete missing.lineItems[0].sku;
 assert.ok(examineEbayOrder({order:missing,inventory}).issues.includes('MISSING_OR_INVALID_SKU'));
 assert.ok(examineEbayOrder({order:baseOrder(),inventory:[...inventory,...inventory]}).issues.includes('DUPLICATE_SKU'));
 assert.ok(examineEbayOrder({order:baseOrder(),inventory:[{...inventory[0],received_verified:0}]}).issues.includes('INVENTORY_NOT_VERIFIED_OR_LISTED'));
});
test('USD and paid state are required; reject ungrounded currency and checkout state',()=>{
 const unpaid=baseOrder();unpaid.orderPaymentStatus='PENDING';
 assert.ok(examineEbayOrder({order:unpaid,inventory}).issues.includes('PAYMENT_NOT_CONFIRMED'));
 const eur=baseOrder();eur.lineItems[0].lineItemCost.currency='EUR';
 assert.ok(examineEbayOrder({order:eur,inventory}).issues.includes('MISSING_ITEM_PRICE_USD'));
});
test('finance transactions remain untrusted for payouts until fees, label charge and delivery are matched',()=>{
 const data=examineEbayFinances({orderId:'99-00001-00001',transactions:[{orderId:'99-00001-00001',transactionId:'t1',transactionType:'SALE',bookingEntry:'CREDIT',amount:{value:'650.00',currency:'USD'}}]});
 assert.equal(data.canPay,false);
 for(const problem of ['FEES_NEED_VALIDATED_MAPPING','LABEL_COST_UNKNOWN_OR_BUYER_FUNDED','CARRIER_DELIVERY_NOT_CONFIRMED'])assert.ok(data.issues.includes(problem));
 const changed=examineEbayFinances({orderId:'99-00001-00001',deliveredDate:'2026-09-01',transactions:[{orderId:'99-00001-00001',transactionType:'REFUND'}],externalLabelCostCents:0});
 assert.ok(changed.issues.includes('REFUND_OR_DISPUTE_REQUIRES_REVIEW'));
});
test('sample preview is prominently demo-only, never an authorized financial record',()=>{
 const sample=sampleOrderPreview();
 assert.equal(sample.demo,true);
 assert.equal(sample.nonBinding,true);
 assert.equal(sample.salePriceCents,65000);
 assert.equal(sample.status,'NEEDS_ATTENTION');
});
