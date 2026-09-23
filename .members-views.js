// ---------------------------------------------------------------------------
// Memberships — the plate, the roster, and the panel where somebody joins
// ---------------------------------------------------------------------------
//
// The design decisions here are borrowed and adapted, and it is worth saying
// which, because the shape of a paid tier is not obvious:
//
//   * The EFFECT rides the ring and the tier chip, never the name. Gradient text
//     fails a contrast check at small sizes — the guidance is to decide the text
//     colour first and put the gradient where it can be checked at its worst
//     stop — so a member's name is a solid accent colour that clears 4.5:1 on
//     both themes, and the shimmer lives on a 2px ring and a badge.
//   * The top tier is the shiny one. That is Discord's published deployment
//     advice for role styles (keep gradient and holographic to one or two roles)
//     and it is enforced by `plateStyle()`, not offered as a setting.
//   * The animation is OFF unless the visitor has no motion preference — the
//     researched pattern is to add animation inside `prefers-reduced-motion:
//     no-preference` rather than to add it by default and take it back.
//   * A locked file is still LISTED. Every paywall study worth reading says the
//     lock goes on the content and never on the teaser: the title, the cover and
//     the description are what make joining worth a click, and the wall is the
//     download.
//
// The one thing that is not borrowed: nothing here implies the platform handles
// the money. The dues go to the creator, and MONEY_LINE says so on every screen
// that asks for them.

/** The CSS custom properties a plate needs, from its palette. */
function plateStyleAttr(accentKey) {
  const a = accentOf(accentKey);
  return `--plate-ink:${a.onDark};--plate-ink-light:${a.onLight};--plate-a:${a.from};--plate-b:${a.to}`;
}

/**
 * One member: a ring, a name, and what they hold.
 *
 * The initial is drawn from the display name rather than an avatar image, because
 * a roster of twelve uploaded avatars is twelve more things to moderate and the
 * plate is about the name anyway.
 */
function memberPlate({ name, accent = 'indigo', tier = null, style = 'solid', joined = null, me = false }) {
  const label = String(name || 'Member');
  const initial = label.trim().slice(0, 1).toUpperCase() || 'M';
  return `<li class="member${me ? ' member--me' : ''}">
  <span class="member-avatar${style === 'gradient' ? ' member-avatar--shine' : ''}"
        style="${plateStyleAttr(accent)}" aria-hidden="true">${esc(initial)}</span>
  <span class="member-body">
    <span class="member-name" style="${plateStyleAttr(accent)}">${esc(label)}</span>
    ${tier ? `<span class="member-tier${style === 'gradient' ? ' member-tier--shine' : ''}"
        style="${plateStyleAttr(accent)}">${esc(tier)}</span>` : ''}
  </span>
  ${joined ? `<span class="member-since fine">${esc(joined)}</span>` : ''}
</li>`;
}

/** Everyone who chose to be named. No count — the plates are the proof. */
function memberRoster(roster = []) {
  if (!roster.length) return '';
  return `<ul class="member-roster">
    ${roster.map((m) => memberPlate({
    name: m.display_name, accent: m.accent, tier: m.tier_name,
    style: plateStyle(m.tier_no), joined: `since ${longDay(m.joined_at)}`,
  })).join('')}
  </ul>`;
}

/**
 * What a member sees about themselves — four states, four sentences.
 *
 * A person who has sent money and is waiting needs a different page from a person
 * whose period has ended, and both need a different page from somebody who has
 * never joined. Collapsing these into "your membership" is how a paid feature
 * turns into a support queue.
 */
