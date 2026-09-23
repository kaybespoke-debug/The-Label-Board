// The order form, and the document it produces.
//
// Two complaints on 21 September 2026, which turned out to be one complaint. Adding an
// order was "just a very long unending list", and "theres no where for me to create an
// invoice? like we said, invoicing should be first before an order is created". The
// invoice-first flow was built and working exactly as decided; the form hid it. The quote
// switch — the entry to the whole thing — was field 40 of 42, asked after the stock used,
// the maker, the profit and the director allocation.
//
// So this gate holds two decisions.
//
// THE FORM. Eight fields to price a job, standing open. The other 28 are things you only
// know AFTER the client says yes, and they live in closed sections — still in the
// document, still reachable, still saving, just not standing between somebody and the
// price. A section that is shut has to answer its own question in its summary, or it is
// only a way of hiding work rather than deferring it. And the door comes first: which one
// you pick decides whether the job starts on the production board, and nothing else.
//
// THE INVOICE. Measured against his own invoice (#308, 21 Aug 2026), which the app could
// not produce: no quantity column, no photo in the line, nowhere to write a sort code or
// an IBAN, no signature, one address box for a studio trading from Lagos and Stotfold.
// Quantity was the only structural one — an order stored a price per piece and no count —
// so it is checked at the record, at the totals and at the migration, where an order
// written before September must read as one piece and never as none.
//
// The tax arithmetic is the part worth being pedantic about: it applies to the work AFTER
// the discount and NEVER to shipping. Taxing the pre-discount figure overcharges a client,
// and taxing the courier's fee charges the studio's tax on somebody else's service. That
// makes the ORDER of those two lines load-bearing rather than cosmetic, so it is asserted
// as arithmetic and not as a string.
'use strict';
const fs=require('fs'),vm=require('vm');
const html=fs.readFileSync((process.argv[2]||'site/layi_dashboard.html'),'utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;let m,code='';
while((m=re.exec(html))){const a=m[1]||'';if(/\bsrc\s*=/.test(a))continue;const t=a.match(/type\s*=\s*["']([^"']+)["']/i);if(t&&!/javascript|module/i.test(t[1]))continue;code+='\n;'+m[2]+'\n';}
const cache={},_ls={};
const mkEl=id=>({_id:id,innerHTML:'',value:'',checked:false,textContent:'',placeholder:'',style:{},dataset:{},options:[],
  classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},getAttribute(){return null},
  appendChild(c){return c},addEventListener(){},removeEventListener(){},querySelector(){return null},querySelectorAll(){return[]},focus(){},select(){},remove(){},closest(){return null}});
const sb={console:{log(){},warn(){},error(){},debug(){}},
  document:{getElementById(i){return cache[i]||(cache[i]=mkEl(i))},querySelector(){return mkEl()},querySelectorAll(){return[]},createElement(){return mkEl()},addEventListener(){},removeEventListener(){},body:mkEl(),documentElement:mkEl(),head:mkEl(),execCommand(){return true}},
  localStorage:{getItem(k){return k in _ls?_ls[k]:null},setItem(k,v){_ls[k]=String(v)},removeItem(k){delete _ls[k]}},
  setTimeout:f=>{try{f&&f()}catch(e){}},clearTimeout(){},setInterval(){},clearInterval(){},
  requestAnimationFrame:f=>{try{f&&f()}catch(e){}},
  navigator:{userAgent:'node',onLine:true},location:{href:'',hash:'',search:''},
  alert(msg){sb.__alert=String(msg||'');},confirm(){return true},prompt(){return ''},
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}}),
  Math,Date,JSON,Object,Array,String,Number,Boolean,RegExp,Map,Set,Promise,Error,Intl,
  parseInt,parseFloat,isNaN,isFinite,encodeURIComponent,decodeURIComponent,
  btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary')};
sb.window=sb;sb.globalThis=sb;vm.createContext(sb);vm.runInContext(code,sb,{filename:'app'});sb.demoLogin();
const run=e=>vm.runInContext(e,sb);
const J=e=>JSON.parse(run('JSON.stringify('+e+')'));
run("currentUser=getUsers().find(u=>u.roleId==='owner');activeBranchView='all';");
let fails=[];const F=x=>fails.push(x);
let checks=0;const ok=(cond,msg)=>{checks++;if(!cond)F(msg);};
/* Checks that cannot answer in the same tick queue here, and the report waits on them. */
const PENDING=[];

/* ===================================================================================
   PART ONE — QUANTITY, the one structural change
   =================================================================================== */

// An item with no count is one piece. An order written before September 2026 has no count
// at all, and reading that as zero would wipe its value on the first migrate().
ok(run("ofQty({price:1000})")===1,'an item with no quantity is read as no pieces, which zeroes every order written before September');
ok(run("ofQty({price:1000,qty:0})")===1,'a quantity of zero is taken at face value, so an order can be worth nothing by accident');
ok(run("ofQty({price:1000,qty:'3'})")===3,'a quantity typed into a form arrives as text and is not read as a number');
ok(run("ofLine({price:400000,qty:2})")===800000,'price times quantity is not the amount');
ok(run("outfitsTotal([{price:1000,qty:2},{price:500}])")===2500,'the items do not total price by quantity');
ok(run("blankOutfit().qty")===1,'a new item starts with no quantity rather than one');

// and migrate() actually stamps it, so nothing downstream has to remember
run("(function(){var l=load('layi_dash_orders',[]);var o=l.find(function(x){return isClientOrder(x)});delete o.outfits[0].qty;save('layi_dash_orders',l);})();");
ok(run("getOrders().find(function(o){return isClientOrder(o)}).outfits[0].qty")===1,
  'an order stored without a quantity does not come back with one');

/* ===================================================================================
   PART TWO — THE INVOICE
   =================================================================================== */

