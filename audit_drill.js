/* THE DRILL-DOWN, 4 November 2026.

   Kayode: "on layi website ... you click a categories then it takes you to a
   different screen ... selecting the product opens up another with the
   products and details on it, that kind flow ... this applies to every tabs."

   What is being guarded here, in one sentence each:

     Level two must not be a SECOND list. It sets the filter the view already
     has and lets the view render itself, so branch scope, permissions, the
     money rules, sorting and search keep working with one copy rather than
     two that drift. Every check below that tests `apply` is testing that.

     The tiles must add up. 'active' in this app means "not delivered", which
     includes the ones already finished and waiting, so tiles built on it
     would have shown 16 in progress out of 16 orders with 6 of them also
     counted as ready. 'making' was added for exactly this.

     It is phone-only. The complaint was the length of a phone page; a desktop
     has the room, and a hub on a wide screen would be a step backwards.

     It is revertible in one line. This is being tried, not settled.

   This gate is deliberately NOT wired into verify.js yet. The feature is on
   trial and may come straight back out tomorrow; a gate in the suite would
   then have to come out too. Run it by hand while the trial runs:

       node audit_drill.js
*/
const fs = require('fs');

const html = fs.readFileSync('site/layi_dashboard.html', 'utf8');
/* Comments describe the feature as much as the code does, and an absence
   check that reads its own explanation is worthless. */
const shipped = html.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

let pass = 0, fail = 0;
const F = m => { console.log('  FAIL  ' + m); fail++; };
const P = m => { console.log('  pass  ' + m); pass++; };
const ok = (cond, good, bad) => cond ? P(good) : F(bad);

console.log('\n=== DRILL-DOWN ===\n');

console.log('-- one switch, because this is on trial --');
ok(/const DRILL_ON=true;/.test(shipped),
   'DRILL_ON is the single switch',
   'DRILL_ON is gone, so there is no longer a one-line way back');
