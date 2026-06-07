// Maps a team to an ISO 3166-1 alpha-2 flag code for `flag-icons`.
// Works from the team NAME first (football-data uses standard English country
// names), with the stored 3-letter code as a fallback. Returns null when we
// can't resolve a flag, so callers render no flag rather than a broken one.

import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(enLocale);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[.'’]/g, '')
    .replace(/[-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// football-data names / FIFA quirks that ISO lookups miss, plus the UK home
// nations (not ISO countries, but flag-icons ships gb-eng/sct/wls/nir).
const NAME_OVERRIDES: Record<string, string> = {
  england: 'gb-eng',
  scotland: 'gb-sct',
  wales: 'gb-wls',
  'northern ireland': 'gb-nir',
  'korea republic': 'kr',
  'south korea': 'kr',
  'korea dpr': 'kp',
  'north korea': 'kp',
  'ir iran': 'ir',
  iran: 'ir',
  'china pr': 'cn',
  china: 'cn',
  usa: 'us',
  'united states': 'us',
  turkiye: 'tr',
  turkey: 'tr',
  czechia: 'cz',
  'czech republic': 'cz',
  'cote d ivoire': 'ci',
  'ivory coast': 'ci',
  'cabo verde': 'cv',
  'cape verde': 'cv',
  'dr congo': 'cd',
  'congo dr': 'cd',
  congo: 'cg',
  curacao: 'cw',
  'north macedonia': 'mk',
  'bosnia and herzegovina': 'ba',
  'bosnia herzegovina': 'ba',
  'united arab emirates': 'ae',
  'saudi arabia': 'sa',
  'new zealand': 'nz',
  'south africa': 'za',
  'costa rica': 'cr',
  'el salvador': 'sv',
  'trinidad and tobago': 'tt',
};

// FIFA 3-letter codes that differ from ISO alpha-3 (used only if name lookup
// and ISO alpha-3 conversion both fail).
const FIFA_TLA: Record<string, string> = {
  GER: 'de', NED: 'nl', SUI: 'ch', CRO: 'hr', DEN: 'dk', POR: 'pt', URU: 'uy',
  PAR: 'py', CHI: 'cl', RSA: 'za', NGA: 'ng', ALG: 'dz', MAD: 'mg', ZAM: 'zm',
  TOG: 'tg', BUL: 'bg', GRE: 'gr', SVN: 'si', SUD: 'sd', UAE: 'ae', KSA: 'sa',
  IRI: 'ir', PHI: 'ph', TPE: 'tw', VIE: 'vn', INA: 'id', INE: 'id',
};

export function toFlagCode(name: string | null | undefined, countryCode?: string | null): string | null {
  if (name) {
    const n = normalize(name);
    if (NAME_OVERRIDES[n]) return NAME_OVERRIDES[n];
    const a2 = countries.getAlpha2Code(name, 'en');
    if (a2) return a2.toLowerCase();
  }
  if (countryCode) {
    const code = countryCode.toUpperCase();
    if (code.length === 3) {
      const fromAlpha3 = countries.alpha3ToAlpha2(code);
      if (fromAlpha3) return fromAlpha3.toLowerCase();
      if (FIFA_TLA[code]) return FIFA_TLA[code];
    }
  }
  return null;
}
