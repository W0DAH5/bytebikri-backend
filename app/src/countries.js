/**
 * Country codes, and what they are called.
 *
 * A country rule stores two letters. Two letters are not a sentence, and the
 * three places that render one — the visitor's block page, the creator's
 * availability list, the operator's queue — would otherwise each invent their
 * own way of showing `IN`, and one of them would show nothing.
 *
 * The table is the ISO-3166 alpha-2 list, plus Kosovo (`XK`), which is what
 * edges actually send. It is deliberately a frozen map and not a database table:
 * a name is not a decision anybody makes, and a country row with a typo in it
 * would silently break a block.
 *
 * `XX` and `T1` are not countries. Cloudflare's `CF-IPCountry` sends `XX` when it
 * cannot place an address and `T1` for Tor exits, and the whole safety of the
 * country rule depends on those meaning "unknown" rather than being treated as
 * places somebody could have a rule about.
 */

/** Values an edge sends that are not places. */
export const NOT_A_COUNTRY = Object.freeze(['XX', 'T1']);

/**
 * Country names that take "the" in a sentence.
 *
 * Every sentence that names a country says "in <country>", and eleven of the
 * names in the table below need an article there — "Visitors in United States
 * cannot open this store" is not something a person writes. The rule is the one
 * English uses: a political-form word (Republic, Kingdom, Union, Federation,
 * States, Emirates, Islands) or a name that is already plural (Netherlands,
 * Philippines, Maldives, Bahamas, Comoros, Seychelles, Antilles), plus the four
 * that are simply idiomatic (Gambia, Congo, Isle of Man, Holy See).
 *
 * `Vatican City`, `Sudan`, `South Sudan` and `Laos` are deliberately NOT on the
 * list: the article is archaic or wrong for them in current usage.
 */
const TAKES_THE = /(Republic|Kingdom|Union|Federation|States|Emirates|Islands|Antilles|Netherlands|Philippines|Maldives|Bahamas|Comoros|Seychelles|Isle of|Holy See|Gambia|Congo)/;

/** `United States` → `the United States`. Already-articled names are left alone. */
export function countryWithArticle(name) {
  const text = String(name ?? '');
  if (!text || /^the /i.test(text)) return text;
  return TAKES_THE.test(text) ? `the ${text}` : text;
}

