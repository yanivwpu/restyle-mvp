// Internal consignment settlement ledger. No funds transfer functionality.
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function cents(value,label){
 const s=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(s))throw fail(label+' must be a nonnegative dollar amount with at most two decimals.');
 const [whole,part='']=s.split('.');
 return Number(whole)*100+Number((part+'00').slice(0,2));
}
const allowedCases=new Set(['CLEAR','OPEN','RESOLVED','REFUNDED']);
const split=price=>price>=100000?80:price>=50000?70:60;
function compute(row){
 if(!row)return null;
 const deductions=row.marketplace_fee_cents+row.outbound_shipping_cents+row.return_shipping_cents+row.other_cost_cents+row.refund_cents;
 const net=Math.max(0,row.sale_price_cents-deductions);
 const percent=split(row.sale_price_cents);
 const consignor=Math.floor(net*percent/100);
 const cutoff=row.delivered_date?new Date(Date.parse(row.delivered_date+'T23:59:59.999Z')+30*86400000).toISOString():null;
 let state='WAITING_DELIVERY';
 if(row.paid_at)state='RECORDED_PAID';
 else if(row.case_status==='REFUNDED'||net===0)state='NO_PAYABLE_PROCEEDS';
 else if(row.case_status==='OPEN')state='CASE_HOLD';
 else if(!row.funds_cleared)state='FUNDS_HOLD';
 else if(!row.delivered_date)state='WAITING_DELIVERY';
 else if(Date.now()<Date.parse(cutoff))state='THIRTY_DAY_HOLD';
 else state='READY_FOR_MANUAL_PAYOUT';
 const issues=[];
 if(!row.delivered_date)issues.push('Confirmed buyer delivery date required');
 if(!row.funds_cleared)issues.push('Marketplace funds have not cleared');
 if(row.case_status==='OPEN')issues.push('Return or dispute remains open');
 if(row.case_status==='REFUNDED')issues.push('Sale has been refunded');
 if(!net)issues.push('No positive net proceeds');
 if(cutoff&&Date.now()<Date.parse(cutoff))issues.push('30-day post-delivery hold not complete');
 return {record:row,net_cents:net,deductions_cents:deductions,split_percent:percent,restyle_percent:100-percent,consignor_cents:consignor,restyle_cents:net-consignor,eligible_at:cutoff,state,issues,pilot:process.env.AGREEMENT_PILOT_MODE==='true',paymentExecuted:false};
}
export function createSettlements({db,signing,audit}){
 db.exec("CREATE TABLE IF NOT EXISTS consignment_settlements (submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE, sale_price_cents INTEGER NOT NULL, marketplace_fee_cents INTEGER NOT NULL DEFAULT 0, outbound_shipping_cents INTEGER NOT NULL DEFAULT 0, return_shipping_cents INTEGER NOT NULL DEFAULT 0, other_cost_cents INTEGER NOT NULL DEFAULT 0, refund_cents INTEGER NOT NULL DEFAULT 0, case_status TEXT NOT NULL DEFAULT 'CLEAR', funds_cleared INTEGER NOT NULL DEFAULT 0, delivered_date TEXT, note TEXT NOT NULL DEFAULT '', payment_reference TEXT NOT NULL DEFAULT '', paid_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
 function get(id){return db.prepare('SELECT * FROM consignment_settlements WHERE submission_id=?').get(id)||null;}
 function inspect(sub){const settlement=compute(get(sub.id));return settlement?{...settlement,canRecordPayment:!settlement.pilot&&settlement.state==='READY_FOR_MANUAL_PAYOUT'&&['SOLD','SHIPPED'].includes(sub.status)}:{record:null,state:'NO_SALE_RECORDED',canRecordPayment:false,pilot:process.env.AGREEMENT_PILOT_MODE==='true',paymentExecuted:false};}
 function saleGate(sub){
   if(signing.state(sub.id)?.state!=='SIGNED')throw fail('A signed agreement is required before recording a sale.',409);
   if(!sub.received_verified)throw fail('Verify physical inventory before recording a sale.',409);
   if(!['SOLD','SHIPPED'].includes(sub.status))throw fail('Mark the item SOLD or SHIPPED before entering settlement information.',409);
 }
 function save(sub,b){
  saleGate(sub);
  if(get(sub.id)?.paid_at)throw fail('A recorded payment is immutable. Investigate a correction separately.',409);
  const sale=cents(b.salePrice,'Sale price');
  if(sale<10000)throw fail('Item sale price must be at least $100 under the pilot tier schedule.');
  const marketplace=cents(b.marketplaceFee??'0','Marketplace fee');
  const shipping=cents(b.outboundShipping??'0','Buyer shipment cost');
  const returning=cents(b.returnShipping??'0','Return cost');
  const other=cents(b.otherCost??'0','Other disclosed transaction cost');
  const refund=cents(b.refund??'0','Refund');
  if(refund>sale)throw fail('Refund cannot exceed the sale price.');
  const caseStatus=String(b.caseStatus||'CLEAR');
  if(!allowedCases.has(caseStatus))throw fail('Invalid return or dispute state.');
  const date=String(b.deliveredDate||'').trim();
  if(date&&(!validDate(date)||Date.parse(date+'T00:00:00Z')>Date.now()))throw fail('Enter a valid buyer delivery date that is not in the future.');
  const cleared=b.fundsCleared===true?1:0;
  const note=String(b.note||'').trim().slice(0,1000);
  const now=new Date().toISOString();
  db.prepare("INSERT INTO consignment_settlements (submission_id,sale_price_cents,marketplace_fee_cents,outbound_shipping_cents,return_shipping_cents,other_cost_cents,refund_cents,case_status,funds_cleared,delivered_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET sale_price_cents=excluded.sale_price_cents,marketplace_fee_cents=excluded.marketplace_fee_cents,outbound_shipping_cents=excluded.outbound_shipping_cents,return_shipping_cents=excluded.return_shipping_cents,other_cost_cents=excluded.other_cost_cents,refund_cents=excluded.refund_cents,case_status=excluded.case_status,funds_cleared=excluded.funds_cleared,delivered_date=excluded.delivered_date,note=excluded.note,updated_at=excluded.updated_at")
   .run(sub.id,sale,marketplace,shipping,returning,other,refund,caseStatus,cleared,date||null,note,now,now);
  audit(sub.id,'SETTLEMENT RECORDED/UPDATED (NO FUNDS TRANSFER)');
  return inspect(sub);
 }
 function markExternallyPaid(sub,b){
  if(process.env.AGREEMENT_PILOT_MODE==='true')throw fail('Pilot mode prohibits recording real payouts.',409);
  saleGate(sub);
  const state=inspect(sub);
  if(!state.canRecordPayment)throw fail('Payout remains blocked: '+(state.issues||[state.state]).join('; '),409);
  const reference=String(b.paymentReference??'').trim().slice(0,120);
  if(reference.length<5||!/^[a-zA-Z0-9._-]+$/.test(reference))throw fail('An external payment reference of at least five letters/numbers is required.');
  const paidAt=new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
   const updated=db.prepare("UPDATE consignment_settlements SET paid_at=?,payment_reference=?,updated_at=? WHERE submission_id=? AND paid_at IS NULL").run(paidAt,reference,paidAt,sub.id);
   if(updated.changes!==1)throw fail('Payout already recorded.',409);
   db.prepare("UPDATE submissions SET status='PAID',updated_at=? WHERE id=? AND status IN ('SOLD','SHIPPED')").run(paidAt,sub.id);
   audit(sub.id,'EXTERNAL PAYOUT RECORDED (NO TRANSFER) '+reference);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return {recorded:true,settlement:compute(get(sub.id)),paymentExecuted:false};
 }
 return {inspect,save,markExternallyPaid};
}
