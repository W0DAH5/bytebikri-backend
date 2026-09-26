/**
 * How big a published file may be — one number, read by everything that has to agree about it.
 *
 * This was four literals: multer's `fileSize`, the hint under the file picker, and two refusal
 * sentences. Four copies of a number is a drift waiting for a quiet afternoon — raise the limit
 * and the form keeps promising the old one, or lower it and the refusal names a size the form says
 * is fine. Nothing would fail: no test reads a sentence, and the seller meets the disagreement at
 * the one moment it matters, standing in front of a rejected upload.
 *
 * So it lives in a module rather than in `server.js`, because the form is rendered by `views.js`
 * and a view cannot import the server. A frozen number is not a side effect: `views.js` stays the
 * pure renderer it is, and the sentence, the picker's hint and the actual limit cannot disagree.
 *
 * WHY THE NUMBER IS SMALL. 25 MB is not a decision about what a seller may sell — it is a
 * consequence of how the upload is transported: multer buffers the whole file in memory before
 * anything can inspect it, so this cap is also the ceiling on how much RAM one publish can cost.
 * WANT A BIGGER FILE? That is a streaming-upload change (write to disk, then hand the path to the
 * adapter), not a bigger number here.
 *
 * THE PER-HOST CAPS ARE A SEPARATE, SMALLER QUESTION, and this sentence used to get their answer
 * wrong. Measured (`ci/eyes/upload-cap-walk.mjs`): a 5.5 MB image on a deployment that configures
 * both an image host and a general file host does NOT land on our disk — Telegra.ph is skipped for
 * size and Pixeldrain takes it, because the kind's candidates are [its own host, the general one].
 * It stays on our disk only when NO configured host will take it, and then the instance logs the
 * host's own rule as the reason. `MEDIA_FALLBACK` is a different lever: it is the chain tried when
 * a host that DID accept the file refuses it at the wire (VIDEO_STORAGE.md §13.7).
 */
export const UPLOAD_CAP_MB = 25;
export const UPLOAD_CAP_BYTES = UPLOAD_CAP_MB * 1024 * 1024;

/**
 * The form's own hint, written once so the sentence a seller reads before choosing a file and the
 * one they read after being refused are recognisably the same rule.
 */
export const uploadCapHint = () => `Up to ${UPLOAD_CAP_MB} MB.`;