/** ISO-3166 alpha-2 → English short name. */
export const COUNTRY_NAMES = Object.freeze({
  AD: 'Andorra',
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AG: 'Antigua and Barbuda',
  AI: 'Anguilla',
  AL: 'Albania',
  AM: 'Armenia',
  AO: 'Angola',
  AQ: 'Antarctica',
  AR: 'Argentina',
  AS: 'American Samoa',
  AT: 'Austria',
  AU: 'Australia',
  AW: 'Aruba',
  AX: 'Åland Islands',
  AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina',
  BB: 'Barbados',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BF: 'Burkina Faso',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BI: 'Burundi',
  BJ: 'Benin',
  BL: 'Saint Barthélemy',
  BM: 'Bermuda',
  BN: 'Brunei',
  BO: 'Bolivia',
  BQ: 'Caribbean Netherlands',
  BR: 'Brazil',
  BS: 'Bahamas',
  BT: 'Bhutan',
  BV: 'Bouvet Island',
  BW: 'Botswana',
  BY: 'Belarus',
  BZ: 'Belize',
  CA: 'Canada',
  CC: 'Cocos (Keeling) Islands',
  CD: 'Congo (DRC)',
  CF: 'Central African Republic',
  CG: 'Congo',
  CH: 'Switzerland',
  CI: "Côte d'Ivoire",
  CK: 'Cook Islands',
  CL: 'Chile',
  CM: 'Cameroon',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CV: 'Cape Verde',
  CW: 'Curaçao',
  CX: 'Christmas Island',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DE: 'Germany',
  DJ: 'Djibouti',
  DK: 'Denmark',
  DM: 'Dominica',
  DO: 'Dominican Republic',
  DZ: 'Algeria',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  EH: 'Western Sahara',
  ER: 'Eritrea',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FJ: 'Fiji',
  FK: 'Falkland Islands',
  FM: 'Micronesia',
  FO: 'Faroe Islands',
  FR: 'France',
  GA: 'Gabon',
  GB: 'United Kingdom',
  GD: 'Grenada',
  GE: 'Georgia',
  GF: 'French Guiana',
  GG: 'Guernsey',
  GH: 'Ghana',
  GI: 'Gibraltar',
  GL: 'Greenland',
  GM: 'Gambia',
  GN: 'Guinea',
  GP: 'Guadeloupe',
  GQ: 'Equatorial Guinea',
  GR: 'Greece',
  GS: 'South Georgia and the South Sandwich Islands',
  GT: 'Guatemala',
  GU: 'Guam',
  GW: 'Guinea-Bissau',
  GY: 'Guyana',
  HK: 'Hong Kong',
  HM: 'Heard Island and McDonald Islands',
  HN: 'Honduras',
  HR: 'Croatia',
  HT: 'Haiti',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IM: 'Isle of Man',
  IN: 'India',
  IO: 'British Indian Ocean Territory',
  IQ: 'Iraq',
  IR: 'Iran',
  IS: 'Iceland',
  IT: 'Italy',
  JE: 'Jersey',
  JM: 'Jamaica',
  JO: 'Jordan',
  JP: 'Japan',
  KE: 'Kenya',
  KG: 'Kyrgyzstan',
  KH: 'Cambodia',
  KI: 'Kiribati',
  KM: 'Comoros',
  KN: 'Saint Kitts and Nevis',
  KP: 'North Korea',
  KR: 'South Korea',
  KW: 'Kuwait',
  KY: 'Cayman Islands',
  KZ: 'Kazakhstan',
  LA: 'Laos',
  LB: 'Lebanon',
  LC: 'Saint Lucia',
  LI: 'Liechtenstein',
  LK: 'Sri Lanka',
  LR: 'Liberia',
  LS: 'Lesotho',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  LY: 'Libya',
  MA: 'Morocco',
  MC: 'Monaco',
  MD: 'Moldova',
  ME: 'Montenegro',
  MF: 'Saint Martin',
  MG: 'Madagascar',
  MH: 'Marshall Islands',
  MK: 'North Macedonia',
  ML: 'Mali',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MO: 'Macao',
  MP: 'Northern Mariana Islands',
  MQ: 'Martinique',
  MR: 'Mauritania',
  MS: 'Montserrat',
  MT: 'Malta',
  MU: 'Mauritius',
  MV: 'Maldives',
  MW: 'Malawi',
  MX: 'Mexico',
  MY: 'Malaysia',
  MZ: 'Mozambique',
  NA: 'Namibia',
  NC: 'New Caledonia',
  NE: 'Niger',
  NF: 'Norfolk Island',
  NG: 'Nigeria',
  NI: 'Nicaragua',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NR: 'Nauru',
  NU: 'Niue',
  NZ: 'New Zealand',
  OM: 'Oman',
  PA: 'Panama',
  PE: 'Peru',
  PF: 'French Polynesia',
  PG: 'Papua New Guinea',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PM: 'Saint Pierre and Miquelon',
  PN: 'Pitcairn Islands',
  PR: 'Puerto Rico',
  PS: 'Palestine',
  PT: 'Portugal',
  PW: 'Palau',
  PY: 'Paraguay',
  QA: 'Qatar',
  RE: 'Réunion',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russia',
  RW: 'Rwanda',
  SA: 'Saudi Arabia',
  SB: 'Solomon Islands',
  SC: 'Seychelles',
  SD: 'Sudan',
  SE: 'Sweden',
  SG: 'Singapore',
  SH: 'Saint Helena',
  SI: 'Slovenia',
  SJ: 'Svalbard and Jan Mayen',
  SK: 'Slovakia',
  SL: 'Sierra Leone',
  SM: 'San Marino',
  SN: 'Senegal',
  SO: 'Somalia',
  SR: 'Suriname',
  SS: 'South Sudan',
  ST: 'São Tomé and Príncipe',
  SV: 'El Salvador',
  SX: 'Sint Maarten',
  SY: 'Syria',
  SZ: 'Eswatini',
  TC: 'Turks and Caicos Islands',
  TD: 'Chad',
  TF: 'French Southern Territories',
  TG: 'Togo',
  TH: 'Thailand',
  TJ: 'Tajikistan',
  TK: 'Tokelau',
  TL: 'Timor-Leste',
  TM: 'Turkmenistan',
  TN: 'Tunisia',
  TO: 'Tonga',
  TR: 'Turkey',
  TT: 'Trinidad and Tobago',
  TV: 'Tuvalu',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  UA: 'Ukraine',
  UG: 'Uganda',
  UM: 'United States Minor Outlying Islands',
  US: 'United States',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  VA: 'Vatican City',
  VC: 'Saint Vincent and the Grenadines',
  VE: 'Venezuela',
  VG: 'British Virgin Islands',
  VI: 'U.S. Virgin Islands',
  VN: 'Vietnam',
  VU: 'Vanuatu',
  WF: 'Wallis and Futuna',
  WS: 'Samoa',
  XK: 'Kosovo',
  YE: 'Yemen',
  YT: 'Mayotte',
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
});

/**
 * Two letters, and not one of the edge's non-places.
 *
 * Accepts anything the map knows plus an unlisted but well-formed code: a rule
 * for a code this file has not heard of still has to be storable, and refusing
 * it would mean a country could not be protected because a name was missing.
 */
export function isCountryCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  return !NOT_A_COUNTRY.includes(code);
}

/** The name we show, or the code itself — never an empty cell. */
export function countryName(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return COUNTRY_NAMES[code] || code || '—';
}

/**
 * The name as it goes inside a sentence: `the United States`, `Nepal`.
 *
 * Sentences are the reason this exists. A label can say "United States" and be
 * right; "visitors in United States" is wrong, and the country name is inside a
 * sentence in every message we send about a country rule.
 */
export function countryIn(value) {
  return countryWithArticle(countryName(value));
}

/** `{ code, name }` sorted by name, for the one form that has to offer them all. */
export const COUNTRY_OPTIONS = Object.freeze(
  Object.entries(COUNTRY_NAMES)
    .map(([code, name]) => Object.freeze({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);
