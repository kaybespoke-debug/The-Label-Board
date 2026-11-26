/* THE ORDER FORM AS WINDOWS, 26 November 2026.

   Kayode: "rather than having a long list that goes down the page, that just
   causes unnecessary scrolling, we can have you click one thing, then it
   takes you to a different window where you fill in the this, and then you're
   able to go back to continue the other things. But while you're there, it
   saves what you saved."

   The thing this gate exists to protect is the last clause. Everything else
   about the feature is layout and would be obvious if it broke. Losing what
   somebody typed would not be: it would look like a form that works, until a
   studio writes an order in front of a client, steps into the price window,
   comes back and finds the name gone.

   Two properties keep that from happening, and both are checked below.

     Every move reads the form into draft FIRST and then rebuilds from draft.
     It never replays saved markup. The modal stack's own Back does replay
     markup, which is why openOrderWindow and closeOrderWindow do not use it.

     syncOrderDraft() guards every assignment behind a check that the field is
     on screen. That is what makes it safe to read the form while only one
     window is rendered: a field that is not there keeps the value it had.
     That guard predates this feature and is the reason the feature is small,
     so it is checked here as load-bearing rather than incidental.

   Not wired into verify.js on purpose, the same as audit_drill.js: this is on
   trial and may come straight back out. Run it by hand while it runs:

       node audit_order_windows.js
*/
const fs = require('fs');

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');
const shipped = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const F = m => { console.log('  FAIL  ' + m); fail++; };
const P = m => { console.log('  pass  ' + m); pass++; };
const ok = (c, g, b) => c ? P(g) : F(b);

console.log('\n=== THE ORDER FORM AS WINDOWS ===\n');

console.log('-- nothing is lost on the way in or out --');
ok(/function openOrderWindow\(k\)\{syncOrderDraft\(\);orderWin=k;reRenderOrderTop\(\);\}/.test(shipped),
   'going into a window reads the form into draft first',
   'going into a window no longer reads the form first, so whatever was typed on the order is lost');
ok(/function closeOrderWindow\(\)\{syncOrderDraft\(\);orderWin=null;reRenderOrderTop\(\);\}/.test(shipped),
   'coming back reads the window into draft first',
   'coming back no longer reads the window first, so whatever was typed in it is lost');
ok(/function reRenderOrderTop\(\)\{[\s\S]{0,260}renderOrderModal\.call\(window\);/.test(shipped),
   'both rebuild the screen from draft rather than replaying saved markup',
   'the screen is being replayed from saved markup, which does not carry what was typed');
ok(!/openOrderWindow[\s\S]{0,120}modalBack\(\)/.test(shipped)
   && !/closeOrderWindow[\s\S]{0,120}modalBack\(\)/.test(shipped),
   'neither uses the modal stack’s Back, which replays markup',
   'a window is using modalBack(), which restores saved HTML and loses every value');

console.log('\n-- the guard that makes a partial form safe to read --');
ok(/function syncOrderDraft\(\)\{\s*if\(!draft\)return;/.test(shipped),
   'syncOrderDraft still bails when there is no draft',
   'syncOrderDraft no longer bails without a draft');
for (const f of ['f_client', 'f_email', 'f_whatsapp', 'f_address', 'f_discount',
                 'f_paid', 'f_currency', 'f_due']) {
  ok(new RegExp('if\\(fv\\(\'' + f + '\'\\)!==undefined\\)').test(shipped),
     f + ' is only written when it is on screen',
     f + ' is written unconditionally, so opening a window would wipe it');
}
ok(/if\(document\.getElementById\('f_branch'\)\)draft\.branch=/.test(shipped),
   'branch is only written when its field is rendered',
   'branch is written unconditionally, so a window would reset it');
ok(/if\(fvOther\('of_type_'\+i\)!==undefined\)/.test(shipped)
   && /if\(fv\('of_price_'\+i\)!==undefined\)/.test(shipped),
   'each item’s fields are only written when that item is on screen',
   'item fields are written unconditionally, so editing one item would blank the others');

console.log('\n-- one switch, because this is on trial --');
ok(/const ORDER_WINDOWS=true;/.test(shipped),
   'ORDER_WINDOWS is the switch',
   'the switch is gone, so there is no one-line way back to the single page');
ok(/function orderWinPhone\(\)\{\s*if\(!ORDER_WINDOWS\)return false;/.test(shipped),
   'the switch is read first, so it turns all of it off',
   'orderWinPhone no longer checks the switch, so half the form would stay in windows');

console.log('\n-- phone only --');
ok(/max-width:680px/.test(shipped.match(/function orderWinPhone\(\)\{[\s\S]{0,320}/)?.[0] || ''),
   'windows are gated on the phone breakpoint',
   'the gate on width is gone, so a desktop would get the windows too');
ok(/const itemsBlock=orderWinPhone\(\)\?draft\.outfits\.map\(itemRow\)\.join\(''\):outfitsHtml;/.test(shipped),
   'items are rows on a phone and the cards they always were elsewhere',
   'items no longer fall back to the full cards on a desktop');
ok(/if\(!orderWinPhone\(\)\)return null;/.test(shipped),
   'a section is a row only on a phone, and the accordion everywhere else',
   'sections no longer fall back to accordions on a desktop');

console.log('\n-- every field still has somewhere to live --');
for (const [key, body] of [['client', 'clientSection'], ['stage', 'stageSection'],
                           ['people', 'assignSection\\+potSection'],
                           ['fabric', 'costsField\\+stockSection'],
                           ['profit', "can\\('money'\\)\\?pnlSection:''"],
                           ['van', 'deliverySection'],
                           ['money', 'moneyRow']]) {
  ok(new RegExp(key + ":\\['[^']*'," + body + '\\]').test(shipped),
     key + ' has a window holding the same body the accordion holds',
     key + ' has no window, so its fields are unreachable on a phone');
}
ok(/OWINS\['item'\+i\]=/.test(shipped),
   'every item has a window of its own',
   'items have no window, so a phone cannot edit a piece');

console.log('\n-- three deep, and no further --');
ok(/<details class="osec osec-in">[\s\S]{0,400}itemExtras\(i\)/.test(shipped),
   'the item window keeps its own accordion rather than laying everything flat',
   'the item window renders every detail at once, which is the long scroll one level in');

console.log('\n-- the way back says where it goes --');
ok(/Back to the order/.test(shipped),
   'the back button names where it goes',
   'the back button is a bare arrow again');
ok(/class="owin-top"/.test(shipped),
   'a window carries its own top row',
   'the window has no top row of its own');

console.log('\n-- a withheld figure stays withheld --');
ok(/if\(can\('money'\)\)bits\.push\(curO\(draft\.paid\|\|0,draft\)\+' paid'\)/.test(shipped),
   'the money row shows a figure only to somebody allowed to see one',
   'the money row prints a figure without checking the permission, which is the ₦0 bug again');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nThe order form is not behaving as agreed.'); process.exit(1); }
console.log('\nOne thing per screen, and what you typed is still there when you\ncome back.');
