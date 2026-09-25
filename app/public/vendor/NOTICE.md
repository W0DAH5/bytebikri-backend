# What is in this directory, and why

`hls.min.js` is **hls.js 1.7.3**, unmodified, from
`https://registry.npmjs.org/hls.js/-/hls.js-1.7.3.tgz` (`dist/hls.min.js`).

    sha256  a12e7ee1cd64a69dcdb314157e45dafcba705bfb0b1440b7935cb265d374423e
    bytes   619692   (≈70 KB over the wire, gzipped)

It is here because the live shape needs it and the browser does not ship it. Safari
(macOS, iOS, iPadOS) plays HLS from a plain `src`; Chrome, Firefox, Edge and Android
Chrome have no native HLS at all, and a paid surface that cannot be watched in Chrome
is not a surface. `ASSET_ECONOMY.md` §14.2 is the decision, and it is the same reason
the server serves this from its own origin: `scriptSrc` in the CSP is `'self'` plus the
one inline reveal bootstrap, so vendoring is what keeps a third-party host out of the
policy — for a paying store and for the demo alike.

Three things about this file are deliberate:

- **It is byte-identical to the published build.** Nothing is patched, minified again
  or renamed, so `sha256` above is a fact somebody can check against upstream rather
  than against our word. The trailing `//# sourceMappingURL=hls.min.js.map` refers to a
  map we do not ship: that costs a 404 in devtools and nothing anywhere else, and
  shipping the map would add 3.4 MB to the repository for no user-visible benefit;
- **its licence ships beside it** (`hls.min.js.LICENSE`, the package's own Apache-2.0
  notice, including the Brightcove attribution for the two derived files it names);
- **the test pins it.** `test/vendor.test.js` fails if the bytes change without this
  file changing, if the version here and the version in the bundle disagree, or if the
  CSP grows an external script host. Upgrading hls.js is therefore a commit with a
  reason and a hash, not a `curl` somebody ran once.
