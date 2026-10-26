import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = (v)=>crypto.createHash('sha256').update(v).digest('hex');
const date = ()=>new Date().toISOString();
const safe = (v)=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
export const escapeHtml = safe;
const $pdf = (v)=>String(v??'').normalize('NFKD').replace(/[^\x20-\x7e]/g,'?').replace(/[\\()]/g,'\\$&');
function pdfPage(lines){
  let str='BT /F1 10 Tf 48 755 Td 13 TL\n';
  for(const line of lines)str+=`(${ $pdf(line) }) Tj T*\n`;
  return str+'ET\n';
}
// Small self-contained, valid text PDF. Signed original text + structured evidence also stored separately.
export function agreementPdf(lines){
  const pages=[];for(let i=0;i<lines.length;i+=50)pages.push(lines.slice(i,i+50));
  if(!pages.length)pages.push(['RESTYLE signed agreement']);
  const objects=['', '<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const lines of pages){
    const pageId=objects.length, contentId=pageId+1;
    kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    const bytes=Buffer.from(pdfPage(lines),'ascii');
    objects.push(`<< /Length ${bytes.length} >>\nstream\n${bytes.toString('ascii')}endstream`);
  }
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf='%PDF-1.4\n';const offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf,'latin1');pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf,'latin1');pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'latin1');
}
const wrap=(value,n=89)=>{
  const words=String(value).replace(/\r/g,'').split(/\s+/);const lines=[];let line='';
  for(const word of words){if(!word)continue;if((line+' '+word).trim().length>n){if(line)lines.push(line);line=word;}else line=(line+' '+word).trim();}
  if(line)lines.push(line);return lines;
};
const mail=(title,content)=>`<div style="font:16px Arial,sans-serif;max-width:580px;margin:auto;color:#242225;line-height:1.65"><h1 style="font-size:26px">RESTYLE<span style="color:#ff8926">.</span></h1><h2>${safe(title)}</h2>${content}<p style="font-size:13px;color:#777">RESTYLE · Your pieces. Their next chapter.</p></div>`;

