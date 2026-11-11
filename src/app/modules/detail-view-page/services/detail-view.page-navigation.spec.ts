import { signal } from '@angular/core';
import { DetailViewService } from './detail-view.service';

/**
 * Covers page navigation over a children list that mixes real pages with other
 * items (here an internal part at the end). The counters show pages only, so
 * paging must stop at the last page instead of stepping onto "13 of 12".
 *
 * Built without Angular's injector like the convolute spec: only the `_pages` /
 * `_currentPageIndex` signals are seeded, and goToPage just moves the index.
 */
describe('DetailViewService page navigation', () => {

  const page = (pid: string) => ({ pid, model: 'page' });
  const part = (pid: string) => ({ pid, model: 'internalpart' });

  function serviceWithPages(pages: any[], currentPageIndex = 0): DetailViewService {
    const service = Object.create(DetailViewService.prototype) as DetailViewService;
    (service as any)._pages = signal(pages);
    (service as any)._currentPageIndex = signal(currentPageIndex);
    (service as any).iiifViewerService = { isBookMode: () => false };
    service.goToPage = (index: number) => (service as any)._currentPageIndex.set(index);
    return service;
  }

  it('does not page past the last page onto a non-page item', () => {
    const service = serviceWithPages([page('p1'), page('p2'), part('x')], 1);

    expect(service.currentPageNumber).toBe(2);
    expect(service.totalPagesOnly).toBe(2);
    expect(service.hasNextPage()).toBe(false);
    expect(service.pageAtOffset(1)).toBeNull();

    service.goToNext();
    expect(service.currentPageIndex).toBe(1);
  });

  it('skips a non-page item between pages and keeps the count consistent', () => {
    const service = serviceWithPages([page('p1'), part('x'), page('p2')], 0);

    service.goToNext();
    expect(service.currentPageIndex).toBe(2);
    expect(service.currentPageNumber).toBe(2);

    service.goToPrevious();
    expect(service.currentPageIndex).toBe(0);
  });

  it('jumps to the n-th page as counted for the reader', () => {
    const service = serviceWithPages([part('x'), page('p1'), page('p2')], 0);

    service.goToPageNumber(1);
    expect(service.currentPageIndex).toBe(2);
    expect(service.pageNumberOf('p2')).toBe(2);
    expect(service.pageByNumber(0)?.pid).toBe('p1');
  });

  it('steps through every item when the document has no real pages', () => {
    const service = serviceWithPages([part('a'), part('b')], 0);

    expect(service.hasNextPage()).toBe(true);
    service.goToNext();
    expect(service.currentPageIndex).toBe(1);
  });

  it('returns from an odd book spread to the first real page, skipping non-page items', () => {
    const service = serviceWithPages([part('start'), page('p1'), part('article'), page('p2'), page('p3')], 3);
    (service as any).iiifViewerService.isBookMode = () => true;

    expect(service.hasPreviousPage(2)).toBe(true);
    expect(service.pageAtOffset(-2)?.pid).toBe('p1');
    service.goToPrevious();
    expect(service.currentPageIndex).toBe(1);
    expect(service.currentPageNumber).toBe(1);
    expect(service.hasPreviousPage(2)).toBe(false);
  });

  it('stops after the final book spread without opening a trailing non-page item', () => {
    const service = serviceWithPages([page('p1'), part('article'), page('p2'), part('end')], 0);
    (service as any).iiifViewerService.isBookMode = () => true;

    expect(service.hasNextPage(2)).toBe(false);
    service.goToNext();
    expect(service.currentPageIndex).toBe(0);
  });
});