ok(/function drillCfg\(view\)\{return \(DRILL_ON&&DRILL\[view\]\)/.test(shipped),
   'every entry point goes through drillCfg, so the switch really turns it all off',
   'something reads DRILL[view] without checking DRILL_ON, so the switch no longer works');

console.log('\n-- phone only --');
ok(/function drillPhone\(\)\{[\s\S]{0,160}max-width:680px/.test(shipped),
   'the hub is gated on the phone breakpoint',
   'the hub is no longer gated on width, so a desktop would get it too');
ok(/if\(!cfg\|\|!drillPhone\(\)\)\{v\.classList\.remove\('drilling','drilled'\);return;\}/.test(shipped),
   'a wide screen has both classes actively removed, so a resize cannot strand it',
   'a screen that stops being a phone keeps the drill classes and the view stays hidden');
ok(/@media\(max-width:680px\)\{[\s\S]{0,400}\.view\.drilling > \*:not\(\.drillhub\)\{display:none!important\}/.test(html),
   'the rule that hides the view behind the hub is inside the phone media query',
   'the hub could hide a desktop view, which would blank the page');
ok(/\.drillhub\{display:none\}/.test(html),
   'the hub is hidden by default and only shown while drilling',
   'the hub has no default of hidden, so it would appear on every screen');

console.log('\n-- level two is the view\'s own list, not a second copy --');
for (const [view, setter] of [['orders', 'ordersFilter=k'],
                              ['customers', 'custFilter=k'],
                              ['supplies', "supTab=k;supFilter='all'"]]) {
  ok(new RegExp('apply:function\\(k\\)\\{' + setter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(shipped),
     view + ' sets the filter the view already has',
     view + ' no longer sets the existing filter, so level two is a second list that will drift');
}
for (const [view, fn] of [['orders', 'renderOrders'], ['customers', 'renderCustomers'],
                          ['supplies', 'renderSupplies']]) {
  ok(new RegExp('draw:function\\(\\)\\{' + fn + '\\(\\);\\}').test(shipped),
     view + ' draws with its own renderer',
     view + ' draws with something other than its own renderer');
}

console.log('\n-- the tiles add up --');
ok(/if\(ordersFilter==='making'&&!\(o\.stageIndex<RFD\)\)return false;/.test(shipped),
   "'making' exists in the order filter chain",
   "'making' is gone, so In progress counts the ready ones too and the tiles stop adding up");
ok(/\{k:'making',n:'Being made'/.test(shipped),
   'the first tile uses it',
   'the first tile is back on active, which double-counts whatever is ready');
ok(/\['making','Being made'\]/.test(shipped),
   'the status menu knows the key, so level two does not show a blank filter',
   'the status menu has no entry for it, so the drilled list shows an empty filter box');

console.log('\n-- the stock tiles come from the studio, not from me --');
ok(/const names=\(typeof invCatNames==='function'\)\?invCatNames\(\):\[\];/.test(shipped),
   'stock tiles are built from the studio\'s own category list',
   'stock categories are hardcoded again, so a category somebody made has no tile');
ok(/if\(invCatProd\(c\)\)return;/.test(shipped),
   'a product category does not get a second tile of its own',
   'product categories are duplicated between the category tiles and Shop products');

console.log('\n-- a withheld figure stays withheld --');
ok(/if\(!can\('money'\)\)return k\.length\+\(k\.length===1\\?' order':' orders'\)/.test(shipped)
   || /if\(!can\('money'\)\)return k\.length\+/.test(shipped),
   'a tile shows a count rather than money to somebody who may not see money',
   'the tiles print a money figure without checking the permission, which is the ₦0 bug again');

console.log('\n-- the way back --');
ok(/Back to '\+esc\(cfg\.title\)/.test(shipped),
   'the back button is named after where it goes, the way the website does it',
   'the back button is a bare arrow again');
ok(/const tb=document\.getElementById\('backBtn'\);if\(tb\)tb\.style\.display='none';/.test(shipped),
   'the topbar back is hidden while drilled, so there is one way out and not two',
   'two back buttons can show at once on the same screen');
ok(/function drillBack\(view\)\{[\s\S]{0,200}drillStart\(view,true\)/.test(shipped),
   'going back rebuilds the hub, so the counts on it are current',
   'going back shows a stale hub');
ok(/cfg\.apply\(cfg\.root\);/.test(shipped),
   'leaving the drill puts the view\'s filter back to its default',
   'leaving the drill can strand a tab filtered by something nobody chose');

console.log('\n-- it runs after the view has drawn itself --');
ok(/if\(typeof capStatGrids==='function'\)capStatGrids\(\);[\s\S]{0,200}if\(typeof drillStart==='function'\)drillStart\(view\);/.test(shipped),
   'drillStart runs at the end of go(), after the view builds its own content',
   'drillStart runs before the view has rendered, so the tiles would count nothing');

console.log('\n-- the three tabs, and only those three --');
ok(/const DRILL=\{[\s\S]{0,80}orders:\{/.test(shipped), 'Orders is drilled', 'Orders is not drilled');
ok(/\n  customers:\{/.test(shipped), 'Clients is drilled', 'Clients is not drilled');
ok(/\n  supplies:\{/.test(shipped), 'Stock is drilled', 'Stock is not drilled');
ok(!/\n  finance:\{/.test(shipped),
   'Money is deliberately left alone, as the one tab to compare against',
   'Money has been drilled, so there is nothing left to compare the pattern with');

console.log('\n-- no emoji crept into the tiles --');
ok(!/icon:'[^']*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(shipped),
   'every tile icon is a drawn SVG',
   'a tile is using an emoji instead of a drawn icon');

console.log('\n' + '='.repeat(62));
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nThe drill-down is not behaving as agreed.'); process.exit(1); }
console.log('\nA tab opens on its groups, a group opens its own list, and a row\nopens the record. One line turns it all off.');
