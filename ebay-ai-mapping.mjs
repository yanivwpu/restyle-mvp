export function createEbayMapping({db,oauth,photoUrls=()=>[],fetcher=fetch}){
 db.exec("CREATE TABLE IF NOT EXISTS ebay_ai_mapping_tasks(submission_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,state TEXT NOT NULL,preview_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 const fail=(status,message)=>Object.assign(new Error(message),{status});
 const now=()=>new Date().toISOString();
 const endpoint='https://graphqlapi.ebay.com/graphql';
 const mutation='mutation Start($input:StartListingPreviewsCreationInput!){startListingPreviewsCreation(input:$input){listingPreviewsCreationTask{id} errors{errorDescription}}}';
 const query='query Task($input:ListingPreviewsCreationTaskByIdInput!){listingPreviewsCreationTaskById(input:$input){listingPreviewsCreationTask{id result{completionStatus listingPreviews{title description sku mappingReferenceId category{categoryId name} aspects{name values{value confidence}}} invalidProducts{description} unmappedProducts{title sku} unprocessedProducts{title sku}}}}}';
 async function call(token,document,variables){
  const r=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json','X-EBAY-C-MARKETPLACE-ID':'EBAY_US'},body:JSON.stringify({query:document,variables}),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw fail(502,'eBay AI service returned HTTP '+r.status);
  const data=await r.json();if(data.errors?.length)throw fail(502,'eBay AI returned a query error. No draft was approved.');
  return data.data;
 }
 function inspect(sub){const t=db.prepare('SELECT task_id,state,preview_json,created_at,updated_at FROM ebay_ai_mapping_tasks WHERE submission_id=?').get(sub.id);return t?{taskId:t.task_id,status:t.state,preview:t.preview_json?JSON.parse(t.preview_json):null,createdAt:t.created_at,updatedAt:t.updated_at}:null;}
 async function start(sub,agreement,details){
  if(!oauth.aiStatus().connected)throw fail(409,'Connect eBay AI under connection settings.');
  if(agreement?.state!=='SIGNED'||!['AWAITING_SHIPMENT','RECEIVED','READY_TO_LIST'].includes(sub.status))throw fail(409,'Signed agreement and accepted consignment are required.');
  const previous=inspect(sub);if(previous&&['PENDING','COMPLETED'].includes(previous.status)&&details?.regenerate!==true)return previous;
  const title=[sub.brand,sub.category,sub.condition,sub.description].filter(Boolean).join(' ').slice(0,250);
  const images=photoUrls(sub);if(!images.length)throw fail(409,'At least one approved product photo is required.');
  const aspects=[['Brand',sub.brand],['Condition',sub.condition],['Color',details?.color],['Material',details?.material]].filter(x=>x[1]).map(([name,value])=>({name,values:[String(value).slice(0,100)]}));
  const data=await call(await oauth.getAIToken(),mutation,{input:{externalProducts:[{sku:sub.sku||sub.id,title,images,aspects}]}});
  const task=data?.startListingPreviewsCreation?.listingPreviewsCreationTask?.id;
  if(!task||!/^[A-Za-z0-9_-]{1,25}$/.test(task))throw fail(502,'eBay did not return a valid task ID.');
  const time=now();db.prepare("INSERT INTO ebay_ai_mapping_tasks(submission_id,task_id,state,preview_json,created_at,updated_at) VALUES (?,?,?,NULL,?,?) ON CONFLICT(submission_id) DO UPDATE SET task_id=excluded.task_id,state=excluded.state,preview_json=NULL,updated_at=excluded.updated_at").run(sub.id,task,'PENDING',time,time);
  return inspect(sub);
 }
 async function poll(sub){
  const t=inspect(sub);if(!t)throw fail(404,'No eBay AI preview task for this item.');
  if(t.status==='COMPLETED')return t;
  const data=await call(await oauth.getAIToken(),query,{input:{id:t.taskId}});
  const result=data?.listingPreviewsCreationTaskById?.listingPreviewsCreationTask?.result;
  if(!result)return t;
  const p=result.listingPreviews?.[0];
  const preview=p?{title:String(p.title||'').slice(0,80),description:String(p.description||'').slice(0,12000),categoryId:String(p.category?.categoryId||''),categoryName:String(p.category?.name||''),aspects:Array.isArray(p.aspects)?p.aspects.slice(0,50):[],mappingReferenceId:String(p.mappingReferenceId||'')}:null;
  const status=result.completionStatus==='COMPLETED'&&preview?'COMPLETED':'REVIEW_REQUIRED';
  db.prepare('UPDATE ebay_ai_mapping_tasks SET state=?,preview_json=?,updated_at=? WHERE submission_id=?').run(status,preview?JSON.stringify(preview):null,now(),sub.id);
  return inspect(sub);
 }
 return {inspect,start,poll};
}
