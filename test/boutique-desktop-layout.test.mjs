import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Boutique header uses the same logo asset and desktop dimensions as homepage',()=>{
 const homepage=read('public/index.html'),boutique=read('public/partners.html');
 const homepageCss=read('public/assets/style.css'),css=read('public/assets/merchant.css');
 assert.match(homepage,/src="\/assets\/shukchic-logo\.svg\?v=20261027-black80"/);
 assert.match(boutique,/class="merchant-head-logo" src="\/assets\/shukchic-logo\.svg\?v=20261027-black80"/);
 assert.match(boutique,/class="merchant-head-inner"/);
 assert.match(homepageCss,/\.brand-logo\{display:block;width:206px/);
 assert.match(homepageCss,/\.container\{max-width:1496px;padding-left:clamp\(32px,2\.8vw,44px\)/);
 assert.match(css,/\.merchant-public \.merchant-head \.merchant-head-logo\{display:block;width:206px/);
 assert.match(css,/\.merchant-public \.merchant-head-inner\{max-width:1496px;min-height:108px;padding:5px clamp\(32px,2\.8vw,44px\)\}/);
 for(const [breakpoint,width] of [['801px','168px'],['800px','155px'],['480px','126px']]){
  assert.match(css,new RegExp('@media[^\\n]*'+breakpoint+'[^]*?\\.merchant-public \\.merchant-head \\.merchant-head-logo\\{width:'+width+'\\}'));
 }
});

test('Desktop boutique content grows but merchant installed-app UI remains unchanged',()=>{
 const css=read('public/assets/merchant.css');
 const extension=css.split('/* Boutique page: align its header to the homepage')[1];
 assert.ok(extension);
 assert.match(extension,/\.merchant-public \.partner-hero\{max-width:1496px/);
 assert.match(extension,/\.merchant-public \.partner-hero h1\{font-size:clamp\(70px,5\.9vw,88px\)/);
 assert.match(extension,/\.merchant-public \.partner-hero>div>p\{font-size:20px/);
 assert.match(extension,/\.merchant-public \.partner-steps>h2\{font-size:41px/);
 assert.match(extension,/\.merchant-public \.partner-step-grid p\{font-size:16\.5px/);
 assert.doesNotMatch(extension,/\.merchant-app\s/);
 assert.match(read('public/partners.html'),/href="\/merchant\?start=1"/);
 assert.match(read('public/partners.html'),/<summary>Check pay schedule<\/summary>/);
});

test('Payout disclosure opens without vertically re-centering the Boutique S visual',()=>{
 const page=read('public/partners.html');
 const css=read('public/assets/merchant.css');
 assert.match(page,/<details class="merchant-payout-disclosure">/);
 assert.match(page,/<div class="partner-visual">/);
 assert.match(page,/merchant\.css\?v=20261120-stationary-art/);
 assert.match(css,/@media\(min-width:801px\)\{\s*\.merchant-public \.partner-hero > div:first-child\{align-self:start;margin-top:10px\}\s*\.merchant-public \.partner-hero > \.partner-visual\{align-self:start;margin-top:32px\}/);
 // The fix is desktop-only; a stacked mobile layout still uses its normal document flow.
 const artworkCss=css.slice(css.indexOf('/* Keep the hero artwork fixed'),css.indexOf('/* Merchant install button:'));
 assert.doesNotMatch(artworkCss, /@media\(max-width/);
});
