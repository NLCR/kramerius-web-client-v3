import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ViewerControls } from './viewer-controls';
import { PdfService } from '../../services/pdf.service';
import { IIIFViewerService } from '../../services/iiif-viewer.service';
import { EpubService } from '../../services/epub.service';
import { ConfigService } from '../../../core/config';
import { AiPanelService } from '../../services/ai-panel.service';
import { DetailViewService } from '../../../modules/detail-view-page/services/detail-view.service';
import { MapViewerService } from '../../services/map-viewer.service';
import { TtsService } from '../../services/tts.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Regression test for issue #161: on compact viewports the floating viewer
 * controls collapse into the toolbar's "more" menu, which is built from
 * getMenuItems(). The read-aloud buttons existed only in the floating template,
 * so a user reading on a phone had no way to stop it.
 */
describe('ViewerControls.getMenuItems TTS entries', () => {
  let component: ViewerControls;
  let tts: { isReading: any; isPaused: any; playbackBlocked: any; togglePlayPause: jasmine.Spy; stop: jasmine.Spy };

  beforeEach(() => {
    tts = {
      isReading: signal(false),
      isPaused: signal(false),
      playbackBlocked: signal(false),
      togglePlayPause: jasmine.createSpy('togglePlayPause'),
      stop: jasmine.createSpy('stop'),
    };

    TestBed.configureTestingModule({
      imports: [ViewerControls],
      providers: [
        { provide: PdfService, useValue: { properties$: of({}), pdfProperties: {} } },
        { provide: IIIFViewerService, useValue: {
          bookMode$: of(false), zoomLock$: of(false), mapMode$: of(false),
          isMapMode: () => false, isBookMode: () => false,
        } },
        { provide: EpubService, useValue: {} },
        { provide: ConfigService, useValue: {
          isViewerControlEnabled: () => true,
          isFeatureEnabled: () => true,
          isViewerModeAvailable: () => true,
        } },
        { provide: AiPanelService, useValue: { panelVisible: signal(false) } },
        { provide: DetailViewService, useValue: { isActionAllowed: () => true } },
        { provide: MapViewerService, useValue: {} },
        { provide: TtsService, useValue: tts },
      ],
    });

    const fixture = TestBed.createComponent(ViewerControls);
    component = fixture.componentInstance;
    component.type = 'image';
  });

  const ids = () => component.getMenuItems().map(i => i.id);

  it('omits read-aloud entries when nothing is being read', () => {
    expect(ids()).not.toContain('tts-play-pause');
    expect(ids()).not.toContain('tts-stop');
  });

  it('offers pause and stop while reading', () => {
    tts.isReading.set(true);

    expect(ids()).toContain('tts-play-pause');
    expect(ids()).toContain('tts-stop');
  });

  it('shows a resume affordance when paused', () => {
    tts.isReading.set(true);
    tts.isPaused.set(true);

    const item = component.getMenuItems().find(i => i.id === 'tts-play-pause')!;
    expect(item.icon).toBe('icon-play');
    expect(item.tooltip).toBe('ai.tts-resume');
  });

  it('shows a pause affordance while actively playing', () => {
    tts.isReading.set(true);

    const item = component.getMenuItems().find(i => i.id === 'tts-play-pause')!;
    expect(item.icon).toBe('icon-pause');
    expect(item.tooltip).toBe('ai.tts-pause');
  });

  it('tells the user to tap when playback was blocked', () => {
    tts.isReading.set(true);
    tts.playbackBlocked.set(true);

    const item = component.getMenuItems().find(i => i.id === 'tts-play-pause')!;
    expect(item.tooltip).toBe('ai.tts-blocked');
  });

  it('routes the menu ids to the TTS actions', () => {
    tts.isReading.set(true);

    component.handleMenuAction('tts-play-pause');
    expect(tts.togglePlayPause).toHaveBeenCalled();

    component.handleMenuAction('tts-stop');
    expect(tts.stop).toHaveBeenCalled();
  });

});

/**
 * The page-text button opens a panel holding the page's full ALTO transcript, so
 * it has to answer to the same `text` permission as any other route to that text.
 * It shipped gated only on the `ai` feature flag, which offered a complete
 * transcript of every DNNTO page whose licence sets `text: false`.
 */
