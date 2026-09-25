/**
 * Legal pages.
 *
 * These are DRAFTS, written from what the code actually does — every claim below
 * is a description of a behaviour that exists in this repository, which is the
 * only way a privacy notice stays true six months later. Where a fact belongs to
 * the operator (who they are, where they are, how to reach them) it comes from
 * the environment and renders as a visible gap until it is filled in, so an
 * unfilled deployment says so instead of publishing a fiction.
 *
 * Nothing here is legal advice and none of it has been reviewed by a lawyer.
 * It is a working draft with the right structure and true statements.
 */

/**
 * Operator identity, from the environment.
 *
 * `.env.example` already reserves these names, which is why they are read here
 * rather than invented. When they are empty the pages show a banner naming the
 * missing fields: a privacy notice that does not say who is responsible for the
 * data is not a privacy notice, and a silent placeholder is worse than a gap
 * because nobody notices it.
 */
export const OPERATOR = {
  name: process.env.OPERATOR_LEGAL_NAME || null,
  address: process.env.OPERATOR_ADDRESS || null,
  email: process.env.OPERATOR_EMAIL || null,
  country: process.env.OPERATOR_COUNTRY || 'NP',
  district: process.env.OPERATOR_DISTRICT || null,
};

export const MISSING_OPERATOR_FIELDS = [
  ['OPERATOR_LEGAL_NAME', OPERATOR.name, 'the registered name of the business'],
  ['OPERATOR_ADDRESS', OPERATOR.address, 'a postal address for legal notices'],
  ['OPERATOR_EMAIL', OPERATOR.email, 'an address people can write to about their data'],
  ['OPERATOR_DISTRICT', OPERATOR.district, 'the district whose courts hear disputes'],
].filter(([, value]) => !value).map(([key, , why]) => ({ key, why }));

export const LAST_UPDATED = '21 September 2026';
/**
 * The date the notice last changed *for this deployment*.
 *
 * The media-host paragraph below is only true where a media host is configured, so a
 * deployment without one has the notice it had on the 21st and should not claim
 * otherwise. The lede of this file is the rule: the notice is "written to describe
 * what the software actually does".
 */
export const LAST_UPDATED_MEDIA_HOST = '26 September 2026';

const op = () => OPERATOR.name || 'the operator of ByteBikri';
const mail = () => OPERATOR.email || '[contact address not configured]';

// ---------------------------------------------------------------------------
// What the platform actually does. Described once, used by the notices, so the
// pages cannot drift from each other or from the code.
// ---------------------------------------------------------------------------

export const FACTS = {
  collects: [
    'The email address you sign up with, and a display name if you give one.',
    'Your password, stored only as a scrypt hash with a per-account salt. The password itself is never written anywhere.',
    'Session records: a hash of the session token, a hash of your IP address and browser, and the last time you used the session.',
    'What you do in the product: the stores you visit, the files you unlock, and the ads the network reports to us as completed.',
    'A count of page views per store per day. Counts, not histories.',
    'Your consent decisions, with the version of the notice you answered and the time you answered it.',
  ],
  neverCollects: [
    'Card numbers, bank details, or any payment credential. There is no checkout in this product.',
    'Buyer-to-seller payments. ByteBikri is not in that flow and never holds the money.',
    'Your contacts, your other apps, your precise location.',
    'The contents of files you download, after they are delivered.',
  ],
  retention: [
    ['Account, store and file records', 'Until you delete them, then 30 days in backups.'],
    ['Session records', 'Until the session expires or you sign out, then 30 days.'],
    ['Ad view events', '24 months. Ad networks reconcile earnings late and disputes go back a long way.'],
    ['Consent records', '12 months past your last decision. The point of keeping them is to be able to prove what you agreed to.'],
    ['Server logs', '14 days.'],
  ],
};

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

