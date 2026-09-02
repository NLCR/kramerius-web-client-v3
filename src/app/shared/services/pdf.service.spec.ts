import { NgZone } from '@angular/core';
import { PdfService } from './pdf.service';

describe('PdfService book mode', () => {
  function createService(): PdfService {
    return new PdfService(
      { getApiUrl: () => 'https://api.example.org/items' } as any,
      new NgZone({ enableLongStackTrace: false }),
      {} as any,
      { getAccessToken: () => null, isTokenExpired: () => false } as any,
      { prefixedItemPath: (pid: string, suffix: string) => `/${pid}/${suffix}` } as any,
    );
  }

  it('does not reset book mode when the same document UUID is assigned again', () => {
    const service = createService();
    service.uuid = 'uuid:document';
    service.bookModeToggle();

    service.uuid = 'uuid:document';

    expect(service.pdfProperties.pageViewMode).toBe('book');
    expect(service.pdfProperties.bookMode).toBeTrue();
  });

  it('publishes book-mode changes through properties$', () => {
    const service = createService();
    let bookMode = false;
    service.properties$.subscribe(properties => bookMode = !!properties.bookMode);

    service.bookModeToggle();

    expect(bookMode).toBeTrue();
  });
});
