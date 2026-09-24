// ============================================================================
//  Which sentence a success redirect earns
// ============================================================================
//  Every route in this app reports a success the same way: it redirects to the page
//  the person was looking at with a query parameter, and `flashFor` turns that
//  parameter into the one sentence that page shows. The vocabulary lives in
//  `server.js` (it is copy, and it belongs next to the routes that earn it); the
//  RULE for choosing among it lives here, because the rule is what was wrong.
//
//  The bug this module exists to prevent, found by walking the money flow in a
//  browser rather than by any test:
//
//    * routes report an outcome as the VALUE of one parameter — `/plus?saved=plus-claimed`
//      after a claim, `?saved=doc-replaced` after a verification document is replaced;
//    * `SUCCESS_FLASH` also carries a generic `saved: () => 'Saved.'`, for the many
//      routes whose outcome needs no explanation;
//    * the dispatch loop matched parameter NAMES, left to right, so the generic
//      `saved` key always won — and every specific sentence keyed beside it became
//      unreachable.
//
//  What that cost, concretely: a person who had just sent NPR 149 read "Saved." where
//  the product had written "Sent. An operator checks that reference against the
//  platform's own statement — nothing is worn until it is matched, and if it never
//  is, nothing about your account changes." The most important sentence in the money
//  flow — the one that explains a manual rail — was rendered nowhere, on seven
//  outcomes across the money, verification and document flows.
//
//  So the rule is: **the value names the outcome, and the value is asked first.**
//  Only when no sentence is keyed by that value does the parameter's own name answer,
//  which is how `?saved=1` still means the generic "Saved." and `?published=<slug>`
//  still means the publishing sentence.
// ============================================================================

/**
 * The success message a query deserves, or `null` when it deserves none.
 *
 * @param {Record<string, Function>} map  the copy, keyed by outcome and by parameter
 * @param {Record<string, string>} query  the parsed query string
 */
export function successFlash(map, query = {}) {
  // 1. The value names the outcome. `saved=plus-claimed` is a sentence about a claim
  //    waiting for an operator; `saved=1` is not a sentence about anything, which is
  //    exactly what step 2 is for.
  if (query.saved) {
    const named = map[String(query.saved)];
    if (typeof named === 'function') return { kind: 'success', message: named(query.saved) };
  }

  // 2. The parameter's name answers, for every route that reports by name
  //    (`?published=`, `?tier-saved=`, `?joined=`, and the generic `?saved=1`).
  for (const [key, build] of Object.entries(map)) {
    if (query[key]) return { kind: 'success', message: build(query[key]) };
  }

  return null;
}
