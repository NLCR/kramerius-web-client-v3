import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { FolderSearchScope } from './folder-search-scope.service';

/**
 * The folder search sends its pid scope in the query string. The API server
 * rejects request URIs over ~8.2 KB with HTTP 414 (measured against
 * cdk-api.dev: largest accepted URL ~8221 chars, 414 above ~8347), which is the
 * standard nginx 8k header buffer. A chunk of saved items must stay under that
 * budget together with the facet params that ride along on the same request.
 *
 * Regression: folder "Genealogie" (56 items) failed to load — chunking at 50
 * still produced a ~9.8 KB URL for a logged-in user.
 */
const SERVER_URL_LIMIT = 8221;

/** Facet params the folder search always sends alongside the pid scope. */
const FACET_FIELDS = [
  'licenses.facet', 'model', 'authors.facet', 'languages.facet', 'genres.facet',
  'keywords.facet', 'geographic_names.facet', 'publishers.facet',
  'publication_places.facet', 'physical_locations.facet',
  'subject_names_personal.facet', 'subject_names_corporate.facet',
  'subject_temporals.facet', 'accessibility',
];

// Real shape: a session returns one license entry per library, so the same few
// values repeat. Taken from the failing "Genealogie" request.
const USER_LICENSES_FROM_SESSION = [
  'dnnto', 'public', 'cover-and-content', 'mzk_public-muo', 'mzk_public-contract',
  'public', 'orphan', 'dnnto', 'cover-and-content', 'public', 'orphan',
  'knav_public_contract', 'dnnto', 'cover-and-content', 'dnnto', 'public',
  'cover-and-content', 'dnnto', 'public', 'cover-and-content', 'dnnto', 'public',
  'cover-and-content', 'dnnto', 'public', 'dnnto', 'orphan', 'public',
  'cover-and-content', 'dnnto', 'public', 'dnnto', 'public', 'cover-and-content',
  'dnnto', 'public', 'cover-and-content', 'public', 'dnnto', 'public',
  'cover-and-content', 'MLP_public-contract', 'dnnto', 'public',
];

/** A realistic own_pid_path: a 4-level periodical path. */
function scopePath(i: number): string {
  const seg = (n: number) => `uuid:${String(n).padStart(8, '0')}-f3e0-11e0-a32e-000d606f5dc6`;
  return [seg(i), seg(i + 1000), seg(i + 2000), seg(i + 3000)].join('/');
}

/** Builds the folder facet request URL the way SolrService does. */
function buildFacetUrl(scope: string[], userLicenses: string[]): string {
  const q = scope.map(p => `pid:"${p}"`).join(' OR ');
  const parts: [string, string][] = [
    ['q', `(${q}) AND *:*`], ['wt', 'json'], ['fl', ''],
    ['start', '0'], ['rows', '0'], ['facet', 'true'], ['facet.mincount', '1'],
  ];
  FACET_FIELDS.forEach(f => parts.push(['facet.field', f]));
  parts.push(['facet.query', '{!ex=avail}*:*']);
  const groups = [
    userLicenses,
    ['public', 'orphan', 'mzk_public-contract', 'mzk_public-muo', 'knav_public_contract'],
    ['dnntt', 'onsite', 'onsite-sheetmusic'],
    ['dnnto'],
  ];
  for (const g of groups) {
    if (g.length > 0) {
      parts.push(['facet.query', `{!ex=avail}(${g.map(l => `licenses.facet:"${l}"`).join(' OR ')})`]);
    }
  }
  const qs = parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `https://cdk-api.dev.ceskadigitalniknihovna.cz/search/api/client/v7.0/search?${qs}`;
}

describe('folder search URL budget', () => {
  const fullChunk = Array.from(
    { length: FolderSearchScope.PID_BATCH_SIZE },
    (_, i) => scopePath(i),
  );

  it('keeps a full chunk under the server URL limit for an anonymous user', () => {
    const url = buildFacetUrl(fullChunk, []);
    expect(url.length).toBeLessThanOrEqual(SERVER_URL_LIMIT);
  });

  it('keeps a full chunk under the server URL limit for a logged-in user', () => {
    // Deduplicated, as the request builder should send them.
    const url = buildFacetUrl(fullChunk, [...new Set(USER_LICENSES_FROM_SESSION)]);
    expect(url.length).toBeLessThanOrEqual(SERVER_URL_LIMIT);
  });

  it('splits a 56-item folder into chunks that each fit the budget', () => {
    const scope = Array.from({ length: 56 }, (_, i) => scopePath(i));
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    const scopeService = TestBed.inject(FolderSearchScope);
    const chunks = scopeService.chunk(scope, FolderSearchScope.PID_BATCH_SIZE);

    for (const chunk of chunks) {
      const url = buildFacetUrl(chunk, [...new Set(USER_LICENSES_FROM_SESSION)]);
      expect(url.length).toBeLessThanOrEqual(SERVER_URL_LIMIT);
    }
  });
});
