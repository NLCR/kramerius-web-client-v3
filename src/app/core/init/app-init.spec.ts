import { updateFaviconFromLogo } from './app-init';

describe('updateFaviconFromLogo', () => {
  let doc: Document;

  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('test');
  });

  it('replaces the static favicon with the configured logo', () => {
    const link = doc.createElement('link');
    link.rel = 'icon';
    link.href = '/img/favicon/default.png';
    doc.head.appendChild(link);

    updateFaviconFromLogo('/local-config/nkp/img/favicon.ico?v=2', doc);

    expect(link.getAttribute('href')).toBe('/local-config/nkp/img/favicon.ico?v=2');
    expect(link.type).toBe('image/x-icon');
  });

  it('creates a favicon element and recognizes an SVG logo', () => {
    updateFaviconFromLogo('/img/logo/library.svg', doc);

    const link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/img/logo/library.svg');
    expect(link?.type).toBe('image/svg+xml');
  });

  it('keeps the fallback favicon when no logo is configured', () => {
    const link = doc.createElement('link');
    link.rel = 'icon';
    link.href = '/img/favicon/default.png';
    doc.head.appendChild(link);

    updateFaviconFromLogo(undefined, doc);

    expect(link.getAttribute('href')).toBe('/img/favicon/default.png');
  });
});
