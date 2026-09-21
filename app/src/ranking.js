/**
 * Who is at the top of Explore, and why.
 *
 * A marketplace has two ways to order its front page, and most of them merge
 * the two until nobody can tell them apart:
 *
 *   EARNED    stores that got attention. `popular` ranks on evidence from the
 *             last thirty days — pageviews, unlocks and how much there is to
 *             unlock. Nobody can buy a place in it and nothing here reads a plan.
 *
 *   PLACEMENT the platform's paid slot in the shop window. `featured` is open to
 *             the Pro plan and to nothing else, and every label it returns says
 *             so out loud, because a visitor has the same right to know a
 *             position is bought as they do about an advertisement.
 *
 * The rule that keeps this honest is structural rather than editorial: the
 * earned rail never reads `plan_code`, so a paid store cannot rank higher there
 * than its traffic justifies, and the placement rail never pretends its ordering
 * is a merit ranking. Both facts are asserted in test/ranking.test.js.
 *
 * What the score is, and why those weights:
 *
 *   views    × 1    traffic is the weakest signal — a pageview costs nothing
 *   unlocks  × 8    an unlock cost the viewer a rewarded ad: real attention
 *   items    × 3    a store with one file and one view is not "popular", it is
 *                   just new; breadth stops a single viral file from carrying a
 *                   store that has nothing else
 *
 * A minimum: nothing is "popular" on fewer than 20 views in the window. Below
 * that the ranking is noise, and a front page that shows noise to its first
 * visitors teaches them not to come back.
 */

export const WEIGHTS = { views: 1, unlocks: 8, items: 3 };
export const POPULAR_FLOOR = { views: 20 };

/**
 * One number, from evidence.
 *
 * @param {{views30d?: number, unlocks30d?: number, items?: number}} args
 * @returns {number}
 */
export function attentionScore({ views30d = 0, unlocks30d = 0, items = 0 } = {}) {
  const n = (v) => Math.max(0, Number(v) || 0);
  return Math.round(
    n(views30d) * WEIGHTS.views + n(unlocks30d) * WEIGHTS.unlocks + n(items) * WEIGHTS.items,
  );
}

function measured({ stats = {}, channel = {} }) {
  const s = stats[channel.id] || {};
  return {
    channel,
    views30d: Number(s.views_30d) || 0,
    unlocks30d: Number(s.unlocks_30d) || 0,
    items: Number(s.items) || 0,
  };
}

/**
 * The earned rail.
 *
 * @param {object[]} channels
 * @param {Record<string, object>} stats  per channel id: {views_30d, unlocks_30d, items}
 * @param {{limit?: number}} [opts]
 */
export function popular(channels = [], stats = {}, { limit = 6 } = {}) {
  return channels
    .map((c) => measured({ channel: c, stats }))
    .filter((m) => m.views30d >= POPULAR_FLOOR.views)
    .map((m) => ({ ...m, score: attentionScore(m) }))
    // Ties break on views, then on the name — a deterministic order, because a
    // front page that reshuffles between two identical scores looks broken.
    .sort((a, b) => b.score - a.score
      || b.views30d - a.views30d
      || String(a.channel.name).localeCompare(String(b.channel.name)))
    .slice(0, limit)
    .map((m, i) => ({
      ...m,
      rank: i + 1,
      // The sentence a visitor reads instead of a ranking algorithm's opinion.
      why: `${m.views30d.toLocaleString('en-IN')} views and ${m.unlocks30d} unlock${m.unlocks30d === 1 ? '' : 's'} in thirty days`,
    }));
}

/**
 * The paid rail.
 *
 * `canFeature` is passed in rather than read here, so this module never has to
 * know what a plan is called or what it costs — that is `store.js`'s job and it
 * changes for commercial reasons.
 *
 * @param {object[]} channels
 * @param {Record<string, object>} stats
 * @param {(channel: object) => boolean} canFeature
 */
export function featured(channels = [], stats = {}, canFeature = () => false, { limit = 3 } = {}) {
  return channels
    .filter((c) => canFeature(c))
    .map((c) => measured({ channel: c, stats }))
    .sort((a, b) => attentionScore(b) - attentionScore(a)
      || String(a.channel.name).localeCompare(String(b.channel.name)))
    .slice(0, limit)
    .map((m) => ({
      ...m,
      score: attentionScore(m),
      // Deliberately the same shape as `popular`'s label, and deliberately a
      // different sentence. Placement is labelled as placement.
      why: 'Featured placement — part of the Pro plan',
    }));
}

/**
 * Stores in the order a visitor can act on them.
 *
 * Newest first, because "new" is the one ordering that is true for everybody and
 * cannot be gamed by a flag. It is also the fallback when nothing has earned its
 * way onto the front page yet — an empty Explore with a "Popular" heading over
 * nothing is worse than an honest list.
 */
export function newest(channels = [], stats = {}, { limit = 12 } = {}) {
  return channels
    .map((c) => measured({ channel: c, stats }))
    .sort((a, b) => new Date(b.channel.created_at || 0) - new Date(a.channel.created_at || 0))
    .slice(0, limit)
    .map((m) => ({ ...m, why: m.items ? `${m.items} file${m.items === 1 ? '' : 's'} so far` : 'Just opened' }));
}

/**
 * Which rails a given Explore page should show.
 *
 * Four rules, all of them about not showing a visitor an empty shelf or the
 * same shop twice:
 *
 *   1. A rail with nothing in it is not rendered at all.
 *   2. A store never appears twice on the page. The earned rail keeps it,
 *      because that is the position it earned rather than the one it bought.
 *   3. A store that buys placement and is ALSO on the earned rail is marked
 *      `alsoPlaced` inside that rail. Its placement therefore never vanishes
 *      silently — the card carries the pill — but it does not take a second
 *      slot to say so.
 *   4. The earned rail renders first. Paid placement sits below it and above
 *      the directory. That order is a decision, not an accident of array order:
 *      the front page leads with what people did, not with what money bought,
 *      while the placement still buys a position no unfeatured store can take.
 *
 * @returns {{rails: object[], rest: object[]}}
 */
export function exploreRails({ channels = [], stats = {}, canFeature = () => false } = {}) {
  const seen = new Set();
  const take = (entries) => {
    const out = [];
    for (const e of entries) {
      if (seen.has(e.channel.id)) continue;
      seen.add(e.channel.id);
      out.push(e);
    }
    return out;
  };

  const placedIds = new Set(channels.filter((c) => canFeature(c)).map((c) => c.id));

  const rails = [];
  const earned = take(popular(channels, stats));
  for (const e of earned) if (placedIds.has(e.channel.id)) e.alsoPlaced = true;
  if (earned.length) rails.push({ key: 'popular', title: 'Popular this week', note: 'Earned, not bought — this ranking reads traffic and unlocks, and nothing else.', entries: earned });

  const placed = take(featured(channels, stats, canFeature));
  if (placed.length) rails.push({ key: 'featured', title: 'Featured', note: 'Paid placement, shown to you as placement. Pro stores only, and it has no effect on the ranking above.', entries: placed });

  const fresh = take(newest(channels, stats));
  if (fresh.length) rails.push({ key: 'new', title: 'New here', note: 'Recently opened stores.', entries: fresh });

  return { rails, rest: channels.filter((c) => !seen.has(c.id)) };
}