export const privacy = ({ mediaHost = false } = {}) => ({
  slug: 'privacy',
  title: 'Privacy',
  lede: `How ${op()} handles personal data, written to describe what the software actually does.`,
  sections: [
    {
      h: 'Who is responsible',
      body: `<p>${op()} runs ByteBikri.</p>
        <p>${OPERATOR.address ? `Postal address: ${OPERATOR.address}.` : ''}</p>
        <p>Write to <strong>${mail()}</strong> about anything on this page.</p>`,
    },
    {
      h: 'What we hold',
      body: `<ul>${FACTS.collects.map((x) => `<li>${x}</li>`).join('')}</ul>`,
    },
    {
      h: 'What we do not hold',
      body: `<ul>${FACTS.neverCollects.map((x) => `<li>${x}</li>`).join('')}</ul>
        <p>This list is short because the product is built to make it short. There is no
        payment flow to leak, because there is no payment flow.</p>`,
    },
    {
      h: 'The ad networks, in plain terms',
      body: `<p>Each store connects its own ad network account. When you watch a rewarded ad
        to unlock a file, that network — not us — serves the ad and decides what to show.</p>
        <p>To make that work we pass the network a <strong>pseudonymous identifier for your
        account</strong> and the callback address it should report the completed view to. We do
        not send your name, your email address, or your browsing history on this site.</p>
        <p>The network also sets its own cookies or device identifiers, under its own privacy
        notice, which we do not control and cannot read. If you refuse personalised ads, we do
        not pass the network anything that would let it target you.</p>`,
    },
    {
      h: 'Who else sees anything',
      body: `<p>A hosting provider that runs the servers and the database, and a storage provider
        that holds uploaded files. Both process data on our instructions. We do not sell personal
        data, and there is no advertising business here beyond the networks a store connects
        itself.</p>
        ${mediaHost ? `<p>File storage is a case of its own, and it is the one place a company
        other than ours sees somebody who is using this site. A store's files may be stored by that
        same storage provider, and when you open one your browser fetches it <strong>from them
        directly rather than through us</strong> — so they see your IP address, the same thing any
        file host sees, and we see only that you opened the file. They are not told your name, your
        email address, or what else you have watched or read here. Two things never go to them:
        documents you hand over for an identity check, which stay on our own servers and are
        destroyed when the check is decided, and anything you have not asked to open.</p>` : ''}`,
    },
    {
      h: 'How long we keep it',
      body: `<table class="table"><thead><tr><th>What</th><th>How long</th></tr></thead>
        <tbody>${FACTS.retention.map(([w, t]) => `<tr><td>${w}</td><td>${t}</td></tr>`).join('')}</tbody></table>`,
    },
    {
      h: 'Transfers',
      body: `<p>Servers and storage may be located outside your country, including outside Nepal.
        Where personal data moves from the EEA to a country without an adequacy decision, the
        transfer relies on the European Commission's standard contractual clauses.</p>`,
    },
    {
      h: 'Your rights',
      body: `<p>You can ask for a copy of your data, ask us to correct it, ask us to delete it, or
        withdraw a consent you gave. Write to <strong>${mail()}</strong>. We answer within 30 days.</p>
        <p>Withdrawing consent for personalised ads takes one click, on the
        <a href="/legal/cookies">cookies and consent</a> page, and takes effect immediately — but it
        does not make past processing unlawful, and it does not delete records we are required to
        keep.</p>
        <p>If you are in the EEA or the UK you also have the right to complain to your national
        data protection authority.</p>`,
    },
    {
      h: 'Children',
      body: `<p>ByteBikri is not directed at children. You must be at least 13 to hold an account,
        and 16 to give consent to personalised advertising where that consent is required.</p>`,
    },
    {
      h: 'Security',
      body: `<p>Passwords are hashed with scrypt and never stored in a recoverable form. Session
        tokens are stored only as hashes, sent in an httpOnly cookie, and revoked on sign-out or
        password change. Download links are minted for one account and expire.</p>
        <p>No system is perfect. If you find a problem, write to <strong>${mail()}</strong> before
        telling anyone else.</p>`,
    },
    {
      h: 'Changes',
      body: `<p>When this notice changes in a way that matters, the version changes with it and the
        consent banner returns — because an old agreement does not cover a new purpose.</p>
        <p>Last updated: ${mediaHost ? LAST_UPDATED_MEDIA_HOST : LAST_UPDATED}.</p>`,
    },
  ],
});

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

