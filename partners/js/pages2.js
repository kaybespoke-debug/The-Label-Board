/* ============================================================
   pages2.js — Share, Updates, Account
   ============================================================ */

/* =================== SHARE =================== */
PAGES.share = function () {
  const main = DB.links.find(l => l.isDefault) || DB.links[0];

  const linkRows = DB.links.map(l =>
    '<div class="linkrow">' +
    '<div style="min-width:0;flex:1">' +
    '<div class="t-main">' + esc(l.label) +
    (l.active ? '' : ' ' + statusPill('paused')) + '</div>' +
    '<div class="linkrow-m mono">' + esc(l.code) + '</div>' +
    '<div class="linkrow-m">' + l.clicks + ' opened · ' + plural(l.signups, 'signup') +
    (l.earned ? ' · ' + money(l.earned) + ' earned' : '') + '</div>' +
    '</div>' +
    '<div class="linkacts">' +
    '<button class="btn sm" onclick="copyText(\'' + esc(l.url) + '\',this)">Copy</button>' +
    '<button class="btn sm" onclick="linkMenu(' + l.id + ')">More</button>' +
    '</div></div>').join('');

  return shareHero(main) +

    '<div class="pnl"><div class="ph"><div><h3>Your links</h3>' +
    '<div class="ph-sub">A link per place you share, so you can see which one works</div></div>' +
    '<button class="btn sm gold" onclick="formNewLink()">+ New</button></div>' +
    linkRows + '</div>' +

    '<div class="pnl"><div class="ph"><div><h3>Something to send</h3>' +
    '<div class="ph-sub">Copy one, change what does not sound like you</div></div></div>' +
    templateList(main) + '</div>';
};

/* Ready-made messages. Short and plain, because the ones that read like
   marketing are the ones partners never send. */
function TEMPLATES(link) {
  const url = link.url;
  return [
    ['To one person',
      'Hi, you know how you were saying orders keep getting lost between you and your tailors? I moved ' +
      DB.me.business + ' onto The Label Board and it fixed exactly that. Two weeks free, no card. ' + url],
    ['To a group',
      'For the tailors and studios here: The Label Board keeps every order, fitting and payment on one board, ' +
      'and it works without signal. Free for two weeks if you want to try it. ' + url],
    ['Instagram caption',
      'People keep asking how I keep track of every order and fitting. It is The Label Board. Link in bio, ' +
      'free for two weeks. ' + url]
  ];
}
function templateList(link) {
  return TEMPLATES(link).map((t, i) =>
    '<div class="tmpl">' +
    '<div class="tmpl-t">' + t[0] + '</div>' +
    '<p class="note">' + esc(t[1]) + '</p>' +
    '<button class="btn sm" onclick="copyTemplate(' + i + ',' + link.id + ',this)">Copy</button>' +
    '</div>').join('');
}

/* =================== UPDATES =================== */
PAGES.updates = function () {
  const unread = Q.unreadUpdates().length;
  return '<div class="pnl">' +
    (unread
      ? '<div class="bar"><span class="note">' + plural(unread, 'unread') + '</span><span class="spacer"></span>' +
        '<button class="btn sm" onclick="markAllRead()">Mark all read</button></div>'
      : '') +
    DB.updates.map(u => '<div class="news" onclick="openDetail(\'update\',' + u.id + ')">' +
      '<span class="news-dot' + (Q.isRead(u.id) ? ' read' : '') + '"></span>' +
      '<div style="min-width:0">' +
      '<div class="news-t">' + esc(u.title) + '</div>' +
      '<div class="news-m">' + statusPill(u.category) +
      '<span>' + (u.upcoming ? 'Coming up · ' + fmtD(u.date) : ago(u.date)) + '</span></div>' +
      '</div></div>').join('') +
    '</div>';
};

