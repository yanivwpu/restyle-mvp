// Bulk listing readiness is deliberately read-only. Publishing requires a separate, audited eBay write workflow.
export function evaluateListingForBatch({item,draft,gates=[],photos=[],duplicateSku=false}){
 const blockers=[];
 if(!draft)blockers.push('Listing draft missing');
 if(draft?.status!=='REVIEWED')blockers.push('Staff review required');
 blockers.push(...gates);
 if(!item?.received_verified)blockers.push('Physical receipt is not verified');
 if(!item?.sku?.trim())blockers.push('Warehouse SKU missing');
 if(duplicateSku)blockers.push('Duplicate warehouse SKU');
 if(!item?.bin_location?.trim())blockers.push('Warehouse bin missing');
 if(!draft?.title?.trim()||draft.title.length>80)blockers.push('Valid eBay title required (1–80 characters)');
 if(!draft?.description?.trim())blockers.push('Listing description missing');
 if(!Number.isSafeInteger(draft?.price_cents)||draft.price_cents<=0)blockers.push('Valid asking price missing');
 if(!/^\d+$/.test(String(draft?.category_id||'')))blockers.push('Numeric eBay category ID missing');
 if(!photos.length)blockers.push('At least one chosen listing photo required');
 // Staff-reviewed descriptions are authoritative; AI phrase heuristics must not block approved listings.
 // Mandatory completeness, inventory, and eBay-required checks above still apply.
 return {id:item.id,sku:item.sku||'',title:draft?.title||'',localReady:blockers.length===0,blockers:[...new Set(blockers)],ebayOfferPrepared:false,livePublishEnabled:false};
}