describe('ViewerControls page-text licence gate', () => {
  let component: ViewerControls;
  let allowed: boolean;
  let aiPanel: { panelVisible: any; showPageText: jasmine.Spy };

  function build(detailView: unknown) {
    TestBed.resetTestingModule();
    aiPanel = {
      panelVisible: signal(false),
      showPageText: jasmine.createSpy('showPageText'),
    };

    TestBed.configureTestingModule({
      imports: [ViewerControls],
      providers: [
        { provide: PdfService, useValue: { properties$: of({}), pdfProperties: {} } },
        { provide: IIIFViewerService, useValue: {
          bookMode$: of(false), zoomLock$: of(false), mapMode$: of(false),
          isMapMode: () => false, isBookMode: () => false,
        } },
        { provide: EpubService, useValue: {} },
        { provide: ConfigService, useValue: {
          isViewerControlEnabled: () => true,
          isFeatureEnabled: () => true,
          isViewerModeAvailable: () => true,
        } },
        { provide: AiPanelService, useValue: aiPanel },
        { provide: DetailViewService, useValue: detailView },
        { provide: MapViewerService, useValue: {} },
        { provide: TtsService, useValue: {
          isReading: signal(false), isPaused: signal(false), playbackBlocked: signal(false),
        } },
      ],
    });

    const fixture = TestBed.createComponent(ViewerControls);
    component = fixture.componentInstance;
    component.type = 'image';
  }

  beforeEach(() => {
    allowed = true;
    build({
      currentPagePid: 'uuid:page-1',
      isActionAllowed: (action: string) => action === 'text' ? allowed : true,
    });
  });

  it('offers the transcript when the licence permits text', () => {
    expect(component.showPageText).toBe(true);
    expect(component.getMenuItems().map(i => i.id)).toContain('page-text');
  });

  it('withholds the transcript when the licence denies text', () => {
    allowed = false;

    expect(component.showPageText).toBe(false);
    expect(component.getMenuItems().map(i => i.id)).not.toContain('page-text');
  });

  it('does not open the panel even if the denied action is invoked directly', () => {
    allowed = false;

    component.onPageText();
    component.handleMenuAction('page-text');

    expect(aiPanel.showPageText).not.toHaveBeenCalled();
  });

  it('opens the panel for the current page when permitted', () => {
    component.handleMenuAction('page-text');

    expect(aiPanel.showPageText).toHaveBeenCalledWith('uuid:page-1');
  });

  it('falls open outside the detail view, where no DetailViewService is provided', () => {
    build(null);

    expect(component.showPageText).toBe(true);
  });

  /**
   * The transcript is read out of the page's ALTO OCR, which only exists for
   * scanned pages. A PDF ships its own selectable text layer, so the button
   * offered nothing there but a second, worse copy of text already on screen.
   */
  it('withholds the transcript in the PDF viewer, which has its own text layer', () => {
    component.type = 'pdf';

    expect(component.showPageText).toBe(false);
    expect(component.getMenuItems().map(i => i.id)).not.toContain('page-text');
  });

  it('still offers the transcript in the image viewer', () => {
    component.type = 'image';

    expect(component.showPageText).toBe(true);
  });

});

/**
 * The menu ids from getMenuItems() only reach the viewer once
 * DetailViewPageComponent's allowlist recognises them. It is a plain static Set,
 * so a new menu entry that is not added there is silently dropped on tap — which
 * is exactly what happened to the read-aloud buttons on mobile (issue #161).
 */
describe('viewer menu action ids are routable', () => {

  it('every id getMenuItems can emit is present in the detail page allowlist', async () => {
    const { DetailViewPageComponent } = await import(
      '../../../modules/detail-view-page/detail-view-page.component'
    );
    const allowlist: Set<string> = (DetailViewPageComponent as any).VIEWER_MENU_ACTION_IDS;

    // Ids handleMenuAction knows how to route.
    const routableIds = [
      'select-area', 'fullscreen', 'fit-to-screen', 'fit-to-width',
      'zoom-lock', 'scroll-mode', 'rotate', 'page-text', 'book-mode',
      'tts-play-pause', 'tts-stop',
    ];

    for (const id of routableIds) {
      expect(allowlist.has(id)).withContext(`"${id}" missing from VIEWER_MENU_ACTION_IDS`).toBe(true);
    }
  });

});


