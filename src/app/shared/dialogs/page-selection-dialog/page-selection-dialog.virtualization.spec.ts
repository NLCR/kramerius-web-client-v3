import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { PageSelectionDialogComponent } from './page-selection-dialog.component';
import { DetailPageItemComponent } from '../../../modules/detail-view-page/components/detail-page-item/detail-page-item.component';
import { InputComponent } from '../../components/input/input.component';
import { ImagePreviewService } from '../../services/image-preview.service';
import { EnvironmentService } from '../../services/environment.service';
import { BreakpointService } from '../../services/breakpoint.service';
import { Page } from '../../models/page.model';

/** Stands in for the thumbnail card, without its service dependencies. */
@Component({
  selector: 'app-detail-page-item',
  standalone: true,
  template: `<div class="stub-card" style="height: 180px;"></div>`,
})
class StubPageItemComponent {
  @Input() page: any;
  @Input() type: 'recording' | 'page' = 'page';
  @Input() pageNumber: string | number | null = null;
  @Input() pageNumberPosition = 'right';
  @Input() showPageNumberInSelectionMode = false;
  @Input() localSelectionMode = false;
  @Input() localIsSelected = false;
  @Input() showPreviewButton = false;
  @Output() selectionToggled = new EventEmitter<{ selected: boolean; event?: MouseEvent }>();
  @Output() previewClicked = new EventEmitter<any>();
}

/** The real input component pulls in speech-recognition services; not under test here. */
@Component({
  selector: 'app-input',
  standalone: true,
  template: `<input />`,
})
class StubInputComponent {
  @Input() type = 'text';
  @Input() placeholder = '';
  @Input() signalInput: any;
  @Input() showClearButton = false;
  @Input() theme = '';
  @Input() size = '';
  @Output() valueChange = new EventEmitter<string | number>();
  @Output() onBlurEvent = new EventEmitter<void>();
}

/**
 * Guards the virtualization of the page-selection dialog.
 *
 * The dialog lists every page of the document as a thumbnail card, so a large
 * scan used to put 1000+ <img> elements into one dialog. Only the rows near the
 * scroll position may exist in the DOM now.
 */
describe('PageSelectionDialogComponent virtualization', () => {

  const makePages = (count: number): Page[] =>
    Array.from({ length: count }, (_, i) => ({
      pid: `uuid:page-${i}`,
      model: 'page',
      'page.number': `${i + 1}`,
    })) as any;

  let fixture: ComponentFixture<PageSelectionDialogComponent>;
  let component: PageSelectionDialogComponent;

  async function setup(pageCount: number): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PageSelectionDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { pages: makePages(pageCount) } },
        { provide: MatDialogRef, useValue: { close: () => {}, disableClose: false } },
        { provide: EnvironmentService, useValue: { getApiUrl: () => 'https://api.test' } },
        { provide: ImagePreviewService, useValue: { isOpen: () => false, open: () => {} } },
        { provide: BreakpointService, useValue: { isDesktop: () => true, isMobile: () => false } },
      ],
    })
      .overrideComponent(PageSelectionDialogComponent, {
        remove: { imports: [DetailPageItemComponent, InputComponent] },
        add: { imports: [StubPageItemComponent, StubInputComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PageSelectionDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function renderedCards(): number {
    return fixture.nativeElement.querySelectorAll('app-detail-page-item').length;
  }

  /** The CDK measures and renders on an animation frame, not synchronously. */
  async function settleViewport(): Promise<void> {
    fixture.detectChanges();
    component.viewport?.checkViewportSize();
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders only a window of cards for a 1000-page document', async () => {
    await setup(1000);
    await settleViewport();

    const rendered = renderedCards();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(250);
  });

  it('renders every card for a short document', async () => {
    await setup(6);
    await settleViewport();

    expect(renderedCards()).toBe(6);
  });

  it('chunks all pages into rows without dropping or duplicating any', async () => {
    await setup(1000);
    await settleViewport();

    const rows = component.pageRows();
    const flattened = rows.flat();

    expect(flattened.length).toBe(1000);
    expect(new Set(flattened.map(p => p.pid)).size).toBe(1000);
    // Order is preserved across the chunk boundaries.
    expect(flattened[0].pid).toBe('uuid:page-0');
    expect(flattened[999].pid).toBe('uuid:page-999');
  });

  it('keeps the 1-based page label correct after chunking into rows', async () => {
    await setup(1000);
    await settleViewport();

    const pages = component.pages;
    expect(component.pageNumber(pages[0])).toBe(1);
    expect(component.pageNumber(pages[7])).toBe(8);
    expect(component.pageNumber(pages[999])).toBe(1000);
  });

  it('still selects every page via select-all across the virtualized list', async () => {
    await setup(1000);
    await settleViewport();

    component.toggleSelectAll();
    fixture.detectChanges();

    expect(component.selectedCount()).toBe(1000);
    expect(component.allSelected()).toBe(true);
    // A page far outside the rendered window is selected too.
    expect(component.isPageSelected('uuid:page-999')).toBe(true);
  });

  it('reflects selection state on a card that is scrolled into view', async () => {
    await setup(1000);
    await settleViewport();

    component.togglePageSelection('uuid:page-0');
    await settleViewport();

    expect(component.isPageSelected('uuid:page-0')).toBe(true);
    const firstCard = fixture.nativeElement.querySelector('app-detail-page-item');
    expect(firstCard).not.toBeNull();
  });
});
