import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SearchResultsListComponent, SearchResult } from './search-results-list.component';
import { DetailPageItemComponent } from '../../../modules/detail-view-page/components/detail-page-item/detail-page-item.component';
import { DetailViewService } from '../../../modules/detail-view-page/services/detail-view.service';
import { Page } from '../../models/page.model';

/** Stands in for the thumbnail-bearing row item, without its service dependencies. */
@Component({
  selector: 'app-detail-page-item',
  standalone: true,
  template: `<div class="stub-item"></div>`,
})
class StubPageItemComponent {
  @Input() page: any;
  @Input() type: 'recording' | 'page' = 'page';
  @Input() pageNumberPosition = 'right';
  @Input() pageNumber: string | number | null = null;
  @Input() isLocked = false;
  @Input() isUnlocked = false;
  @Input() isAccessible = false;
  @Input() lockStyle: 'terminal' | 'dnntt' | 'default' = 'default';
  @Output() pageClicked = new EventEmitter<any>();
}

/**
 * Guards the two fixes to the fulltext results list:
 *
 * 1. `displayItems` is a `computed`, not a getter re-sorting the whole list on
 *    every change-detection pass (it was read twice per pass by the template).
 * 2. The list is virtualized, so a `showAllPages` view of a 1000-page document
 *    no longer puts 1000 thumbnail rows in the sidebar.
 */
describe('SearchResultsListComponent', () => {

  @Component({
    standalone: true,
    imports: [SearchResultsListComponent],
    template: `
      <div style="height: 600px; width: 360px; display: flex; flex-direction: column;">
        <app-search-results-list
          [results]="results"
          [currentPid]="currentPid"
          [showAllPages]="showAllPages"
          [allPages]="allPages">
        </app-search-results-list>
      </div>
    `,
  })
  class HostComponent {
    results: SearchResult[] = [];
    currentPid: string | null = null;
    showAllPages = false;
    allPages: Page[] = [];
  }

  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const makePages = (count: number): any[] =>
    Array.from({ length: count }, (_, i) => ({
      pid: `uuid:page-${i}`,
      model: 'page',
      'page.number': `${i + 1}`,
    }));

  const makeResults = (count: number): SearchResult[] =>
    Array.from({ length: count }, (_, i) => ({
      pid: `uuid:page-${i}`,
      highlightedText: `hit on page ${i + 1}`,
      pageNumber: `${i + 1}`,
    }));

  beforeEach(async () => {
    const detailViewServiceStub: Partial<DetailViewService> = {
      isPageLocked: () => false,
      isPageUnlocked: () => false,
      isDocumentRestrictedButAccessible: (() => false) as any,
      pageLockStyle: (() => 'default') as any,
    };

    await TestBed.configureTestingModule({
      imports: [HostComponent, TranslateModule.forRoot()],
      providers: [{ provide: DetailViewService, useValue: detailViewServiceStub }],
    })
      .overrideComponent(SearchResultsListComponent, {
        remove: { imports: [DetailPageItemComponent] },
        add: { imports: [StubPageItemComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function listInstance(): SearchResultsListComponent {
    return fixture.debugElement.children[0].children[0].componentInstance;
  }

  function renderedRows(): number {
    return fixture.nativeElement.querySelectorAll('.search-result-item').length;
  }

  /** The CDK measures and renders on an animation frame, not synchronously. */
  async function settleViewport(): Promise<void> {
    fixture.detectChanges();
    listInstance().viewport?.checkViewportSize();
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  it('renders only a window of rows for a 1000-page showAllPages view', async () => {
    host.allPages = makePages(1000) as Page[];
    host.results = makeResults(5);
    host.showAllPages = true;
    await settleViewport();

    expect(listInstance().displayItems().length).toBe(1000);

    const rows = renderedRows();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(250);
  });

  it('renders every row for a short result set', async () => {
    host.results = makeResults(4);
    await settleViewport();

    expect(renderedRows()).toBe(4);
  });

  it('recomputes displayItems only when its inputs actually change', () => {
    host.results = makeResults(3);
    fixture.detectChanges();

    const list = listInstance();
    const first = list.displayItems();
    const second = list.displayItems();

    // A getter returned a freshly sorted array each call; the computed caches.
    expect(second).toBe(first);
  });

  it('ignores an allPages array that is a new reference with identical content', () => {
    host.allPages = makePages(10) as Page[];
    host.showAllPages = true;
    fixture.detectChanges();
    const before = listInstance().displayItems();

    // DetailViewService.pagesOnly returns a new filtered array on every read.
    host.allPages = makePages(10) as Page[];
    fixture.detectChanges();

    expect(listInstance().displayItems()).toBe(before);
  });

  it('recomputes when allPages content genuinely changes', () => {
    host.allPages = makePages(10) as Page[];
    host.showAllPages = true;
    fixture.detectChanges();
    const before = listInstance().displayItems();

    host.allPages = makePages(11) as Page[];
    fixture.detectChanges();

    const after = listInstance().displayItems();
    expect(after).not.toBe(before);
    expect(after.length).toBe(11);
  });

  it('merges highlighted text onto the matching page and sorts by page number', () => {
    host.allPages = [
      { pid: 'uuid:page-2', model: 'page', 'page.number': '3' },
      { pid: 'uuid:page-0', model: 'page', 'page.number': '1' },
    ] as any;
    host.results = [{ pid: 'uuid:page-2', highlightedText: 'found here', pageNumber: '3' }];
    host.showAllPages = true;
    fixture.detectChanges();

    const items = listInstance().displayItems();
    expect(items.map(i => i.pageNumber)).toEqual(['1', '3']);
    expect(items[1].highlightedText).toBe('found here');
    expect(items[0].highlightedText).toBe('');
  });

  it('shows the empty state when there is nothing to display', () => {
    host.results = [];
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.no-results')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport')).toBeNull();
  });

  it('marks the current page as active', async () => {
    host.results = makeResults(4);
    host.currentPid = 'uuid:page-2';
    await settleViewport();

    const active = fixture.nativeElement.querySelectorAll('.search-result-item.active');
    expect(active.length).toBe(1);
  });

  it('scrolls a far-off active result into view when the page changes', async () => {
    host.results = makeResults(500);
    await settleViewport();

    const spy = spyOn(listInstance().viewport!, 'scrollToIndex');

    host.currentPid = 'uuid:page-400';
    await settleViewport();

    expect(spy).toHaveBeenCalled();
    expect(spy.calls.mostRecent().args[0]).toBe(400);
  });

  it('does not scroll when the active result is already rendered', async () => {
    host.results = makeResults(500);
    host.currentPid = 'uuid:page-0';
    await settleViewport();

    const spy = spyOn(listInstance().viewport!, 'scrollToIndex');

    // A neighbouring page is inside the rendered window; scrolling there would
    // fight a reader who has scrolled the list themselves.
    host.currentPid = 'uuid:page-1';
    await settleViewport();

    expect(spy).not.toHaveBeenCalled();
  });
});