const OID=run("getOrders().find(function(o){return isClientOrder(o)}).id");
const asInvoice=(patch)=>run(
  "(function(){var l=rawOrders();var o=l.find(function(x){return x.id==='"+OID+"'});"+
  "Object.assign(o,"+JSON.stringify(patch)+");o.value=outfitsTotal(o.outfits);save('layi_dash_orders',l);})();");
const figs=()=>J("invoiceFigures(getOrders().find(function(o){return o.id==='"+OID+"'}))");
const doc=()=>run("invoiceInner(getOrders().find(function(o){return o.id==='"+OID+"'}))");
const txt=()=>run("invoiceText(getOrders().find(function(o){return o.id==='"+OID+"'}))");

const BASE={client:'Dr. Ellis Enabosi',email:'ellis@example.com',whatsapp:'+1 973 280 9600',
  outfits:[{type:'Bespoke outfit',name:'Embellished Agbada Set',qty:2,price:400000,photos:[],
            style:'Royal blue with black embroidery',finish:'',materials:[],fabricFrom:'',craft:'',method:'',meas:{}}],
  discount:40000,paid:400000,currency:'NGN',fx:1,invoiceNo:308,due:'2026-10-18',
  delivery:{enabled:true,fee:15000,company:'Red Star Express',location:'14 Adeola Odeku Street, Victoria Island, Lagos',tracking:'RSE-884120',status:'Dispatched'}};

// --- tax off, which is how every studio starts --------------------------------------
run("SETTINGS.company=Object.assign({},SETTINGS.company,{taxOn:false,taxRate:0});save('layi_dash_settings',SETTINGS);");
asInvoice(BASE);
let f=figs();
ok(f.subtotal===800000,'the invoice subtotal ignores quantity ('+f.subtotal+')');
ok(f.tax===0,'a studio that does not charge tax is charging tax');
ok(f.total===800000-40000+15000,'with tax off the total is not subtotal minus discount plus shipping ('+f.total+')');
ok(doc().indexOf('VAT')<0,'a studio that does not charge tax has a tax line on its invoice');

// --- tax on: after the discount, never on shipping ------------------------------------
run("SETTINGS.company=Object.assign({},SETTINGS.company,{taxOn:true,taxLabel:'VAT',taxRate:7.5});save('layi_dash_settings',SETTINGS);");
f=figs();
ok(f.taxable===760000,'tax is not being worked out on the discounted figure ('+f.taxable+')');
ok(f.tax===57000,'the tax is wrong; 7.5% of the discounted 760,000 is 57,000, not '+f.tax);
ok(f.tax!==Math.round(800000*0.075),'the tax was taken before the discount, which overcharges the client');
ok(f.total===760000+57000+15000,'the total is not subtotal, less discount, plus tax, plus shipping ('+f.total+')');
// the load-bearing one, stated as arithmetic rather than as a string: raising the shipping
// fee must move the total by exactly that fee and must not move the tax by a penny.
const beforeShip=figs();
asInvoice({delivery:Object.assign({},BASE.delivery,{fee:115000})});
const afterShip=figs();
ok(afterShip.tax===beforeShip.tax,'putting the shipping up changed the tax, so the studio is charging its tax on the courier');
ok(afterShip.total-beforeShip.total===100000,'the shipping did not carry through to the total one for one');
asInvoice({delivery:BASE.delivery});

