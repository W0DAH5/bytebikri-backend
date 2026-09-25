/**
 * Server-rendered views.
 *
 * Plain template literals, no framework. The app is server-rendered by design:
 * an ad-gated page that needs a client bundle before it can show content is a
 * page that shows nothing when the bundle is slow, and component 6 (pageview
 * counting) is only honest if the HTML is the thing being counted.
 *
 * Rules this file follows:
 *   - Every interpolation goes through esc() or a number formatter. There is no
 *     raw `${userValue}` in a tag, ever.
 *   - The view layer never touches the store. Everything it renders is passed
 *     in, because the store is async and this file is not.
 *   - Lock state is precomputed by the caller. A view that could ask "is this
 *     unlocked?" would, and would block rendering to do it.
 */

import {
  REPORT_REASONS, REPORT_HONESTY, NOTE_LIMIT, reporterMessage, reportVerdict,
  AUTO_HIDE_AFTER, hidingNotice, canAppeal, APPEAL_LIMIT, sellerReasonLabel,
} from './reports.js';
// The calibration judgement lives in the domain file next to gapVerdict, so the
// operator's page and the seller's page can never disagree about what a gap means.
import { calibrationRowState } from './earnings.js';
// From `security.js`, which imports nothing: a view module must render without a
// database, and importing the reset logic here made four test files need one.
import { MIN_PASSWORD_LENGTH } from './security.js';
// The shape's name on a card, and the order sections are listed in. The shape
// itself is decided on the server, from the files (`media.js` → `assetShape`) —
// this module only names it, so there is exactly one place that decides and no
// second one that could disagree.
import { shapeLabel, SHAPE_ORDER, assetShape } from './media.js';
// Dependency-free, so a view can call it directly: `planUsage` is the one
// definition of "how full is this plan", used by the dashboard, the operator's
// plans page and the message at the upload wall.
import { planUsage, rentAge, AGE_BUCKETS, RENT_TERMS } from './billing.js';
import { isoDay, daysBetween, longDay, shortDay } from './dates.js';
import { COUNTRY_OPTIONS, countryIn, countryName } from './countries.js';
// The asset vocabulary lives in one place. `moderation.js` is pure — no database
// import — so a view may read it, which is what keeps the console from inventing
// its own words for `restricted`.
import { assetBehaviour } from './moderation.js';
// The audit vocabulary and the two renderers that make a row readable: who did it
// (a person, the platform, or a visitor) and what it was about.
import { AUDIT_FAMILIES, actorOf, subjectOf } from './audit.js';
import {
  METHODS, methodOf, stateOf, lapseOf, withinNoticeWindow, badgeFor, whatItMeans, requestability, STATE_WORDING,
  DEFAULT_MONTHS, LAPSE_WINDOW_DAYS,
} from './verification.js';
// What may be handed over and how long it is held, from the same module the upload
// route enforces it with. The page prints the number and the rule; a promise about a
// week that is written twice is a promise that drifts.
import { ALLOWED_TYPES, MAX_BYTES, HOLD_DAYS, extFor } from './kyc.js';
// Membership rules and copy. A pure module like `kyc.js`: it imports nothing, so
// the plate palettes, the tier validation and the one money sentence are shared
// with the routes without a view module ever reaching for a database.
import {
  THEMES, THEME_KEYS, THEME_NOTE, THEME_FREE_LINE, NO_THEME, themeOf, themeStyle, motionNote,
} from './themes.js';
// The ad arrangement and the seller's revenue rows: the membership's promise to the
// member and the seller's own two-line model, written once in memberships.js.
import {
  MEMBER_AD_LINE, ADS_AROUND_LINE, SELLER_DUES_LINE, revenueRows,
  // The attention door: which doors a tier has, what a join by watching costs,
  // where somebody is against that price, and the sentences both of them are told.
  doorsOf, adModeOf, attentionProgress, attentionLine, attentionStandingLine,
  ATTENTION_LINE, ATTENTION_MONEY_LINE, ATTENTION_SELLER_LINE, SUPPORTER_LINE,
  SUPPORTER_SELLER_LINE, JOIN_MODE_LABEL, ATTENTION_DOOR_LABEL, standingOf,
  attentionBankedLine, JOIN_MODES, AD_MODES,
} from './memberships.js';
import {
  ACCENTS, ACCENT_KEYS, PERIODS, CLAIM_METHODS, PLATE_COPY, MONEY_LINE, FREE_PLAN_LINE,
  CONFIRM_LINE, LAPSE_LINE, accentOf, plateStyle, tierByNo, duesLine, methodLabel,
  membershipState, daysLeft, defaultTierName,
  // The store's own role icon: six shapes, from a fixed vocabulary, painted in the
  // chip's ink rather than in a colour of their own.
  GLYPHS, GLYPH_KEYS, glyphOf,
} from './memberships.js';
// The ask ladder. Pure, like `memberships.js`: the numbers a seller's picker shows,
// the numbers the buyer's panel prints and the numbers the tests assert all come
// from this one table, so a page cannot promise a friendlier ask than the pipeline
// enforces.
import {
  ASK_LEVELS, ASK_PROMISE, ASK_INPUT_LINE, resolveAsk, askLabel, askReason, bandFor, descriptionAskClaim,
} from './adscale.js';
// The cosmetics engine: every look slot, its owner and its values, declared once. The
// look picker below is this list, drawn — see the module for the ownership rule.
import { personSlots } from './cosmetics.js';
import {
  PLACEMENT_BOUNDS, PLACEMENTS, planFor, stamp, placementSentence, breakCues, breakSentence,
  betweenCues, breaksSupported,
} from './placement.js';
// The live panel's own words (§14). Imported from the module that owns the ratio, so
// the sentence a seller reads and the arithmetic the door enforces are one thing.
import { lengthWords } from './live.js';
// The page model (§13): the reader's own words for a step, and where its gates fall.
import { stepLabel, gateSentence } from './pages.js';
// The person's own premium: what a name may wear, and the gate that decides whether
// it is worn at all (`plusWear()` — active only, decided in SQL).
import {
  PLUS_NAME, PLUS_NOT, PLUS_SEPARATION_LINE, EFFECTS, EFFECT_KEYS, effectOf, wearClass, composeName,
  WEAR_OWNER_LINE, CHIP_OWNER_LINE,
  plateOf, PLATE_KEYS, plusState, plusWear, plusDaysLeft, plusMoneyLine,
  // Gifting: the four states a code can be in, said separately to the buyer and to
  // whoever is holding the code, plus the two derived numbers for the second period.
  GIFT_STATE_LINE, GIFT_BUYER_LINE, GIFT_NOT, plusYearPrice, plusYearNote,
  plusConsoleRows,
  // The person's own band: the one surface a palette bought here is painted on that
  // belongs to the person rather than to a store.
  personBand, OWN_BAND_LINE, OWN_BAND_MIX,
  // The two outer layers of a look: the ring around the initial, and the edge of the
  // person's own card. Both decided by `plusWear()`/`composeName()`, like the paint.
  ringClass, frameClass, ringOf, frameOf,
} from './plus.js';
// The blocker ladder. One module, so the sentence the visitor reads and the
// sentence the seller's dashboard prints cannot disagree about what was done.
import { rungFor, NEVER_DO, blockedSellerNote } from './blocked.js';

const FAMILY_LABELS = Object.fromEntries(AUDIT_FAMILIES.map((f) => [f.key, f.label]));

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const npr = (n) => `NPR ${Number(n).toLocaleString('en-IN')}`;

/**
 * A calendar date, as `2026-08-31`.
 *
 * `date` columns come back from Postgres as `Date` objects at UTC midnight, and
 * `String(date).slice(0, 10)` — which is what four pages were doing — gives
 * "Sat Aug 01". It looked like a formatting choice and was actually a bug that
 * appeared on the store detail page, the period table and the invoice line at
 * once. ISO is also the unambiguous form: `01/08` is two different days depending
 * on which side of the world you read it from, and this platform bills on dates.
 */
// Re-exported from `dates.js`, where it lives with the reasoning: four pages
// rendered "Sat Aug 01" because a `date` column is a `Date` object and
// `String(value).slice(0, 10)` looks like formatting. One definition now, shared
// with the billing arithmetic that had the same bug in a different disguise.
export { isoDay };

/**
 * `plural(1, 'view')` → "1 view"; `plural(3, 'view')` → "3 views".
 *
 * Trivial, and the reason it exists is that "1 views in 30 days" is the kind of
 * detail that makes a product read as unfinished regardless of how well
 * everything else works. Irregular nouns take an explicit plural.
 */
const plural = (n, singular, pluralForm = `${singular}s`) =>
  `${num(n)} ${Number(n) === 1 ? singular : pluralForm}`;

/**
 * "1 file" / "3 files".
 *
 * The same helper exists in `server.js` for the flash sentences, and both exist for
 * the same reason: a count inside a sentence is read as a claim about what happened,
 * and "Paused 1 files" makes a real change read like a template.
 */
const filesN = (n) => `${Number(n) || 0} file${Number(n) === 1 ? '' : 's'}`;
const num = (n) => Number(n).toLocaleString('en-IN');

const relTime = (d) => {
  // Not a dash. `relTime(null)` appears in "last file", "last verified", "sent" and
  // "decided" columns, and a dash in each of them reads as a rendering fault rather
  // than as a fact. "never" is the fact.
  if (!d) return 'never';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return shortDay(d);
};

/**
 * One or two letters for a name — the product's one derivation of a monogram.
 *
 * The separators matter more than they look. A store is as likely to be written
 * `nima-crafts` as `Nima Crafts`, and a mark has to be the same mark whichever way
 * the creator typed it; hyphens, underscores, middots and spaces all end a word
 * here. Two letters rather than one is the other half of the rule, and it is the
 * one piece of arithmetic the generated-identity field is unanimous about: a single
 * initial collides about 1 in 260, two collide about 1 in 7000.
 */
const initials = (s) => String(s || '?')
  .trim()
  .split(/[\s\-_\u00b7]+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((w) => w[0])
  .join('')
  .toUpperCase();

/**
 * A deterministic placeholder for content with no cover image.
 *
 * Two letters and a hue derived from the title. A grey box reads as a broken
 * image; a coloured monogram reads as a design choice, which is the difference
 * between "unfinished" and "minimal". Real covers replace it the moment a
 * seller uploads one.
 */
// A file with no cover already gets a monogram (see `thumb` below). It is the SAME
// derivation as everything else in this file rather than a second copy of "the first
// letters of the words": two implementations is how a store's mark and a file's
// placeholder end up disagreeing about the same word.
const glyph = (title) => initials(title);
const hue = (title) => {
  let h = 0;
  for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

function thumb({ title, coverUrl, height = 160 }) {
  const inner = coverUrl
    ? `<img src="${esc(coverUrl)}" alt="" loading="lazy" decoding="async">`
    : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
  const style = coverUrl ? '' : ` style="filter:hue-rotate(${hue(title)}deg)"`;
  return `<div class="thumb"${style}>${inner}</div>`;
}

function pill(text, kind = '') {
  return `<span class="pill${kind ? ` pill-${kind}` : ''}">${esc(text)}</span>`;
}

/**
 * How a moderation state looks — the one place the colour is decided.
 *
 * Five call sites had grown four different mappings, and the state they
 * disagreed about was `pending`: the state every store passes through, and the
 * state every store's first file is in until somebody looks at it. Two of those
 * sites painted it red, the colour of a takedown, which makes a queue that
 * shouts about the routine case a queue whose shouting stops meaning anything.
 *
 * The rule: red is a decision that withholds something from somebody; amber is a
 * decision that limits without hiding; a green state is one somebody approved;
 * and a state nobody has decided yet is quiet. A queue row already says "this
 * needs a decision" in its heading, its count and its `!` marker — the pill does
 * not have to repeat it in colour.
 */
const STATE_TONE = {
  pending: '',
  approved: 'success',
  restricted: 'warning',
  suspended: 'danger',
  removed: 'danger',
};
const stateTone = (state) => STATE_TONE[state] ?? 'warning';

/**
 * A moderation notice, for the one person who can act on it.
 *
 * Three parts, in the order a seller needs them: what state the store is in,
 * what the rule says, and when it was decided. The rule's sentence comes from
 * `policy_rules` — written before the argument started — and the operator's own
 * line is the remedy, not the charge. Nothing here is free text standing alone,
 * and every field is escaped like any other input.
 *
 * It is rendered ONLY to the owner. A visitor to a suspended store gets a 404,
 * which is the point.
 */
function moderationNotice(m, { heading = null } = {}) {
  if (!m) return '';
  const kind = m.state === 'restricted' ? 'warning' : 'danger';
  return `<div class="note note-${kind} moderation-notice" role="status">
  <div class="row" style="align-items:baseline">
    <strong>${esc(heading || 'This store is not public right now')}</strong>
    <span class="spacer"></span>
    ${pill(m.state, kind)}
  </div>
  <p class="small" style="margin:var(--space-3) 0 0">${esc(m.note)}</p>
  ${m.ruleCode ? `<p class="fine" style="margin:var(--space-2) 0 0">
    Rule: <span class="mono">${esc(m.ruleCode)}</span>${m.decidedAt
      ? ` · decided ${esc(relTime(m.decidedAt))}`
      : ''}
  </p>` : ''}
  <p class="fine" style="margin:var(--space-3) 0 0">
    Nothing has been deleted, your files are untouched, and you can still read every page here.
    Reply to the message you were sent if this is wrong.
  </p>
</div>`;
}

function avatar(name) {
  return `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;
}

/**
 * A store's mark: its own initials, in its own colours.
 *
 * `channels.logo_url` has been in the schema since migration 0008 with the comment
 * "Optional — the UI falls back to the store initial", and no UI ever did. A
 * storefront was a name in a heading, so every shop looked like every other shop
 * that typed a different word, and Explore was a grid of cards with nothing of the
 * store on them. A logo is honoured when a store has one (there is no upload for it
 * yet, so today that is nobody); the fallback the column promised is here, derived
 * from the name.
 *
 * PAINTED IN THE STORE'S OWN PALETTE, AND IN NOTHING ELSE. On a themed store the
 * tile is the inversion the band's own controls already use — the band's ink as the
 * surface, the band's deep stop as the letter — which is the same pair of colours
 * `themes.test.js` measures white against at twenty points of the interpolation, so
 * the mark cannot introduce a colour that no arithmetic has seen. A store with no
 * theme gets the neutral tile this product already draws for a person.
 *
 * A rounded square, not a circle: in this product a circle is a person (the nav
 * chip, a roster row). A store is a plate.
 *
 * And nothing here moves. The band on the same page drifts; the research on role
 * styles has said since the first round what happens when everything shimmers.
 */
function storeMark(channel, { paint = true } = {}) {
  const themed = themeOf(channel?.theme) ? themeStyle(channel.theme) : '';
  const cls = `store-mark${themed ? ' store-mark--themed' : ''}`;
  // `paint: false` is for the one caller that sits INSIDE a band which repaints
  // itself: the seller's stage. The mark then carries the class and inherits
  // `--theme-*` from the band, so pointing at a card repaints the seller's own mark
  // along with the band — instead of an inline pair of properties freezing it on the
  // theme that happened to be saved when the page loaded.
  const style = themed && paint ? ` style="${esc(themed)}"` : '';
  // `aria-hidden` because the store's name is always rendered beside the mark: it is
  // a second rendering of the same word, and a screen reader reading it twice is the
  // failure mode of every initial-letter component ever written.
  if (channel?.logo_url) {
    return `<span class="${cls}"${style} aria-hidden="true">`
      + `<img src="${esc(channel.logo_url)}" alt="" decoding="async"></span>`;
  }
  return `<span class="${cls}"${style} aria-hidden="true">${esc(initials(channel?.name))}</span>`;
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

/**
 * The consent banner.
 *
 * Two real buttons of equal weight. No dimmed "manage" link as the only way to
 * say no, no pre-ticked boxes, no "by continuing you agree". A banner that is
 * hard to refuse is not consent, and the difference is the whole point of the
 * ePrivacy rules.
 *
 * It is a plain form POST, so it works with no JavaScript and cannot be
 * silently skipped by a script failure.
 */
/**
 * The unconfirmed-address strip.
 *
 * It is a strip and not a modal for the same reason the plan meter is a sentence
 * below 80%: an account whose address is unconfirmed still works, and a platform
 * that interrupts somebody to tell them about a thing they can fix in ten seconds
 * is a platform people close. It sits under the header on every signed-in page
 * until the address is confirmed, links to one page that does the explaining, and
 * says what confirming is FOR rather than what is wrong.
 *
 * Not shown to admins: the operator account is created by the boot path from
 * `OPERATOR_EMAIL`, so confirming it is a deploy step rather than a person's
 * loose end — and the console is where that state belongs, not every page of it.
 */
function addressNotice(user) {
  if (!user || user.role === 'admin' || user.email_verified_at) return '';
  return `
<div class="notice-strip">
  <div class="wrap notice-strip-inner">
    <span>
      <strong>Confirm your email address.</strong>
      Until the address on this account answers, we cannot send you a receipt, an invoice or a
      dispute notice — and a payment needs all three. <span class="mono">${esc(user.email)}</span>
      is on the account, unconfirmed.
    </span>
    <a class="btn btn-sm" href="/verify">Confirm it</a>
  </div>
</div>`;
}

function consentBanner(consent) {
  if (!consent || !consent.outstanding) return '';
  return `
<div class="consent" role="region" aria-label="Cookies">
  <div class="wrap consent-inner">
    <div>
      <strong>Ads pay for the free downloads here.</strong>
      <p class="small" style="margin:var(--space-2) 0 0">
        Personalised ads let the network use what you have already watched to pick the next one,
        which pays the creator more. Say no and you still watch an ad — an untargeted one. Nothing
        is shared until you choose. <a href="/legal/cookies">What this means</a>.
      </p>
    </div>
    <form method="post" action="/consent" class="consent-actions">
      <input type="hidden" name="next" value="${esc(consent.returnTo || '/')}">
      <button class="btn btn-primary" type="submit" name="choice" value="all">Accept all</button>
      <button class="btn" type="submit" name="choice" value="none">Reject all</button>
      <a class="btn btn-ghost" href="/legal/cookies">Choose individually</a>
    </form>
  </div>
</div>`;
}

/**
 * The entrance-reveal bootstrap, as ONE fixed piece of inline JavaScript.
 *
 * This is a landing-page device, so it is switched on by the page that wants it
 * and by nothing else. A dashboard is a tool: its cards, tables and panels are
 * the thing the person came for, and fading them in as they scroll reads as the
 * interface being slow rather than as movement. Storefronts and Explore get it;
 * every signed-in page does not.
 *
 * Two conditions, both necessary: the page carries `data-reveal`, and motion is
 * welcome. With no JavaScript at all nothing is ever hidden, because the class
 * that hides things is only ever added by this script.
 *
 * It is a CONSTANT — the same bytes on every page, with the decision moved into
 * an attribute on the html element — for one reason: script-src 'self' in the
 * CSP blocks inline scripts, and the way to allow one without opening the door
 * to every injected script is to name its hash. A hash only matches if the text
 * never varies. server.js computes the hash from this same constant at boot and
 * a test asserts the two agree; the earlier version, which interpolated
 * "true" or "false" into the script, was blocked in every browser — the reveal
 * never ran anywhere, and nothing looked broken because the content simply
 * appeared without moving.
 */
export const REVEAL_BOOTSTRAP =
  "if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&document.documentElement.hasAttribute('data-reveal'))" +
  "document.documentElement.classList.add('reveal-ready');";

export function layout({
  title, user, body, activeChannel = null, wide = false, current = '', consent = null,
  reveal = false,
  /**
   * The unconfirmed-address strip is on every signed-in page except the one that
   * exists to explain it. A reminder pointing at the page you are already reading
   * is noise, and noise is how the reminders that matter get skimmed past.
   */
  showAddressNotice = true,
  /**
   * A paid store may take bytebikri's name off ITS OWN pages — the storefront and the
   * files on it. `plans.capabilities.remove_footer` has been true on both paid plans
   * since migration 0001 and was rendered nowhere until now, which made it the same
   * shape of defect this repository keeps finding: a capability in the table, absent
   * from the pricing page, and read by nothing.
   *
   * It removes the wordmark LINE, not the footer. Privacy, Terms and Cookies stay on
   * every page on every plan, because the visitor reading a creator's store is still on
   * this platform's pages, under this platform's notice, and a plan that could hide
   * that would be selling a compliance problem rather than a feature. (Linktree sells
   * exactly this and keeps its legal links for the same reason.)
   */
  plainFooter = false,
}) {
  const onAddressPage = current === 'verify';
  const navLink = (href, label, key) =>
    `<a href="${esc(href)}"${current === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`;

  const accountName = (user?.display_name || user?.email || '').split('@')[0];
  const accountWear = plusWear(user);
  const account = user
    ? `<span class="who">
         <a class="who-link" href="/plus" title="${accountWear ? 'Your look, and where it comes from' : 'ByteBikri Plus — your name, the way you want it'}">
           ${accountWear
    ? `<span class="${plusAvatarClass(user, 'avatar')}" style="${plateStyleAttr(accountWear.plate)}" aria-hidden="true">${esc(initials(user.display_name || user.email))}</span>`
    : avatar(user.display_name || user.email)}
           <span class="muted" style="font-size:var(--text-xs)">${nameTag(accountName, user, { base: 'who-name' })}</span>
         </a>
       </span>
       <form method="post" action="/logout" style="display:contents">
         <button class="btn btn-sm btn-ghost" type="submit">Sign out</button>
       </form>`
    : `<a class="btn btn-sm" href="/login">Sign in</a>
       <a class="btn btn-sm btn-primary" href="/signup">Start a store</a>`;

  return `<!doctype html>
<html lang="en"${reveal ? ' data-reveal' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(title)} · ByteBikri</title>
<meta name="description" content="Watch an ad, unlock the file. Creators keep their own ad revenue.">
<link rel="stylesheet" href="/styles.css">
<script>${REVEAL_BOOTSTRAP}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="header" id="site-header">
  <div class="wrap">
    <a class="brand" href="/"><span class="brand-mark">B</span> ByteBikri</a>
    <nav class="nav" aria-label="Main">
      ${navLink('/marketplace', 'Explore', 'marketplace')}
      ${user ? navLink('/library', 'Library', 'library') : ''}
      ${user ? navLink('/plus', 'Plus', 'plus') : ''}
      ${activeChannel ? navLink(`/dashboard/${esc(activeChannel.slug)}`, 'Dashboard', 'dashboard') : ''}
      ${user?.role === 'admin' ? navLink('/admin', 'Console', 'admin') : ''}
    </nav>
    <span class="spacer"></span>
    ${account}
  </div>
  <span class="scroll-progress" aria-hidden="true"></span>
</header>
${showAddressNotice && !onAddressPage ? addressNotice(user) : ''}
<main id="main"${wide ? '' : ''} class="wrap">${body}</main>
${consentBanner(consent)}
<footer class="footer${plainFooter ? ' footer-plain' : ''}">
  <div class="wrap">
    <div class="row">
      ${plainFooter ? '' : '<span>ByteBikri — the shop belongs to the creator.</span>'}
      <span class="row-tight">
        <a href="/legal/privacy" style="color:inherit">Privacy</a>
        <a href="/legal/terms" style="color:inherit">Terms</a>
        <a href="/legal/cookies" style="color:inherit">Cookies</a>
      </span>
    </div>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export function landing({ channels, user, stats, consent = null, moneyMap = null }) {
  const featured = channels.slice(0, 6).map(channelCard).join('');

  /**
   * The hero shows the product, not a description of it.
   *
   * Linear, Vercel and Stripe all open with real interface, and the research is
   * unambiguous that a screenshot removes doubt in a way copy cannot. So the
   * window below is not an illustration of the money map: it is the money map —
   * the same four facts the earnings page renders, from the same structure, so
   * the two pages cannot drift apart or disagree.
   *
   * One primary action, and it is the one a stranger can act on. Pages with a
   * single CTA convert at 13.5% against 10.5% for five or more, and the second
   * button here was competing with the first for the same click.
   */
  const legs = moneyMap ? [
    { dt: 'Who pays for the unlock', dd: 'The ad network', primary: false },
    { dt: 'Paid into', dd: moneyMap.toCreator.account, primary: true },
    { dt: 'Held by ByteBikri', dd: moneyMap.toCreator.held, primary: true },
    { dt: 'Our share of it', dd: moneyMap.toCreator.cut, primary: true },
  ] : [];

  const moneyLegs = legs.map((l) => `<div class="money-leg${l.primary ? ' money-leg-primary' : ''}" style="border:0;padding:0">
    <dt>${esc(l.dt)}</dt><dd>${esc(l.dd)}</dd>
  </div>`).join('');

  return layout({
    title: 'Content that unlocks with attention',
    user, current: 'home', consent,
    reveal: true,
    body: `
<section class="hero">
  <span class="pill pill-accent pill-lg">Ad-gated access</span>
  <h1 style="margin-top:var(--space-5)">Watch a short ad.<br>Unlock the file.</h1>
  <p class="lede">Creators publish templates, photos, guides and sample packs. One rewarded ad
  unlocks a download, and the network pays the creator's own account.</p>
  <div class="hero-actions">
    <a class="btn btn-lg btn-primary" href="/marketplace">Explore stores</a>
    <a class="link-quiet" href="/signup">or open a store of your own →</a>
  </div>

  ${legs.length ? `
  <div class="preview-window" aria-hidden="false">
    <div class="preview-bar" aria-hidden="true">
      <span class="preview-dots"><span></span><span></span><span></span></span>
      <span class="preview-url">bytebikri.com/dashboard/your-store/earnings</span>
    </div>
    <div class="preview-body">
      <dl class="money-map">${moneyLegs}</dl>
      <p class="fine" style="margin:0">${esc(moneyMap.toCreator.detail)}</p>
      <p class="fine" style="margin:0">${esc(moneyMap.toPlatform.detail)}</p>
    </div>
  </div>` : ''}

  <div class="proof-strip">
    ${proof(stats.channels, 'Stores')}
    ${proof(stats.assets, 'Unlockable files')}
    ${proof(stats.unlocks, 'Unlocks granted')}
    ${proof(null, 'Cut of ad revenue', '0%')}
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Stores on ByteBikri</h2>
    <span class="spacer"></span>
    <a href="/marketplace" class="small">See all →</a>
  </div>
  ${featured ? `<div class="grid-channels">${featured}</div>` : '<div class="empty">No stores yet.</div>'}
</section>

<!--
  The step that actually moves money is the one to design around, so it is
  numbered and the other two are not. The ordered list carries the sequence; the numerals
  are decoration and say so with aria-hidden, because announcing "one" twice is
  noise for a screen reader.
-->
<section class="section">
  <div class="section-head">
    <h2>How a file gets unlocked</h2>
    <p>Three steps, and the money moves in exactly one of them — from the network to you.</p>
  </div>
  <ol class="steps">
    <li class="step">
      <span class="step-num" aria-hidden="true">01</span>
      <h3>You publish a file</h3>
      <p class="small">Attach it, set it to <strong>one rewarded ad</strong>, done. No price to set,
      because nobody is buying it with money.</p>
    </li>
    <li class="step">
      <span class="step-num" aria-hidden="true">02</span>
      <h3>Someone watches the ad</h3>
      <p class="small">The network serves the ad inside your page. When it completes, the network
      calls our server with a signature — the browser's word counts for nothing here.</p>
    </li>
    <li class="step">
      <span class="step-num" aria-hidden="true">03</span>
      <h3>The network pays you</h3>
      <p class="small">Your own account at the network, on the network's own schedule. We are not a
      party to that payment and we cannot see the balance.</p>
    </li>
  </ol>
</section>

<section class="section">
  <div class="section-head">
    <h2>What this costs, and what it never costs</h2>
    <p>Two charges and no share of anything. If a number appears anywhere on this site, it is one of these.</p>
  </div>
  <div class="grid-channels">
    <div class="card card-pad-lg">
      <h3>No price on the file</h3>
      <p class="small" style="margin-top:var(--space-2)">Access is bought with attention, not money.
      That means no checkout, no card, and nothing for ByteBikri to hold.</p>
    </div>
    <div class="card card-pad-lg">
      <h3>Earnings go to the creator</h3>
      <p class="small" style="margin-top:var(--space-2)">The network pays the creator's account directly.
      We take 0% of it, and we cannot touch it.</p>
    </div>
    <div class="card card-pad-lg">
      <h3>Links that actually gate</h3>
      <p class="small" style="margin-top:var(--space-2)">Download URLs are minted per person and expire,
      so they cannot be forwarded and reused.</p>
    </div>
  </div>
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Marketplace + storefront
// ---------------------------------------------------------------------------

function channelCard(c) {
  return `<a class="card card-interactive channel-card" href="/s/${esc(c.slug)}">
  ${c.banner_url
    ? `<img class="channel-banner channel-banner-img" src="${esc(c.banner_url)}" alt="" loading="lazy" decoding="async">`
    : '<div class="channel-banner"></div>'}
  <div class="row">
    ${storeMark(c)}
    <h3>${esc(c.name)}</h3>
    <span class="spacer"></span>
    ${c.listing_mode === 'marketplace' ? pill('Listed', 'accent') : ''}
  </div>
  <p class="small" style="margin:0">${esc(c.tagline || 'A store on ByteBikri.')}</p>
  <div class="row-tight" style="font-size:var(--text-xs);color:var(--text-faint)">
    <span>${plural(c.asset_count || 0, 'file')}</span>
    <span>·</span>
    <span>${esc(c.plan_code || 'free')} plan</span>
  </div>
</a>`;
}

/**
 * Explore — stores that chose to be listed.
 *
 * There used to be a second section here, "Own address only", fed by channels
 * the caller had already filtered to `listing_mode = 'marketplace'`. It was
 * therefore empty on every request: a whole column of the page that could never
 * have content, above a promise that these stores "exist at their link".
 *
 * It should not come back. A store that chose its own address is not published
 * in a directory — that is what the choice MEANS — and listing it here would
 * quietly overrule the seller's decision. The empty state now says what the
 * page is for instead of apologising for a section that should not exist.
 */
export function marketplace({ channels, user, consent = null, q = '', results = null, explore = null }) {
  const listed = channels.filter((c) => c.listing_mode === 'marketplace');
  const searching = String(q || '').trim().length >= 2;

  /**
   * A store in a rail, with the reason it is in that rail.
   *
   * The reason is not a caption. A visitor reading "Popular this week" has to be
   * able to see what earned it, and a visitor reading "Featured" has to be able
   * to see that the position was bought — anything else is a dark pattern with
   * better typography.
   */
  const railCard = (entry, paid) => {
    // `verifiedBadge` already returns '' when there is no check, so it is called
    // once and guarded with a ternary. The first version wrote
    // `${badgeFor(v) && verifiedBadge(v)}`, and `false && ...` evaluates to
    // `false`/`null` — which a template literal prints, so every un-checked store
    // in this rail was called "Nima Craftsnull" on the page.
    const identity = verifiedBadge(entry.channel.verification);
    return `
    <a class="card card-interactive rail-card${paid ? ' rail-card-paid' : ''}"
       href="/s/${esc(entry.channel.slug)}">
      <div class="row" style="align-items:flex-start">
        <div style="min-width:0">
          <h3 style="font-size:var(--text-md)">${esc(entry.channel.name)}${identity ? ` ${identity}` : ''}</h3>
          <p class="small" style="margin:var(--space-1) 0 0">${esc(entry.channel.tagline || 'A store on ByteBikri.')}</p>
        </div>
        ${!paid && entry.rank ? `<span class="spacer"></span><span class="rank-badge">${num(entry.rank)}</span>` : ''}
      </div>
      <div class="rail-why">
        ${paid ? pill('Paid placement', 'warning') : pill('Earned', 'success')}
        ${entry.alsoPlaced ? pill('Also featured (paid)', 'warning') : ''}
        <span class="fine">${esc(entry.why)}</span>
      </div>
    </a>`;
  };

  const rail = (r) => `
  <section class="section">
    <div class="section-head">
      <h2>${esc(r.title)}</h2>
      <p>${esc(r.note)}</p>
    </div>
    <div class="grid-rails">${r.entries.map((e) => railCard(e, r.key === 'featured')).join('')}</div>
  </section>`;

  const resultBlock = searching ? `
    <section class="section">
      <div class="section-head">
        <h2>Results for “${esc(results.term)}”</h2>
        <p>${plural(results.stores.length + results.assets.length, 'match', 'matches')}</p>
      </div>
      ${results.stores.length
        ? `<div class="grid-channels">${results.stores.map(channelCard).join('')}</div>`
        : ''}
      ${results.assets.length
        ? `<div class="grid-assets" style="margin-top:var(--space-6)">${results.assets.map((a) => `
            <a class="asset" href="/s/${esc(a.channel_slug)}/a/${esc(a.slug)}">
              <div style="position:relative">${thumb({ title: a.title, coverUrl: a.cover_url })}</div>
              <div class="asset-body">
                <h3>${esc(a.title)}</h3>
                <p class="asset-desc">${esc(a.description || 'No description yet.')}</p>
                <div class="asset-foot">
                  <span>${esc(a.channel_name)}</span>
                  <span>${a.unlock_mode === 'open' ? 'Free'
    : a.unlock_mode === 'breaks' ? 'Free, a break inside' : 'One ad'}</span>
                </div>
              </div>
            </a>`).join('')}</div>`
        : ''}
      ${results.stores.length + results.assets.length
        ? ''
        : `<div class="empty">Nothing matches “${esc(results.term)}”. Search looks at the name,
             the one-line description and the file titles of stores that are listed here —
             it does not reach into anybody's private store.</div>`}
    </section>` : '';
  return layout({
    title: 'Explore', user, current: 'marketplace', consent,
    reveal: true,
    body: `
<div class="section" style="margin-bottom:0">
  <h1>Explore</h1>
  <p class="lede" style="margin-top:var(--space-3)">Stores that opted in to being listed here.
  Plenty of sellers keep to their own address and are found by link — those are not listed, on purpose.</p>
  <form class="search" method="get" action="/marketplace" role="search">
    <label class="sr-only" for="q">Search stores and files</label>
    <input class="input" id="q" name="q" type="search" value="${esc(q || '')}"
           placeholder="Search stores, files, descriptions…" autocomplete="off">
    <button class="btn btn-primary" type="submit">Search</button>
  </form>
</div>
${resultBlock}
${searching ? '' : `
${explore && explore.rails.length ? explore.rails.map(rail).join('') : ''}

<section class="section">
  <div class="section-head">
    <h2>${explore && explore.rails.length ? 'All listed stores' : 'Listed stores'}</h2>
    <p>${plural(listed.length, 'store')}. Listing here is a choice a creator makes — plenty keep to
      their own address and are found by link.</p>
  </div>
  ${listed.length
    ? `<div class="grid-channels">${listed.map(channelCard).join('')}</div>`
    : `<div class="empty">No store has listed itself yet. Every store still works at its own address —
        asking the creator you follow for theirs is the way in.</div>`}
</section>`}
`,
  });
}

/**
 * The identity badge, wherever it appears.
 *
 * One renderer on purpose: the wording is the product (it says WHAT was checked and
 * WHEN, and never "trusted seller"), and two copies of a sentence like that drift
 * the moment somebody improves one of them. It is a positive mark only — there is
 * no "unverified" counterpart anywhere, because a store that has not been checked
 * is not a suspect.
 */
export function verifiedBadge(verification, { today = new Date(), withSentence = false } = {}) {
  const badge = badgeFor(verification, today);
  if (!badge) return '';
  return `${pill(badge.label, 'success')}${withSentence ? verifiedSentence(verification, { today }) : ''}`;
}

/**
 * The sentence, on its own.
 *
 * It exists because the first version of the storefront called `verifiedBadge`
 * twice — once for the chip beside the name and once with `withSentence` — and the
 * page showed the chip twice and the sentence once. Two renderers would be worse
 * than that bug (the copy is the product, and two copies drift), so this one asks
 * the same `badgeFor` for the same string and renders only the sentence: the chip
 * stays where chips belong, in the heading row, and the explanation reads under
 * the facts it explains.
 */
export function verifiedSentence(verification, { today = new Date() } = {}) {
  const badge = badgeFor(verification, today);
  if (!badge) return '';
  return `<p class="fine" style="margin-top:var(--space-3)">${esc(badge.sentence)}</p>`;
}

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
 * The wearer's own pair of colours, for the parts of somebody else's card that are theirs.
 *
 * The roster's avatar carries the STORE's paint — the tier's accent fills the tile and the
 * store's top-tier glint sits on it — and it also carries the person's ring. One element,
 * two owners, so the ring is painted from `--wear-a/--wear-b` while everything the store
 * owns keeps reading the plate pair. Without this a teal member of a violet store wore a
 * violet ring: the ring took the tile's inherited palette, which is the creator's.
 */
function wearStyleAttr(accentKey) {
  const a = accentOf(accentKey);
  return `--wear-a:${a.from};--wear-b:${a.to}`;
}

/**
 * One member: a ring, a name, and what they hold.
 *
 * The initial is drawn from the display name rather than an avatar image, because
 * a roster of twelve uploaded avatars is twelve more things to moderate and the
 * plate is about the name anyway.
 */
function memberPlate({
  name, accent = 'indigo', tier = null, tierNo = 0, glyph = null,
  joined = null, me = false, plusRow = null,
}) {
  const label = String(name || 'Member');
  const initial = label.trim().slice(0, 1).toUpperCase() || 'M';
  /*
   * BOTH LAYERS, BUILT IN ONE PLACE.
   *
   * This used to be an either/or, and it was wrong in a way worth remembering: a
   * member who had bought a look from bytebikri lost the STORE's tier chip on the
   * store's own roster, because the Plus branch replaced the store branch. Two
   * unrelated payers were deciding one element and the wrong one won.
   *
   * `composeName` decides both and returns both. The name wears the person's own
   * effect (or, without Plus, the palette ink of the tier they hold here); the chip
   * beside it is always the creator's, drawn from the tier, and always present when
   * the person holds one.
   */
  // `glyph` travels with the tier because it belongs to the same owner. It is easy to
  // forget here — this call rebuilt the tier object from three fields, and the mark
  // then rendered on the tier CARD and not on the roster, which is the one page the
  // shape exists for. The browser check is what caught it: a unit test that only
  // asks "is there a `data-glyph` somewhere on this page" is answered by the card.
  const layers = composeName({
    plus: plusRow,
    tier: tierNo ? { tier_no: tierNo, name: tier, accent, glyph } : null,
  });
  const top = layers.chip?.style === 'gradient';
  const namePalette = layers.name?.palette ?? accent;
  const nameClass = ['member-name', layers.name?.className ?? 'wear-solid'].filter(Boolean).join(' ');
  // The two outer layers, on the card itself. `layers.ring`/`layers.frame` come out of
  // the same `composeName()` call as the name, so a page cannot draw one of the four
  // person layers and forget the others.
  const frame = cardFrame({ frame: layers.frame?.key ?? null, plate: namePalette });
  const ring = avatarRing({ ring: layers.ring?.key ?? null });
  // The tile's palette is the store's; the RING's is the person's. Only written when the
  // person actually wears a ring — a member with no look keeps the tile exactly as it is,
  // so this changes nothing for anybody who has not bought one. The leading `;` matters:
  // `plateStyleAttr()` does not end in one, so a space here would glue the new pair onto
  // the last declaration and the browser would drop all three — which is exactly how this
  // shipped for one probe run (`--plate-b:#5b21b6 --wear-a:#0f766e` is one broken value).
  const ringPalette = ring ? `;${wearStyleAttr(namePalette)}` : '';
  return `<li class="member${me ? ' member--me' : ''}${top ? ' member--top' : ''}${frame.cls ? ` ${frame.cls}` : ''}"
    ${frame.style ? `style="${frame.style}"` : ''}>
  <span class="member-avatar${top ? ' member-avatar--shine' : ''}${ring ? ` ${ring}` : ''}"
        style="${plateStyleAttr(accent)}${ringPalette}" aria-hidden="true">${esc(initial)}</span>
  <span class="member-body">
    <span class="${nameClass}" style="${plateStyleAttr(namePalette)}">${esc(label)}</span>
    ${layers.chip ? tierChip({
    label: layers.chip.label, glyph: layers.chip.glyph, top,
    style: plateStyleAttr(layers.chip.palette),
  }) : ''}
  </span>
  ${joined ? `<span class="member-since fine">${esc(joined)}</span>` : ''}
</li>`;
}

/**
 * The chip, drawn once — layer S, wherever a store's tier is shown beside a name.
 *
 * Three call sites had grown three copies of this markup (the roster, the tier card's
 * sample, the seller's picker), which is how a chip with a glyph ends up beside a
 * chip without one. The glyph is inside the chip on purpose: the research on how
 * roles are drawn next to a username is unanimous that the shape reads as part of the
 * name plate, and a shape floating beside a chip reads as two unrelated marks.
 */
function tierChip({ label, glyph = null, top = false, style = '' }) {
  const g = glyphOf(glyph);
  return `<span class="store-chip${top ? ' store-chip--top' : ''}"${style ? ` style="${style}"` : ''}>`
    + `${g ? `<span class="tier-glyph" data-glyph="${esc(g.key)}" aria-hidden="true"></span>` : ''}`
    + `${esc(label)}</span>`;
}

/**
 * A person's name, in their own chosen look — if they have one and it is current.
 *
 * Used everywhere a name is rendered to somebody else: a roster, a review, the
 * account chip, the buyer's own preview. The dressing is decided by `plusWear()`,
 * which refuses any row the database has not marked active, so the same call is
 * safe on a storefront a stranger is reading and on a page about the wearer.
 *
 * The look is ALWAYS in the wearer's own palette. A person's choice of colour is
 * not consent for anything else to change — no layout, no size, no position, and
 * no motion that the stylesheet has not already put under a reduced-motion guard.
 */
function plusNameClasses(wear, base = 'member-name') {
  if (!wear) return base;
  // The effect-to-class mapping lives in `plus.js` beside the effects themselves,
  // so an effect can never ship as a key with no styling: an unknown one has no
  // class and therefore renders exactly as the plain look.
  return [base, wearClass(wear.effect)].filter(Boolean).join(' ');
}

/**
 * The name on a review, dressed by the SAME call the roster uses — and handed the row
 * the query actually returned.
 *
 * This used to read `{ plus_active: r.plus_status !== null, … }`: the template deciding
 * entitlement from the presence of a column. That was TRUE only because
 * `PLUS_SUBSCRIPTION_JOIN` is a lateral subquery that yields a row for nothing except an
 * active, unexpired subscription — the rule lived in the query and the template merely
 * happened to agree with it. Change that join (to show a lapsed month, say) and this
 * page starts painting looks nobody is paying for, silently, on a storefront.
 *
 * Now `plusWear()` reads the row itself, through `plusState()`: pending wears nothing,
 * active-and-unexpired wears the look, lapsed wears nothing, and a row with no
 * subscription at all wears nothing — the same gate the roster, the account chip and the
 * card go through, asserted in `wear.test.js`.
 */
export function reviewName(row = null) {
  // A reviewer who is not named is a real state, not a placeholder: the review survives
  // the account and the name is simply gone.
  if (!row?.buyer_name) return 'A buyer';
  return nameTag(row.buyer_name, row);
}

export function nameTag(name, row = null, { base = 'member-name', accent = null } = {}) {
  const label = String(name ?? '');
  if (!label) return '';
  const wear = plusWear(row);
  // No look of their own: the name takes the palette of whatever context it is drawn in.
  // On a store's card that is the tier they hold there (the same `accent` the roster's
  // name uses), and everywhere else there is nothing to paint and the page's own ink
  // applies. Without the accent a member appeared in two colours on ONE page — the
  // store's teal on their roster row and the fallback indigo in the queue above it.
  if (!wear) {
    return accent
      ? `<span class="${base} wear-solid" style="${plateStyleAttr(accent)}">${esc(label)}</span>`
      : `<span class="${base} wear-solid">${esc(label)}</span>`;
  }
  return `<span class="${plusNameClasses(wear, base)}" style="${plateStyleAttr(wear.plate)}">${esc(label)}</span>`;
}

/**
 * A paid store's plan, on its own header.
 *
 * Nothing on the free plan renders, because a free store is the normal case and a
 * mark that everybody has is a mark that means nothing. What is left is honest:
 * "Store" or "Pro", paid to bytebikri, in the store's own palette (or amber for
 * Pro), and it says nothing about the members' chips and nothing about Plus —
 * three unrelated things that share a page and never share a sentence.
 */
function planMark(plan) {
  const code = plan?.capabilities?.memberships || plan?.capabilities?.can_theme ? plan?.code : null;
  if (!code || code === 'free') return '';
  const label = plan?.name ? String(plan.name) : (code === 'pro' ? 'Pro' : 'Store');
  return `<span class="plan-mark${code === 'pro' ? ' plan-mark--pro' : ''}"
    title="This store is on the ${esc(label)} plan, paid to bytebikri — it says nothing about any member’s own look.">
    ${esc(label)} plan</span>`;
}

/** The ring on an avatar, in the same palette, for the row that has room for one. */
function plusAvatarClass(row = null, base = '', wear = plusWear(row)) {
  // Takes the ROW (or, for a caller that has already resolved it, the wear itself as
  // the third argument). It used to take a row and be handed a wear: `plusWear()` on a
  // wear object is always null, so the header avatar silently rendered without its
  // ring — on the one avatar every page shows. The parameter is named and the fallback
  // is explicit so that mistake is not available again.
  // `.plus-avatar` keeps the flat ring the earlier rounds shipped; `.wear-ring` adds
  // the rotating conic one that arrives with the ring as a paid decoration. Both are
  // declared, and both are inert until hovered.
  // The person's ring CHOICE replaces the default ring; no choice keeps the one this
  // product has always drawn. `ring-none` is a choice and it is spelled out in the
  // stylesheet as "this element has no ring", which is not the same state as a person
  // who has never opened the picker — taking their ring away would be the product
  // inventing a change on a page they never touched.
  const ring = wear ? ringClass(wear.ring) : null;
  return wear ? `${base} plus-avatar ${ring}`.trim() : base;
}

/**
 * The ring on any avatar that is not the account chip: the roster plate, the seller's
 * member list, the person's own preview.
 *
 * `''` when the person has not chosen a ring, because these avatars carry no ring today
 * and a slot must add decoration rather than move it: a member who never opened the
 * picker keeps the plate they already had, exactly as with the name paint.
 */
function avatarRing(wear) {
  if (!wear || !wear.ring || wear.ring === 'none') return '';
  return ringClass(wear.ring);
}

/**
 * The edge of the person's own card, wherever the card is drawn.
 *
 * An EDGE, not a surface: the border colour and, for two of the four, a rule or a light
 * outside the box. It never sets a background or a text colour — the stylesheet test
 * refuses that — so the store's chip, the card's ink and the palette arithmetic that
 * governs them are all untouched by it.
 */
function cardFrame(wear) {
  const cls = wear ? frameClass(wear.frame) : '';
  if (!cls) return { cls: '', style: '' };
  // The card carries the palette so the frame's two colours can resolve, exactly the
  // way `plateStyleAttr` already dresses the avatar and the name inside it.
  return { cls, style: plateStyleAttr(wear.plate) };
}

/** Everyone who chose to be named. No count — the plates are the proof. */
function memberRoster(roster = []) {
  if (!roster.length) return '';
  return `<ul class="member-roster">
    ${roster.map((m) => memberPlate({
    name: m.display_name, accent: m.accent, tier: m.tier_name, tierNo: m.tier_no,
    glyph: m.glyph,
    joined: `since ${longDay(m.joined_at)}`,
    // Their own look, if they have one and it is current. Two payments to two
    // different parties can be on one plate; neither can impersonate the other,
    // because a store's tier is the badge and a person's palette is the name.
    plusRow: m,
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
function myMembershipCard({ channel, membership, tiers, rosterSize = 0, standing = 0 }) {
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
      <p class="fine">${esc(MONEY_LINE)} Nothing has gone wrong here: a claim waits for a person, and that is the design.</p>
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
        <strong>${live ? `You are a member, ${esc(tier?.name || 'Member')}` : 'Your period has ended.'}</strong>
        <p class="small" style="margin:0">${live
    // The arrangement is the MEMBERSHIP's, snapshotted when they joined, not the
    // tier's current setting: a seller who changes the tier tomorrow does not
    // change what this person was promised today.
    ? (adModeOf(membership) === 'supporter'
      ? `You hold the belonging at this tier${left !== null ? ` for ${plural(left, 'more day')}` : ''} — the files`
        + ' keep their ordinary asks, and that was stated before you joined.'
      : `Files behind this tier open for you with no ad${left !== null ? `, for ${plural(left, 'more day')}` : ''}.`)
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
    ${live ? `<p class="fine">${membership.join_method === 'attention'
    ? `You joined by watching — ${esc(plural(Number(membership.standing_used) || 0, 'verified view'))} did it, and nothing was charged.`
    : 'You joined with dues paid straight to the creator.'}${standing > 0
    ? ` Your ${esc(plural(standing, 'view'))} since then count${standing === 1 ? 's' : ''} toward the next period.`
    : ''}
      <a href="/s/${esc(channel.slug)}/members">The member room →</a></p>` : ''}
    <p class="fine">${listed
    ? 'You are named on this store’s member list, and the chip beside your name here is the creator’s — their colour '
      + 'for the tier you hold. It appears on this store’s pages and nowhere else. Hiding your name changes nothing else.'
    : 'You are hidden from the member list. Your files stay open either way.'}
      ${rosterSize ? ` ${plural(rosterSize, 'person', 'people')} are named here.` : ''}</p>
    <p class="fine">${esc(adModeOf(membership) === 'supporter' ? SUPPORTER_LINE : MEMBER_AD_LINE)}</p>
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
function joinPanel({ channel, user, tiers, membership, assets = [], standing = 0, flash = null }) {
  const state = membershipState(membership);
  if (state === 'active' || state === 'pending') return '';
  // THE PREMIUM SHOWCASE, and it is the researched shape rather than a guessed one:
  // every membership product worth copying shows the LOCKED THINGS on the tier card
  // (Patreon lists the posts a tier opens; Substack shows premium posts in the feed
  // with a lock on them). A tier that promises "bonus content" converts nobody —
  // what converts is a named file with a cover and a link.
  const opensForTier = (tierNo) => assets.filter(
    (a) => a.unlock_mode === 'members' && (Number(a.member_tier) || 1) <= Number(tierNo),
  );
  const cards = tiers.map((t) => {
    const plate = plateStyle(t.tier_no);
    const doors = doorsOf(t);
    const price = attentionProgress({ tier: t, standing });
    /*
     * The watching door, on the card it belongs to, with the two numbers that make
     * it a door rather than a promise: what it costs and where this person is
     * against it. A progress line that only appeared once somebody was close would
     * be a door most people never notice — the researched rule for a feature nobody
     * is told about is that it converts nobody.
     */
    const watching = doors.attention
      ? watchingDoor({ channel, tier: t, standing, user, membership, price })
      : '';
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
      ${(() => {
    const opens = opensForTier(t.tier_no);
    if (!opens.length) {
      return `<p class="tier-opens fine">No files are set to members-only yet — nobody can join until there is
        something behind the door.</p>`;
    }
    return `<div class="tier-opens">
      <span class="fine">${plural(opens.length, 'file')} open to this tier${adModeOf(t) === 'supporter'
    ? ', on the same terms as everything else in this store:'
    : ', with no ad:'}</span>
      <ul class="tier-file-list">
        ${opens.slice(0, 4).map((a) => `<li><span class="locked-glyph" aria-hidden="true">🔒</span><a href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">${esc(a.title)}</a></li>`).join('')}
        ${opens.length > 4 ? `<li class="fine">and ${opens.length - 4} more</li>` : ''}
      </ul>
    </div>`;
  })()}
      ${adModeOf(t) === 'supporter' ? `<p class="fine">${esc(SUPPORTER_LINE)}</p>` : ''}
      ${watching}
      <p class="fine">${esc(PLATE_COPY[plate])}</p>
      <div class="plate-sample" aria-label="${esc(PLATE_COPY[plate])}">
        <span class="member-avatar${plate === 'gradient' ? ' member-avatar--shine' : ''}"
              aria-hidden="true">${esc(t.name.slice(0, 1).toUpperCase())}</span>
        <span class="member-name">Your name</span>
        ${tierChip({ label: t.name, glyph: t.glyph, top: plate === 'gradient' })}
      </div>
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

  // The tiers are shown to EVERYONE, signed in or not: what membership is and what
  // it costs is the shop window, and hiding it until somebody signs in is the
  // opposite of the researched rule that the teaser is never the thing you hide.
  // Only the form needs an account.
  if (!user) {
    // The anonymous branch gets the same arrangement sentence as the signed-in one.
    // It is the branch MOST people read: a visitor deciding whether to make an
    // account is exactly the person who wants to know what the ads do.
    return `<div id="join" class="join-panel">
      <div class="section-head" style="margin-bottom:var(--space-4)">
        <h3>Join</h3>
        <p>Dues go to the creator, not to bytebikri. You send it, you paste the reference, they confirm it.</p>
        <p class="fine">${esc(ADS_AROUND_LINE)}</p>
      </div>
      ${cards ? `<ul class="tier-grid">${cards}</ul>` : ''}
      ${paid}
      <a class="btn btn-primary" style="margin-top:var(--space-5)"
         href="/login?next=${encodeURIComponent(`/s/${channel.slug}#join`)}">Sign in to join</a>
      <p class="fine" style="margin-top:var(--space-3)">A membership is a name on a list, so it needs an account.
        Nothing is charged here and nothing is held.</p>
    </div>`;
  }

  const methodOptions = CLAIM_METHODS.map((m) => `<option value="${m}">${esc(methodLabel(m))}</option>`).join('');
  // Only the tiers that actually sell dues. A tier sold as "join by watching" in
  // this select would be a form that refuses on submit, which is the worst of both.
  const duesTiers = tiers.filter((t) => doorsOf(t).dues);
  const soleDoor = duesTiers.length === 1 && tiers.length === 1;
  const tierSelect = duesTiers.length > 1
    ? `<div class="field">
        <label for="join-tier">Which tier</label>
        <select class="input" id="join-tier" name="tier">
          ${duesTiers.map((t) => `<option value="${t.tier_no}"${Number(t.tier_no) === 1 ? ' selected' : ''}>${esc(t.name)} — ${esc(duesLine(t))}</option>`).join('')}
        </select>
      </div>`
    : `<input type="hidden" name="tier" value="${esc(String(duesTiers[0]?.tier_no ?? tiers[0]?.tier_no ?? 1))}">`;
  const anyWatching = tiers.some((t) => doorsOf(t).attention);
  const anyDues = duesTiers.length > 0;

  return `<div id="join" class="join-panel">
    <div class="section-head" style="margin-bottom:var(--space-4)">
      <h3>Join</h3>
      <p>${anyDues
    ? 'Dues go to the creator, not to bytebikri. You send it, you paste the reference, they confirm it.'
    : 'Nothing to pay here: this store opens its memberships by watching.'}</p>
      ${anyWatching ? `<p class="fine">${esc(ATTENTION_LINE)}</p>` : ''}
      <p class="fine">${esc(ADS_AROUND_LINE)}</p>
    </div>
    ${cards ? `<ul class="tier-grid">${cards}</ul>` : ''}
    ${anyDues ? paid : ''}
    ${anyDues ? `
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
    </form>` : `<p class="fine">There is no dues form on this store: every tier here is joined by watching, and the
      button on the tier card is the whole of it.</p>`}
  </div>`;
}

/**
 * The member room: the one page behind the door.
 *
 * The belonging needs a place or the tier is a badge — that is the researched
 * shape, not an invention (Patreon's member feed, a Discord members channel,
 * Twitch's subscriber chat). What this page is NOT is a feed: it is one page with
 * three things on it, and none of them scroll.
 *
 *   1. what your tier opens — every file it opens, named, with the state of your
 *      own period on each one;
 *   2. the store's own note, in the creator's words, and who else is in;
 *   3. the way to keep it — a line about the next period, from the door they used.
 *
 * A NON-member sees the same three things with the files locked and the way in
 * underneath. That is deliberate and it is the same decision the storefront
 * already made: what membership is stays visible, because a wall with no window is
 * how a tier sells nothing.
 */
export function memberRoom({
  channel, user, consent = null, tiers = [], membership = null, standing = 0,
  assets = [], roster = [], flash = null, membershipsOn = false,
}) {
  const state = membershipState(membership);
  const inRoom = state === 'active';
  const myTier = Number(membership?.tier_no) || 0;
  const named = roster.filter((m) => m.profile_id !== user?.id);
  /*
   * Every members-only file, each with one question answered about it: does THIS
   * person's tier open it. Written once, as a predicate, because the wrong version
   * of it is the bug this page invites — a visitor who is wrong on the generous side
   * here is shown a list of files as theirs that the file page will refuse.
   */
  const memberFiles = assets.filter((a) => a.unlock_mode === 'members');
  const opensFor = (a) => inRoom && (Number(a.member_tier) || 1) <= myTier;
  const mine = memberFiles.filter(opensFor);
  const locked = memberFiles.filter((a) => !opensFor(a));
  // The tier this room is about: the one they hold, or the entry one they would.
  const roomTier = tierByNo(tiers, myTier) ?? tiers[0] ?? null;
  const price = roomTier ? attentionProgress({ tier: roomTier, standing }) : null;
  const doors = roomTier ? doorsOf(roomTier) : { dues: false, attention: false };

  const fileRow = (a, open) => `<li class="member-room-file">
    <span class="locked-glyph" aria-hidden="true">${open ? '✓' : '🔒'}</span>
    <a href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">${esc(a.title)}</a>
    <span class="fine">${open ? 'open to you' : `${esc(tierByNo(tiers, Number(a.member_tier) || 1)?.name || defaultTierName(Number(a.member_tier) || 1))} and above`}</span>
  </li>`;

  return layout({
    title: `${channel.name} — the member room`, user, activeChannel: null, consent, current: null,
    body: `
<a class="back-link" href="/s/${esc(channel.slug)}">← ${esc(channel.name)}</a>

<div class="section">
  <div class="section-head">
    <h1>The member room</h1>
    <p>${inRoom
    ? `You are a member of ${esc(channel.name)}. Everything your tier opens is on this page, and the way to keep it is at the bottom.`
    : (user
      ? `This is what membership of ${esc(channel.name)} opens. You are not a member yet — the way in is at the bottom of the page.`
      : `This is what membership of ${esc(channel.name)} opens, and who is already in. Sign in to see where you stand, or find a way in at the bottom of the page.`)}</p>
  </div>
  ${flashNote(flash)}
  ${inRoom ? '' : `<div class="note note-info" role="status">
    <strong>Members-only files are listed, not hidden.</strong>
    <p class="small" style="margin:var(--space-2) 0 0">${esc(ADS_AROUND_LINE)}</p>
  </div>`}
  ${user && state !== 'none'
    // The same card the storefront shows, in the same colours, because it is the
    // same fact about the same person. Rendering a second, prettier version of it
    // here is how a member ends up reading two different sentences about one
    // membership. `inRoom` drops the card's link back to this page.
    ? `<div style="margin-top:var(--space-5)">${myMembershipCard({
      channel, membership, tiers, rosterSize: roster.length, standing, inRoom: true,
    })}</div>`
    : ''}
</div>

<div class="section">
  <div class="section-head">
    <h2>${inRoom ? 'What this opens for you' : 'What membership opens'}</h2>
    <p>${memberFiles.length
    ? (inRoom
      ? `Every file behind the door, and which of them your tier opens.`
      : `Every file the store keeps for members. Which tier opens which is the store's decision, not the platform's.`)
    : 'Nothing is behind the door yet — the store has not published a members-only file.'}</p>
  </div>
  ${memberFiles.length
    ? `<ul class="member-room-files">${memberFiles.map((a) => fileRow(a, opensFor(a))).join('')}</ul>`
    : `<div class="empty">A store with no members-only file cannot sell a membership, and this one has not set one yet.</div>`}
  ${inRoom && !mine.length && locked.length ? `<p class="fine">None of these are open to your tier yet — the store sets which tier opens which file.</p>` : ''}
</div>

<div class="section">
  <div class="section-head">
    <h2>Who else is here</h2>
    <p>${named.length ? `${plural(named.length, 'person', 'people')} are named on this store's list.` : 'Nobody is named yet.'}</p>
  </div>
  ${memberRoster(named) || `<div class="empty">The roster is empty. Being named is each member&rsquo;s own choice — a store cannot put somebody on this list, and cannot take them off it.</div>`}
</div>

${channel.membership_note ? `<div class="section">
  <div class="section-head"><h2>Where the dues go</h2>
    <p>In the creator's own words. bytebikri is not in this path.</p></div>
  <div class="note note-info"><p class="small" style="margin:0">${esc(channel.membership_note)}</p>
    <p class="fine" style="margin-top:var(--space-2)">${esc(MONEY_LINE)}</p></div>
</div>` : ''}

<div class="section">
  <div class="section-head">
    <h2>${inRoom ? 'Keeping it' : 'Getting in'}</h2>
    <p>${inRoom
    ? `Your period ends ${membership?.period_end ? esc(longDay(membership.period_end)) : 'at the end of the period you have'}. `
      + 'Watch anything on this store before then and the next period starts building itself — the counter below '
      + `is that, not a joining fee. ${esc(LAPSE_LINE)}`
    : 'Two doors, and only one of them is money. The first is dues sent straight to the creator; the second is '
      + 'views on this store’s own files, and the price is the platform’s.'}</p>
  </div>
  ${doors.dues && !inRoom ? `<p class="small"><strong>With dues.</strong> ${esc(MONEY_LINE)}
    <a href="/s/${esc(channel.slug)}#join">Send the reference →</a></p>` : ''}
  ${/* The watching door renders its own lead-in, its own counter and its own money
       sentence — the room used to add a second copy of the first two, which is what a
       screenshot of this page caught: the same fact stated twice, one line apart. */
    doors.attention ? watchingDoor({ channel, tier: roomTier, standing, user, membership, price, wide: true }) : ''}
  ${membershipsOn ? '' : `<p class="fine">${esc(FREE_PLAN_LINE)}</p>`}
</div>`,
  });
}

/**
 * The watching door, as one control, used by the storefront's tier cards and by the
 * member room.
 *
 * One function because the three states it has to get right are exactly the states
 * two copies would drift apart on:
 *
 *   * a visitor who is not signed in gets a way in that does not need a page of
 *     explanation first;
 *   * somebody with no membership reads where they stand against the price;
 *   * and a MEMBER reads the same counter as a NEXT period rather than as a joining
 *     fee — which is what the button does for them, because `joinByAttention`
 *     extends an active membership instead of refusing it. A member's own tier is
 *     the only door that renders for them: pressing a lower tier's door would be
 *     answered with the membership they already hold, and an upgrade is a dues
 *     decision, not a watching one.
 */
function watchingDoor({ channel, tier, standing = 0, user, membership = null, price = null, wide = false }) {
  if (!tier) return '';
  const cost = price ?? attentionProgress({ tier, standing });
  const state = membershipState(membership);
  const holds = state === 'active' && Number(membership.tier_no) === Number(tier.tier_no);
  // A member of another tier does not see this door at all.
  if (state === 'active' && !holds) return '';
  const size = wide ? 'btn btn-primary btn-sm' : 'btn btn-sm';
  const button = (label, disabled) => `<form method="post" action="/s/${esc(channel.slug)}/join/watching"${wide ? ' style="margin-top:var(--space-2)"' : ''}>
    <input type="hidden" name="tier" value="${esc(String(tier.tier_no))}">
    <button class="${size}${cost.ready ? ' btn-primary' : ''}" type="submit"${disabled ? ' disabled' : ''}>${label}</button>
  </form>`;
  return `
      <div class="tier-watching">
        <p class="small" style="margin:0"><strong>${holds ? 'Another period' : 'Or join by watching'}.</strong>
          ${esc(attentionLine(tier))}</p>
        ${user
    ? `<p class="fine" style="margin-top:var(--space-2)">${esc(holds
      ? attentionBankedLine({ tier, standing })
      : attentionStandingLine({ tier, standing }))}</p>
        ${cost.ready
      ? button(holds ? 'Add another period by watching' : 'Join by watching', false)
      : button(`${cost.short} more view${cost.short === 1 ? '' : 's'} to go`, true)}
        <p class="fine" style="margin-top:var(--space-2)">${esc(ATTENTION_MONEY_LINE)}</p>`
    : `<a class="btn btn-sm" href="/login?next=${encodeURIComponent(`/s/${channel.slug}#join`)}">Sign in to join by watching</a>`}
      </div>`;
}

/**
 * The whole members section for a storefront: roster, your own card, the panel.
 *
 * Rendered for every store that has tiers, whether or not the viewer is signed
 * in — a locked thing people can see is a shop window, and the researched lesson
 * from every paywall is that the teaser is never the thing behind the wall.
 */
function membersSection({
  channel, user, tiers, membership, roster, membershipsOn, assets = [], standing = 0, flash = null,
}) {
  if (!tiers.length) return '';
  const named = roster.filter((m) => m.profile_id !== user?.id);
  return `<section class="section" id="members">
  <div class="section-head">
    <h2>Members</h2>
    <p>${named.length === 1 ? 'One person is named here' : `${named.length} people are named here`} — they chose it.
      Two different things are on each row, and they come from two different places: the <strong>chip</strong> is this
      store’s own colour for the tier that person holds, and a member’s <strong>name</strong> may wear a look they
      bought from bytebikri, which shows the same way on every page in the product. Dues go straight to the creator;
      bytebikri takes nothing.</p>
  </div>
  ${flash ? `<div class="note note-${flash.kind === 'danger' ? 'warning' : 'success'}" role="status">${esc(flash.message)}</div>` : ''}
  ${memberRoster(named)}
  ${membership ? myMembershipCard({ channel, membership, tiers, rosterSize: named.length, standing }) : ''}
  ${membershipsOn ? joinPanel({ channel, user, tiers, membership, assets, standing }) : ''}
</section>`;
}

export function storefront({
  channel, assets, slots, user, estimate, pageviews, unlockedIds = new Set(), consent = null,
  moderation = null, countryBlocked = null, verification = null, watching = false,
  // Memberships: what the store offers, what this viewer holds, who is named, and
  // whether the plan includes the feature at all. Empty tiers means the section
  // is not rendered — a store that does not use this looks exactly as it did.
  tiers = [], membership = null, roster = [], membershipsOn = false, memberFlash = null,
  standing = 0,
  // Layer S at the level of the SHOP rather than of a member: what plan this store
  // is on. A paid store's own header says so, in the same restrained vocabulary as
  // the member chips — a shop that shouts over its own goods is a worse shop.
  plan = null,
  // The store's chosen look. `themeStyle` is three custom properties rather than a
  // class per theme, so a new palette is one entry in `themes.js` and no stylesheet
  // change — and the band it paints sits behind text this module already colours,
  // which is what keeps contrast the same question it was before themes existed.
  theme = null, themeStyle = '',
  // The store's plan may take our name off its own shop window. Decided by the server
  // from the plan, passed in rather than re-derived here: one reader of a capability is
  // how the pricing page and the page it prices stay in agreement.
  plainFooter = false,
}) {
  const cards = assets.map((a) => {
    // A `breaks` file is open too — the door does not charge. What it adds is the
    // ask inside it, which the card states the same way an ad-gated card states
    // the door's price: the cost is visible before the click, always.
    const breaksMode = a.unlock_mode === 'breaks';
    const open = a.unlock_mode === 'open' || breaksMode;
    const unlocked = open || (user && unlockedIds.has(a.id));
    // A listed file the viewer cannot unlock does not get an unlock badge — it
    // gets the reason. The badge is the one place a card can lie, and "Ad-gated"
    // on a file that refuses every unlock is the lie this round removed.
    // A members-only file is still LISTED, locked, with what it takes to open it.
    // Hiding it would leave the storefront with nothing to sell, which is the
    // mistake every paywall study warns about: the wall goes on the content, not
    // on the shop window.
    const membersOnly = a.unlock_mode === 'members';
    const needsTier = membersOnly ? (Number(a.member_tier) || 1) : 0;
    const tierLabel = membersOnly
      ? (tierByNo(tiers, needsTier)?.name || defaultTierName(needsTier))
      : null;
    const badge = a.availability && !a.availability.unlockable
      ? pill(a.availability.state === 'blocked' ? 'Not here' : 'Listed, no unlock', 'warning')
      : membersOnly
        ? (unlocked ? pill('Open to you', 'success') : pill('Members', 'accent'))
        : open
          ? (breaksMode ? pill('Free · a break inside', 'success') : pill('Free', 'success'))
          : unlocked ? pill('Unlocked', 'success') : pill('Ad-gated', 'locked');
    const foot = a.availability && !a.availability.unlockable
      ? (a.availability.state === 'blocked' ? 'Not available in your country' : 'Listed, but not unlockable here')
      : membersOnly
        ? (unlocked ? 'Opens with your membership — no ad' : `${tierLabel} members open this — no ad`)
        : open ? 'No ad needed' : `${a.ads_required} ad${a.ads_required === 1 ? '' : 's'} to unlock`;
    const card = `<a class="asset" href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">
  <div style="position:relative">
    ${thumb({ title: a.title, coverUrl: a.cover_url })}
    <span class="thumb-badge">${badge}</span>
  </div>
  <div class="asset-body">
    <h3>${esc(a.title)}</h3>
    <p class="asset-desc">${esc(a.description || 'No description yet.')}</p>
    <div class="asset-foot">
      <span>${esc(shapeLabel(a.shape))} · ${plural((a.files || []).length, 'file')}</span>
      <span>${foot}</span>
    </div>
  </div>
</a>`;
    // The shape rides along with its card so the page can be grouped from the
    // one list it already has, rather than from a second list that could end up
    // disagreeing with what the card says. `a.shape` is set by the server; a
    // caller that does not set one gets the honest default — a file handed over.
    return { shape: a.shape || 'download', html: card };
  });

  // ── Sections, by shape ────────────────────────────────────────────────────
  //
  // A store with one kind of thing is laid out exactly as it was: one grid, no
  // headings, no chips. A control that changes nothing is noise, and the first
  // rule of progressive disclosure is that the initial display says what is
  // important — here, the store's own content.
  //
  // Two or more kinds get a heading per kind, ordered by how much the store
  // actually has of each (ties by the canonical order), and a chip row above
  // them. The chips are anchors first: without JavaScript they jump to their
  // section, which is why the markup works on its own.
  const counts = new Map();
  for (const c of cards) counts.set(c.shape, (counts.get(c.shape) || 0) + 1);
  const shapes = [...counts.keys()].sort((x, y) => counts.get(y) - counts.get(x)
    || SHAPE_ORDER.indexOf(x) - SHAPE_ORDER.indexOf(y));
  const many = shapes.length > 1;

  const chips = many
    ? `<div class="shape-chips">${shapes.map((shape) => `<a class="chip" href="#shape-${esc(shape)}" data-shape-chip="${esc(shape)}" aria-pressed="false">${esc(shapeLabel(shape))} <span class="chip-n">${counts.get(shape)}</span></a>`).join('')}</div>`
    : '';

  const grouped = shapes.map((shape) => `
  <div class="shape-group" id="shape-${esc(shape)}" data-shape-section="${esc(shape)}">
    ${many ? `<h3 class="shape-head">${esc(shapeLabel(shape))} <span class="chip-n">${counts.get(shape)}</span></h3>` : ''}
    <div class="grid-assets">${cards.filter((c) => c.shape === shape).map((c) => c.html).join('')}</div>
  </div>`).join('');

  const placed = placeSlots(slots);

  return layout({
    // A visitor looking at somebody else's shop window does not have a dashboard,
    // and the nav used to offer them one: every store page linked /dashboard/<slug>
    // to whoever was looking — including people with no account and sellers who do
    // not own this store. The link belongs to the owner, so it renders for the owner.
    title: channel.name, user, activeChannel: user && user.id === channel.owner_id ? channel : null, consent,
    reveal: true, plainFooter,
    body: `
${channel.banner_url
    ? `<div class="store-hero">
  <img class="store-banner" src="${esc(channel.banner_url)}" alt="" decoding="async">
</div>`
    : ''}
${moderation ? `<div class="section" style="margin-bottom:0">${moderationNotice(moderation, { heading: 'Only you can see this page right now' })}</div>` : ''}
${countryBlocked ? `<div class="section" style="margin-bottom:0">
  <div class="note note-warning" role="status">
    <strong>Visitors in ${esc(countryBlocked.country)} cannot open this store.</strong>
    ${esc(countryBlocked.why)}
    You can see it because it is yours — nothing was deleted, and the decision is recorded.
  </div>
</div>` : ''}

<div class="section store-head${theme ? ` store-head--themed` : ''}"${themeStyle ? ` style="${esc(themeStyle)}"` : ''}>
  <div class="row">
    ${storeMark(channel)}
    <h1>${esc(channel.name)}</h1>
    ${channel.listing_mode === 'marketplace'
      ? pill('In Explore', 'accent')
      : pill('Shared by link')}
    ${verifiedBadge(verification)}
    ${planMark(plan)}
  </div>
  <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || 'A store on ByteBikri.')}</p>
  <div class="store-meta">
    <span>${plural(assets.length, 'item')} published</span>
    <span class="dot" aria-hidden="true">·</span>
    <span>${plural(pageviews, 'view')} in the last 30 days</span>
  </div>
  ${verifiedSentence(verification)}
  ${watchControl({ channel, user, watching })}
</div>

${placed.head}

<section class="section">
  <div class="section-head">
    <h2>Content</h2>
    <p>One ad each. The network pays the creator directly.</p>
  </div>
  ${assets.length ? `${chips}${grouped}`
    : '<div class="empty">This store has not published anything yet.</div>'}
</section>


${membersSection({ channel, user, tiers, membership, roster, membershipsOn, assets, standing, flash: memberFlash })}

${placed.mid}
${placed.foot}`,
  });
}

/**
 * Handing a document over, while a check is open.
 *
 * Three states and each one is a different sentence, because a person who has just
 * sent a photo of their citizenship needs to know exactly one thing: what happens
 * to it now. Held → destroyed when a person decides, and after the week either way.
 * Destroyed with the request still open → hand it over again. No request → ask
 * first, and the button that opens the ask is above this.
 *
 * The copy does not say "we take security seriously" and it does not promise
 * something we cannot do. It says where the file goes, who can open it, that every
 * open is written down, and what is removed before it is even stored — which is the
 * only honest kind of promise a small platform can make about somebody's identity.
 */
function documentBlock({ channel, pendingRequest, openRequest }) {
  if (!pendingRequest) return '';
  const held = pendingRequest.document_key;
  const destroyedAt = pendingRequest.document_destroyed_at;
  const kinds = Object.values(ALLOWED_TYPES).map((t) => t.label.replace(/ (photo|image)$/, '')).join(', ');
  const mb = Math.round(MAX_BYTES / 1024 / 1024);

  if (held) {
    return `<div class="note note-info" role="status" style="margin-top:var(--space-4)">
      <strong>A copy is with us, waiting for a person to look at it.</strong>
      You handed it over ${relTime(pendingRequest.document_added_at)}. It is destroyed the moment somebody
      records an outcome, and in ${HOLD_DAYS} days whether or not they got to it.
      ${Number(pendingRequest.opens) ? `<span class="fine">It has been opened ${plural(Number(pendingRequest.opens), 'time')} by
      a person on the console — every open is written down with their name on it.</span>` : '<span class="fine">Nobody has opened it yet.</span>'}
      <span class="fine">The camera's own notes — where you were, which phone it was, the time — were removed
      before it was stored, so what is on disk is the picture and nothing else.</span>
      <span class="fine">The limit of what any of this can promise: a person looking at a screen can photograph
      that screen. What we control is that only named people can open it, and that every open is written down.</span>
    </div>
    <form method="post" action="/dashboard/${esc(channel.slug)}/verification/document"
          enctype="multipart/form-data" style="margin-top:var(--space-4)">
      <div class="field">
        <label for="v-doc-again">Sent the wrong page?</label>
        <input class="input" id="v-doc-again" type="file" name="document" accept="${Object.keys(ALLOWED_TYPES).join(',')}" required>
        <span class="hint">Sending another one destroys this one first. ${kinds}, up to ${mb} MB.</span>
      </div>
      <button class="btn btn-sm" type="submit">Replace it</button>
    </form>`;
  }

  const again = destroyedAt
    ? `<p class="small">The copy you handed over ${relTime(destroyedAt)} has been destroyed. Nothing of it is left —
       not the file, not a thumbnail, not a number from it. Hand another one over if the request is still open.</p>`
    : `<p class="small">Nobody has seen a document for this request yet. Hand one over here and a person on the
       console opens it; or show it to somebody in person, which is the same check.</p>`;

  return `<div class="note" role="status" style="margin-top:var(--space-4)">
    <strong>${destroyedAt ? 'The copy is gone.' : 'Hand the document over here, if you would rather not wait for a person.'}</strong>
    ${again}
  </div>
  <form method="post" action="/dashboard/${esc(channel.slug)}/verification/document"
        enctype="multipart/form-data" style="margin-top:var(--space-4)">
    <div class="field">
      <label for="v-doc">A photo of the document</label>
      <input class="input" id="v-doc" type="file" name="document" accept="${Object.keys(ALLOWED_TYPES).join(',')}" required>
      <span class="hint">${kinds} — a photo taken with the phone camera is exactly right, up to ${mb} MB.</span>
    </div>
    <div class="panel panel-body" style="margin-bottom:var(--space-4)">
      <ul class="list-plain">
        <li>Only the people on the console who decide checks can open it, and <strong>every open is written down
          with the name of the person who opened it</strong>.</li>
        <li>The camera's own notes — where you were, which phone it was, the time — are <strong>removed before the
          file is stored</strong>. Nobody here needs to know where you stood.</li>
        <li>It is destroyed the moment somebody records an outcome, and in ${HOLD_DAYS} days either way. Nothing of
          it is kept: not the file, not a thumbnail, not a number printed on it.</li>
        <li>The record keeps the outcome — what was checked, the date, and who decided it. That is all the badge
          has ever claimed.</li>
      </ul>
      <p class="fine" style="margin-top:var(--space-3)">What this cannot promise: a person looking at a screen can
      photograph that screen. The controls here are that only named people can open it and that every open is
      recorded, which is why the log matters more than the lock.</p>
    </div>
    <button class="btn btn-primary" type="submit">Hand it over</button>
    <span class="fine">${openRequest ? '' : ''}</span>
  </form>`;
}

// ---------------------------------------------------------------------------
// Following a store, and the library it puts things on
// ---------------------------------------------------------------------------
//  Two things a buyer holds and could not see anywhere: the files they have
//  unlocked, and how long each one stays open.
//
//  An unlock here is a WINDOW, not a purchase — 24 hours by default, and the
//  seller chooses — paid for with an ad rather than money. So the page is not a
//  receipt and not a download list; it is a shelf with timers on it, which is the
//  shape Hoopla and Kanopy arrived at for borrowed films, and why their shelves
//  lead with what is still open and say when it closes.
//
//  The stores half is the audit's own missing line — "Following a store: absent"
//  — and it is deliberately the smaller half. A follow here cannot promise to
//  tell anybody anything, because nothing in this product sends mail to a buyer:
//  it keeps a store on the shelf and counts what appeared since this person last
//  looked. Substack's help centre is the cautionary tale (it still has to explain
//  that a follower gets no email), so the copy says what following does and does
//  not do, at the button and again on this page.
// ---------------------------------------------------------------------------

/**
 * The two decisions the download route makes, made here too.
 *
 * The shelf must not offer a file that route would refuse, and the order is the
 * order a person checks: is my window still open, and is the file still up. A
 * file the store paused keeps its row — the unlock happened, and a shelf that
 * quietly drops it makes the person wonder what they did wrong.
 */
const unlockState = (u) =>
  !u.open ? (u.revoked_at ? 'taken' : 'ended')
    : (u.asset_status === 'live' && !u.hidden_by_reports) ? 'open' : 'down';

/** `24 Aug, 21:04` — the same shape the asset page's access line uses. */
const atTime = (d) => new Date(d).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

const starsOf = (n) =>
  `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;

/**
 * Follow, or stop following, on the store it is about.
 *
 * Three cases, and the two silences are decisions:
 *   - the owner sees nothing. Following your own shop is a bookmark to a page
 *     you can already reach, and a control that changes nothing teaches people
 *     that the buttons here do nothing;
 *   - a signed-out visitor sees nothing. The shop window is not the place to
 *     sell an account, and the library page explains where follows come from;
 *   - a signed-in buyer gets one small button and one honest sentence, because
 *     the word "follow" is read as a promise to tell you about new files, and
 *     nothing here can make that promise.
 */
function watchControl({ channel, user, watching }) {
  if (!user || user.id === channel.owner_id) return '';
  const action = watching ? 'unfollow' : 'watch';
  const note = watching
    ? 'It is on your <a href="/library">library</a> shelf. Nothing is emailed — the count waits for you there.'
    : 'New files are counted on your <a href="/library">library</a> shelf. Nothing is emailed.';
  return `<form class="watch-form" method="post" action="/s/${esc(channel.slug)}/${action}">
    ${watching
      ? `${pill('Following', 'success')}<button class="btn btn-sm btn-ghost" type="submit">Stop following</button>`
      : '<button class="btn btn-sm" type="submit">Follow this store</button>'}
    <span class="fine">${note}</span>
  </form>`;
}

/**
 * One row of the shelf: what it is, whose store it is, and where the window
 * stands. Four states rather than two, because "not open" is three different
 * facts and each deserves its own sentence and its own way out.
 */
function unlockRow(u) {
  const state = unlockState(u);
  const href = `/s/${esc(u.channel_slug)}/a/${esc(u.asset_slug)}`;
  const title = state === 'down'
    ? `<strong>${esc(u.title)}</strong>`
    : `<a href="${href}">${esc(u.title)}</a>`;

  const stateCell = {
    open: `${pill(u.expires_at ? 'Open' : 'Free', 'success')}
      <span class="fine">${u.expires_at ? `Until ${esc(atTime(u.expires_at))}` : 'No window — free to everyone'}</span>`,
    ended: `${pill('Ended')}
      <span class="fine">The window closed ${relTime(u.expires_at)}</span>
      <a class="btn btn-sm" href="${href}">Unlock it again</a>`,
    taken: `${pill('Taken back', 'warning')}
      <span class="fine">This one was taken back. The record stays here.</span>`,
    down: `${pill('File taken down', 'warning')}
      <span class="fine">The store took this file down after you unlocked it. Your unlock is still recorded.</span>`,
  }[state];

  const review = u.review_rating
    ? `<span class="fine">You rated it ${starsOf(u.review_rating)}</span>`
    : state === 'open' ? `<a class="fine" href="${href}">Say what you thought</a>` : '';

  return `<li class="shelf-row">
  <div class="shelf-what">
    ${title}
    <span class="fine">${esc(u.channel_name)} · unlocked ${relTime(u.granted_at)}</span>
  </div>
  <div class="shelf-state">${stateCell}${review ? `<span class="shelf-extra">${review}</span>` : ''}</div>
</li>`;
}

/** A followed store, with the one derived number that makes following useful. */
function followedCard(c) {
  const n = Number(c.new_count) || 0;
  return `<article class="card">
  <div class="row">
    <h3 style="margin:0;font-size:var(--text-md)"><a href="/s/${esc(c.slug)}">${esc(c.name)}</a></h3>
    <span class="spacer"></span>
    ${n ? pill(n === 1 ? '1 new file' : `${num(n)} new files`, 'accent') : ''}
  </div>
  <p class="small" style="margin:var(--space-2) 0">${esc(c.tagline || 'A store on ByteBikri.')}</p>
  <div class="row-tight fine">
    <span>${plural(c.live_count || 0, 'file')} live</span>
    <span>·</span>
    <span>${n ? `you last looked ${relTime(c.seen_at)}` : 'nothing new since you last looked'}</span>
  </div>
  <form method="post" action="/library/unfollow/${esc(c.slug)}" style="margin-top:var(--space-3)">
    <button class="btn btn-sm btn-ghost" type="submit">Stop following</button>
  </form>
</article>`;
}

/**
 * The library.
 *
 * Two lists and a shelf, in the order a person needs them: what is open now,
 * what has ended (with the way back in), and the stores being watched. Nothing
 * on this page carries a price, because nothing on this page was bought from
 * bytebikri — an unlock is an ad, and the network pays the creator directly.
 *
 * The headline prints the account's own totals, computed from the same columns
 * the rows use, so a cap on how many rows are drawn can never make the page read
 * as if files had gone missing.
 */
/**
 * THE HEAD OF A PAGE THAT IS YOURS.
 *
 * The same box the storefront's band is (`store-head`), wearing the person's own palette
 * instead of a store's theme — a second recipe for the same component, with its own
 * measured bound (`OWN_BAND_MIX`, proved in `plus.test.js`).
 *
 * Two rules are worth stating where the markup is, because both are easy to get wrong
 * later: this renders on pages that belong to the person and on NO store's page, and it
 * is absent — the plain head, exactly as it was — for anybody who is not wearing a look.
 * A band that appeared for everybody would be a lie about what paying bought.
 */
function ownBand({ user, title, lede, note = '' }) {
  const band = personBand(user);
  const style = `${band ? band.style : ''}margin-bottom:0`;
  return `
<div class="section${band ? ' own-band own-band--themed' : ''}" style="${esc(style)}">
  <h1>${esc(title)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">${lede}</p>
  ${band ? `<p class="fine">${esc(`${band.paletteLabel} · ${band.effectLabel} — ${OWN_BAND_LINE}`)}</p>` : ''}
  ${note}
</div>`;
}

export function library({ user, consent = null, unlocks = [], counts = {}, shelf = [], unwatched = null,
  // The person's own store, when they have one. A seller reading their library is
  // one click from their dashboard everywhere else in the product, and losing that
  // link on this page would make the shelf a dead end for exactly the people who
  // run shops.
  channel = null, error = null }) {
  const open = unlocks.filter((u) => unlockState(u) === 'open');
  const closed = unlocks.filter((u) => unlockState(u) !== 'open');
  const all = Number(counts.all) || unlocks.length;
  const openCount = Number(counts.open) || open.length;
  const cut = Math.max(all - unlocks.length, 0);

  const headline = openCount
    ? `<strong>${plural(openCount, 'file')} open to you right now</strong>, out of the ${plural(all, 'file')} you have unlocked here.`
    : all
      ? `Nothing is open to you right now. You have unlocked ${plural(all, 'file')} here — the ones that ended are below, and any of them can be opened again.`
      : '';

  const errorNote = error === 'no-store'
    ? `<div class="note note-danger" role="alert"><strong>That store is not here.</strong>
         The link may be old, or the store may have moved to another address. Nothing changed on your shelf.</div>`
    : '';

  return layout({
    title: 'Library', user, current: 'library', activeChannel: channel, consent,
    body: `
${ownBand({
    user,
    title: 'Your library',
    lede: `Everything you have unlocked, and the stores you follow.
  An unlock is a window, not a purchase: you watch an ad, the network pays the creator directly, and
  bytebikri takes no cut of it. Nothing here has a price.`,
  })}
  ${headline ? `<p style="margin-top:var(--space-3)">${headline}</p>` : ''}
</div>

${errorNote}
${unwatched ? `<div class="note note-info" role="status">
  <strong>${esc(unwatched)} is off your shelf.</strong>
  <form method="post" action="/library/follow/${esc(unwatched)}" style="display:inline;margin-left:var(--space-3)">
    <button class="btn btn-sm" type="submit">Follow it again</button>
  </form>
</div>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Open now</h2>
    <p>${open.length ? 'These are yours to open this minute.' : 'Nothing here at the moment.'}</p>
  </div>
  ${open.length ? `<ul class="shelf-list">${open.map(unlockRow).join('')}</ul>`
    : all
      ? `<div class="empty">Everything you unlocked has run out for now. Any of the files below can be
           unlocked again — it takes one ad.</div>`
      : `<div class="empty">You have not unlocked anything yet. Every file on this site is one ad away —
           <a href="/marketplace">have a look at the listed stores</a>.</div>`}
  ${cut ? `<p class="fine">Showing the ${num(unlocks.length)} most recent of your ${plural(all, 'unlock')}, open ones first.</p>` : ''}
</section>

${closed.length ? `<section class="section">
  <div class="section-head">
    <h2>Ended</h2>
    <p>${plural(closed.length, 'file')} whose window has closed. Nothing is lost — the store still has them,
      and unlocking again costs one ad.</p>
  </div>
  <ul class="shelf-list">${closed.map(unlockRow).join('')}</ul>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Stores you follow</h2>
    <p>Following keeps a store here and counts what appeared since you last looked at it. It does not email
      or ping you — this product sends buyers no notifications, so a count on this page is the whole promise.</p>
  </div>
  ${shelf.length
    ? `<div class="grid-channels">${shelf.map(followedCard).join('')}</div>`
    : `<div class="empty">You are not following any store yet. Open a store you like — the button sits under its
         name on the store page — and it will wait for you here.</div>`}
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Asset page
// ---------------------------------------------------------------------------

/**
 * The player, and the honest note that goes under it.
 *
 * A video that is offered as a download link is a video that will be on a file
 * host by the evening. A player is not a protection either — a screen recorder
 * records a browser as easily as anything else — but it changes what the page
 * IS: content you watch, not a file you take. What the mark underneath does is
 * make a copy traceable, and the note says exactly that, because a product that
 * claims to be un-copyable and is not is worse than one that never claimed it.
 */
function mediaStage({ previewFile, markUri, coverUrl, title, unlocked, needsAd, slug, assetSlug, lockedReason = null, assetId = null, gate = null }) {
  // `data-asset-id` is what lets the player tell the server how long the file is
  // when its metadata loads (slice 3: placement needs a measured runtime, and the
  // player is the only component that has one).
  //
  // `data-cues` is the break gate: the seconds a `breaks` file stops at, computed
  // by the server's planner and never by the client. The player knows where to
  // pause; it does not decide whether it may move on — that answer comes back from
  // the network's postback through `data-break-url`.
  const gateAttr = gate && gate.cues?.length
    ? ` data-cues="${esc(JSON.stringify(gate.cues))}" data-break-url="${esc(gate.breakUrl)}"`
    : '';
  const frame = (inner, kind) => `
    <figure class="stage stage-${kind}"${kind === 'image' ? '' : ' data-protect'}${assetId ? ` data-asset-id="${esc(assetId)}"` : ''}${gateAttr}>
      ${inner}
      ${kind === 'image' ? '' : `<div class="stage-mark" style="background-image:url('${esc(markUri)}')" aria-hidden="true"></div>`}
    </figure>`;

  if (!unlocked) {
    const cover = coverUrl
      ? `<img src="${esc(coverUrl)}" alt="" decoding="async">`
      : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
    return `
    <div class="stage stage-locked">
      ${cover}
      <div class="stage-veil">
        <span class="locked-glyph" aria-hidden="true">🔒</span>
        <p class="small">${esc(lockedReason || (needsAd ? 'Unlocks after the ad' : 'Not unlocked yet'))}</p>
      </div>
    </div>`;
  }

  if (previewFile?.playable && previewFile.streamUrl) {
    const poster = coverUrl ? ` poster="${esc(coverUrl)}"` : '';
    const src = esc(previewFile.streamUrl);
    return previewFile.kind === 'audio'
      ? frame(`
        <div class="audio-shell">
          <span class="audio-glyph" aria-hidden="true">♪</span>
          <div class="audio-body">
            <p class="audio-name">${esc(previewFile.filename)}</p>
            <audio controls preload="metadata" controlslist="nodownload noplaybackrate" src="${src}"></audio>
          </div>
        </div>`, 'audio')
      : frame(`
        <video controls playsinline preload="metadata"${poster}
               controlslist="nodownload noplaybackrate noremoteplayback"
               disablepictureinpicture disableremoteplayback
               src="${src}"></video>`, 'video');
  }

  if (previewFile?.marked && previewFile.streamUrl) {
    return frame(`<img src="${esc(previewFile.streamUrl)}" alt="" decoding="async">`, 'image');
  }

  const cover = coverUrl
    ? `<img src="${esc(coverUrl)}" alt="" decoding="async">`
    : `<span class="thumb-glyph" aria-hidden="true">${esc(glyph(title))}</span>`;
  return `<div class="stage">${cover}</div>`;
}

/**
 * The live player (§14).
 *
 * A stream is the one surface where the platform holds no bytes: the URL is the
 * store's, the browser fetches it from the store's host, and nothing about it passes
 * through here. The stage says that plainly, because the alternative — a player that
 * looks like every other player — invites the assumption that we stand behind the
 * stream the way we stand behind a file we store.
 *
 * The element ships with a plain `src`, so a browser that plays HLS natively (Safari,
 * macOS and iOS) needs no script at all. The client attaches hls.js only where the
 * browser cannot, which is Chrome, Firefox, Edge and Android — the vendored copy under
 * `scriptSrc 'self'`, never a CDN.
 *
 * `data-stop` is the one break this viewer has not been served yet, straight from
 * `liveState()`. It is a fact the server computed, not a decision the page makes: the
 * page has no way to invent a break, which is the whole point of the shape.
 */
function liveStage({ url, state, cleanEntry, stateUrl, viewUrl, pollSeconds, markUri, coverUrl, title, assetId, storeName = '' }) {
  const stop = state?.stop ? esc(JSON.stringify(state.stop)) : '';
  return `
    <div class="live" data-live data-asset-id="${esc(assetId)}" data-url="${esc(url || '')}"
         data-state-url="${esc(stateUrl)}" data-view-url="${esc(viewUrl)}"
         data-poll-seconds="${esc(String(pollSeconds || 15))}" data-stop="${stop}">
      <figure class="stage stage-live" data-protect data-asset-id="${esc(assetId)}">
        <video controls playsinline preload="metadata"${coverUrl ? ` poster="${esc(coverUrl)}"` : ''}
               controlslist="nodownload noplaybackrate noremoteplayback"
               disablepictureinpicture disableremoteplayback
               src="${esc(url || '')}"></video>
        <div class="stage-mark" style="background-image:url('${esc(markUri)}')" aria-hidden="true"></div>
        <span class="live-badge">Live</span>
      </figure>
      <p class="small live-owner">${esc(title)} is being streamed by ${esc(storeName || 'the store')} from their own
        host. Nothing about it is recorded here, and a break comes back at the live edge — a stream does not wait,
        so there is no rewind past what you missed. Press play to join it, at the edge rather than at the start.</p>
      ${cleanEntry ? `<p class="small live-door">${esc(cleanEntry)}</p>` : ''}
      <p class="fine" data-live-status role="status" aria-live="polite"></p>
    </div>`;
}

/** One line per file, saying what actually happens to it — no blanket promise. */
function fileTreatment(f) {
  if (f.playable) return { action: 'Plays here', note: 'no download offered' };
  if (f.kind === 'image') return { action: 'Download', note: 'your reference burned in' };
  return { action: 'Download', note: 'shown as a download' };
}

/**
 * Reviews, under the file.
 *
 * Only somebody who holds an unlock can write one, and the form is only
 * rendered for them — the server checks the same thing again, because a hidden
 * form is not a permission. The average is shown with its count, always: "4.8"
 * from two reviews and "4.8" from two hundred are different facts and the page
 * says which one it is.
 */
/**
 * Exported for the test that reads the reviewer's own plate: the review list is the third
 * surface a person's look travels to, and the assertion is about the markup a stranger
 * reads rather than about the helper in isolation.
 */
export function reviewSection({ channel, asset, reviews = [], reviewStats = {}, canReview, myReview, reviewError }) {
  const count = Number(reviewStats.count) || 0;
  const average = count ? Number(reviewStats.average).toFixed(1) : null;

  const list = reviews.length
    ? `<ul class="review-list">${reviews.map((r) => `
        <li class="review">
          <div class="review-head">
            <span class="stars" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            <span class="review-who">${reviewName(r)}</span>
            <span class="spacer"></span>
            <span class="fine">${relTime(r.created_at)}</span>
          </div>
          ${r.body ? `<p class="review-body">${esc(r.body)}</p>` : ''}
          ${r.seller_response ? `<div class="review-reply">
              <span class="fine">${esc(channel.name)} replied</span>
              <p>${esc(r.seller_response)}</p>
            </div>` : ''}
        </li>`).join('')}</ul>`
    : '<p class="fine">No reviews yet. They can only be written by somebody who unlocked the file.</p>';

  const form = myReview
    ? `<div class="note note-success">
         <strong>Your review is on the page.</strong>
         ${'★'.repeat(myReview.rating)}${'☆'.repeat(5 - myReview.rating)}
         <form method="post" action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/review"
               style="margin-top:var(--space-4)">
           <div class="field">
             <label for="rv-body">Change what you wrote</label>
             <textarea class="textarea" id="rv-body" name="body" rows="3" maxlength="2000">${esc(myReview.body || '')}</textarea>
           </div>
           <div class="rating-picker">
             ${[1, 2, 3, 4, 5].map((v) => `
               <label><input type="radio" name="rating" value="${v}" ${myReview.rating === v ? 'checked' : ''} required><span>${v}</span></label>`).join('')}
           </div>
           <button class="btn btn-sm" type="submit">Update review</button>
         </form>
       </div>`
    : canReview
      ? `<form class="review-write" method="post"
             action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/review">
           <h3>You unlocked this — what did you think?</h3>
           <div class="rating-picker">
             ${[1, 2, 3, 4, 5].map((v) => `
               <label><input type="radio" name="rating" value="${v}" required><span>${v}</span></label>`).join('')}
             <span class="fine" style="margin-left:var(--space-3)">1 is poor, 5 is what you hoped for.</span>
           </div>
           <textarea class="textarea" name="body" rows="3" maxlength="2000"
                     placeholder="Specific is useful: did the file match the description, was it what you needed?"></textarea>
           <button class="btn btn-primary btn-sm" type="submit">Post review</button>
         </form>`
      : '';

  return `<section class="section" style="margin-top:0">
    <div class="section-head">
      <h2>Reviews</h2>
      ${average
        ? `<p><strong>${average}</strong> from ${plural(count, 'review')}</p>`
        : '<p>Nobody has reviewed this yet</p>'}
    </div>
    ${reviewError ? `<div class="note note-danger">${esc(reviewError)}</div>` : ''}
    ${form}
    ${list}
  </section>`;
}

/**
 * The ad modal, once.
 *
 * It was written inside the file page, and the reader needs the same one: a gate in
 * a reader is the same verified view as a break in a player, and a second modal with
 * its own ids would be a second place for the countdown, the escape hatch and the
 * blocker hint to drift. Extracted rather than copied — the ids below are the
 * contract `app.js` is written against, and there is exactly one copy of them.
 *
 * `modalAsk` is the DOOR's ask (two ads of thirty seconds, and so on). A file that
 * carries breaks has no door ask to describe, so it passes null and the client fills
 * the line in with the break's own position instead.
 */
export function adModal({ modalAsk = null }) {
  return `<div class="modal" id="ad-modal" hidden role="dialog" aria-modal="true" aria-labelledby="ad-title">
  <div class="modal-card">
    <div class="row">
      <span class="pill pill-locked">Rewarded ad${modalAsk && modalAsk.ads > 1 ? ` · ${modalAsk.ads} ads` : ''}</span>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" id="ad-close" type="button" aria-label="Close">✕</button>
    </div>
    <h2 id="ad-title" style="margin-top:var(--space-4);font-size:var(--text-lg)">Your ad is playing</h2>
    ${modalAsk ? `<p class="small" style="margin-top:var(--space-2)">
      ${esc(askLabel(modalAsk))}<span id="ad-ask-tail">${modalAsk.ads > 1 ? '. The next one is asked for only if this one is credited.' : '.'}</span>
    </p>` : `<p class="small" style="margin-top:var(--space-2)"><span id="ad-ask-tail"></span></p>`}
    <p class="fine" id="ad-provider" style="margin-top:var(--space-1)"></p>
    <div class="ad-frame" style="margin-top:var(--space-5)">
      <div style="text-align:center">
        <div class="ad-count" id="ad-count">${Number(modalAsk?.seconds) || 15}</div>
        <div class="fine" style="margin-top:var(--space-2)">seconds remaining</div>
      </div>
      <div class="ad-progress" id="ad-progress"></div>
    </div>
    <p class="fine" style="margin-top:var(--space-4)" id="ad-note">
      The unlock is not granted by this screen. It arrives from the provider's server,
      signed, and is verified on our side before your access appears.
    </p>
    <!-- The polite half of the blocker policy, where a person is actually waiting for
         an ad: the ladder's rungs explain a FAILED attempt, and in a blocked browser
         that takes a minute and a half to happen. Empty until the frame opens; filled
         by app.js. It names no browser and accuses nobody, because the platform cannot
         tell a blocker from a bad connection and does not pretend to (src/blocked.js). -->
    <p class="fine" id="ad-hint" style="margin-top:var(--space-2)"></p>
  </div>
</div>`;
}

/**
 * "Something is wrong with this file."
 *
 * One link, not a form: the form appears when it is asked for, because a report
 * box sitting open under every download invites the casual click that the
 * threshold rule then has to absorb. `details`/`summary` does that with no
 * JavaScript at all — it works in the Android WebView, in a text browser, and
 * when the client script has not loaded.
 *
 * The reasons are a `<select>` of the codes in `src/reports.js`, and the copy
 * says out loud that one report does not remove anything. A report button that
 * implies instant action is a button that gets used to threaten people.
 *
 * Hidden from the owner (this is their file) and from signed-out visitors (the
 * route requires an account, so offering the form would be a lie).
 */
function reportBlock({ channel, asset, user, alreadyReported = false, reported = null }) {
  if (!user || user.id === channel.owner_id) return '';
  const option = (r, selected = false) =>
    `<option value="${esc(r.code)}"${selected ? ' selected' : ''}>${esc(r.label)}</option>`;

  if (reported) {
    return `<section class="section">
  <div class="note ${reported.hidden ? 'note-warning' : 'note-info'}" role="status">
    ${esc(reporterMessage({ reporters: reported.reporters, already: !reported.filed }))}
  </div>
</section>`;
  }

  return `<section class="section">
  <details class="report-block">
    <summary class="report-summary">
      Something wrong with this file?
      ${alreadyReported ? '<span class="pill">You reported it</span>' : ''}
    </summary>
    <form method="post" action="/s/${esc(channel.slug)}/a/${esc(asset.slug)}/report" class="report-form">
      <div class="field">
        <label for="report-reason">What is wrong</label>
        <select class="input" id="report-reason" name="reason">
          ${REPORT_REASONS.map((r) => option(r)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="report-note">Anything that would help <span class="fine">(optional)</span></label>
        <textarea class="input textarea" id="report-note" name="note" maxlength="${NOTE_LIMIT}"
                  placeholder="A link, a page number, a line — whatever made you stop and write this."></textarea>
      </div>
      <button class="btn" type="submit">Send the report</button>
      <p class="fine" style="margin-top:var(--space-3)">${esc(REPORT_HONESTY.long)}</p>
    </form>
  </details>
</section>`;
}

export function assetPage({
  channel, asset, files, unlocked, user, policy, slots, previewFile = null,
  // The stored ask, so the panel can say "2 ads of 30 seconds" rather than a bare
  // count. Decided on the server; the view only prints it.
  ask = null,
  // Where this viewer is on the blocker ladder, decided by the server from a count
  // of recorded signals. `offersUnlock: false` is the harsh end, and it is the only
  // rung that changes what is on the page — everything else is an explanation
  // beside the same button.
  blockRung = null,
  // Where this file's breaks sit (slice 3). Decided by the server through the same
  // planner the seller's page and the pipeline read; null for a shape with nowhere
  // inside it to put one.
  placement = null,
  // The break gate for a file that opens free and asks inside it: where the player
  // stops, and where it asks permission to move on. Null for every other mode,
  // because the cues are a description of what the player does.
  gate = null,
  // The page model, for a file a reader can open (§13): how many pages it has, what
  // order they are in, and what the reader's words for them are. Null for a shape
  // nobody turns pages in.
  pages = null,
  // Where this person stopped last time, so the page can offer "continue" rather than
  // making them find their place again. Private: it is only ever this person's.
  progress = null,
  // The live surface (§14) for a `stream`: the store's URL, the state the server
  // computed with `liveState()`, and the two endpoints the poller uses. Null for every
  // other shape — a live player on a file we store would be a player nothing can play.
  live = null,
  markUri = '', markLabel = '', accessUntil = null, consent = null,
  reviews = [], reviewStats = {}, canReview = false, myReview = null, reviewError = null,
  reported = null, alreadyReported = false, reportError = null,
  // A paid store's own file pages are part of its shop window, so they lose the
  // wordmark line with its storefront. Decided by the server from the plan; the view
  // never asks the database anything.
  plainFooter = false,
  // What this viewer is refused, and why — a country rule, or the file's own
  // state. Decided on the server (see src/geo.js and src/moderation.js) and
  // rendered here: the page never works out for itself who may do what.
  refusal = null,
  // Memberships on this file: the viewer's own coverage, the store's tiers, and
  // the name of the tier this file wants. Passed in rather than looked up,
  // because a view renders synchronously and decides nothing about access.
  memberCover = null,
  // 'covered' | 'ads' | 'members' | 'none', from `doorFor` in memberships.js.
  memberDoor = 'none',
  memberTierAdMode = 'ad_free',
  memberTiers = [],
  memberTierName = null,
  // One sentence for the owner when their file is not available to everyone.
  // The owner always sees the page; the sentence is the difference between
  // "somebody decided something about my file" and a support ticket.
  ownerNotice = null,
  // Set when the viewer is inside a blocked country and this file is open to
  // them only because an operator allowed it. Silence here reads as a broken
  // link one click away: the store link refuses, and nothing says why.
  carveOut = null,
}) {
  // A `breaks` file opens free too — the door does not charge. What differs is that
  // its player stops at the cues in `gate`, which is why the page says so above the
  // player rather than leaving it to be discovered.
  const breaksMode = asset.unlock_mode === 'breaks';
  const open = asset.unlock_mode === 'open' || breaksMode;
  const needsAd = !open && !unlocked;
  const media = Boolean(previewFile?.playable);

  const rows = files.map((f) => {
    const t = fileTreatment(f);
    return `
        <li class="dl-item">
          <span class="file-badge" aria-hidden="true">${esc((f.kind || 'file').slice(0, 4).toUpperCase())}</span>
          <span class="dl-body">
            <span class="dl-name">${esc(f.filename)}</span>
            <span class="dl-meta">${(f.size_bytes / 1024).toFixed(1)} KB · ${esc(f.mime_type || 'file')} · ${esc(t.note)}</span>
          </span>
          <span class="spacer"></span>
          ${f.playable
            // No download link for something that plays. This is the one line
            // that decides whether "it plays here" is true or a sentence with a
            // download button next to it.
            ? `<span class="pill pill-success">Plays above</span>`
            : f.downloadUrl
              ? `<a class="btn btn-sm btn-primary" href="${esc(f.downloadUrl)}" download>${esc(t.action)}</a>`
              : `<span class="pill pill-locked">${esc(t.action)}</span>`}
        </li>`;
  }).join('');

  const filesPanel = unlocked
    ? `<ul class="dl-list">${rows}</ul>
       <p class="fine" style="margin-top:var(--space-4)">
         Links are minted for your account, carry your reference, and expire.
         ${media ? 'Playback links stay valid for four hours so seeking works; a download link expires in ten minutes.' : ''}
         The file itself is re-checked against your unlock on every request, so a forwarded link is useless to anyone else.
       </p>`
    : `<div class="locked-panel">
         <div class="locked-glyph" aria-hidden="true">🔒</div>
         <p class="small" style="margin:var(--space-3) 0 0">
           ${media ? 'The player starts here once you unlock.' : 'The download appears here once you unlock.'}
         </p>
       </div>`;

  const markNote = !unlocked ? '' : media
    ? `<p class="fine mark-note">
         <strong>Watermark: on.</strong> Frames carry
         <span class="mono">${esc(markLabel || 'your account reference')}</span> overlaid while it plays,
         so a recording can be traced back to the account that watched it.
         No website can stop a screen recording, and this one does not pretend to:
         the app is where the operating system blocks it.
       </p>`
    : previewFile?.marked
      ? `<p class="fine mark-note">
           <strong>Watermark: burned in.</strong> The image is re-encoded with your account reference
           before it is sent, so a copy that turns up elsewhere still points back here.
         </p>`
      : '';

  /**
   * A refusal replaces the unlock affordance, and only that.
   *
   * The file's name, its description, its files and its reviews all stay: what is
   * refused is the unlock, in one country or for one reason, and a page that
   * disappeared entirely would tell the visitor less than the sentence does.
   */
  const refusalBlock = refusal
    ? `<div class="note note-warning" role="status">
         <strong>${esc(refusal.headline)}</strong>
         <p class="small" style="margin:var(--space-2) 0 0">${esc(refusal.why)}</p>
         ${refusal.appeal ? `<p class="fine" style="margin:var(--space-2) 0 0">${esc(refusal.appeal)}</p>` : ''}
       </div>${filesPanel}`
    : null;

  /**
   * Members-only files get a fourth affordance, and it is not a button that
   * charges anybody: it is a link to the join panel, with the tier named. The
   * money changes hands between two people, off this page, and pretending
   * otherwise here would be the one lie the whole product is built to avoid.
   */
  const membersOnly = asset.unlock_mode === 'members';
  const wantedTier = membersOnly ? (Number(asset.member_tier) || 1) : 0;
  const wantedName = memberTierName || defaultTierName(wantedTier);
  /*
   * A member of a `supporter` tier opening a members-only file.
   *
   * They are in — the file is theirs to open — but their tier deliberately kept the
   * ordinary asks, so what opens it is the same ad any other visitor watches. The
   * page says which of the two arrangements is in force rather than leaving them to
   * work out why a membership is being asked for a view.
   */
  const memberPaysAds = membersOnly && memberDoor === 'ads';
  const memberGate = `<div class="member-gate">
    <p class="small"><strong>${esc(wantedName)} members open this.</strong>
      ${esc(wantedTier === 2
    ? 'It is the top tier’s file.'
    : memberTierAdMode === 'supporter'
      ? 'Any member can open it, and this tier keeps the ordinary asks — a membership here is the belonging.'
      : 'Any member can open it — no ad, while the dues are current.')}</p>
    <a class="btn btn-primary btn-lg btn-block" href="/s/${esc(channel.slug)}#members">See what membership is</a>
    <p class="fine" style="margin-top:var(--space-3);text-align:center">${esc(MONEY_LINE)}</p>
  </div>`;

  /*
   * THE HARSH END OF THE LADDER, and how gentle it actually is.
   *
   * The platform has always withheld a file when no verified view arrived — that is
   * the pipeline working, not a punishment. What changes at this rung is that the
   * page stops offering the button and explains itself instead of offering an action
   * that has failed six times in a few hours.
   *
   * The listing, the description, the preview and every `open` file stay. A store's
   * membership route stays. Nothing is deleted, nothing is flagged on the account,
   * and the count ages out on its own. `NEVER_DO` in `src/blocked.js` is the list of
   * things that were considered and refused — a full-page interstitial above all.
   */
  const withheld = Boolean(blockRung && !blockRung.offersUnlock && needsAd && !membersOnly);
  // The rung's own copy (src/blocked.js) is the explanation. What is decided HERE is
  // the way out, and only the offer the store can actually honour: membership opens
  // the store's MEMBER files, not this one, so the button says what it is and the
  // sentence under it says what membership is — and neither is shown in a store that
  // sells no memberships at all, where the anchor would land on nothing.
  const withheldBlock = `
    <div class="note note-warning" role="status">
      <strong>${esc(blockRung?.headline || 'Not being offered for a while')}</strong>
      <p class="small" style="margin:var(--space-2) 0 0">${esc(blockRung?.body || '')}</p>
    </div>
    ${blockRung?.hasMembers ? `
    <a class="btn btn-lg btn-block" href="/s/${esc(channel.slug)}#members" style="margin-top:var(--space-4)">
      See what membership is
    </a>
    <p class="fine" style="margin-top:var(--space-3);text-align:center">
      Membership opens a store's member files — with no ad, unless the tier you pick keeps the ordinary
      asks, which its own card says before you join. The dues go straight to the creator; bytebikri never
      receives them. Membership does not open an ad-gated file sooner.
    </p>` : `
    <p class="fine" style="margin-top:var(--space-4);text-align:center">
      Waiting is the way back here: this store sells no memberships, and the pause lifts by itself.
    </p>`}`;

  /*
   * THE SENTENCE ABOUT BREAKS, and it is printed only where the player can keep it.
   *
   * `gate` is non-null exactly when the file's mode is `breaks`, the viewer can
   * actually open it, and the plan placed at least one cue — which is the same set
   * of conditions under which the client has a cue list to stop at. So the words
   * and the behaviour travel together, and neither can be shipped without the
   * other: a file that announced "it asks for one view while you watch, at 11:08"
   * without a player that stops there would be the same class of sentence slice 2
   * was written to close.
   */
  const breakLine = gate && !unlocked
    ? null
    : (pages && betweenCues(placement ?? {}).length
      ? readStopsSentence(pages, placement)
      : (gate ? breakSentence(placement) : null));
  /*
   * The way in, for a file this page cannot play.
   *
   * A read has no player, so before the reader existed its page offered a download
   * and nothing else — and a page count nobody had counted. This is the one control
   * the file page needs: start at the first page, or at the page this person stopped
   * on. It is rendered only when the person can actually open the file, because a
   * link to a reader that will redirect them back here is worse than no link.
   */
  const readerHref = `/s/${esc(channel.slug)}/a/${esc(asset.slug)}/read`;
  const readerBlock = pages && pages.chapters > 0 && (open || unlocked)
    ? `<div class="reader-offer">
         <a class="btn btn-primary btn-lg btn-block" href="${readerHref}${progress && Number(progress.step) > 1 ? `?p=${Number(progress.step)}` : ''}">
           ${progress && Number(progress.step) > 1
    ? `Continue reading — ${esc(stepLabel(pages, Number(progress.step)) || `page ${progress.step}`)}`
    : 'Start reading'}
         </a>
         <p class="fine" style="margin-top:var(--space-3);text-align:center">
           ${esc(plural(pages.chapters, 'page'))}${pages.refusals.length
    ? ` · ${esc(plural(pages.refusals.length, 'file'))} in this listing opens in your own app instead`
    : ''} · where you stop is remembered for you, and only for you.
         </p>
       </div>`
    : '';

  // Hoisted for the same reason `readStopsSentence` is a function: the sentence is
  // the page's promise, and the promise is printed only where the behaviour exists.
  void readerBlock;
  // What the ad modal describes. A `breaks` file's modal is about ONE view inside
  // the file, so the door's sentence ("2 ads of 45 seconds") would be wrong there —
  // the client fills this line in with the break's own position instead.
  const modalAsk = breaksMode ? null : ask;

  /*
   * The ordinary ask, as one block, so the two places that offer it cannot drift: a
   * member of a `supporter` tier gets exactly what a visitor to an ad-gated file
   * gets, and the only difference is one sentence above it saying why.
   */
  const watchBlock = `${blockRung && blockRung.key !== 'quiet' ? `<div class="note note-warning" role="status">
               <strong>${esc(blockRung.headline)}</strong>
               <p class="small" style="margin:var(--space-2) 0 0">${esc(blockRung.body)}</p>
             </div>` : ''}
         <button class="btn btn-primary btn-lg btn-block" id="unlock-btn"
                 data-asset="${esc(asset.id)}" data-signal-url="/api/unlock/blocked">
           Watch ${plural(policy?.ads_required || 1, 'ad')} to unlock
         </button>
         <p class="fine" style="margin-top:var(--space-3);text-align:center">
           About ${plural(policy?.ad_min_seconds || 15, 'second')}. The unlock is granted only when the ad network
           confirms server-to-server that the view completed.
         </p>
         <div id="unlock-status" class="fine" role="status" aria-live="polite"
              style="margin-top:var(--space-3);text-align:center"></div>`;

  /*
   * A live file's door, and the one case where the store opens it for a newcomer.
   *
   * `entry === 'covered'` means a break this store ran is paying for the door right
   * now, so the page must NOT draw the unlock button beside a stream that is already
   * playing — the two would contradict each other, and the contradiction would look
   * like a fault in the file rather than the trade it is. The sentence names the trade
   * (`cleanEntry`, computed from the same arithmetic the panel prints to the seller).
   */
  const liveCovered = Boolean(live && live.state?.entry === 'covered');
  const liveOpen = Boolean(live && live.state?.entry !== 'ask');
  const actionBlock = refusalBlock || (liveCovered
    ? `<div class="note note-success"><strong>No ad at the door.</strong> ${esc(live.cleanEntry || '')} A break
         buys clean entries for the people arriving after it, and this is your side of that trade.</div>`
    : open
    ? `<div class="note note-success">${breaksMode
    ? 'Free to open. No ad before it starts.'
    : 'Free — no ad needed.'}</div>${breakLine ? `<p class="small">${esc(breakLine)}</p>` : ''}${readerBlock}
       ${breaksMode ? `<div id="unlock-status" class="fine" role="status" aria-live="polite"
            style="margin-top:var(--space-3);text-align:center"></div>` : ''}${filesPanel}`
    : unlocked
      ? `<div class="note note-success"><strong>Unlocked.</strong>
           ${memberCover
    ? `This file is open through your <strong>${esc(memberTierName || wantedName)}</strong> membership, for as long as the period you have paid for runs${memberCover.period_end ? ` — ${plural(Math.max(daysLeft(memberCover.period_end) ?? 0, 0), 'day')} left` : ''}.`
    : accessExpiry(open ? null : accessUntil)}</div>${readerBlock}${filesPanel}`
      : memberPaysAds
        ? `<div class="note note-info"><strong>Your membership.</strong> This tier keeps the ordinary asks, so the same
             view opens this file as opens any other — the belonging is the roster, the member room, and the file being
             listed for you.</div>${watchBlock}`
        : membersOnly
          ? `${memberGate}${filesPanel}`
          : withheld
            // No `filesPanel` here on purpose: an ad-gated file that is still locked
            // never rendered its manifest, and the withheld rung must take away the
            // button rather than change anything else about the page. The manifest
            // arrives with the unlock, exactly as it does one rung earlier.
            ? withheldBlock
            : watchBlock);

  const kindLabel = { video: 'Video', audio: 'Audio', image: 'Image', file: 'File' }[previewFile?.kind] || null;
  const placed = placeSlots(slots);

  return layout({
    title: asset.title, user, activeChannel: user && user.id === channel.owner_id ? channel : null, consent,
    plainFooter,
    body: `
<a class="back-link" href="/s/${esc(channel.slug)}">← ${esc(channel.name)}</a>

<div class="asset-layout">
  <div class="stack stack-8">
    ${liveOpen ? liveStage({
      url: live.url, state: live.state, cleanEntry: live.cleanEntry,
      stateUrl: live.stateUrl, viewUrl: live.viewUrl, pollSeconds: live.pollSeconds,
      markUri, coverUrl: asset.cover_url, title: asset.title, assetId: asset.id, storeName: channel.name,
    }) : mediaStage({
      previewFile, markUri, coverUrl: asset.cover_url, title: asset.title, unlocked, needsAd, assetId: asset.id,
      gate,
      // The stage's own sentence. A members-only file behind an ad-shaped veil
      // reading "Unlocks after the ad" would be the page's one outright lie: no ad
      // opens this, and no amount of watching one will.
      lockedReason: membersOnly && !memberPaysAds ? `${wantedName} members open this — no ad` : null,
      slug: channel.slug, assetSlug: asset.slug,
    })}

    <div class="asset-head">
      <h1>${esc(asset.title)}</h1>
      ${live ? pill('Live', 'accent')
    : open ? pill('Free', 'success')
    : unlocked ? pill(memberCover ? 'Members' : 'Unlocked', 'success')
      : membersOnly ? pill(memberPaysAds ? 'Members · watch to open' : 'Members', 'accent')
        : pill('Ad-gated', 'locked')}
      ${user && user.id === channel.owner_id
    ? `<a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}">Edit this file</a>` : ''}
    </div>
    <p class="lede">${esc(asset.description || 'No description yet.')}</p>
    ${ownerNotice ? `<div class="note note-warning" style="margin-top:var(--space-5)" role="status">
      <strong>Not everyone sees this file.</strong> ${esc(ownerNotice)}
    </div>` : ''}
    ${carveOut ? `<div class="note" style="margin-top:var(--space-5)" role="status">
      <strong>This store is withheld where you are. This file is not.</strong> ${esc(carveOut)}
    </div>` : ''}
    ${markNote}
    ${live && !liveOpen ? `<p class="small live-ask">This is the store's own live stream, and the breaks on it
      are the store's to call. A break buys clean entries for the people arriving after it — and it stops everyone
      watching while it runs; playback comes back at the live edge, because a stream does not wait.</p>` : ''}

    ${placed.head}

    <div class="panel">
      <div class="panel-head"><h2>What you get</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Files</dt><dd>${plural(files.length, 'file')}</dd>
          ${live ? '<dt>Format</dt><dd>Live — the store\u2019s host serves it, and nothing is copied here</dd>'
    : kindLabel ? `<dt>Format</dt><dd>${esc(kindLabel)}${media ? ' — plays in the page' : ''}</dd>` : ''}
          <dt>Access</dt><dd>${open ? 'Free'
    : membersOnly
      ? (unlocked ? `Open to you as a ${esc(memberTierName || wantedName)}`
        : memberPaysAds ? `${esc(wantedName)} members — the ordinary ask`
          : `${esc(wantedName)} members — no ad`)
      : unlocked ? 'Unlocked' : plural(policy?.ads_required || 1, 'rewarded ad')}</dd>
          <dt>${membersOnly ? 'Open while' : 'Unlock lasts'}</dt><dd>${membersOnly
    ? 'the dues you have paid for are current'
    : plural(policy?.unlock_hours || 24, 'hour')}</dd>
          <dt>Store</dt><dd><a href="/s/${esc(channel.slug)}">${esc(channel.name)}</a></dd>
        </dl>
      </div>
    </div>

    ${reviewSection({ channel, asset, reviews, reviewStats, canReview, myReview, reviewError })}

    ${placed.mid}
    ${placed.foot}
  </div>

  <aside class="unlock-card">
    <div class="panel">
      <div class="panel-head"><h2 style="font-size:var(--text-md)">${unlocked || liveCovered ? 'Your access'
    : membersOnly ? 'Open to members' : 'Unlock this file'}</h2></div>
      <div class="panel-body">${actionBlock}</div>
    </div>
    <p class="fine" style="margin-top:var(--space-4)">
      ${user ? '' : `<a href="/login?next=${encodeURIComponent(`/s/${channel.slug}/a/${asset.slug}`)}">Sign in</a> first — unlocks are tied to your account.`}
    </p>
    ${needsAd ? `<p class="fine" style="margin-top:var(--space-3)">${esc(ASK_PROMISE)}</p>` : ''}
  </aside>
</div>

${reportError ? `<section class="section"><div class="note note-danger" role="alert">${esc(reportError)}</div></section>` : ''}
${reportBlock({ channel, asset, user, alreadyReported, reported })}

${adModal({ modalAsk })}`,
  });
}


/**
 * What a reader is going to ask, said in the reader's own words.
 *
 * `breakSentence` is the player's sentence and takes its nouns from the planner
 * ("after chapter 3"). A reader's own page turns in PAGES for a flat archive and in
 * chapters for a file-per-chapter set, and the page model is the only thing that knows
 * which — so the sentence is built from the same `gateSentence` the reader itself
 * prints, and the promise on the file page cannot drift from the gate behind the link.
 */
function readStopsSentence(pages, placement) {
  const stops = betweenCues(placement ?? {});
  if (!stops.length) return null;
  const where = stops.map((cue) => gateSentence(pages, cue)).join(' ');
  return `Free to open, and nothing before you start. ${where} `
    + 'The page turns when the ad network confirms the view, not when the countdown ends.';
}

/**
 * The reader — one page at a time, and the seam where a view is asked for.
 *
 * §13 is the design; this is the surface. Four things are deliberate here:
 *
 *   1. **The page is a server-rendered step.** Turning a page is a link, not a script:
 *      the reader works with JavaScript off, the browser's back button is a real back
 *      button, and a deep link to page 14 is a URL rather than a state machine. The
 *      script only adds what a link cannot do — the progress beacon, arrow keys, and
 *      the gate's verified view.
 *   2. **The gate is at the END of a segment**, never on a page: the last control of a
 *      segment is the ask, the first control of the next segment is a page turn. That is
 *      what "a gate is a seam" means in markup, and it is why the reader can say where
 *      it will stop before you start.
 *   3. **Scroll mode scrolls within its segment.** A webtoon is continuous, so the strip
 *      is continuous — up to the next seam, where the same gate stands. A continuous
 *      scroll that interrupted mid-strip would be the one thing every reader complains
 *      about.
 *   4. **An undrawable step still has a page.** A `.cbr` or an `.epub` gets one screen
 *      saying the reader does not draw it, with the file's own download control — the
 *      "download instead" override §5.2 promised, which is an override DOWN and never up.
 */
export function readerPage({
  channel, asset, user = null, label, mode = 'page', direction = 'ltr',
  // The steps rendered in this request: one for `page` mode, a strip for `scroll`.
  items = [],
  current = 1, total = 1,
  prevHref = null, nextHref = null,
  // The gate at the end of this segment, when the next step is past a seam this
  // person has not cleared. Null when there is nothing to ask for yet.
  gate = null,
  // Set when the step itself cannot be drawn: the sentence, and the file's URL.
  refusal = null,
  downloadUrl = null,
  // Set for a visitor with no account. Every page URL in this product is minted for
  // somebody, so the reader says so in the same breath as the file page does rather
  // than showing a page that cannot load.
  signin = null,
  // Where this person stopped last time, so the page can offer it. The reader never
  // asks twice: this is a link, not a redirect.
  resume = null,
  assetUrl = '/',
  flash = null,
}) {
  const rtl = direction === 'rtl';
  const turn = (href, word, arrow, primary = false) => (href
    ? `<a class="btn btn-sm${primary ? ' btn-primary' : ''}" href="${esc(href)}" rel="${word === 'Next' ? 'next' : 'prev'}">${rtl ? `${arrow} ${word}` : `${word} ${arrow}`}</a>`
    : `<span class="btn btn-sm btn-ghost" aria-disabled="true">${rtl ? `${arrow} ${word}` : `${word} ${arrow}`}</span>`);
  const prev = turn(prevHref, 'Previous', rtl ? '→' : '←');
  const next = turn(nextHref, 'Next', rtl ? '←' : '→', true);

  const strip = items.map((it) => (it.url
    ? `<figure class="reader-page">
         <img src="${esc(it.url)}" alt="${esc(it.alt || label)}"${mode === 'scroll' && it.n !== current ? ' loading="lazy" decoding="async"' : ' decoding="async"'}>
         <figcaption class="fine">${esc(it.caption || '')}</figcaption>
       </figure>`
    : `<figure class="reader-page reader-missing">
         <figcaption class="fine">${esc(it.caption || 'This page could not be opened.')}</figcaption>
       </figure>`)).join('');

  const gatePanel = gate
    ? `<div class="note note-warning reader-gate" role="status">
         <p><strong>${esc(gate.sentence || 'One view, then the next page.')}</strong></p>
         <p class="small" style="margin-top:var(--space-2)">
           ${gate.seconds ? `About ${gate.seconds} seconds. ` : ''}The page turns when the ad network confirms the view,
           not when the countdown ends — so this is one request to the network, and it is the same verified
           view that opens a file anywhere else here.
         </p>
         <p style="margin-top:var(--space-4)">
           <button class="btn btn-primary" type="button"
                   data-reader-gate data-cue-index="${Number(gate.cueIndex) || 0}"
                   data-break-url="${esc(gate.breakUrl || '/api/unlock/break')}"
                   data-asset-id="${esc(asset?.id || '')}"
                   data-next="${esc(gate.nextHref || '')}">Watch a view to continue</button>
           ${gate.nextHref ? `<a class="link-quiet" style="margin-left:var(--space-3)" href="${esc(assetUrl)}">Back to the file</a>` : ''}
         </p>
         <p class="fine" id="reader-gate-status" style="margin-top:var(--space-2)"></p>
       </div>`
    : '';

  const refused = refusal
    ? `<div class="note note-warning">
         <p>${esc(refusal.sentence)}</p>
         ${downloadUrl ? `<p style="margin-top:var(--space-3)"><a class="btn btn-sm btn-primary" href="${esc(downloadUrl)}" download>Download the file</a></p>` : ''}
       </div>`
    : '';

  const needSignIn = signin
    ? `<div class="note note-warning" role="status">
         <p><strong>Sign in to start reading.</strong></p>
         <p class="small" style="margin-top:var(--space-2)">
           Pages are minted for an account — that is how the reader knows whose bookmark to
           keep, and how a view inside a file is counted for the store that published it.
         </p>
         <p style="margin-top:var(--space-3)">
           <a class="btn btn-sm btn-primary" href="${esc(signin.href)}">Sign in</a>
         </p>
       </div>`
    : '';

  return `<div class="reader" data-reader data-reader-step="${Number(current) || 1}"
     data-asset-id="${esc(asset?.id || '')}"
     data-progress-url="/api/reading/progress"
     data-prev="${esc(prevHref || '')}" data-next="${esc(nextHref || '')}"
     data-direction="${esc(direction)}" data-mode="${esc(mode)}">
  <div class="section" style="padding-bottom:0">
    <div class="section-head">
      <h1>${esc(asset?.title || 'Reading')}</h1>
      <span class="spacer"></span>
      <span class="pill">${esc(label)}</span>
    </div>
    <p class="lede">
      ${esc(channel?.name || '')}${mode === 'scroll' ? ' · continuous scroll, stopped at the next seam' : ''}
      · <a href="${esc(assetUrl)}">the file page</a>
    </p>
    ${resume ? `<p class="fine">You stopped at ${esc(resume.label)}. <a href="${esc(resume.href)}">Continue there</a>.</p>` : ''}
    ${flashNote(flash)}
  </div>

  <div class="reader-stage" data-direction="${esc(direction)}">
    ${strip}
  </div>

  <div class="reader-bar">
    ${rtl ? next : prev}
    <span class="fine" role="status">${esc(label)}</span>
    ${rtl ? prev : next}
  </div>

  ${needSignIn}
  ${gatePanel}
  ${refused}
  ${adModal({ modalAsk: null })}
</div>`;
}

/**
 * A file that is open to this viewer only because an operator allowed it back.
 *
 * The store as a whole is withheld where they are and this one file is not —
 * because an operator read it and decided the rule did not fit it. Without a
 * sentence the visitor gets a normal-looking page, follows the store's name, and
 * lands on a refusal that reads as the site breaking. One line makes it the
 * decision it is: the rule is about the store, this file was exempted from it,
 * and an exemption is a person's call rather than an accident.
 */
export function carriedByCarveOut({ resolved, country = null, rule = null, store = null }) {
  if (!resolved?.carveOut || !country) return null;
  const title = rule?.title ? ` under “${rule.title}”` : '';
  return `${store || 'This store'} is not available in ${countryIn(country)}${title}. `
    + 'An operator allowed this one file back, so it opens for you — one file against a store-wide rule.';
}

/**
 * What this viewer is refused, and why — a country rule, or the file's own
 * state.
/**
 * The page a visitor gets when a country rule applies to them.
 *
 * 404 was the wrong answer here, and the schema's own vocabulary says why: a
 * REMOVED store answers 404 because confirming that it exists is information
 * nobody decided to publish. A country rule is the opposite — a decision
 * somebody stands behind, addressed to a visitor who is owed a reason. The
 * status code follows the source (451 for a rule, 403 for a creator's own
 * licence; see `blockStatus` in src/geo.js), and this page is what makes the
 * code legible: what happened, why, and who to ask.
 *
 * It says one more thing out loud that a block page usually hides: the rule
 * follows the COUNTRY the request came from, not the person. Saying that is not
 * a loophole, it is the truth, and a visitor who is told the truth does not file
 * a bug against a platform that looks broken.
 */
export function countryBlocked({ user = null, sentence, country = null, store = null, asset = null, consent = null }) {
  const back = store
    ? `<a class="back-link" href="/s/${esc(store.slug)}">← ${esc(store.name)}</a>`
    : '<a class="back-link" href="/">← Explore</a>';

  return layout({
    title: sentence.headline, user, consent,
    body: `
${back}

<div class="section" style="max-width:62ch">
  <span class="pill pill-warning">Not available${country ? ` in ${esc(countryIn(country))}` : ''}</span>
  <h1 style="margin-top:var(--space-4)">${esc(sentence.headline)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">${esc(sentence.why)}</p>
  ${sentence.appeal ? `<p class="small" style="margin-top:var(--space-3)">${esc(sentence.appeal)}</p>` : ''}

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head"><h2 style="font-size:var(--text-md)">Why this is about where you are, not who you are</h2></div>
    <div class="panel-body">
      <p class="small" style="margin:0">
        We read the country from the network the request arrived over, and we apply the rule to
        that country. Nothing is recorded about you beyond that, and nothing about this decision
        follows you to another country.
      </p>
      ${store?.channel_contact ? `<p class="small" style="margin:var(--space-3) 0 0">
        The store's own contact: <span class="mono">${esc(store.channel_contact)}</span>
      </p>` : ''}
    </div>
  </div>

  ${asset ? `<p class="fine" style="margin-top:var(--space-5)">
    ${esc(asset.title)} is one file. The rest of ${esc(store?.name || 'the store')} may be available to you.
  </p>` : ''}
</div>`,
  });
}

/**
 * How long this viewer's access lasts.
 *
 * A sentence about the entitlement, not about the asset: a free file has no
 * expiry at all, and an ad-unlocked one expires in the number of hours the
 * seller set. The old version read a column off the asset, which is a different
 * thing, and announced "permanent access" on 24-hour unlocks.
 */
function accessExpiry(until) {
  if (!until) return ' No expiry — this one is free.';
  return ` Access until ${new Date(until).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })}.`;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * The page for an address that does not exist.
 *
 * Express's default is a bare `<pre>Cannot GET /x</pre>` with no header, no
 * footer, no way back and no idea what this site is — which is what a person sees
 * when they mistype a store, follow a dead link, or open a file that was paused.
 * It is the one page that appears when something has already gone wrong, so it is
 * the wrong place to make somebody feel lost.
 *
 * It does two useful things beyond saying sorry: it offers the search that
 * actually exists, and it points at the marketplace. It deliberately does NOT
 * echo the requested path back into the page — a 404 that reflects the URL is a
 * reflected-XSS with extra steps, and the browser already shows the address.
 */
/**
 * The page a rate limit shows a person.
 *
 * Modelled on what the limit actually is: a wait, a reason, and no accusation. A
 * shared office address, a phone on a train, a person who mistyped their password
 * twice — all of those are ordinary, and none of them deserve a page that reads
 * like an incident. It also names the wait in minutes rather than seconds, because
 * "try again in 900s" is a puzzle and "about 15 minutes" is an instruction.
 */
export function tooMany({ user = null, consent = null, retryAfter = 60, what = 'requests', max = 0, windowMs = 60_000 }) {
  const minutes = Math.ceil(retryAfter / 60);
  const wait = minutes <= 1 ? 'about a minute' : `about ${minutes} minutes`;
  const windowMinutes = Math.round(windowMs / 60_000);
  const per = windowMinutes >= 60
    ? `${Math.round(windowMinutes / 60)} hour${windowMinutes >= 120 ? 's' : ''}`
    : `${windowMinutes} minute${windowMinutes === 1 ? '' : 's'}`;
  return layout({
    title: 'Slow down', user, consent, current: null,
    // A panel, not `.empty`: this is not an empty state, it is an answer, and three
    // paragraphs of prose centred on a wide screen read ragged from both edges.
    body: `
<section class="section">
  <div class="panel" style="max-width:64ch">
    <div class="panel-body">
      <h1 style="font-size:var(--text-2xl)">Too many ${esc(what)}</h1>
      <p style="margin-top:var(--space-4)">
        This address has made more than ${num(max)} ${esc(what)} in the last ${esc(per)}, so the next one
        is being refused. Try again in ${esc(wait)}.
      </p>
      <p class="fine" style="margin-top:var(--space-4)">
        Nothing is broken and nothing has been lost. If you are signing in and this followed a few
        mistyped passwords, your password is unchanged — waiting is the whole fix. If several people
        share this connection, someone else may have used the allowance.
      </p>
      <p class="fine" style="margin-top:var(--space-4)">
        The limit exists because a password is guessable and a script can guess quickly. It is per
        address, it counts successes as well as failures, and it lifts on its own.
      </p>
      <p style="margin-top:var(--space-5)">
        <a class="btn" href="/">Back to ByteBikri</a>
      </p>
    </div>
  </div>
</section>`,
  });
}

export function notFound({ user = null, consent = null, requestedKind = null }) {
  const kind = requestedKind === 'store'
    ? 'That store is not here'
    : requestedKind === 'file' ? 'That file is not here' : 'That page is not here';

  return layout({
    title: 'Not found', user, consent, current: null,
    body: `
<div class="section" style="margin-bottom:0">
  <p class="pill pill-warning" style="display:inline-flex">Error 404</p>
  <h1 style="margin-top:var(--space-4)">${esc(kind)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">
    Nothing is stored at this address. A store that was removed returns this page on purpose —
    byte for byte the same as a store that never existed, so the address itself cannot be used to
    find out whether something used to be there.
  </p>
  <div class="row" style="margin-top:var(--space-6);gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-primary" href="/marketplace">Browse stores</a>
    <a class="btn" href="/">Home</a>
  </div>
</div>

<section class="section">
  <div class="section-head">
    <h2>If you were looking for a file</h2>
    <p>A file link expires and is minted per person, so a link from somebody else will not work for you — and a link you were given a while ago may simply have run out. Open the store and unlock it again.</p>
  </div>
  <form class="search" method="get" action="/marketplace" role="search">
    <label class="sr-only" for="nf-q">Search stores</label>
    <input class="input" id="nf-q" name="q" type="search" placeholder="Search stores — name, tagline or file">
    <button class="btn" type="submit">Search</button>
  </form>
</section>`,
  });
}

/**
 * The page for a failure we did not anticipate.
 *
 * The error handler used to answer a browser with JSON — `{"ok":false,"error":
 * "internal error"}` rendered as text in a tab — because the only clients it was
 * written for were API callers. A person who hits a bug should get a page that
 * says a page failed, not a serialised object. API clients still get JSON, by
 * content negotiation, and in production the message never carries the stack.
 */
export function serverError({ user = null, consent = null, requestId = null }) {
  return layout({
    title: 'Something broke', user, consent, current: null,
    body: `
<div class="section" style="margin-bottom:0">
  <p class="pill pill-danger" style="display:inline-flex">Error 500</p>
  <h1 style="margin-top:var(--space-4)">Something broke on our side</h1>
  <p class="lede" style="margin-top:var(--space-3)">
    The request failed while we were handling it. Nothing you did caused it, and nothing was
    charged: there is no charge to make. Money that moves here moves by a bank or wallet transfer
    that a person matches by hand, so a failed page cannot take any.
  </p>
  ${requestId ? `<p class="fine" style="margin-top:var(--space-4)">
    If you report this, quote <span class="mono">${esc(requestId)}</span> — it is the only thing that
    lets us find the failure in the log.</p>` : ''}
  <div class="row" style="margin-top:var(--space-6);gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-primary" href="/">Home</a>
    <a class="btn" href="javascript:history.back()">Go back</a>
  </div>
</div>`,
  });
}

/**
 * Forgot password: the request.
 *
 * One field, one button, and a sentence that does not accuse anybody. The
 * response to this form is identical whether or not the address has an account —
 * the page after it says so in words, because a form that says "check your inbox"
 * for one address and "no such account" for another is a free way to find out
 * which of your colleague's addresses are registered here.
 */
export function forgotPassword({ user = null, consent = null, sent = false, email = '', consentNote = null }) {
  return layout({
    title: 'Reset your password', user, consent,
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">${sent ? 'Check your email' : 'Reset your password'}</h1>

  ${sent ? `
  <div class="note note-info" style="margin-top:var(--space-5)">
    If <strong>${esc(email)}</strong> has an account here, a link is on its way. It is good for one use
    and expires in an hour.
  </div>
  <p class="small" style="margin-top:var(--space-5)">
    This page says the same thing whether or not that address is registered, and that is deliberate:
    a form that answers "no such account" is a way to test which email addresses belong to people here.
    If nothing arrives, the address may have a typo, the message may be in spam, or there may be no
    account — and the fix for all three is the same, which is to try again.
  </p>
  <p class="small">
    Nothing has changed about your password yet. The link only opens a form; the password changes when
    you choose a new one.
  </p>
  <p class="auth-switch" style="margin-top:var(--space-6)">
    <a class="btn btn-sm" href="/forgot">Try a different address</a>
    <a class="btn btn-sm" href="/login" style="margin-left:var(--space-2)">Back to sign in</a>
  </p>`
    : `
  <p class="small" style="margin-top:var(--space-3)">
    Enter the address you signed up with and we will send a link that lets you choose a new password.
  </p>

  <form method="post" action="/forgot" class="card card-pad-lg" style="margin-top:var(--space-5)">
    <div class="field">
      <label for="email">Email</label>
      <input class="input" id="email" name="email" type="email" required autocomplete="email"
             value="${esc(email)}" placeholder="you@example.com">
    </div>
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:var(--space-2)" type="submit">
      Send the link
    </button>
  </form>

  <p class="small" style="margin-top:var(--space-5)">
    The link works once and expires in an hour. Opening it signs you out on your other devices, because
    a reset is what you do when you think somebody else has your account.
  </p>
  ${consentNote || ''}
  <p class="auth-switch" style="margin-top:var(--space-6)"><a href="/login">Back to sign in</a></p>`}
</div>`,
  });
}

/**
 * The reset form — and the page a dead link gets.
 *
 * Neither renders the cookie banner, and the reason generalises to every page
 * whose URL carries a one-time token: the banner posts the current URL back to
 * itself as `next`, which writes the token into the page's markup. The URL is the
 * secret and it is already in the right hands; the markup is a copy of it that
 * survives in screenshots, in a page-source view, in anything that reads the DOM,
 * and in the Referer of any request the page ever makes to another origin.
 *
 * An earlier version kept the banner on the LIVE page only, on the argument that
 * answering it lands the person back on the form they were reading. That was a
 * real benefit and a bad rule: "no token in markup, except here" is a rule with a
 * hole in it, and the benefit is nil — the banner is still there on the page the
 * person lands on after the reset (`/?reset=1`), so nothing is skipped, it is
 * only asked somewhere the answer cannot be written next to a credential.
 *
 * Expired, already used, never existed, and tampered with all render THIS page,
 * byte for byte, with the same sentence. Telling the four apart helps exactly one
 * party, and it is not the account holder: somebody holding a stolen link learns
 * whether it is worth another guess, and somebody holding a discarded one learns
 * which addresses are registered here. The person who needs the page cannot act
 * on the difference — in every case the answer is a new link — so the page does
 * not offer one, and there is no parameter that could be passed to make it.
 */
export function resetPassword({ user = null, token = '', error = null }) {
  if (!token) {
    return layout({
      title: 'Reset link', user, consent: null,
      body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">That link cannot be used</h1>
  <div class="note note-warning" style="margin-top:var(--space-5)">
    <strong>That link cannot be used.</strong>
    It may have expired, it may have been used already, it may have been replaced by a newer one, or
    it may never have worked. Links last an hour and work once, and asking for a new one cancels the
    old one — so those four cases look the same here on purpose, because the answer to all four is
    the same.
  </div>
  <p class="small" style="margin-top:var(--space-5)">
    Nothing has gone wrong with your account. Your current password still works, and a new link takes
    a moment to request.
  </p>
  <p class="auth-switch" style="margin-top:var(--space-6)">
    <a class="btn btn-primary" href="/forgot">Send a new link</a>
    <a class="btn btn-sm" href="/login" style="margin-left:var(--space-2)">Back to sign in</a>
  </p>
</div>`,
    });
  }

  return layout({
    title: 'Choose a new password', user, consent: null,
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">Choose a new password</h1>
  <p class="small" style="margin-top:var(--space-3)">
    You are signed out everywhere else the moment you save this.
  </p>

  ${error ? `<div class="note note-danger" style="margin-top:var(--space-5)" role="alert">${esc(error)}</div>` : ''}

  <form method="post" action="/reset/${esc(token)}" class="card card-pad-lg" style="margin-top:var(--space-5)">
    <div class="field">
      <label for="password">New password</label>
      <input class="input" id="password" name="password" type="password" required
             autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}"
             placeholder="At least ${MIN_PASSWORD_LENGTH} characters">
      <span class="hint">${MIN_PASSWORD_LENGTH} characters minimum. Length matters more than symbols.</span>
    </div>
    <div class="field">
      <label for="password2">Again</label>
      <input class="input" id="password2" name="password2" type="password" required
             autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}">
      <span class="hint">Typed twice so a keyboard slip cannot lock you out of an account you just recovered.</span>
    </div>
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:var(--space-2)" type="submit">
      Save and sign in
    </button>
  </form>
</div>`,
  });
}

/**
 * /verify — the one page that explains the state of an address.
 *
 * It has to answer four things without being asked, because each one is a
 * support message otherwise: is my address confirmed, when did you last send
 * something, did that message actually leave, and what do I do if I typed the
 * address wrong. The last one is a form, not a sentence — "contact us" is not an
 * answer for somebody whose account is attached to an address they cannot read.
 */
export function verify({
  user, state = null, flash = null, changed = false, error = null, next = '/',
}) {
  const confirmed = Boolean(state?.email_verified_at);
  const sent = state?.last_sent_at ? relTime(state.last_sent_at) : null;
  // A past delivery failure is only worth showing while somebody is still
  // waiting. Once the address is confirmed it is history: the message that
  // matters arrived, and telling a person about an old failure they have already
  // worked around is noise dressed up as honesty.
  const failed = !confirmed && Number(state?.failed_deliveries || 0) > 0;

  const shown = {
    flash: flash || (changed ? 'Address changed. A link is on its way to the new one, and the old address has been told.' : null),
    error: error === 'shape' ? 'That does not look like an email address.'
      : error === 'taken' ? 'Another account already uses that address. If it is yours, sign in to it — or ask the operator to help.'
        : error === 'same' ? 'That is already the address on this account.'
          : error === 'too-often' ? 'A link has just gone out. Give it a few minutes before asking for another.'
            : error === 'throttled' ? 'Too many requests from this connection. Try again shortly.'
              : null,
  };

  return layout({
    title: confirmed ? 'Address confirmed' : 'Confirm your email address', user, consent: null,
    current: 'verify',
    body: `
<div class="section auth-card" style="margin-top:var(--space-10)">
  <h1 style="font-size:var(--text-2xl)">${confirmed ? 'Your address is confirmed' : 'Confirm your email address'}</h1>

  ${shown.flash ? `<div class="note note-info" style="margin-top:var(--space-5)" role="status">${esc(shown.flash)}</div>` : ''}
  ${shown.error ? `<div class="note note-danger" style="margin-top:var(--space-5)" role="alert">${esc(shown.error)}</div>` : ''}

  <div class="panel" style="margin-top:var(--space-5)"><div class="panel-body">
    <dl class="kv">
      <dt>Address</dt><dd><span class="mono">${esc(state?.email || user.email)}</span></dd>
      <dt>Status</dt><dd>${confirmed
    ? `<span class="pill pill-success">confirmed</span> <span class="fine">· ${esc(isoDay(state.email_verified_at))}</span>`
    : '<span class="pill pill-warning">not confirmed</span>'}</dd>
      <dt>Links sent</dt><dd>${num(state?.links_sent || 0)}${sent ? ` <span class="fine">· the most recent ${esc(sent)}</span>` : ''}</dd>
      ${failed ? `<dt>Delivery</dt><dd><span class="pill pill-danger">a message failed</span>
        <span class="fine">${esc(state?.last_error || '')}</span></dd>` : ''}
    </dl>
  </div></div>

  ${confirmed ? `
  <p class="small" style="margin-top:var(--space-5)">
    Nothing to do. This is the address every receipt, invoice and notice goes to, and the one a
    reset link can reach. Changing it is below.
  </p>` : `
  <p class="small" style="margin-top:var(--space-5)">
    We sent a link that works once and lasts 48 hours. Confirming it does not sign you in anywhere —
    it only means the platform knows somebody reads mail at this address. Until then everything works
    except handing us money: a plan payment needs an address we can send a receipt to and reach a
    person at, because an operator matches those transfers by hand.
  </p>
  ${failed ? `<p class="small">The last message did not leave our side, so asking again is the right move — the
    failure is recorded here rather than being something you have to guess at.</p>` : ''}
  <form method="post" action="/verify" style="margin-top:var(--space-5)">
    <button class="btn btn-primary" type="submit">Send the link again</button>
    <p class="fine" style="margin-top:var(--space-3)">The newest link is always the one that works.</p>
  </form>`}

  <div class="section-head" style="margin-top:var(--space-8)">
    <h2 style="font-size:var(--text-md)">${confirmed ? 'Move to a different address' : 'Typed it wrong?'}</h2>
    <p>${confirmed
    ? 'The new address has to confirm, and the old one is told either way.'
    : 'Change it here and the link goes to the new one — you do not need to be able to read the old address.'}</p>
  </div>
  <form method="post" action="/verify/address" class="card card-pad-lg">
    <div class="field">
      <label for="new-email">New address</label>
      <input class="input" id="new-email" name="email" type="email" required autocomplete="email"
             placeholder="you@example.com">
      <span class="hint">We email this address to confirm it, and we tell the old address what happened.</span>
    </div>
    <button class="btn" type="submit">Use this address</button>
  </form>

  <p class="auth-switch" style="margin-top:var(--space-6)"><a href="${esc(next)}">Back to the site</a></p>
</div>`,
  });
}

/**
 * Where a confirmation link lands.
 *
 * Three outcomes, and the dead one is deliberately the same page for expired,
 * already-used, invented and tampered-with links: telling those apart helps only
 * whoever is holding a link that is not theirs. It renders without the cookie
 * banner, like the reset dead end, so no token is echoed into the markup.
 */
/**
 * The page a confirmation link opens.
 *
 * It has a button, and the button is the point. Mail providers, security scanners
 * and link-preview bots fetch every URL in a message, so a GET that spent the
 * token would mark addresses confirmed that no person ever opened — the exact
 * opposite of the evidence this flow exists to collect, and worse, it would fail
 * silently and look like success. So the GET inspects and renders, and only the
 * POST spends.
 *
 * That has a second benefit worth naming: the form's action is this same URL, so
 * the token never appears in the page's markup at all — not in an action, not in
 * a hidden field. The word "confirm" is the only thing on the page that is not
 * navigation.
 */
export function verifyConfirm({ user = null }) {
  return layout({
    title: 'Confirm your email address', user, consent: null, current: 'verify',
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">Confirm this address</h1>
  <p class="small" style="margin-top:var(--space-3)">
    One click, and it works once. Confirming proves somebody reads mail here — it does
    <strong>not</strong> sign you in, so a link opened on a shared computer confirms the address and
    nothing else.
  </p>
  <form method="post" action="" class="card card-pad-lg" style="margin-top:var(--space-6)">
    <button class="btn btn-primary btn-lg" style="width:100%" type="submit">Confirm this address</button>
  </form>
  <p class="auth-switch" style="margin-top:var(--space-6)"><a href="/">Back to the site</a></p>
</div>`,
  });
}

/**
 * Where a confirmation link lands, once it has been clicked.
 *
 * The dead outcome is one page for expired, already-used, invented and
 * tampered-with links, and it renders without the cookie banner for the same
 * reason every token route does: the banner would write the URL into the markup.
 * The two outcomes that are NOT dead say what changed and what did not, because
 * "confirmed" by itself invites the question "and signed in as whom?".
 */
export function verifyResult({ user = null, outcome = 'dead', email = null }) {
  const body = outcome === 'confirmed' ? {
    title: 'Address confirmed',
    note: `<strong>${esc(email || 'Your address')} is confirmed.</strong> Everything on ByteBikri is
      open to you now, including a plan payment — the receipt, the matching note and any dispute all go
      to an address somebody has answered.`,
    extra: `Confirming does not sign you in, and this page shows nothing about the account the address
      belongs to — which is why it is safe to open one on a machine that is not yours.`,
  } : outcome === 'already' ? {
    title: 'Already confirmed',
    note: '<strong>This address was already confirmed.</strong> Nothing was changed, and nothing needed to be.',
    extra: `If you did not expect this, sign in and look at the address on the account: moving it is one
      form, and the address being left behind is told when it happens.`,
  } : {
    title: 'That link cannot be used',
    note: `<strong>That link cannot be used.</strong> Confirmation links work once and last 48 hours, and
      asking for a new one replaces the old one — so those cases look the same here on purpose, because
      the answer to all of them is the same.`,
    extra: `A new link goes to whichever address is on the account you are signed in to, and it takes a
      moment to arrive.`,
  };

  return layout({
    title: body.title, user, consent: null,
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">${esc(body.title)}</h1>
  <div class="note ${outcome === 'dead' ? 'note-warning' : 'note-success'}" style="margin-top:var(--space-5)">
    ${body.note}
  </div>
  <p class="small" style="margin-top:var(--space-5)">${body.extra}</p>
  <p class="auth-switch" style="margin-top:var(--space-6)">
    ${outcome === 'dead'
    ? '<a class="btn btn-primary" href="/verify">Send a new link</a><a class="btn btn-sm" href="/" style="margin-left:var(--space-2)">Back to the site</a>'
    : '<a class="btn btn-primary" href="/">Back to the site</a>'}
  </p>
</div>`,
  });
}

export function login({ user, error, next = '', email = '', mode = 'login', consent = null }) {
  const isSignup = mode === 'signup';
  const action = isSignup ? '/signup' : '/login';
  return layout({
    title: isSignup ? 'Open a store' : 'Sign in', user, consent,
    body: `
<div class="section auth-card" style="margin-top:var(--space-12)">
  <h1 style="font-size:var(--text-2xl)">${isSignup ? 'Open your store' : 'Sign in'}</h1>
  <p class="small" style="margin-top:var(--space-3)">
    ${isSignup
      ? 'You keep your own ad accounts and your own earnings. ByteBikri takes no cut of them.'
      : 'Welcome back.'}
  </p>

  ${error ? `<div class="note note-danger" style="margin-top:var(--space-5)" role="alert">${esc(error)}</div>` : ''}

  <form method="post" action="${action}" class="card card-pad-lg" style="margin-top:var(--space-5)">
    <input type="hidden" name="next" value="${esc(next)}">
    <div class="field">
      <label for="email">Email</label>
      <input class="input" id="email" name="email" type="email" required
             autocomplete="email" value="${esc(email)}" placeholder="you@example.com">
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input class="input" id="password" name="password" type="password" required
             autocomplete="${isSignup ? 'new-password' : 'current-password'}"
             minlength="${isSignup ? MIN_PASSWORD_LENGTH : 1}"
             placeholder="${isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}">
      ${isSignup ? `<span class="hint">${MIN_PASSWORD_LENGTH} characters minimum. Length matters more than symbols.</span>` : ''}
    </div>
    ${isSignup ? '' : `
    <label class="check">
      <input type="checkbox" name="remember" value="on" checked>
      <span>Keep me signed in on this device</span>
    </label>`}
    ${isSignup ? `
    <div class="field">
      <label for="display_name">Display name</label>
      <input class="input" id="display_name" name="display_name" autocomplete="nickname" placeholder="Your name or studio">
    </div>
    <div class="field">
      <label for="channel_name">Store name <span class="muted">(optional)</span></label>
      <input class="input" id="channel_name" name="channel" placeholder="e.g. Himalayan Type">
      <span class="hint">You can add more stores later. Names do not have to be unique.</span>
    </div>` : ''}
    <button class="btn btn-primary btn-lg" style="width:100%;margin-top:var(--space-2)" type="submit">
      ${isSignup ? 'Create account' : 'Sign in'}
    </button>
  </form>

  <p class="auth-switch">
    ${isSignup
      ? 'Already have an account? <a href="/login">Sign in</a>'
      : 'No account yet? <a href="/signup">Open a store</a>'}
  </p>
  ${isSignup ? '' : '<p class="auth-switch" style="margin-top:var(--space-2)"><a href="/forgot">Forgot your password?</a></p>'}
</div>`,
  });
}

/**
 * The operator's moderation queue.
 *
 * Deliberately plain, and deliberately not a report queue: nothing here tells an
 * operator WHICH store to look at, because a seller-report button is a separate
 * feature with its own design. What this page does is make the mechanism
 * reachable, so `moderation_state` stops being a column nobody sets.
 *
 * The form is a real form — no JavaScript, and the reason is a `<select>` of the
 * rule codes the database actually has, so a typo cannot become a rule that does
 * not exist.
 */
export function adminModeration({
  user, rows, rules, actions = [], labels = {}, flash = null, consent = null,
  // Files that need a decision, every country where something is blocked, the
  // stores withheld from a country, and the channel list the add-form offers.
  files = [], countries = [], storeBlocks = [], channels = [], limits = [],
}) {
  const rulesByCode = new Map(rules.map((r) => [r.code, r]));
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');

  const row = (c) => `
  <div class="panel moderation-row" style="margin-top:var(--space-5)">
    <div class="panel-head">
      <a href="/s/${esc(c.slug)}"><strong>${esc(c.name)}</strong></a>
      <span class="fine">/s/${esc(c.slug)}</span>
      <span class="spacer"></span>
      ${pill(c.moderation_state, stateTone(c.moderation_state))}
    </div>
    <div class="panel-body">
      <p class="small" style="margin:0">
        ${c.owner_name ? `${esc(c.owner_name)} · ` : ''}${esc(c.owner_email || 'no email on file')}
        · opened ${esc(relTime(c.created_at))}
      </p>
      ${c.moderation_reason ? `<p class="fine" style="margin:var(--space-2) 0 0">
        Last cited rule: <span class="mono">${esc(c.moderation_reason)}</span>
        ${rulesByCode.get(c.moderation_reason) ? ` — ${esc(rulesByCode.get(c.moderation_reason).title)}` : ' (not a rule this platform has)'}
      </p>` : ''}

      <form method="post" action="/admin/moderation/${esc(c.slug)}" style="margin-top:var(--space-4)">
        <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap">
          <div class="field" style="flex:1 1 180px">
            <label for="a-${esc(c.slug)}">Action</label>
            <select class="input" id="a-${esc(c.slug)}" name="action">
              ${actions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2 1 260px">
            <label for="r-${esc(c.slug)}">Reason</label>
            <select class="input" id="r-${esc(c.slug)}" name="ruleCode">
              <option value="">— none cited —</option>
              ${options(c.moderation_reason)}
            </select>
          </div>
        </div>
        <div class="field" style="margin-top:var(--space-4)">
          <label for="m-${esc(c.slug)}">What should the seller do?</label>
          <input class="input" id="m-${esc(c.slug)}" name="remedy" maxlength="280"
                 placeholder="One line, in your own words. They read this and nothing else.">
          <span class="hint">Up to 280 characters. It is shown to the owner with the rule's own wording.</span>
        </div>
        <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Record decision</button>
      </form>
    </div>
  </div>`;

  // A file in the queue is not a file with a wrong state; it may be a file whose
  // state is fine and whose availability is not. The row says which, because
  // "approved + blocked in two countries" is the case this queue was built for.
  const fileRow = (f) => `
  <a class="queue-row" href="/admin/moderation/files/${esc(f.id)}">
    <span class="queue-count">${f.moderation_state === 'approved' ? '·' : '!'}</span>
    <span class="queue-body">
      <strong>${esc(f.title)}</strong>
      <span class="fine">${esc(f.channel_name)} · ${esc(f.owner_email || 'no email on file')}
        ${f.country_summary ? ` · <span class="mono">${esc(f.country_summary)}</span>` : ''}</span>
    </span>
    <span class="spacer"></span>
    ${pill(f.moderation_state, stateTone(f.moderation_state))}
    <span class="fine">${esc(relTime(f.decided_at || f.created_at))}</span>
  </a>`;

  /**
   * "1 file blocked" without saying who blocked it reads as a platform rule in
   * force, and half of these are a creator's own choice — the half nobody has to
   * answer for. The breakdown appears only when both exist, because on an
   * ordinary day there is nothing to break down.
   */
  const count = (n, noun) => (n ? `${n} ${noun}${n === 1 ? '' : 's'}` : 'none');
  const split = (byOperator, byCreator, noun) => {
    if (!byOperator && !byCreator) return 'no decision yet';
    if (!byCreator) return count(byOperator, noun);
    if (!byOperator) return `${count(byCreator, noun)} <span class="fine">by the creator</span>`;
    return `${byOperator + byCreator} ${noun}s <span class="fine">${byOperator} platform · ${byCreator} creator</span>`;
  };

  const countryRow = (c) => `
  <tr>
    <td><strong>${esc(countryName(c.country_code))}</strong> <span class="fine mono">${esc(c.country_code)}</span></td>
    <td>${split(c.blocked_files_operator, c.blocked_files_creator, 'file')}</td>
    <td>${split(c.restricted_files_operator, c.restricted_files_creator, 'file')}</td>
    <td>${count(c.blocked_stores, 'store')}</td>
  </tr>`;

  return layout({
    title: 'Moderation', user, current: 'admin', consent,
    body: `
<div class="section" style="margin-bottom:0">
  <h1>Moderation</h1>
  <p class="lede" style="margin-top:var(--space-3)">Stores that are not in the default state, and the one
  form that changes it. Every decision records who made it, when, and which rule it cites.</p>
</div>

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="panel"><div class="panel-body">
    <h2 style="font-size:var(--text-md)">What the states do</h2>
    <dl class="kv" style="margin-top:var(--space-4)">
      <dt>approved</dt><dd>Public. The default.</dd>
      <dt>restricted</dt><dd>Public and writable, with a note to the owner. For presentation problems, not files.</dd>
      <dt>suspended</dt><dd>Hidden from every visitor and every listing. The owner still sees the whole dashboard, and every page tells them nothing was deleted. Writes stop.</dd>
      <dt>removed</dt><dd>The address returns 404, byte for byte the same as a store that never existed. The record stays.</dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      A reason is a rule code, never a sentence. The seller reads the rule's own wording plus your
      remedy line, so the charge and the explanation cannot drift apart.
    </p>
  </div></div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Needs a decision</h2>
    <p>${rows.length ? `${rows.length} store${rows.length === 1 ? '' : 's'} not in the default state` : 'Nothing is waiting'}</p>
  </div>
  ${rows.length ? rows.map(row).join('') : '<div class="empty">No store is restricted, suspended or removed.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>Files</h2>
    <p>${files.length
    ? (() => {
      // The same split the console counts, in the same words. One list, two
      // numbers, two meanings is how a queue starts lying to the person who
      // reads it every morning.
      const open = files.filter((f) => f.moderation_state !== 'removed').length;
      const gone = files.length - open;
      return `${open} waiting on a decision${gone ? `, ${gone} removed and waiting on the owner` : ''}`;
    })()
    : 'Nothing is waiting'}</p>
  </div>
  ${files.length
    ? files.map(fileRow).join('')
    : '<div class="empty">No file is restricted or removed, and no file is withheld from a country.</div>'}
  <p class="fine" style="margin-top:var(--space-4)">
    A file can be in this list while its state reads <span class="mono">approved</span>: a country rule is
    a decision about availability, not about the file. Open a file to decide its state, its countries,
    and to read every decision already made about it.
    A file that reads <span class="mono">removed</span> is down already and appears here so you can put it
    back, not because it is waiting on us — the count on the console leaves those out for that reason.
  </p>
</section>

<section class="section">
  <div class="section-head">
    <h2>Where content is blocked</h2>
    <p>Every country with a rule in force. A file of a creator's own making is marked, because that
    half is theirs to answer for and not ours.</p>
  </div>
  ${countries.length ? `<div class="table-scroll"><table class="table">
    <thead><tr><th>Country</th><th>Files blocked</th><th>Files listed, not unlockable</th><th>Stores withheld</th></tr></thead>
    <tbody>${countries.map(countryRow).join('')}</tbody>
  </table></div>` : '<div class="empty">No country rule is in force anywhere.</div>'}
  <p class="fine" style="margin:var(--space-6) 0 var(--space-2)">
    What these rules can do, and what none of them can:
  </p>
  <ul class="fine" style="padding-left:1.1em">
    ${limits.map((l) => `<li>${esc(l)}</li>`).join('')}
  </ul>
</section>

<section class="section">
  <div class="section-head">
    <h2>Stores withheld from a country</h2>
    <p>A rule about a shop's contents reaches every file in it. One file can still be carved back out on its own page.</p>
  </div>
  ${storeBlocks.length ? `<div class="table-scroll"><table class="table">
    <thead><tr><th>Store</th><th>Country</th><th>Rule</th><th>Decided</th><th></th></tr></thead>
    <tbody>${storeBlocks.map((b) => `<tr>
      <td><a href="/s/${esc(b.slug)}">${esc(b.name)}</a></td>
      <td>${esc(countryName(b.country_code))}</td>
      <td>${esc(b.rule_title || b.rule_code || 'a platform rule')}</td>
      <td class="fine">${esc(relTime(b.created_at))}</td>
      <td><form method="post" action="/admin/moderation/${esc(b.slug)}/country">
        <input type="hidden" name="countryCode" value="${esc(b.country_code)}">
        <input type="hidden" name="clear" value="1">
        <button class="btn btn-sm" type="submit">Clear</button>
      </form></td>
    </tr>`).join('')}</tbody>
  </table></div>` : '<div class="empty">No store is withheld from any country.</div>'}

  <form method="post" action="/admin/moderation/blocks" class="panel" style="margin-top:var(--space-5)">
    <div class="panel-body">
      <h3 style="font-size:var(--text-md);margin:0">Withhold a store from one country</h3>
      <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">
        <div class="field" style="flex:1 1 200px">
          <label for="block-slug">Store</label>
          <select class="input" id="block-slug" name="slug">
            ${channels.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)} — /s/${esc(c.slug)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:0 1 200px">
          <label for="block-country">Country</label>
          <select class="input" id="block-country" name="countryCode">
            ${countrySelectOptions()}
          </select>
        </div>
        <div class="field" style="flex:1 1 240px">
          <label for="block-rule">Rule</label>
          <select class="input" id="block-rule" name="ruleCode">
            ${rules.map((r) => `<option value="${esc(r.code)}">${esc(r.title)}${r.country_code ? ` (${esc(r.country_code)})` : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="block-remedy">What should the owner do?</label>
        <input class="input" id="block-remedy" name="remedy" maxlength="280"
               placeholder="One line. Nothing here means they did something wrong.">
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Withhold from this country</button>
    </div>
  </form>
</section>`,
  });
}

/**
 * How a decision reads to the person it happened to.
 *
 * The action names are the database's (`restrict`, `remove`, `reinstate`) and
 * they are perfect for a queue and useless in a sentence: "restrict" is what an
 * operator did, "restricted" is what the seller's file now is.
 */
const DECISION_VERB = {
  restrict: 'An operator has restricted this file',
  remove: 'An operator has removed this file',
  approve: 'An operator has approved this file',
  reinstate: 'An operator has put this file back',
  warn: 'An operator has a note about this file',
  suspend: 'An operator has acted on this file',
};

/**
 * Country options, with nothing chosen for you.
 *
 * The list is alphabetical, so a select that opens on its first entry opens on
 * Afghanistan — and every form this appears in withholds something. A blank
 * first option means the safe outcome of a careless submit is a validator
 * message (`?error=country`), not a country nobody meant to pick.
 */
function countrySelectOptions() {
  return `<option value="">Choose a country…</option>`
    + COUNTRY_OPTIONS.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join('');
}

/**
 * One file, decided.
 *
 * The store page answers "which store is in a bad state"; this answers "which
 * file, why, and everywhere it is unavailable". Three things live here that
 * existed nowhere before: the file's own state, its country rules, and the full
 * decision history — including the rules a creator set, because an operator who
 * cannot see why a file is missing in Nepal will assume the read path is broken.
 */
export function adminModerationFile({
  user, asset, channel, rules = [], countryRules = [], history = [], actions = [],
  labels = {}, limits = [], flash = null, consent = null,
}) {
  const behaviour = assetBehaviour(asset.moderation_state);
  const ruleTitle = (code) => {
    const r = rules.find((x) => x.code === code);
    return r ? r.title : code;
  };
  // Three questions, not one (see ASSET_BEHAVIOUR): an operator deciding about a
  // waiting file needs to know that approving it is what puts it in search, and
  // that its absence from search right now is not a bug in the read path.
  const effects = !behaviour.publicVisible
    ? 'Not listed anywhere: the file page answers 404 to everybody except its owner, an operator, and anyone who already unlocked it.'
    : !behaviour.searchable
      ? 'Listed and unlockable at its own address, and NOT in search: nothing has been decided about it yet, and approving it is what puts it in front of strangers.'
      : behaviour.canUnlock
        ? 'Listed, unlockable, and findable in search — except in the countries below.'
        : 'Listed, and NOT unlockable anywhere. The store still shows it.';

  const ruleOptions = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)}${r.country_code ? ` — ${esc(r.country_code)}` : ''} (${esc(r.code)})</option>`)
    .join('');

  const countryRows = countryRules.map((r) => `
  <tr>
    <td><strong>${esc(countryName(r.country_code))}</strong> <span class="fine mono">${esc(r.country_code)}</span></td>
    <td data-label="State">${pill(r.state, r.state === 'allowed' ? 'success' : r.state === 'restricted' ? 'warning' : 'danger')}</td>
    <td data-label="Decided by">${r.source === 'creator' ? 'The creator' : 'An operator'}</td>
    <td data-label="Rule">${r.rule_title ? esc(r.rule_title) : r.rule_code ? `<span class="mono">${esc(r.rule_code)}</span>` : '<span class="fine">no rule cited</span>'}</td>
    <td class="fine" data-label="When">${r.set_by_name ? `${esc(r.set_by_name)} · ` : ''}${esc(relTime(r.updated_at))}</td>
    <td data-label="Actions"><form method="post" action="/admin/moderation/files/${esc(asset.id)}/country">
      <input type="hidden" name="countryCode" value="${esc(r.country_code)}">
      <input type="hidden" name="clear" value="1">
      <button class="btn btn-sm" type="submit">Clear</button>
    </form></td>
  </tr>`).join('');

  /**
   * What a logged action reads as.
   *
   * One verb covers two outcomes in the log on purpose — `restrict` records a
   * country block and a country "listed but not unlockable" alike, because the
   * verb is about the act, not the state it left behind — and the state is the
   * Countries table's job, above. Rendering the verb raw next to that table is
   * how you get a log that says "Restrict" while the table says "blocked", so a
   * country row is worded as the country decision it was, and the note under the
   * table says which table holds the state.
   */
  const historyLabel = (h) => h.country_code
    ? `${h.action === 'approve' ? 'Allowed for' : 'Limited for'} ${countryIn(h.country_code)}`
    : (labels[h.action] || h.action);
  const historyRows = history.map((h) => `
  <tr>
    <td class="fine" data-label="When">${esc(relTime(h.created_at))}</td>
    <td data-label="Action">${esc(historyLabel(h))}</td>
    <td data-label="Rule">${h.rule_title ? esc(h.rule_title) : h.rule_code ? `<span class="mono">${esc(h.rule_code)}</span>` : '<span class="fine">—</span>'}</td>
    <td class="fine" data-label="Who">${esc(h.actor_name || 'the platform')}</td>
    <td class="fine" data-label="Note">${esc(h.reason || '')}</td>
  </tr>`).join('');

  return layout({
    title: `Moderation · ${asset.title}`, user, current: 'admin', consent,
    body: `
<a class="back-link" href="/admin/moderation">← Moderation</a>

<div class="section" style="margin-bottom:0">
  <div class="row">
    <h1>${esc(asset.title)}</h1>
    ${pill(asset.moderation_state, stateTone(asset.moderation_state))}
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/s/${esc(channel.slug)}/a/${esc(asset.slug)}">See it as a visitor</a>
  </div>
  <p class="lede" style="margin-top:var(--space-3)">
    In <a href="/s/${esc(channel.slug)}">${esc(channel.name)}</a>,
    owned by ${esc(asset.owner_name || asset.owner_email || 'an account with no name on file')}.
    ${esc(effects)}
  </p>
</div>

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-5)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="panel"><div class="panel-body">
    <h2 style="font-size:var(--text-md)">${esc(behaviour.ownerNote ? 'What the owner is told' : 'The file is in the default state')}</h2>
    <p class="small" style="margin-top:var(--space-3)">${esc(behaviour.ownerNote || 'Nothing has been decided about this file, so nobody has been told anything.')}</p>
  </div></div>
</section>

<section class="section">
  <div class="section-head"><h2>Decide the file</h2><p>A restriction cites a rule. Clearing one does not.</p></div>
  <form method="post" action="/admin/moderation/files/${esc(asset.id)}" class="panel">
    <div class="panel-body">
      <div class="row" style="align-items:flex-start;gap:var(--space-4);flex-wrap:wrap">
        <div class="field" style="flex:1 1 180px">
          <label for="fa">Action</label>
          <select class="input" id="fa" name="action">
            ${actions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
          </select>
          <span class="hint">A file cannot be suspended — that is a store. Refused rather than mapped.</span>
        </div>
        <div class="field" style="flex:2 1 260px">
          <label for="fr">Reason</label>
          <select class="input" id="fr" name="ruleCode">
            <option value="">— none cited —</option>
            ${ruleOptions()}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="fm">What should the owner do?</label>
        <!-- The instruction is a hint line, not a placeholder: a placeholder
             stops existing the moment somebody types, and on a phone this one was
             truncated mid-sentence. The other two remedy forms on this page
             already do it this way, so the same sentence cannot be persistent in
             one place and invisible in another. (No backticks in here: this whole
             block is inside a template literal, and one of them ends it.) -->
        <input class="input" id="fm" name="remedy" maxlength="280"
               placeholder="One line, in your own words.">
        <span class="hint">Up to 280 characters. It is shown to the owner with the rule's own wording.</span>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Record decision</button>
    </div>
  </form>
</section>

<section class="section">
  <div class="section-head">
    <h2>Countries</h2>
    <p>${countryRules.length ? `${countryRules.length} rule${countryRules.length === 1 ? '' : 's'} on this file.` : 'This file is available everywhere, as far as any rule goes.'}</p>
  </div>
  ${/* Six columns in a box a phone scrolls, with the Clear button at the far end —
       stacked, like every other wide table. Both of this page's tables were. */
  countryRules.length ? `<div class="table-scroll"><table class="table table-stacked">
    <thead><tr><th>Country</th><th>State</th><th>Decided by</th><th>Rule</th><th>When</th><th></th></tr></thead>
    <tbody>${countryRows}</tbody>
  </table></div>` : '<div class="empty">No country rule applies to this file.</div>'}

  <form method="post" action="/admin/moderation/files/${esc(asset.id)}/country" class="panel" style="margin-top:var(--space-5)">
    <div class="panel-body">
      <h3 style="font-size:var(--text-md);margin:0">Set a country rule</h3>
      <div class="row" style="align-items:flex-start;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">
        <div class="field" style="flex:1 1 200px">
          <label for="fc">Country</label>
          <select class="input" id="fc" name="countryCode">
            ${countrySelectOptions()}
          </select>
        </div>
        <div class="field" style="flex:0 1 200px">
          <label for="fs">State</label>
          <select class="input" id="fs" name="state">
            <option value="blocked">Blocked — 451, and absent from listings there</option>
            <option value="restricted">Listed, not unlockable — the shop still reads</option>
            <option value="allowed">Allowed — overrides a store-wide block</option>
          </select>
        </div>
        <div class="field" style="flex:1 1 240px">
          <label for="fk">Rule</label>
          <select class="input" id="fk" name="ruleCode">
            <option value="">— none cited —</option>
            ${ruleOptions()}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="fn">Note (kept private)</label>
        <input class="input" id="fn" name="note" maxlength="280" placeholder="For the record. Never shown to a visitor.">
      </div>
      <label class="check" style="margin-top:var(--space-4)">
        <input type="checkbox" name="wholeStore" value="1">
        <span>Apply to the whole store instead — every file in ${esc(channel.name)} is withheld from this country.</span>
      </label>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Set the rule</button>
      <p class="fine" style="margin-top:var(--space-4)">
        A blocked country answers <span class="mono">451</span> for a platform rule and
        <span class="mono">403</span> for a creator's own choice; a removed file is a 404.
        These responses are sent uncacheable, because a cached block served to the wrong country
        is indistinguishable from a broken site.
      </p>
    </div>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Every decision about this file</h2><p>Newest first. Nothing here is editable, on purpose.</p></div>
  ${history.length ? `<div class="table-scroll"><table class="table table-stacked">
    <thead><tr><th>When</th><th>Action</th><th>Rule</th><th>Who</th><th>Note</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table></div>` : '<div class="empty">No decision has been recorded about this file.</div>'}
  <p class="fine" style="margin:var(--space-6) 0 var(--space-2)">
    What a country rule can and cannot do, on this page and everywhere else:
  </p>
  <ul class="fine" style="padding-left:1.1em">
    ${limits.map((l) => `<li>${esc(l)}</li>`).join('')}
  </ul>
</section>`,
  });
}

/**
 * The operator's People page.
 *
 * The Android app's admin screen had a red "Ban User" button next to every
 * flagged file, and this is that, done where the server can enforce it: search
 * by email, one form per account, and the history of every decision already made
 * about it. A ban is not a deletion, and the page says so above the button
 * rather than after it.
 */
/**
 * Segments are decisions, not fields.
 *
 * Each one exists because it is a different next action, and the note under the
 * tabs says which. "Signed up, no store" and "store, no files" are both stalls,
 * but they stall in different places and are fixed by different things — which is
 * exactly why a single "unactivated" bucket would be useless.
 */
export const PERSON_SEGMENTS = [
  { key: 'all', label: 'Everyone', note: 'Every account, in the order you choose. The baseline to filter down from.' },
  { key: 'no_store', label: 'Signed up, no store', note: 'They made an account and never opened a store. Nothing is broken — this is where a first step goes missing.' },
  { key: 'store_no_files', label: 'Store, no files', note: 'A store exists and is empty. The seller got as far as the shopfront and stopped before publishing anything.' },
  { key: 'files_no_unlocks', label: 'Files, no unlocks', note: 'Something is published and nobody has unlocked it. That is a distribution problem, not a product one.' },
  { key: 'working', label: 'Has unlocks', note: 'The loop closed at least once: published, unlocked, and whatever follows from that.' },
  { key: 'suspended', label: 'Suspended', note: 'Accounts that are switched off. Everything they had is still here; reinstating gives all of it back.' },
  { key: 'operator', label: 'Operators', note: 'Accounts with power over other people\'s. Worth reading as its own list rather than trusting that it is short.' },
];

export function adminUsers({
  user, consent = null, flash = null, data = null, filters = {}, rules = [],
  personActions = [], labels = {}, canExport = true,
}) {
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const page = data?.page || 1;
  const pages = data?.pages || 1;
  const counts = data?.counts || {};
  const { q = '', segment = 'all', sort = 'recent' } = filters;
  const shown = PERSON_SEGMENTS.find((x) => x.key === segment) || PERSON_SEGMENTS[0];
  const segmentCount = (key) => (key === 'all'
    ? Object.values(counts).reduce((sum, c) => sum + c.n, 0)
    : (counts[key]?.n || 0));

  const link = (next) => {
    const params = new URLSearchParams();
    const merged = { q, segment, sort, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (!v || v === 'all' || (k === 'sort' && v === 'recent')) continue;
      params.set(k, v);
    }
    const qs = params.toString();
    return `/admin/users${qs ? `?${qs}` : ''}`;
  };

  const sortHead = (key, label) => `
    <th class="num"${sort === key ? ' aria-sort="descending"' : ''}>
      <a href="${esc(link({ sort: key, page: undefined }))}"${sort === key ? ' class="sorted"' : ''}>${esc(label)}${
    sort === key ? ' <span aria-hidden="true">↓</span>' : ''}</a>
    </th>`;

  const stateOf = (r) => {
    if (r.banned) return pill('suspended', 'danger');
    if (r.role !== 'user') return `${pill(r.role, 'accent')}<div class="fine">can act on others</div>`;
    return pill('active', 'success');
  };

  return adminShell({
    user, consent, current: 'people', title: 'People',
    lede: 'Accounts, not stores. Suspending one signs it out everywhere and takes its stores off the public '
      + 'site — and deletes nothing.',
    actions: canExport
      ? `<a class="btn btn-sm" href="${esc(link({ format: 'csv', page: undefined }))}">Download CSV</a>`
      : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero">
      <div class="kpi-value">${num(segmentCount('all'))}</div>
      <div class="kpi-label">Accounts</div>
      <div class="kpi-note">${num(Object.values(counts).reduce((sum, c) => sum + c.live, 0))} signed in during the last 30 days.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(segmentCount('no_store') + segmentCount('store_no_files'))}</div>
      <div class="kpi-label">Stalled before publishing</div>
      <div class="kpi-note">An account with no store, or a store with no files.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(segmentCount('files_no_unlocks'))}</div>
      <div class="kpi-label">Published, never unlocked</div>
      <div class="kpi-note">Live files, zero unlocks — reach, not product.</div>
    </div>
    <div class="kpi${segmentCount('suspended') ? ' kpi-bad' : ''}">
      <div class="kpi-value">${num(segmentCount('suspended'))}</div>
      <div class="kpi-label">Suspended</div>
      <div class="kpi-note">Nothing deleted. Reinstating restores everything.</div>
    </div>
  </div>
</section>

<section class="section">
  <nav class="segments" aria-label="Segments">
    ${PERSON_SEGMENTS.map((seg) => `<a href="${esc(link({ segment: seg.key, page: undefined }))}"
      ${seg.key === segment ? 'aria-current="page"' : ''}>${esc(seg.label)}<span class="seg-count">${num(segmentCount(seg.key))}</span></a>`).join('')}
  </nav>
  <p class="fine" style="margin-top:var(--space-3)">${esc(shown.note)}</p>

  <form class="filters" method="get" action="/admin/users" role="search" style="margin-top:var(--space-5)">
    <input type="hidden" name="segment" value="${esc(segment)}">
    <div class="field" style="flex:2 1 260px">
      <label for="q">Search</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="Email or display name">
    </div>
    <div class="field">
      <label for="sort">Order</label>
      <select class="input" id="sort" name="sort">
        ${[['recent', 'Newest accounts'], ['active', 'Seen most recently'], ['views', 'Most views · 30d'],
    ['unlocks', 'Most unlocks'], ['name', 'Name A→Z']]
    .map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filters-foot">
      <button class="btn btn-primary" type="submit">Apply</button>
      ${(q || segment !== 'all' || sort !== 'recent') ? `<a class="btn btn-sm" href="/admin/users">Clear</a>` : ''}
    </div>
  </form>

  <div class="section-head" style="margin-top:var(--space-6)">
    <h2>${total ? `${num(total)} account${total === 1 ? '' : 's'}` : 'Nothing here'}</h2>
    <p>${total
    ? `Page ${num(page)} of ${num(pages)}${q ? ` · matching “${esc(q)}”` : ''}`
    : q || segment !== 'all'
      ? 'Nobody matches that. The search looks at email addresses and display names, and the segment tabs count every account.'
      : 'No account exists yet. The first sign-up will appear here.'}</p>
  </div>

  ${rows.length ? `
  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Nine columns. Stacked on a phone (see .table-stacked): at 390px this
         table's own State cell was 96px wide holding five lines, and the reader
         who needed "can act on others" had to scroll sideways to find it. -->
    <table class="table table-directory table-stacked">
      <thead>
        <tr>
          <th>Person</th>
          <th>State</th>
          <th class="num">Stores</th>
          <th class="num">Files</th>
          ${sortHead('views', 'Views · 30d')}
          ${sortHead('unlocks', 'Unlocks')}
          <th>Joined</th>
          <th>Last seen</th>
          <th class="num">Failed sign-ins</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>
            <a href="/admin/users/${esc(r.id)}"><strong>${esc(r.display_name || r.email)}</strong></a>
            <div class="fine">${esc(r.email)}${r.sold_by_on_file ? ' · sold-by details on file' : ''}</div>
          </td>
          <td data-label="State">${stateOf(r)}</td>
          <td class="num" data-label="Stores">${num(r.stores)}${r.stores ? '' : '<div class="fine">none</div>'}</td>
          <td class="num" data-label="Files">${num(r.files)}${r.files ? '' : '<div class="fine">none</div>'}</td>
          <td class="num" data-label="Views · 30d">${num(r.views_30d)}</td>
          <td class="num" data-label="Unlocks">${num(r.unlocks)}</td>
          <td class="fine" data-label="Joined">${esc(isoDay(r.created_at))}</td>
          <td class="fine" data-label="Last seen">${r.last_seen_at ? esc(relTime(r.last_seen_at)) : 'never'}</td>
          <td class="num" data-label="Failed sign-ins">${r.failed_7d
    ? `${num(r.failed_7d)}<div class="fine">in 7 days</div>`
    : '<span class="fine">—</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">
    ${page > 1 ? `<a class="btn btn-sm" href="${esc(link({ page: page - 1 }))}">← Back</a>` : ''}
    <span class="fine">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? `<a class="btn btn-sm" href="${esc(link({ page: page + 1 }))}">Next →</a>` : ''}
  </nav>` : ''}
  ` : `<div class="empty">
    ${q || segment !== 'all' ? `Nobody is in this segment${q ? ` and matching “${esc(q)}”` : ''}.`
    : 'No account exists yet.'}
  </div>`}

  <div class="cols-2" style="margin-top:var(--space-6)">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What a suspension does</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Sign-in</dt><dd>Refused, with the reason and where to reply. Checked after the password, so it is not a way to discover which addresses exist.</dd>
        <dt>Sessions</dt><dd>Every live session is revoked in the same transaction. A suspended account's token is refused even if one survived.</dd>
        <dt>Their stores</dt><dd>Hidden from Explore, from search, and from their own addresses — 404 to everyone but the seller and an operator.</dd>
        <dt>Their files</dt><dd>Untouched. Nothing is deleted, and reinstating restores everything exactly as it was.</dd>
      </dl>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What this page counts, and what it will not</h2>
      <p class="small" style="margin-top:var(--space-3)">
        Unlocks here are what a person's files earned them as a seller. What somebody unlocks as a
        <em>reader</em> is counted on their own record and never listed — not here, not anywhere an
        operator can browse. A count answers every question moderation asks; a list would turn a
        support tool into a log of what people read, and the platform would then have to defend having it.
      </p>
      <p class="small">
        There is no money column, and that is not an omission: nothing of a creator's ever passes through
        bytebikri, so an account has no balance to show.
      </p>
      <p class="small">
        There is no “verified” chip in this directory, and that is a decision rather than a gap. The badge
        now exists (see any store's page), it is about identity and nothing else, and it is shown where a
        buyer can read what it means. A column of ticked and unticked boxes here would say that an
        unchecked creator is a suspect, and most of them are simply creators who have not asked.
      </p>
    </div></div>
  </div>
</section>`,
  });
}

/**
 * One account, in full — the half the directory leaves out on purpose.
 *
 * A directory that showed all of this inline would be a spreadsheet nobody reads,
 * so the table carries the columns you scan and this page carries the ones you
 * read one at a time. It is also where the decision gets made, which is why the
 * suspension form lives here rather than on the row.
 */
/**
 * "I never got the reset link" — the answer, on the page support already has open.
 *
 * The three states are deliberately not merged into one line, because they call
 * for three different replies to the person:
 *
 *   • a link was requested and the message went out → it is in spam, or the
 *     address is wrong; ask them to try again;
 *   • a link was requested and delivery FAILED → our problem, and the error text
 *     is the first thing a developer needs;
 *   • the development driver printed it instead of sending it → expected on this
 *     machine, and the link's true home is the server log.
 *
 * And one state that is not an error at all but is worth stating: a completed
 * reset signs the account out everywhere, so a person who just recovered their
 * password is *supposed* to see zero live sessions.
 */
/**
 * "They say they cannot get in" — answered on the page.
 *
 * Three facts decide what an operator does next, and all three were previously in
 * a database client or nowhere: is the address confirmed, did the messages we
 * sent actually leave, and how many links have gone out. The last one matters
 * because a person who has asked for four links is not having a link problem.
 *
 * The delivery row is the one that changes behaviour. With the console driver in
 * development nothing is delivered and nothing has failed, which is a different
 * state from "the provider refused it" — so the page reports them differently
 * rather than treating "not delivered" as an error.
 */
function recoveryNote(r, person) {
  if (!r) return '';
  const when = r.last_requested ? relTime(r.last_requested) : null;
  const confirmed = r.address_confirmed_at;
  const failed = Number(r.failed_deliveries || 0);

  const delivery = failed
    ? `<div class="note note-danger" style="margin-top:var(--space-5)">
      <strong>${num(failed)} message${failed === 1 ? '' : 's'} to this address did not send.</strong>
      They were written and the provider refused them, so somebody is waiting for a message that is not
      coming — and they will conclude the platform is broken, which today it is. The reason is recorded
      against the message itself, on the mail log; the fix is in the mail settings, not in this account.
      ${when ? `The most recent attempt was ${esc(when)}.` : ''}
    </div>`
    : '';

  const address = confirmed
    ? `<p class="fine" style="margin-top:var(--space-4)">
        <strong>Address confirmed</strong> ${esc(relTime(confirmed))}.
        ${r.verifications_sent ? `${num(r.verifications_sent)} confirmation ${r.verifications_sent === 1 ? 'link' : 'links'} sent in total.` : ''}
        Nothing about money is held back for this account.
      </p>`
    : `<div class="note note-warning" style="margin-top:var(--space-5)">
        <strong>Address not confirmed.</strong>
        ${r.verifications_sent
    ? `${num(r.verifications_sent)} confirmation ${r.verifications_sent === 1 ? 'link has' : 'links have'} gone to this address.`
    : 'No confirmation link has ever been sent to this address.'}
        Everything works — signing in, publishing, unlocking, the store staying live — except submitting a
        transfer reference, because an operator matches those by hand and the receipt has to reach somebody.
        ${person?.email ? `Their address is <span class="mono">${esc(person.email)}</span>.` : ''}
        <form method="post" action="/admin/users/${esc(person.id)}/verify-link" style="margin-top:var(--space-4)">
          <button class="btn btn-sm" type="submit">Send a confirmation link for them</button>
        </form>
      </div>`;

  if (!r.requested) {
    return `${delivery}${address}
    <p class="fine" style="margin-top:var(--space-4)">
      No reset link has ever been requested for this address. If somebody says they cannot get in, this is
      normally a forgotten password rather than a lost one, and asking them to use “Forgot your password?”
      is the whole answer.
    </p>`;
  }

  const done = r.completed
    ? `Recovered ${r.completed === 1 ? 'once' : `${num(r.completed)} times`}.
       Asking for a second link cancels the first, so only the newest one is ever live.`
    : 'Never completed — links were asked for and none was used.';
  return `${delivery}${address}
  <p class="fine" style="margin-top:var(--space-4)">
    <strong>${num(r.requested)} reset ${r.requested === 1 ? 'link' : 'links'} requested</strong>${when ? `, most recently ${esc(when)}` : ''}.
    ${esc(done)}
  </p>`;
}

export function adminUser({
  user, consent = null, flash = null, detail = null, rules = [],
  personActions = [], labels = {}, recovery = null,
}) {
  if (!detail) {
    return adminShell({
      user, consent, title: 'No such account', current: 'overview',
      body: `<section class="section"><div class="empty">That account does not exist. It may have been
        typed into the address bar rather than reached from the list.
        <div style="margin-top:var(--space-4)"><a class="btn btn-sm" href="/admin/users">← All accounts</a></div>
      </div></section>`,
    });
  }
  const p = detail.person;
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');
  const id8 = esc(p.id.slice(0, 8));

  // The flash is rendered HERE because adminShell does not take one — it was
  // passed through and silently dropped, so an operator action that returns to
  // this page (sending somebody a confirmation link) looked like it had done
  // nothing at all.
  const flashNote = flash?.message
    ? `<div class="note note-${flash.kind}" role="status" style="margin-top:var(--space-5)">${esc(flash.message)}</div>`
    : '';

  return adminShell({
    user, consent, title: p.display_name || p.email,
    lede: p.email,
    body: `
${flashNote}
<section class="section">
  <div class="row" style="align-items:center;gap:var(--space-3);flex-wrap:wrap">
    <a class="btn btn-sm" href="/admin/users">← All accounts</a>
    ${p.banned ? pill('suspended', 'danger') : pill('active', 'success')}
    ${p.role !== 'user' ? pill(p.role, 'accent') : ''}
    ${p.banned && p.ban_reason ? `<span class="fine">${esc(p.ban_reason)}</span>` : ''}
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/admin/users?q=${encodeURIComponent(p.email)}">Find their rows in the list</a>
  </div>

  <div class="kpi-row" style="margin-top:var(--space-6)">
    <div class="kpi">
      <div class="kpi-value">${num(detail.stores.length)}</div>
      <div class="kpi-label">Stores</div>
      <div class="kpi-note">${detail.stores.length ? 'Listed below, with their traffic.' : 'They have not opened one.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(detail.unlocksHeld)}</div>
      <div class="kpi-label">Unlocks they hold</div>
      <div class="kpi-note">As a reader. Counted, never listed — see the note on the list page.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(detail.sessions.live)}</div>
      <div class="kpi-label">Live sessions</div>
      <div class="kpi-note">${detail.sessions.total
    ? `${num(detail.sessions.total)} ever, last seen ${esc(relTime(detail.sessions.last_seen))}.`
    : 'This account has never signed in.'}</div>
    </div>
    <div class="kpi${detail.attempts.failed_7d >= 10 ? ' kpi-bad' : ''}">
      <div class="kpi-value">${num(detail.attempts.failed_7d)}</div>
      <div class="kpi-label">Failed sign-ins · 7d</div>
      <div class="kpi-note">${detail.attempts.failed_7d >= 10
    ? 'High enough to be worth reading as an attack on this address rather than a forgotten password.'
    : `${num(detail.attempts.ok_30d)} succeeded in the last 30 days.`}</div>
    </div>
  </div>
</section>

${detail.stores.length ? `<section class="section">
  <div class="section-head"><h2>Their stores</h2><p>A person can own more than one; each is judged on its own.</p></div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Store</th><th>State</th><th class="num">Files</th><th class="num">Views · 30d</th><th>Opened</th></tr></thead>
      <tbody>${detail.stores.map((c) => `<tr>
        <td>
          <a href="/admin/stores/${esc(c.slug)}"><strong>${esc(c.name)}</strong></a>
          <div class="fine">/s/${esc(c.slug)}${c.listing_mode === 'marketplace' ? ' · listed' : ''}</div>
        </td>
        <td>${pill(c.moderation_state, stateTone(c.moderation_state))}</td>
        <td class="num">${num(c.files)}</td>
        <td class="num">${num(c.views_30d)}</td>
        <td class="fine">${esc(isoDay(c.created_at))}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">On file</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Joined</dt><dd>${esc(isoDay(p.created_at))} <span class="fine">· ${esc(relTime(p.created_at))}</span></dd>
        <dt>Signs in with</dt><dd>${p.has_password ? 'an email and a password' : '<span class="fine">no password set — this account cannot sign in yet</span>'}</dd>
        <dt>First session</dt><dd>${detail.sessions.first_seen ? esc(isoDay(detail.sessions.first_seen)) : '<span class="fine">never</span>'}</dd>
        <dt>Sold-by details</dt><dd>${p.sold_by_on_file
    ? 'A legal name is on file, which an annual rent invoice needs.'
    : '<span class="fine">Not given yet. This is the field an invoice uses, and it stays private from buyers and sellers.</span>'}</dd>
        <dt>Phone</dt><dd>${p.phone_on_file ? 'On file, private' : '<span class="fine">not given</span>'}</dd>
        <dt>Locale</dt><dd>${esc(p.locale || 'ne')}</dd>
        <dt>Live sessions</dt><dd>${num(detail.sessions.live)}${detail.sessions.live
    ? ` <span class="fine">· a reset ends all of them at once</span>`
    : ' <span class="fine">· nobody is signed in as this account</span>'}</dd>
      </dl>
      ${recoveryNote(recovery, p)}
      <p class="fine" style="margin-top:var(--space-4)">
        Their legal name and phone are stored, and are not rendered here even for an operator: this page
        is about what to do, and the fields that identify a person to the tax office live on the invoice
        that needs them.
      </p>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">${p.banned ? 'Reinstate or record a decision' : 'Suspend or record a decision'}</h2>
      <form method="post" action="/admin/users/${esc(p.id)}">
        <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">
          <div class="field" style="flex:1 1 160px;margin:0">
            <label for="a-${id8}">Action</label>
            <select class="input" id="a-${id8}" name="action">
              ${personActions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2 1 220px;margin:0">
            <label for="r-${id8}">Reason</label>
            <select class="input" id="r-${id8}" name="ruleCode">
              <option value="">— none cited —</option>
              ${options(null)}
            </select>
          </div>
          <button class="btn ${p.banned ? '' : 'btn-danger'}" type="submit">${p.banned ? 'Record decision' : 'Suspend this account'}</button>
        </div>
        <div class="field" style="margin-top:var(--space-3)">
          <input class="input" name="remedy" maxlength="280" placeholder="One line to the person. They read this and nothing else.">
        </div>
      </form>
      <p class="fine" style="margin-top:var(--space-4)">
        A suspension is a state, not a deletion. It is also reversible without a support request, which is
        why the record is a history rather than a flag on a row.
      </p>
    </div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Decisions about this account</h2>
    <p>${detail.decisions.length ? 'Newest first, with the rule each one cited.' : 'Nothing has been decided about this account.'}</p>
  </div>
  ${detail.decisions.length
    ? `<div class="panel"><div class="panel-body decisions">${detail.decisions.map((h) => `
        <div class="decision">
          <div class="row" style="align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
            <span class="mono small">${esc(h.action)}</span>
            ${h.rule_title ? pill(h.rule_title, 'warning') : '<span class="fine">no rule cited</span>'}
            <span class="fine">${esc(relTime(h.created_at))}</span>
          </div>
          ${h.reason ? `<p class="small" style="margin-top:var(--space-2)">“${esc(h.reason)}”</p>` : ''}
        </div>`).join('')}</div></div>`
    : '<div class="empty">No suspension, reinstatement or note has been recorded for this account — which is the normal state of an account nobody has had to think about.</div>'}
</section>`,
  });
}

/** The decisions already made about an account, newest first. */
function historyOf(userId, history) {
  const rows = history?.[userId] || [];
  if (!rows.length) return '';
  return `<ul class="list-plain fine" style="margin-top:var(--space-4)">
    ${rows.map((h) => `<li>
      <span class="mono">${esc(h.action)}</span>
      ${h.rule_title ? `· ${esc(h.rule_title)}` : ''}
      · ${esc(relTime(h.created_at))}
      ${h.reason ? `<div style="margin-top:var(--space-1)">“${esc(h.reason)}”</div>` : ''}
    </li>`).join('')}
  </ul>`;
}

/**
 * One proof figure.
 *
 * `data-count` makes it animate from zero on first paint — the client reads the
 * attribute, counts up in 700ms, and writes the final value back as text. With
 * no JavaScript, or with reduced motion, the number is simply already there:
 * the markup is the truth and the animation is an enhancement, never the other
 * way round.
 */
function proof(value, label, literal = null) {
  const shown = literal ?? num(value);
  return `<div class="proof">
    <span class="proof-value"${literal === null ? ` data-count="${Number(value) || 0}"` : ''}>${shown}</span>
    <span class="proof-label">${esc(label)}</span>
  </div>`;
}


// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Charts
//
// Two tiny charts, written by hand as SVG rather than pulled from a library,
// because the rules they have to obey are the whole design and a library would
// make them hard to see:
//
//   - ONE series per chart. A sparkline mixing two metrics communicates nothing.
//   - A PINNED scale where charts sit next to each other. If each file's chart
//     picked its own maximum, a 5% change and a 500% change would draw the same
//     shape — "the biggest risk with sparklines" — so the caller passes one max
//     for the whole table and every chart in it shares it.
//   - A MEASURED ZERO and a MISSING DAY are different facts and are drawn
//     differently. The daily table only holds days something happened; a chart
//     that fills the rest with zero is claiming traffic we never measured.
//   - The shape is the point, the exact number is elsewhere. So no axes, no
//     gridlines, no legend: the total is already in the KPI above, and the title
//     element carries the sentence for anyone using a screen reader.
//   - One highlight, never several. Marking the peak, the trough, the first and
//     the last at once defeats the purpose.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A short human sentence describing a series, for the accessible name. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date a person can read at 11px.
 *
 * The axis used to print the raw `MM-DD` slice of the ISO day — `08-24` and
 * `09-22` — and at 11px that is not a date, it is two numbers with a dash between
 * them. Read either way round it looks like a range, and there is no month name
 * anywhere on the chart. Numeric date defaults are the thing every spreadsheet
 * user complains about and the standard fix is the short month name; the unit is
 * what has to be legible, and the day-month order is the one this country reads
 * (`public/locale`, prices and dates elsewhere in this file are en-IN too).
 * `year` is off by default and switched on by callers whose window spans a
 * New Year, where the year is the only thing separating two identical labels —
 * and by tooltips, where there is room for the unambiguous form.
 */
export function humanDay(iso, { year = false } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return String(iso);
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || m[2]}`;
  return year ? `${label} ${m[1]}` : label;
}

function describeSeries(points, { unit = 'views' } = {}) {
  const measured = points.filter((p) => p.measured !== false);
  if (!measured.length) return `No ${unit} have been measured yet.`;
  const total = measured.reduce((a, p) => a + (p.value || 0), 0);
  const peak = measured.reduce((a, p) => Math.max(a, p.value || 0), 0);
  const peakDay = measured.find((p) => (p.value || 0) === peak);
  const half = Math.floor(measured.length / 2);
  const firstHalf = measured.slice(0, half).reduce((a, p) => a + (p.value || 0), 0);
  const secondHalf = measured.slice(half).reduce((a, p) => a + (p.value || 0), 0);
  const gap = points.length - measured.length;

  let direction = 'flat';
  if (firstHalf > 0 || secondHalf > 0) {
    if (secondHalf > firstHalf * 1.15) direction = 'rising';
    else if (secondHalf < firstHalf * 0.85) direction = 'falling';
  }
  const parts = [
    `${total.toLocaleString('en-IN')} ${unit} across ${measured.length} measured ${measured.length === 1 ? 'day' : 'days'}`,
    peak ? `peak ${peak.toLocaleString('en-IN')} on ${humanDay(peakDay.day)}` : 'no activity yet',
    `${direction} across the window`,
  ];
  // Say the gaps out loud rather than letting the reader assume the line is solid.
  // Agreement matters in a sentence a screen reader will read aloud: "1 day was
  // not measured and are not drawn as zero" is the kind of thing that makes a
  // chart sound broken, and it shipped for one test run.
  if (gap > 0) {
    parts.push(gap === 1
      ? '1 day was not measured and is not drawn as zero'
      : `${gap} days were not measured and are not drawn as zero`);
  }
  return `${parts.join('; ')}.`;
}

/**
 * A 30-day column chart.
 *
 * Columns rather than a line: traffic arrives in whole visits on whole days, and
 * a line implies continuity between today and the day before that nobody
 * measured. Missing days are drawn as a faint band so they cannot be mistaken for
 * quiet ones, and the peak column is the only thing highlighted.
 */
export function trafficChart({ points = [], height = 132, label = 'Views' } = {}) {
  const n = points.length;
  if (!n) return '<div class="empty">Nothing to draw yet.</div>';

  const max = points.reduce((a, p) => Math.max(a, p.value || 0), 0);
  const scale = max > 0 ? max : 1;
  const plot = height - 22;               // room for the date labels under the plot
  const colW = 100 / n;                   // viewBox units, percentages of width

  // Contiguous runs of unmeasured days become one band each.
  const bands = [];
  for (let i = 0; i < n; i += 1) {
    if (points[i].measured === false) {
      const start = i;
      while (i < n && points[i].measured === false) i += 1;
      bands.push([start, i]);
    }
  }

  const peakIndex = points.reduce((best, p, i) => ((p.value || 0) > (points[best]?.value || 0) ? i : best), 0);

  const bars = points.map((p, i) => {
    const value = p.value || 0;
    if (p.measured === false) return '';
    // A measured zero still gets a stub, so "we looked and saw nothing" is on the
    // chart instead of being an absence that reads like a missing day.
    const h = value > 0 ? Math.max((value / scale) * plot, 3) : 2;
    const y = plot - h + 10;
    const cls = value > 0 ? (i === peakIndex ? 'chart-bar chart-bar-peak' : 'chart-bar') : 'chart-bar chart-bar-zero';
    return `<rect class="${cls}" x="${(i * colW + colW * 0.18).toFixed(2)}%" y="${y.toFixed(1)}" `
      + `width="${(colW * 0.64).toFixed(2)}%" height="${h.toFixed(1)}" `
      + `rx="${Math.min(colW * 0.18, 1.2).toFixed(2)}"><title>${esc(humanDay(p.day, { year: true }))}: `+ `${value.toLocaleString('en-IN')} ${esc(label.toLowerCase())}${value === 0 ? ' (measured, none)' : ''}</title></rect>`;
  }).join('');

  const bandShapes = bands.map(([from, to]) => `<rect class="chart-gap" x="${(from * colW).toFixed(2)}%" y="10" `
    + `width="${((to - from) * colW).toFixed(2)}%" height="${plot}" rx="2"><title>No daily row for these days</title></rect>`).join('');

  // A stretch we did not record is drawn as a band, and on a thirty-day chart the
  // band is often most of the plot. Unlabelled, a large grey block does not read
  // as "no records": it reads as a filled area — days that happened and are being
  // counted — which is the exact misreading the band exists to prevent. So wide
  // bands are labelled in place. The text has to live in HTML rather than in the
  // SVG, because the plot's `preserveAspectRatio="none"` would stretch it
  // sideways with the columns.
  //
  // Shown by measured width, not by taste: the plot's pixel width is not known
  // here, so the band's share of the window is the only handle available, and the
  // thresholds are set so the longest string fits at the narrowest phone the
  // layout supports. A one-day hole keeps the footnote and its tooltip.
  const gapNotes = bands.map(([from, to]) => {
    const span = (to - from) * colW;
    const days = to - from;
    const text = span >= 45 ? `${days} ${days === 1 ? 'day' : 'days'} not recorded`
      : span >= 26 ? 'not recorded' : null;
    if (!text) return '';
    const centre = (((from + to) / 2) * colW).toFixed(2);
    return `<span class="chart-gap-note" style="left:${centre}%">${esc(text)}</span>`;
  }).join('');

  // The year appears only when the window straddles two of them: repeating it on
  // a thirty-day chart is noise, and leaving it off a chart that crosses New Year
  // makes the last label look earlier than the first.
  const crossedYear = String(points[0].day).slice(0, 4) !== String(points[n - 1].day).slice(0, 4);
  const first = humanDay(points[0].day, { year: crossedYear });
  const last = humanDay(points[n - 1].day, { year: crossedYear });

  return `<figure class="chart" data-chart>
  <div class="chart-plot" style="height:${height}px">
    <svg class="chart-svg" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img"
         aria-label="${esc(describeSeries(points, { unit: label.toLowerCase() }))}">
      ${bandShapes}${bars}
      <line class="chart-axis" x1="0" y1="${plot + 10}" x2="100" y2="${plot + 10}" vector-effect="non-scaling-stroke"></line>
    </svg>
    ${gapNotes}
    ${max > 0 ? `<span class="chart-max" aria-hidden="true">peak ${max.toLocaleString('en-IN')}</span>` : ''}
  </div>
  <figcaption class="chart-foot">
    <span>${esc(first)}</span>
    <span class="spacer"></span>
    <span>${esc(last)}</span>
  </figcaption>
</figure>`;
}

/**
 * A word-sized chart for one row of a table.
 *
 * Columns again, and the scale is PASSED IN rather than computed, so every chart
 * in the table shares one. A subtlety worth stating: `max` of zero would draw
 * every row flat and identical, which is correct — a store with no ad views at
 * all has no shape to show.
 */
export function sparkline({ points = [], max = 0, height = 26, label = 'ad views' } = {}) {
  const n = points.length;
  if (!n) return '';
  const scale = Math.max(max, 1);
  const colW = 100 / n;
  const bars = points.map((p, i) => {
    const value = p.value || 0;
    if (!value) return '';
    const h = Math.max((value / scale) * (height - 2), 2);
    return `<rect class="chart-bar" x="${(i * colW + colW * 0.2).toFixed(2)}%" y="${(height - h).toFixed(1)}" `
      + `width="${(colW * 0.6).toFixed(2)}%" height="${h.toFixed(1)}" rx="0.6"><title>${esc(p.day)}: ${value.toLocaleString('en-IN')} ${esc(label)}</title></rect>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 100 ${height}" preserveAspectRatio="none" role="img"
      aria-label="${esc(describeSeries(points, { unit: label }))}">${bars}</svg>`;
}

export function dashboard({
  channel, slots, connections, providers, plan, estimate, pageviews, adViews,
  upgrade, user, pendingPayments = [], flash = null, consent = null,
  assets = [], assetStats = [], moderation = null,
  // Live + paused, for the seller's own table. `assets` stays live-only: it is the
  // plan-usage count, and a paused file must not count against the same ceiling a
  // publish is checked against.
  ownerAssets = null,
  // The same list, filtered, sorted and paged — what the toolbar on this page
  // actually asks the database for. `ownerAssets` is kept for callers that want the
  // whole store (and for the tests that never needed paging).
  files = null,
  // The most recent bulk change still inside its undo window, if any.
  recentBulk = null,
  // How full this seller's plan is, and what the next tier would give them.
  // Both come from `planUsage` so this panel, the refusal message and the
  // operator's pages cannot disagree about the same account.
  usage = null, nextPlan = null,
  // The day-by-day series behind the totals. Optional so every existing caller
  // and test keeps working, and so a page that has no series simply draws no
  // chart instead of drawing an empty one.
  traffic = [], adViewSeries = null,
}) {
  const conn = connections[0] || null;
  const provider = conn ? providers.find((p) => p.id === conn.provider_id) : null;

  // A file meter: the running count, drawn as a bar only once it is worth
  // looking at. Below 80% the sentence carries it and a bar is decoration; at
  // 80% it is a warning; at the limit it is the reason the next upload will
  // bounce, and the next tier's allowance is named right there rather than
  // behind another click.
  //
  // `usage` is optional, with the same contract as `traffic`: a caller that does
  // not pass it gets the count derived from the files it already passed, not a
  // blank panel and not a second implementation. Three tests failed on the first
  // version of this for exactly that reason — the view assumed a caller had
  // remembered to pass state the view can compute itself.
  const planState = usage || planUsage({ plan, files: (assets || []).length, slots });
  const meter = (() => {
    if (!planState || planState.files.level === 'unlimited' || planState.files.level === 'ok') return '';
    const { used, limit, level } = planState.files;
    const pct = Math.min(Math.round((used / limit) * 100), 100);
    const next = nextPlan && nextPlan.capabilities.max_assets !== limit
      ? `<div class="fine" style="margin-top:var(--space-2)">${esc(nextPlan.name)} allows ${
        nextPlan.capabilities.max_assets === -1 ? 'unlimited files' : `${nextPlan.capabilities.max_assets} files`}.</div>`
      : '';
    return `
      <div class="meter meter-${level}" role="img" aria-label="${esc(`${used} of ${limit} published files`)}">
        <span style="width:${pct}%"></span>
      </div>
      ${level === 'at'
    ? `<div class="note note-warning" style="margin-top:var(--space-3)">This plan is full: publishing another file will be refused until you upgrade. Nothing already published is affected.</div>${next}`
    : next}`;
  })();

  const slotRows = slots.map((s) => `
    <tr>
      <td><strong>${esc(s.label)}</strong><div class="fine">rank ${s.rank} of ${slots.length}</div></td>
      <td>${s.owner === 'platform' ? pill('Platform · rent', 'warning') : pill("Channel's own", 'info')}</td>
      <td>${s.serves
    ? (s.from === 'house' ? pill('Ours — house ad', 'info') : pill('Filled by you', 'success'))
    : (s.owner === 'platform' ? pill('Empty', '') : pill('Yours — empty', ''))}</td>
    </tr>`).join('');

  const earnings = adViews.filter((v) => v.completed).reduce((a, v) => a + (Number(v.revenue_usd) || 0), 0);

  return layout({
    title: channel.name, user, activeChannel: channel, consent, current: 'dashboard',
    body: `
<div class="section" style="margin-bottom:0">
  <div class="row">
    <h1>${esc(channel.name)}</h1>
    ${pill(`${plan.name} plan`, plan.code === 'free' ? '' : 'accent')}
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/s/${esc(channel.slug)}" target="_blank" rel="noopener">View store ↗</a>
  </div>
  <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || '')}</p>
</div>

${storeSectionNav(channel, 'overview')}

${moderation ? `<div style="margin-top:var(--space-6)">${moderationNotice(moderation)}</div>` : ''}

${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<!--
  Four equal numbers answered no question. A seller opens this page to find out
  whether what they published is being used, so that is the hero — at the largest
  size, spanning two columns — and the three figures that explain it are sized
  down from it. Nothing here is a number we profit from, and the estimate says so
  in its own note rather than in a paragraph underneath.
-->
<div class="kpi-row" style="margin-top:var(--space-8)">
  <div class="kpi kpi-hero">
    <div class="kpi-value">${num(estimate.unlocks || 0)}</div>
    <div class="kpi-label">Files unlocked · last 30 days</div>
    <div class="kpi-note">${estimate.unlocks
    ? 'Each one is a person who watched a rewarded ad for something you published.'
    : 'Nobody has unlocked a file yet. It starts the moment your first visitor watches an ad.'}</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${num(pageviews)}</div>
    <div class="kpi-label">Views · 30d</div>
    <div class="kpi-note">What rent is priced from.</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${num(adViews.length)}</div>
    <div class="kpi-label">Ad views served</div>
    <div class="kpi-note">Across every network.</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">$${earnings.toFixed(3)}</div>
    <div class="kpi-label">Est. earned</div>
    <div class="kpi-note">Our estimate, not the network's statement.</div>
  </div>
</div>
<p class="fine" style="margin-top:var(--space-3)">
  Estimated earned is <strong>our</strong> figure from provider-reported revenue, not your statement.
  The network is the authority on what you were paid, and it pays your own account directly.
  <a href="/dashboard/${esc(channel.slug)}/earnings">Where the money goes →</a>
</p>

${traffic.length ? `
<div class="panel" style="margin-top:var(--space-6)">
  <div class="panel-head">
    <h2 style="font-size:var(--text-md)">Views, day by day</h2>
    <span class="spacer"></span>
    <span class="fine">Last 30 days</span>
  </div>
  <div class="panel-body">
    ${trafficChart({
    points: traffic.map((p) => ({ day: p.day, value: p.views || 0, measured: p.measured })),
    label: 'Views',
  })}
    <p class="fine" style="margin-top:var(--space-3)">
      Counted in our own table when a storefront page is served, so it is exact for what it measures —
      and it measures page views, not people. Days with no row at all are shaded and never drawn as
      zero: a gap in our records is not a quiet day.
    </p>
  </div>
</div>` : ''}

<div class="panel" style="margin-top:var(--space-5)">
  <div class="panel-head"><h2 style="font-size:var(--text-md)">What this store rents</h2></div>
  <div class="panel-body">
    <dl class="kv">
      <dt>Monthly traffic</dt><dd>${plural(estimate.pageviews30d || pageviews, 'view')} in 30 days</dd>
      <dt>Slots you own</dt><dd>${num((estimate.total || 0) - (estimate.rent || 0))} of ${num(estimate.total || 0)}</dd>
      <dt>Platform rent slots</dt><dd>${num(estimate.rent || 0)} — the platform sells these</dd>
      <dt>Assumed ad rate</dt><dd>$${Number(estimate.rpmUsd || 0).toFixed(2)} per 1,000 views</dd>
      <dt>Estimated rent value</dt><dd><strong>${npr(estimate.estNpr || 0)}</strong> per 30 days</dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      Rent is priced from measured traffic, not from a plan tier — a busy store pays more for the
      same slot than a quiet one, and a quiet store is never charged for traffic it did not get.
      The figure above is an estimate at the assumed rate, not an invoice.
    </p>
  </div>
</div>

${(() => {
    // What the toolbar asked for when it is there, and the old shape when it is not:
    // the view is called by tests and by callers that do not page, and a page that
    // only works with one of its two inputs is a page that breaks silently.
    const paged = files || null;
    const list = paged
      ? paged.rows
      // Live first, then whatever is not live — a seller scrolling their own files
      // should not have to hunt past a hidden one to find what is earning.
      : (ownerAssets ?? assets).slice().sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1));
    const counts = paged?.counts || {
      all: list.length,
      live: list.filter((a) => a.status === 'live' && !a.hidden_by_reports).length,
      paused: list.filter((a) => a.status === 'paused' && !a.hidden_by_reports).length,
      hidden: list.filter((a) => a.hidden_by_reports).length,
    };
    const f = {
      q: paged?.q ?? '', state: paged?.state ?? 'all', access: paged?.access ?? 'all',
      sort: paged?.sort ?? 'newest',
    };
    // Rebuilt from scratch for every link, so a filter cannot linger invisibly in a
    // URL somebody copied: what the page shows and what its address says are the
    // same four values.
    const qs = (next = {}) => {
      const merged = { ...f, ...next };
      const params = new URLSearchParams();
      if (merged.q) params.set('q', merged.q);
      if (merged.state && merged.state !== 'all') params.set('state', merged.state);
      if (merged.access && merged.access !== 'all') params.set('access', merged.access);
      if (merged.sort && merged.sort !== 'newest') params.set('sort', merged.sort);
      const out = params.toString();
      return `/dashboard/${esc(channel.slug)}${out ? `?${out}` : ''}#files`;
    };
    const chip = (label, next, active, count) => `
      <a class="chip${active ? ' chip-on' : ''}" href="${esc(qs(next))}"
         ${active ? 'aria-current="true"' : ''}>${esc(label)}${count === undefined ? '' : ` <span class="chip-n">${num(count)}</span>`}</a>`;
    const isFiltered = Boolean(f.q) || f.state !== 'all' || f.access !== 'all';
    const hiddenCount = counts.hidden;
    const pausedCount = counts.paused;

    const toolbar = `
      <form class="files-toolbar" method="get" action="/dashboard/${esc(channel.slug)}">
        <div class="files-search">
          <label class="sr-only" for="files-q">Search your files</label>
          <input class="input" id="files-q" type="search" name="q" value="${esc(f.q)}"
                 maxlength="80" placeholder="Search by title or address…">
        </div>
        <label class="sr-only" for="files-state">State</label>
        <select class="input" id="files-state" name="state">
          ${[['all', 'Any state'], ['live', 'Live'], ['paused', 'Paused by me'], ['hidden', 'Hidden after reports']]
    .map(([v, l]) => `<option value="${v}"${f.state === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <label class="sr-only" for="files-access">Access</label>
        <select class="input" id="files-access" name="access">
          ${[['all', 'Any access'], ['ad_gated', 'Ad-gated'], ['open', 'Open to everyone']]
    .map(([v, l]) => `<option value="${v}"${f.access === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <label class="sr-only" for="files-sort">Sort</label>
        <select class="input" id="files-sort" name="sort">
          ${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['unlocks', 'Most unlocks'],
    ['views', 'Most ad views (30d)'], ['title', 'Title A–Z']]
    .map(([v, l]) => `<option value="${v}"${f.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn" type="submit">Apply</button>
        ${isFiltered ? `<a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}#files">Clear</a>` : ''}
      </form>
      <div class="files-chips">
        ${chip('All', { state: 'all' }, f.state === 'all', counts.all)}
        ${chip('Live', { state: 'live' }, f.state === 'live', counts.live)}
        ${chip('Paused', { state: 'paused' }, f.state === 'paused', counts.paused)}
        ${counts.hidden ? chip('Hidden after reports', { state: 'hidden' }, f.state === 'hidden', counts.hidden) : ''}
      </div>`;

    // The undo strip. In the page and not only in the flash: the flash says what
    // happened once, and this says "you can still take it back" for as long as that
    // is true — which is the actual promise.
    const undoAction = { pause: 'Paused', live: 'Put back live', ad_gated: 'Set to ad-gated', open: 'Opened to everyone' };
    const undoStrip = recentBulk && recentBulk.applied ? `
      <div class="note note-info" role="status" style="margin:0 0 var(--space-4)">
        <strong>${esc(undoAction[recentBulk.action] || 'Changed')} ${filesN(recentBulk.applied)} ${esc(relTime(recentBulk.created_at))}.</strong>
        ${recentBulk.skipped ? ` ${filesN(recentBulk.skipped)} hidden after reports ${recentBulk.skipped === 1 ? 'was' : 'were'} left alone.` : ''}
        <form method="post" action="/dashboard/${esc(channel.slug)}/assets/bulk/${esc(recentBulk.id)}/undo"
              style="display:inline">
          <button class="btn btn-sm" type="submit">Undo</button>
        </form>
        <span class="fine">Offered for 30 minutes after the change — take it back and the files are exactly as they were.</span>
      </div>` : '';

    // Three numbers, and a page that conflates them is a page that lies: how many
    // rows are on this screen, how many files the search matched, and how many the
    // store holds. "Showing 3 of 9 … out of 12 in the store" is the whole truth.
    const shownCount = list.length;
    const matchedCount = Number(paged?.total ?? shownCount) || 0;

    return counts.all || isFiltered || recentBulk?.applied ? `
<section class="section" id="files">
  <div class="section-head">
    <h2>Your files</h2>
    <p>${isFiltered
    ? `Showing <strong>${num(shownCount)} of ${num(matchedCount)}</strong> files${f.q ? ` matching “${esc(f.q)}”` : ''}${f.state !== 'all' || f.access !== 'all' ? ' under these filters' : ''}${counts.all !== matchedCount ? `, out of ${num(counts.all)} in the store` : ''}.`
    : `${plural(counts.all, 'file')}${hiddenCount ? `, ${hiddenCount} hidden after reports` : ''}${pausedCount ? `${hiddenCount ? ' and' : ','} ${pausedCount} paused by you` : ''}.`}
      Everything here is editable — nothing is reviewed before it appears.${hiddenCount
    ? ' A hidden file says so in its own row, with the way to answer it.' : ''}</p>
  </div>
  ${toolbar}
  ${undoStrip}
  <form method="post" action="/dashboard/${esc(channel.slug)}/assets/bulk" class="panel" id="bulk-form">
    <input type="hidden" name="q" value="${esc(f.q)}">
    <input type="hidden" name="state" value="${esc(f.state)}">
    <input type="hidden" name="access" value="${esc(f.access)}">
    <input type="hidden" name="sort" value="${esc(f.sort)}">
    <!-- Which set the action applies to. The two are separate controls on purpose:
         the header box means the rows on this page, and this one means the whole
         filter — the researched hazard is a single checkbox that means both. -->
    <input type="hidden" name="scope" value="page" id="bulk-scope">
    <div class="panel-body panel-body-flush">
      ${list.length ? `
      <table class="table table-stacked">
        <thead><tr>
          <th class="pick"><span class="sr-only">Select</span></th>
          <th>File</th><th>State</th><th>Access</th>
          <th class="num">Unlocks</th><th>Ad views · 30d</th><th class="num"></th>
        </tr></thead>
        <tbody>${(() => {
    // One scale for every row. If each chart picked its own maximum, the file
    // with one ad view would draw the same shape as the file with two hundred.
    const seriesOf = (id) => {
      const raw = adViewSeries?.get ? adViewSeries.get(id) : null;
      return raw ? raw.map((p) => ({ day: p.day, value: p.views })) : [];
    };
    const sharedMax = list.reduce((best, a) => {
      const peak = seriesOf(a.id).reduce((m, p) => Math.max(m, p.value), 0);
      return Math.max(best, peak);
    }, 0);
    return list.map((a) => {
      const st = assetStats.find((x) => x.id === a.id) || { files: Number(a.files) || 0, unlocks: Number(a.unlocks) || 0 };
      const series = seriesOf(a.id);
      const monthTotal = series.length ? series.reduce((t, p) => t + p.value, 0) : Number(a.views_30d) || 0;
      return `<tr>
        <td class="pick" data-label="Pick">
          <label class="pick-box">
            <input type="checkbox" name="ids" value="${esc(a.id)}"
                   aria-label="Select ${esc(a.title)}"${a.hidden_by_reports ? ' disabled' : ''}>
          </label>
        </td>
        <td><strong>${esc(a.title)}</strong>
          <div class="fine">${esc(a.slug)} · ${plural(Number(st.files) || 0, 'file')}${
    a.unlock_mode === 'open' ? ' · open to everyone' : a.unlock_mode === 'breaks' ? ' · open, breaks inside' : ''}</div></td>
        <td data-label="State">${/* A file the report threshold hid is not the same as one the seller
                paused, and calling both "Paused" told a seller they had done something
                they had not done — while hiding the one thing they needed to know. The
                pill says who acted, and the row links straight to the answer. */
    a.hidden_by_reports ? pill('Hidden after reports', 'danger')
      : a.status === 'paused' ? pill('Paused by you', 'warning')
        : a.status === 'removed' ? pill('Removed', 'danger') : pill('Live', 'success')}
          ${a.hidden_by_reports ? `<div class="fine" style="margin-top:var(--space-1)">
            <a href="/dashboard/${esc(channel.slug)}/assets/${esc(a.id)}">Your side of it →</a></div>` : ''}</td>
        <td data-label="Access">${a.unlock_mode === 'open' ? pill('Free', 'success')
    : a.unlock_mode === 'breaks' ? pill('Free · break inside', 'success')
      : a.unlock_mode === 'members' ? pill('Members', 'accent')
        : pill('Ad-gated', 'locked')}</td>
        <td class="num" data-label="Unlocks">${num(Number(st.unlocks) || 0)}</td>
        <td data-label="Ad views · 30d">${series.length
    ? `<div class="row" style="gap:var(--space-3);align-items:center">${sparkline({ points: series, max: sharedMax })}
         <span class="fine">${monthTotal ? `${num(monthTotal)} this month` : 'none yet'}</span></div>`
    : `<span class="fine">${monthTotal ? `${num(monthTotal)} this month` : 'none this month'}</span>`}</td>
        <td class="num" data-label="Actions"><a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/assets/${esc(a.id)}">Edit</a></td>
      </tr>`;
    }).join('');
  })()}</tbody>
      </table>` : `<div class="empty" style="margin:var(--space-5)">
        ${isFiltered ? `No file matches those filters. <a href="/dashboard/${esc(channel.slug)}#files">Clear them</a> to see all ${num(counts.all)}.`
    : 'Nothing published yet. Your storefront is live — the first file is what makes it a store.'}
      </div>`}
      ${paged && paged.total > paged.perPage ? `<nav class="pager" aria-label="Pages">
        ${paged.page > 1 ? `<a class="btn btn-sm" href="${esc(qs({ page: paged.page - 1 }))}">← Back</a>` : ''}
        <span class="fine">Page ${num(paged.page)} of ${num(Math.ceil(paged.total / paged.perPage))}</span>
        ${paged.page < Math.ceil(paged.total / paged.perPage)
    ? `<a class="btn btn-sm" href="${esc(qs({ page: paged.page + 1 }))}">Next →</a>` : ''}
      </nav>` : ''}
      ${list.length ? `
        <!-- The two sets a seller can mean, as two labelled controls rather than one
             ambiguous tick. The researched hazard is a single header checkbox whose
             meaning ("this page" or "everything the filter matches"?) nobody can
             read — so each one says which it is, and this block sits OUTSIDE the
             table because the table's head is hidden on a phone: the escape hatch
             cannot live in a row of cells that a phone does not draw. -->
        <div class="pick-all">
          <label class="check">
            <input type="checkbox" id="pick-page">
            <span>Select this page <span class="fine">— the ${num(list.length)} file${list.length === 1 ? '' : 's'} shown above</span></span>
          </label>
          ${paged && paged.total > list.length ? `
          <label class="check">
            <input type="checkbox" id="pick-matching" data-total="${num(paged.total)}">
            <span>Select all <strong>${num(paged.total)}</strong> files matching this search
              <span class="fine">— including the ${num(paged.total - list.length)} you cannot see on this page.</span></span>
          </label>` : ''}
        </div>` : ''}
    </div>
    <div class="bulk-bar" id="bulk-bar">
      <span class="bulk-count" id="bulk-count" role="status">No files picked</span>
      <div class="bulk-actions">
        <button class="btn btn-sm" type="submit" name="action" value="pause">Pause</button>
        <button class="btn btn-sm" type="submit" name="action" value="live">Put back live</button>
        <button class="btn btn-sm" type="submit" name="action" value="ad_gated">Ad-gated</button>
        <button class="btn btn-sm" type="submit" name="action" value="open">Open to everyone</button>
        <button class="btn btn-sm" type="button" id="bulk-clear">Clear</button>
      </div>
      <p class="fine">A file hidden while reports are answered cannot be changed here — that state is ours until the
      appeal is read, and the row says so.</p>
    </div>
  </form>
</section>` : '<div class="empty">Nothing published yet. Your storefront is live — the first file is what makes it a store.</div>';
  })()}

<section class="section">
  <div class="section-head">
    <h2>Publish a file</h2>
    <p>It goes live immediately. Nothing is reviewed before it appears on your storefront.</p>
  </div>
  <form class="card card-pad-lg" method="post" enctype="multipart/form-data"
        action="/dashboard/${esc(channel.slug)}/assets">
    <div class="field">
      <label for="p-title">Title</label>
      <input class="input" id="p-title" name="title" required maxlength="200"
             placeholder="e.g. Devanagari Poster Kit">
      <span class="hint">Becomes the page address: /s/${esc(channel.slug)}/a/&lt;title-with-dashes&gt;</span>
    </div>
    <div class="field">
      <label for="p-desc">Description</label>
      <textarea class="textarea" id="p-desc" name="description" rows="3" maxlength="2000"
                placeholder="What is in the file, and who is it for?"></textarea>
    </div>
    <div class="row" style="gap:var(--space-5);align-items:flex-start">
      <div class="field" style="flex:1 1 240px">
        <label for="p-media">The file people unlock</label>
        <input class="input" id="p-media" name="media" type="file" required>
        <span class="hint">Up to 25 MB. Stored privately — it is only ever sent through a
        link minted for one signed-in account.</span>
      </div>
      <div class="field" style="flex:1 1 240px">
        <label for="p-cover">Cover image <span class="muted">(optional)</span></label>
        <input class="input" id="p-cover" name="cover" type="file" accept="image/*">
        <span class="hint">This is what shows in the grid and in every share preview.
        Listings with a cover get looked at.</span>
      </div>
    </div>
    <div class="row" style="gap:var(--space-5);align-items:flex-start">
      <div class="field" style="flex:1 1 200px">
        <label for="p-mode">Access</label>
        <select class="input" id="p-mode" name="unlockMode">
          <option value="ad_gated">One rewarded ad</option>
          <option value="open">Free — no ad</option>
        </select>
      </div>
      <div class="field" style="flex:1 1 200px">
        <span class="field-label">What unlocking will ask for</span>
        <p class="small" style="margin:var(--space-2) 0 0">One rewarded view of 15 seconds — the floor
        every file starts at. The ask rises with what the file is worth, and you change it afterwards on
        the file's own page by choosing a rate, not by typing seconds.</p>
      </div>
    </div>
    <button class="btn btn-primary" type="submit" style="margin-top:var(--space-2)">Publish</button>
    <p class="fine" style="margin-top:var(--space-3)">
      Selling for money is not switched on yet. Everything published today is unlocked by
      watching one ad, and the network pays your own account for it.
    </p>
  </form>
</section>

<section class="section">
  <div class="section-head"><h2>Ad slots</h2>
    <p>Where ads can appear. The platform takes one slot per page, last rank, never rank 1.
      <a href="/dashboard/${esc(channel.slug)}/slots">What fills each one →</a></p></div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Slot</th><th>Owner</th><th>State</th></tr></thead>
      <tbody>${slotRows || '<tr><td colspan="3" class="muted">No slots on this plan.</td></tr>'}</tbody>
    </table>
  </div></div>
</section>

${conn ? `
<section class="section">
  <div class="section-head"><h2>Ad connection</h2></div>
  <div class="panel"><div class="panel-body">
    <div class="row">
      ${pill(provider?.name || conn.provider_id, 'success')}
      <span class="small">Connected ${relTime(conn.connected_at)}</span>
      <span class="spacer"></span>
      <a class="btn btn-sm" href="/dashboard/${esc(channel.slug)}/networks">Credentials and health →</a>
    </div>
    ${provider ? `<dl class="kv" style="margin-top:var(--space-5)">
      <dt>Formats</dt><dd>${esc((provider.formats || []).join(', '))}</dd>
      <dt>Callback</dt>
      <dd><a href="/dashboard/${esc(channel.slug)}/networks">Your exact URL, with the macros to leave alone →</a></dd>
    </dl>` : ''}
    <p class="fine" style="margin-top:var(--space-4)">
      Rewarded ads are served by the network inside your own page. When one completes, the network
      calls us server-to-server with a signature; only then is the unlock granted.
    </p>
  </div></div>
</section>` : `
<section class="section">
  <div class="note note-warning">
    No ad connection yet — nothing on this store can be unlocked, because there is no network to
    verify a completed view. Connect one below.
  </div>
</section>`}

<section class="section">
  <div class="section-head"><h2>Connect a network</h2></div>
  <div class="panel"><div class="panel-body">
    <p class="small" style="margin:0">
      The networks are ranked by whether a Nepali creator can actually withdraw the money,
      and each one is set up in your own name: we show you the four steps, you paste the
      verification secret, and the page gives you the callback URL to paste back at them.
    </p>
    <p class="fine" style="margin-top:var(--space-4)">
      Nothing is stored except that secret, and a connection stays unverified until a real
      callback arrives.
    </p>
    <div class="row" style="margin-top:var(--space-5)">
      <a class="btn btn-primary" href="/dashboard/${esc(channel.slug)}/networks">Open networks →</a>
    </div>
  </div></div>
</section>

<section class="section">
  <div class="section-head"><h2>Plan</h2></div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      <dt>Current</dt><dd>${esc(plan.name)} · ${npr(plan.priceNpr)}/year</dd>
      <dt>Files</dt><dd>${esc(planState.sentence)}${meter}</dd>
      <dt>Positions</dt><dd>${plan.capabilities.slot_count} on each page${
        plan.capabilities.slot_count === 1 ? ' — plus bytebikri\'s one at the end' : ''}</dd>
      <dt>Earnings</dt><dd><a href="/dashboard/${esc(channel.slug)}/earnings">Who pays you, and how much →</a></dd>
      <dt>Billing</dt><dd><a href="/dashboard/${esc(channel.slug)}/billing">Plans, rent and payments →</a></dd>
      <dt>Store settings</dt><dd><a href="/dashboard/${esc(channel.slug)}/settings">Name, banner, listing →</a></dd>
      <dt>Reviews</dt><dd><a href="/dashboard/${esc(channel.slug)}/reviews">What buyers wrote →</a></dd>
      <dt>Attention</dt><dd><a href="/dashboard/${esc(channel.slug)}/attention">What was watched, and what we drew →</a></dd>
    </dl>
    ${upgrade ? `
      <div class="note note-info" style="margin-top:var(--space-5)">
        Upgrade to <strong>${esc(upgrade.to.name)}</strong> — ${npr(upgrade.amountNpr)} pro-rated,
        ${plural(upgrade.daysLeft, 'day')} left on this cycle.
        <div class="fine" style="margin-top:var(--space-2)">
          ${npr(upgrade.to.priceNpr)} − ${npr(upgrade.from.priceNpr)} = ${npr(upgrade.fullDifference)}
          × ${upgrade.daysLeft}/365. Your renewal date does not move.
        </div>
      </div>` : ''}
    ${pendingPayments.length
      ? `<p class="fine" style="margin-top:var(--space-4)">${pendingPayments.length} payment(s) awaiting verification.</p>`
      : ''}
  </div></div>
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * An empty slot still occupies its height. Without that, the page reflows when a
 * tag finally loads and everything below it jumps — a layout shift counts
 * against the page in search ranking and against the reader in annoyance.
 */
/**
 * An ad slot.
 *
 * What this looks like when no network is connected matters: it is on every
 * storefront and every asset page, and the previous version printed "rank 3 ·
 * reserved" at the visitor — internal billing vocabulary, on the shop floor.
 * Nobody looking at a shop should be told about slot rank.
 *
 * The space still has to be reserved, because that is the layout commitment the
 * seller is buying, so it stays the same height and says what it is for. When a
 * slot is serving, the render layer is what fills it.
 */
/**
 * Where a slot goes on a page.
 *
 * Position is the product here: the rent slot is the last one, and that ordering
 * is the consideration for the rent rather than a promise in a policy document.
 * Stacking every slot at the bottom of the page would make the rank labels on
 * the slots page untrue, so rank 1 is placed at the top and the rest after the
 * content they sit beside.
 */
function placeSlots(slots = []) {
  const fill = (list) => list.map(renderSlot).join('');
  const own = slots.filter((s) => s.owner !== 'platform');
  const platform = slots.filter((s) => s.owner === 'platform');
  return {
    head: fill(own.filter((s) => s.rank === 1)),
    mid: fill(own.filter((s) => s.rank !== 1)),
    foot: fill(platform),
  };
}

/**
 * Which slots actually reach the page — the ledger's question, answered in one place.
 *
 * `renderSlot()` has exactly one early return, and it is a rule about what a VISITOR
 * is shown rather than a rendering detail: a store's own unfilled position is hidden
 * from shoppers and drawn only for the owner. The counter must obey the same rule,
 * because an impression is a box that was drawn — counting allocated-but-hidden
 * positions would inflate the platform's numbers with boxes nobody ever saw, which is
 * the one thing a ledger that exists to be defensible cannot do (ASSET_ECONOMY §12).
 *
 * Kept beside `renderSlot` on purpose: two copies of this condition is how the count
 * and the page stop agreeing.
 */
export function drawnSlots(slots = []) {
  return slots.filter((slot) => {
    const owner = slot.owner === 'platform' ? 'platform' : 'channel';
    return !(!slot.creative && owner === 'channel' && !slot.isOwner);
  });
}

export function renderSlot(slot) {
  const h = Math.min(slot.maxHeightPx || slot.max_height_px || 250, 280);
  const owner = slot.owner === 'platform' ? 'platform' : 'channel';
  const from = slot.from || 'none';
  const creative = slot.creative || null;

  /*
   * AN EMPTY SPACE THE STORE OWNS IS NOT RENDERED TO A VISITOR.
   *
   * This is not tidiness. The store's own slot sits at rank 1 — the first thing
   * a visitor sees, by design, because the top position belongs to the creator
   * rather than to the platform. When the creator has not written anything, that
   * made the most valuable position on the page a 250px box saying "Alice has not
   * put a message here yet", with the actual files pushed below the fold.
   *
   * A screenshot of the storefront is what found it. Nothing in the test suite
   * could have: every assertion about the empty note was true, and the note was
   * correct — it should simply never have reached a shopper.
   *
   * The owner still sees it, because they are the one person who can act on it,
   * and on their dashboard it is a compact prompt rather than a hole.
   */
  if (!creative && owner === 'channel' && !slot.isOwner) return '';
  // What decides the shape: whether anybody BOUGHT this space. A store's unfilled
  // slot is a prompt; the platform's house message is a placeholder; a sold
  // creative is the only one that reserves height, because it is the only one
  // that is a tag waiting to arrive. The house fallback used to render as a 280px
  // billboard on a store with a single item — our own message taking more room
  // than the store's content, and a large empty box is what a broken banner looks
  // like.
  const compact = slot.houseFallback === true || (!creative && owner === 'channel');
  const cls = ['slot', `slot-${owner}`, from === 'none' ? 'slot-empty' : 'slot-filled'];
  if (slot.surface === 'app_native') cls.push('slot-app');

  // The label is the visitor's answer to "who put this here". It is rendered,
  // not implied by position: a reader has to be able to tell the store's message
  // from the platform's advertisement without inspecting the page.
  const inner = creative ? `
    <a class="slot-creative" href="${esc(creative.linkUrl || '#')}"
       ${creative.linkUrl ? '' : 'aria-disabled="true"'}>
      <div class="slot-creative-head">${esc(creative.headline)}</div>
      ${creative.body ? `<p class="slot-creative-body">${esc(creative.body)}</p>` : ''}
      ${creative.linkLabel ? `<span class="slot-cta">${esc(creative.linkLabel)}</span>` : ''}
    </a>`
    : `
    <div class="slot-empty-note">${esc(slot.emptyNote || slot.byline || '')}</div>
    ${slot.editHref ? `<a class="slot-empty-action" href="${esc(slot.editHref)}">Write one →</a>` : ''}`;

  return `<aside class="${cls.join(' ')}${compact ? ' slot-prompt' : ''}" data-slot="${esc(slot.slotKey || slot.key || '')}"
       data-owner="${esc(owner)}" data-serving="${from === 'none' ? 'false' : 'true'}"
       data-adapter="${esc(slot.adapter || '')}" data-surface="${esc(slot.surface || 'web')}"
       ${compact ? '' : `style="min-height:${h}px"`} role="complementary" aria-label="${esc(slot.label || 'Advertisement')}">
  <div class="slot-inner">
    <div class="slot-label">${esc(slot.label || 'Advertisement')}</div>
    <div class="slot-sub">${esc(slot.byline || '')}</div>
    ${inner}
  </div>
</aside>`;
}

export const m = { esc, npr, num, relTime, pill };

// ---------------------------------------------------------------------------
// Legal
// ---------------------------------------------------------------------------

/**
 * A legal page.
 *
 * Rendered from the structures in src/legal.js rather than written as markup, so
 * the body of each section is authored once and the warning about missing
 * operator details cannot be forgotten on one page but not another.
 */
export function legalPage({ user, doc, consent = null, missingOperatorFields = [], next = '/' }) {
  const body = doc.sections.map((sec) => `
    <section class="section" style="margin-top:var(--space-8)">
      <h2 style="font-size:var(--text-lg)">${esc(sec.h)}</h2>
      <div class="prose" style="margin-top:var(--space-3)">${sec.body}</div>
    </section>`).join('');

  return layout({
    title: doc.title, user, consent, current: 'legal',
    body: `
<div class="section" style="margin-top:var(--space-8);max-width:var(--measure)">
  <h1>${esc(doc.title)}</h1>
  <p class="lede" style="margin-top:var(--space-3)">${esc(doc.lede)}</p>
</div>

${missingOperatorFields.length ? `
<div class="note note-warning" style="max-width:var(--measure)" role="alert">
  <strong>This deployment has not been configured.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    A notice that does not identify who is responsible for the data is not a notice. The
    following are still empty and must be set before this page is shown to anyone:
  </p>
  <ul class="small" style="margin:var(--space-2) 0 0 var(--space-5)">
    ${missingOperatorFields.map((f) => `<li><code>${esc(f.key)}</code> — ${esc(f.why)}</li>`).join('')}
  </ul>
</div>` : ''}

${doc.consent !== undefined ? consentControls({ consent, next }) : ''}

<div style="max-width:var(--measure)">${body}</div>
`,
  });
}

/**
 * The controls, on the page, for changing the decision.
 *
 * A single form rather than three buttons: the checkboxes carry the state, so
 * "save" means exactly what the boxes say. Two mega-buttons that flip everything
 * without showing what they flipped is how people end up granting something they
 * meant to refuse.
 */
function consentControls({ consent, next }) {
  const purposes = consent?.purposes || [];
  // Read straight from the stored choices, so the checkbox reflects what is on
  // file rather than a hand-maintained list of special cases.
  const on = (key) => consent?.choices?.[key] === true;

  return `
<form method="post" action="/consent" class="card card-pad-lg" style="max-width:var(--measure);margin-top:var(--space-6)">
  <input type="hidden" name="next" value="${esc(next)}">
  <div class="row">
    <h2 style="font-size:var(--text-md)">Choose individually</h2>
    <span class="spacer"></span>
    ${consent?.decided
      ? pill(consent.ads ? 'Personalised ads on' : 'Personalised ads off', consent.ads ? 'success' : '')
      : pill('Not answered')}
  </div>

  ${purposes.map((p) => `
  <label class="check" style="align-items:flex-start">
    <input type="checkbox" name="${esc(p.key)}" value="on" ${on(p.key) ? 'checked' : ''}>
    <span>
      <strong>${esc(p.label)}</strong>
      <span class="fine" style="display:block;margin-top:var(--space-1)">${esc(p.detail)}</span>
    </span>
  </label>`).join('')}

  <div class="row" style="margin-top:var(--space-4);gap:var(--space-3)">
    <button class="btn btn-primary" type="submit" name="choice" value="save">Save my choice</button>
    <button class="btn" type="submit" name="choice" value="none">Reject all</button>
    <button class="btn" type="submit" name="choice" value="all">Accept all</button>
  </div>
</form>`;
}

/**
 * Ad networks — connecting a store to the network that pays it.
 *
 * Every other product in this category shows a Connect button that opens OAuth
 * and a green tick that means nothing to anybody. This page has to do three
 * things instead, and all three are consequences of the money model:
 *
 *   1. Be explicit that the account is the CREATOR'S. We never ask for a
 *      network login. What we hold is the value their network signs callbacks
 *      with — it authorises nothing but the verification of an event.
 *   2. Hand over the exact callback URL, with the network's own macros left
 *      intact, and say which macro maps to what. This is the step that fails in
 *      real life, and the page has to make it copy-pastable.
 *   3. Show evidence rather than a colour: has this network ever called us, when
 *      last, and how many times in thirty days. "Connected" with no callbacks
 *      ever is the support ticket, and the page should answer it before it is
 *      opened.
 */
export function networksPage({
  channel, user, consent = null, flash = null, connections = [], available = [],
  base = '', unusableBase = false, slotDefs = [],
}) {
  const card = ({ connection: c, provider, onboarding, url, health, sandbox, secretHint, events }) => {
    const kind = {
      live: 'success', working: 'success', sandbox: 'info',
      quiet: 'warning', silent: 'warning', unverified: 'warning', noadapter: 'warning', off: '',
    }[health.level] || '';
    const connector = onboarding.credentials[0] || null;
    const canVerify = onboarding.mode === 'paste_credentials' || onboarding.mode === 'none';
    // No slots for a network we cannot serve: assigning one would reserve space
    // the seller pays rent for and give it to nothing.
    const slotPicker = !sandbox && canVerify && c.status !== 'revoked';

    return `
  <div class="card card-pad-lg network-card">
    <div class="row">
      <div>
        <h3 style="font-size:var(--text-lg)">${esc(provider.name)}</h3>
        <div class="fine">${esc(provider.slotModel || 'network')}${provider.formats?.length ? ` · ${esc(provider.formats.join(' / '))}` : ''}</div>
      </div>
      <span class="spacer"></span>
      ${pill(health.label, kind)}
    </div>

    <p class="small" style="margin-top:var(--space-3)">${esc(health.detail)}</p>

    ${url ? `
    <div class="field" style="margin-top:var(--space-5)">
      <label for="url-${esc(c.id)}">Callback URL — paste this into ${esc(provider.name)}</label>
      <input class="input mono" id="url-${esc(c.id)}" value="${esc(url)}" readonly
             onclick="this.select()" spellcheck="false">
      <span class="hint">${esc(onboarding.postback?.method || 'GET')} request.
        The braces are macros ${esc(provider.name)} substitutes — leave them exactly as they are.</span>
    </div>

    ${(onboarding.postback?.params || []).length ? `
    <!-- Wrapped so the table scrolls inside itself on a phone. Every other table
         on the site sits in a panel body, which carries that behaviour; this one
         was written directly into the panel body and pushed the whole page
         sideways at 390px, which is a bug that only shows up when somebody
         actually opens the page at that width. -->
    <div class="table-scroll" style="margin-top:var(--space-4)">
    <table class="table">
      <thead><tr><th>Parameter</th><th>Their macro</th><th>What it carries</th></tr></thead>
      <tbody>${onboarding.postback.params.map((p) => `<tr>
        <td class="mono">${esc(p.ours)}</td>
        <td class="mono">${esc(p.theirs || p.value || 'not recorded')}</td>
        <td class="small">${esc(p.note || '')}</td>
      </tr>`).join('')}</tbody>
    </table>
    </div>` : ''}

    ${onboarding.postback?.signature ? `
    <div class="note" style="margin-top:var(--space-4)">
      <strong>How they sign it: ${esc(onboarding.postback.signature.algo)}</strong>
      <p class="small" style="margin-top:var(--space-2)">
        Over ${esc(onboarding.postback.signature.covers)}, keyed by ${esc(onboarding.postback.signature.key)}.
        ${esc(onboarding.postback.signature.detail || '')}
      </p>
    </div>` : ''}` : `
    <p class="small" style="margin-top:var(--space-4)">
      ${canVerify
    ? 'This network needs no callback URL and no secret. There is nothing to configure.'
    : `We have no adapter for ${esc(provider.name)}, so there is no callback URL to give it and nothing here to
       configure. What that costs you: no unlocks through this network. What it does not cost you: the money —
       they pay your account directly, and you can record what they report on your earnings page.`}
    </p>`}

    ${connector ? `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/secret"
          style="margin-top:var(--space-5)">
      <div class="field">
        <label for="sec-${esc(c.id)}">${esc(connector.label)}</label>
        <input class="input mono" id="sec-${esc(c.id)}" name="${esc(connector.key)}" type="password"
               autocomplete="off" spellcheck="false"
               placeholder="${secretHint ? esc(secretHint) : 'paste it here'}">
        <span class="hint">${esc(connector.help || '')}</span>
      </div>
      <div class="row">
        <button class="btn btn-primary btn-sm" type="submit">
          ${c.callback_secret ? 'Replace the secret' : `Save and verify`}
        </button>
        ${c.callback_secret ? `<span class="fine">Saved: <span class="mono">${esc(secretHint)}</span> — never shown in full again.</span>` : ''}
      </div>
    </form>` : ''}

    ${slotPicker ? `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/slots"
          style="margin-top:var(--space-5)">
      <div class="field">
        <label>Slots this network may serve</label>
        <span class="hint">Leave all unticked and it fills nothing — a slot it cannot serve is a blank
          space you are paying rent for.</span>
        <div class="check-grid">
          ${slotDefs.filter((d) => d.active).map((d) => `
          <label class="check">
            <input type="checkbox" name="slotKeys" value="${esc(d.key)}"
                   ${(c.slot_keys || []).includes(d.key) ? 'checked' : ''}>
            <span>${esc(d.label)} <span class="fine">· ${esc((d.formats || []).join('/'))}</span></span>
          </label>`).join('')}
        </div>
      </div>
      <button class="btn btn-sm" type="submit">Save slots</button>
    </form>` : ''}

    ${events.length ? `
    <details style="margin-top:var(--space-5)">
      <summary class="fine">History (${num(events.length)})</summary>
      <ul class="list-steps" style="margin-top:var(--space-3)">
        ${events.map((e) => `<li>${esc(day(e.created_at))} — ${esc(e.from_status || 'new')} → ${esc(e.to_status)}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}
      </ul>
    </details>` : ''}

    ${c.status === 'revoked' ? '' : `
    <form method="post" action="/dashboard/${esc(channel.slug)}/networks/${esc(c.id)}/revoke"
          style="margin-top:var(--space-6)">
      <button class="btn btn-sm btn-danger" type="submit">Disconnect</button>
      <span class="fine">Callbacks from it stop being accepted immediately.</span>
    </form>`}
  </div>`;
  };

  // Stacked on a phone, twice over: the Minimum cell reads "no stated minimum via
  // Bank transfer / NPR" and at 390px it was 153px wide on four lines, with the
  // "what you should know" column beside it competing for the same space.
  const offer = ({ provider, onboarding, verdict, note }) => {
    const ok = landingUrlFor(provider, onboarding);
    return `
  <tr>
    <td>
      <strong>${esc(provider.name)}</strong>
      ${provider.enabled ? '' : '<div class="fine">not enabled on this deployment</div>'}
    </td>
    <td data-label="Nepal payout">${pill(verdict?.level || 'unknown', verdict?.level === 'ok' ? 'success' : verdict?.level === 'caution' ? 'warning' : '')}</td>
    <td class="num" data-label="Minimum">${verdict?.thresholdLabel ? esc(verdict.thresholdLabel) : '<span class="fine">no floor</span>'}</td>
    <td class="small" data-label="What you should know">${esc(note || provider._note || '')}</td>
    <td class="num" data-label="Action">${ok
    ? `<form method="post" action="/dashboard/${esc(channel.slug)}/networks">
         <input type="hidden" name="providerId" value="${esc(provider.id)}">
         <button class="btn btn-sm btn-primary" type="submit">Connect</button>
       </form>`
    : ok === '' ? '' : '<span class="fine">no adapter yet</span>'}</td>
  </tr>`;
  };

  // A network we cannot verify is not connectable, so it gets no button — and
  // the table says why rather than leaving a dash to be interpreted.
  function landingUrlFor(provider, onboarding) {
    if (provider.enabled === false && provider.blockedReason) return null;
    if (onboarding.mode === 'paste_credentials' || onboarding.mode === 'none') return 'connect';
    return null;
  }

  return layout({
    title: 'Ad networks', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'networks', 'Ad networks',
    'Where the ad money comes from, whose account it lands in, and the one URL that makes it work.')}

${flash ? `<div class="note note-${flash.kind}" role="status">${esc(flash.message)}</div>` : ''}

<div class="note">
  <strong>The account is yours, and so is the payment.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    We never ask for a network login and we never hold a publisher id. What you save here is the value
    your network signs its callbacks with, and it authorises nothing except the verification of an event
    we were told about. The network pays your account; we are not a party to it and cannot see the balance.
  </p>
</div>

${unusableBase ? `
<div class="note note-warning">
  <strong>This deployment has no public address configured.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    The callback URLs below are built from the address this browser used, which is
    <span class="mono">${esc(base)}</span>. If that is not reachable from the internet, a network cannot call
    it — set <span class="mono">PUBLIC_BASE_URL</span> and reload this page.
  </p>
</div>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Connected</h2>
    <p>${connections.length ? plural(connections.length, 'network') : 'Nothing connected yet'}.</p>
  </div>
  ${connections.length ? connections.map(card).join('') : `
  <div class="empty">
    No network is connected. Until one is, your ad slots show the platform's own house ad — and that is
    what rent buys, so nothing is broken. Connect a network only when you want the space to earn you money.
  </div>`}
</section>

<section class="section">
  <div class="section-head">
    <h2>Networks you could add</h2>
    <p>Sorted by what a creator in Nepal can actually use today. The threshold column is the network's
      own advertised minimum, which is not always the threshold an individual publisher gets.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-stacked">
      <thead><tr><th>Network</th><th>Nepal payout</th><th class="num">Minimum</th><th>What you should know</th><th class="num">Action</th></tr></thead>
      <tbody>${available.map(offer).join('')}</tbody>
    </table>
  </div></div>
  <p class="fine" style="margin-top:var(--space-4)">
    A network with no adapter is listed so you know it exists and what it pays, not because we can
    connect it. You can still open an account there in your own name and record what it reports on your
    earnings page — that is what keeps our estimate honest, and it works without any of this.
  </p>
</section>
`,
  });
}

/**
 * Ad slots — where a creator decides what goes in the space they own, and sees
 * what the space they rented out looks like.
 *
 * Two kinds of slot and they are not interchangeable, so the page never blurs
 * them: the store's own positions (the creator's inventory, no network
 * involved) and the platform's rent slot (our inventory, the consideration for
 * the rent). The rent slot is shown here but not editable, because it is not
 * theirs to fill — that is what renting it means.
 *
 * The preview is the real renderer. A preview that is a drawing of the thing
 * rather than the thing is a preview that lies eventually.
 */
export function slotsPage({
  channel, slots = [], user, consent = null, flash = null,
  // Attempts that produced no verified view, in the window. A count, because that
  // is the only honest thing the platform knows: it cannot tell a blocker from a
  // dropped connection, and `src/blocked.js` is where that refusal is written down.
  blockedCount = 0, blockedHours = 6,
  // Creatives written for positions that no longer exist (ranks 4 and 5 were cut in
  // migration 0034). Listed rather than hidden: a seller's words disappearing with
  // no explanation is the kind of silence this product is built against.
  retiredSlots = [],
}) {
  const own = slots.filter((s) => s.owner === 'channel');
  const rented = slots.filter((s) => s.owner === 'platform');

  const card = (slot) => `
  <div class="card card-pad-lg" id="slot-${esc(slot.slotKey || slot.key)}">
    <div class="row">
      <div>
        <h3 style="font-size:var(--text-md)">${esc(slot.label)}</h3>
        <div class="fine">rank ${num(slot.rank)} of ${num(slots.length)} · ${esc(slot.formats?.join(' / ') || '')}</div>
      </div>
      <span class="spacer"></span>
      ${slot.owner === 'platform'
    ? pill('Platform · rented to ByteBikri', 'warning')
    : slot.serves ? pill('Filled by you', 'success') : pill('Yours · empty', '')}
    </div>

    ${slot.purpose ? `<p class="fine" style="margin-top:var(--space-3)">${esc(slot.purpose)}</p>` : ''}

    ${renderSlot(slot)}

    ${slot.owner === 'platform' ? `
    <p class="fine">
      This is the space the store rents to ByteBikri. You do not fill it: the space itself is what is
      being rented, and it stays in the same position on every page load. Nothing about it follows a
      visitor around the web, and no buyer behaviour is sold.
    </p>` : `
    <form method="post" action="/dashboard/${esc(channel.slug)}/slots">
      <input type="hidden" name="slotKey" value="${esc(slot.slotKey || slot.key)}">
      <div class="field">
        <label for="head-${esc(slot.slotKey || slot.key)}">Headline</label>
        <input class="input" id="head-${esc(slot.slotKey || slot.key)}" name="headline" maxlength="90"
               value="${esc(slot.creative?.owner === 'channel' ? slot.creative.headline : '')}"
               placeholder="New pack out Friday">
      </div>
      <div class="field">
        <label for="body-${esc(slot.slotKey || slot.key)}">Line under it <span class="hint">optional</span></label>
        <input class="input" id="body-${esc(slot.slotKey || slot.key)}" name="body" maxlength="220"
               value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.body || '') : '')}"
               placeholder="Twelve more textures, free to anyone who already bought the first kit.">
      </div>
      <div class="cols-2">
        <div class="field">
          <label for="link-${esc(slot.slotKey || slot.key)}">Link <span class="hint">optional</span></label>
          <input class="input" id="link-${esc(slot.slotKey || slot.key)}" name="linkUrl" maxlength="300"
                 value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.linkUrl || '') : '')}"
                 placeholder="/s/${esc(channel.slug)} or https://…">
        </div>
        <div class="field">
          <label for="cta-${esc(slot.slotKey || slot.key)}">Link label</label>
          <input class="input" id="cta-${esc(slot.slotKey || slot.key)}" name="linkLabel" maxlength="40"
                 value="${esc(slot.creative?.owner === 'channel' ? (slot.creative.linkLabel || '') : '')}"
                 placeholder="See it">
        </div>
      </div>
      <div class="row">
        <button class="btn btn-primary btn-sm" type="submit">Save</button>
        ${slot.creative?.owner === 'channel'
    ? `<button class="btn btn-sm" type="submit" formaction="/dashboard/${esc(channel.slug)}/slots/clear">Clear</button>`
    : ''}
        <span class="spacer"></span>
        <span class="fine">Shown to visitors as “From ${esc(channel.name)}”.</span>
      </div>
    </form>
    <p class="fine" style="margin-top:var(--space-3)">
      Your own message, in your own space. There is nothing to buy here and nobody to pay: this is not
      an ad slot for sale, and selling this space to someone else off-platform would put a stranger's
      content on a page you are responsible for.
    </p>`}
  </div>`;

  return layout({
    title: 'Ad slots', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'slots', 'Ad slots',
    'The space on your pages, who owns each position, and what fills it today.')}

${flash ? `<div class="note note-${flash.kind}" role="status">${esc(flash.message)}</div>` : ''}

<div class="note">
  <strong>Two kinds of space, and one rule about position.</strong>
  <ul class="list-steps" style="margin-top:var(--space-3)">
    <li><strong>Rank 1 is always yours.</strong> The platform never takes the top position — by
      allocation, not by promise. The slot you rent out is the last one on the page.</li>
    <li><strong>Rent is one slot.</strong> One per page, never more, and a page too short to spare a
      slot is never charged for one.</li>
    <li><strong>Networks fill their own space.</strong> When a network is connected to a slot, the
      network serves the ad inside it. We keep no third-party script in our database, and we never run
      a tag from a network we have not verified.</li>
  </ul>
</div>

<section class="section">
  <div class="section-head">
    <h2>Your space</h2>
    <p>${own.length} of ${num(slots.length)} positions, and they appear on every storefront and
      file page you have. ${own.some((s) => !s.serves) ? 'Empty ones hold their height on the page, so nothing jumps when you fill one.' : ''}</p>
  </div>
  <div class="cols-2">${own.length ? own.map(card).join('') : '<p class="fine">No slots allocated on the free-size store yet — they appear when a page is long enough to spare one.</p>'}</div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Rented to the platform</h2>
    <p>The space you are paid for. You can see what is in it; you cannot put anything in it.</p>
  </div>
  ${rented.length ? rented.map(card).join('') : `<div class="note"><p class="small">None of your pages
    has a rent position right now. One is placed only when a page has at least one position of yours
    to sit beneath, so a page is never taxed for space it does not have.</p></div>`}
</section>

<section class="section">
  <div class="section-head">
    <h2>Unlocks that did not confirm</h2>
    <p>A count, and the only thing the platform honestly knows about them.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <p class="small" data-blocked-count="${num(blockedCount)}">${esc(blockedSellerNote(blockedCount, blockedHours))}</p>
    <p class="fine" style="margin-top:var(--space-3)">
      The ladder escalates on the one piece of evidence this platform actually has — a signed postback
      that never arrived — and its harshest end is that one file's unlock stops being offered to that
      person for a few hours. Their account is not touched, the file stays listed, and a membership opens
      the store's member-only files with no ad (it does not open an ad-gated file sooner).
    </p>
    <ul class="fine never-do" style="margin-top:var(--space-3)">
      ${NEVER_DO.map((line) => `<li>${esc(line)}</li>`).join('')}
    </ul>
  </div></div>
</section>

${retiredSlots.length ? `
<section class="section">
  <div class="section-head">
    <h2>Positions that were retired</h2>
    <p>You wrote something for space that no longer exists.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <p class="small">These are not shown to anybody any more, and nothing was deleted:</p>
    <ul class="list-steps" style="margin-top:var(--space-3)">
      ${retiredSlots.map((r) => `<li><strong>${esc(r.label)}</strong> — “${esc(r.headline)}”. Move the words to
        one of your two live positions above and clear this one.</li>`).join('')}
    </ul>
  </div></div>
</section>` : ''}

<div class="note note-warning">
  <strong>What this page does not do.</strong>
  <p class="small" style="margin-top:var(--space-2)">
    Slots on the web are display-class space. Rewarded video — the format that pays several times
    more — runs in the app, where the platform controls the player and can verify a completed view.
    A browser cannot do either, so the same position is worth less here, and no page in this product
    will tell you otherwise.
  </p>
</div>
`,
  });
}

// ---------------------------------------------------------------------------
// Dashboard shell — the pages a seller lives in
// ---------------------------------------------------------------------------

/**
 * The sub-navigation for the account pages.
 *
 * One row of links, the same on every one of them, with the current page marked
 * for assistive technology as well as for the eye. A dashboard whose pages do
 * not link to each other is a set of dead ends, which is what this was before:
 * the only way to billing was to know the URL.
 */
function storeSectionNav(channel, current) {
  const items = [
    ['', 'Overview'],
    ['earnings', 'Earnings'],
    ['billing', 'Billing'],
    ['slots', 'Ad slots'],
    ['networks', 'Ad networks'],
    ['settings', 'Store settings'],
    ['reviews', 'Reviews'],
    // Always shown, including on Free, where the page itself is the answer to
    // "what am I missing" — a seller cannot want a feature nobody has told them
    // about, and hiding it would make the plan comparison the only place it exists.
    ['members', 'Members'],
  ];
  return `<nav class="subnav" aria-label="Store">
    ${items.map(([path, label]) => {
    const href = `/dashboard/${esc(channel.slug)}${path ? `/${path}` : ''}`;
    const isCurrent = current === (path || 'overview');
    return `<a href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  }).join('')}
  </nav>`;
}

/**
 * `21 Sept 2026` — a date someone can read, not an ISO string.
 *
 * Same clock as the badge sentence (`dates.js` → SHOP_TZ). The two forms sit in
 * the same panels — a renewal date and a document check can be the same instant —
 * and a page that said 22 Sept in one row and 23 Sept in the next would be
 * describing one minute two ways.
 */
const day = (d) => (d ? longDay(d) : 'not set');

function pageHead(channel, current, title, lede) {
  return `${storeSectionNav(channel, current)}
<div class="section" style="margin-block:var(--space-6) var(--space-2)">
  <div class="row">
    <h1 style="font-size:var(--text-2xl)">${esc(title)}</h1>
    <span class="spacer"></span>
    <a class="btn btn-sm" href="/s/${esc(channel.slug)}" target="_blank" rel="noopener">View store ↗</a>
  </div>
  ${lede ? `<p class="lede" style="margin-top:var(--space-4)">${lede}</p>` : ''}
</div>`;
}

const flashNote = (flash) => (flash?.message
  ? `<div class="note note-${flash.kind}" role="status" style="margin-top:var(--space-6)">${esc(flash.message)}</div>`
  : '');

// ---------------------------------------------------------------------------
// Billing — the only two things bytebikri charges for
// ---------------------------------------------------------------------------

export function billing({
  channel, user, consent = null, flash = null, plan, nextPlanCode, pending = null, quote, upgrade,
  subscription, invoice, estimate = {}, pageviews = 0, paidTotal = 0, payments = [],
  invoices = [], rails = [], railsReady = false, payee = null, benefits = [],
  notCharged = [], slots = [], addressConfirmed = true,
}) {
  const periodEnd = subscription?.period_end;

  /**
   * The one place an unconfirmed address stops anything.
   *
   * Everything else works without it: signing in, publishing, unlocking, keeping
   * the store live, being paid by the network straight into the store's own
   * account. Submitting a transfer reference is the single exception, because a
   * person on our side matches that transfer by hand against a bank statement and
   * sends the receipt to the address on file. If nobody has answered at that
   * address, the money lands with no way to tell whose it is.
   *
   * The form is REPLACED rather than shown-and-refused: the amount, the account
   * numbers and the working stay visible — the seller needs those to send the
   * money at all — and only the last step is held. Telling somebody to do
   * something and then refusing it is how a person concludes the page is broken.
   */
  const verifyGate = (kind) => `
    <div class="note note-warning" style="margin-top:var(--space-5)">
      <strong>Confirm the email address on this account, then submit the reference.</strong>
      A transfer is matched to a person by hand, and the receipt goes to the address on file.
      ${user?.email ? `<span class="mono">${esc(user.email)}</span> has` : 'Your address has'}
      not been confirmed yet, so a reference sent now would have nowhere to land — and an operator
      would have no way to ask you about it.
      <div style="margin-top:var(--space-4)">
        <a class="btn btn-sm btn-primary" href="/verify">Confirm it — takes a minute</a>
      </div>
      <p class="fine" style="margin-top:var(--space-3)">
        Nothing else is held back by this: the ${esc(kind)} is still yours to send — only the last
        step waits.
      </p>
    </div>`;

  const railList = rails.filter((r) => r.id !== 'other');

  const payTo = railList.map((r) => `
    <div class="rail${r.ready ? '' : ' rail-off'}">
      <div class="rail-name">${esc(r.label)}</div>
      ${r.ready
      ? `<div class="rail-value mono">${esc(r.handle || (r.id === 'other' ? 'Ask an operator' : 'not on file'))}</div>`
      : `<div class="rail-value muted">not configured</div>
         <div class="fine">Set <span class="mono">${esc(r.env)}</span> on the server to show this.</div>`}
    </div>`).join('');

  const payForm = (kind) => `
    <form method="post" action="/dashboard/${esc(channel.slug)}/billing/${kind}-payment" class="pay-form">
      <input type="hidden" name="invoiceId" value="${kind === 'rent' ? esc(invoice?.id || '') : ''}">
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 160px">
          <label for="m-${kind}">Paid with</label>
          <select class="input" id="m-${kind}" name="method">
            ${railList.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}
            <option value="other">Something else</option>
          </select>
        </div>
        <div class="field" style="flex:2 1 220px">
          <label for="r-${kind}">Transaction reference</label>
          <input class="input" id="r-${kind}" name="txnReference" required minlength="4" maxlength="120"
                 autocomplete="off" placeholder="e.g. 8FJ2K19QW">
          <span class="hint">From the wallet receipt or the bank slip. This is what an operator
          matches against the statement.</span>
        </div>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 200px">
          <label for="n-${kind}">Name on the transfer <span class="muted">(optional)</span></label>
          <input class="input" id="n-${kind}" name="payerName" maxlength="120">
        </div>
        <div class="field" style="flex:1 1 200px">
          <label for="p-${kind}">Number used <span class="muted">(optional)</span></label>
          <input class="input" id="p-${kind}" name="payerNumber" maxlength="40" inputmode="tel">
        </div>
      </div>
      <button class="btn btn-primary" type="submit">I have sent it — submit the reference</button>
      <p class="fine" style="margin-top:var(--space-3)">
        Nothing is activated by this form. It records what you say you sent; an operator matches it
        against the statement and only then does anything change.
      </p>
    </form>`;

  const subPanel = `
<div class="panel">
  <div class="panel-head">
    <h2>Store plan</h2>
    <span class="spacer"></span>
    ${pill(plan.name, plan.code === 'free' ? '' : 'accent')}
  </div>
  <div class="panel-body">
    <dl class="kv">
      <dt>Price</dt><dd>${plan.priceNpr ? `${npr(plan.priceNpr)} a year` : 'Free, permanently'}</dd>
      <!-- "Runs until", not "Renews": nothing here renews by itself, and the rest of
           the product says so in as many words. A label promising a renewal on a date
           is the one claim this page cannot make while the rail is a transfer a person
           matches by hand. -->
      <dt>Runs until</dt><dd>${periodEnd ? day(periodEnd) : 'No period running — nothing renews by itself'}</dd>
      <dt>Status</dt><dd>${subscription ? esc(subscription.status.replace('_', ' ')) : 'free'}${pending ? ' · upgrade requested' : ''}</dd>
      <dt>Paid with bytebikri</dt><dd>${npr(paidTotal)} to date</dd>
    </dl>
    <ul class="list-checks" style="margin-top:var(--space-5)">
      ${benefits.map((b) => `<li>${esc(b)}</li>`).join('')}
    </ul>

    ${pending ? `
      <div class="note note-${pending.reference ? 'info' : 'warning'}" style="margin-top:var(--space-5)">
        <strong>${pending.reference ? 'Reference received — waiting to be matched.' : 'Waiting to be matched.'}</strong>
        Your upgrade to ${esc(pending.name)} is ${pending.reference ? 'submitted' : 'requested'}, for
        ${npr(pending.amountNpr)}.
        ${pending.reference
          ? `An operator matches <span class="mono">${esc(pending.reference)}</span> against the
             ${esc(pending.method || '')} statement, and the plan changes when it clears. You do not
             need to do anything else.`
          : 'Send it to one of the accounts below, then submit the reference from the receipt.'}
      </div>
      ${pending.reference ? '' : (addressConfirmed ? payForm('plan') : verifyGate('amount'))}
      <p class="fine" style="margin-top:var(--space-4)">
        Your ${esc(plan.name)} plan stays exactly as it is until the money is matched — asking for an
        upgrade never takes away what you have already paid for.
      </p>
    ` : quote ? `
      <div class="note note-info" style="margin-top:var(--space-5)">
        <strong>Upgrade to ${esc(quote.to.name)}.</strong>
        <ul class="list-plain" style="margin-top:var(--space-3)">
          ${(upgrade?.lines || []).map((l) => `<li class="fine" style="border:0;padding:2px 0">${esc(l)}</li>`).join('')}
        </ul>
        <div class="amount-line">
          <span>Due today</span>
          <strong>${npr(quote.amountNpr)}</strong>
        </div>
        <form method="post" action="/dashboard/${esc(channel.slug)}/upgrade">
          <input type="hidden" name="plan" value="${esc(nextPlanCode)}">
          <button class="btn btn-primary" type="submit">Request this upgrade</button>
        </form>
        <p class="fine" style="margin-top:var(--space-3)">
          Requesting it does not charge anything and does not switch it on. It tells us what you
          want and gives you the account details to pay into.
        </p>
      </div>
    ` : `
      <p class="small" style="margin-top:var(--space-5)">
        You are on the top plan. There is nothing above this one to sell you.
      </p>
    `}
  </div>
</div>`;

  // Rent: an invoice, or the reason there is not one. Both are answers.
  const rentPanel = (() => {
    const working = invoice?.basis || {};
    const rows = `
      <dl class="kv">
        <dt>Traffic</dt><dd>${plural(working.pageviews30d ?? estimate.pageviews30d ?? pageviews, 'view')} in 30 days</dd>
        <dt>Slots on your pages</dt><dd>${num(working.slotsOnPage ?? estimate.total ?? 0)} — you keep
          ${num((working.slotsOnPage ?? estimate.total ?? 0) - (working.rentSlots ?? estimate.rent ?? 0))}</dd>
        <dt>Platform slot</dt><dd>${num(working.rentSlots ?? estimate.rent ?? 0)}${
      (working.rentSlots ?? estimate.rent ?? 0) ? ' — one per page, last rank' : ' — none, so no rent'}</dd>
        <dt>Assumed ad rate</dt><dd>$${Number(working.assumedRpmUsd ?? estimate.rpmUsd ?? 0).toFixed(2)} per 1,000 views</dd>
      </dl>`;

    if (!invoice) {
      // Two different reasons produce no invoice, and saying the wrong one is
      // how a seller concludes the page is lying to them. Either there is no
      // platform slot to rent (a page too short to spare one), or there is a
      // slot and it earned nothing because the traffic did not arrive. The
      // second is not a bill of zero, it is an absence of traffic, and the
      // sentence says which.
      const rentSlots = working.rentSlots ?? estimate.rent ?? 0;
      const views = working.pageviews30d ?? estimate.pageviews30d ?? pageviews;
      const why = rentSlots === 0
        ? `The platform rents one slot per page — always the last, never the first — and only on a
           page with at least three. Your pages are shorter than that, so there is nothing rented
           and nothing to invoice.`
        : `There is a platform slot on your pages, and it earned nothing this period:
           ${plural(views, 'view')} is not enough traffic to be worth billing. Rent is a share of
           the value the platform actually brought you, so a quiet period costs nothing.`;

      return `
<div class="panel">
  <div class="panel-head"><h2>Rent for the platform slot</h2></div>
  <div class="panel-body">
    <div class="note note-success">
      <strong>Nothing is due.</strong> ${why}
    </div>
    ${rows}
    <p class="fine" style="margin-top:var(--space-4)">
      When a page of yours has three or more slots, one of them — always the last, never the first —
      rents to the platform, and this page grows an invoice for it on your anniversary.
    </p>
  </div>
</div>`;
    }

    const statusNote = invoice.status === 'paid'
      ? `<div class="note note-success"><strong>Paid.</strong> Matched ${day(invoice.paid_at)} — thank you.</div>`
      : invoice.status === 'submitted'
        ? `<div class="note note-info"><strong>Reference received.</strong> Waiting for an operator to
           match it against the statement. Reference
           <span class="mono">${esc(invoice.txn_reference || '')}</span>.</div>`
        : '';

    return `
<div class="panel">
  <div class="panel-head">
    <h2>Rent for the platform slot</h2>
    <span class="spacer"></span>
    ${pill(invoice.status, invoice.status === 'paid' ? 'success' : invoice.status === 'submitted' ? 'info' : 'warning')}
  </div>
  <div class="panel-body">
    ${statusNote}
    <div class="amount-line" style="margin-top:var(--space-4)">
      <span>${day(invoice.period_start)} → ${day(invoice.period_end)}</span>
      <strong>${npr(invoice.amount_npr)}</strong>
    </div>
    ${rows}
    <p class="fine" style="margin-top:var(--space-4)">
      This is the working, in full: one rent slot's share of thirty days of pageview value, times
      twelve. It is an estimate at an assumed rate, not a statement — you can check every number in it.
    </p>
    ${invoice.status === 'issued' ? (addressConfirmed ? payForm('rent') : verifyGate('amount')) : ''}
  </div>
</div>`;
  })();

  const history = invoices.length || payments.length
    ? `
<div class="panel">
  <div class="panel-head"><h2>What you have paid bytebikri</h2></div>
  <div class="panel-body panel-body-flush">
    <!-- Five columns, stacked on a phone. The rent rows and the upgrade rows are
         two shapes in one table, and the upgrade rows had four cells — so on a
         desktop the money an upgrade cost sat under "Due" and its state under
         "Amount", and the last column was empty. A due date is the one thing an
         upgrade does not have, so it says so. -->
    <table class="table table-stacked">
      <thead><tr><th>What</th><th>Period</th><th>Due</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>
        ${invoices.map((i) => {
    // The seller is the person who OWES this money, so the due date belongs on
    // their page first. It was on the operator's aging view and nowhere here,
    // which is a strange way round: the operator's next action depends on the
    // date, and the seller's ability to avoid being late depends on it too.
    const age = rentAge(i.due_at);
    const settled = i.status === 'paid' || i.status === 'waived' || i.status === 'void';
    return `<tr>
          <td>Rent</td>
          <td class="nowrap" data-label="Period">${day(i.period_start)} → ${day(i.period_end)}</td>
          <td class="nowrap" data-label="Due">${i.due_at ? esc(isoDay(i.due_at)) : '<span class="fine">—</span>'}${
    settled || !i.due_at ? '' : `<div class="fine">${
      age.level === 'current' ? esc(age.label) : `<strong>${esc(age.label)}</strong>`}</div>`}</td>
          <td class="num" data-label="Amount">${npr(i.amount_npr)}</td>
          <td data-label="Status">${pill(i.status, i.status === 'paid' ? 'success' : i.status === 'submitted' ? 'info' : 'warning')}</td>
        </tr>`;
  }).join('')}
        ${payments.map((p) => `<tr>
          <td>Plan · ${esc(p.plan_code)}</td>
          <td class="nowrap" data-label="Period">${day(p.created_at)}</td>
          <td data-label="Due"><span class="fine">—</span></td>
          <td class="num" data-label="Amount">${npr(p.amount_npr)}</td>
          <td data-label="Status">${pill(p.status, p.status === 'matched' ? 'success' : p.status === 'rejected' ? 'danger' : 'info')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`
    : '';

  return layout({
    title: 'Billing', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'billing', 'Billing', `Two things cost money here, and both are yours to pay.
      Nothing is taken from what your store earns.`)}
${/* The page's own sentences.
     *
     * This view took a `flash` prop and never rendered it, and on the two pages in
     * the product that take money that made six sentences unreachable: the two
     * successes ("Reference received…", "Upgrade requested…") and the four refusals
     * (?error=verify, nothing, reference, plan) whose copy was written for exactly
     * the moments a seller is most likely to be confused — a reference typed two
     * characters long, a submission with nothing waiting, an unconfirmed address.
     *
     * It was found by walking the upgrade in a browser: the redirect arrived, the
     * page came back, and the sentence the route had chosen was simply absent. The
     * view tests never caught it because they call `views.billing()` directly with
     * the data they want to see, and the flash is data like any other — a view that
     * ignores a prop it accepts is invisible to a test that hands it a different one. */''}
${flashNote(flash)}

<div class="section">
  <div class="cols-2">
    ${subPanel}
    ${rentPanel}
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>Where to send it</h2>
      <span class="spacer"></span>
      ${railsReady ? '' : pill('not configured yet', 'warning')}
    </div>
    <div class="panel-body">
      ${payee ? `<p class="small">Payable to <strong>${esc(payee)}</strong>.</p>` : ''}
      <div class="rail-grid">${payTo}</div>
      <p class="fine" style="margin-top:var(--space-5)">
        There is no card checkout, and that is not an oversight: no acquirer in this market will
        settle to a Nepal-registered entity for this shape of business. So payment is a transfer to
        one of the accounts above, matched by hand against the statement — which is also why your
        reference matters more than usual.
      </p>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head"><h2>What you are not charged for</h2></div>
    <div class="panel-body">
      <ul class="list-checks">
        ${notCharged.map((n) => `<li>${esc(n)}</li>`).join('')}
      </ul>
    </div>
  </div>

  ${history}
</div>`,
  });
}

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

/**
 * The look of the store.
 *
 * A row of swatches, not a colour picker, and the reason is on the page rather
 * than in a comment: each one is checked for readability before it can be offered.
 * The card that shows the choice IS the preview — the band with the store's own
 * name on it, painted with the theme's palette at the alpha the storefront uses —
 * so a seller sees the actual thing and not a coloured square.
 *
 * Free stores see the same list, dimmed, with the one sentence that says what the
 * plan adds and what they keep. Hiding it would be the other kind of lie: a
 * feature nobody knows about is a feature nobody buys, and this product's plans
 * page has already spent three migrations selling this one without a reader.
 */
function themeChooser({ channel, themes, canTheme }) {
  const current = channel.theme ?? null;
  const card = (key, label, note, style, animated) => {
    const active = key === current;
    return `<form method="post" action="/dashboard/${esc(channel.slug)}/theme" class="theme-card${active ? ' theme-card--on' : ''}"
            data-theme-card="${esc(key)}" data-theme-label="${esc(label)}" data-theme-style="${esc(style)}">
      <input type="hidden" name="theme" value="${esc(key)}">
      <button class="theme-pick" type="submit"${canTheme ? '' : ' disabled'}
              aria-pressed="${active ? 'true' : 'false'}">
        <span class="theme-band${style ? '' : ' theme-band--plain'}" style="${style}" aria-hidden="true">
          <span class="theme-band-name">${esc(channel.name)}</span>
        </span>
        <span class="theme-body">
          <span class="theme-title">${esc(label)}${animated ? '<span class="theme-motion" title="drifts slowly, and stops for anyone who asks for less motion">· moves</span>' : ''}${canTheme ? '' : '<span class="theme-lock">Store plan</span>'}</span>
          <span class="fine">${esc(note)}</span>
        </span>
      </button>
    </form>`;
  };

  const plain = card(NO_THEME, 'Default', 'The storefront every store has: no tint, no motion, nothing to decide.',
    '', false);

  /*
   * THE STAGE: the real band, at full width, before anything is saved.
   *
   * The cards below are already previews of their own palette — but a 58-pixel card
   * cannot show a seller what a whole band does, and the interesting part of a paid
   * theme is that it MOVES. So the stage is the storefront's own band markup: the same
   * `.store-head--themed` class, the same aurora and grain, the store's own name and
   * tagline on it. Pointing at a card (or tabbing to it) paints the stage; pressing the
   * card saves as it always did, in one click.
   *
   * The stage is not a second implementation of anything. It is the band component
   * rendered here with the seller's own words, which is the only kind of preview that
   * cannot drift from the thing it previews.
   */
  const currentLabel = current ? (themeOf(current)?.label ?? 'Default') : 'Default';
  const stage = `<div class="theme-stage" data-theme-stage
      data-current-style="${esc(themeStyle(current) || '')}" data-current-label="${esc(currentLabel)}"
      data-slug="${esc(channel.slug)}">
    <div class="store-head${current ? ' store-head--themed' : ''}" data-theme-stage-band style="${themeStyle(current) || ''}">
      <div class="row">
        ${storeMark({ ...channel, theme: current }, { paint: false })}
        <h1>${esc(channel.name)}</h1>
        ${pill('Preview', 'accent')}
      </div>
      <p class="lede" style="margin-top:var(--space-3)">${esc(channel.tagline || 'A store on ByteBikri.')}</p>
      <div class="store-meta">
        <span>Your header, at the size your store shows it</span>
      </div>
    </div>
    <p class="fine" data-theme-stage-line>Showing <strong>${esc(currentLabel)}</strong>${canTheme
    ? ' — point at a card to see it here, and press the card to keep it.'
    : ' — the plan includes the rest of the list.'}</p>
  </div>`;

  return `${stage}
  <div class="theme-grid">
    ${plain}
    ${themes.map((t) => card(t.key, t.label, t.note, themeStyle(t.key), t.animated)).join('')}
  </div>
  ${canTheme
    ? `<p class="fine">${esc(THEME_NOTE)} ${themeMotionLine(channel.theme)}</p>`
    : `<p class="fine">${esc(THEME_FREE_LINE)}</p>
       <a class="btn btn-sm btn-primary" href="/dashboard/${esc(channel.slug)}/billing">See what the plan adds</a>`}`;
}

/**
 * What moves, said for the theme the store currently has.
 *
 * The sentence is `motionNote` from themes.js rather than a second copy here: the
 * question "will my shop move now" is answered by the same string the module that
 * knows whether a palette animates can produce, and two copies of that answer is
 * how a page ends up promising stillness for a theme that drifts.
 */
function themeMotionLine(key) {
  return `${motionNote(key)} The rest of the page never moves with it.`;
}

export function storeSettings({
  channel, user, consent = null, flash = null, plan, canList = false,
  subscription = null, stats = {}, verification = null, pendingRequest = null, capabilities = {},
  // The storefront's look: the curated palettes, and whether this plan may pick one.
  themes = [], canTheme = false,
}) {
  // Who is behind the store. Shown as a state, not a score: the panel says what a
  // check is, what it costs nobody, and what we keep (the outcome — never a copy).
  //
  // Two facts, kept apart on purpose. `vState` is what the BADGE is (`none`,
  // `verified`, `expired`, `rejected`) and comes from the last decided row; the open
  // request is separate, because a seller can be waiting on the next check while the
  // current one still counts — and if these were one row, asking in good time would
  // take the badge down.
  const vState = stateOf(verification);
  const lapse = lapseOf(verification);
  const waiting = Boolean(pendingRequest);
  const ask = requestability({
    capabilities,
    state: vState,
    pending: waiting,
    // Both research findings point the same way: prompt EARLY (60 days here, a month
    // at the very latest) and do NOT take the mark away while you are prompting for
    // the renewal. What makes the renewal form appear is being INSIDE that window —
    // not merely holding a live check, which would offer a renewal eighteen months
    // out and turn the one open window into a permanent button.
    lapsing: withinNoticeWindow(lapse),
  });
  const asked = pendingRequest ? longDay(pendingRequest.created_at) : null;
  // When asking opens again. Printed as a date rather than "in 548 days": the seller
  // is planning a trip to an office, not counting a timer.
  const windowOpens = verification?.expires_at
    ? new Date(new Date(verification.expires_at).getTime() - LAPSE_WINDOW_DAYS * 86400000)
    : null;
  const withdrawForm = () => `
    <form method="post" action="/dashboard/${esc(channel.slug)}/verification/withdraw" style="margin-top:var(--space-4)">
      <button class="btn btn-sm" type="submit">Withdraw the request</button>
      <!-- A block, not an inline span: beside a button the sentence wrapped under it
           and read as though it belonged to the button's own line. Fine print that
           qualifies an action goes UNDER the action. -->
      <p class="fine" style="margin:var(--space-3) 0 0">Nothing else changes: withdrawing does not touch a check that is already on file.</p>
    </form>`;
  return layout({
    title: 'Store settings', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'settings', 'Store settings', 'How your store looks, where it is listed, and how it behaves.')}
${flashNote(flash)}

<div class="section">
  <form class="cols-2" method="post" enctype="multipart/form-data"
        action="/dashboard/${esc(channel.slug)}/settings">

    <div class="panel">
      <div class="panel-head"><h2>Identity</h2></div>
      <div class="panel-body">
        <div class="field">
          <label for="s-name">Store name</label>
          <input class="input" id="s-name" name="name" required maxlength="120" value="${esc(channel.name)}">
        </div>
        <div class="field">
          <label for="s-tagline">One line about it</label>
          <input class="input" id="s-tagline" name="tagline" maxlength="200"
                 value="${esc(channel.tagline || '')}"
                 placeholder="What you sell, and to whom.">
          <span class="hint">This is the line under your name on Explore and on every file page.</span>
        </div>
        <div class="field">
          <label for="s-about">About <span class="muted">(optional)</span></label>
          <textarea class="textarea" id="s-about" name="about" rows="5" maxlength="4000"
                    placeholder="Who you are, what you make, how you handle a broken file.">${esc(channel.about || '')}</textarea>
        </div>
        <div class="field">
          <label for="s-contact">Public contact <span class="muted">(optional)</span></label>
          <input class="input" id="s-contact" name="channelContact" maxlength="320"
                 value="${esc(channel.channel_contact || '')}"
                 placeholder="An email or a page, not a personal number.">
          <span class="hint">Shown to buyers. Your account email and phone are never shown —
          a buyer cannot use this store to find you.</span>
        </div>
      </div>
    </div>

    <div>
      <div class="panel">
        <div class="panel-head">
          <h2>Banner</h2>
          <span class="spacer"></span>
          ${channel.banner_url ? pill('set', 'success') : pill('none')}
        </div>
        <div class="panel-body">
          ${channel.banner_url
    ? `<img class="settings-banner" src="${esc(channel.banner_url)}" alt="" loading="lazy" decoding="async">`
    : `<div class="settings-banner settings-banner-empty"><span>No banner yet</span></div>`}
          <div class="field" style="margin-top:var(--space-4)">
            <label for="s-banner">Replace it</label>
            <input class="input" id="s-banner" name="banner" type="file" accept="image/*">
            <span class="hint">Wide and short works best — it is cropped to a band, not a square.
            Images up to 5 MB.</span>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:var(--space-6)">
        <div class="panel-head"><h2>Where you are listed</h2></div>
        <div class="panel-body">
          <label class="choice">
            <input type="radio" name="listingMode" value="storefront"
                   ${channel.listing_mode === 'marketplace' ? '' : 'checked'}>
            <span>
              <strong>My own address</strong>
              <span class="fine">Your store works at its link and is found by the people you send
              there. Free, permanently, and no plan needed.</span>
            </span>
          </label>
          <label class="choice">
            <input type="radio" name="listingMode" value="marketplace"
                   ${channel.listing_mode === 'marketplace' ? 'checked' : ''}
                   ${canList ? '' : 'disabled'}>
            <span>
              <strong>Listed in Explore</strong>
              <span class="fine">bytebikri brings the traffic, so this is what the paid plans buy.
              ${canList
    ? 'Included in your plan.'
    : `Your ${esc(plan.name)} plan does not include it — see the billing page.`}</span>
            </span>
          </label>
          <p class="fine" style="margin-top:var(--space-4)">
            A store keeping to its own address is never listed, never in search, and never shown to
            anybody you did not send. That is what the setting means, not a temporary state.
          </p>
        </div>
      </div>

      <div class="panel" style="margin-top:var(--space-6)">
        <div class="panel-head"><h2>Behaviour</h2></div>
        <div class="panel-body">
          <label class="check">
            <input type="checkbox" name="adsEnabled" ${channel.ads_enabled ? 'checked' : ''}>
            <span>Serve ads on my pages</span>
          </label>
          <p class="fine">
            Turning this off stops the ads immediately and leaves everything else alone: your files
            stay published, your unlocks keep working. Use it if a campaign is running elsewhere.
          </p>
          <label class="check" style="margin-top:var(--space-5)">
            <input type="checkbox" name="sellsDigital" ${channel.sells_digital ? 'checked' : ''}>
            <span>I publish digital files</span>
          </label>
          <label class="check">
            <input type="checkbox" name="sellsPhysical" ${channel.sells_physical ? 'checked' : ''}>
            <span>I also sell something physical</span>
          </label>
          <p class="fine">
            Physical items are recorded, not shipped by us: bytebikri handles no money and no
            delivery. It only tells buyers what to expect.
          </p>
        </div>
      </div>
    </div>

    <div class="form-foot">
      <button class="btn btn-primary" type="submit">Save settings</button>
      <span class="fine">Changes are visible immediately.</span>
    </div>
  </form>

  <section class="section" id="theme">
    <div class="section-head">
      <h2>The look of your store</h2>
      <p>A band of colour behind your name on your storefront. Nothing below it changes: your files,
        the buttons on them and your members' plates keep the product's colours.</p>
    </div>
    ${themeChooser({ channel, themes, canTheme })}
  </section>

  <section class="section" id="verification">
    <div class="section-head">
      <h2>Verification</h2>
      <p>Who is behind the store, checked by a person. It is the one thing on this
      platform that is about you rather than your files.</p>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2 style="font-size:var(--text-md)">${esc(waiting && vState !== 'verified' ? STATE_WORDING.pending : STATE_WORDING[vState])}</h2>
        <span class="spacer"></span>
        ${vState === 'verified' ? pill('Shown on your store', 'success') : ''}
        ${vState === 'verified' && lapse && lapse.level !== 'current' ? pill(lapse.label, lapse.level === 'lapsed' ? 'warning' : 'info') : ''}
      </div>
      <div class="panel-body">
        ${vState === 'verified' ? `
          <p class="small">${esc(badgeFor(verification).sentence)}</p>
          ${verification.document_destroyed_at ? `<p class="fine">The copy you handed over was destroyed on
            ${esc(longDay(verification.document_destroyed_at))} — the outcome is recorded, and nothing of the
            document is left here.</p>` : ''}
          <p class="fine" style="margin-top:var(--space-3)">
            It lapses on ${esc(longDay(verification.expires_at))}${lapse && lapse.level !== 'current' ? ` <strong>(${esc(lapse.label)})</strong>` : ''}.
            A person here works the list of checks that are close to their date and will write to you about two
            months before — but this panel is the record either way, and nothing about your files changes
            when the badge comes down.
          </p>` : ''}
        ${vState === 'verified' && waiting ? `
          <!-- Checked, and waiting on the next one. Both facts, both said: this is
               the ordinary renew-early path, and the panel would be lying by
               omission if it showed the badge and stayed quiet about the request —
               the seller would ask again, and we would be looking at the same
               document twice. -->
          <p class="small" style="margin-top:var(--space-4)">You asked for the next check on ${esc(asked)}, and it is with
          us. The check above keeps counting to its own date, so your badge stays up while a person gets to it.</p>
          ${pendingRequest.request_note ? `<p class="fine">You wrote: “${esc(pendingRequest.request_note)}”</p>` : ''}
          ${withdrawForm()}` : ''}
        ${waiting && vState !== 'verified' ? `
          <p class="small">You asked on ${esc(asked)}. A person looks at one document and records what they saw —
          this is done by hand, in the order requests arrive.</p>
          ${pendingRequest.request_note ? `<p class="fine">You wrote: “${esc(pendingRequest.request_note)}”</p>` : ''}
          ${withdrawForm()}` : ''}
        ${vState === 'rejected' ? `
          <p class="small">The last check did not go through.</p>
          ${verification.document_destroyed_at ? `<p class="fine">The copy you handed over was destroyed on
            ${esc(longDay(verification.document_destroyed_at))}, refusal or not — a decision is a decision.</p>` : ''}
          ${verification.notes ? `<p class="fine">What the person noted: “${esc(verification.notes)}”</p>` : ''}
          <p class="fine">It is not a finding against you, and it changes nothing about your store. Show the same
          document again, or a different one.</p>` : ''}
        ${vState === 'expired' ? `
          <p class="small">The last check was on ${esc(longDay(verification.verified_at || verification.decided_at))}
          and stopped counting on ${esc(longDay(verification.expires_at))}. Nothing was revoked — a proof of who
          somebody is ages, so it is looked at again rather than assumed for ever.</p>` : ''}

        ${documentBlock({ channel, pendingRequest, openRequest: waiting })}
        ${ask.ok ? `
          <form method="post" action="/dashboard/${esc(channel.slug)}/verification"
                enctype="multipart/form-data" style="margin-top:var(--space-5)">
            ${ask.detail ? `<p class="small" style="margin-bottom:var(--space-4)">${esc(ask.detail)}</p>` : ''}
            <div class="field">
              <label for="v-note">Anything we need to know to reach you? <span class="muted">(optional)</span></label>
              <input class="input" id="v-note" name="note" maxlength="280"
                     placeholder="Where you are, or when to call.">
              <span class="hint">Logistics only. <strong>Do not paste a document number here</strong> —
              nobody needs it in writing, and this field is kept.</span>
            </div>
            <div class="field">
              <label for="v-doc-ask">The document itself <span class="muted">(optional — you can send it later, or show it in person)</span></label>
              <input class="input" id="v-doc-ask" type="file" name="document"
                     accept="${Object.keys(ALLOWED_TYPES).join(',')}">
              <span class="hint">A photo of the page is exactly right: ${Object.values(ALLOWED_TYPES).map((t) => t.label.replace(/ (photo|image)$/, '')).join(', ')}
              up to ${Math.round(MAX_BYTES / 1024 / 1024)} MB. Many phones save a photo as HEIC — if it is refused, change the camera setting to
              “most compatible”, or send a screenshot instead.</span>
            </div>
            <button class="btn btn-primary" type="submit">${vState === 'verified' ? 'Ask for the next check' : 'Ask for a check'}</button>
          </form>` : `
          <p class="fine" style="margin-top:var(--space-4)">${esc(ask.reason || '')}
          ${ask.code === 'already-checked' && lapse ? esc(`It stops counting on ${longDay(verification.expires_at)}, and asking opens again on ${longDay(windowOpens)} — the last two months, so the document is fresh when a person looks at it and your badge never has a gap in it.`) : ''}
          ${ask.code === 'plan' ? esc(ask.detail || '') : ''}</p>`}
      </div>
    </div>

    <div class="panel" style="margin-top:var(--space-6)">
      <div class="panel-head"><h2 style="font-size:var(--text-md)">What a check is, and what it is not</h2></div>
      <div class="panel-body">
        <ul class="list-plain">
          ${whatItMeans().map((line) => `<li>${esc(line)}</li>`).join('')}
        </ul>
        <p class="fine" style="margin-top:var(--space-4)">
          The document to have ready is usually a citizenship certificate, or the PAN card a freelancer
          here registers for — free, issued in days, and QR-verifiable from the Nagarik App. A passport,
          or a business registration if you sell as a firm, works too.
        </p>
      </div>
    </div>
  </section>

  <div class="panel" style="margin-top:var(--space-8)">
    <div class="panel-head"><h2>Your store as buyers see it</h2></div>
    <div class="panel-body">
      <!-- The badge, rendered by the same function the storefront uses, so an
           owner does not have to open their own shop in another tab to find out
           what it says. It is absent for most stores most of the time, and that
           is the honest default: there is no grey "unverified" mark. -->
      <dl class="kv">
        <dt>Address</dt><dd class="mono">/s/${esc(channel.slug)}</dd>
        <dt>Identity</dt><dd>${verifiedBadge(verification, { withSentence: true }) || '<span class="fine">No check on file. Nothing on your store says otherwise — a store nobody has checked looks exactly like a new one.</span>'}</dd>
        <dt>Listed</dt><dd>${channel.listing_mode === 'marketplace' ? 'In Explore' : 'Own address only'}</dd>
        <dt>Plan</dt><dd>${esc(plan.name)}${subscription?.period_end ? ` · runs until ${day(subscription.period_end)}` : ''}</dd>
        <dt>Reviews</dt><dd>${stats.count
    ? `${Number(stats.average).toFixed(1)} from ${plural(stats.count, 'review')}`
    : 'None yet'}</dd>
      </dl>
    </div>
  </div>
</div>`,
  });
}

// ---------------------------------------------------------------------------
// Reviews, from the seller's side
// ---------------------------------------------------------------------------

export function dashboardReviews({ channel, user, consent = null, flash = null, reviews = [], stats = {} }) {
  const rows = reviews.map((r) => `
    <li class="review">
      <div class="review-head">
        <span class="stars" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
        <a href="/s/${esc(channel.slug)}/a/${esc(r.asset_slug)}">${esc(r.asset_title)}</a>
        <span class="spacer"></span>
        <span class="fine">${relTime(r.created_at)}</span>
      </div>
      <p class="review-body">${esc(r.body || '')}</p>
      ${r.seller_response
    ? `<div class="review-reply">
           <span class="fine">Your reply · ${relTime(r.seller_responded_at)}</span>
           <p>${esc(r.seller_response)}</p>
         </div>`
    : `<form class="review-form" method="post"
             action="/dashboard/${esc(channel.slug)}/reviews/${esc(r.id)}">
         <input class="input" name="response" maxlength="2000" required
                placeholder="Reply once — it appears under the review.">
         <button class="btn btn-sm" type="submit">Reply</button>
       </form>`}
    </li>`).join('');

  return layout({
    title: 'Reviews', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'reviews', 'Reviews', `Written only by people who unlocked the file. You get one
      reply each, and it stays attached.`)}
${flashNote(flash)}

<div class="section">
  <div class="stat-row">
    <div class="stat"><div class="stat-value">${stats.count ? Number(stats.average).toFixed(1) : 'none yet'}</div>
      <div class="stat-label">Average</div></div>
    <div class="stat"><div class="stat-value">${num(stats.count || 0)}</div><div class="stat-label">Reviews</div></div>
  </div>

  ${reviews.length
    ? `<ul class="review-list">${rows}</ul>`
    : `<div class="empty" style="margin-top:var(--space-8)">
         No reviews yet. They arrive when somebody unlocks a file and writes one — there is no way
         to invite them, and no way to write one for yourself.
       </div>`}
</div>`,
  });
}

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
  // The store's files, published or paused: the tier editor says what is behind
  // each tier, and the answer has to be the seller's real list, not the public one.
  files = [],
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
    const t = tierByNo(tiers, tierNo)
      || { tier_no: tierNo, name: defaultTierName(tierNo), dues_npr: 0, period_months: 1, perks: null, accent: 'indigo', glyph: null };
    const plate = plateStyle(tierNo);
    const holders = members.filter((m) => Number(m.tier_no) === tierNo).length;
    // A seller editing what a tier costs should be able to see what it currently
    // gives away, without opening five file pages. Read from the same list the
    // storefront reads, so the two cannot disagree about what is behind the door.
    const behind = files.filter((a) => a.unlock_mode === 'members' && (Number(a.member_tier) || 1) <= tierNo);
    // Which door this tier currently has, read back out of the pure rule rather than
    // off the column: the picker and the page can then never show different things.
    const doors = doorsOf(t);
    const joinModeNow = doors.dues && doors.attention ? 'both' : doors.attention ? 'attention' : 'dues';
    const joinModeOptions = JOIN_MODES.map((m) => `<option value="${m}"${joinModeNow === m ? ' selected' : ''}>${esc(JOIN_MODE_LABEL[m])}</option>`).join('');
    const accentOptions = ACCENT_KEYS.map((k) => `<option value="${k}"${t.accent === k ? ' selected' : ''}>${esc(ACCENTS[k].label)}</option>`).join('');
    /*
     * The glyph picker is a row of SHAPES rather than a list of words, and that is the
     * whole reason it is not another `<select>`. Asking a seller to choose between the
     * words "Star" and "Spark" is asking them to imagine the thing they are buying; the
     * tiles are drawn in this tier's own ink, at the size the chip will show them, so
     * the choice is made by looking at it. "No mark" is a tile of equal size and equal
     * position, because clearing a decoration has to be as available as setting one.
     */
    const glyphChoices = [null, ...GLYPH_KEYS].map((k) => {
      const on = (glyphOf(t.glyph)?.key ?? null) === k;
      return `<label class="glyph-choice${on ? ' glyph-choice--on' : ''}"
          title="${esc(k ? GLYPHS[k].label : 'No mark beside the name')}">
        <input type="radio" name="glyph" value="${k ?? ''}"${on ? ' checked' : ''}>
        <span class="glyph-choice-shape">${k
    ? `<span class="tier-glyph" data-glyph="${esc(k)}" aria-hidden="true"></span>`
    : '<span class="tier-glyph tier-glyph--none" aria-hidden="true"></span>'}</span>
        <span class="sr-only">${esc(k ? GLYPHS[k].label : 'No mark')}</span>
      </label>`;
    }).join('');
    const periodOptions = PERIODS.map((p) => `<option value="${p}"${Number(t.period_months) === p ? ' selected' : ''}>${p === 1 ? 'a month' : p === 3 ? 'every three months' : 'a year'}</option>`).join('');
    return `<form class="tier-editor" method="post"
              action="/dashboard/${esc(channel.slug)}/members/tier/${tierNo}" style="${plateStyleAttr(t.accent)}">
      <div class="row" style="align-items:center">
        <span class="member-avatar${plate === 'gradient' ? ' member-avatar--shine' : ''}" aria-hidden="true">${esc(String(t.name || '').slice(0, 1).toUpperCase() || String(tierNo))}</span>
        <strong>${tierNo === 2 ? 'Top tier' : 'Entry tier'}</strong>
        <span class="spacer"></span>
        <span class="fine">${holders ? `${holders} ${holders === 1 ? 'member' : 'members'}` : 'nobody yet'} · ${esc(PLATE_COPY[plate])}</span>
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
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 200px">
          <label for="t${tierNo}-doors">How people join</label>
          <select class="input" id="t${tierNo}-doors" name="joinMode">
            ${joinModeOptions}
          </select>
          <span class="hint">Watching opens the same tier to people who cannot pay, and every view is still
            ad revenue you keep. ${esc(ATTENTION_SELLER_LINE)}</span>
        </div>
        <div class="field" style="flex:1 1 230px" role="radiogroup"
             aria-label="A shape beside this tier’s name">
          <span class="field-label">Mark beside the name</span>
          <div class="glyph-pick">${glyphChoices}</div>
          <span class="hint">One shape, in this tier’s own colour, worn inside the chip wherever a member’s
            name is shown — your store’s mark for that tier, on your pages only.</span>
        </div>
        <div class="field" style="flex:1 1 200px">
          <label for="t${tierNo}-ads">What member files do</label>
          <select class="input" id="t${tierNo}-ads" name="adMode">
            ${AD_MODES.map((m) => `<option value="${m}"${adModeOf(t) === m ? ' selected' : ''}>${m === 'ad_free' ? 'Open with no ad — the default' : 'Keep the ordinary asks'}</option>`).join('')}
          </select>
          <span class="hint">${esc(SUPPORTER_SELLER_LINE)}</span>
        </div>
      </div>
      ${adModeOf(t) === 'supporter' && holders ? `<p class="fine" style="color:var(--warning-text)">
        ${plural(holders, 'member')} joined while this tier gave files with no ad. They keep that until their period ends;
        this changes what the next join gets.</p>` : ''}
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
      <p class="fine">${behind.length
    ? `Behind this tier now: ${behind.map((a) => esc(a.title)).join(', ')}.`
    : 'Nothing is behind this tier yet — a file only reaches members when its own page says “Members only”, so nobody can join for nothing.'}
      ${behind.length ? '' : 'Set a file to members-only and it will show up here, and on the tier card buyers read.'}</p>
      ${holders ? `<p class="fine">Remove is off while ${holders === 1 ? 'one person holds' : `${holders} people hold`} this
        tier — you can rename it and change what it costs, but not delete what they paid for.</p>` : ''}
    </form>`;
  };

  const queue = pending.map((m) => {
    const state = 'pending';
    // The person's own look, if they have one. This is the seller's page and the name is
    // being shown to somebody else, which is the rule everywhere else in the product —
    // and their bytebikri look has nothing to do with whether these dues are confirmed,
    // so a member waiting on their store still wears the palette they bought. The TIER
    // pill beside it stays the store's, as always: two payers, two elements.
    return `<li class="queue-row">
      <div class="queue-line">
        ${nameTag(m.display_name, m, { accent: m.accent })}
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
    // Every cell labelled, so the row stacks into a readable block on a phone
    // instead of sliding off the side of it. The roster is the one table on this
    // page a seller opens on a phone — they are checking who paid while standing in
    // a queue — and five columns never fitted in 350 pixels.
    return `<tr>
      <td data-label="Member">${memberPlate({
        name: m.display_name, accent: m.accent, tier: m.tier_name, tierNo: m.tier_no,
        glyph: m.glyph,
        // The member's own look rides on the plate here too. The seller's queue is
        // where names are read most carefully, so a name has to look the same on it
        // as it does on the storefront.
        plusRow: m,
      })}</td>
      <td data-label="Joined">${m.joined_at ? longDay(m.joined_at) : '—'}</td>
      <td data-label="State"><span class="pill${state === 'active' ? ' pill-success' : state === 'pending' ? '' : ' pill-warning'}">${esc(label)}</span>
        ${state === 'active' && left !== null ? `<span class="fine">${plural(left, 'day')} left</span>` : ''}</td>
      <td data-label="Confirmed">${m.join_method === 'attention'
    ? `by watching — ${esc(plural(Number(m.standing_used) || 0, 'view'))}`
    : m.confirmed_at ? longDay(m.confirmed_at) : 'not confirmed'}</td>
      <td class="fine" data-label="Listed">${m.publicly_listed ? 'named on the storefront' : 'hidden from the list'}</td>
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
    <p>Someone said they sent dues. Check your own statement for the reference, then confirm or say you did not find it.
      A join by watching never appears here: the platform counted the views, so there is nothing for you to check.</p>
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
  <form method="post" action="/dashboard/${esc(channel.slug)}/members/note" class="stack">
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
    <h2>Where the money goes</h2>
    <p>Both directions, on one screen. A seller should never have to work out where the platform takes its money,
      and the answer is two lines long: your plan, and the rent on one ad position.</p>
  </div>
  <div class="panel">
    <div class="panel-body">
      <dl class="kv">
        ${revenueRows({
    planName: plan?.name || 'Free',
    planPrice: plan?.priceNpr ? `${npr(plan.priceNpr)} a year` : 'free, permanently',
    slotCount: plan?.capabilities?.slot_count ?? 0,
  }).map((r) => `<dt>${esc(r.term)}</dt><dd>${esc(r.text)}</dd>`).join('')}
      </dl>
      <p class="fine" style="margin-top:var(--space-4)">
        The rent figure itself is on the <a href="/dashboard/${esc(channel.slug)}/earnings">earnings page</a>, priced
        from this store's own traffic, and it is an estimate until an invoice is issued. It is never a percentage of
        anything you earn.
      </p>
    </div>
  </div>
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
    ? `<div class="table-scroll"><table class="table table-stacked">
        <thead><tr><th>Member</th><th>Joined</th><th>State</th><th>How they got in</th><th>Listed</th></tr></thead>
        <tbody>${roster}</tbody>
      </table></div>`
    : `<div class="empty">No members yet. A file set to "Members only" is the invitation that works — the store
         shows it, locked, with what it takes to open it.</div>`}
</div>`,
  });
}

// ---------------------------------------------------------------------------
// One asset, from the seller's side
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// ByteBikri Plus — the person's own premium
// ---------------------------------------------------------------------------

/**
 * The page where a member buys a look from the platform.
 *
 * Three sections, in the order the researched record says to put them:
 *
 *   1. THE LOOK, LIVE. A preview of the reader's own name in each palette and
 *      effect, drawn with the same CSS the roster and the reviews use. A cosmetic
 *      sold with a screenshot is a cosmetic nobody trusts; this one is the
 *      member's own name, in their own browser, before they pay anything.
 *   2. THE ARRANGEMENT, on the manual rail: the accounts, the reference, and what
 *      an operator does with it. Same shape as the store's plan purchase, because
 *      there is no card processor for this business in Nepal and a fake checkout
 *      would be a lie about where the money is.
 *   3. WHAT IT IS NOT, last and in full — the paragraph that prevents the one
 *      complaint that actually damages a cosmetics tier ("I thought it also...").
 *
 * The page never says "no ads". Youtube Premium is defending two class actions
 * over those two words; the sentences here say what the money buys and then say,
 * in the negative, what it does not.
 */
export function plusPage({
  user, consent = null, flash = null, current = 'plus',
  plan = null, subscription = null, state = 'none',
  rails = [], railsReady = false, look = { nameplate: null, effect: null, ring: null, frame: null },
  previewWear = null, wear = null,
  // The two periods a person may buy (0042). `yearPlan` is the same plan with a
  // twelve-month period, so the second price is read from the table and the discount
  // is derived rather than typed a second time.
  yearPlan = null,
  // What this person has bought for other people.
  gifts = [],
}) {
  const price = Number(plan?.price_npr) || 0;
  const yearPrice = Number(yearPlan?.price_npr) || plusYearPrice(price);
  const name = user?.display_name || (user?.email || 'You').split('@')[0];
  const active = state === 'active';
  const pending = state === 'pending';
  const days = active ? plusDaysLeft({ period_end: subscription?.period_end }) : null;
  const chosenPlate = look.nameplate || 'indigo';
  const chosenEffect = effectOf(look.effect).key;
  // The two outer layers. An unknown key is the same graceful answer as everywhere else
  // in this file: no choice, and therefore the default the product already draws.
  const chosenRing = ringOf(look.ring)?.key ?? null;
  const chosenFrame = frameOf(look.frame)?.key ?? null;
  const initial = (name || 'Y').slice(0, 1).toUpperCase();

  // The live preview: the reader's own name, in the palette and effect selected
  // right now — or, if they have never chosen, in the default with nothing on it.
  const previewRow = {
    plus_active: true,
    nameplate: chosenPlate,
    plus_effect: chosenEffect,
    plus_ring: chosenRing,
    plus_frame: chosenFrame,
  };
  /*
   * `is-live` is the one place in the product where an effect animates without being
   * hovered, and it is deliberate: seeing the motion is what is being sold, so the
   * preview runs while the page is open. Everywhere else motion waits for a hover,
   * which is both the researched pattern (Discord animates nameplates on focus) and
   * what keeps thirty names in a roster from holding the compositor awake.
   *
   * `prefers-reduced-motion` still wins over `is-live` — the stylesheet's reduce
   * block is declared after the running state — so somebody who asked for less
   * motion sees the full look, still, including in the shop window for it.
   */
  /*
   * THE STAGE: your name, your look, AND a store's chip beside it.
   *
   * The picker used to preview on "Aa", which is the one string that tells a person
   * nothing — the effect is being bought for their OWN name, and the whole correction
   * this round is that a name and a chip are two different owners. So the stage shows
   * both: the name wearing whatever is chosen, and beside it a chip drawn the way a
   * store draws one, with a caption that says whose it is and that nothing bought here
   * can replace it.
   *
   * The chip is deliberately in the DEFAULT store palette rather than the chosen one: a
   * chip in your own colours would look like part of your look, which is the confusion
   * this page exists to end.
   *
   * `is-live` is the one place in the product where an effect animates without being
   * hovered, and it is deliberate: seeing the motion is what is being sold. The
   * stylesheet's reduced-motion block is declared after the running state, so somebody
   * who asked for less motion sees the full look, still — including here.
   *
   * `data-look-*` is what the page's own script reads to update all of this as the
   * member chooses, without a round trip and without a second copy of the effect table
   * in JavaScript: the words and the classes come out of the picker's own markup.
   */
  // The stage is the person's own card, so it wears their ring choice and their frame
  // choice while they choose — no round trip, and no second copy of the vocabularies:
  // the page script reads both off the picker's own demo tiles.
  const stageRing = chosenRing ? ringClass(chosenRing) : 'wear-ring';
  const stageFrame = chosenFrame ? frameClass(chosenFrame) : '';
  const preview = `<div class="plus-preview is-live${stageFrame ? ` ${stageFrame}` : ''}" data-look-stage style="${plateStyleAttr(chosenPlate)}">
    <span class="plus-preview-avatar ${stageRing}" data-look-avatar aria-hidden="true">${esc(initial)}</span>
    <div class="plus-preview-body">
      <span class="plus-preview-row">
        <span class="${plusNameClasses({ effect: chosenEffect }, 'member-name')}" data-look-name>${esc(name)}</span>
        <span class="store-chip" style="${plateStyleAttr('indigo')}" data-look-chip>Member</span>
      </span>
      <div class="fine" style="margin-top:var(--space-2)" data-look-line>${esc(EFFECTS[chosenEffect].label)} in ${esc(plateOf(chosenPlate).label)}${active ? '' : ' — this is a preview, not something you are wearing yet'}${EFFECTS[chosenEffect].moves ? ' · moving in front of you, and still for anyone whose device asks for less motion' : ' · completely still'}</div>
      <div class="fine" style="margin-top:var(--space-1)">The chip beside your name is a <strong>store’s</strong>, in the creator’s colour — it belongs to them, and nothing bought here can replace it.</div>
    </div>
  </div>`;

  const plateSwatches = PLATE_KEYS.map((key) => {
    const p = plateOf(key);
    return `<span class="plus-swatch" style="${plateStyleAttr(key)}" title="${esc(p.label)}"></span>`;
  }).join('');

  /*
   * THE PICKER IS THE CATALOG, DRAWN.
   *
   * Every field here comes out of `personSlots()` and its values, not out of a list
   * typed into this function. That is what makes the second slot cost one entry: a
   * palette is a `swatch` control and an effect is a `card`, and a slot of either kind
   * appears here with its own name, its own question and its own words. A slot kind
   * with no control is a programming error and renders nothing — the test that every
   * person slot appears in this form is what stops a silent omission.
   */
  // The picker always has something checked for every slot, because a radio group with
  // nothing checked submits nothing and the route would refuse the save — the first
  // save a person ever makes must work. What is pre-checked is what the product is
  // drawing for them RIGHT NOW: the orbiting ring the account chip has always carried,
  // and the card's own plain edge.
  const chosen = {
    nameplate: chosenPlate,
    effect: chosenEffect,
    ring: chosenRing ?? 'orbit',
    frame: chosenFrame ?? 'none',
  };
  const pickerField = (slot) => {
    const current = chosen[slot.key];
    const head = `<span class="field-label" id="plus-${esc(slot.key)}-label">${esc(slot.label)}</span>`;
    if (slot.kind === 'swatch') {
      return `
      <div class="field">
        ${head}
        <div class="plus-swatches" role="radiogroup" aria-labelledby="plus-${esc(slot.key)}-label">
          ${slot.values.map((v) => `
            <label class="plus-swatch-label${current === v.key ? ' is-on' : ''}" style="${plateStyleAttr(v.key)}"
                   data-plate-key="${esc(v.key)}" data-plate-label="${esc(v.label)}">
              <input type="radio" name="${esc(slot.key)}" value="${esc(v.key)}" ${current === v.key ? 'checked' : ''}>
              <span class="plus-swatch" aria-hidden="true"></span>
              <span class="sr-only">${esc(v.label)}</span>
            </label>`).join('')}
        </div>
        <span class="hint">${esc(slot.hint)}</span>
      </div>`;
    }
    if (slot.kind === 'card') {
      return `
      <div class="field">
        ${head}
        <div class="plus-effects" role="radiogroup" aria-labelledby="plus-${esc(slot.key)}-label">
          ${slot.values.map((v) => `
            <label class="choice plus-effect-choice"
                   data-effect-key="${esc(v.key)}" data-effect-label="${esc(v.label)}" data-effect-moves="${v.moves ? 'yes' : 'no'}">
              <input type="radio" name="${esc(slot.key)}" value="${esc(v.key)}" ${current === v.key ? 'checked' : ''}>
              <span>
                <strong>${esc(v.label)}</strong>
                <span class="fine">${esc(v.hint)}</span>
              </span>
              <span class="plus-effect-demo">${nameTag('Aa', { plus_active: true, nameplate: chosenPlate, plus_effect: v.key })}
                <span class="sr-only">${v.moves ? 'this effect moves' : 'this effect never moves'}</span></span>
            </label>`).join('')}
        </div>
      </div>`;
    }
    // The two outer layers are one control: a row of cards whose tile is the thing
    // itself — an initial wearing the ring, or a small card with the frame on its edge.
    // The tile is drawn from the same class the product renders, so the picker cannot
    // promise a ring the product does not draw.
    if (slot.kind === 'demo') {
      const tile = (v) => (slot.demo === 'avatar'
        ? `<span class="look-avatar ${ringClass(v.key)}" style="${plateStyleAttr(chosenPlate)}" aria-hidden="true">${esc(initial)}</span>`
        : `<span class="look-frame ${frameClass(v.key)}" style="${plateStyleAttr(chosenPlate)}" aria-hidden="true">${esc(initial)}</span>`);
      return `
      <div class="field">
        ${head}
        <div class="plus-effects" role="radiogroup" aria-labelledby="plus-${esc(slot.key)}-label">
          ${slot.values.map((v) => `
            <label class="choice plus-effect-choice" data-demo-key="${esc(v.key)}" data-demo-label="${esc(v.label)}"
                   data-demo-moves="${v.moves ? 'yes' : 'no'}">
              <input type="radio" name="${esc(slot.key)}" value="${esc(v.key)}" ${current === v.key ? 'checked' : ''}>
              <span>
                <strong>${esc(v.label)}</strong>
                <span class="fine">${esc(v.hint)}</span>
              </span>
              <span class="plus-effect-demo">${tile(v)}
                <span class="sr-only">${v.moves ? 'this choice moves' : 'this choice never moves'}</span></span>
            </label>`).join('')}
        </div>
      </div>`;
    }
    return '';
  };

  const lookForm = `
    <form method="post" action="/plus/look" class="plus-look">
      ${personSlots().map(pickerField).join('')}
      <button class="btn btn-primary" type="submit">Save the look</button>
      <p class="fine">Your look is saved whether or not an arrangement is running — the palette is yours, and only the wearing of it depends on the month.</p>
      <div class="note note-info" role="note">
        <p class="small" style="margin:0"><strong>Which is which.</strong> ${esc(WEAR_OWNER_LINE)}</p>
        <p class="small" style="margin:var(--space-2) 0 0">${esc(CHIP_OWNER_LINE)}</p>
      </div>
    </form>`;

  const railList = rails.filter((r) => r.id !== 'other');
  const payTo = railList.map((r) => `
    <div class="rail${r.ready ? '' : ' rail-off'}">
      <div class="rail-name">${esc(r.label)}</div>
      ${r.ready
    ? `<div class="rail-value mono">${esc(r.handle)}</div>`
    : `<div class="rail-value muted">not configured</div>
         <div class="fine">Set <span class="mono">${esc(r.env)}</span> on the server to show this.</div>`}
    </div>`).join('');

  /*
   * WHICH PERIOD, WHICH IS THE RESEARCHED PRICING SHAPE AND NOT A SECOND PRODUCT.
   *
   * The report's own comparison table names the models — flat, tiered, one-time,
   * annual discount — and the one that fits a single-plan cosmetic is the annual
   * discount: the same product for twelve months at ten months' price. Discord's
   * Nitro does exactly this, and it is a discount rather than a feature, which is
   * why nothing in the picker below differs between the two choices but the price
   * and the period.
   */
  const periodChoice = `
      <div class="field">
        <span class="field-label" id="plus-period-label">How long</span>
        <div class="plus-periods" role="radiogroup" aria-labelledby="plus-period-label">
          <label class="choice plus-period" data-period-key="plus">
            <input type="radio" name="plan" value="${esc(plan?.code || 'plus')}" checked>
            <span>
              <strong>${npr(price)} <span class="fine">a month</span></strong>
              <span class="fine">The month is the unit: nothing renews by itself, and stopping costs nothing but the days already paid for.</span>
            </span>
          </label>
          <label class="choice plus-period" data-period-key="${esc(yearPlan?.code || 'plus-year')}">
            <input type="radio" name="plan" value="${esc(yearPlan?.code || 'plus-year')}">
            <span>
              <strong>${npr(yearPrice)} <span class="fine">a year</span></strong>
              <span class="fine">${esc(plusYearNote(price))}</span>
            </span>
          </label>
        </div>
      </div>`;

  const payForm = (action, { gift = false } = {}) => `
    <form method="post" action="${action}" class="${gift ? 'pay-form gift-form' : 'pay-form'}">
      ${periodChoice}
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 160px">
          <label for="${gift ? 'gift-method' : 'plus-method'}">Paid with</label>
          <select class="input" id="${gift ? 'gift-method' : 'plus-method'}" name="method">
            ${railList.map((r) => `<option value="${esc(r.id)}">${esc(r.label)}</option>`).join('')}
            <option value="other">Something else</option>
          </select>
        </div>
        <div class="field" style="flex:2 1 220px">
          <label for="${gift ? 'gift-ref' : 'plus-ref'}">Transaction reference</label>
          <input class="input" id="${gift ? 'gift-ref' : 'plus-ref'}" name="txnReference" required minlength="4" maxlength="80"
                 autocomplete="off" placeholder="e.g. 8FJ2K19QW">
          <span class="hint">From the wallet receipt. An operator checks it against the platform's own
          statement, and that is what ${gift ? 'makes the code work' : 'starts your month'}.</span>
        </div>
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 200px">
          <label for="${gift ? 'gift-payer' : 'plus-payer'}">Name on the transfer <span class="muted">(optional)</span></label>
          <input class="input" id="${gift ? 'gift-payer' : 'plus-payer'}" name="payerName" maxlength="80">
        </div>
        ${gift ? `<div class="field" style="flex:1 1 200px">
          <label for="gift-note">A note for them <span class="muted">(optional, they see it)</span></label>
          <input class="input" id="gift-note" name="note" maxlength="120" placeholder="e.g. for my sister">
        </div>` : ''}
        <div class="field" style="flex:0 0 auto;align-self:flex-end">
          <button class="btn btn-primary" type="submit">I have sent ${gift ? 'it' : npr(price)}</button>
        </div>
      </div>
    </form>`;

  const arrangement = active ? `
    <div class="panel"><div class="panel-head"><h2>Your arrangement</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Plan</dt><dd>${esc(subscription?.plan_name || PLUS_NAME)}</dd>
          <dt>Price</dt><dd>${npr(price)} a month</dd>
          <dt>Runs until</dt><dd>${esc(longDay(subscription?.period_end))}${days !== null ? ` · ${plural(days, 'day')} left` : ''}</dd>
          <dt>Worn now</dt><dd>${wear ? `${esc(EFFECTS[wear.effect].label)} in ${esc(plateOf(wear.plate).label)}` : 'nothing yet — pick a look above'}</dd>
        </dl>
        <p class="fine" style="margin-top:var(--space-4)">
          Paid to bytebikri on the manual rail. There is no card on file and nothing renews by itself:
          when the month ends the arrangement ends, your look stays saved, and nothing is deleted.
        </p>
        <form method="post" action="/plus/cancel" style="margin-top:var(--space-4)">
          <button class="btn btn-sm" type="submit">Stop it early</button>
          <p class="fine" style="margin-top:var(--space-2)">
            Stops the look now and ends the arrangement. The month was paid on a manual rail and stopping
            early does not return it — so if you only want to be plain for a while, choose
            <strong>Plain</strong> above: it costs nothing and keeps the month.
          </p>
        </form>
      </div>
    </div>` : pending ? `
    <div class="panel"><div class="panel-head"><h2>Waiting on your reference</h2></div>
      <div class="panel-body">
        <p class="small">You submitted a reference for ${npr(price)}. An operator has not matched it against the
        platform's statement yet, so no month has started and nothing is being worn — the look is what the money
        buys, so it arrives when the money is confirmed rather than when it is claimed.</p>
        <p class="fine" style="margin-top:var(--space-3)">Nothing is lost if the reference was wrong: submit another
        one below, or stop the request entirely. A rejected reference changes nothing about your account.</p>
        <form method="post" action="/plus/cancel" style="margin-top:var(--space-4)">
          <button class="btn btn-sm" type="submit">Withdraw the request</button>
        </form>
      </div>
    </div>` : `
    <div class="panel"><div class="panel-head"><h2>${state === 'lapsed' ? 'Your month ended' : 'Start an arrangement'}</h2></div>
      <div class="panel-body">
        <p class="small">${state === 'lapsed'
    ? 'Your look is still saved and nothing was deleted — the month simply ended. Start another whenever you want it back on.'
    : 'One plan, everything included, no second charge for anything — ever. The reasons are on the page below.'}</p>
        <p class="price-line" style="margin:var(--space-4) 0">${npr(price)} <span class="fine">a month</span></p>
        ${payTo ? `<div class="rail-grid">${payTo}</div>` : ''}
        ${railsReady ? payForm('/plus/join') : `<div class="note note-warning" role="status" style="margin-top:var(--space-4)">
          <strong>No payment rail is configured on this server.</strong> Set one of the
          <span class="mono">PAY_*</span> variables to show the accounts here. Rather than printing a
          placeholder account number, the page shows nothing to pay into.
        </div>`}
      </div>
    </div>`;

  /*
   * THE GIFT, AND WHY IT IS ON THIS PAGE RATHER THAN BEHIND A MENU.
   *
   * The researched record puts gifting in the same breath as the tiers themselves —
   * Discord's Nitro gifts and its friend passes, Twitch's gifted subscriptions — and
   * it is the one social feature of a cosmetics product that never drew a backlash.
   * For THIS platform it is also the only acquisition channel that needs no card, no
   * processor and no marketing spend: one person who likes their look buys a month for
   * somebody who has never heard of us, and that person arrives with the product
   * already switched on.
   *
   * Three parts, in the order a person meets them:
   *
   *   1. THE CODES THIS PERSON HAS BOUGHT, each with its state said plainly. A code
   *      that is not live yet says so, in the same place the code is printed, because
   *      a buyer's first instinct is to hand it over immediately.
   *   2. THE CODE THEY ARE HOLDING — the one input in the product that is not about
   *      the person typing it. Nothing is asked of them but a code: no reference, no
   *      amount, no name. A gift is not a payment and the recipient should not have to
   *      behave like a payer.
   *   3. BUYING ONE, with the two periods and the same rail as their own.
   */
  const giftRows = gifts.map((g) => `
    <li class="gift-row" data-gift-code="${esc(g.code)}" data-gift-status="${esc(g.status)}">
      <div class="gift-code mono">${esc(g.code)}</div>
      <div class="gift-body">
        <span class="pill${g.status === 'funded' ? ' pill-success' : g.status === 'void' ? ' pill-warning' : ''}">${
    g.status === 'reserved' ? 'waiting on the transfer' : g.status === 'funded' ? 'ready to give'
      : g.status === 'redeemed' ? 'redeemed' : 'not found'}</span>
        <span class="fine">${Number(g.months) === 12 ? 'A year' : 'A month'} · ${
    esc(GIFT_BUYER_LINE[g.status] || GIFT_BUYER_LINE.reserved)}</span>
        ${g.redeemed_by_name ? `<span class="fine">Redeemed by ${esc(g.redeemed_by_name)}.</span>` : ''}
      </div>
    </li>`).join('');

  const giftPanel = `
<section class="section" id="gift">
  <div class="section-head"><h2>Give a month away</h2>
    <p class="fine">One period, for one other person. The code is what carries it, so it works whether
    they are next to you or on the other side of the country — and it works the moment an operator finds
    your transfer, not before.</p>
  </div>
  <div class="cols-2">
    <div class="panel"><div class="panel-head"><h2>Use a code</h2></div>
      <div class="panel-body">
        <p class="small">Somebody bought you a period. Type the code they gave you — it looks like
        <span class="mono">BKP-XXXX-XXXX</span>, and the dashes do not matter.</p>
        <form method="post" action="/plus/gift/redeem" class="row" style="gap:var(--space-3);align-items:flex-end;margin-top:var(--space-4)">
          <div class="field" style="flex:1 1 200px">
            <label for="gift-use-code">The code</label>
            <input class="input mono" id="gift-use-code" name="code" required minlength="8" maxlength="20"
                   autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="BKP-XXXX-XXXX">
          </div>
          <div class="field" style="flex:0 0 auto">
            <button class="btn btn-primary" type="submit">Use it</button>
          </div>
        </form>
        <p class="fine" style="margin-top:var(--space-3)">Nothing else is asked of you — no reference, no
        amount, no statement. A gift is not a payment, and accepting one should not look like making one.</p>
      </div>
    </div>
    <div class="panel"><div class="panel-head"><h2>${giftRows ? 'Codes you have bought' : 'What a gift is not'}</h2></div>
      <div class="panel-body">
        ${giftRows
    ? `<ul class="gift-list">${giftRows}</ul>
       <p class="fine" style="margin-top:var(--space-3)">A code is one period for one person and it is used
       once. If a friend never used theirs, the period is still waiting on it — nothing expires and nothing
       is lost.</p>`
    : `<ul class="plus-not">${GIFT_NOT.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>`}
      </div>
    </div>
  </div>
  <div class="panel" style="margin-top:var(--space-4)"><div class="panel-head"><h2>Buy one</h2></div>
    <div class="panel-body">
      <p class="small">Your own arrangement is not touched by this — buying a gift never extends your own
      month, and never shortens it. What comes back is a code, printed on this page the moment you claim it,
      with its state attached so you know whether it works yet.</p>
      ${railsReady
    ? payForm('/plus/gift', { gift: true })
    : `<div class="note note-warning" role="status">
        <strong>No payment rail is configured on this server.</strong> Set one of the
        <span class="mono">PAY_*</span> variables to show the accounts here — rather than printing a
        placeholder account number, this page shows nothing to pay into.
      </div>`}
    </div>
  </div>
</section>`;

  return layout({
    title: PLUS_NAME,
    user, consent, current, showAddressNotice: false,
    body: `
${flashNote(flash)}
<section class="section plus-hero">
  <div class="plus-hero-grid">
    <div>
      <span class="pill pill-accent">${esc(PLUS_NAME)}</span>
      <h1>Your name, the way you want it.</h1>
      <p class="lede">A palette, an edge, a slow halo — worn beside your name on rosters and reviews, everywhere
      this platform shows you to somebody else. This is bytebikri's own product, bought from us, and it is the
      only thing we sell to a person.</p>
      <p class="fine">It also paints the head of <a href="/library">your own library</a> — the one page here that
      belongs to you rather than to a store. No store's pages change, and nobody else sees it: a band in your
      colours is yours, exactly as the name inside it is.</p>
      ${preview}
      <div class="row" style="margin-top:var(--space-5)">
        ${active
    ? '<a class="btn btn-primary" href="#arrangement">Your arrangement →</a>'
    : `<a class="btn btn-primary" href="#arrangement">Start for ${npr(price)} a month</a>`}
        <a class="btn" href="#not">What it is not →</a>
      </div>
    </div>
    <div class="panel">
      <div class="panel-body">
        <div class="plus-swatches-demo">${plateSwatches}</div>
        <p class="small" style="margin-top:var(--space-5)">${esc(PLUS_SEPARATION_LINE)}</p>
        <p class="fine" style="margin-top:var(--space-3)">${esc(plusMoneyLine(price, 1))}</p>
      </div>
    </div>
  </div>
</section>

<section class="section" id="look">
  <div class="section-head"><h2>Choose the look</h2>
    <p class="fine">Everything below is included in the one price. Cosmetics sold one at a time is the
    complaint the research is full of; sold as one thing, it is a look.</p>
  </div>
  <div class="panel"><div class="panel-body">${lookForm}</div></div>
</section>

<section class="section" id="arrangement">
  <div class="section-head"><h2>The arrangement</h2></div>
  ${arrangement}
</section>

${giftPanel}

<section class="section" id="not">
  <div class="section-head"><h2>What this is not</h2>
    <p class="fine">Written before the price, and printed after it, because the only complaint that damages
    a cosmetics tier is the one about what somebody assumed it included.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <ul class="plus-not">
      ${PLUS_NOT.map((line) => `<li>${esc(line)}</li>`).join('')}
    </ul>
  </div></div>
</section>`,
  });
}

export function assetManage({
  channel, asset, user, consent = null, flash = null, files = [],
  policy = {}, stats = {}, unlocks = 0,
  // Whether this store's plan includes members, and which tiers exist. The
  // "Members only" option is not offered on a plan that cannot use it: a setting
  // that silently does nothing is the worst kind of control.
  membershipsOn = false, tiers = [],
  // The store's plan code, because the ask a file may make is capped by the plan
  // (adscale.js ASK_CEILING). Passed in rather than looked up: a view renders
  // synchronously and asks the database nothing.
  planCode = 'free',
  // The page model for this file (§13), computed by the server because a view asks
  // the database nothing. It is what makes the seller's plan panel and the buyer's
  // reader agree about how many steps a read has.
  pages = null,
  // Availability: the countries this creator chose, and the countries the
  // platform did. Two lists rather than one, because they are two different
  // standing — a creator can undo theirs and cannot undo ours.
  countryRules = [], platformRules = [],
  // The live surface (§14) for a `stream`: the URL, the windows this file has run,
  // which lengths are callable right now, and why the rest are not. Null for every
  // other shape, because a break button on a video is a button nothing can honour.
  live = null,
  // The newest operator decision about this file, if there is one. A store's
  // owner is told when their shop is restricted (see moderationNotice); before
  // this, a file's owner was told nothing at all — the file simply stopped
  // being unlockable, and the dashboard looked the same as ever.
  decision = null,
  // The case against this file as its seller may see it (counts and rule codes,
  // never a reporter), and their own appeal history. Both optional: a caller that
  // passes neither gets the page it always got, and no appeal panel — which is the
  // correct rendering for a file nobody has reported.
  caseFile = null, appeals = [],
}) {
  const publicHref = `/s/${channel.slug}/a/${asset.slug}`;
  // The shape, derived from the file the seller actually uploaded — the same call
  // the storefront and the content path make, so the panel below cannot offer a
  // placement the file does not have.
  const shape = assetShape(files, { url: asset.external_url });
  const openAppeal = appeals.find((a) => a.status === 'open') || null;
  const decidedAppeals = appeals.filter((a) => a.status !== 'open');
  const hiddenByReports = Boolean(asset.hidden_by_reports);
  const notice = hiddenByReports || caseFile?.reporters
    ? hidingNotice({ reasons: caseFile?.reasons || [], reporters: caseFile?.reporters || 0, appeal: openAppeal })
    : null;
  const appealAllowed = canAppeal({ asset, openAppeal });

  /*
   * THE ASK.
   *
   * Two number boxes stood here — "Ads to unlock" and "Minimum ad length" — and
   * they asked a seller with no advertising data to price a stranger's attention
   * from memory. What stands here instead is one honest input ("what is this file
   * worth?", private, no checkout behind it) and a choice between the rate for
   * that value and the platform minimum. Both numbers on screen are computed by
   * `adscale.js`, which is the same module the unlock pipeline and the buyer's
   * panel read.
   */
  const storedLevel = String(policy.ask_level) === 'light' ? 'light' : 'standard';
  const value = Math.max(0, Number(asset.declared_value_npr) || 0);
  const storedAsk = { ads: Number(policy.ads_required) || 1, seconds: Number(policy.ad_min_seconds) || 15, level: storedLevel };
  const asks = Object.fromEntries(ASK_LEVELS.map((l) => [l.key, resolveAsk({ valueNpr: value, planCode, level: l.key })]));
  // What the seller's own description promises, read back to them if it no longer
  // matches the ask (see `descriptionAskClaim`). Null when they make no claim.
  const descriptionClaim = descriptionAskClaim(asset.description);
  /**
   * Where this file's breaks go, computed by the same module the buyer's page and
   * the pipeline read.
   *
   * The seller is shown the shape the platform derived, the length the player
   * measured, and the breaks that follow from both. They are shown it because the
   * alternative — a set of checkboxes whose effect you find out about later — is
   * how a setting becomes a mystery. Every placement the shape allows is a
   * checkbox; every one the rules would not place says why, next to it.
   */
  // Could this file take the ask inside it at all? Two conditions, the same ones
  // the save route enforces: a shape with a player that can stop, and a plan that
  // actually places a break. Shown as an option only when both hold, because a
  // choice that cannot be honoured is worse than no choice.
  const placementPlan = planFor({
    shape,
    durationSec: asset.runtime_sec ?? null,
    ask: { ...storedAsk, ceiling: asks[storedLevel].ceiling },
    planCode,
    choices: policy.ad_plan,
    chapters: shape === 'read' && pages ? pages.chapters : (files.length || 1),
    membersOnly: asset.unlock_mode === 'members',
  });
  // A stop is counted where it can be honoured: a reader's plan carries between
  // cues, a player's carries timestamps (§13). Same rule as the save route, from the
  // same module, so the panel cannot offer a mode the route would refuse.
  const stopsForPanel = shape === 'read' ? betweenCues(placementPlan) : breakCues(placementPlan);
  const breaksPossible = breaksSupported(shape) && stopsForPanel.length > 0;
  /*
   * What this file asks a VISITOR for, which is not the same as what its policy row
   * says.
   *
   * The row always carries an ask — it is calibrated from the value — but on a file
   * that is free, or opened by a membership, nobody is ever asked for it, and on a
   * file that carries breaks the ask lands inside the player rather than at the
   * door. The description-drift warning below compares the seller's own words
   * against this number, and it used to compare against the row: a free file whose
   * description promised "no ads" was told it now asks for one. The sentence was
   * false about a file nobody was being charged for.
   */
  const openMode = asset.unlock_mode === 'open' || asset.unlock_mode === 'members';
  const askedOfVisitors = openMode
    ? 0
    : asset.unlock_mode === 'breaks' ? stopsForPanel.length : storedAsk.ads;
  // Drift: the ask was calibrated when the file was worth something else. Said
  // plainly and never auto-corrected — an ask that moved on its own under a
  // visitor's feet would be worse than one that is briefly behind.
  const bandWas = policy.ad_band_npr === null || policy.ad_band_npr === undefined ? null : Number(policy.ad_band_npr);
  const drifted = bandWas !== null && bandWas !== value;
  // On a file with no value, the band rate and the floor are the same number, and a
  // radio group whose two options do the same thing reads as a broken control. One
  // option, and a line saying why there is nothing to choose.
  const sameRate = asks.standard.ads === asks.light.ads && asks.standard.seconds === asks.light.seconds;
  const shownLevels = sameRate ? ASK_LEVELS.filter((l) => l.key === 'standard') : ASK_LEVELS;
  const checkedLevel = sameRate ? 'standard' : storedLevel;

  const askMeter = (ask, tone = '') => `
    <span class="ask-meter${tone ? ` ask-meter-${tone}` : ''}" role="img"
          aria-label="${esc(askLabel(ask))}, ${ask.ads * ask.seconds} seconds in total">
      ${Array.from({ length: ask.ads }, (_, i) => `
        <span class="ask-bar" style="--ask-sec:${ask.seconds}">
          <span class="ask-bar-sec">${ask.seconds}s</span>
          <span class="ask-bar-n">${i + 1}</span>
        </span>`).join('')}
    </span>`;

  /**
   * The placement panel: what this shape has, what it kept, and where the breaks
   * land. Rendered only for shapes that have anywhere to put one — a download's
   * panel would be an empty box with a promise in it.
   */
  const placementPanel = placementPlan ? `
      <div class="panel" style="margin-top:var(--space-5)">
        <div class="panel-head">
          <h2>Where the breaks go</h2>
          <span class="pill">${esc(shapeLabel(shape))}</span>
        </div>
        <div class="panel-body">
          <p class="small">${esc(placementPlan.reasonText)}</p>
          ${asset.unlock_mode === 'breaks' ? `
          <p class="small" style="margin-top:var(--space-3)">
            <strong>Live:</strong> this file opens free and these are the breaks the player stops for.
            ${placementPlan.cues.length < storedAsk.ads ? ` It can hold ${placementPlan.cues.length}
            of the ${plural(storedAsk.ads, 'view')} its value gives it, so the rest is not asked for.` : ''}
          </p>` : asset.unlock_mode === 'open' ? `
          <p class="small" style="margin-top:var(--space-3)">
            <strong>Not live:</strong> this file is free with no ad at all, so nothing below runs. Switching
            its access to “Free, with a break inside”${breaksPossible ? '' : ' — once the file has a measured length'} turns
            them on.
          </p>` : `
          <p class="small" style="margin-top:var(--space-3)">
            <strong>Not live:</strong> this file asks at the door. In-file breaks belong to files that
            open free, so that nothing a person has to pay for can be released by a pause in a page.
            ${breaksPossible
    ? 'Choosing “Free, with a break inside” above moves the ask to the points below.'
    : 'This file cannot take one yet: it needs a player that can stop, and a measured length.'}
          </p>`}
          ${placementPlan.cues.length ? `
          <ul class="fine" style="margin:var(--space-3) 0 0;padding-left:var(--space-4)">
            ${placementPlan.cues.map((c) => `<li>${esc(c.label)} — ${c.kind === 'post'
    ? 'an offer, not a toll' : `${placementPlan.budget.seconds} seconds`}</li>`).join('')}
          </ul>` : ''}
          ${placementPlan.notes.map((n) => `<p class="fine" style="margin-top:var(--space-3)">${esc(n)}</p>`).join('')}
          ${placementPlan.refused.map((r) => `<p class="fine" style="margin-top:var(--space-3);color:var(--warning-text)">
            ${esc(r.reason)}</p>`).join('')}

          ${placementPlan.allowed.length > 1 ? `
          <div class="field" style="margin-top:var(--space-5)">
            <span class="field-label">Breaks you allow in this file</span>
            <div class="stack">
              ${placementPlan.allowed.filter((p) => p.key !== 'aside').map((p) => `
              <label class="choice">
                <input type="checkbox" name="placement" value="${esc(p.key)}" ${p.kept ? 'checked' : ''}>
                <span>
                  <strong>${esc(p.label)}</strong>
                  <span class="fine">${esc(p.why)}</span>
                </span>
              </label>`).join('')}
            </div>
            <span class="hint">Turning one off is instant and affects nobody who is watching right now.
            What a file may ask for in total does not change: this decides where that ask is paid, not how much.</span>
          </div>` : '<p class="fine">This shape has one place an ad can sit, and turning it off would mean turning ads off.</p>'}

          <p class="fine" style="margin-top:var(--space-4)">
            The rules, on every plan: no break in the first ${esc(stamp(PLACEMENT_BOUNDS.firstBreakAfter))} of a file
            or the last ${esc(stamp(PLACEMENT_BOUNDS.lastBreakBeforeEnd))}; never two within
            ${PLACEMENT_BOUNDS.minGap / 60} minutes of each other; a reader breaks between chapters, never inside one;
            and a live file breaks only when you say so.
          </p>
          ${asset.runtime_sec
    ? `<p class="fine">This file runs ${esc(stamp(asset.runtime_sec))} — measured by the player, not typed here.</p>`
    : `<p class="fine">The player has not measured this file's length yet, so no break inside it can be
            placed. Open the file once and this panel fills in.</p>`}
        </div>
      </div>` : '';

  /*
   * How the file reads — the reader's own two choices (§13).
   *
   * Rendered only for a file a reader opens, and only where the file actually has
   * steps to turn: a single image is a file with a reader, but "a page at a time or a
   * continuous scroll" is a question about a SEQUENCE, and asking it of a one-page
   * file would be a control whose two answers are the same picture.
   *
   * Both choices are the store's, not ours, and the panel says what each one does to
   * the ASK as well as to the drawing — because the seller's real question about a
   * reader is whether the breaks still land. They do: a stop sits between pages in
   * both modes, and the sentence below says so rather than leaving them to find out
   * by opening their own file.
   */
  // The stored choices, read through the reader's own vocabulary rather than trusted:
  // a row written before this panel existed has no value at all, and `null` is not a
  // radio button.
  const readModeOf = (a) => (a?.read_mode === 'scroll' ? 'scroll' : 'page');
  const readDirectionOf = (a) => (a?.read_direction === 'rtl' ? 'rtl' : 'ltr');
  /*
   * THE LIVE PANEL (§14).
   *
   * Where the stream is, and the break the seller calls right now. There is no schedule
   * field and no "in 30 minutes" row, because nothing on this platform may open a break
   * by itself — the button IS the schedule (placement rule 4, §14.3).
   *
   * Every length is checked against the four caps BEFORE it is drawn, and the ones that
   * cannot be called say why next to themselves. A button that bounces a seller to an
   * error teaches them nothing about the four-minute gap; a greyed one with the reason
   * and the wait teaches it once.
   */
  const livePanelHtml = live ? `
  <section class="section">
    <div class="section-head">
      <h2>The live stream</h2>
      <p>A live file is the store's own stream: your host serves it, the viewer's browser fetches it from you, and
      nothing about it is copied, relayed or recorded here. Breaks are yours to call, and every one of them buys
      clean entries for the people arriving after it — nothing on this page calls one by itself, and there is no
      way to schedule one.</p>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h2>Where the stream is</h2>
        <span class="pill">${live.url ? 'Live' : 'Not set'}</span>
      </div>
      <div class="panel-body">
        <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/live" class="stack">
          <input type="hidden" name="action" value="set-url">
          <div class="field">
            <label for="live-url">Playlist address</label>
            <input class="input" id="live-url" name="externalUrl" type="url" value="${esc(live.url || '')}"
                   placeholder="https://stream.example.com/live.m3u8" autocomplete="off">
            <span class="hint">An HLS playlist: <code>https://…/live.m3u8</code>. A page URL is a link, not a
            stream, and <code>rtmp://</code> would need an ingest server this platform does not run. Saving an
            empty box takes the stream down.</span>
          </div>
          <button class="btn" type="submit">Save the address</button>
        </form>
      </div>
    </div>
    <div class="panel" style="margin-top:var(--space-5)">
      <div class="panel-head">
        <h2>Call a break</h2>
        <span class="pill">${live.open ? 'Running' : 'None running'}</span>
      </div>
      <div class="panel-body">
        ${live.open ? `<div class="note note-info">
          <p>A break is running${live.open.note ? ` — “${esc(live.open.note)}”` : ''}. It ends at
          ${esc(atTime(new Date(live.open.ends_at)))}.${live.cleanUntil ? ` Newcomers walk in without the door ask
          until ${esc(atTime(new Date(live.cleanUntil)))}.` : ''}</p>
          <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/live"
                style="margin-top:var(--space-3)">
            <input type="hidden" name="action" value="close-break">
            <input type="hidden" name="breakId" value="${esc(live.open.id)}">
            <button class="btn btn-sm" type="submit">End it now</button>
          </form>
        </div>` : ''}
        <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/live" class="stack">
          <input type="hidden" name="action" value="call-break">
          <div class="field">
            <span class="field-label" id="live-length-label">How long</span>
            <div class="stack" role="radiogroup" aria-labelledby="live-length-label">
              ${live.lengths.map((seconds) => `
              <label class="choice">
                <input type="radio" name="seconds" value="${seconds}" ${seconds === 30 ? 'checked' : ''}
                  ${live.callable[seconds] ? 'disabled' : ''}>
                <span>
                  <strong>${esc(lengthWords(seconds))}</strong>
                  <span class="fine">${esc(live.trade[seconds])}</span>
                  ${live.callable[seconds] ? `<span class="fine">Not right now: ${esc(live.callable[seconds])}</span>` : ''}
                </span>
              </label>`).join('')}
            </div>
          </div>
          <div class="field">
            <label for="live-note">A note for yourself</label>
            <input class="input" id="live-note" name="note" maxlength="140" autocomplete="off"
                   placeholder="optional — viewers never see it">
          </div>
          <button class="btn btn-primary" type="submit">Call this break</button>
        </form>
        <p class="fine">Every viewer already watching is stopped for it, and a break buys clean entries for
        newcomers — twenty seconds of covered entry per second of break, capped at an hour. After three in an hour
        the panel waits, and the waiting is the rule rather than a fault.</p>
      </div>
    </div>
    ${live.breaks.length ? `<div class="panel" style="margin-top:var(--space-5)">
      <div class="panel-head"><h2>Breaks you have called</h2></div>
      <div class="panel-body">
        <ul class="dl-list">
          ${live.breaks.slice(0, 5).map((b) => `<li class="dl-item">
            <span class="dl-body">
              <span class="dl-name">${esc(lengthWords(b.seconds))} · cue ${Number(b.cue_index)}</span>
              <span class="dl-meta">${esc(atTime(new Date(b.started_at)))}${b.closed_at ? ' · ended early' : ''}</span>
            </span>
          </li>`).join('')}
        </ul>
      </div>
    </div>` : ''}
  </section>` : '';

  const readPanel = shape === 'read' && pages && pages.chapters > 1 ? `
      <div class="panel" style="margin-top:var(--space-5)">
        <div class="panel-head">
          <h2>How this file reads</h2>
          <span class="pill">${esc(plural(pages.chapters, 'step'))}</span>
        </div>
        <div class="panel-body">
          <div class="field">
            <span class="field-label" id="read-mode-label">Turning</span>
            <div class="stack" role="radiogroup" aria-labelledby="read-mode-label">
              <label class="choice">
                <input type="radio" name="readMode" value="page" ${readModeOf(asset) === 'page' ? 'checked' : ''}>
                <span>
                  <strong>A page at a time</strong>
                  <span class="fine">A comic, a manga, a scanned book. One page is drawn, and the next is a
                  button away.</span>
                </span>
              </label>
              <label class="choice">
                <input type="radio" name="readMode" value="scroll" ${readModeOf(asset) === 'scroll' ? 'checked' : ''}>
                <span>
                  <strong>One continuous scroll</strong>
                  <span class="fine">A webtoon. The pages arrive in order as the reader goes, and the strip stops at
                  the seam rather than turning a page.</span>
                </span>
              </label>
            </div>
          </div>
          <div class="field">
            <span class="field-label" id="read-dir-label">Which way the pages turn</span>
            <div class="stack" role="radiogroup" aria-labelledby="read-dir-label">
              <label class="choice">
                <input type="radio" name="readDirection" value="ltr" ${readDirectionOf(asset) === 'ltr' ? 'checked' : ''}>
                <span><strong>Left to right</strong><span class="fine">The usual order in this language.</span></span>
              </label>
              <label class="choice">
                <input type="radio" name="readDirection" value="rtl" ${readDirectionOf(asset) === 'rtl' ? 'checked' : ''}>
                <span><strong>Right to left</strong><span class="fine">Manga. The next page sits on the left of the
                bar, where a reader of it looks first.</span></span>
              </label>
            </div>
          </div>
          <p class="fine" style="margin-top:var(--space-4)">
            This changes how the file is drawn and nothing about what it asks for. A stop still lands
            <strong>between</strong> pages — never inside one, and never over the art — and the page after it opens
            when the ad network confirms the view. Where a reader stopped is kept for them alone; this panel never
            sees it.
          </p>
        </div>
      </div>` : '';

  const askPanel = `
      <div class="ask-panel">
        <div class="field">
          <label for="a-value">What this file is worth</label>
          <input class="input" id="a-value" name="valueNpr" type="number" min="0" max="1000000" step="50"
                 value="${value}">
          <span class="hint">Private, and not a price: nothing on ByteBikri has a checkout. It is what the ask
          below is calibrated from, and no visitor is shown it.</span>
        </div>
        <div class="field">
          <span class="field-label" id="a-ask-label">What unlocking asks for</span>
          <div class="ask-choices" role="radiogroup" aria-labelledby="a-ask-label">
            ${shownLevels.map((l) => {
              const ask = asks[l.key];
              return `
              <label class="choice">
                <input type="radio" name="adAsk" value="${l.key}" ${checkedLevel === l.key ? 'checked' : ''}>
                <span>
                  <strong>${esc(l.label)} — ${esc(askLabel(ask))}</strong>
                  <span class="fine">${esc(l.hint)}</span>
                  ${drifted && checkedLevel === l.key
                    ? `<span class="fine ask-drift">Saved when this file was worth NPR ${Number(bandWas).toLocaleString('en-IN')} —
                       saving now recalibrates it.</span>` : ''}
                </span>
                ${askMeter(ask, checkedLevel === l.key ? 'now' : '')}
              </label>`;
            }).join('')}
          </div>
          ${sameRate ? `<span class="hint">The floor and the band rate are the same number here —
            ${esc(askLabel(asks.standard))} — so there is nothing to choose yet. Give the file a value above
            and the two separate, with the band rate asking more.</span>` : ''}
        </div>
        <p class="small"><strong>Now:</strong> ${esc(askLabel(storedAsk))} of a visitor's time
        (${storedAsk.ads * storedAsk.seconds} seconds in total). ${esc(askReason({ valueNpr: value, planCode, level: storedLevel }))}</p>
        <p class="fine">${esc(ASK_INPUT_LINE)}</p>
        <p class="fine"><strong>The platform's ceiling, on every plan:</strong> ${esc(ASK_PROMISE)}</p>
      </div>`;

  /**
   * One form, one Save.
   *
   * The first cut had two forms side by side, and the second one mirrored the
   * first one's fields in hidden inputs so that either could be submitted
   * alone. That is a trap: type a new title, press "Save terms", and the hidden
   * — stale — title posts back and the edit disappears. Two buttons that
   * silently undo each other are worse than one button that does both.
   */
  return layout({
    title: asset.title, user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'overview', asset.title, `Published at <a href="${esc(publicHref)}">${esc(publicHref)}</a>.`)}
${flashNote(flash)}

${asset.moderation_state === 'pending' ? `
<section class="section" style="margin-bottom:0">
  <div class="note note-info" role="status">
    <strong>Waiting for its first review.</strong> ${esc(assetBehaviour('pending').ownerNote)}
    <div class="fine" style="margin-top:var(--space-2)">
      A store's first file is looked at by a person before it joins search, and there is nothing
      for you to do about it: the link above already works, and your store page lists it.
    </div>
  </div>
</section>` : ''}

${decision ? `
<section class="section" style="margin-bottom:0">
  <div class="note ${asset.moderation_state === 'removed' ? 'note-danger' : 'note-warning'}" role="status">
    <strong>${esc(DECISION_VERB[decision.action] || `An operator looked at this file`)}${decision.rule_title ? ` — ${esc(decision.rule_title)}` : ''}.</strong>
    ${decision.reason ? `${esc(decision.reason)} ` : ''}Nothing was deleted: the file, its files and its history are all still here.
    <div class="fine" style="margin-top:var(--space-2)">
      Decided ${esc(relTime(decision.created_at))}${decision.actor_name ? ` by ${esc(decision.actor_name)}` : ''}.
      ${asset.moderation_state === 'removed'
    ? 'Visitors get a 404, and the store no longer lists it. This page is still yours.'
    : asset.moderation_state === 'restricted'
      ? 'Visitors can see it listed, and nobody can unlock it while this stands.'
      : 'It is listed, and unlocks work again.'}
    </div>
  </div>
</section>` : ''}

${notice ? `
<section class="section" style="margin-bottom:0">
  <div class="note ${hiddenByReports ? 'note-warning' : 'note-info'}">
    <strong>${esc(notice.headline)}.</strong> ${esc(notice.detail)}
    ${notice.next ? `<div class="fine" style="margin-top:var(--space-2)">${esc(notice.next)}</div>` : ''}
  </div>

  ${hiddenByReports ? (openAppeal ? '' : appealAllowed.ok ? `
    <div class="panel" style="margin-top:var(--space-4)">
      <div class="panel-head"><h2>Answer this</h2></div>
      <div class="panel-body">
        <p class="small">
          Three reports is a signal, not a verdict — ${AUTO_HIDE_AFTER} separate accounts clicked a button, and
          nobody has read your side of it yet. Say what you want a person to know, and an operator reads it.
        </p>
        <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/appeal">
          <div class="field" style="margin-top:var(--space-4)">
            <label for="ap-statement">Your side of it</label>
            <textarea class="input" id="ap-statement" name="statement" rows="5" maxlength="${APPEAL_LIMIT}"
              placeholder="Where the work came from, what the licence is, or why the file is not what it was reported as."></textarea>
            <span class="hint">Up to ${num(APPEAL_LIMIT)} characters. One appeal per file while it is open.</span>
          </div>
          <div class="row" style="margin-top:var(--space-4);align-items:center;gap:var(--space-4);flex-wrap:wrap">
            <button class="btn btn-primary" type="submit">Send it to an operator</button>
            <span class="fine">This does not put the file back by itself. A person decides.</span>
          </div>
        </form>
      </div>
    </div>`
    : `<div class="empty" style="margin-top:var(--space-4)">${esc(appealAllowed.why)}</div>`)
    // An open appeal is already on the page below, in full. Repeating the refusal
    // above it said the same thing twice and made the seller read three sentences
    // to learn one fact.
    : ''}

  ${openAppeal ? `
    <div class="panel" style="margin-top:var(--space-4)">
      <div class="panel-head">
        <div class="row" style="align-items:center;gap:var(--space-3)">
          <h2>Your appeal</h2>
          ${pill('waiting', 'info')}
          <span class="spacer"></span>
          <span class="fine">Sent ${esc(relTime(openAppeal.created_at))}</span>
        </div>
      </div>
      <div class="panel-body">
        <blockquote class="quote">${esc(openAppeal.statement)}</blockquote>
        <p class="fine" style="margin-top:var(--space-4)">
          It answers ${plural(openAppeal.report_count, 'report')}${
    (openAppeal.reasons || []).length
      ? ` — the file was reported for ${esc((openAppeal.reasons || []).map(sellerReasonLabel).filter(Boolean).join(' and '))}`
      : ''}.
          The file stays hidden while an operator reads it; an appeal that restored the file on its own would be
          a two-click bypass of the threshold.
        </p>
        <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/appeal/withdraw"
              style="margin-top:var(--space-4)">
          <button class="btn btn-sm" type="submit">Withdraw the appeal</button>
        </form>
      </div>
    </div>` : ''}

  ${decidedAppeals.length ? `
    <div class="panel" style="margin-top:var(--space-4)">
      <div class="panel-head"><h2>Earlier appeals</h2></div>
      <div class="panel-body">
        ${decidedAppeals.map((a) => `
          <div class="row" style="align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
            ${pill(a.status, a.status === 'upheld' ? 'success' : a.status === 'declined' ? 'danger' : '')}
            <span class="fine">${esc(relTime(a.decided_at || a.created_at))}</span>
          </div>
          <blockquote class="quote">${esc(a.statement)}</blockquote>
          ${a.decision_note ? `<p class="small" style="margin-top:var(--space-2)">An operator wrote: ${esc(a.decision_note)}</p>` : ''}
        `).join('<hr>')}
      </div>
    </div>` : ''}
</section>` : ''}

<form class="cols-2" method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}">
  <div class="panel">
    <div class="panel-head"><h2>Details</h2></div>
    <div class="panel-body">
      <div class="field">
        <label for="a-title">Title</label>
        <input class="input" id="a-title" name="title" required maxlength="200" value="${esc(asset.title)}">
        <span class="hint">The address stays <span class="mono">${esc(asset.slug)}</span> — changing it
        would break every link anyone has already shared.</span>
      </div>
      <div class="field">
        <label for="a-desc">Description</label>
        <textarea class="textarea" id="a-desc" name="description" rows="4" maxlength="2000">${esc(asset.description || '')}</textarea>
        ${descriptionClaim !== null && descriptionClaim !== askedOfVisitors ? `<span class="hint" style="color:var(--warning-text)">
          This description says ${descriptionClaim === 0 ? 'no ads' : `${descriptionClaim} ${descriptionClaim === 1 ? 'ad' : 'ads'}`},
          and the file now asks for ${askedOfVisitors}${asset.unlock_mode === 'breaks' ? ', inside it' : ''}.
          ${openMode ? 'Nobody is asked for anything while access is free, so the description is the only half a visitor reads.'
    : 'Visitors see both, so one of them should change — the description is yours to edit, and the ask follows the value below.'}
        </span>` : ''}
      </div>
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 160px">
          <label for="a-mode">Access</label>
          <select class="input" id="a-mode" name="unlockMode">
            <option value="ad_gated" ${asset.unlock_mode === 'ad_gated' ? 'selected' : ''}>One rewarded ad</option>
            <option value="open" ${asset.unlock_mode === 'open' ? 'selected' : ''}>Free — no ad</option>
            ${breaksPossible ? `<option value="breaks" ${asset.unlock_mode === 'breaks' ? 'selected' : ''}>Free, with a break inside</option>` : ''}
            ${membershipsOn ? `<option value="members" ${asset.unlock_mode === 'members' ? 'selected' : ''}>Members only — no ad</option>` : ''}
          </select>
          ${membershipsOn ? `<span class="hint">Members-only files stay on your storefront, locked, so they can be
            seen — that is what makes joining worth a click.</span>` : ''}
          ${breaksPossible ? `<span class="hint"><strong>Free, with a break inside</strong> lifts the door and
            pays for the file with a break the player stops for, at the points in the panel below. Nothing before
            the start. The break is enforced in the page, so a determined viewer can seek past it — the honest
            trade for a door more people will walk through. Your call, and it can be switched back any time.</span>`
    : ''}
          <span class="hint">Changing this does not take back an unlock anyone already has.</span>
        </div>
        ${membershipsOn && tiers.length ? `<div class="field" style="flex:1 1 170px">
          <label for="a-member-tier">Which members</label>
          <select class="input" id="a-member-tier" name="memberTier">
            ${tiers.map((t) => `<option value="${t.tier_no}"${Number(asset.member_tier) === Number(t.tier_no) ? ' selected' : ''}>${esc(t.name)}${Number(t.tier_no) === 2 ? ' — top tier only' : ' and above'}</option>`).join('')}
          </select>
          <span class="hint">Only used when access above is "Members only".</span>
        </div>` : ''}
        <div class="field" style="flex:1 1 160px">
          <label for="a-status">State</label>
          ${hiddenByReports ? `
          <select class="input" id="a-status" disabled aria-describedby="a-status-why">
            <option>Hidden after reports</option>
          </select>
          <span class="hint" id="a-status-why">An operator's call, not a punishment — it is what keeps three
          reports from meaning nothing. Everything else on this page still saves.</span>`
    : `<select class="input" id="a-status" name="status">
            <option value="live" ${asset.status === 'live' ? 'selected' : ''}>Live</option>
            <option value="paused" ${asset.status === 'paused' ? 'selected' : ''}>Paused — hidden</option>
          </select>
          <span class="hint">Pausing hides it without deleting anything.</span>`}
        </div>
      </div>
      ${askPanel}
      ${placementPanel}
      ${readPanel}
      ${livePanelHtml}
      <div class="row" style="gap:var(--space-4);align-items:flex-start">
        <div class="field" style="flex:1 1 140px">
          <label for="a-hours">Access lasts</label>
          <input class="input" id="a-hours" name="unlockHours" type="number" min="1" max="720" step="1"
                 value="${Number(policy.unlock_hours) || 24}">
          <span class="hint">Hours. 24 is a day; 720 is a month.</span>
        </div>
      </div>
      <p class="fine">
        Nobody can unlock this file with money. Unlocks come from watching an ad, and the network
        pays your own account for it.
      </p>
    </div>
  </div>

  <div>
    <div class="panel">
      <div class="panel-head"><h2>Since publishing</h2></div>
      <div class="panel-body">
        <dl class="kv">
          <dt>Unlocks</dt><dd>${num(unlocks)}</dd>
          <dt>Files</dt><dd>${plural(files.length, 'file')}</dd>
          <dt>Reviews</dt><dd>${stats.count
    ? `${Number(stats.average).toFixed(1)} from ${plural(stats.count, 'review')}`
    : 'None yet'}</dd>
        </dl>
        <ul class="dl-list" style="margin-top:var(--space-5)">
          ${files.map((f) => `<li class="dl-item">
            <span class="file-badge" aria-hidden="true">${esc((f.mime_type || 'file').split('/').pop().slice(0, 4).toUpperCase())}</span>
            <span class="dl-body">
              <span class="dl-name">${esc(f.filename)}</span>
              <span class="dl-meta">${(f.size_bytes / 1024).toFixed(1)} KB · ${esc(f.mime_type || '')}</span>
            </span>
          </li>`).join('')}
        </ul>
        <p class="fine" style="margin-top:var(--space-4)">
          A file cannot be swapped for another one here. Replacing bytes behind a URL somebody
          already unlocked is how a store loses the argument about what they bought — publish a
          new file instead, and pause this one.
        </p>
      </div>
    </div>

    <div class="panel" style="margin-top:var(--space-6)">
      <div class="panel-head"><h2>Reviews on this file</h2></div>
      <div class="panel-body">
        ${stats.count
    ? `<p class="small">${Number(stats.average).toFixed(1)} out of 5 from ${plural(stats.count, 'review')}.
           <a href="/dashboard/${esc(channel.slug)}/reviews">Read and reply →</a></p>`
    : `<p class="fine">None yet. A review can only be written by somebody holding an unlock.</p>`}
      </div>
    </div>
  </div>

  <div class="form-foot">
    <button class="btn btn-primary" type="submit">Save</button>
    <span class="fine">Details and unlock terms save together.</span>
  </div>
</form>

<section class="section">
  <div class="section-head">
    <h2>Where this file is available</h2>
    <p>Everywhere by default. A rule here withholds it from one country — usually because a licence
    only covers some of them.</p>
  </div>

  ${countryRules.length ? `<div class="table-scroll"><table class="table table-stacked">
    <!-- The creator's own rules. A platform rule is not a row here: it is the
         notice below, because the two ask for different things (clear mine, or
         read theirs and appeal) and a shared table invites the wrong click.
         Five columns, stacked: "What happens there" is a sentence, and on a phone
         it was the second of two columns visible before the Clear button. -->
    <thead><tr><th>Country</th><th>What happens there</th><th>Set by</th><th>When</th><th></th></tr></thead>
    <tbody>${countryRules.map((r) => `<tr>
      <td><strong>${esc(countryName(r.country_code))}</strong></td>
      <td data-label="What happens there">${r.state === 'blocked'
    ? 'Not shown at all — the page answers 403 to a visitor there'
    : r.state === 'restricted'
      ? 'Listed, but nobody there can unlock it'
      : 'Available — this overrides a store-wide decision'}
        ${r.reason ? `<span class="fine" style="display:block;margin-top:var(--space-2)">Your note: ${esc(r.reason)}</span>` : ''}</td>
      <td data-label="Set by">${r.source === 'creator' ? 'You' : 'The platform'}</td>
      <td class="fine" data-label="When">${esc(relTime(r.updated_at))}</td>
      <td data-label="Actions">${r.source === 'creator' ? `<form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/country">
        <input type="hidden" name="countryCode" value="${esc(r.country_code)}">
        <input type="hidden" name="clear" value="1">
        <button class="btn btn-sm" type="submit">Clear</button>
      </form>` : '<span class="fine">not yours to clear</span>'}</td>
    </tr>`).join('')}</tbody>
  </table></div>` : '<div class="empty">No country rule. This file is available everywhere.</div>'}

  ${platformRules.length ? `<div class="note note-warning" style="margin-top:var(--space-5)">
    <strong>The platform has limited this file${platformRules.length === 1 ? '' : ' in ' + platformRules.map((r) => countryIn(r.country_code)).join(', ')}.</strong>
    ${platformRules.map((r) => `${esc(countryIn(r.country_code))}: ${esc(r.rule_title || 'a platform rule')}${r.reason ? ` — ${esc(r.reason)}` : ''}`).join('. ')}.
    Nothing was deleted, and you can answer any decision about this file from the notice at the top of this page.
  </div>` : ''}

  <form method="post" action="/dashboard/${esc(channel.slug)}/assets/${esc(asset.id)}/country" class="panel" style="margin-top:var(--space-5)">
    <div class="panel-body">
      <h3 style="font-size:var(--text-md);margin:0">Withhold this file from a country</h3>
      <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-4)">
        <div class="field" style="flex:1 1 220px">
          <label for="cr-country">Country</label>
          <select class="input" id="cr-country" name="countryCode">
            ${countrySelectOptions()}
          </select>
        </div>
        <div class="field" style="flex:1 1 260px">
          <label for="cr-state">What happens there</label>
          <select class="input" id="cr-state" name="state">
            <option value="blocked">Not shown at all</option>
            <option value="restricted">Listed, but cannot be unlocked</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="cr-note">Why (kept private)</label>
        <input class="input" id="cr-note" name="note" maxlength="280"
               placeholder="Licensed for Nepal only, for example.">
        <span class="hint">For your own record and for an operator. A visitor is told it was your choice, never this line.</span>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Save the country rule</button>
      <p class="fine" style="margin-top:var(--space-4)">
        The country is read from the network the visitor arrives over, so a VPN changes it.
        We tell the visitor the truth about that rather than pretending otherwise — and we never
        show your private note to anyone but you and an operator.
      </p>
    </div>
  </form>
</section>`,
  });
}

// ---------------------------------------------------------------------------
// Operator — matching money against the statement
// ---------------------------------------------------------------------------

/**
 * The operator console.
 *
 * One shell, four pages, and the layout is the research rather than taste:
 *
 *   - an inverted pyramid. Four or five KPIs answer "is anything on fire" without
 *     a click, the queues that need a person come next with their counts, and the
 *     detail sits underneath for whoever wants it;
 *   - equally sized KPI tiles on one row, because a row of unequal tiles reads as
 *     a mistake before it reads as design;
 *   - status is never carried by colour alone. Every tile and every pill has a
 *     word in it, which matters on the operator pages more than anywhere else:
 *     roughly one man in twelve cannot use the red/green difference at all;
 *   - an operator is an expert, so the density is higher here than anywhere else
 *     in the product. `Density follows expertise` — the calm version of this
 *     belongs on the seller's dashboard, not on the console.
 *
 * The navigation is a real <nav> of links, so it works without JavaScript and
 * every page is addressable.
 */
export function adminShell({ user, consent, current, title, lede = '', actions = '', body }) {
  const tab = (href, label, key, badge = 0) => `
    <a href="${esc(href)}"${current === key ? ' aria-current="page"' : ''}>
      ${esc(label)}${badge ? `<span class="nav-count">${num(badge)}</span>` : ''}
    </a>`;
  return layout({
    title, user, current: 'admin', consent,
    body: `
<div class="section console-head" style="margin-bottom:0">
  <div class="row" style="align-items:flex-start">
    <div>
      <h1>${esc(title)}</h1>
      ${lede ? `<p class="lede" style="margin-top:var(--space-2)">${lede}</p>` : ''}
    </div>
    <span class="spacer"></span>
    ${actions}
  </div>
</div>
<nav class="console-nav" aria-label="Console">${tab('/admin', 'Overview', 'overview')}${tab('/admin/payments', 'Payments', 'payments', user.adminBadges?.payments)}${tab('/admin/stores', 'Stores', 'stores')}${tab('/admin/users', 'People', 'people')}${tab('/admin/plans', 'Plans', 'plans')}${tab('/admin/earnings', 'Earnings', 'earnings')}${tab('/admin/connections', 'Connections', 'connections')}${tab('/admin/reports', 'Reports', 'reports', user.adminBadges?.reports)}${tab('/admin/moderation', 'Moderation', 'moderation', user.adminBadges?.moderation)}${tab('/admin/audit', 'Audit log', 'audit')}</nav>
${body}`,
  });
}

/** One figure an operator can act on. Label, value, and the context line. */
function kpi({ label, value, context = null, tone = '', href = null }) {
  const inner = `
    <span class="kpi-label">${esc(label)}</span>
    <span class="kpi-value">${esc(value)}</span>
    ${context ? `<span class="kpi-context">${esc(context)}</span>` : ''}`;
  const cls = `kpi${tone ? ` kpi-${tone}` : ''}`;
  return href
    ? `<a class="${cls}" href="${esc(href)}">${inner}</a>`
    : `<div class="${cls}">${inner}</div>`;
}

/**
 * The console overview.
 *
 * The one question this page answers, in one sentence: is anything waiting for a
 * person, and is the money moving. Everything on it is a number that changes a
 * decision, and anything that does not is not on it.
 */
export function adminOverview({ user, consent = null, flash = null, kpis = [], queues = [], activity = [], platform = null }) {
  const queueRow = (q) => `
    <a class="queue-row" href="${esc(q.href)}">
      <span class="queue-count${q.count ? ' queue-count-live' : ''}">${num(q.count)}</span>
      <span class="queue-body">
        <strong>${esc(q.title)}</strong>
        <span class="fine">${esc(q.note)}</span>
      </span>
      <span class="queue-go" aria-hidden="true">→</span>
    </a>`;

  const log = activity.map((a) => `
    <tr>
      <td class="fine" style="white-space:nowrap">${esc(relTime(a.created_at))}</td>
      <td><span class="mono">${esc(a.action)}</span></td>
      <td class="fine">${esc(a.actor_name || a.actor_email || (a.actor_id ? 'a person' : 'the platform'))}</td>
    </tr>`).join('');

  return adminShell({
    user, consent, current: 'overview', title: 'Console',
    lede: 'What the platform owes people, and what is waiting for one of us.',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row${kpis.length > 4 ? ' kpi-row-tight' : ''}">${kpis.map(kpi).join('')}</div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Waiting for a person</h2>
    <p>Each one is a queue with a count. A zero here is the point of the page.</p>
  </div>
  <div class="queue-list">${queues.map(queueRow).join('')}</div>
</section>

${platform ? `
<section class="section">
  <div class="section-head"><h2>How the platform earns</h2>
    <p>Two charges, and neither is a share of a creator's ad revenue.</p></div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      ${/* Values are markup on purpose (they carry <strong>), keys are text. The
            key still has to be escaped, which is why the caller must pass a real
            apostrophe rather than an entity: an entity passed as text comes out
            as &#39; on the page, which is what this line healed. */
      platform.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
    </dl>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Recent activity</h2>
    <p>Every decision and every payment, newest first. <a href="/admin/audit">The whole log →</a></p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>When</th><th>Action</th><th>Who</th></tr></thead>
      <tbody>${log || '<tr><td colspan="3" class="muted">Nothing has happened yet.</td></tr>'}</tbody>
    </table>
  </div></div>
</section>`,
  });
}

/**
 * The report queue.
 *
 * One row per FILE, ordered by risk rather than by arrival, and every row says
 * how many distinct people reported it. Under the auto-hide threshold the file is
 * still live and the row says so — an operator looking at a queue needs to know
 * whether they are interrupting a seller or catching up with one.
 */
/**
 * Find a store.
 *
 * This is the page the console was missing: you could count stores and moderate
 * one you were already looking at, but there was no way to find one you had been
 * told about by name, slug or owner. Three filters, four sort orders, and a
 * search that reaches the owner's email because that is how a support message
 * usually arrives ("the person who reported this is alice@…").
 *
 * The research is visible in the details rather than in the decoration: numbers
 * are right-aligned and tabular so two rows can be compared by eye, the columns
 * are the ones an operator acts on rather than every column that exists, status
 * never relies on colour alone, and sorting is a link so it works without
 * JavaScript and every ordering is a URL somebody can send to somebody else.
 */
/**
 * The money path, watched.
 *
 * A connection that is quietly dead is the most expensive failure in this
 * product: the seller keeps publishing, the buyer keeps watching rewarded ads,
 * and nothing moves — because a callback URL was never saved in the network's own
 * dashboard. The seller's networks page answers "is mine connected"; this page
 * answers "is any of them, and which one is dead", which is a question only the
 * platform can ask because only the platform sees all of them at once.
 *
 * The diagnosis is written out per row rather than left as a status word, because
 * the four failure modes look identical from the outside (no money) and have
 * completely different fixes.
 */
function connectionDiagnosis(row, now = Date.now()) {
  const ageHours = (now - new Date(row.created_at).getTime()) / 3_600_000;
  const lastGood = row.last_verified_at ? new Date(row.last_verified_at) : null;
  const quietDays = lastGood ? (now - lastGood.getTime()) / 86_400_000 : null;

  if (row.provider_id === 'house') {
    return { tone: 'info', headline: 'Ours', detail: 'House creatives. No callback is expected, and none is missing.' };
  }
  if (row.status === 'revoked') {
    return { tone: '', headline: 'Disconnected by the seller', detail: 'Nothing to do. The record stays for the audit trail.' };
  }
  // Refusals are recorded for their REASON, and the reason decides the fix. A
  // signature mismatch means the seller must paste a new secret; "no adapter for
  // provider" means we cannot verify that network at all and the seller should be
  // told before they publish more files behind it. Both are refusals, and neither
  // is visible from the storefront.
  const rejectedAfterGood = row.last_rejected_at && (!lastGood || new Date(row.last_rejected_at) > lastGood);
  if (rejectedAfterGood && row.signature_failures > 0) {
    return {
      tone: 'bad', headline: 'The network is calling and we are refusing it',
      detail: 'The shared secret here does not match the one in the network\'s dashboard, so every callback '
        + 'fails verification. The seller has to paste the current secret again — no amount of waiting fixes it.',
    };
  }
  if (rejectedAfterGood && row.last_rejection_reason) {
    return {
      tone: 'warn', headline: 'Recent callbacks are being refused',
      detail: `The network is calling and we are answering 401: ${row.last_rejection_reason}. `
        + 'This is our side of the integration rather than the seller\'s, and it means nothing is unlocking.',
    };
  }
  if (row.status === 'restricted' || row.status === 'failed') {
    return {
      tone: 'warn', headline: 'The network refused this publisher',
      detail: row.status_reason || 'No reason recorded. Reconnect to see what the network says.',
    };
  }
  if (!row.postbacks_total) {
    return ageHours < 1
      ? { tone: 'info', headline: 'Waiting for the first callback', detail: 'Connected under an hour ago. Give it until tomorrow before assuming anything.' }
      : {
        tone: 'warn', headline: 'Never called us back',
        detail: 'Most often the callback URL was never saved in the network\'s own dashboard, which the seller '
          + 'has to do — or the placement is not live on their side. A verified connection is what turns "waiting" into "earning".',
      };
  }
  if (row.status === 'verifying') {
    return { tone: 'info', headline: 'Callbacks arriving, still verifying', detail: 'A signed callback has been received; the connection will settle once it repeats.' };
  }
  if (quietDays !== null && quietDays > 7) {
    return {
      tone: 'warn', headline: `Last signed callback ${Math.floor(quietDays)} days ago`,
      detail: 'It worked and then went quiet. Usually the placement was paused, or the ad code was removed from the store page.',
    };
  }
  return { tone: 'good', headline: 'Working', detail: 'Signed callbacks are arriving and being accepted.' };
}

export function adminConnections({ user, consent = null, flash = null, rows = [], days = 30 }) {
  const now = Date.now();
  const diagnosed = rows.map((r) => ({ ...r, dx: connectionDiagnosis(r, now) }));
  const callbacks = rows.reduce((a, r) => a + Number(r.callbacks_window || 0), 0);
  const rejected = rows.reduce((a, r) => a + Number(r.signature_failures || 0), 0);
  const talking = diagnosed.filter((r) => r.provider_id !== 'house' && r.status !== 'revoked' && r.postbacks_total > 0).length;
  const silent = diagnosed.filter((r) => r.dx.tone === 'warn' || r.dx.tone === 'bad').length;

  return adminShell({
    user, consent, current: 'connections', title: 'Connections',
    lede: 'Every ad network connected to a store, and whether it is actually calling us back. Nothing on this page moves money; it is how we find out that nothing is.',
    actions: `<a class="btn btn-sm" href="/admin/stores">Stores</a>`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    ${kpi({ label: 'Callbacks · 30d', value: callbacks.toLocaleString('en-IN'), context: 'signed requests from networks', href: null })}
    ${kpi({ label: 'Talking', value: String(talking), context: 'connections that have called us', tone: talking ? 'good' : '' })}
    ${kpi({ label: 'Needs a look', value: String(silent), context: silent ? 'never called, or refused signature' : 'every connection is healthy', tone: silent ? 'warn' : '' })}
    ${kpi({ label: 'Rejected signatures', value: rejected.toLocaleString('en-IN'), context: rejected ? 'a secret does not match' : 'none', tone: rejected ? 'bad' : '' })}
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>${rows.length ? plural(rows.length, 'connection') : 'No connections'}</h2>
    <p>${rows.length
    ? `Ordered by how much attention each one needs. Callback counts cover the last ${num(days)} days.`
    : 'No store has connected an ad network yet. Until one does, nothing can be unlocked and nothing can be earned.'}</p>
  </div>

  ${rows.length ? diagnosed.map((r) => `
  <div class="panel" style="margin-top:var(--space-5)">
    <div class="panel-head">
      <a href="/admin/stores/${esc(r.channel_slug)}"><strong>${esc(r.channel_name)}</strong></a>
      <span class="fine">${esc(r.provider_id)}${r.credential_label ? ` · ${esc(r.credential_label)}` : ''}</span>
      <span class="spacer"></span>
      ${pill(r.status, r.status === 'active' ? 'success' : r.status === 'verifying' ? 'info' : r.status === 'revoked' ? '' : 'warning')}
    </div>
    <div class="panel-body">
      <p class="small" style="margin:0">
        <strong>${esc(r.dx.headline)}.</strong> ${esc(r.dx.detail)}
      </p>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Callbacks</dt><dd>${r.callbacks_window
    ? `${plural(r.callbacks_window, 'callback')} in ${num(days)} days${r.postbacks_total !== r.callbacks_window ? ` · ${num(r.postbacks_total)} ever` : ''}`
    : (r.postbacks_total ? `none in ${num(days)} days · last ${esc(relTime(r.last_verified_at))}` : 'never')}</dd>
        <dt>Last verified</dt><dd>${r.last_verified_at ? esc(relTime(r.last_verified_at)) : 'never'}</dd>
        <dt>Refused</dt><dd>${r.rejections_total
    // The verdict above and this line have to agree. The first version counted
    // only signature failures here while the verdict counted every refusal, so a
    // row could say "callbacks are being refused" and "none" in the same breath.
    ? `${plural(r.rejections_total, 'callback')} answered 401 (last ${esc(relTime(r.last_rejected_at))})`
      + `${r.signature_failures ? ` · ${num(r.signature_failures)} of them a signature mismatch` : ''}`
      + `${r.last_rejection_reason ? `<div class="fine">${esc(r.last_rejection_reason)}</div>` : ''}`
    : 'nothing refused'}</dd>
        <dt>Slots filled</dt><dd>${r.slots_filled ? plural(r.slots_filled, 'slot') : 'none assigned to this connection'}</dd>
        <dt>Connected</dt><dd>${esc(relTime(r.created_at))}${r.payout_verdict ? ` · payout check: ${esc(r.payout_verdict)}` : ''}</dd>
      </dl>
      ${(r.history || []).length ? `<details class="disclosure" style="margin-top:var(--space-4)">
        <summary class="disclosure-head">
          <span class="disclosure-title" style="font-size:var(--text-sm)">Status history</span>
          <span class="disclosure-note">${plural(r.history.length, 'transition')}, newest first</span>
          <span class="disclosure-chevron" aria-hidden="true"></span>
        </summary>
        <div class="panel-body" style="border-top:1px solid var(--border-subtle)">
          <ul class="dl-list">
            ${r.history.map((h) => `<li class="dl-item" style="display:block">
              <span class="fine">${esc(relTime(h.created_at))} — ${esc(h.from_status || 'new')} → <strong>${esc(h.to_status)}</strong></span>
              ${h.detail ? `<div class="small">${esc(h.detail)}</div>` : ''}
            </li>`).join('')}
          </ul>
        </div>
      </details>` : ''}
    </div>
  </div>`).join('') : ''}
</section>

<section class="section">
  <div class="section-head">
    <h2>Four ways this breaks</h2>
    <p>They all look the same from the storefront — nothing unlocks, nothing is earned — and they have four different fixes.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <dl class="kv">
      <dt>Never called us back</dt>
      <dd>The callback URL was never saved in the network's own dashboard, or the placement is not live.
        <span class="fine">The seller fixes this; we cannot do it for them, and the secret we generated is already on their connections page.</span></dd>
      <dt>Signature refused</dt>
      <dd>The network is calling and our check is failing, which means the secret here and the secret there are different.
        <span class="fine">Nothing is earned while this is true, and waiting never fixes it.</span></dd>
      <dt>Went quiet</dt>
      <dd>Signed callbacks stopped. Usually a paused placement or ad code removed from the page.
        <span class="fine">This is the one that looks like success from every other page in the console.</span></dd>
      <dt>Refused by the network</dt>
      <dd>The network rejected this publisher, and the reason it gave is on the row above.
        <span class="fine">Payout eligibility is checked at connect time and snapshotted, so a later registry change cannot rewrite what the seller was shown.</span></dd>
    </dl>
    <p class="fine" style="margin-top:var(--space-4)">
      What a creator was PAID is never on this page. We count the callbacks we received and verified;
      the money is between them and the network, and their statement is the authority.
    </p>
  </div></div>
</section>`,
  });
}

export function adminStores({ user, consent = null, flash = null, data = null, filters = {}, canExport = true }) {
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const page = data?.page || 1;
  const perPage = data?.perPage || 25;
  const pages = Math.max(Math.ceil(total / perPage), 1);
  const { q = '', state = 'all', plan = 'all', identity = 'all', sort = 'traffic' } = filters;

  const link = (next) => {
    const params = new URLSearchParams();
    const merged = { q, state, plan, identity, sort, ...next };
    for (const [k, v] of Object.entries(merged)) if (v && v !== 'all' && !(k === 'sort' && v === 'traffic')) params.set(k, v);
    const qs = params.toString();
    return `/admin/stores${qs ? `?${qs}` : ''}`;
  };

  /**
   * What a store's identity state reads as, in the one column that carries it.
   *
   * The states are the console's own (`storeDirectory` computes them from the
   * outcome row and any open request), and each chip is a word rather than a
   * colour: an operator scanning this column is deciding who to work next, and
   * "waiting", "ends soon" and "no check" are three different next actions.
   */
  const IDENTITY_LABELS = {
    pending: ['Waiting on a check', 'warning'],
    checked: ['Checked', 'success'],
    lapsing: ['Check ending soon', 'info'],
    lapsed: ['Check has lapsed', 'warning'],
    none: ['Never checked', ''],
  };
  /**
   * Two lines, because there are two facts.
   *
   * The pill is the STANDING outcome — what the badge on the storefront rests on —
   * and the lines under it say whether somebody is waiting on us and whether the
   * date is close. A store can be in both states at once (asking for the next check
   * while the current one still runs), and a column that had to choose between them
   * would hide exactly the row an operator is working down the list to find.
   */
  const identityCell = (r) => {
    const [label, tone] = IDENTITY_LABELS[r.identity_state] || IDENTITY_LABELS.none;
    const lapse = r.identity_state === 'lapsing' || r.identity_state === 'lapsed'
      ? lapseOf({ status: 'verified', expires_at: r.verification_expires_at })
      : null;
    const what = r.identity_state === 'none'
      ? ''
      : `${methodOf(r.verification_method)?.title || r.verification_method || 'a document'}${
        lapse ? ` — ${lapse.label}` : r.verification_expires_at ? `, to ${longDay(r.verification_expires_at)}` : ''}`;
    return `${pill(label, tone)}
      ${what ? `<div class="fine">${esc(what)}</div>` : ''}
      ${r.verification_requested_at ? `<div class="fine">asked ${esc(relTime(r.verification_requested_at))}</div>` : ''}
      ${lapse && lapse.level !== 'lapsed' ? `<div class="fine">${r.verification_notice_at ? `told ${esc(relTime(r.verification_notice_at))}` : 'nobody told yet'}</div>` : ''}`;
  };

  const sortHead = (key, label, numeric = true) => `
    <th${numeric ? ' class="num"' : ''}${sort === key ? ' aria-sort="descending"' : ''}>
      <a href="${esc(link({ sort: key, page: undefined }))}"${sort === key ? ' class="sorted"' : ''}>${esc(label)}${
    sort === key ? ' <span aria-hidden="true">↓</span>' : ''}</a>
    </th>`;

  const stateChip = (st) => pill(st, st === 'approved' ? 'success' : st === 'restricted' ? 'warning' : st === 'pending' ? '' : 'danger');

  return adminShell({
    user, consent, current: 'stores', title: 'Stores',
    lede: 'Everything published, with the numbers an operator needs to judge it. Search reaches the owner\'s name and email.',
    actions: canExport
      ? `<a class="btn btn-sm" href="${esc(link({ format: 'csv', page: undefined }))}">Download CSV</a>`
      : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <form class="filters" method="get" action="/admin/stores" role="search">
    <div class="field" style="flex:2 1 260px">
      <label for="q">Search</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="Store, slug, owner name or email">
    </div>
    <div class="field">
      <label for="state">State</label>
      <select class="input" id="state" name="state">
        ${[['all', 'Any state'], ['approved', 'Approved'], ['held', 'Held or hidden'], ['restricted', 'Restricted'], ['suspended', 'Suspended'], ['removed', 'Removed']]
    .map(([v, l]) => `<option value="${v}"${state === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="plan">Plan</label>
      <select class="input" id="plan" name="plan">
        ${[['all', 'Any plan'], ['paid', 'Paying'], ['free', 'Free']]
    .map(([v, l]) => `<option value="${v}"${plan === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="identity">Identity</label>
      <select class="input" id="identity" name="identity">
        ${[['all', 'Any state'], ['pending', 'Waiting on a check'], ['lapsing', 'Check ending soon'],
    ['lapsed', 'Check has lapsed'], ['checked', 'Checked'], ['none', 'Never checked']]
    .map(([v, l]) => `<option value="${v}"${identity === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <span class="hint">The overview links straight to two of these: waiting on a check, and checks ending
      soon. A store can be in both — asking for the next check before the current one runs out is the
      ordinary way to renew.</span>
    </div>
    <input type="hidden" name="sort" value="${esc(sort)}">
    <div class="filters-foot">
      <button class="btn btn-primary" type="submit">Apply</button>
      ${(q || state !== 'all' || plan !== 'all' || identity !== 'all')
    ? `<a class="btn btn-sm" href="/admin/stores">Clear</a>` : ''}
    </div>
  </form>

  <div class="section-head" style="margin-top:var(--space-6)">
    <h2>${total ? `${num(total)} store${total === 1 ? '' : 's'}` : 'No store matches'}</h2>
    <p>${total
    ? `Page ${num(page)} of ${num(pages)}${sort === 'traffic' ? ' · busiest first' : ''}${sort === 'expiry' ? ' · soonest to lapse first' : ''}${identity !== 'all' ? ` · filtered to <strong>${esc((IDENTITY_LABELS[identity] || ['', ''])[0])}</strong>` : ''}`
    : 'Clear the filters, or search for a different word — the search looks at names, slugs, owner names and owner emails.'}</p>
  </div>

  ${rows.length ? `
  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Eight columns. On a phone the third one was cut through the chip: a store
         on the Store plan read "STO". Stacked, like the other wide tables. -->
    <table class="table table-directory table-stacked">
      <thead>
        <tr>
          <th>Store</th>
          <th>State</th>
          <th>Identity</th>
          <th>Plan</th>
          ${sortHead('files', 'Files')}
          ${sortHead('traffic', 'Views · 30d')}
          ${sortHead('unlocks', 'Unlocks')}
          <th class="num">Ad views</th>
          <th>Last file</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>
            <a href="/admin/stores/${esc(r.slug)}"><strong>${esc(r.name)}</strong></a>
            <div class="fine">/s/${esc(r.slug)} · ${esc(r.owner_name || r.owner_email || 'no owner on file')}${
    r.listing_mode === 'marketplace' ? ' · listed' : ''} · <a href="/s/${esc(r.slug)}" target="_blank" rel="noopener">open store ↗</a></div>
          </td>
          <td data-label="State">${stateChip(r.moderation_state)}${r.moderation_reason ? `<div class="fine">${esc(r.moderation_reason)}</div>` : ''}</td>
          <td data-label="Identity">${identityCell(r)}</td>
          <td data-label="Plan">${r.plan_code === 'free' ? pill('Free', '') : pill(r.plan_code, 'accent')}${
    r.sub_status === 'grace' ? '<div class="fine">in grace</div>' : ''}</td>
          <td class="num" data-label="Files">${num(r.files_live)}${r.files_total !== r.files_live ? `<div class="fine">of ${num(r.files_total)}</div>` : ''}</td>
          <td class="num" data-label="Views · 30d">${num(r.views_30d)}</td>
          <td class="num" data-label="Unlocks">${num(r.unlocks)}${r.unlocks ? '' : '<div class="fine">none yet</div>'}</td>
          <td class="num" data-label="Ad views">${num(r.ad_views_30d)}</td>
          <td class="fine" data-label="Last file">${r.last_file_at ? esc(relTime(r.last_file_at)) : 'never'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">
    ${page > 1 ? `<a class="btn btn-sm" href="${esc(link({ page: page - 1 }))}">← Newer</a>` : ''}
    <span class="fine">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? `<a class="btn btn-sm" href="${esc(link({ page: page + 1 }))}">Older →</a>` : ''}
  </nav>` : ''}
  ` : `<div class="empty">
    ${q || state !== 'all' || plan !== 'all' || identity !== 'all'
    ? `Nothing matches those filters${identity !== 'all' ? ` — and a store with no check at all is <strong>Never checked</strong>, not <strong>Checked</strong>` : ''}.`
    : 'No store has been created yet. The first one will appear here with its traffic and unlocks.'}
  </div>`}

  <p class="fine" style="margin-top:var(--space-5)">
    Views and unlocks are counted from our own tables, so they are exact. What a creator was PAID is not
    on this page on purpose: that number lives in the network's statement, not in our database.
  </p>
</section>`,
  });
}

/**
 * One store, everything about it.
 *
 * The console had a queue per problem and no page per SUBJECT: deciding whether
 * a report is the first sign of trouble or the third required four pages and a
 * good memory. This page assembles the evidence — who owns the store, what it
 * pays, what it published, what has been reported, and what has been decided
 * about it — and puts the decision form at the end of it, in context.
 *
 * The money panel is explicit about what it does NOT know. An operator looking at
 * a store will want to know what it earned, and the honest answer is that we do
 * not have that number: the network pays the creator directly, and the statement
 * belongs to them. Showing our own estimate beside real invoices would teach an
 * operator to trust the wrong figure.
 */
/**
 * The console's window onto a document a seller handed over.
 *
 * One image, one sentence about what opening it does, and a destroy promise that is
 * true because the decision route keeps it — the same rule this page prints is the
 * one `recordVerification` executes. The seller is shown the same number of opens
 * from the same audit rows, so the two pages cannot tell different stories about who
 * looked.
 *
 * The picture is NOT rendered inline as an `<img>` here. An operator opens it
 * deliberately, in a new tab, and the open is written down with their name; a
 * thumbnail on the queue would be a view nobody chose and a copy in the console's
 * own cache. That is also why there is no "download" link: the file is for looking
 * at once, not for keeping.
 */
function documentWindow(c, pendingRequest) {
  if (!pendingRequest?.document_key) return '';
  const opens = Number(pendingRequest.opens) || 0;
  return `<div class="panel" style="margin-top:var(--space-5)">
  <div class="panel-head">
    <h2 style="font-size:var(--text-md)">A copy is here, waiting for a person</h2>
    <span class="spacer"></span>
    ${pill(opens ? `Opened ${plural(opens, 'time')}` : 'Not opened yet', opens ? 'info' : '')}
  </div>
  <div class="panel-body">
    <p class="small" style="margin-top:0">
      Handed over ${esc(relTime(pendingRequest.document_added_at))} — ${esc(pendingRequest.document_mime || 'an image')},
      ${esc(humanBytes(pendingRequest.document_bytes))}. The camera's own notes were removed before it was stored.
    </p>
    <a class="btn btn-sm" href="/admin/verification/${esc(pendingRequest.id)}/document"
       target="_blank" rel="noopener">Open the document</a>
    <p class="fine" style="margin-top:var(--space-3)">
      Opening it writes your name and the time into the audit log, and the seller sees the count — that is
      the whole reason they were willing to send it. It is destroyed the moment an outcome is recorded
      below, and in ${HOLD_DAYS} days whether or not anybody looks. Only a person on this console can open
      it, and there is no copy anywhere else to keep.
    </p>
  </div>
</div>`;
}

/** `2.4 MB` — the size of a document, said the way a person says it. */
function humanBytes(n) {
  const v = Number(n) || 0;
  return v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1024))} KB`;
}

export function adminStoreDetail({
  user, consent = null, flash = null, data = null, rules = [], actions = [], labels = {},
  verification = null, verifications = [], pendingRequest = null,
}) {
  if (!data) {
    return adminShell({
      user, consent, current: 'stores', title: 'No such store',
      lede: 'Nothing is stored under that address. It may have been removed, or the address may be wrong.',
      body: `<section class="section"><a class="btn" href="/admin/stores">← Back to stores</a></section>`,
    });
  }
  const { channel: c, files, reports, invoice, history } = data;
  const openReports = reports.filter((r) => r.status === 'open');
  // The same two facts the seller's own panel is built from, from the same model:
  // what the badge stands on, and whether somebody is waiting on us right now.
  const vState = stateOf(verification);
  const lapse = lapseOf(verification);
  const vRequested = pendingRequest ? longDay(pendingRequest.created_at) : null;
  // The person, not their uuid. Same shape as "Decided by" above it: a name if the
  // account has one, otherwise the address, and a sentence rather than an absence
  // when the account is gone.
  const sentBy = verification?.notice_sent_at
    ? ` by ${verification.notice_by_name || verification.notice_by_email || 'an account since deleted'}`
    : '';
  const options = (selected = null) => rules
    .map((r) => `<option value="${esc(r.code)}"${r.code === selected ? ' selected' : ''}>${esc(r.title)} (${esc(r.code)})</option>`)
    .join('');

  const reportRow = (r) => `
    <tr>
      <td>
        <strong>${esc(r.asset_title)}</strong>
        <div class="fine">/s/${esc(c.slug)}/a/${esc(r.asset_slug)} · file is ${esc(r.asset_status)}</div>
      </td>
      <td>${pill(r.reason, 'warning')}</td>
      <td class="num">${num(r.reporters)}</td>
      <td class="fine">${esc(relTime(r.created_at))}${r.note ? `<div>“${esc(r.note.slice(0, 120))}”</div>` : ''}</td>
      <td>${r.status === 'open' ? pill('open', 'warning') : pill(r.status, 'success')}</td>
    </tr>`;

  return adminShell({
    user, consent, current: 'stores',
    title: c.name,
    lede: `/s/${esc(c.slug)} — ${esc(c.tagline || 'no tagline')}`,
    actions: `<a class="btn btn-sm" href="/s/${esc(c.slug)}" target="_blank" rel="noopener">View store ↗</a>
      <a class="btn btn-sm" href="/admin/stores">All stores</a>`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">The store</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Owner</dt><dd>${esc(c.owner_name || 'no name')}<div class="fine">${esc(c.owner_email || 'no email on file')}</div></dd>
        <dt>Opened</dt><dd>${esc(relTime(c.created_at))}</dd>
        <dt>Listing</dt><dd>${c.listing_mode === 'marketplace' ? 'In the marketplace' : 'Unlisted — link only'}</dd>
        <dt>State</dt><dd>${pill(c.moderation_state, stateTone(c.moderation_state))}
          ${c.moderation_reason ? `<div class="fine">holds reason <span class="mono">${esc(c.moderation_reason)}</span></div>` : ''}</dd>
        <dt>Ad connections</dt><dd>${c.live_connections ? plural(c.live_connections, 'live connection') : 'none active'}</dd>
      </dl>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What it pays us</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Plan</dt><dd>${c.plan_code === 'free' ? pill('Free', '') : pill(c.plan_code, 'accent')}${
    c.pending_plan_code ? `<div class="fine">requested ${esc(c.pending_plan_code)} — awaiting a matched transfer</div>` : ''}</dd>
        <dt>Subscription</dt><dd>${esc(c.sub_status || 'active')}${c.period_end ? `<div class="fine">through ${esc(isoDay(c.period_end))}</div>` : ''}</dd>
        <dt>Rent slot</dt><dd>${c.rent_slots
    ? `${plural(c.rent_slots, 'platform slot')}, ${plural(c.own_slots, "slot of the store's own")}`
    : 'none — the platform does not rent a slot here'}</dd>
        <dt>Latest invoice</dt><dd>${invoice
    ? `${npr(invoice.amount_npr)} · ${esc(invoice.status)}<div class="fine">${esc(isoDay(invoice.period_start))} to ${esc(isoDay(invoice.period_end))}</div>`
    : 'no invoice has been issued'}</dd>
      </dl>
      <p class="fine" style="margin-top:var(--space-4)">
        What the creator EARNED is not on this page, and not in our database: the ad network pays them
        directly. Their statement is the authority, not any figure of ours.
      </p>
    </div></div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Files</h2>
    <p>${files.length ? `${plural(files.length, 'file')} published. Unlocks and ad views are counted from our own tables.` : 'Nothing published yet.'}</p>
  </div>
  ${files.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <!-- Seven columns: a phone showed the file, its state and its unlock mode, and
         the numbers — the reason an operator opens this page — were off-screen. -->
    <table class="table table-directory table-stacked">
      <thead><tr>
        <th>File</th><th>State</th><th>Unlock</th>
        <th class="num">Unlocks</th><th class="num">Ad views</th><th class="num">Reports</th><th class="num">Rating</th>
      </tr></thead>
      <tbody>${files.map((f) => `
        <tr>
          <td>
            <a href="/s/${esc(c.slug)}/a/${esc(f.slug)}" target="_blank" rel="noopener"><strong>${esc(f.title)}</strong> ↗</a>
            <div class="fine">published ${esc(relTime(f.created_at))}</div>
          </td>
          <td data-label="State">${pill(f.status, f.status === 'live' ? 'success' : '')}</td>
          <td data-label="Unlock">${pill(f.unlock_mode === 'ad' ? 'one rewarded ad' : f.unlock_mode, 'info')}</td>
          <td class="num" data-label="Unlocks">${num(f.unlocks)}</td>
          <td class="num" data-label="Ad views">${num(f.ad_views)}</td>
          <td class="num" data-label="Reports">${f.open_reports ? `<strong>${num(f.open_reports)}</strong>` : num(f.reports_total)}</td>
          <td class="num" data-label="Rating">${Number(f.reviews) ? `${Number(f.rating).toFixed(1)}<div class="fine">${plural(f.reviews, 'review')}</div>` : '<span class="fine">no reviews</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div></div>` : '<div class="empty">This store has published nothing. There is nothing to moderate yet.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>Reports${openReports.length ? ` · ${num(openReports.length)} open` : ''}</h2>
    <p>Written by people holding an unlock. Reporters are not named here — a decision is about the file, not the complainant.</p>
  </div>
  ${reports.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>File</th><th>Reason</th><th class="num">Reporters</th><th>When</th><th>State</th></tr></thead>
      <tbody>${reports.map(reportRow).join('')}</tbody>
    </table>
  </div></div>` : '<div class="empty">Nothing has been reported on this store.</div>'}
</section>

<section class="section" id="verification">
  <div class="section-head">
    <h2>Who is behind this store${vState === 'verified' ? ' · checked' : vState === 'rejected' ? ' · refused' : vState === 'expired' ? ' · lapsed' : ''}</h2>
    <p>A document was seen by a person, and what they saw is recorded here. The document itself is
    not kept: a copy handed over for a check is destroyed the moment an outcome is recorded, and
    after ${HOLD_DAYS} days either way. This is not a moderation decision — a checked seller can
    still publish a file that gets taken down.</p>
  </div>

  ${pendingRequest ? `<div class="note note-warning" role="status">
    <strong>${esc(pendingRequest.request_note ? `They asked, and wrote: “${pendingRequest.request_note}”` : 'They have asked for a check.')}</strong>
    Asked ${esc(relTime(pendingRequest.created_at))}. Work it in the order it arrived${vState === 'verified'
    ? ` — and note that their current check runs until ${esc(longDay(verification.expires_at))}, so the badge stays up while you arrange this one.` : '.'}
  </div>` : ''}

  ${documentWindow(c, pendingRequest)}

  ${vState === 'verified' ? `<div class="panel"><div class="panel-body">
    <div class="row" style="align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
      <p class="small" style="margin:0">${esc(badgeFor(verification).sentence)}</p>
      ${lapse ? pill(lapse.label, lapse.level === 'lapsed' ? 'warning' : lapse.level === 'current' ? '' : 'info') : ''}
    </div>
    <dl class="kv" style="margin-top:var(--space-4)">
      <dt>Decided by</dt><dd>${esc(verification.decided_by_name || verification.decided_by_email || 'a person no longer on the console')}</dd>
      <dt>Counts until</dt><dd>${esc(longDay(verification.expires_at))}${lapse ? ` <span class="fine">· ${esc(lapse.label)}</span>` : ''}</dd>
      <dt>Notice</dt><dd>${verification.notice_sent_at
    ? `Sent ${esc(relTime(verification.notice_sent_at))}${sentBy} .`.replace(' .', '.')
    : '<span class="fine">Nobody has told them yet.</span>'}</dd>
      ${verification.notes ? `<dt>Note</dt><dd>${esc(verification.notes)}</dd>` : ''}
    </dl>
  </div></div>` : ''}

  ${lapse && lapse.level !== 'current' ? `<div class="panel" style="margin-top:var(--space-5)">
    <div class="panel-head"><h2 style="font-size:var(--text-md)">${lapse.level === 'lapsed' ? 'The check has ended' : 'The check is ending'}</h2></div>
    <div class="panel-body">
      <p class="small" style="margin-top:0">
        ${lapse.level === 'lapsed'
    ? `It stopped counting on ${esc(longDay(verification.expires_at))}, so the badge is off the store page already — nothing else about the store changed, and nothing was taken away. If they want it back, they ask from their settings and it is the same process as the first time.`
    : verification.notice_sent_at
      ? `It stops counting on ${esc(longDay(verification.expires_at))} — ${esc(lapse.label)}. They were told ${esc(relTime(verification.notice_sent_at))}${esc(sentBy)}, so nobody writes to them twice. There is no schedule behind this and nothing is sent automatically: the list on the console is worked by hand.`
      : `It stops counting on ${esc(longDay(verification.expires_at))} — ${esc(lapse.label)}. Nobody has told them yet. The notice below gives them the date, what happens on it, and what does not. There is no schedule behind this and nothing will be sent automatically: the list on the console is worked by hand, which is why this button is here.`}
      </p>
      ${lapse.level === 'lapsed' || verification.notice_sent_at ? '' : `<form method="post" action="/admin/stores/${esc(c.slug)}/verification/notice">
        <button class="btn btn-primary" type="submit">Write to them that it is ending</button>
        <p class="fine" style="margin-top:var(--space-3)">
          One message, from the platform, naming the date. It goes to
          <span class="mono">${esc(c.owner_email || 'no address on file')}</span>${c.owner_email ? '' : ' — there is nothing to send it to'}.
          It is recorded on this check, so the list knows they have been told.
        </p>
      </form>`}
    </div>
  </div>` : ''}

  <div class="panel" style="margin-top:var(--space-5)"><div class="panel-body">
    <form method="post" action="/admin/stores/${esc(c.slug)}/verification">
      <p class="small" style="margin-bottom:var(--space-4)">
        Look at the document the way it suits both of you — in person, in a call where they hold it up,
        or in the window above if they handed a copy over. Recording an outcome destroys any copy that
        is here, in the same press: the file does not outlive the decision by a single request.
      </p>
      <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap">
        <div class="field" style="flex:1 1 200px">
          <label for="v-outcome">Outcome</label>
          <select class="input" id="v-outcome" name="outcome">
            <option value="verified">Checked — it matched</option>
            <option value="rejected">Did not work — refused</option>
          </select>
        </div>
        <div class="field" style="flex:1 1 200px">
          <label for="v-method">What was seen</label>
          <select class="input" id="v-method" name="method">
            ${METHODS.map((m) => `<option value="${esc(m.code)}">${esc(m.title)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:0 1 160px">
          <label for="v-months">Counts for</label>
          <select class="input" id="v-months" name="months">
            ${[12, 24, 36].map((m) => `<option value="${m}"${m === DEFAULT_MONTHS ? ' selected' : ''}>${m} months</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="v-notes">What you saw <span class="muted">(the seller reads this if you refuse)</span></label>
        <input class="input" id="v-notes" name="notes" maxlength="500"
               placeholder="One line about what you saw.">
        <span class="hint">Name matched the account, or what did not line up. Do not write a document
        number here — an outcome is a record of a decision, not of the evidence.</span>
      </div>
      <button class="btn btn-primary" type="submit">Record the outcome</button>
    </form>
  </div></div>

  ${verifications.length > 1 ? `<details style="margin-top:var(--space-4)">
    <summary class="fine">Every check on this store (${num(verifications.length)})</summary>
    <div class="table-scroll"><table class="table table-stacked" style="margin-top:var(--space-3)">
      <thead><tr><th>When</th><th>Outcome</th><th>What was seen</th><th>By</th><th>Note</th></tr></thead>
      <tbody>${verifications.map((v) => `<tr>
        <td class="fine" data-label="When">${esc(relTime(v.decided_at || v.created_at))}</td>
        <td data-label="Outcome">${pill(STATE_WORDING[stateOf(v)], stateOf(v) === 'verified' ? 'success' : stateOf(v) === 'pending' ? '' : 'warning')}</td>
        <td class="fine" data-label="What was seen">${esc(methodOf(v.method)?.title || v.method)}</td>
        <td class="fine" data-label="By">${esc(v.decided_by_name || v.decided_by_email || 'account deleted')}</td>
        <td class="fine" data-label="Note">${esc(v.notes || '')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </details>` : ''}
</section>

<section class="section">
  <div class="section-head">
    <h2>Record a decision</h2>
    <p>A reason is a rule code, never a sentence. The seller reads the rule's own wording plus your remedy line.</p>
  </div>
  <div class="panel"><div class="panel-body">
    <form method="post" action="/admin/moderation/${esc(c.slug)}">
      <div class="row" style="align-items:flex-end;gap:var(--space-4);flex-wrap:wrap">
        <div class="field" style="flex:1 1 180px">
          <label for="action">Action</label>
          <select class="input" id="action" name="action">
            ${actions.map((a) => `<option value="${esc(a)}">${esc(labels[a] || a)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:2 1 260px">
          <label for="ruleCode">Reason</label>
          <select class="input" id="ruleCode" name="ruleCode">
            <option value="">— none cited —</option>
            ${options(c.moderation_reason)}
          </select>
        </div>
      </div>
      <div class="field" style="margin-top:var(--space-4)">
        <label for="remedy">What should the seller do?</label>
        <input class="input" id="remedy" name="remedy" maxlength="280"
               placeholder="One line, in your own words. They read this and nothing else.">
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:var(--space-4)">Record decision</button>
    </form>
  </div></div>
</section>

<section class="section">
  <div class="section-head">
    <h2>What has been decided</h2>
    <p>Every audit row that names this store, newest first. <a href="/admin/audit">The whole log →</a></p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Stacked on a phone: the Detail cell is a list of key: value pairs turned
         into one string, and at 390px it was 123px wide holding ELEVEN lines —
         a column, in the sense that a column of a newspaper is a column. Read as
         a labelled block it is what it always was: a record, one field per line. -->
    <table class="table table-stacked">
      <thead><tr><th>When</th><th>Action</th><th>Who</th><th>Detail</th></tr></thead>
      <tbody>${history.length ? history.map((h) => `
        <tr>
          <td class="fine" data-label="When">${esc(relTime(h.created_at))}</td>
          <td data-label="Action"><span class="mono">${esc(h.action)}</span></td>
          <td class="fine" data-label="Who">${esc(h.actor_name || h.actor_email || 'the platform')}</td>
          <td class="fine" data-label="Detail">${esc(briefMeta(h.meta))}</td>
        </tr>`).join('') : '<tr><td colspan="4" class="muted">Nothing has been recorded about this store yet.</td></tr>'}
      </tbody>
    </table>
  </div></div>
</section>`,
  });
}

/**
 * The plans page: what each tier grants, who is on it, and who is near a wall.
 *
 * Three things it is careful about.
 *
 * It reads the capability matrix from the DATABASE, because that is the copy a
 * person would edit if they wanted to change a limit — and it compares that
 * against what the running app actually enforces (`drift`), because those are two
 * different things today and the difference is invisible from either side alone.
 *
 * It shows usage against the ceiling for the stores closest to it. The researched
 * reason is blunt: a person who is cut off with no warning reads the refusal as
 * the product failing rather than their allowance filling up, so the count is
 * surfaced before the wall — on their own dashboard, and here so the operator can
 * see it coming too.
 *
 * And it refuses the vocabulary of a subscription business. There is no MRR, no
 * ARR and no churn figure, because the platform's income is two charges that a
 * person matches by hand against a bank statement, and a "monthly recurring
 * revenue" line computed from a plan mix would be a number nobody could reconcile
 * with the money that actually arrived.
 */
export function adminPlans({
  user, consent = null, flash = null, data = null, near = [], drift = [], canExport = false,
}) {
  const plans = data?.plans || [];
  const mix = data?.mix || [];
  const money = data?.money || {};
  const byCode = Object.fromEntries(mix.map((m) => [m.plan_code, m]));
  const totalStores = mix.reduce((sum, m) => sum + m.stores, 0);
  const paying = mix.filter((m) => m.plan_code !== 'free').reduce((sum, m) => sum + m.stores, 0);

  // Every capability either copy knows about, so the matrix cannot omit a key
  // that exists in one and not the other — that omission is exactly the drift a
  // person would miss.
  const capKeys = [...new Set(plans.flatMap((p) => Object.keys(p.capabilities || {})))].sort();
  const show = (value) => {
    if (value === -1) return pill('unlimited', 'accent');
    if (value === true) return 'yes';
    if (value === false) return '<span class="fine">no</span>';
    if (value === null || value === undefined) return '<span class="fine">—</span>';
    return String(value);
  };

  const capMeter = (row) => {
    const pct = Math.min(Number(row.pct_full) || 0, 100);
    const level = pct >= 100 ? 'at' : pct >= 80 ? 'near' : '';
    return `<div class="meter${level ? ` meter-${level}` : ''}" role="img"
      aria-label="${esc(`${row.files} of ${row.cap} files`)}"><span style="width:${pct}%"></span></div>`;
  };

  return adminShell({
    user, consent, current: 'plans', title: 'Plans & usage',
    lede: 'What each tier grants, who is on it, and who is close to a ceiling. Two charges — an upgrade and '
      + 'annual rent — and no share of what creators earn from ads.',
    actions: canExport ? '<a class="btn btn-sm" href="/admin/plans?format=csv">Download CSV</a>' : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

${drift.length ? `<section class="section">
  <div class="note note-warning">
    <strong>The plans table and the running app disagree.</strong>
    ${drift.map((d) => `<div class="fine" style="margin-top:var(--space-2)">${esc(d)}</div>`).join('')}
    The app enforces the values compiled into it, so <em>editing the table changes nothing</em> until the same
    change is made in code. This box exists so that trap is visible on the day somebody falls into it.
  </div>
</section>` : ''}

<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero">
      <div class="kpi-value">${num(paying)}</div>
      <div class="kpi-label">Stores on a paid plan</div>
      <div class="kpi-note">${totalStores ? `Of ${num(totalStores)} live stores — the rest are free, and free is not a trial.` : 'No stores yet.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">NPR ${Number(money.rent_outstanding || 0).toLocaleString('en-IN')}</div>
      <div class="kpi-label">Rent invoiced, not collected</div>
      <div class="kpi-note">Issued and unpaid. Every payment is matched by hand on the payments page.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">NPR ${Number(money.upgrades_pending || 0).toLocaleString('en-IN')}</div>
      <div class="kpi-label">Upgrades awaiting a match</div>
      <div class="kpi-note">A reference was submitted; nobody has matched it against the statement yet.</div>
    </div>
    <div class="kpi${near.some((n) => Number(n.pct_full) >= 100) ? ' kpi-bad' : near.length ? ' kpi-warn' : ''}">
      <div class="kpi-value">${near.length ? `${Math.max(...near.map((n) => Number(n.pct_full) || 0))}%` : 'none'}</div>
      <div class="kpi-label">Fullest store</div>
      <div class="kpi-note">${near.length
    ? `${esc(near[0].name)} at ${num(near[0].files)} of ${num(near[0].cap)} files.`
    : 'No store is near its file allowance.'}</div>
    </div>
  </div>
</section>

<section class="section">
  <div class="section-head">
    <h2>Close to a ceiling</h2>
    <p>${near.length
    ? 'Stores at 60% or more of their allowance, fullest first. The count is shown to the seller on their own dashboard too, before an upload can be refused.'
    : 'Nothing is close. The list is empty, which is the answer.'}</p>
  </div>
  ${near.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-stacked">
      <thead><tr>
        <th>Store</th><th>Plan</th><th class="num">Published</th><th class="num">Allowance</th><th>Fill</th><th>Owner</th>
      </tr></thead>
      <tbody>${near.map((n) => `<tr>
        <td><a href="/admin/stores/${esc(n.slug)}"><strong>${esc(n.name)}</strong></a><div class="fine">/s/${esc(n.slug)}</div></td>
        <td data-label="Plan">${pill(n.plan_name, n.plan_code === 'free' ? '' : 'accent')}</td>
        <td class="num" data-label="Published">${num(n.files)}</td>
        <td class="num" data-label="Allowance">${num(n.cap)}</td>
        <td style="min-width:120px" data-label="Fill">${capMeter(n)}<div class="fine">${num(n.pct_full)}% full</div></td>
        <td class="fine" data-label="Owner">${esc(n.owner_email || 'no owner on file')}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>` : '<div class="empty">Every store has plenty of room. Nothing to do here.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>The plans</h2>
    <p>Prices are per ${plans[0]?.period_months || 12} months, read from the plans table.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Seven columns, and the row is a plan: what it costs, how many stores are on
         it, and how many of those have lapsed. Read down. -->
    <table class="table table-directory table-stacked">
      <thead><tr>
        <th>Plan</th><th class="num">Price</th><th class="num">Stores</th>
        <th class="num">Active</th><th class="num">In grace</th><th class="num">Lapsed</th><th>Status</th>
      </tr></thead>
      <tbody>${plans.map((p) => {
    const m = byCode[p.code] || { stores: 0, active: 0, in_grace: 0, lapsed: 0 };
    return `<tr>
        <td><strong>${esc(p.name)}</strong><div class="fine mono">${esc(p.code)}</div></td>
        <td class="num" data-label="Price">${p.price_npr ? `NPR ${Number(p.price_npr).toLocaleString('en-IN')}` : 'free'}</td>
        <td class="num" data-label="Stores">${num(m.stores)}</td>
        <td class="num" data-label="Active">${num(m.active)}</td>
        <td class="num" data-label="In grace">${m.in_grace ? `${num(m.in_grace)}<div class="fine">features retained</div>` : num(m.in_grace)}</td>
        <td class="num" data-label="Lapsed">${num(m.lapsed)}</td>
        <td data-label="Status">${p.active ? pill('offered', 'success') : pill('not offered', '')}</td>
      </tr>`;
  }).join('')}
      </tbody>
    </table>
  </div></div>
</section>

<section class="section">
  <div class="section-head">
    <h2>What each plan grants</h2>
    <p>Read from the plans table, which is where a limit would be edited. Never gate the ability to sell — these gate scale, surface and polish.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush table-scroll">
    <table class="table">
      <thead><tr><th>Capability</th>${plans.map((p) => `<th>${esc(p.name)}</th>`).join('')}</tr></thead>
      <tbody>${capKeys.map((key) => `<tr>
        <td class="mono small">${esc(key)}</td>
        ${plans.map((p) => `<td>${show((p.capabilities || {})[key])}</td>`).join('')}
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
  <p class="fine" style="margin-top:var(--space-4)">
    ${drift.length
    ? 'The two copies of this table disagree; the warning at the top of the page says where.'
    : 'The running app and this table agree on every value, and a test fails the moment they stop.'}
  </p>
</section>

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">Why there is no revenue figure here</h2>
      <p class="small" style="margin-top:var(--space-3)">
        The platform's income is two charges — an upgrade, and annual rent on a slot — and both arrive as a
        bank transfer that a person matches by hand. A monthly-recurring-revenue number derived from a plan
        mix would not reconcile with the money in the account, and a number that cannot be reconciled is
        worse than no number.
      </p>
      <p class="small">
        What is here instead is what was actually invoiced and what is still unmatched, which is a
        description of work waiting rather than a projection.
      </p>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What a plan never gates</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Earning</dt><dd>Any plan can connect a network and earn. The plans gate capacity, surface and polish — never the ability to make money.</dd>
        <dt>Existing files</dt><dd>A store that is over its allowance keeps everything. Nothing is deleted on downgrade or expiry.</dd>
        <dt>Ad share</dt><dd>No plan takes a percentage of what a creator earns from ads. There is no such charge at any tier.</dd>
      </dl>
    </div></div>
  </div>
</section>`,
  });
}

/**
 * What creators were paid, against what we assume.
 *
 * The seller's earnings page already tells THEM whether our estimate matches
 * their statement, and it ends by asking them to report a gap so the rate can be
 * "corrected". There was nowhere for that correction to happen: the operator
 * could see payments bytebikri receives and nothing about the money the networks
 * pay creators directly.
 *
 * This page is the calibration. It answers one question the platform cannot
 * answer from its own data — is the assumed rate still right — and it is explicit
 * about the two things it will never show: a balance and a payout queue. We are
 * not party to the payment, so the only figure we have is one a creator typed in,
 * and the page says so above the table rather than in a footnote.
 *
 * The verdict function carries the direction and the CONFIDENCE separately, and
 * this page prints both: "we assume 2.1× the rate the statements imply" is a
 * finding, and "from one store" is the reason it is a signal rather than a
 * measurement.
 */
export function adminEarnings({
  user, consent = null, flash = null, rows = [], verdict = null, open = [], assumedRpmUsd = 0.2,
  usdToNpr = 133, canExport = true,
}) {
  const state = (row) => calibrationRowState(row);
  const toneFor = { no_views: 'warn', measurable: '' };
  const gapCell = (row) => {
    const st = state(row);
    if (st.state === 'no_views') {
      // A chip as well as the sentence: this column is scanned, and "Nothing to
      // measure" is the one state where a reader must not think a number is
      // missing because of a bug.
      return `${pill(st.label, 'warning')}<div class="fine">${esc(st.why)}</div>`;
    }
    if (st.state !== 'measurable') return `<span class="fine">${esc(st.label)}</span>`;
    const pct = st.gapPct;
    if (pct === null) return '<span class="fine">no rate to compare</span>';
    const within = Math.abs(pct) <= 15;
    return `${pill(`${pct > 0 ? '+' : ''}${pct}%`, within ? 'success' : 'warning')}
      <div class="fine">${pct > 0 ? 'we estimate higher' : 'we estimate lower'}</div>`;
  };

  return adminShell({
    user, consent, current: 'earnings', title: 'Creator earnings',
    lede: 'What the networks reported to creators, against the arithmetic this platform prices rent from. '
      + 'The statement is the authority; we never see the money.',
    actions: canExport ? '<a class="btn btn-sm" href="/admin/earnings?format=csv">Download CSV</a>' : '',
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}

<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero${verdict.level === 'we_over' ? ' kpi-bad' : verdict.level === 'consistent' ? ' kpi-good' : ''}">
      <div class="kpi-value">${verdict.impliedRpmUsd === null
    ? '—'
    : `$${Number(verdict.impliedRpmUsd).toFixed(2)}`}</div>
      <div class="kpi-label">Per 1,000 views, implied by the statements</div>
      <div class="kpi-note">${verdict.impliedRpmUsd === null
    ? 'No statement yet carries a measurable window.'
    : `The rate we assume is $${Number(assumedRpmUsd).toFixed(2)}. Rent is proportional to it.`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(verdict.periods)}</div>
      <div class="kpi-label">Settled periods compared</div>
      <div class="kpi-note">${verdict.stores
    ? `Across ${plural(verdict.stores, 'store')}. A period in the last five days is not settled.`
    : 'Nothing settled yet.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">$${Number(verdict.totalReported || 0).toFixed(2)}</div>
      <div class="kpi-label">Reported by creators</div>
      <div class="kpi-note">Typed in by them from the network's portal. Not a balance we hold.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">$${Number(verdict.totalEstimate || 0).toFixed(4)}</div>
      <div class="kpi-label">Our estimate · same windows</div>
      <div class="kpi-note">Views inside those periods only, at the assumed rate.</div>
    </div>
  </div>

  <div class="note note-${verdict.level === 'consistent' ? 'success' : verdict.level === 'we_over' ? 'danger' : 'info'}"
       style="margin-top:var(--space-6)">
    <strong>${esc(verdict.headline)}.</strong> ${esc(verdict.detail)}
  </div>
</section>

${open.length ? `<section class="section">
  <div class="section-head">
    <h2>Not counted yet</h2>
    <p>A network closes its books a few days after the month ends, so these are shown and left out of every number above — never silently dropped.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table">
      <thead><tr><th>Store</th><th>Network</th><th>Period</th><th class="num">Reported</th><th>Why it is waiting</th></tr></thead>
      <tbody>${open.map((o) => `<tr>
        <td><a href="/admin/stores/${esc(o.channel_slug)}">${esc(o.channel_name)}</a></td>
        <td>${esc(o.provider_id)}</td>
        <td class="fine nowrap">${esc(isoDay(o.period_start))} → ${esc(isoDay(o.period_end))}</td>
        <td class="num">$${Number(o.reported_usd).toFixed(2)}</td>
        <td class="fine">${Number(o.days_since_end) < 0
    ? 'the period has not ended' : `ended ${plural(Number(o.days_since_end), 'day')} ago — under the five-day settling window`}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>
</section>` : ''}

<section class="section">
  <div class="section-head">
    <h2>Every statement on file</h2>
    <p>${rows.length
    ? 'One row per store and network, with our estimate measured over the SAME days the statement covers.'
    : 'Nothing has been recorded yet.'}</p>
  </div>
  ${rows.length ? `<div class="panel"><div class="panel-body panel-body-flush">
    <!-- Nine columns of money, stacked on a phone. The Gap cell held a pill and
         "we estimate higher" in 94px of width: six lines, and the one word that
         gives the row its meaning was the least readable thing on the page. -->
    <table class="table table-directory table-stacked">
      <thead><tr>
        <th>Store</th><th>Network</th><th>Window</th>
        <th class="num">Periods</th><th class="num">Views in window</th>
        <th class="num">Reported</th><th class="num">Our estimate</th><th class="num">Implied rate</th><th>Gap</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>
          <a href="/admin/stores/${esc(r.channel_slug)}"><strong>${esc(r.channel_name)}</strong></a>
          <div class="fine">${esc(r.owner_email || 'no owner on file')}</div>
        </td>
        <td data-label="Network">${esc(r.provider_id)}</td>
        <td class="fine nowrap" data-label="Window">${esc(isoDay(r.first_period_start))} → ${esc(isoDay(r.last_period_end))}</td>
        <td class="num" data-label="Periods">${num(r.periods)}</td>
        <td class="num" data-label="Views in window">${num(r.views)}${Number(r.views) === 0 ? '<div class="fine">none recorded</div>' : ''}</td>
        <td class="num" data-label="Reported">$${Number(r.reported_usd).toFixed(2)}</td>
        <td class="num" data-label="Our estimate">$${Number(r.estimate_usd).toFixed(4)}</td>
        <td class="num" data-label="Implied rate">${r.implied_rpm_usd === null
      ? '<span class="fine">needs a statement</span>' : `$${Number(r.implied_rpm_usd).toFixed(2)}`}</td>
        <td data-label="Gap">${gapCell(r)}</td>
      </tr>`).join('')}
      </tbody>
    </table>
  </div></div>`
    : `<div class="empty">
        No creator has pasted a figure from their network portal yet. Until one does, the assumed rate is unchecked —
        and this page cannot compute it from our own data, because the network pays the creator directly and we are not a
        party to that payment.
      </div>`}
</section>

<section class="section">
  <div class="cols-2">
    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What correcting it would change</h2>
      <p class="small" style="margin-top:var(--space-3)">
        Rent is twelve months of the platform slot's value, and that value is arithmetic on the assumed rate:
      </p>
      <p class="mono small" style="margin:var(--space-3) 0">
        pageviews ÷ 1,000 × rent slot × $${Number(assumedRpmUsd).toFixed(2)} × ${Number(usdToNpr)} NPR/USD × 12
      </p>
      <p class="small">
        The assumed rate lives in one place — <span class="mono">POLICY.assumedRpmUsd</span> — read by the rent estimate,
        the seller's earnings page and this page, so a correction moves all three together. Nothing else is priced from
        a creator's earnings, and nothing is charged as a share of them.
      </p>
      <p class="small">
        Invoices already issued stand. A rate change applies to the next period, not to a charge somebody has already
        been told to pay.
      </p>
    </div></div>

    <div class="panel"><div class="panel-body">
      <h2 style="font-size:var(--text-md)">What this page will never show</h2>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>A balance</dt><dd>Nothing of a creator's ever passes through us, so there is no balance to display.</dd>
        <dt>A payout queue</dt><dd>The network pays them on its own schedule, to their own account, at its own threshold.</dd>
        <dt>Their true figure</dt><dd>Only what they chose to enter. A creator who never records a statement is invisible here, and that is their call.</dd>
      </dl>
    </div></div>
  </div>
</section>`,
  });
}

export function adminReports({
  user, consent = null, flash = null, rows = [], ruleTitles = {},
  appeals = [], decided = [],
}) {
  const row = (r) => {
    const verdict = reportVerdict({ reporters: r.reporters, byReason: r.byReason });
    const reasons = Object.entries(r.byReason).sort((a, b) => b[1] - a[1])
      .map(([code, n]) => `${ruleTitles[code] || code} ×${n}`).join(' · ');
    return `
    <div class="report-row panel">
      <div class="panel-head">
        <a href="/s/${esc(r.channel_slug)}/a/${esc(r.asset_slug)}" target="_blank" rel="noopener"><strong>${esc(r.title)}</strong></a>
        <span class="fine">/s/${esc(r.channel_slug)}</span>
        <span class="spacer"></span>
        ${verdict.autoHide
          ? pill('Hidden while it is reviewed', 'warning')
          : pill(`Live · ${verdict.reporters} of ${AUTO_HIDE_AFTER} to auto-hide`, '')}
      </div>
      <div class="panel-body">
        <p class="small" style="margin:0"><strong>${esc(verdict.summary)}</strong></p>
        <p class="fine" style="margin:var(--space-2) 0 0">${esc(reasons)}${r.with_notes ? ` · ${r.with_notes} with a note` : ''}
          · first ${esc(relTime(r.first_at))}, latest ${esc(relTime(r.latest))}</p>
        ${r.decidedAppeal ? `<div class="note note-info" style="margin-top:var(--space-3)">
          <span class="fine">An appeal on this file was <strong>${esc(r.decidedAppeal.status)}</strong>
          ${esc(relTime(r.decidedAppeal.decided_at || r.decidedAppeal.created_at))}${r.decidedAppeal.status === 'declined'
    ? ' — dismissing these reports would put the file back and reverse that, so read the note below before you do.' : '.'}</span>
          ${r.decidedAppeal.decision_note ? `<div class="fine" style="margin-top:var(--space-1)">Your note then: “${esc(r.decidedAppeal.decision_note)}”</div>` : ''}
        </div>` : ''}
        ${r.notes && r.notes.length ? `<ul class="list-plain" style="margin-top:var(--space-3)">
          ${r.notes.map((nt) => `<li class="fine">${esc(nt.note)}</li>`).join('')}
        </ul>` : ''}
        <div class="row" style="margin-top:var(--space-4);gap:var(--space-3)">
          <form method="post" action="/admin/reports/${esc(r.asset_id)}">
            <input type="hidden" name="action" value="actioned">
            <button class="btn btn-sm btn-primary" type="submit">Act — remove the file</button>
          </form>
          <form method="post" action="/admin/reports/${esc(r.asset_id)}">
            <input type="hidden" name="action" value="dismissed">
            <button class="btn btn-sm" type="submit">Dismiss — the file is fine</button>
          </form>
          <span class="fine">Removing the file cites the rule and writes nothing to the seller's account.</span>
        </div>
      </div>
    </div>`;
  };

  /**
   * One appeal: everything needed to decide it without opening another tab.
   *
   * The charge is shown TWICE on purpose — what the seller was answering when
   * they wrote (snapshotted at filing) and what stands now. They are different
   * numbers whenever reports have been dismissed in between, and a queue that
   * showed only the current one would let an operator decline an appeal for
   * reports the file no longer has.
   */
  const appealCard = (a) => {
    const filedAgo = daysBetween(a.created_at, new Date());
    const labels = (a.reasons || []).map((c) => ruleTitles[c] || c).join(', ').toLowerCase();
    const grew = a.reports_now > (a.report_count || 0);
    const shrank = a.reports_now < (a.report_count || 0);
    const alreadyBack = !a.hidden_by_reports;
    return `
    <div class="panel report-row" id="appeal-${esc(a.id)}">
      <div class="panel-head">
        <a href="/s/${esc(a.channel_slug)}/a/${esc(a.asset_slug)}" target="_blank" rel="noopener"><strong>${esc(a.asset_title)}</strong></a>
        <span class="fine">${esc(a.channel_name)} · ${esc(a.seller_email || 'seller')}</span>
        <span class="spacer"></span>
        ${pill(filedAgo === 0 ? 'filed today' : `${filedAgo} day${filedAgo === 1 ? '' : 's'} waiting`, filedAgo >= 3 ? 'warning' : 'info')}
      </div>
      <div class="panel-body">
        <blockquote class="quote">${esc(a.statement)}</blockquote>
        <p class="fine" style="margin-top:var(--space-4)">
          Answering <strong>${plural(a.report_count || 0, 'report')}</strong>${labels ? ` for ${esc(labels)}` : ''}.
          ${alreadyBack
    ? 'The file is back already — the reports against it were dismissed, so the threshold is not holding anything down.'
    : `It is still hidden. ${plural(a.reports_now || 0, 'report')} open on it now${grew ? ` (up from ${a.report_count} when this was written)` : shrank ? ` (down from ${a.report_count} when this was written)` : ''}.`}
          Reporters are not shown here, by design — the seller does not get to learn who complained.
        </p>
        ${/* ONE form, two named submit buttons.
              The first cut had two forms and the note field in only one of them, so
              the decline button posted an empty note and the route refused every
              decline there could ever be — a decision that could not be made. A
              button's name/value pair is submitted with its own form, which is all
              this needs: whichever button is pressed carries the note beside it. */''}
        <form method="post" action="/admin/appeals/${esc(a.id)}" style="margin-top:var(--space-4)">
          <div class="field">
            <label for="note-${esc(a.id)}">Your line to the seller</label>
            <textarea class="input" id="note-${esc(a.id)}" name="note" rows="2" maxlength="300"
                      placeholder="e.g. The excerpt is 20 seconds and credited, so the copyright claim does not hold."></textarea>
            <span class="hint">Required to decline — it is the only part of this decision the seller ever sees. Optional when upholding.</span>
          </div>
          <div class="row" style="margin-top:var(--space-3);gap:var(--space-3);flex-wrap:wrap">
            <button class="btn btn-sm btn-primary" type="submit" name="decision" value="upheld">Uphold — restore the file</button>
            <button class="btn btn-sm" type="submit" name="decision" value="declined">Decline — the hiding stands</button>
          </div>
        </form>
        <p class="fine" style="margin-top:var(--space-3)">
          Upholding restores a file only if the report threshold is what is hiding it — never a file the seller paused.
          Declining changes nothing about the file, and the note travels with it to the seller's page.
        </p>
      </div>
    </div>`;
  };

  return adminShell({
    user, consent, current: 'reports', title: 'Reports',
    lede: `A report is a claim, not a verdict. ${AUTO_HIDE_AFTER} distinct reporters hide a file while it waits; one never does.`,
    body: `
${flash ? `<div class="note note-${flash.kind}" style="margin-top:var(--space-6)" role="status">${esc(flash.message)}</div>` : ''}
<section class="section" id="appeals">
  <div class="section-head">
    <h2>Waiting on a person</h2>
    <p>${appeals.length
    ? `${plural(appeals.length, 'appeal')} — a seller whose file is dark has written in and nobody has read it yet. Oldest first.`
    : 'Nothing here. A seller whose file the threshold hid can answer once, and it lands here.'}</p>
  </div>
  ${appeals.length ? appeals.map(appealCard).join('') : '<div class="empty">No appeals waiting.</div>'}
  ${decided.length ? `
  <details class="disclosure" style="margin-top:var(--space-5)">
    <summary class="disclosure-head">
      <span class="disclosure-title" style="font-size:var(--text-sm)">Already decided</span>
      <span class="disclosure-note">${plural(decided.length, 'appeal')}, newest first — the seller sees the note you left</span>
      <span class="disclosure-chevron" aria-hidden="true"></span>
    </summary>
    <div class="panel-body" style="border-top:1px solid var(--border-subtle)">
      ${decided.map((a) => `<div class="row" style="align-items:baseline;gap:var(--space-3);flex-wrap:wrap">
        ${pill(a.status, a.status === 'upheld' ? 'success' : a.status === 'declined' ? 'danger' : '')}
        <span>${esc(a.asset_title)}</span>
        <span class="fine">${esc(a.decided_by_name || 'operator')} · ${esc(relTime(a.decided_at || a.created_at))}${a.restored ? ' · file restored' : ''}</span>
      </div>${a.decision_note ? `<p class="fine" style="margin:var(--space-1) 0 0">${esc(a.decision_note)}</p>` : ''}
      `).join('<hr>')}
    </div>
  </details>` : ''}
</section>
<section class="section">
  <div class="section-head">
    <h2>Open reports</h2>
    <p>${plural(rows.length, 'file')} reported, ordered by how many people said it.</p>
  </div>
  ${rows.length ? rows.map(row).join('') : '<div class="empty">Nothing has been reported.</div>'}
</section>`,
  });
}

/** The audit log: a filter and a table, because that is all it is. */
/**
 * Audit metadata, written the way a person would read it out.
 *
 * The first version printed `JSON.stringify(meta).slice(0, 120)`, which produced
 * things like `{"channelId":"c6326d55-1cb6-43cb-8e8d-b2cc17ed2e0f","plan":"pro"}`
 * — half a UUID, no currency, and a field order that came from object insertion
 * rather than from what matters. Ids are shortened to a fingerprint that is
 * still searchable, money gets a currency and thousands separators, booleans
 * become yes/no, and the fields that describe a decision come first.
 */
/**
 * "a, b and c" — a list as a sentence reads it.
 *
 * Written for the audit page's empty state, which lists the controls that are
 * narrowing the view: "Nothing matches the Money view and actor "bob"."
 */
function listing(items) {
  const parts = items.filter(Boolean).map(String);
  if (parts.length < 2) return parts[0] || 'anything';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

const AUDIT_LABELS = {
  plan: 'plan', planCode: 'plan', channelId: 'store', channelSlug: 'store', slug: 'store',
  assetId: 'file', assetSlug: 'file', paymentId: 'payment', invoiceId: 'invoice',
  connectionId: 'connection', creativeId: 'ad', slotKey: 'slot', amountNpr: 'amount',
  txnReference: 'reference', reference: 'reference', method: 'method', ruleCode: 'rule',
  state: 'state', from: 'was', to: 'now', reason: 'reason', provider: 'network',
  days: 'days', email: 'email', kind: 'kind', outcome: 'outcome', count: 'count',
};
const AUDIT_ORDER = ['channelSlug', 'channelId', 'slug', 'email', 'plan', 'planCode', 'kind',
  'from', 'to', 'state', 'ruleCode', 'reason', 'provider', 'slotKey', 'assetSlug', 'assetId',
  'paymentId', 'invoiceId', 'connectionId', 'method', 'amountNpr', 'txnReference', 'reference'];

function auditValue(key, value, nprFmt) {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (key === 'amountNpr' || key === 'amount') return nprFmt(Number(value));
  if (key === 'days') return `${value} days`;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return relTime(str);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str)) return str.slice(0, 8);
  return str.length > 48 ? `${str.slice(0, 47)}…` : str;
}

export function briefMeta(meta) {
  if (!meta) return '';
  let value = meta;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value.slice(0, 140); }
  }
  if (typeof value !== 'object' || value === null) return String(value).slice(0, 140);
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
  entries.sort((a, b) => {
    const ia = AUDIT_ORDER.indexOf(a[0]); const ib = AUDIT_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // `ads: yes`, not `ads yes`. Two words in a row read as a phrase — the label and
  // the value blur into each other, and "ads yes" is not a sentence anybody wrote.
  return entries.map(([k, v]) => `${AUDIT_LABELS[k] || k}: ${auditValue(k, v, npr)}`).join(' · ').slice(0, 220);
}

/**
 * The audit log, organised around the question it is read to answer.
 *
 * What it replaced: the newest 300 rows, filtered by substring in JavaScript, and
 * a header that said "12 of 300" — a number describing the page's own array. An
 * operator could not tell a table with 300 rows from one with three million, and
 * could not filter by who or by when at all. The research on audit UIs is
 * unanimous that filtering is what keeps a feed usable after the first week, and
 * that the actor has to be unambiguous — "so admins can tell 'Dana deleted it'
 * from 'Nightly billing sync updated it'".
 *
 * Three things follow from that:
 *
 *  - **Families, with counts taken over the whole table.** The default view is the
 *    families that record a person deciding something, because that is what an
 *    audit page is read for. It is a filter, not a hiding: the count of every
 *    family is on the tabs, and the total in the table is printed next to it. The
 *    one family that will dwarf the rest — sign-ins — says so on its own tab.
 *  - **Who, without ambiguity.** A person, the platform, or a visitor: three
 *    kinds, never a dash.
 *  - **A stated window.** "Showing 50 of 1,204 matching, out of 8,930 in the
 *    table" — so nobody reads a page of results as the whole history.
 */
export function adminAudit({
  user, consent = null, data = null, filters = {}, canExport = true,
}) {
  const rows = data?.rows || [];
  const counts = data?.counts || {};
  const allRows = data?.allRows || 0;
  const total = data?.total || 0;
  const page = data?.page || 1;
  const pages = data?.pages || 1;
  const perPage = data?.perPage || 50;
  const { family = 'decisions', actor = '', q = '', since = 'all' } = filters;

  const familyCount = (key) => (key === 'decisions'
    ? AUDIT_FAMILIES.filter((f) => f.decisions).reduce((sum, f) => sum + (counts[f.key]?.n || 0), 0)
    : key === 'all' ? allRows : (counts[key]?.n || 0));

  const link = (next) => {
    const params = new URLSearchParams();
    const merged = { family, actor, q, since, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (!v) continue;
      // Only the DEFAULTS are dropped. `family=all` is a real view — "Everything" —
      // and treating it like an empty value sent every pager link from that tab to
      // the Decisions tab instead, which is a different page of a different log.
      if (k === 'family' && v === 'decisions') continue;
      if (k === 'since' && v === 'all') continue;
      params.set(k, v);
    }
    const qs = params.toString();
    return `/admin/audit${qs ? `?${qs}` : ''}`;
  };

  const TABS = [
    { key: 'decisions', label: 'Decisions', note: 'Every row where a person chose something, across the families below.' },
    ...AUDIT_FAMILIES.map((f) => ({ key: f.key, label: f.label, note: f.note })),
    { key: 'all', label: 'Everything', note: 'The whole table, including the background noise.' },
  ];
  const shown = TABS.find((t) => t.key === family) || TABS[0];

  // Named, so an empty tab tells the operator which control to undo rather than
  // leaving them to audit their own URL.
  const narrowing = [
    family !== 'decisions' ? `${shown.label === 'Everything' ? 'the whole log' : `the ${shown.label} view`}` : null,
    actor ? `actor "${actor}"` : null,
    q ? `"${q}"` : null,
    since !== 'all' ? `the last ${since}` : null,
  ].filter(Boolean);

  const when = (value) => {
    const d = new Date(value);
    // UTC, labelled. The server renders HTML without knowing the reader's
    // timezone, and a plausible-looking local time that is silently wrong is the
    // worst of the three options for a record people check against each other.
    const iso = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
    return `<span class="mono small">${esc(iso)}</span><div class="fine">${esc(relTime(value))}</div>`;
  };

  return adminShell({
    user, consent, current: 'audit', title: 'Audit log',
    lede: 'What happened, who did it, and what it was about. Times are UTC — this is the record people check '
      + 'against each other, so an hour that might be local would be worse than useless.',
    actions: canExport ? `<a class="btn btn-sm" href="${esc(link({ format: 'csv', page: undefined }))}">Download CSV</a>` : '',
    body: `
<section class="section">
  <div class="kpi-row">
    <div class="kpi kpi-hero">
      <div class="kpi-value">${num(allRows)}</div>
      <div class="kpi-label">Rows in the log</div>
      <div class="kpi-note">Never edited and never deleted — the table is append-only, and an audit trail that gets tidied stops being one.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(familyCount('decisions'))}</div>
      <div class="kpi-label">Decisions by people</div>
      <div class="kpi-note">Money, moderation, accounts and exports — the rows this page opens on.</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${num(familyCount('signins'))}</div>
      <div class="kpi-label">Sign-ins</div>
      <div class="kpi-note">${familyCount('signins') && familyCount('signins') > familyCount('decisions')
    ? 'More of these than decisions, which is exactly why they have their own tab.'
    : 'One row each, kept, and kept out of the way.'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-value">${counts.delivery?.n ? num(counts.delivery.n) : 'none'}</div>
      <div class="kpi-label">Callbacks and jobs</div>
      <div class="kpi-note">The platform talking to itself. An empty tab here is the good news.</div>
    </div>
  </div>
</section>

<section class="section">
  <nav class="segments" aria-label="Families">
    ${TABS.map((t) => `<a href="${esc(link({ family: t.key, page: undefined }))}"
      ${t.key === family ? 'aria-current="page"' : ''}>${esc(t.label)}<span class="seg-count">${num(familyCount(t.key))}</span></a>`).join('')}
  </nav>
  <p class="fine" style="margin-top:var(--space-3)">${esc(shown.note)}</p>

  <form class="filters" method="get" action="/admin/audit" role="search" style="margin-top:var(--space-5)">
    <input type="hidden" name="family" value="${esc(family)}">
    <div class="field" style="flex:1 1 200px">
      <label for="actor">Who</label>
      <input class="input" id="actor" name="actor" type="search" value="${esc(actor)}" placeholder="Name or email">
    </div>
    <div class="field" style="flex:2 1 240px">
      <label for="q">Action or detail</label>
      <input class="input" id="q" name="q" type="search" value="${esc(q)}" placeholder="rent, postback, a reference number">
    </div>
    <div class="field">
      <label for="since">When</label>
      <select class="input" id="since" name="since">
        ${[['all', 'Any time'], ['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['month', 'Last 30 days']]
    .map(([v, l]) => `<option value="${v}"${since === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="filters-foot">
      <button class="btn btn-primary" type="submit">Apply</button>
      ${(actor || q || since !== 'all' || family !== 'decisions') ? `<a class="btn btn-sm" href="/admin/audit">Clear</a>` : ''}
    </div>
  </form>

  <div class="section-head" style="margin-top:var(--space-6)">
    <h2>${total ? `${num(total)} row${total === 1 ? '' : 's'}` : 'Nothing matches'}</h2>
    <p>${total
    ? `Showing ${num(rows.length)} of ${num(total)} matching, out of ${num(allRows)} in the table. `
      + `${pages > 1 ? `Page ${num(page)} of ${num(pages)}.` : 'That is all of them.'}`
    : (allRows === 0
      ? 'The table is empty — nothing has been recorded yet. Every sign-in, decision and callback is written '
        + 'here the first time it happens, so this is the state before the first one.'
      // A chosen FAMILY is a filter like any other. Reading the Money tab with no
      // rows and being told the log is empty is wrong in the one place wrongness is
      // least affordable — and it was the first thing a real look at the page found.
      : `Nothing matches ${listing(narrowing)}. The log holds ${num(allRows)} row${allRows === 1 ? '' : 's'} `
        + 'in total, so widen the time range, drop the family, or clear the search.')}</p>
  </div>

  ${rows.length ? `
  <div class="panel"><div class="panel-body panel-body-flush">
    <table class="table table-directory table-stacked">
      <thead><tr><th>When · UTC</th><th>Action</th><th>Who</th><th>What it was about</th><th>Detail</th></tr></thead>
      <tbody>${rows.map((r) => {
    const who = actorOf(r);
    const subject = subjectOf(r);
    const brief = briefMeta(r.meta);
    // `data-label` is what the phone layout reads: below 700px the header row is
    // hidden and each cell carries its own column name, because five columns in
    // 650px of a 390px screen is a table nobody can read and nobody scrolls.
    return `<tr>
        <td data-label="When" style="white-space:nowrap">${when(r.created_at)}</td>
        <td data-label="Action">
          <span class="mono small">${esc(r.action)}</span>
          <div class="fine">${esc(FAMILY_LABELS[r.family] || r.family)}</div>
        </td>
        <td data-label="Who">
          <strong${who.kind === 'person' ? '' : ' class="muted"'} style="font-weight:${who.kind === 'person' ? '600' : '400'}">${esc(who.label)}</strong>
          <div class="fine">${esc(who.detail || '')}</div>
        </td>
        <td data-label="What it was about" class="fine">${subject
    ? `${subject.href
      ? `<a href="${esc(subject.href)}">${esc(subject.label || subject.type)}</a>`
      : esc(subject.label || subject.type)}${
      subject.label ? `<div class="fine">${esc(subject.label === subject.type ? '' : subject.type)}</div>` : ''}`
    : '<span class="fine">—</span>'}</td>
        <td data-label="Detail" class="fine">
          ${brief ? esc(brief) : '<span class="muted">—</span>'}
          ${r.meta ? `<details><summary class="fine">raw</summary><pre class="meta-json">${esc(JSON.stringify(r.meta, null, 1))}</pre></details>` : ''}
        </td>
      </tr>`;
  }).join('')}
      </tbody>
    </table>
  </div></div>
  ${pages > 1 ? `<nav class="pager" aria-label="Pages">
    ${page > 1 ? `<a class="btn btn-sm" href="${esc(link({ page: page - 1 }))}">← Newer</a>` : ''}
    <span class="fine">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? `<a class="btn btn-sm" href="${esc(link({ page: page + 1 }))}">Older →</a>` : ''}
  </nav>` : ''}
  ` : `<div class="empty">${allRows === 0
    ? 'Nothing has been written to the log yet.'
    : 'No rows match. Clear the filters above, or open Everything to see the whole log.'}</div>`}
</section>`,
  });
}


/** The bucket an invoice falls into, from the one shared definition. */
const ageOf = (invoice) => rentAge(invoice.due_at);

export function operatorBilling({
  user, consent = null, flash = null, payments = [], invoices = [], payee = null, console = false,
  // Rent owed with its age, and the same money month by month. Both come from
  // queries that share one definition of "still owed" — the first version of
  // `platformMoney` filtered on two statuses the schema forbids and silently
  // dropped every invoice a payer had already claimed to have paid.
  aging = null, byMonth = [],
  // ByteBikri Plus claims, waiting for a person to find the transfer on the
  // platform's own statement. Separate from the store queue because the consequence
  // of a match is different: a store's plan turns capabilities on, a person's turns
  // a look on and opens nothing at all.
  plusPayments = [],
  // The platform's own numbers for the third charge, from `platformMoney()`: how many
  // arrangements are running, how many have run out, and where the gifts are. Passed
  // in rather than counted here — the console's totals are the same arithmetic the
  // payments queue shows, and two counts of the same thing is how a dashboard starts
  // lying. Rendering them is `plusConsoleRows()`, which was written with the plan in
  // 0033 and had no reader until this page: a KPI table nothing renders is a KPI
  // nobody has.
  money = null,
}) {
  // `aging` defaults to the queue itself. The two are the same rows — aging just
  // carries the due date and the days late — so a caller that passes only
  // `invoices` (every existing test, and any older route) still gets the table
  // rather than an empty page. An invoice with no due date renders as "no due
  // date" instead of being quietly treated as on time.
  const aged = aging ?? invoices;
  const payRows = payments.map((p) => `
    <tr>
      <td>
        <strong>${esc(p.channel_name)}</strong>
        <div class="fine">/s/${esc(p.channel_slug)} · ${esc(p.plan_code)}</div>
      </td>
      <td class="mono" data-label="Reference">${esc(p.txn_reference)}</td>
      <td data-label="Method">${esc(p.method)}${p.payer_name ? `<div class="fine">${esc(p.payer_name)}${p.payer_number ? ` · ${esc(p.payer_number)}` : ''}</div>` : ''}</td>
      <td class="num" data-label="Amount">${npr(p.amount_npr)}</td>
      <td class="fine" data-label="When">${relTime(p.created_at)}</td>
      <td data-label="Actions">
        <form class="inline-form" method="post" action="/admin/payments/plan/${esc(p.id)}">
          <button class="btn btn-sm btn-primary" name="action" value="match" type="submit">Match</button>
          <button class="btn btn-sm btn-danger" name="action" value="reject" type="submit">Reject</button>
        </form>
      </td>
    </tr>`).join('');

  /*
   * A GIFT IN THIS QUEUE IS A DIFFERENT DECISION, and the operator has to see which
   * one they are making before they press the button. Matching a gift FUNDS it: it
   * does not start the payer's own month and does not touch the row they are already
   * wearing. Without this line the two claims look identical, and an operator whose
   * mental model is "match = start their month" would be wrong about half of them.
   */
  const plusRows = plusPayments.filter((p) => p.status === 'submitted').map((p) => {
    const giftLine = p.gift_id
      ? `<div class="fine"><span class="pill pill-accent">gift</span>
          <span class="mono">${esc(p.gift_code || '')}</span> — for somebody else${
        p.gift_note ? ` · “${esc(p.gift_note)}”` : ''}. Matching funds the code; the payer's own period is not touched.</div>`
      : '';
    return `
    <tr>
      <td>
        <strong>${esc(p.display_name || p.email)}</strong>
        <div class="fine">${esc(p.email)} · ${esc(p.plan_code)}</div>
        ${giftLine}
      </td>
      <td class="mono" data-label="Reference">${esc(p.txn_reference)}</td>
      <td data-label="Method">${esc(p.method)}${p.payer_name ? `<div class="fine">${esc(p.payer_name)}</div>` : ''}</td>
      <td class="num" data-label="Amount">${npr(p.amount_npr)}</td>
      <td class="fine" data-label="When">${relTime(p.created_at)}</td>
      <td data-label="Actions">
        <form class="inline-form" method="post" action="/admin/payments/plus/${esc(p.id)}">
          <button class="btn btn-sm btn-primary" name="action" value="match" type="submit">${
    p.gift_id ? 'Fund the gift' : 'Match'}</button>
          <button class="btn btn-sm btn-danger" name="action" value="reject" type="submit">Reject</button>
        </form>
      </td>
    </tr>`;
  }).join('');

  const rentRows = invoices.map((i) => `
    <tr>
      <td>
        <strong>${esc(i.channel_name)}</strong>
        <div class="fine">/s/${esc(i.channel_slug)}</div>
      </td>
      <td>${day(i.period_start)} → ${day(i.period_end)}</td>
      <td class="mono">${esc(i.txn_reference || 'none given')}</td>
      <td class="num">${npr(i.amount_npr)}</td>
      <td>${pill(i.status, i.status === 'submitted' ? 'info' : 'warning')}</td>
      <td>
        <form class="inline-form" method="post" action="/admin/payments/rent/${esc(i.id)}">
          <button class="btn btn-sm btn-primary" type="submit">Mark paid</button>
        </form>
      </td>
    </tr>`).join('');

  const body = `
<div class="section" style="margin-block:var(--space-8) var(--space-2)">
  <h1 style="font-size:var(--text-2xl)">Billing queue</h1>
  <p class="lede" style="margin-top:var(--space-4)">
    Both of these are matched against the platform's own statement by hand.
    ${payee ? `Money arrives in the name of <strong>${esc(payee)}</strong>.` : '<strong>No payee name is configured</strong> — set <span class="mono">OPERATOR_LEGAL_NAME</span>.'}
    Matching an upgrade activates the subscription; it is the only thing that does.
  </p>
</div>
${flashNote(flash)}

<section class="section">
  <div class="section-head"><h2>Upgrades waiting</h2><p>${plural(payments.length, 'payment')}</p></div>
  ${payments.length ? `
    <div class="panel"><div class="panel-body panel-body-flush">
      <!-- Six columns; a phone showed the store, the reference and half the method,
           and the operator's two buttons were off the right edge. -->
      <table class="table table-stacked">
        <thead><tr><th>Store</th><th>Reference</th><th>Method</th><th class="num">Amount</th><th>When</th><th></th></tr></thead>
        <tbody>${payRows}</tbody>
      </table>
    </div></div>`
    : '<div class="empty">Nothing waiting. Upgrades only appear here once a seller has submitted a reference.</div>'}
</section>

<section class="section">
  <div class="section-head">
    <h2>Plus claims</h2>
    <p>${plusPayments.filter((p) => p.status === 'submitted').length} waiting · a match turns a look on and opens nothing</p>
  </div>
  ${plusPayments.filter((p) => p.status === 'submitted').length ? `
    <div class="panel"><div class="panel-body panel-body-flush">
      <table class="table table-stacked">
        <thead><tr><th>Person</th><th>Reference</th><th>Method</th><th class="num">Amount</th><th>When</th><th></th></tr></thead>
        <tbody>${plusRows}</tbody>
      </table>
    </div></div>` : '<div class="empty">Nothing waiting. A claim appears here the moment somebody submits a reference.</div>'}
  <p class="fine" style="margin-top:var(--space-4)">
    Read the reference against the platform's own statement, the same way as a store plan. Nothing about
    this charge opens a file, removes an ad, or entitles anybody to a creator's work — if a claim ever
    looked like it would, that would be a bug rather than a feature.
  </p>
  ${money ? `<div class="panel" style="margin-top:var(--space-5)"><div class="panel-head"><h2>Where the third charge stands</h2>
      <span class="spacer"></span><span class="fine">read from the same tables as the queue above</span></div>
    <div class="panel-body">
      <dl class="kv">
        ${plusConsoleRows({
    active: money.plusActive ?? money.plus_active ?? 0,
    pending: money.plusPending ?? money.plus_pending ?? 0,
    lapsed: money.plusLapsed ?? money.plus_lapsed ?? 0,
    paidThisMonth: money.plusThisMonthNpr ?? money.plus_this_month ?? 0,
    price: money.plusPrice ?? 149,
    giftsReserved: money.giftsReserved ?? money.gifts_reserved ?? 0,
    giftsReady: money.giftsReady ?? money.gifts_ready ?? 0,
    giftsRedeemed: money.giftsRedeemed ?? money.gifts_redeemed ?? 0,
    giftsVoid: money.giftsVoid ?? money.gifts_void ?? 0,
  }).map((r) => `<dt>${esc(r.term)}</dt><dd>${esc(r.text)}</dd>`).join('')}
        <dt>Recurring</dt><dd>NPR ${Number((money.plusActive ?? money.plus_active ?? 0)
    * (money.plusPrice ?? 149)).toLocaleString('en-IN')} a month if every running arrangement renews —
        nothing renews by itself here, so this is a ceiling rather than a forecast.</dd>
      </dl>
      <p class="fine" style="margin-top:var(--space-3)">The two numbers the researched KPI list names for a
      subscription product are on this row and they mean what the manual rail allows: <strong>active</strong>
      is arrangements running now, <strong>lapsed</strong> is periods that ended of their own accord. Nothing
      here is a card on file, and the ceiling is not a projection.</p>
    </div></div>` : ''}
</section>

<section class="section">
  <div class="section-head">
    <h2>Rent owed, by age</h2>
    <p>${invoices.length
    ? 'Sorted by how late it is, not by how big. What the next action is depends on age.'
    : 'Nothing outstanding. Rent invoices are only issued where a page is long enough to spare a slot.'}</p>
  </div>

  ${invoices.length ? `
  <div class="kpi-row" style="margin-bottom:var(--space-5)">
    ${AGE_BUCKETS.map((b) => {
    const rowsIn = aged.filter((a) => ageOf(a).level === b.key);
    const sum = rowsIn.reduce((t, r) => t + Number(r.amount_npr || 0), 0);
    const tone = b.key === 'stale' ? ' kpi-bad' : b.key === 'old' ? ' kpi-warn' : '';
    return `<div class="kpi${rowsIn.length ? tone : ''}">
      <div class="kpi-value">NPR ${sum.toLocaleString('en-IN')}</div>
      <div class="kpi-label">${esc(b.label)}</div>
      <div class="kpi-note">${rowsIn.length ? plural(rowsIn.length, 'invoice') : b.note}</div>
    </div>`;
  }).join('')}
  </div>

  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Eight columns. The row ends in the one action this page exists for — Mark
         paid — which on a phone was the last thing past the right edge. -->
    <table class="table table-stacked">
      <thead><tr><th style="min-width:170px">Store</th><th>Period</th><th>Due</th><th>Age</th><th>Reference</th><th class="num">Amount</th><th>State</th><th></th></tr></thead>
      <tbody>${aged.map((a) => {
    const age = ageOf(a);
    return `<tr>
        <td>
          <strong>${esc(a.channel_name)}</strong>
          <div class="fine">/s/${esc(a.channel_slug)}${a.owner_email ? ` · ${esc(a.owner_email)}` : ''}</div>
        </td>
        <td class="fine nowrap" data-label="Period">${esc(isoDay(a.period_start))} → ${esc(isoDay(a.period_end))}</td>
        <td class="fine nowrap" data-label="Due">${esc(isoDay(a.due_at) || 'not dated')}</td>
        <td data-label="Age">${age.level === 'current' || age.level === 'unknown'
      ? `<span class="fine">${esc(age.label)}</span>`
      : pill(age.label, age.level === 'stale' ? 'danger' : 'warning')}</td>
        <td class="mono fine" data-label="Reference">${esc(a.txn_reference || 'none given')}</td>
        <td class="num" data-label="Amount">${npr(a.amount_npr)}</td>
        <td data-label="State">${pill(a.status, a.status === 'submitted' ? 'info' : 'warning')}</td>
        <td data-label="Actions">
          <form class="inline-form" method="post" action="/admin/payments/rent/${esc(a.id)}">
            <button class="btn btn-sm btn-primary" type="submit">Mark paid</button>
          </form>
        </td>
      </tr>`;
  }).join('')}
      </tbody>
    </table>
  </div></div>
  ${aged.some((a) => ageOf(a).level === 'unknown') ? `<p class="fine" style="margin-top:var(--space-4)">
    ${plural(aged.filter((a) => ageOf(a).level === 'unknown').length, 'invoice')} could not be aged — no due date on
    the row. They are in the list below and in no bucket above, because putting them in one would invent an age.
  </p>` : ''}
  <p class="fine" style="margin-top:var(--space-4)">
    Terms: ${esc(RENT_TERMS.sentence)} ${esc(RENT_TERMS.why)}
    Invoices issued before due dates existed are measured from the day they were issued — the terms are being
    stated now, and nothing already sent is made late retroactively.
  </p>`
    : '<div class="empty">Nothing outstanding. Rent invoices are only issued where a page is long enough to spare a slot, and the demo store has one waiting for a match.</div>'}
</section>

${byMonth.length ? `<section class="section">
  <div class="section-head">
    <h2>Rent, month by month</h2>
    <p>Grouped by the period each invoice covers, not by when it was paid — March's rent is March's, whether it arrived in March or June.</p>
  </div>
  <div class="panel"><div class="panel-body panel-body-flush">
    <!-- Five money columns. Each row is a month, and at 390px the four figures
         could not fit beside the month name — the last one was cut off. -->
    <table class="table table-stacked">
      <thead><tr><th>Month</th><th class="num">Billed</th><th class="num">Collected</th><th class="num">Late now</th><th>Invoices</th></tr></thead>
      <tbody>${byMonth.map((m) => {
    const billed = Number(m.billed_npr || 0);
    const collected = Number(m.collected_npr || 0);
    const pct = billed ? Math.round((collected / billed) * 100) : 0;
    return `<tr>
        <td class="mono">${esc(m.month)}</td>
        <td class="num" data-label="Billed">${npr(billed)}</td>
        <td class="num" data-label="Collected">${npr(collected)}${billed
    ? `<div class="meter${pct >= 100 ? ' meter-full' : ' meter-near'}" role="img" aria-label="${esc(`${pct}% collected`)}"><span style="width:${Math.min(pct, 100)}%"></span></div>`
    : ''}</td>
        <td class="num" data-label="Late now">${Number(m.late_invoices) ? `${num(m.late_invoices)}<div class="fine">still owed</div>` : '<span class="fine">nothing late</span>'}</td>
        <td class="fine" data-label="Invoices">${num(m.paid_invoices)} of ${num(m.invoices)} paid${Number(m.waived_npr) ? ` · ${npr(m.waived_npr)} waived` : ''}</td>
      </tr>`;
  }).join('')}
      </tbody>
    </table>
  </div></div>
  <p class="fine" style="margin-top:var(--space-4)">
    There is no revenue projection on this page. What was invoiced and what arrived are both facts; a
    forecast built from a plan mix is a number that cannot be reconciled with the bank.
  </p>
</section>` : ''}`;

  // Rendered inside the console shell now, so the operator keeps one frame of
  // reference: the same navigation, the same badge counts, the same title style.
  return console
    ? adminShell({ user, consent, current: 'payments', title: 'Payments', lede: 'Every transfer a person has to match against the statement.', body, flash })
    : layout({ title: 'Billing queue', user, consent, current: 'admin', body });
}

// ---------------------------------------------------------------------------
// Earnings — whose money, and who is holding it
// ---------------------------------------------------------------------------

/**
 * The page where a creator finds out how they get paid.
 *
 * It leads with the counterparty, not the number, because that is the fact a
 * creator has to understand: the money on this page is being paid by an ad
 * network into their account, and bytebikri is not in the path. A dashboard that
 * puts a dollar figure at the top and mentions the payer in a footnote is how
 * people come to believe a platform is holding their earnings.
 *
 * The two numbers that can appear here are deliberately kept apart:
 *
 *   our estimate — arithmetic, `completed views ÷ 1000 × assumed rate`
 *   their report — a figure the creator pasted from the network's statement
 *
 * When they disagree the network is right, and the page says which direction it
 * disagrees in, because rent is priced from the same model that produced the
 * estimate.
 */
/**
 * THE ATTENTION LEDGER — what was watched, and what was drawn (ASSET_ECONOMY §12).
 *
 * Two blocks, and the whole design of the page is that they are never added together.
 * The first counts VIEWS A NETWORK VERIFIED on this store's files, by page and by
 * placement: that is the store's own inventory, the network pays them directly, and
 * this page is not the authority on what they were paid — the statement is.
 *
 * The second counts POSITIONS WE DREW on the store's pages, split by whose position it
 * was. Ours is labelled as ours and carries no rupee figure, because there is no honest
 * one to print: a flat direct deal is priced by conversation (§5.5), and a rate invented
 * here would be a number nobody agreed to, sitting where a reader would take it for an
 * invoice.
 *
 * Nothing on this page is a promise about money, which is why it can be shown to a
 * seller at all while the product still moves no money in-app.
 */
export function attentionLedger({
  channel, user, consent = null, ledger = {}, days = 30,
}) {
  const watched = ledger.watched ?? [];
  const drawn = ledger.drawn ?? [];
  const totals = ledger.totals ?? {};

  // The words come from the catalogues: a placement is labelled by `placement.js` and a
  // page kind by the list below, so a new placement arrives here named rather than coded.
  const placeLabel = (key) => (key ? (PLACEMENTS[key]?.label ?? key) : 'Not recorded');
  const pageLabel = (key) => ({
    storefront: 'Storefront', asset: 'File page', member_room: 'Members’ room',
    library: 'Library', plus: 'Plus page', platform: 'Our own pages',
  }[key] ?? (key ? key : 'Not recorded'));

  const watchedRows = watched.map((r) => `
    <tr>
      <td>${esc(pageLabel(r.surface))}</td>
      <td>${esc(placeLabel(r.placement))}</td>
      <td class="num" data-label="Views">${num(r.views)}</td>
      <td class="num" data-label="Seconds">${r.seconds ? num(r.seconds) : '<span class="fine">not reported</span>'}</td>
    </tr>`).join('');

  /*
   * The drawn block is grouped by SIDE, and each side gets its own heading. The store's
   * own boxes are theirs; the platform slot is ours. A single list would invite the
   * reader to total it, and the total would be a number that means nothing.
   */
  const sideRows = (side) => drawn.filter((r) => r.side === side).map((r) => `
    <tr>
      <td>${esc(pageLabel(r.surface))}</td>
      <td>${esc(placeLabel(r.placement))}</td>
      <td class="num" data-label="Positions drawn">${num(r.impressions)}</td>
    </tr>`).join('');
  const mineDrawn = sideRows('store');
  const oursDrawn = sideRows('platform');

  /*
   * Views recorded before this page counted placement sit in one honest row rather than
   * being spread across placements they may never have had — and the reader is told
   * which row that is, because "Not recorded" with no explanation reads like a fault in
   * the page instead of a fact about history.
   */
  const unplacedViews = watched
    .filter((r) => !r.surface || !r.placement)
    .reduce((n, r) => n + (Number(r.views) || 0), 0);

  const table = (head, rows, empty) => (rows
    ? `<div class="table-scroll"><table class="table">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<p class="fine">${esc(empty)}</p>`);

  return layout({
    title: 'The attention ledger', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
    <div class="section">
      <h1>The attention ledger</h1>
      <p class="lede">What was watched on your files, and what was drawn on your pages — counted, kept
      apart, and not a statement of money.</p>
      <p class="fine" style="margin-top:var(--space-3)">The money itself — who pays you, and what we
      charge — is on the <a href="/dashboard/${esc(channel.slug)}/earnings">earnings page</a>.</p>
    </div>

    <div class="card card-pad-lg">
      <div class="section-head">
        <h2>Watched on your files</h2>
        <p class="small">Verified views in the last ${num(days)} days, by page and by placement. A view
        counts here when the network's own postback says somebody finished an ad — the same event that
        credits your standing and that the network pays you for. <strong>The statement is the network's,
        not ours.</strong></p>
      </div>
      ${table('<th>Page</th><th>Placement</th><th class="num">Views</th><th class="num">Seconds</th>',
        watchedRows, 'No verified view yet in this period. A view appears here only after the network confirms it.')}
      <p class="fine" style="margin-bottom:0">${num(totals.views)} views · ${num(totals.seconds)} seconds
      watched. Seconds are what the player reported; a view that reported none shows
      <em>not reported</em> rather than a zero, because a guess is not a count.</p>
      ${unplacedViews ? `<p class="fine">${num(unplacedViews)} of those views were recorded before this
      ledger counted where a view sat. They are listed as <em>not recorded</em> rather than filed under a
      placement they may not have had.</p>` : ''}
    </div>

    <div class="card card-pad-lg">
      <div class="section-head">
        <h2>Drawn on your pages</h2>
        <p class="small">Positions this application actually rendered, counted once per page load. A
        rendered position is not a person: refreshes count, and so do your own visits. That is why this
        number is evidence of what we drew and never a bill.</p>
      </div>
      <h3 style="margin-top:var(--space-5)">Your own boxes</h3>
      ${table('<th>Page</th><th>Placement</th><th class="num">Positions drawn</th>',
        mineDrawn, 'Your own positions have not been drawn in this period.')}
      <h3>Our slot, on your pages</h3>
      <p class="small">This is our inventory, not yours — it is not your ad space, it is not your
      revenue, and nothing about it reduces what the network pays you. We count it because a position
      that is sold to somebody has to be provable before it is invoiced.</p>
      ${table('<th>Page</th><th>Placement</th><th class="num">Positions drawn</th>',
        oursDrawn, 'Our slot has not been drawn on your pages in this period.')}
      <p class="fine" style="margin-bottom:0">No rupee figure is printed for our own positions. A flat
      deal for a surface is priced by conversation, and a rate shown here would be a number nobody has
      agreed to.</p>
    </div>`,
  });
}

export function earnings({
  channel, user, consent = null, flash = null, summary, byAsset = [], days = 30,
  connections = [], providers = [], suggestions = [], sandboxIds = [], payoutAccounts = [], reports = [], rent = null, plan = null,
  usdToNpr = 133, moneyMap, checklist = [], rpmUsd = 0.2,
}) {
  const accountOf = (id) => payoutAccounts.find((p) => p.provider_id === id) || null;

  const providerRows = summary.lines.map((l) => {
    const account = accountOf(l.providerId);
    const provider = providers.find((p) => p.id === l.providerId);
    const verdict = provider?.verdict || null;
    const gapPill = l.reported === null
      ? pill('no statement yet')
      : l.verdict.level === 'consistent' ? pill('matches', 'success')
        : l.verdict.level === 'we_over' ? pill('we count higher', 'warning')
          : l.verdict.level === 'we_under' ? pill('statement higher', 'info')
            : pill('disagrees', 'danger');

    return `<tr>
      <td>
        <strong>${esc(l.providerName)}</strong>
        ${provider ? `<div class="fine">${verdict?.usableMethods?.length
          ? `Pays out via ${esc(verdict.usableMethods.join(', '))}`
          : esc(verdict?.message || '')}</div>` : ''}
      </td>
      <td class="num" data-label="Views">${num(l.views)}</td>
      <td class="num" data-label="Our estimate">$${l.estimateUsd.toFixed(2)}
        ${l.postbackUsd > 0 ? `<div class="fine">$${l.postbackUsd.toFixed(2)} in postbacks</div>` : ''}</td>
      <td class="num" data-label="Statement">${l.reported === null ? '<span class="fine">not reported</span>' : `$${l.reported.toFixed(2)}`}</td>
      <td data-label="Verdict">${gapPill}</td>
      <td data-label="Your account there">${account
        ? `<div class="small">${esc(account.account_label)}</div>
           <div class="fine">${esc(account.payout_method || 'method not noted')}${
    account.status === 'changed' ? ' · you said this changed' : ''}</div>`
        : `<span class="fine">Not recorded — and we do not need it. It is your account at the network.</span>`}</td>
    </tr>`;
  }).join('');

  const assetRows = byAsset.slice(0, 12).map((a) => `
    <tr>
      <td>
        <a href="/s/${esc(channel.slug)}/a/${esc(a.slug)}">${esc(a.title)}</a>
        ${a.status !== 'live' ? `<div class="fine">${esc(a.status)}</div>` : ''}
      </td>
      <td class="num">${num(a.unlocks)}</td>
      <td class="num">${num(a.views)}</td>
      <td class="num">$${Number(a.estimate_usd).toFixed(2)}</td>
    </tr>`).join('');

  const connectedIds = new Set(connections.map((c) => c.provider_id));
  const unconnected = suggestions.filter((p) => !connectedIds.has(p.id)).slice(0, 4);

  const reportForm = `
<form class="card card-pad-lg" method="post" action="/dashboard/${esc(channel.slug)}/earnings/report">
  <h3 style="margin-top:0">Paste your statement figure</h3>
  <p class="small">One closed period from one network. This is the only way our estimate can be
  checked against reality — and the only evidence that would correct the traffic model your rent is
  priced from.</p>
  <div class="row" style="gap:var(--space-4);align-items:flex-start">
    <div class="field" style="flex:2 1 200px">
      <label for="rp-provider">Network</label>
      <select class="input" id="rp-provider" name="providerId">
        ${summary.lines.filter((l) => !sandboxIds.includes(l.providerId))
    .map((l) => `<option value="${esc(l.providerId)}">${esc(l.providerName)}</option>`).join('')}
        <option value="other">Another network</option>
      </select>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-start">Period start</label>
      <input class="input" id="rp-start" name="periodStart" type="date" required>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-end">Period end</label>
      <input class="input" id="rp-end" name="periodEnd" type="date" required>
    </div>
    <div class="field" style="flex:1 1 140px">
      <label for="rp-usd">Statement total (USD)</label>
      <input class="input" id="rp-usd" name="reportedUsd" type="number" min="0" step="0.01" required>
      <span class="hint">As printed. Not converted, not rounded up.</span>
    </div>
  </div>
  <button class="btn" type="submit">Save the figure</button>
  <p class="fine" style="margin-top:var(--space-3)">
    Nothing is paid from this form and nothing changes hands. It records what the statement said.
  </p>
</form>`;

  const reportHistory = reports.length
    ? `<div class="panel" style="margin-top:var(--space-6)"><div class="panel-body panel-body-flush">
        <table class="table">
          <thead><tr><th>Network</th><th>Period</th><th class="num">Statement</th><th>Counted?</th></tr></thead>
          <tbody>${reports.map((r) => `<tr>
            <td>${esc(r.provider_id)}</td>
            <td>${day(r.period_start)} → ${day(r.period_end)}</td>
            <td class="num">$${Number(r.reported_usd).toFixed(2)}</td>
            <td>${r.closed ? pill('yes', 'success') : pill('not closed yet', 'info')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div></div>`
    : '';

  return layout({
    title: 'Earnings', user, activeChannel: channel, consent, current: 'dashboard',
    body: `
${pageHead(channel, 'earnings', 'Earnings', `Where the money goes, and who is holding it.
      It is not us.`)}

${flashNote(flash)}

<div class="section">
  <div class="cols-2">
    <div class="panel panel-creator">
      <div class="panel-head">
        <h2>${esc(moneyMap.toCreator.label)}</h2>
        <span class="spacer"></span>
        ${pill(moneyMap.toCreator.cut, 'success')}
      </div>
      <div class="panel-body">
        <p class="small">${esc(moneyMap.toCreator.detail)}</p>
        <dl class="kv" style="margin-top:var(--space-4)">
          <dt>Paid by</dt><dd>${esc(moneyMap.toCreator.payer)}</dd>
          <dt>Into</dt><dd>${esc(moneyMap.toCreator.account)}</dd>
          <dt>Held by bytebikri</dt><dd><strong>${esc(moneyMap.toCreator.held)}</strong></dd>
        </dl>
        <div class="amount-line">
          <span>What the network reported, ${plural(days, 'day')}</span>
          <strong>${summary.reportedTotal === null ? '<span class="fine">nothing reported</span>' : `$${summary.reportedTotal.toFixed(2)}`}</strong>
        </div>
        <p class="fine">${esc(summary.headline.headline)}. ${esc(summary.headline.detail)}</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>${esc(moneyMap.toPlatform.label)}</h2>
        <span class="spacer"></span>
        ${pill(moneyMap.toPlatform.cut, 'accent')}
      </div>
      <div class="panel-body">
        <p class="small">${esc(moneyMap.toPlatform.detail)}</p>
        <dl class="kv" style="margin-top:var(--space-4)">
          <dt>Plan</dt><dd>${esc(plan?.name || 'Free')}</dd>
          <dt>Rent</dt><dd>${rent && Number(rent.amount_npr)
    ? `${npr(rent.amount_npr)} · ${esc(rent.status)}`
    : 'Nothing due — no rentable traffic'}</dd>
          <dt>Our share of your ad earnings</dt><dd><strong>0%</strong></dd>
        </dl>
        ${summary.rent ? `<div class="amount-line">
          <span>Rent as a share of reported earnings</span>
          <strong>${summary.rent.pct === null ? '<span class="fine">no traffic yet</span>' : `${summary.rent.pct}%`}</strong>
        </div>
        <p class="fine">${esc(summary.rent.sentence)}</p>` : ''}
      </div>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>${esc(moneyMap.toCreatorFromMembers.label)}</h2>
      <span class="spacer"></span>
      ${pill(moneyMap.toCreatorFromMembers.cut, 'success')}
    </div>
    <div class="panel-body">
      <p class="small">${esc(moneyMap.toCreatorFromMembers.detail)}</p>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Paid by</dt><dd>${esc(moneyMap.toCreatorFromMembers.payer)}</dd>
        <dt>Into</dt><dd>${esc(moneyMap.toCreatorFromMembers.account)}</dd>
        <dt>Held by bytebikri</dt><dd><strong>${esc(moneyMap.toCreatorFromMembers.held)}</strong></dd>
      </dl>
      <p class="fine">
        This leg is on the map for the same reason the other two are: a page that claims to show where
        the money goes cannot leave out the flow that does not touch it. Your
        <a href="/dashboard/${esc(channel.slug)}/members">members page</a> is where the roster and the
        dues-in-flight live.
      </p>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>${esc(moneyMap.toPlatformFromPeople.label)}</h2>
      <span class="spacer"></span>
      ${pill(moneyMap.toPlatformFromPeople.cut, 'accent')}
    </div>
    <div class="panel-body">
      <p class="small">${esc(moneyMap.toPlatformFromPeople.detail)}</p>
      <dl class="kv" style="margin-top:var(--space-4)">
        <dt>Paid by</dt><dd>${esc(moneyMap.toPlatformFromPeople.payer)}</dd>
        <dt>Into</dt><dd>${esc(moneyMap.toPlatformFromPeople.account)}</dd>
        <dt>Held by bytebikri</dt><dd><strong>${esc(moneyMap.toPlatformFromPeople.held)}</strong></dd>
      </dl>
      <p class="fine">
        The one leg on this page that is ours rather than yours, named here for the same reason the dues
        leg is: a seller reading a money panel should learn where else the platform earns from the panel
        itself, not from a support thread. One price, everything included, and
        <a href="/plus">the whole product is a page</a>.
      </p>
    </div>
  </div>

  <p class="small" style="margin-top:var(--space-4)">Counts rather than money — what was watched, and
  what was drawn — live on the <a href="/dashboard/${esc(channel.slug)}/attention">attention ledger</a>.</p>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head">
      <h2>Our estimate, next to the statement</h2>
      <span class="spacer"></span>
      <span class="fine">assumed $${Number(rpmUsd).toFixed(2)} per 1,000 views</span>
    </div>
    <div class="panel-body panel-body-flush">
      <!-- Six columns of money, stacked on a phone: the estimate cell holds a
           figure and a note under it, and at 390px that was 131px and four lines. -->
      <table class="table table-stacked">
        <thead><tr>
          <th>Network</th><th class="num">Views</th><th class="num">Our estimate</th>
          <th class="num">Statement</th><th>Verdict</th><th>Your account there</th>
        </tr></thead>
        <tbody>${providerRows || '<tr><td colspan="6" class="muted">No completed ad views in this window yet — there is nothing for a network to pay.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="panel-body">
      <p class="fine">
        The estimate is arithmetic on the rate above. The statement is what you told us the network
        said. Where they disagree, the network is right — and the same traffic model prices your rent,
        so an over-estimate is the direction that costs you.
      </p>
    </div>
  </div>

  <div class="panel" style="margin-top:var(--space-6)">
    <div class="panel-head"><h2>Which files earn</h2>
      <span class="spacer"></span><span class="fine">last ${num(days)} days</span></div>
    <div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>File</th><th class="num">Unlocks</th><th class="num">Ad views</th><th class="num">Est.</th></tr></thead>
        <tbody>${assetRows || '<tr><td colspan="4" class="muted">Nothing published yet.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="panel-body">
      <p class="fine">
        Unlocks are our count of “somebody watched an ad for this file”. Views are the network’s count
        of the same event. They usually differ, and the difference is worth a look if it is large.
      </p>
    </div>
  </div>

  <section class="section">
    <div class="section-head">
      <h2>Your accounts at the networks</h2>
      <p>The account has to be yours. We record which one so you can find it again — never a number
      we could use.</p>
    </div>
    ${connections.length ? `<div class="panel"><div class="panel-body panel-body-flush">
      <table class="table table-stacked">
        <!-- Three columns, not four. The header used to carry a fourth for a
             caveat that was repeated in every row, and a "Payout method" heading
             that sat over the STATUS cell while the form below it held both the
             account and the method — a heading describing a column that did not
             exist. The form IS the account column; the method is named by the
             second input. -->
        <thead><tr><th>Network</th><th>Your account</th><th>Status</th></tr></thead>
        <tbody>${connections.map((c) => {
    const account = accountOf(c.provider_id);
    const provider = providers.find((p) => p.id === c.provider_id);
    const verdict = provider?.verdict || null;
    // The sandbox network exists so the unlock loop can run with no
    // credentials. It pays nobody, so it gets no payout field: asking a creator
    // which of their accounts our own test provider pays into is the kind of
    // row that makes a page feel auto-generated.
    if (verdict?.level === 'unknown' && sandboxIds.includes(c.provider_id)) {
      return `<tr>
            <td><strong>${esc(provider?.name || c.provider_id)}</strong></td>
            <td colspan="2" class="fine">Sandbox network — it completes the unlock loop with no
              credentials and pays nobody. There is nothing to record.</td>
          </tr>`;
    }
    return `<tr>
            <td><strong>${esc(provider?.name || c.provider_id)}</strong>
              ${verdict?.thresholdLabel && verdict.level !== 'unknown'
    ? `<div class="fine">Threshold ${esc(verdict.thresholdLabel)}</div>` : ''}</td>
            <td data-label="Your account">
              <form class="inline-form" method="post" action="/dashboard/${esc(channel.slug)}/earnings/payout">
                <input type="hidden" name="providerId" value="${esc(c.provider_id)}">
                <input class="input input-sm" name="accountLabel" maxlength="120" required
                       placeholder="e.g. Payoneer ending 4417" value="${esc(account?.account_label || '')}">
                <input class="input input-sm" name="payoutMethod" maxlength="60"
                       placeholder="payout method" value="${esc(account?.payout_method || '')}">
                <button class="btn btn-sm" type="submit">Save</button>
              </form>
            </td>
            <td class="fine" data-label="Status">${account
      ? (account.status === 'changed' ? 'You said this changed' : 'On file')
      : 'Not recorded'}</td>
          </tr>`;
  }).join('')}</tbody>
      </table>
      <p class="fine" style="margin:var(--space-4) var(--space-5) 0">
        Only you can see the account column. It is not the network's record and we cannot check it.
      </p>
    </div></div>` : `<div class="empty">No network connected yet, so nothing is being served and
      nothing can be earned. Connect one first — the account you connect is your own.</div>`}
  </section>

  <div class="cols-2" style="margin-top:var(--space-6)">
    <div>
      ${reportForm}
      ${reportHistory}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Before the network pays you</h2></div>
      <div class="panel-body">
        <ol class="list-steps">
          ${checklist.map((step) => `<li>${esc(step)}</li>`).join('')}
        </ol>
        <p class="fine" style="margin-top:var(--space-4)">
          None of this passes through bytebikri. There is no balance on this page, no withdrawal
          button and no minimum: the money is between you, the network and your own bank.
        </p>
      </div>
    </div>
  </div>

  ${unconnected.length ? `<section class="section">
    <div class="section-head"><h2>Networks you could add</h2>
      <p>Every one of these pays the creator directly. None of them pays bytebikri.</p></div>
    <div class="panel"><div class="panel-body panel-body-flush">
      <table class="table">
        <thead><tr><th>Network</th><th>Reachable from Nepal</th><th class="num">Minimum</th></tr></thead>
        <tbody>${unconnected.map((p) => `<tr>
          <td><strong>${esc(p.name)}</strong>${p.note ? `<div class="fine">${esc(p.note)}</div>` : ''}</td>
          <td>${pill(p.verdict.level, p.verdict.level === 'ok' ? 'success' : p.verdict.level === 'caution' ? 'warning' : '')}</td>
          <td class="num">${p.verdict.thresholdLabel ? esc(p.verdict.thresholdLabel) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div></div>
  </section>` : ''}
</div>`,
  });
}
