// ---------------------------------------------------------------------------
// Members, from the seller's side
// ---------------------------------------------------------------------------
/**
 * The seller's members page: what a tier costs, where the dues go, who is
 * waiting, and who is in.
 *
 * Its centre of gravity is the QUEUE, not the roster. On a manual rail the work
 * is a person checking their own statement, and the page is built to make that
 * one job take ten seconds: each claim shows the reference in mono, the amount,
 * the method, and the date — the four things the statement will have — with
 * confirm and reject beside them.
 *
 * The confirm sentence is the only place the platform gives this instruction,
 * and it is deliberately not optimistic: confirming is what opens the files, so
 * confirming without looking gives away a store's own content.
 */
export function channelMembers({
  channel, user, consent = null, flash = null, tiers = [], members = [],
  pending = [], membershipsOn = false, plan = null, now = new Date(),
}) {
  if (!membershipsOn) {
    return layout({
      title: 'Members', user, activeChannel: channel, consent, current: 'dashboard',
      body: `
${pageHead(channel, 'members', 'Members', 'People who belong to this store, by name.')}
${flashNote(flash)}
<div class="section">
  <div class="note note-info" role="status">
    <strong>Members are part of the Store plan.</strong>
    <p class="small" style="margin:var(--space-2) 0 0">${esc(FREE_PLAN_LINE)}</p>
    <p class="small" style="margin:var(--space-2) 0 0">What the plan adds: up to two tiers you name, a roster of the
      people who join, a plate next to their name on your storefront, and files that open for them without an ad.
      The dues are yours — you set them, they are paid straight to you, and bytebikri takes no share of them.</p>
    <a class="btn btn-primary btn-sm" style="margin-top:var(--space-4)"
       href="/dashboard/${esc(channel.slug)}/billing">See the plans</a>
  </div>
</div>`,
    });
  }

  const tierEditor = (tierNo) => {
    const t = tierByNo(tiers, tierNo) || { tier_no: tierNo, name: defaultTierName(tierNo), dues_npr: 0, period_months: 1, perks: null, accent: 'indigo' };
    const plate = plateStyle(tierNo);
    const holders = members.filter((m) => Number(m.tier_no) === tierNo).length;
    const accentOptions = ACCENT_KEYS.map((k) => `<option value="${k}"${t.accent === k ? ' selected' : ''}>${esc(ACCENTS[k].label)}</option>`).join('');
    const periodOptions = PERIODS.map((p) => `<option value="${p}"${Number(t.period_months) === p ? ' selected' : ''}>${p === 1 ? 'a month' : p === 3 ? 'every three months' : 'a year'}</option>`).join('');
    return `<form class="tier-editor" method="post"
              action="/dashboard/${esc(channel.slug)}/members/tier/${tierNo}" style="${plateStyleAttr(t.accent)}">
      <div class="row" style="align-items:center">
        <span class="member-avatar${plate === 'gradient' ? ' member-avatar--shine' : ''}" aria-hidden="true">${esc(String(t.name || '').slice(0, 1).toUpperCase() || String(tierNo))}</span>
        <strong>${tierNo === 2 ? 'Top tier' : 'Entry tier'}</strong>
        <span class="spacer"></span>
        <span class="fine">${holders ? plural(holders, 'member') : 'nobody yet'} · ${esc(PLATE_COPY[plate])}</span>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start;margin-top:var(--space-4)">
        <div class="field" style="flex:1 1 170px">
          <label for="t${tierNo}-name">What it is called</label>
          <input class="input" id="t${tierNo}-name" name="name" required minlength="2" maxlength="24" value="${esc(t.name)}">
        </div>
        <div class="field" style="flex:0 1 130px">
          <label for="t${tierNo}-dues">Dues (NPR)</label>
          <input class="input" id="t${tierNo}-dues" name="duesNpr" type="number" min="0" max="100000" step="1"
                 inputmode="numeric" value="${Number(t.dues_npr) || 0}">
        </div>
        <div class="field" style="flex:0 1 170px">
          <label for="t${tierNo}-period">How often</label>
          <select class="input" id="t${tierNo}-period" name="periodMonths">${periodOptions}</select>
        </div>
        <div class="field" style="flex:0 1 130px">
          <label for="t${tierNo}-accent">Plate</label>
          <select class="input" id="t${tierNo}-accent" name="accent">${accentOptions}</select>
        </div>
      </div>
      <div class="field">
        <label for="t${tierNo}-perks">What they get, in one line</label>
        <input class="input" id="t${tierNo}-perks" name="perks" maxlength="160" value="${esc(t.perks || '')}"
               placeholder="e.g. every template I publish, plus the workshop recordings">
        <span class="hint">The researched pattern is one skimmable line with the cadence in it. Promises you cannot
          keep are the one thing that loses members.</span>
      </div>
      <div class="row" style="gap:var(--space-3)">
        <button class="btn btn-primary btn-sm" type="submit">Save tier ${tierNo}</button>
        ${holders ? '' : `<button class="btn btn-sm" type="submit" formaction="/dashboard/${esc(channel.slug)}/members/tier/${tierNo}/remove">Remove</button>`}
      </div>
      ${holders ? `<p class="fine">Remove is off while ${plural(holders, 'person', 'people')} hold this tier — you can
        rename it and change what it costs, but not delete what they paid for.</p>` : ''}
    </form>`;
  };

  const queue = pending.map((m) => {
    const state = 'pending';
    return `<li class="queue-row">
      <div class="queue-line">
        <strong>${esc(m.display_name)}</strong>
        <span class="pill">${esc(m.tier_name || defaultTierName(m.tier_no))}</span>
        <span class="spacer"></span>
        <span class="fine">${m.claimed_at ? relTime(m.claimed_at) : 'just now'}</span>
      </div>
      <dl class="kv">
        <dt>Reference</dt><dd class="mono">${esc(m.txn_reference || 'not given')}</dd>
        <dt>Amount</dt><dd>${m.amount_npr ? `NPR ${Number(m.amount_npr).toLocaleString('en-IN')}` : 'not said'}</dd>
        <dt>Sent by</dt><dd>${esc(methodLabel(m.method))}${m.payer_number ? ` · ${esc(m.payer_number)}` : ''}</dd>
        <dt>Dues unless this period</dt><dd>${m.dues_npr ? `NPR ${Number(m.dues_npr).toLocaleString('en-IN')} · ${esc(duesLine({ dues_npr: m.dues_npr, period_months: m.period_months }))}` : 'nothing set'}</dd>
      </dl>
      <div class="row" style="gap:var(--space-3)">
        <form method="post" action="/dashboard/${esc(channel.slug)}/members/${esc(m.profile_id)}/confirm">
          <button class="btn btn-primary btn-sm" type="submit">I found it — confirm</button>
        </form>
        <form method="post" action="/dashboard/${esc(channel.slug)}/members/${esc(m.profile_id)}/reject" class="row" style="gap:var(--space-2)">
          <input class="input" name="reason" maxlength="200" placeholder="what you looked for">
          <button class="btn btn-sm" type="submit">Not found</button>
        </form>
      </div>
      <p class="fine">${esc(CONFIRM_LINE)}</p>
    </li>`;
  }).join('');

  const roster = members.map((m) => {
    const state = membershipState(m, now);
    const left = daysLeft(m.period_end, now);
    const label = { active: 'current', pending: 'waiting', rejected: 'not found' }[state] || 'ended';
    return `<tr>
      <td>${memberPlate({ name: m.display_name, accent: m.accent, tier: m.tier_name, style: plateStyle(m.tier_no) })}</td>
      <td>${m.joined_at ? longDay(m.joined_at) : '—'}</td>
      <td><span class="pill${state === 'active' ? ' pill-success' : state === 'pending' ? '' : ' pill-warning'}">${esc(label)}</span>
        ${state === 'active' && left !== null ? `<span class="fine">${plural(left, 'day')} left</span>` : ''}</td>
      <td>${m.confirmed_at ? longDay(m.confirmed_at) : 'not confirmed'}</td>
      <td class="fine">${m.publicly_listed ? 'named on the storefront' : 'hidden from the list'}</td>
    </tr>`;
  }).join('');

  return layout({
    title: 'Members', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'members', 'Members', `Dues are yours and are paid to you directly. bytebikri is not in that
  path — it cannot confirm a payment for you, and it takes no share of one.`)}
${flashNote(flash)}

<div class="section">
  <div class="section-head">
    <h2>Waiting on you</h2>
    <p>Someone said they sent dues. Check your own statement for the reference, then confirm or say you did not find it.</p>
  </div>
  ${pending.length
    ? `<ul class="queue">${queue}</ul>`
    : `<div class="empty">Nothing waiting. Claims appear here the moment somebody sends their reference — and
         until you confirm one, that person sees "the creator checks their own statement", not an error.</div>`}
</div>

<div class="section">
  <div class="section-head">
    <h2>Where the dues go</h2>
    <p>Written by you, shown to anyone who joins. Say a wallet, a bank line, or "at the shop" — what matters is
      that a stranger can act on it without asking you.</p>
  </div>
  <form method="post" action="/dashboard/${esc(channel.slug)}/members/note" class="stack stack-4">
    <div class="field">
      <label for="m-note">Payment instruction</label>
      <textarea class="input" id="m-note" name="note" rows="2" maxlength="240"
                placeholder="eSewa 98XXXXXXXX (Nima Crafts) — put your username in the remark">${esc(channel.membership_note || '')}</textarea>
      <span class="hint">${esc(MONEY_LINE)}</span>
    </div>
    <button class="btn btn-primary btn-sm" type="submit">Save instruction</button>
  </form>
</div>

<div class="section">
  <div class="section-head">
    <h2>Tiers</h2>
    <p>Two at most, and the top one is the one that shines. Set what you can actually deliver — a tier that
      outlives its promises is worse than no tier.</p>
  </div>
  ${tierEditor(1)}
  ${tierEditor(2)}
</div>

<div class="section">
  <div class="section-head">
    <h2>Who is in</h2>
    <p>${members.length ? `${plural(members.length, 'row')} — a membership that ends is kept, never deleted: the
      record of who paid is yours to keep even after their period runs out.` : 'Nobody yet.'}</p>
  </div>
  ${members.length
    ? `<div class="table-scroll"><table class="table">
        <thead><tr><th>Member</th><th>Joined</th><th>State</th><th>Confirmed</th><th>Listed</th></tr></thead>
        <tbody>${roster}</tbody>
      </table></div>`
    : `<div class="empty">No members yet. A file set to "Members only" is the invitation that works — the store
         shows it, locked, with what it takes to open it.</div>`}
</div>`,
  });
}