export const terms = () => ({
  slug: 'terms',
  title: 'Terms',
  lede: 'What ByteBikri is, what it is not, and what each side owes the other.',
  sections: [
    {
      h: 'What this service is',
      body: `<p>ByteBikri gives a creator a storefront where files are unlocked by watching a
        rewarded advertisement. The advertisement is paid for by an advertising network, and the
        network pays the creator <strong>directly, into the creator's own account</strong>.</p>
        <p>ByteBikri does not buy, sell, price, deliver, or hold the files, and does not handle
        money between a creator and the people who download from them. There is no checkout. What
        we provide is space, software, and moderation.</p>`,
    },
    {
      h: 'The creator',
      body: `<ul>
        <li>You keep the copyright in what you publish. You grant us only the permission needed
        to store it, show it, and deliver it to people who unlock it.</li>
        <li>You must have the rights to everything you publish. Publishing someone else's work,
        or work you do not have permission to distribute, ends the account.</li>
        <li>You keep your own ad network account, and you are responsible for the terms you agreed
        to with that network. We are not a party to it and take no share of it.</li>
        <li>You must not solicit or complete a sale outside ByteBikri. Taking a buyer off the
        platform to pay you directly is the one thing that makes the model unsafe for everyone,
        and it is grounds for removal.</li>
        <li>You must not use the store to contact, identify, or pursue someone who downloaded
        from you. Contact details that would let you track a person are not shown to you, and
        trying to work around that is a breach of these terms.</li>
        <li>Describe what you are publishing honestly. The description is what people are
        deciding on.</li>
      </ul>`,
    },
    {
      h: 'The person downloading',
      body: `<ul>
        <li>You are granted access to the file, for yourself, for the period stated when you
        unlock it. You are not granted the right to redistribute it.</li>
        <li>Download links are issued to your account and expire. Passing them on does not
        work, and trying to defeat that is a breach of these terms.</li>
        <li>You watch an advertisement to unlock. The network decides whether the view counted.
        A view that the network does not confirm is not an unlock, and no unlock is created by
        anything you or your browser say happened.</li>
      </ul>`,
    },
    {
      h: 'Refunds',
      body: `<p>There is no price and no payment between a creator and a downloader, so there is
        nothing to refund. What exists instead is access, and it can be withdrawn.</p>
        <p>If a creator publishes something broken, misleading, or not what was described — or
        takes money off-platform after promising access here — we treat it as what it is. The
        available responses are removal of the file, suspension of the store, permanent removal
        of the account, and a report to the payment provider or the network that paid them. The
        bar for the last two is a pattern of behaviour, not a single complaint.</p>`,
    },
    {
      h: 'Moderation',
      body: `<p>There is a global content policy, and where a country requires something
        different, a country-specific rule that applies to stores serving that country. Content
        that is lawful in one place and not another is handled by region, not by hiding the rule.</p>
        <p>We may remove content, suspend a store, or close an account that breaks these terms.
        Where we can, we say why.</p>`,
    },
    {
      h: 'What we charge',
      body: `<p>We charge for the store, not for the content: an annual fee per store, and an
        upgrade fee for a higher tier. We take <strong>no share of advertising revenue</strong> —
        not a percentage, not a fee. The network pays the creator and we are not in that path.</p>`,
    },
    {
      h: 'No guarantee of advertising',
      body: `<p>Ad availability, fill rate and rates are set by networks we do not control. Some
        campaigns stop in some countries at some times. We do not promise that any particular
        unlock will be available, or that any particular ad will pay any particular amount.</p>`,
    },
    {
      h: 'Liability',
      body: `<p>ByteBikri is provided as it is. To the extent the law allows, ${op()} is not
        liable for indirect or consequential loss, or for what a creator publishes or a user does
        with it. Nothing here excludes liability that cannot lawfully be excluded.</p>`,
    },
    {
      h: 'Which law applies',
      body: `<p>These terms are governed by the laws of Nepal, and disputes are heard by the
        courts of ${OPERATOR.district || '[the operator\'s district]'}.</p>`,
    },
    {
      h: 'Changes',
      body: `<p>We may change these terms. Material changes are announced in the product before
        they take effect, and continuing to use the service after that means accepting them.</p>
        <p>Last updated: ${LAST_UPDATED}.</p>`,
    },
  ],
});

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/**
 * The cookie table is written from the code, and there is one entry per cookie
 * the software can set. A notice that lists cookies "we and our partners may
 * use" without naming them is the kind that regulators issue findings about.
 */
export const COOKIE_TABLE = [
  {
    name: 'bb_session',
    kind: 'Essential',
    purpose: 'Keeps you signed in. Contains a random token; the server stores only its hash.',
    duration: '30 days with "keep me signed in", otherwise 12 hours',
  },
  {
    name: 'bb_cv',
    kind: 'Essential',
    purpose: 'A random identifier so your consent decision can be remembered without an account, and so it can be changed later.',
    duration: '12 months',
  },
  {
    name: 'Network cookies',
    kind: 'Personalised ads only',
    purpose: 'Set by the advertising network serving a rewarded ad, if you allow personalised ads. We neither set nor read them, and their notice governs them.',
    duration: 'Set by the network',
  },
];

export const cookies = ({ consent }) => ({
  slug: 'cookies',
  title: 'Cookies and consent',
  lede: 'What is stored in your browser, and how to change your mind.',
  consent,
  sections: [
    {
      h: 'Your current choice',
      body: consent?.decided
        ? `<p>Answered on ${new Date(consent.decidedAt).toLocaleDateString('en-GB', { dateStyle: 'long' })}.</p>`
        : '<p>You have not answered yet. Until you do, no personalised advertising is served to you and no analytics are recorded.</p>',
    },
    {
      h: 'The cookies',
      body: `<table class="table"><thead><tr><th>Name</th><th>Type</th><th>What it does</th><th>Lasts</th></tr></thead>
        <tbody>${COOKIE_TABLE.map((c) => `<tr><td><code>${c.name}</code></td><td>${c.kind}</td><td>${c.purpose}</td><td>${c.duration}</td></tr>`).join('')}</tbody></table>
        <p>The two essential cookies are necessary for the service to work. Nothing else is set
        until you answer, and answering "no" does not break anything — it changes what is shown.</p>`,
    },
    {
      h: 'Why refusing is genuinely allowed',
      body: `<p>Rewarded advertising without consent is still advertising: you would see a
        contextual ad, chosen from the page it appears on rather than from anything we know about
        you. It pays the creator less, and that is the trade — but refusing is not a locked door,
        and we do not pretend otherwise.</p>`,
    },
    {
      h: 'Changing your mind',
      body: `<p>Use the buttons below at any time. Withdrawing consent takes effect on your next
        page load, with no cooling-off period and no email required.</p>`,
    },
  ],
});