export function createSigning({db,dir,baseUrl,queueMail,sendPending,audit}){
  const folder=path.join(dir,'agreements');fs.mkdirSync(folder,{recursive:true,mode:0o700});
  db.exec(`CREATE TABLE IF NOT EXISTS consignment_agreements (
    submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, token_expires_at TEXT NOT NULL,
    terms_snapshot TEXT NOT NULL, terms_sha256 TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    signer_name TEXT, signer_email TEXT, signed_at TEXT,
    signer_ip TEXT, signer_user_agent TEXT,
    signature_sha256 TEXT, pdf_sha256 TEXT, pdf_file TEXT,
    created_at TEXT NOT NULL
  );`);
  const terms=String(process.env.CONSIGNMENT_AGREEMENT_TEXT||'').trim();
  const shipping=String(process.env.CONSIGNMENT_SHIPPING_INSTRUCTIONS||'').trim();
  const pilot=process.env.AGREEMENT_PILOT_MODE==='true';
  const configured=terms.length>=50 && shipping.length>=15;
  const enabled=configured && (pilot || process.env.AGREEMENT_LEGAL_APPROVED==='true');
  function state(id){return db.prepare('SELECT submission_id, state, signer_name, signed_at, terms_sha256, pdf_sha256 FROM consignment_agreements WHERE submission_id=?').get(id)||null;}
  function full(id){return db.prepare('SELECT * FROM consignment_agreements WHERE submission_id=?').get(id)||null;}
  function agreementByToken(token){if(!/^[a-f0-9]{64}$/.test(token))return null;return db.prepare('SELECT * FROM consignment_agreements WHERE token_hash=?').get(sha(token))||null;}
  function acceptance(sub){
    if(!enabled)throw Object.assign(new Error('Set reviewed agreement terms and shipping instructions before accepting items.'),{status:409});
    const existing=full(sub.id);
    if(existing?.state==='SIGNED')throw Object.assign(new Error('This item already has a signed agreement.'),{status:409});
    // Creates a one-time private signing link; the raw token appears only in the customer email.
    const token=crypto.randomBytes(32).toString('hex');
    const expires=new Date(Date.now()+14*24*3600_000).toISOString();
    const snapshot=`RESTYLE CONSIGNMENT AGREEMENT\nSubmission: ${sub.id}\nItem: ${sub.brand} / ${sub.category}\nConsignor email: ${sub.email}\n\n${terms}\n\nPlease do not ship any item before the agreement is signed and shipping instructions are provided.`;
    db.prepare(`INSERT INTO consignment_agreements (submission_id, token_hash, token_expires_at, terms_snapshot, terms_sha256, created_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(submission_id) DO UPDATE SET token_hash=excluded.token_hash, token_expires_at=excluded.token_expires_at,
      terms_snapshot=excluded.terms_snapshot, terms_sha256=excluded.terms_sha256, state='PENDING', signer_name=NULL, signer_email=NULL,
      signed_at=NULL, signer_ip=NULL, signer_user_agent=NULL, signature_sha256=NULL, pdf_sha256=NULL, pdf_file=NULL, created_at=excluded.created_at`).run(sub.id,sha(token),expires,snapshot,sha(snapshot),date());
    const link=`${baseUrl}/sign/${token}`;
    const title=pilot?'Pilot item approved — test agreement':'Your item is approved — please sign the agreement';
    queueMail(sub.id,'approval_sign',sub.email,`RESTYLE: ${title} (${sub.id})`,mail(title,`<p>Hi ${safe(sub.first_name)},</p><p>We've provisionally approved your item for the next step. Eligible items are prepared for resale on eBay through our designated seller account after receipt and inspection; RESTYLE is independent of eBay.</p><p>Before signing, please review the payout tiers, 90-day minimum consignment period, shipping and returns costs, and post-sale payment timing in your agreement. Your exact payout depends on the final selling price and eligible transaction expenses.</p><p><a href="${safe(link)}" style="display:inline-block;background:#ff8926;color:white;padding:13px 18px;border-radius:8px">Review and e-sign your agreement</a></p><p>This private link expires in 14 days. <strong>Do not ship anything yet.</strong> Shipping instructions will be emailed after the agreement is signed and accepted.</p><p>Reference: ${safe(sub.id)}</p>`));
    audit(sub.id,'AGREEMENT LINK ISSUED');
  }
  function rejection(sub){
    const previous=full(sub.id);if(previous?.state==='SIGNED')throw Object.assign(new Error('A signed agreement exists; resolve it before rejecting.'),{status:409});
    if(previous)db.prepare("UPDATE consignment_agreements SET state='VOID',token_hash=?,token_expires_at=? WHERE submission_id=?").run(sha(crypto.randomBytes(32)),date(),sub.id);
  }
  async function sign(token,body,req){
    const record=agreementByToken(token);
    if(!record)return {code:404,error:'Agreement link not found or no longer valid.'};
    if(record.state==='SIGNED')return {code:409,error:'This agreement has already been signed.'};
    if(record.state!=='PENDING'||record.token_expires_at<date())return {code:410,error:'This signing link has expired or been cancelled.'};
    const sub=db.prepare('SELECT * FROM submissions WHERE id=?').get(record.submission_id);
    if(!sub||sub.status!=='ACCEPTED')return {code:409,error:'This item is not approved for signature.'};
    const signer=String(body?.signerName||'').trim().replace(/\s+/g,' ').slice(0,120);
    const email=String(body?.email||'').trim().toLowerCase();
    if(signer.length<3||!signer.includes(' ')||email!==sub.email.toLowerCase()||body?.electronicConsent!==true||body?.agreeTerms!==true||body?.typedSignature!==true)return {code:400,error:'Enter your full legal name and matching email, and confirm both consents and signature.'};
    const signedAt=date(); const ip=String(req.socket?.remoteAddress||'unavailable').slice(0,100);const ua=String(req.headers?.['user-agent']||'unavailable').slice(0,300);
    const evidence=JSON.stringify({submission:sub.id,signer,email,signedAt,ip,ua,termsSha256:record.terms_sha256,method:'typed-name + explicit e-sign consent + emailed private link'});
    const signatureHash=sha(evidence);
    const lines=['RESTYLE - SIGNED CONSIGNMENT AGREEMENT','',...record.terms_snapshot.split('\n').flatMap(line=>line?wrap(line):['']),'','ELECTRONIC SIGNATURE / AUDIT','Signer: '+signer,'Email: '+email,'Signed at (UTC): '+signedAt,'Consented to electronic records and signatures: YES','Affirmatively accepted agreement terms: YES','Signature method: typed full legal name',`IP address: ${ip}`,`User agent: ${ua}`,`Terms SHA-256: ${record.terms_sha256}`,`Evidence SHA-256: ${signatureHash}`];
    const document=agreementPdf(lines);const file=`${sub.id}-${sha(signedAt).slice(0,10)}.pdf`;
    fs.writeFileSync(path.join(folder,file),document,{flag:'wx',mode:0o600});
    // One update wins for this item: refuse concurrent double signatures.
    const update=db.prepare("UPDATE consignment_agreements SET state='SIGNED', signer_name=?, signer_email=?, signed_at=?, signer_ip=?, signer_user_agent=?, signature_sha256=?, pdf_sha256=?, pdf_file=? WHERE submission_id=? AND state='PENDING'").run(signer,email,signedAt,ip,ua,signatureHash,sha(document),file,sub.id);
    if(update.changes!==1){fs.unlinkSync(path.join(folder,file));return {code:409,error:'Agreement was already signed.'};}
    audit(sub.id,`AGREEMENT SIGNED ${record.terms_sha256.slice(0,12)}`);
    db.prepare("UPDATE submissions SET status='AWAITING_SHIPMENT', updated_at=? WHERE id=?").run(date(),sub.id);
    const summary=`<p>Hi ${safe(sub.first_name)},</p><p>Thank you. Your agreement is signed and stored with submission <strong>${safe(sub.id)}</strong>.</p>`;
    queueMail(sub.id,'signed_receipt',sub.email,`RESTYLE: Signed agreement received (${sub.id})`,mail('Agreement signed',summary+'<p>A copy of the signed PDF is available from your private agreement link during its validity period.</p>'));
    queueMail(sub.id,'shipping',sub.email,`RESTYLE: Shipping instructions (${sub.id})`,mail(pilot?'Pilot shipping instructions — DO NOT SHIP':'You can now send your approved item',summary+`<div style="padding:17px;background:#fff4e9;white-space:pre-wrap">${safe(shipping)}</div><p>Reference: ${safe(sub.id)}. Do not send additional unapproved items. Retain your shipment tracking.</p>`));
    if(process.env.ADMIN_NOTIFY_EMAIL)queueMail(sub.id,'agreement_signed_admin',process.env.ADMIN_NOTIFY_EMAIL,`RESTYLE: Agreement signed (${sub.id})`,mail('Consignment agreement signed',`<p>${safe(signer)} has signed agreement ${safe(sub.id)}.</p><p>View their submission in the private staff dashboard.</p>`));
    await sendPending(sub.id);
    return {code:200,ok:true,id:sub.id, pdfUrl:`/api/agreements/${token}/pdf`};
  }
  function preview(token){const record=agreementByToken(token);if(!record)return null;
    if(record.state==='VOID'||record.token_expires_at<date())return {expired:true};
    return {itemId:record.submission_id,terms:record.terms_snapshot,termsSha256:record.terms_sha256,signed:record.state==='SIGNED',signedAt:record.signed_at,expiresAt:record.token_expires_at};}
  function getPdfForAdmin(submissionId){const r=full(submissionId);return r?.state==='SIGNED'&&r.pdf_file?path.join(folder,r.pdf_file):null;}
  function getPdfForSigner(token){const r=agreementByToken(token);if(!r||r.state!=='SIGNED'||r.token_expires_at<date()||!r.pdf_file)return null;return path.join(folder,r.pdf_file);}
  return {enabled,pilot,state,full,acceptance,rejection,sign,preview,getPdfForAdmin,getPdfForSigner};
}