/**
 * Issue #185: the floating column is absolutely positioned over the viewer, so
 * once the reader zooms in far enough for the scan to fill the width, its ten
 * or so buttons sit on top of the page text. Zoom and fullscreen stay out; the
 * rest fold behind a "more tools" toggle whose badge counts what is hidden.
 */
describe('ViewerControls extra-tools toggle', () => {
  const KEY = 'viewer-controls.extras-expanded';

  let store: Record<string, string>;
  let storage: { get: jasmine.Spy; set: jasmine.Spy };
  let iiif: any;
  let config: { isViewerControlEnabled: jasmine.Spy; isFeatureEnabled: jasmine.Spy; isViewerModeAvailable: jasmine.Spy };

  const build = (setup: (c: ViewerControls) => void = () => {}) => {
    TestBed.configureTestingModule({
      imports: [ViewerControls, TranslateModule.forRoot()],
      providers: [
        { provide: PdfService, useValue: { properties$: of({}), pdfProperties: { bookMode: false } } },
        { provide: IIIFViewerService, useValue: iiif },
        { provide: EpubService, useValue: {} },
        { provide: ConfigService, useValue: config },
        { provide: AiPanelService, useValue: { panelVisible: signal(false) } },
        { provide: DetailViewService, useValue: { isActionAllowed: () => true } },
        { provide: MapViewerService, useValue: {} },
        { provide: TtsService, useValue: {
          isReading: signal(false), isPaused: signal(false), playbackBlocked: signal(false),
          togglePlayPause: () => {}, stop: () => {},
        } },
        { provide: LocalStorageService, useValue: storage },
      ],
    });

    const fixture = TestBed.createComponent(ViewerControls);
    fixture.componentInstance.type = 'image';
    setup(fixture.componentInstance);
    fixture.detectChanges();
    return fixture;
  };

  const toggle = (f: any): HTMLElement =>
    f.nativeElement.querySelector('.viewer-controls__toggle');
  const extras = (f: any): HTMLElement =>
    f.nativeElement.querySelector('.viewer-controls__extras');

  /**
   * Asserts on what the reader actually sees. The element's `hidden` property
   * alone is not enough: a `display` rule from a class outranks the user
   * agent's [hidden] style, which is exactly how the collapsed list stayed on
   * screen the first time round.
   */
  const isRendered = (el: HTMLElement): boolean =>
    getComputedStyle(el).display !== 'none';

  beforeEach(() => {
    store = {};
    storage = {
      get: jasmine.createSpy('get').and.callFake((k: string) =>
        k in store ? JSON.parse(store[k]) : null),
      set: jasmine.createSpy('set').and.callFake((k: string, v: unknown) => {
        store[k] = JSON.stringify(v);
      }),
    };
    iiif = {
      bookMode$: of(false), zoomLock$: of(false), mapMode$: of(false),
      isMapMode: () => false, isBookMode: () => false, isZoomLocked: () => false,
    };
    config = {
      isViewerControlEnabled: jasmine.createSpy('isViewerControlEnabled').and.returnValue(true),
      isFeatureEnabled: jasmine.createSpy('isFeatureEnabled').and.returnValue(true),
      isViewerModeAvailable: jasmine.createSpy('isViewerModeAvailable').and.returnValue(true),
    };
    TestBed.resetTestingModule();
  });

  it('starts collapsed when nothing was stored', () => {
    expect(build().componentInstance.extrasExpanded()).toBe(false);
  });

  it('restores a stored expanded state', () => {
    store[KEY] = JSON.stringify(true);

    expect(build().componentInstance.extrasExpanded()).toBe(true);
  });

  it('falls back to collapsed when storage throws', () => {
    storage.get.and.throwError('storage blocked');

    expect(build().componentInstance.extrasExpanded()).toBe(false);
  });

  it('survives a storage failure while saving', () => {
    const fixture = build();
    storage.set.and.throwError('storage blocked');

    expect(() => fixture.componentInstance.toggleExtras()).not.toThrow();
    expect(fixture.componentInstance.extrasExpanded()).toBe(true);
  });

  it('keeps the primary tools out of the collapsible list', () => {
    const fixture = build();
    const primary: HTMLElement = fixture.nativeElement.querySelector('.viewer-controls');
    const outside = Array.from(primary.children)
      .filter(el => el.tagName === 'BUTTON' && !el.classList.contains('viewer-controls__toggle'));

    expect(outside.length).toBe(3);
    expect(isRendered(extras(fixture))).toBe(false);
  });

  it('reveals the extras on toggle and hides them again', () => {
    const fixture = build();

    fixture.componentInstance.toggleExtras();
    fixture.detectChanges();
    expect(isRendered(extras(fixture))).toBe(true);

    fixture.componentInstance.toggleExtras();
    fixture.detectChanges();
    expect(isRendered(extras(fixture))).toBe(false);
  });

  it('persists the choice across reloads', () => {
    const fixture = build();

    fixture.componentInstance.toggleExtras();

    expect(storage.set).toHaveBeenCalledWith(KEY, true);
  });

  it('counts every hidden tool in the badge', () => {
    const fixture = build();
    // image + not map + not book: crop, fit-to-screen, fit-to-width,
    // zoom-lock, rotate, page-text, book-mode. scroll-mode is pdf-only.
    expect(fixture.componentInstance.hiddenToolCount).toBe(7);
    expect(fixture.nativeElement.querySelector('.viewer-controls__badge').textContent.trim())
      .toBe('7');
  });

  it('leaves a tool the document cannot offer out of the count', () => {
    const fixture = build(c => {
      config.isViewerControlEnabled.and.callFake((id: string) =>
        id !== 'rotate' && id !== 'selectArea');
      c.type = 'image';
    });

    expect(fixture.componentInstance.hiddenToolCount).toBe(5);
  });

  it('counts the pdf-only scroll mode for a pdf, and drops image-only tools', () => {
    const fixture = build(c => { c.type = 'pdf'; });

    // fit-to-screen, fit-to-width, scroll-mode, rotate, book-mode.
    // page-text is scans-only; crop and zoom-lock are image-only.
    expect(fixture.componentInstance.hiddenToolCount).toBe(5);
  });

  it('flags the badge when a hidden tool is switched on', () => {
    iiif.isZoomLocked = () => true;
    const fixture = build();

    expect(fixture.componentInstance.hasActiveHiddenTool).toBe(true);
    expect(fixture.nativeElement.querySelector('.viewer-controls__badge')
      .classList.contains('viewer-controls__badge--active')).toBe(true);
  });

  it('stops flagging once the list is open and the tool is visible', () => {
    iiif.isZoomLocked = () => true;
    const fixture = build();

    fixture.componentInstance.toggleExtras();

    expect(fixture.componentInstance.hasActiveHiddenTool).toBe(false);
  });

  it('wires the toggle to the extras it controls', () => {
    const fixture = build();
    const id = extras(fixture).getAttribute('id');

    expect(toggle(fixture).getAttribute('aria-controls')).toBe(id);
    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('false');

    fixture.componentInstance.toggleExtras();
    fixture.detectChanges();

    expect(toggle(fixture).getAttribute('aria-expanded')).toBe('true');
  });

  it('gives each instance its own extras id', () => {
    const first = extras(build()).getAttribute('id');
    TestBed.resetTestingModule();
    const second = extras(build()).getAttribute('id');

    expect(first).not.toBe(second);
  });

  it('places the toggle between the primary tools and the extras for Tab order', () => {
    const fixture = build();
    fixture.componentInstance.toggleExtras();
    fixture.detectChanges();

    const panel: HTMLElement = fixture.nativeElement.querySelector('.viewer-controls');
    const kids = Array.from(panel.children);

    expect(kids.indexOf(toggle(fixture))).toBeGreaterThan(0);
    expect(kids.indexOf(toggle(fixture))).toBeLessThan(kids.indexOf(extras(fixture)));
  });

  // The DOM keeps Tab running primary -> toggle -> extras, while CSS order
  // drops the expanded toggle below the list it closes.
  it('marks the expanded toggle for reordering below the extras', () => {
    const fixture = build();
    expect(toggle(fixture).classList.contains('viewer-controls__toggle--expanded')).toBe(false);

    fixture.componentInstance.toggleExtras();
    fixture.detectChanges();

    expect(toggle(fixture).classList.contains('viewer-controls__toggle--expanded')).toBe(true);
  });

  it('renders no toggle in mobile menu mode, where actions live in the toolbar menu', () => {
    const fixture = build(c => { c.mobileMenuMode = true; });

    expect(toggle(fixture)).toBeNull();
  });
});
