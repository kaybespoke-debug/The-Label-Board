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
  const me = DB.me, rate = Q.rate(), n = Q.converted().length;

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

  /* One rate, and then the only thing that varies: how long each business
     has left on its own twelve months. The ladder that used to be here
     answered "what am I worth"; this answers "what is still coming", which
     is the question a flat rate leaves open. */
  const earning = Q.converted().filter(r => r.stage !== 'lapsed' && r.cycle !== 'annual');
  const clocks = earning.length
    ? '<div class="clocks">' + earning.slice().sort((a, b) =>
        String(Q.termEnd(a)).localeCompare(String(Q.termEnd(b)))).map(r => {
        const left = Q.monthsLeft(r);
        return '<div class="clock' + (left <= 2 ? ' soon' : '') + '">' +
          '<div class="clock-n">' + esc(r.business) + '</div>' +
          '<div class="clock-m">' + (left ? plural(left, 'month') + ' left' : 'Finished') + '</div>' +
          '<div class="clock-d">ends ' + fmtD(Q.termEnd(r)) + '</div></div>';
      }).join('') + '</div>'
    : '<p class="note">No business is earning on a monthly clock yet.</p>';

  const paidHow =
    '<div class="tierline"><b>' + rate + '%</b><span>of what every referred business pays</span></div>' +
    '<p class="note">The same rate for every partner and every business. There is no ladder to ' +
    'climb, so there is nothing to unlock and nothing to lose if a business leaves.</p>' +
    '<div class="sec-t">The rules</div>' +
    kv('What you earn', rate + '% of what a referred business actually pays') +
    kv('On a monthly plan', 'Every month, for ' + DB.settings.termMonths + ' months from their first payment') +
    kv('On a yearly plan', rate + '% of that year\u2019s payment, once') +
    kv('If they leave', 'It stops that day, and nothing further is owed') +
    kv('When it clears', DB.settings.holdDays + ' days after it is credited') +
    kv('When it reaches you', 'Once a year, in naira \u00b7 ' + esc(DB.settings.payoutRuns)) +
    '<div class="sec-t">Where each business is on its clock</div>' + clocks +
    '<p class="note" style="margin-top:12px">Each business carries its own ' + DB.settings.termMonths + ' months, ' +
    'counted from the day it first paid rather than from the day you joined. It never resets and never ' +
    'pauses. The business itself gets no discount and no reward: what you earn comes out of our side, ' +
    'not theirs.</p>';

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
    '<div class="ph-sub">' + esc(me.business) + ' · ' + plural(n, 'paying business') + '</div></div>' +
    '<button class="btn sm" onclick="signOut()">Sign out</button></div>' +

    grp(ic('color-mix(in srgb,var(--gold) 22%,var(--panel))', '<circle cx="12" cy="8" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
      'Your details', 'Name, business, how we reach you', profile) +
    grp(ic('color-mix(in srgb,var(--green) 22%,var(--panel))', '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>'),
      'Payout accounts', DB.accounts.length ? esc((Q.primaryAccount() || {}).bankName) : 'None yet', accounts) +
    grp(ic('color-mix(in srgb,var(--amber) 22%,var(--panel))', '<path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 17.2 6.7 20l1.1-6L3.4 9.8l6-.8z"/>'),
      'How you get paid', rate + '% of what they pay, for ' + DB.settings.termMonths + ' months', paidHow) +
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

/* ===== WELCOME =====
   The first page after signing in, and only after an actual sign-in: restoring a
   saved session goes straight to Home. A partner arrives here from a link
   somebody sent them and may not know what The Label Board is, so this says what
   the portal is for before they start poking at numbers.

   The rate appears here in words rather than read from DB, because the welcome
   screen renders before a partner's data has been fetched. It is the one place
   in the portal that repeats the number, so it is the one place to change if the
   programme ever moves off eight per cent. */
PAGES.welcome = function () {
  const name = (AUTH.session && AUTH.session.name) ? String(AUTH.session.name).split(' ')[0] : '';
  const points = [
    ['Every referral, tracked', 'Who you brought in, where they got to, and who is still on trial.'],
    ['One rate, every time', 'Eight per cent of what each business you brought actually pays, every month for a year, and nothing to unlock first.'],
    ['Paid out to your account', 'What you have earned, what has been sent, and what is still owed.'],
    ['Something to send', 'Your code and your links, ready to share.']
  ];
  return '<div class="pnl welcome">' +
    '<h2 class="wel-h">' + (name ? 'Welcome, ' + esc(name) + '.' : 'Welcome.') + '</h2>' +
    '<p class="wel-lead">You bring the studios. We do the rest.</p>' +
    '<p class="wel-p">The Label Board is the software fashion studios run their business on: ' +
    'orders, production, clients, staff and money in one place. You are one of the people who ' +
    'brings them in, and this is where you watch that turn into income.</p>' +
    '<ul class="wel-points">' +
    points.map(p => '<li><span class="wel-tick">✓</span><span><b>' + p[0] + '.</b> ' + p[1] + '</span></li>').join('') +
    '</ul>' +
    '<button class="btn gold wel-go" onclick="leaveWelcome()">Continue to the portal</button>' +
    '<p class="wel-foot">Anything you are unsure about, email ' +
    '<a href="mailto:hello@thelabelboard.com">hello@thelabelboard.com</a>.</p>' +
    '</div>';
};

function leaveWelcome() {
  UI.page = 'home';
  UI.detail = null;
  render();
  try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); }
}
