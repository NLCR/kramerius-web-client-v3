import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  clearSimpleCache,
  getCacheStats,
  simpleCacheInterceptor,
} from './simple-cache.interceptor-fn';

describe('simpleCacheInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    clearSimpleCache();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([simpleCacheInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    clearSimpleCache();
  });

  it('loads an ArrayBuffer OCR response again instead of caching a corrupted body', () => {
    const url = '/items/uuid:page/ocr/text';
    const bytes = new TextEncoder().encode('Textový přepis').buffer as ArrayBuffer;
    const responses: ArrayBuffer[] = [];

    http.get(url, { responseType: 'arraybuffer' }).subscribe(value => responses.push(value));
    httpMock.expectOne(url).flush(bytes);

    http.get(url, { responseType: 'arraybuffer' }).subscribe(value => responses.push(value));
    httpMock.expectOne(url).flush(bytes);

    expect(responses.length).toBe(2);
    expect(new TextDecoder().decode(responses[1])).toBe('Textový přepis');
    expect(getCacheStats().totalEntries).toBe(0);
  });

  it('does not persist textual ALTO OCR in the general cache', () => {
    const url = '/items/uuid:page/ocr/alto';

    http.get(url, { responseType: 'text' }).subscribe();
    httpMock.expectOne(url).flush('<alto/>');

    http.get(url, { responseType: 'text' }).subscribe();
    httpMock.expectOne(url).flush('<alto/>');

    expect(getCacheStats().totalEntries).toBe(0);
  });
});