/* =================== ACCOUNT =================== */
PAGES.account = function () {
  const me = DB.me, tier = Q.tier(), nxt = Q.next(), n = Q.converted().length;

  const ic = (bg, path) => '<div class="sgrp-ic" style="background:' + bg + '"><svg viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg></div>';
  const grp = (iconHtml, title, desc, body) =>
    '<details class="sgrp"><summary class="sgrp-h">' + iconHtml +
    '<div><div class="sgrp-t">' + title + '</div><div class="sgrp-d">' + desc + '</div></div>' +
    '<span class="sgrp-cv">&rsaquo;</span></summary><div class="sgrp-b">' + body + '</div></details>';

  const profile =
    kvEdit('Name', esc(me.name), "editProfile('name','Name')") +
    kvEdit('Business', esc(me.business), "editProfile('business','Business')") +
    kvEdit('Email', esc(me.email), "editProfile('email','Email')") +
    kvEdit('Phone', esc(me.phone), "editProfile('phone','Phone')") +
    kv('Partner ID', '<span class="mono">' + me.id + '</span>') +
    kv('Partner since', fmtD(me.joined));

  const accounts =
    '<p class="note">Where your commission lands. The one marked primary is the one we send to.</p>' +
    '<div style="margin-top:12px">' +
    (DB.accounts.length
      ? DB.accounts.map(a => acctCard(a)).join('')
      : '<div class="empty">No payout account yet.<br><span class="note">Add one and your cleared commission goes out on the next run.</span></div>') +
    '</div>' +
    '<button class="btn gold" style="margin-top:6px" onclick="formAddAccount()">+ Add account</button>';

  /* The ladder and the rules that govern it, in one place. They are the same
     subject, and a partner reading one wants the other. */
  const paidHow =
    '<div class="tierline"><b>' + tier.name + '</b><span>' + tier.pct + '% of every first payment</span></div>' +
    '<div class="tierbar"><i style="width:' + Q.tierProgress() + '%"></i></div>' +
    '<p class="note">' + (nxt
      ? plural(n, 'paying account') + ' referred. ' + plural(nxt.min - n, 'more') + ' and you move to ' +
        nxt.name + ' at ' + nxt.pct + '%.'
      : plural(n, 'paying account') + ' referred. You are at the top of the ladder.') + '</p>' +
    '<div class="ladder">' + DB.tiers.map(t => {
      const done = n >= t.min && t.id !== tier.id, now = t.id === tier.id;
      return '<div class="rung' + (now ? ' on' : done ? ' done' : '') + '">' +
        '<div class="rung-n">' + t.name + '</div>' +
        '<div class="rung-p">' + t.pct + '%</div>' +
        '<div class="rung-d">' + (t.min === 0 ? 'from your first' : t.min + ' accounts') + '</div></div>';
    }).join('') + '</div>' +
    '<div class="sec-t">The rules</div>' +
    kv('What you earn', tier.pct + '% of a first payment') +
    kv('On an annual plan', tier.pct + '% of the whole year') +
    kv('When it clears', DB.settings.holdDays + ' days after they pay') +
    kv('When it reaches you', 'The ' + DB.settings.payoutDay + 'th of the month') +
    kv('Minimum payout', money(DB.settings.minPayout)) +
    '<p class="note" style="margin-top:12px">Your rate is fixed on the day an account starts paying, so moving up ' +
    'a tier lifts what you earn from then on and never changes what you have already been credited. Commission is ' +
    'earned once per business, on a first payment only.</p>';

  const notify =
    '<div>' +
    notifyRow('signup', 'Somebody used your link') +
    notifyRow('conversion', 'A referral started paying') +
    notifyRow('payout', 'A payout was sent') +
    notifyRow('news', 'Programme and product updates') +
    '</div>' +
    '<div class="sec-t">How we reach you</div>' +
    '<div>' + notifyRow('email', esc(me.email)) + notifyRow('whatsapp', esc(me.phone)) + '</div>';

  const manager =
    '<p class="note">Anything about rates, payouts, or a referral that did not track properly goes to ' +
    esc(me.manager.name.split(' ')[0]) + ' rather than a support queue.</p>' +
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
    '<button class="btn gold" onclick="messageManager()">WhatsApp</button>' +
    '<button class="btn" onclick="emailManager()">Email</button></div>';

  const appearance =
    '<div class="chips">' +
    '<button class="chip' + (!document.body.classList.contains('light') ? ' on' : '') + '" onclick="setTheme(\'dark\')">Black</button>' +
    '<button class="chip' + (document.body.classList.contains('light') ? ' on' : '') + '" onclick="setTheme(\'light\')">White</button>' +
    '</div>' +
    '<p class="note" style="margin-top:12px">Add the portal to your home screen and it opens like an app and keeps ' +
    'working when the connection drops. Use your browser menu and choose Install, or Add to Home Screen.</p>' +
    '<button class="btn danger" style="margin-top:12px" onclick="resetLocal()">Reset this browser</button>';

  return '<div class="pnl acctop">' +
    '<div class="dav">' + initials(me.name) + '</div>' +
    '<div style="flex:1;min-width:150px"><h3 style="font-size:16px">' + esc(me.name) + '</h3>' +
    '<div class="ph-sub">' + esc(AUTH.session ? AUTH.session.email : me.email) + '</div>' +
    '<div class="ph-sub">' + esc(me.business) + ' · ' + tier.name + ' partner</div></div>' +
    '<button class="btn sm" onclick="signOut()">Sign out</button></div>' +

    grp(ic('color-mix(in srgb,var(--gold) 22%,var(--panel))', '<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
      'Your details', 'Name, business, how we reach you', profile) +
    grp(ic('color-mix(in srgb,var(--green) 22%,var(--panel))', '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>'),
      'Payout accounts', DB.accounts.length ? esc((Q.primaryAccount() || {}).bankName) : 'None yet', accounts) +
    grp(ic('color-mix(in srgb,var(--amber) 22%,var(--panel))', '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 17.2 6.7 20l1.1-6L3.4 9.8l6-.8z"/>'),
      'How you get paid', tier.name + ' · ' + tier.pct + '% of every first payment', paidHow) +
    grp(ic('color-mix(in srgb,var(--blue) 22%,var(--panel))', '<path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15z"/><path d="M9.5 20.5a2.6 2.6 0 0 0 5 0"/>'),
      'Notifications', 'What we tell you about', notify) +
    grp(ic('color-mix(in srgb,var(--purple) 22%,var(--panel))', '<path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-4.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8z"/>'),
      'Your partner manager', esc(me.manager.name), manager) +
    grp(ic('var(--panel-2)', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>'),
      'Appearance', 'Theme, installing, starting again', appearance);
};

function acctCard(a) {
  return '<div class="acct' + (a.primary ? ' primary' : '') + '">' +
    '<div class="acct-h"><span class="acct-n">' + esc(a.accountName) + '</span>' +
    (a.primary ? '<span class="pill green">Primary</span>' : '') +
    statusPill(a.verified ? 'verified' : 'unverified') + '</div>' +
    '<div class="acct-num mono">' + esc(a.accountNumber) + '</div>' +
    '<div class="acct-b">' + esc(a.bankName) + '</div>' +
    '<div class="acct-a">' +
    (a.primary ? '' : '<button class="btn sm" onclick="makePrimary(' + a.id + ')">Make primary</button>') +
    '<button class="btn sm" onclick="formEditAccount(' + a.id + ')">Edit</button>' +
    (a.primary && DB.accounts.length === 1 ? '' : '<button class="btn sm danger" onclick="formRemoveAccount(' + a.id + ')">Remove</button>') +
    '</div></div>';
}
function kvEdit(k, v, onclick) {
  return '<div class="kv klik" style="cursor:pointer" onclick="' + onclick + '">' +
    '<span class="k">' + k + '</span>' +
    '<span class="v">' + v + ' <span class="lnk">Edit</span></span></div>';
}
function notifyRow(key, title) {
  const on = !!DB.settings.notify[key];
  return '<div class="row"><div><b>' + title + '</b></div>' +
    '<button class="tog' + (on ? ' on' : '') + '" onclick="toggleNotify(\'' + key + '\')" ' +
    'role="switch" aria-checked="' + on + '" aria-label="' + title + '"><i></i></button></div>';
}