// --- the deposit is off it, and the figure is called Amount due ----------------------
f=figs();
ok(f.balance===f.total-400000,'the deposit already paid is not deducted, so the client is asked for it twice');
let d=doc();
ok(/Amount due/.test(d),'the figure at the foot of the invoice is not labelled Amount due');
// A studio may write "balance due on collection" in its own payment terms and that is its
// own wording. What may not come back is the app's LABEL for the figure at the foot.
ok(!/>Balance due</.test(d),'the figure at the foot of the invoice is still labelled Balance due');
ok(d.indexOf('(')>=0&&/\(&#8358;|\(₦/.test(d.replace(/&#8358;/g,'₦')),'a deduction is not written in brackets');

// --- price, quantity, amount ---------------------------------------------------------
['>Price<','>Qty<','>Amount<'].forEach(h=>{
  ok(d.indexOf(h)>=0,'the invoice has no '+h.replace(/[<>]/g,'')+' column');
});
ok(d.indexOf('>2<')>=0,'the quantity is not printed in the line');
ok(/800,000\.00/.test(d),'the line amount is not price by quantity');
ok(/400,000\.00/.test(d),'the unit price is not printed beside the amount');

// --- the client's email, which was the one contact detail never shown ---------------
ok(d.indexOf('ellis@example.com')>=0,'the client’s email is not on the invoice');

// --- the shipment, all four parts, not just the fee ---------------------------------
['Red Star Express','Victoria Island','RSE-884120','Dispatched'].forEach(bit=>{
  ok(d.indexOf(bit)>=0,'the invoice drops the shipment’s '+bit+'; the order knows it and the client is not told');
});

// --- two trading addresses print as two lines ---------------------------------------
run("SETTINGS.company=Object.assign({},SETTINGS.company,{address:'Lagos, Nigeria\\nStotfold, UK'});save('layi_dash_settings',SETTINGS);");
d=doc();
ok(/Lagos, Nigeria[\s\S]{0,40}Stotfold, UK/.test(d),'a studio trading from two places cannot print both');
ok(/white-space:pre-line/.test(d),'the address is printed as one run, so the second line is lost');

// --- the signature: an uploaded image above a name and a date -----------------------
run("SETTINGS.company=Object.assign({},SETTINGS.company,{signature:'data:image/png;base64,AAAA'});save('layi_dash_settings',SETTINGS);");
d=doc();
ok(d.indexOf('data:image/png;base64,AAAA')>=0,'the signature never reaches the invoice');
run("SETTINGS.company=Object.assign({},SETTINGS.company,{signature:''});save('layi_dash_settings',SETTINGS);");
ok(doc().indexOf('data:image/png;base64,AAAA')<0,'an invoice is signed by somebody who never uploaded a signature');

/* --- payment accounts, reactive to the currency -------------------------------------
   "add the sortcode, iban and bic but make it reactive, so it reflects when its the
   currency that requires it." The point is not only that a pounds account CAN hold a sort
   code; it is that a naira-only studio is never shown an IBAN box and never prints an
   empty GBP or USD heading. */
ok(run("bankFieldsFor('NGN').indexOf('iban')")<0,'a naira account is being asked for an IBAN');
ok(run("bankFieldsFor('NGN').indexOf('sort')")<0,'a naira account is being asked for a sort code');
ok(run("bankFieldsFor('GBP').indexOf('sort')")>=0,'a pounds account cannot hold a sort code');
ok(run("bankFieldsFor('USD').indexOf('iban')")>=0,'a dollars account cannot hold an IBAN');
ok(run("bankFieldsFor('USD').indexOf('bic')")>=0,'a dollars account cannot hold a BIC');
ok(run("bankFieldsFor('EUR').indexOf('iban')")>=0,'a euros account cannot hold an IBAN');
// switching an account's currency must not leave an orphan field behind on the invoice
const cleaned=J("bankClean({currency:'NGN',bank:'Kuda',name:'X',no:'1',sort:'04-00-03',iban:'GB00'})");
ok(cleaned.sort===undefined&&cleaned.iban===undefined,
  'an account moved to naira keeps the sort code it had as a pounds account and prints it');
// an account with nothing in it is never saved, so it can never print as an empty heading
ok(run("bankHasDetail({currency:'GBP'})")===false,'a blank account counts as an account and prints an empty heading');
ok(run("bankHasDetail({currency:'GBP',sort:'04-00-03'})")===true,'an account with only a sort code is thrown away');

run("SETTINGS.company=Object.assign({},SETTINGS.company,{banks:[{currency:'NGN',bank:'Kuda MFB',name:'Studio Ltd',no:'3003250397'}]});save('layi_dash_settings',SETTINGS);");
d=doc();
ok(d.indexOf('3003250397')>=0,'the studio’s own account is not on its invoice');
ok(d.indexOf('GBP')<0&&d.indexOf('USD')<0,'a naira-only studio prints empty pounds and dollars blocks');
run("SETTINGS.company=Object.assign({},SETTINGS.company,{banks:[{currency:'NGN',bank:'Kuda MFB',name:'Studio Ltd',no:'3003250397'},{currency:'GBP',bank:'Monzo',name:'O. Ojomo',no:'96503093',sort:'04-00-03'}]});save('layi_dash_settings',SETTINGS);");
asInvoice({currency:'GBP',fx:2200});
d=doc();
ok(d.indexOf('04-00-03')>=0,'a client paying in pounds is not given the sort code they need to pay');
ok(d.indexOf('3003250397')<0,'a client paying in pounds is given the naira account as well, so they pick the wrong one');
ok(txt().indexOf('04-00-03')>=0,'the sort code is on the printed invoice but not in the message the studio actually sends');
asInvoice({currency:'NGN',fx:1});

/* --- what the invoice says about payment ---------------------------------------------
   The app used to add a line of its own to a quote's invoice, saying that paying it
   confirmed the order. Kayode had it removed on 22 September because a studio says that
   better in its own voice. What replaced it is a general set of terms every studio starts
   with and is expected to rewrite, "since no 2 studios have same".

   So there are two rules, and the second is the one that used to read the other way round:
   a studio's own words always win, and a studio that has written none still sends an
   invoice that says what paying does. The payment block can no longer be empty, because
   it can no longer be nothing. */
run("SETTINGS.company=Object.assign({},SETTINGS.company,{banks:[],payInstructions:''});save('layi_dash_settings',SETTINGS);");
ok(run("payTerms()")===run("DEFAULT_PAY_TERMS"),'a studio that has written no terms falls back to nothing');
{const bare=doc();
 ok(bare.indexOf('A deposit confirms your order')>=0,
   'a studio that has never opened the terms box sends an invoice saying nothing about what paying does');
 ok(bare.indexOf('>Payment<')>=0,'the general terms print with no heading over them');}
run("SETTINGS.company=Object.assign({},SETTINGS.company,{banks:[{currency:'NGN',bank:'Kuda MFB',name:'Studio Ltd',no:'3003250397'}],payInstructions:'Balance on collection.'});save('layi_dash_settings',SETTINGS);");
ok(run("payTerms()")==='Balance on collection.','a studio wrote its own terms and the general ones won anyway');
ok(doc().indexOf('Balance on collection.')>=0,
  'the studio wrote payment terms and the invoice drops them, so nothing on it says what paying does');
ok(doc().indexOf('A deposit confirms your order')<0,
  'a studio that wrote its own terms is having the general ones printed underneath them as well');
ok(txt().indexOf('Balance on collection.')>=0,'the message summary drops the terms the invoice carries');
// whitespace is not terms
run("SETTINGS.company=Object.assign({},SETTINGS.company,{payInstructions:'   '});save('layi_dash_settings',SETTINGS);");
ok(run("payTerms()")===run("DEFAULT_PAY_TERMS"),'a box holding only spaces counts as terms, so the invoice prints a blank line');
run("SETTINGS.company=Object.assign({},SETTINGS.company,{payInstructions:'Balance on collection.'});save('layi_dash_settings',SETTINGS);");
run("(function(){var l=rawOrders();var o=l.find(function(x){return x.id==='"+OID+"'});o.quoted=true;delete o.confirmedAt;save('layi_dash_orders',l);})();");
ok(run("isQuote(getOrders().find(function(o){return o.id==='"+OID+"'}))")===true,'the fixture is not a quote');
ok(!/once payment is received/i.test(doc()),
  'the app is writing its own promise onto a quote again, alongside the studio’s terms saying the same thing');

/* --- one page, and the finished piece on its own page after it ----------------------
   He wants the thumbnail in the line AND the piece large. Confirmed twice. The large one
   goes on a page of its own rather than lengthening the invoice, because his own invoice
   is one page and he wants that. */
asInvoice({outfits:[Object.assign({},BASE.outfits[0],{photos:['data:image/png;base64,PIECE']})],
  updates:[{at:new Date().toISOString(),stage:'Ready for Delivery',note:'Finished',by:'Franklin',photos:['data:image/png;base64,FINISHED']}]});
d=doc();
ok(/<td[^>]*>[\s\S]{0,400}data:image\/png;base64,PIECE/.test(d),'there is no photo in the invoice line itself');
ok(/page-break-before:always/.test(d)&&/break-before:page/.test(d),
  'the large finished-piece photo is lengthening the invoice instead of following on its own page');
ok(d.indexOf('data:image/png;base64,FINISHED')>=0,'the piece as it left the workroom is not shown large');
ok(d.split('data:image/png;base64,FINISHED').length-1===1,'the finished piece is printed more than once');
// a studio that has turned photos off gets none of it
run("SETTINGS.company=Object.assign({},SETTINGS.company,{showPhotos:false});save('layi_dash_settings',SETTINGS);");
ok(doc().indexOf('data:image/png;base64,')<0,'a studio that turned photos off still has photos on its invoices');
run("SETTINGS.company=Object.assign({},SETTINGS.company,{showPhotos:true});save('layi_dash_settings',SETTINGS);");

// --- the message and the document must agree, line for line -------------------------
const t=txt();f=figs();
[['Subtotal',f.subtotal],['Total',f.total]].forEach(([label,v])=>{
  ok(t.indexOf(label+': ')>=0,'the message summary has no '+label+' line');
});
ok(/Amount due: /.test(t),'the message summary does not say what is due');
ok(t.indexOf('VAT 7.5%')>=0,'the message summary leaves the tax off, so it disagrees with the invoice');
ok(t.indexOf('×2')>=0,'the message summary drops the quantity');

// --- a receipt is not an invoice ----------------------------------------------------
const rec=run("invoiceInner(getOrders().find(function(o){return o.id==='"+OID+"'}),'receipt')");
ok(/RECEIPT/.test(rec),'a receipt is not headed as one');
ok(!/Amount due/.test(rec),'a receipt is asking for money');
asInvoice({paid:1000000});
ok(/PAID IN FULL/.test(run("invoiceInner(getOrders().find(function(o){return o.id==='"+OID+"'}),'receipt')")),
  'a fully paid order gets a receipt that does not say so');
asInvoice({paid:400000});

/* ===================================================================================
   PART THREE — TWO DOORS, AND A FORM THAT IS A FORM

   Rewritten 23 September. The first shape was wrong and was said so plainly: "I don’t
   like how this looks ... its still the same old complaints I have been having. The
   stories and explanations are unnecessary, a form should be a form. The 2 doors should
   be one for invoice only and one for new order. Invoice page has no business with
   measurements and everything on image 5."

   So two things are held here, and they pull in the same direction.

   THE DOORS ARE AN INVOICE AND AN ORDER, not two flavours of the same form. Underneath it
   is still ONE record, which is the decision audit_quote protects and which nothing here
   changes: an invoice is an order nobody has confirmed. What differs is how much of that
   record each door asks for. The invoice form carries nothing about the workroom, because
   a client’s bill has no opinion about who is cutting the cloth.

   AND A FORM IS A FORM. Helper sentences were asked to go three times. They are counted
   here rather than described, because prose creeps back one well-meaning sentence at a
   time and nobody ever notices the one they added.
   =================================================================================== */

ok(run("typeof newOrder")==='function','there is no door to pick, so adding an order never asks');
run("closeModal();draft=null;newOrder();");
let doors=run("document.getElementById('modal').innerHTML")||'';
ok(/>Invoice</.test(doors),'there is no door for an invoice');
ok(/New order/.test(doors),'there is no door for an order');
ok(/openOrder\(null,'invoice'\)/.test(doors)&&/openOrder\(null,'order'\)/.test(doors),
  'a door does not open anything');
// the door screen is two choices and a way out, not a page of reading
ok((doors.match(/[.!?]/g)||[]).length<=6,'the door screen has turned into an explanation');
(doors.match(/onclick="[^"]*"/g)||[]).forEach(att=>{
  (att.match(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(hit=>{
    const fn=hit.replace(/[^\w$]/g,'');
    ok(run("typeof "+fn)==='function','the door screen wires up '+fn+'(), which does not exist');
  });
});

/* --- the invoice door: one record, and none of the workroom ------------------------- */
run("closeModal();draft=null;openOrder(null,'invoice');");
ok(run("isQuote(draft)")===true,'an invoice does not start as a quote, so it goes on the production board before anybody has agreed to it');
let inv=run("document.getElementById('modal').innerHTML")||'';
ok(!!inv,'the invoice form rendered nothing');
ok(/New invoice/.test(inv),'the invoice form is not headed as an invoice');
// what a bill has no opinion about
[['f_stage','what stage it is at'],['comm_staff_0','who is making it'],['c_amt_0','what the cloth cost'],
 ['su_item_0','what stock it draws down'],['f_del_on','who is delivering it'],['om_fit','the measurements'],
 ['f_diron','the director allocation'],['of_style_0','the styling'],['of_finish_0','the finishing']]
  .forEach(([id,what])=>ok(inv.indexOf('id="'+id+'"')<0,'the invoice form is asking about '+what));
ok(inv.indexOf('class="osec"')<0,'the invoice form has the order\u2019s closed sections on it');
ok(!/orderProfit|Retained business profit/.test(inv),'the invoice form is showing the studio its own profit on a document meant for a client');
// and it still asks everything a bill needs
[['f_client','who it is for'],['f_whatsapp','their phone'],['of_type_0','what kind of piece'],
 ['of_name_0','what to call it'],['of_price_0','the price'],['of_qty_0','how many'],
 ['of_code_0','the product code'],['of_disc_0','anything off that piece'],['f_discount','anything off the order'],
 ['f_currency','what they pay in'],['f_paid','the deposit'],['f_due','when it is ready']]
  .forEach(([id,what])=>ok(inv.indexOf('id="'+id+'"')>=0,'the invoice form does not ask '+what));
ok(/Deposit asked/.test(inv),'the invoice asks what has been paid rather than what is being asked for');

/* --- the order door: everything, with the after-the-yes half behind a tap ----------- */
run("closeModal();draft=null;openOrder(null,'order');");
ok(run("isQuote(draft)")===false,'coming in through the order door still starts it as a quote');
run("closeModal();draft=null;openOrder();");
ok(run("isQuote(draft)")===false,'openOrder() with no door no longer opens an ordinary order');
ok(!!run("document.getElementById('f_quoted')"),'the quote switch has gone from the order form');
let form=run("document.getElementById('modal').innerHTML")||'';
ok((form.match(/class="osec"/g)||[]).length>=5,'the deferred fields are not in sections, so they are back in one long run');
[['f_email','the client\u2019s email'],['f_address','where it is going'],['f_discount','the discount'],
 ['f_currency','the currency'],['f_stage','the stage'],['f_del_on','the delivery'],
 ['comm_staff_0','who is making it'],['of_style_0','the styling'],['of_finish_0','the finishing'],
 ['of_code_0','the product code'],['of_disc_0','the discount on a piece']].forEach(([id,what])=>{
  ok(form.indexOf('id="'+id+'"')>=0,'moving the form around lost '+what+'; a field that is not rendered is a field that stops saving');
});
ok(form.indexOf("openOrderSection('osecStock')")<0||form.indexOf('id="osecStock"')>=0,
  'the inventory row points at a section that does not exist');

/* --- a form is a form ---------------------------------------------------------------
   Counted, not described. Every helper paragraph on the order form, and separately the
   sentences on the shorter invoice form, which should have almost none. A cap rather than
   a ban, because a figure like "Balance: N0" earns its line and a warning about a client\u2019s
   own cloth is not chatter. */
{const helpers=(form.match(/class="sd"/g)||[]).length;
 ok(helpers<=12,'the order form is carrying '+helpers+' lines of helper text; a form is a form');
 const invHelpers=(inv.match(/class="sd"/g)||[]).length;
 ok(invHelpers<=4,'the invoice form is carrying '+invHelpers+' lines of helper text');
 /* the specific sentences that were asked to go, by name, so they cannot drift back */
 ['None of this is in your way','Most of it you cannot know yet',
  'Pick an existing client to auto-fill','saved to Customers on save',
  'Comes off before any tax','Switch if this client pays in pounds',
  'Staff commissions & delivery are counted','Add fabric suppliers under Supplies',
  'Most orders are a single piece','These also show on the client',
  'Deducts from Supplies when you save','Everyone who earns on this order',
  'A share of this order','Add couriers under Supplies',
  'Prints under the item on the invoice','Comes off this line only'
 ].forEach(sentence=>{
   ok(form.indexOf(sentence)<0,'an explanation that was asked to go is back on the form: "'+sentence+'"');
 });}

/* --- the phone book ------------------------------------------------------------------
   The browser shows its own picker, so the app never sees the address book, only the one
   person chosen. Where a browser does not offer it the button is not drawn, rather than
   drawn and dead: this sandbox has no navigator.contacts, which is the same answer an
   iPhone gives. */
ok(run("typeof pickContact")==='function','there is no way to take a client from the phone book');
ok(run("typeof contactsSupported")==='function','nothing checks whether the browser offers contacts');
ok(run("contactsSupported()")===false,'a browser with no contacts API is being told it has one');
ok(form.indexOf('pickContact()')<0,'a browser that cannot offer contacts is being shown the button anyway');

// the form still reads the quantity and the piece discount back
run("document.getElementById('of_price_0').value='400000';document.getElementById('of_qty_0').value='3';syncOrderDraft();");
ok(run("draft.outfits[0].qty")===3,'typing a quantity into the form does not reach the order');
ok(run("draft.value")===1200000,'the order value does not follow the quantity typed into the form');
run("document.getElementById('of_qty_0').value='0';syncOrderDraft();");
ok(run("draft.outfits[0].qty")===1,'a quantity of none can be saved, and the order is then worth nothing');
run("closeModal();draft=null;");
/* ===================================================================================
   PART FOUR — THE ITEM ROW, 22 September

   Four things off the sheet Kayode sent: a product code, a discount on the line, saving a
   piece for next time, and a way to reach the stock from the piece.

   The discount is the one with consequences. His reason for wanting both: "we can agree to
   give an outfit off one outfit and not on the other outfits ... we can do from indivudial
   piece or from all pieces." So they stack, in one fixed order — the line discount comes
   off the line, the order discount comes off what is left, and the tax comes off what is
   left after THAT, with the shipping still outside all of it. Three deductions and one
   order of operations, asserted here as arithmetic, because that is the only form of it a
   reworded invoice cannot quietly pass.
   =================================================================================== */

ok(run("ofGross({price:400000,qty:2})")===800000,'the gross of a line is not price by quantity');
ok(run("ofDiscount({price:400000,qty:2,discount:5000})")===5000,'a discount on a line is not read');
ok(run("ofDiscount({price:1000,qty:1})")===0,'a line with no discount is discounted anyway');
ok(run("ofDiscount({price:1000,qty:1,discount:-500})")===0,
  'a negative discount is taken at face value, so an item quietly charges more than its price');
ok(run("ofDiscount({price:1000,qty:1,discount:9999})")===1000,
  'a discount bigger than the line is allowed, so the line pays the client back');
ok(run("ofLine({price:400000,qty:2,discount:5000})")===795000,'the line is not its gross less its own discount');
ok(run("outfitsTotal([{price:1000,qty:2,discount:300},{price:500}])")===2200,
  'the items do not total net of their own discounts');
ok(run("blankOutfit().discount")===0,'a new item starts out discounted');
ok(run("blankOutfit().code")==='','a new item starts with a product code nobody typed');
// Kayode, 22 September: "keep it off by default". A price quoted once with a discount on
// it must not quietly become the studio's list price.
ok(run("blankOutfit().saveToCatalog")===false,
  'a new item is set to write itself into the product types, so one-off jobs rewrite the price list');
// and an order written before today comes back with neither
run("(function(){var l=load('layi_dash_orders',[]);var o=l.find(function(x){return isClientOrder(x)});delete o.outfits[0].discount;delete o.outfits[0].code;save('layi_dash_orders',l);})();");
{const it=J("getOrders().find(function(o){return isClientOrder(o)}).outfits[0]");
 ok(it.discount===0&&it.code==='','an order stored before the line discount existed does not come back with one');}

/* --- the order of operations, end to end ------------------------------------------- */
run("SETTINGS.company=Object.assign({},SETTINGS.company,{taxOn:true,taxLabel:'VAT',taxRate:7.5});save('layi_dash_settings',SETTINGS);");
asInvoice(Object.assign({},BASE,{outfits:[Object.assign({},BASE.outfits[0],{discount:5000})]}));
f=figs();
ok(f.subtotal===795000,'the subtotal is not net of the discount on the line ('+f.subtotal+')');
ok(f.taxable===755000,'the order discount does not come off after the line discount ('+f.taxable+')');
ok(f.tax===Math.round(755000*7.5)/100,'the tax is not taken on what is left after both discounts');
ok(f.total===755000+f.tax+15000,'the total does not follow line discount, then order discount, then tax, then shipping');
// raising the LINE discount must reduce the tax, because it is inside the taxable base
{const a=figs();
 asInvoice({outfits:[Object.assign({},BASE.outfits[0],{discount:105000})]});
 const b=figs();
 ok(a.tax-b.tax===Math.round(100000*7.5)/100,
   'a discount on a piece did not reduce the tax, so the client is taxed on money they were never charged');
 ok(a.total-b.total===100000+(a.tax-b.tax),'a discount on a piece did not carry through to the total');}
// raising the SHIPPING must not touch the tax at all, which is the other half of the rule
{asInvoice({outfits:[Object.assign({},BASE.outfits[0],{discount:5000})]});
 const a=figs();
 asInvoice({delivery:Object.assign({},BASE.delivery,{fee:115000})});
 const b=figs();
 ok(a.tax===b.tax,'putting the carriage up moved the tax, so the studio is charging its tax on the courier');
 asInvoice({delivery:BASE.delivery});}

/* --- and the client is shown where the figure came from ---------------------------- */
d=doc();
ok(/800,000\.00 less .{0,12}5,000\.00 discount/.test(d),
  'a discount on one piece is taken off the invoice silently, so the client cannot check the line');
ok(/795,000\.00/.test(d),'the line amount is not its gross less its own discount');
ok(txt().indexOf('less')>=0,'the message summary drops the discount that is on the line');

/* --- the product code ---------------------------------------------------------------- */
asInvoice({outfits:[Object.assign({},BASE.outfits[0],{code:'SKU12345'})]});
ok(doc().indexOf('SKU12345')>=0,'a product code on an item never reaches the invoice');
asInvoice({outfits:[Object.assign({},BASE.outfits[0],{code:''})]});
ok(doc().indexOf('SKU12345')<0,'an invoice is printing a product code nobody set');

/* --- saving a piece for next time -----------------------------------------------------
   The catalogue IS the product-type list, so what is remembered is the TYPE and its price,
   never the per-order description. 'Agbada', not 'Wedding agbada for Adaeze, size 43'. */
const typeCount=run("productTypes().length");
run("rememberItems([{type:'Aso-oke two piece',name:'For Adaeze, gold trim',code:'AO-2P',price:145000,saveToCatalog:true}]);");
ok(run("productTypes().indexOf('Aso-oke two piece')")>=0,'ticking save for future invoices remembers nothing');
ok(run("productTypes().length")===typeCount+1,'saving one piece added more than one product type');
ok(run("productTypes().indexOf('For Adaeze, gold trim')")<0,
  'the per-order description was written into the product type list, which fills the dropdown with one-off jobs');
{const saved=J("productByName('Aso-oke two piece')");
 ok(saved.price===145000&&saved.code==='AO-2P','the piece was remembered without its price or its code');}
// it survives, because a generated catalogue is written down before anything is added to it
ok(run("(SETTINGS.productCatalog||[]).length>0")===true,
  'the catalogue was never stored, so the entry is in an array that is thrown away on the next read');
// and nothing is remembered unless somebody asked
run("rememberItems([{type:'Never asked for',price:1,saveToCatalog:false}]);");
ok(run("productTypes().indexOf('Never asked for')")<0,'a piece nobody ticked was added to the product types anyway');
// saving the same piece again updates it rather than adding a second one
run("rememberItems([{type:'Aso-oke two piece',code:'AO-2P',price:160000,saveToCatalog:true}]);");
ok(run("productTypes().filter(function(n){return n==='Aso-oke two piece'}).length")===1,
  'saving a piece twice puts it in the product types twice');
ok(J("productByName('Aso-oke two piece')").price===160000,'saving a piece again does not update its price');

/* --- and picking it back fills the boxes, without ever overwriting a typed one ------- */
run("closeModal();draft=null;openOrder(null,'order');");
run("document.getElementById('of_type_0').value='Aso-oke two piece';ofTypeChanged(0);");
ok(run("draft.outfits[0].price")===160000,'picking a remembered piece does not fill its price');
ok(run("draft.outfits[0].code")==='AO-2P','picking a remembered piece does not fill its code');
run("draft.outfits[0].price=99;draft.outfits[0].code='MINE';document.getElementById('of_type_0').value='Aso-oke two piece';ofTypeChanged(0);");
ok(run("draft.outfits[0].price")===99,'picking a type overwrote a price somebody had already quoted');
ok(run("draft.outfits[0].code")==='MINE','picking a type overwrote a code somebody had already typed');
run("closeModal();draft=null;");

/* --- the item sheet is flat -----------------------------------------------------------
   These four sat behind a tap until 23 September. They came out into the open because the
   sheet Kayode sent has all of them on one screen, and because a code and a discount are
   price, not work: they belong beside the price, not behind the cloth.

   What stays behind the tap is the WORKROOM, which is checked below rather than counted:
   a form that asks about beading while somebody is pricing a job is the original
   complaint. */
run("closeModal();draft=null;openOrder(null,'order');");
form=run("document.getElementById('modal').innerHTML")||'';
[['of_code_0','a product code'],['of_disc_0','a discount on the piece'],['of_save_0','a way to remember the piece']]
  .forEach(([id,what])=>ok(form.indexOf('id="'+id+'"')>=0,'the item row has no '+what));
ok(form.indexOf("openOrderSection('osecStock')")>=0,'there is no way to reach the stock from the piece');
ok(form.indexOf('id="osecStock"')>=0,'the inventory row points at a section that does not exist');
ok(run("typeof openOrderSection")==='function','the inventory row calls something that does not exist');
{/* everything outside a <details> is what somebody meets before tapping anything */
 const near=form.replace(/<details[\s\S]*?<\/details>/g,'');
 [['f_stage','what stage it is at'],['comm_staff_0','who is making it'],['c_amt_0','what the cloth cost'],
  ['f_del_on','who is delivering it'],['om_fit','the measurements'],['f_diron','the director allocation'],
  ['of_style_0','the styling'],['of_finish_0','the finishing'],['su_item_0','the stock it draws down']]
   .forEach(([id,what])=>ok(near.indexOf('id="'+id+'"')<0,
     'the order form asks '+what+' before anybody has tapped anything; that stretch is the original complaint'));
 /* and the price half really is standing open, not buried with it */
 ['f_client','f_whatsapp','of_type_0','of_price_0','of_qty_0','of_name_0','of_code_0','of_disc_0','f_discount','f_paid','f_due']
   .forEach(id=>ok(near.indexOf('id="'+id+'"')>=0,id+' has been pushed behind a tap; it is what you need to price a job'));}
// a discount typed inside a shut section still shows outside it
run("document.getElementById('of_price_0').value='400000';document.getElementById('of_qty_0').value='2';document.getElementById('of_disc_0').value='5000';syncOrderDraft();");
ok(run("draft.outfits[0].discount")===5000,'a discount typed on the piece does not reach the order');
ok(run("draft.value")===795000,'the order value does not follow the discount on the piece');
ok(run("ofLineNote(draft.outfits[0],draft)").indexOf('less')>=0,
  'a discount typed inside a shut section is invisible from outside it, so a job is priced off a figure the invoice will not print');
ok(run("itemSectionNote(draft.outfits[0],draft)").indexOf('off')>=0,'the shut piece does not say it has a discount on it');
run("closeModal();draft=null;");

/* ===================================================================================
   PART FIVE — THE SAME DOCUMENT ON A PHONE, 22 September

   A page that scrolls sideways needs a layout engine to detect and this runs in node, so
   what is checked here is the structure that makes the narrow layout possible. The
   measuring is done in a browser at 320, 360 and 414.

   The decision being held: the table stays a TABLE. Four columns do not fit 360px, so
   Price and Qty fold into the item cell and their columns are dropped, which is what this
   app does everywhere else. Stacking a row into a card was considered and rejected months
   ago, and an invoice is the last place to reopen it: a client reading a bill expects
   columns that line up.
   =================================================================================== */
asInvoice(Object.assign({},BASE,{outfits:[Object.assign({},BASE.outfits[0],{qty:2,discount:0})]}));
d=doc();
ok(/<style>[\s\S]*?<\/style>/.test(d),'the invoice carries no rules of its own, so it cannot respond to a narrow screen');
{/* every selector inside that stylesheet has to be under .tlb-, or a document meant for a
    print window starts restyling the app it was opened from */
 const css=(d.match(/<style>([\s\S]*?)<\/style>/)||['',''])[1];
 const selectors=css.split('}').map(b=>b.split('{')[0]).join(',').split(',')
   .map(x=>x.trim()).filter(x=>x&&!x.startsWith('@'));
 const loose=selectors.filter(x=>x.indexOf('.tlb-')<0);
 ok(loose.length===0,'the invoice stylesheet reaches outside the invoice: '+loose.slice(0,3).join(', '));
 ok(/@media\(max-width:600px\)|@media \(max-width: ?600px\)/.test(css),'nothing in the invoice changes on a narrow screen');
 ok(/@media print/.test(css),'the narrow layout is not put back for printing, so a phone prints a phone invoice');}
ok(d.indexOf('class="tlb-inv"')>=0,'the invoice has no root class, so none of its own rules can reach it');
// the two columns that are dropped, and the line that replaces them
ok((d.match(/class="tlb-only-wide"/g)||[]).length>=4,'the Price and Qty columns are not marked as the wide-screen ones');
ok(d.indexOf('class="tlb-only-narrow"')>=0,'nothing carries the price and quantity when their columns are dropped');
{const narrow=(d.match(/class="tlb-only-narrow"[^>]*>([^<]*)</)||[])[1]||'';
 ok(/400,000\.00/.test(narrow)&&/2/.test(narrow),
   'the narrow line does not carry the price and the quantity, so dropping the columns loses them: '+narrow);}
// and the blocks that have to stack rather than sit side by side
['tlb-head','tlb-billto','tlb-foot','tlb-totals','tlb-meta','tlb-sig'].forEach(c=>
  ok(d.indexOf('class="'+c+'"')>=0,'the '+c.replace('tlb-','')+' block is not marked, so it cannot stack on a phone'));

/* ===================================================================================
   PART SIX — STAYING SIGNED IN, 23 September

   "the customer app, it keeps asking for a login each time I minimize or close the app,
   the landing page is fine but not having to log in every single moment."

   Not taste, a bug, and a one-line one. The session stored the account id, and restoring
   it looked that id up in THIS DEVICE's user list. That works for a device account and
   cannot ever work for a studio signed in against the cloud, whose id is the Supabase
   account's and was never in the local list. Every lookup failed, every failure cleared
   the session as stale, and a real studio met the sign-in card every time the phone
   reclaimed the tab.

   The fix remembers the account whole. So what is checked here is the case that was
   broken: an account that is NOT in the device's list still comes back.
   =================================================================================== */
run("closeModal();draft=null;");
{
  /* a cloud studio: signed in, liveMode, and an id no local user has */
  run("currentUser={id:'auth-uid-not-a-local-user',name:'LAYI',username:'owner@example.com',roleId:'owner',staffId:'',active:true};liveMode=true;myBusinessId='biz-1';saveSession();");
  const saved=JSON.parse(run("localStorage.getItem(SESSION_KEY)"));
  ok(!!(saved&&saved.user&&saved.user.id),'the session stores an id alone, so a cloud studio can never be restored from it');
  ok(saved.live===true&&saved.biz==='biz-1','the session forgets that the studio was live, so it comes back offline from its own cloud');
  ok(saved.user.pin===undefined,'the session is keeping a copy of the password');
  ok(run("getUsers().some(function(u){return u.id==='auth-uid-not-a-local-user'})")===false,
    'the fixture is not testing what it claims: that account IS in the local list');
  /* now the thing he reported: come back as if the phone had reclaimed the tab */
  run("currentUser=null;liveMode=false;myBusinessId=null;");
  ok(run("restoreSession()")===true,
    'a studio signed in against the cloud is not restored, so it meets the sign-in card every time the app is reopened');
  ok(run("currentUser&&currentUser.id")==='auth-uid-not-a-local-user','the wrong account came back');
  ok(run("liveMode")===true,'the studio came back but not as a live one, so its work would not sync');
  ok(run("localStorage.getItem(SESSION_KEY)!==null")===true,'restoring a cloud studio threw its session away');

  /* a device account still comes from the list, so a role changed since last time applies */
  run("(function(){var u=getUsers()[0];currentUser=u;liveMode=false;myBusinessId=null;saveSession();})();");
  run("(function(){var l=getUsers();l[0].name='Renamed Since';setUsers(l);})();");
  run("currentUser=null;");
  ok(run("restoreSession()")===true,'a device account is no longer restored');
  ok(run("currentUser.name")==='Renamed Since',
    'a device account came back from the session rather than the list, so a change made since is ignored');

  /* a session that has been signed out of, and one that has aged out */
  run("clearSession();currentUser=null;");
  ok(run("restoreSession()")===false,'signing out leaves somebody signed in');
  run("localStorage.setItem(SESSION_KEY,JSON.stringify({id:'x',at:0,user:{id:'x',name:'Old'}}));currentUser=null;");
  ok(run("restoreSession()")===false,'a session older than the expiry is still accepted');
  ok(run("localStorage.getItem(SESSION_KEY)")===null,'an expired session is left lying on the device');
  ok(run("typeof verifyLiveSession")==='function',
    'nothing ever asks the server whether that session is still good, so a revoked account keeps working offline forever');

  /* And the check must not become a worse version of the bug. Found in a browser rather
     than here: a studio whose cloud session has gone was being logged straight back out,
     which is being ejected mid-job instead of merely being asked to sign in. Everything is
     on the device and the app is built to work without a network, so it stays open and
     stops claiming to be synced. */
  run("currentUser={id:'auth-uid-not-a-local-user',name:'LAYI',roleId:'owner',active:true};liveMode=true;");
  run("(function(){supa={auth:{getSession:function(){return Promise.resolve({data:{session:null}});}}};})();");
  const before=run("currentUser.id");
  /* It is async, so the report below waits on it rather than reading the answer a tick
     before it exists. The first version of this check did exactly that and passed on a
     version of the app that ejected the user. */
  PENDING.push(Promise.resolve(run("verifyLiveSession()")).then(function(){
    ok(run("currentUser&&currentUser.id")===before,
      'a studio whose cloud session has gone is thrown out of the app it was working in');
    ok(run("liveMode")===false,'the app still claims to be syncing after the cloud stopped knowing it');
    /* tidied here rather than below, because below runs a tick before this does */
    run("supa=null;clearSession();currentUser=getUsers().find(u=>u.roleId==='owner');liveMode=false;");
  }));
}

/* ===================================================================================
   REPORT
   =================================================================================== */
Promise.all(PENDING).then(function(){
console.log('='.repeat(64));
if(fails.length){
  console.log('audit_invoice: '+fails.length+' FAILED of '+checks+' checks\n');
  fails.forEach(f=>console.log('  ✗ '+f));
  process.exit(1);
}
console.log('✓ two doors, an invoice form with nothing of the workroom on it, an order');
console.log('  form that keeps the workroom behind a tap, no explanations, price × qty,');
console.log('  a discount on one piece then on the whole order then the tax then the shipping,');
console.log('  and a studio that stays signed in. '+checks+' checks passed.');
});