function myMembershipCard({ channel, membership, tiers, rosterSize = 0 }) {
  const state = membershipState(membership);
  const tier = tierByNo(tiers, membership?.tier_no);
  const accent = tier?.accent || 'indigo';
  const left = daysLeft(membership?.period_end);
  const plate = plateStyle(membership?.tier_no);
  const listed = membership?.publicly_listed !== false;

  if (state === 'pending') {
    return `<div class="member-self" style="${plateStyleAttr(accent)}">
      <div class="member-self-head">
        <span class="member-avatar member-avatar--shine" aria-hidden="true">${esc(String(channel.name).slice(0, 1).toUpperCase())}</span>
        <div>
          <strong>Your claim is with the creator.</strong>
          <p class="small" style="margin:0">${esc(tier?.name || 'Member')} —
            you sent <span class="mono">${esc(membership.txn_reference || 'a reference')}</span>
            ${membership.claimed_at ? `on ${esc(longDay(membership.claimed_at))}` : ''}.
            They check their own statement and confirm it, and the files open then.</p>
        </div>
      </div>
      <p class="fine">${esc(MONEY_LINE)} Nobody has been told anything false: this is a wait, not an error.</p>
      <form method="post" action="/s/${esc(channel.slug)}/leave">
        <button class="btn btn-sm" type="submit">Cancel this claim</button>
      </form>
    </div>`;
  }

  if (state === 'rejected') {
    return `<div class="member-self" style="${plateStyleAttr(accent)}">
      <strong>That reference was not found.</strong>
      <p class="small">${esc(membership.rejected_reason || 'The creator checked their statement and could not find it.')}
        Nothing is broken — a wrong digit in a reference is the usual reason. Send it again below and it goes back in the queue.</p>
    </div>`;
  }

  const live = state === 'active';
  return `<div class="member-self${live ? ' member-self--live' : ''}" style="${plateStyleAttr(accent)}">
    <div class="member-self-head">
      <span class="member-avatar${live && plate === 'gradient' ? ' member-avatar--shine' : ''}"
            aria-hidden="true">${esc(String(channel.name).slice(0, 1).toUpperCase())}</span>
      <div>
        <strong>${live ? `You are a member — ${esc(tier?.name || 'Member')}` : 'Your period has ended.'}</strong>
        <p class="small" style="margin:0">${live
    ? `Files behind this tier open for you with no ad${left !== null ? `, for ${plural(left, 'more day')}` : ''}.`
    : `${esc(LAPSE_LINE)}`}</p>
      </div>
      ${live && left !== null ? `<span class="member-countdown">${plural(left, 'day')} left</span>` : ''}
    </div>
    <div class="row" style="gap:var(--space-3);align-items:center">
      <form method="post" action="/s/${esc(channel.slug)}/members/listing">
        <input type="hidden" name="listed" value="${listed ? 'no' : 'yes'}">
        <button class="btn btn-sm" type="submit">${listed ? 'Hide me from the member list' : 'Show me in the member list'}</button>
      </form>
      <form method="post" action="/s/${esc(channel.slug)}/leave">
        <button class="btn btn-sm" type="submit">Leave</button>
      </form>
      ${live ? '' : `<a class="btn btn-sm btn-primary" href="#join">Send this period's dues</a>`}
    </div>
    <p class="fine">${listed
    ? 'You are named on this store’s member list. That is the perk — it is the only place a plate is visible — and hiding it changes nothing else.'
    : 'You are hidden from the member list. Your files stay open either way.'}
      ${rosterSize ? ` ${plural(rosterSize, 'person', 'people')} are named here.` : ''}</p>
  </div>`;
}

/**
 * The join panel: what the tiers are, where to send the money, and the form that
 * records the reference.
 *
 * The order is the whole design. Tier cards first (what you get), then the
 * creator's own instruction (where to send it), then — only then — the form. A
 * payment form above the explanation asks somebody to trust a number with no
 * context, and the money line sits directly under the button, not in a footer.
 */
function joinPanel({ channel, user, tiers, membership, flash = null }) {
  const state = membershipState(membership);
  if (state === 'active' || state === 'pending') return '';
  const cards = tiers.map((t) => {
    const plate = plateStyle(t.tier_no);
    const accent = accentOf(t.accent);
    return `<li class="tier-card${plate === 'gradient' ? ' tier-card--elite' : ''}" style="${plateStyleAttr(t.accent)}">
      <div class="tier-head">
        <span class="member-avatar${plate === 'gradient' ? ' member-avatar--shine' : ''}"
              aria-hidden="true">${esc(t.name.slice(0, 1).toUpperCase())}</span>
        <div>
          <strong>${esc(t.name)}</strong>
          <p class="tier-dues">${esc(duesLine(t))}</p>
        </div>
      </div>
      ${t.perks ? `<p class="tier-perk">${esc(t.perks)}</p>` : ''}
      <p class="fine">${esc(PLATE_COPY[plate])}${plate === 'gradient' ? ' — and the top tier is the only one that wears it' : ''}</p>
      <span class="tier-accent" aria-hidden="true">${esc(accent.label)} plate</span>
    </li>`;
  }).join('');

  const paid = channel.membership_note
    ? `<div class="note note-info" style="margin-top:var(--space-4)">
        <strong>Where the dues go, in the creator’s own words:</strong>
        <p class="small" style="margin:var(--space-2) 0 0">${esc(channel.membership_note)}</p>
        <p class="fine" style="margin:var(--space-2) 0 0">${esc(MONEY_LINE)}</p>
      </div>`
    : `<div class="note note-warning" style="margin-top:var(--space-4)">
        <strong>This store has not said where to send the dues yet.</strong>
        The tiers are open, so you can see what membership is — but there is nothing to pay until the creator
        writes the instruction down. ${esc(MONEY_LINE)}
      </div>`;

  if (!user) {
    return `<div class="note" style="margin-top:var(--space-5)">
      <strong>Sign in to join.</strong> A membership is a name on a list, so it needs an account —
      <a href="/login?next=${encodeURIComponent(`/s/${channel.slug}#join`)}">sign in</a> and this panel will have the form.
    </div>`;
  }

  const methodOptions = CLAIM_METHODS.map((m) => `<option value="${m}">${esc(methodLabel(m))}</option>`).join('');
  const tierSelect = tiers.length > 1
    ? `<div class="field">
        <label for="join-tier">Which tier</label>
        <select class="input" id="join-tier" name="tier">
          ${tiers.map((t) => `<option value="${t.tier_no}"${Number(t.tier_no) === 1 ? ' selected' : ''}>${esc(t.name)} — ${esc(duesLine(t))}</option>`).join('')}
        </select>
      </div>`
    : `<input type="hidden" name="tier" value="${esc(String(tiers[0]?.tier_no ?? 1))}">`;

  return `<div id="join" class="join-panel">
    <div class="section-head" style="margin-bottom:var(--space-4)">
      <h3>Join</h3>
      <p>Dues go to the creator, not to bytebikri. You send it, you paste the reference, they confirm it.</p>
    </div>
    ${cards ? `<ul class="tier-grid">${cards}</ul>` : ''}
    ${paid}
    <form method="post" action="/s/${esc(channel.slug)}/join" class="join-form">
      ${tierSelect}
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 150px">
          <label for="join-method">How you sent it</label>
          <select class="input" id="join-method" name="method">${methodOptions}</select>
        </div>
        <div class="field" style="flex:1 1 150px">
          <label for="join-reference">Reference</label>
          <input class="input" id="join-reference" name="reference" required minlength="4" maxlength="120"
                 placeholder="the code on your receipt">
          <span class="hint">This is the only thing the creator can match against their statement.</span>
        </div>
        <div class="field" style="flex:0 1 120px">
          <label for="join-amount">Amount</label>
          <input class="input" id="join-amount" name="amount" type="number" min="0" max="100000" step="1"
                 inputmode="numeric" placeholder="NPR">
        </div>
      </div>
      <button class="btn btn-primary" type="submit">Send the reference</button>
      <p class="fine" style="margin-top:var(--space-3)">Nothing is charged here and nothing is held.
        The creator confirms it against their own statement, and until they do, no file opens — that is the wait, not a bug.</p>
    </form>
  </div>`;
}

/**
 * The whole members section for a storefront: roster, your own card, the panel.
 *
 * Rendered for every store that has tiers, whether or not the viewer is signed
 * in — a locked thing people can see is a shop window, and the researched lesson
 * from every paywall is that the teaser is never the thing behind the wall.
 */
function membersSection({ channel, user, tiers, membership, roster, membershipsOn, flash = null }) {
  if (!tiers.length) return '';
  const named = roster.filter((m) => m.profile_id !== user?.id);
  return `<section class="section" id="members">
  <div class="section-head">
    <h2>Members</h2>
    <p>${plural(named.length, 'person', 'people')} belong to this store by name. Dues go straight to the creator; bytebikri takes nothing.</p>
  </div>
  ${flash ? `<div class="note note-${flash.kind === 'danger' ? 'warning' : 'success'}" role="status">${esc(flash.message)}</div>` : ''}
  ${memberRoster(named)}
  ${membership ? myMembershipCard({ channel, membership, tiers, rosterSize: named.length }) : ''}
  ${membershipsOn ? joinPanel({ channel, user, tiers, membership }) : ''}
</section>`;
}

