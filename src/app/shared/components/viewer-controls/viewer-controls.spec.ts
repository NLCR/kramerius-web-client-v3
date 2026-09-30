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
import { AccessibilityService } from '../../services/accessibility.service';
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
 * once the reader zooms in far enough for the scan to fill the width its
 * buttons sit on top of the page text, cutting across several lines at once at
 * the left edge. It now fades out while the reader is still and returns on the
 * next pointer move -- the approach the old client used, and the one the
 * reporters asked for. Every tool stays in the column: the previous attempt
 * folded the rarer ones behind a toggle, which buried the page-text button
 * readers rely on when a scan has no ALTO layer.
 */
describe('ViewerControls idle auto-hide', () => {
  let iiif: any;
  let config: any;
  let reduceMotion: boolean;
  let touchOnly: boolean;

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
        { provide: AccessibilityService, useValue: {
          settings: () => ({ reduceMotion }),
        } },
      ],
    });

    const fixture = TestBed.createComponent(ViewerControls);
    fixture.componentInstance.type = 'image';
    setup(fixture.componentInstance);
    fixture.detectChanges();
    return fixture;
  };

  const panel = (f: any): HTMLElement =>
    f.nativeElement.querySelector('.viewer-controls');

  /**
   * mouseenter/mouseleave do not bubble, and the listeners sit on the host
   * element rather than the inner panel -- so they must be dispatched there.
   */
  const host = (f: any): HTMLElement => f.nativeElement;

  /**
   * Drives the idle timer without waiting out the real delay. Ticks past the
   * touch delay, which is the longer of the two, so it settles the column in
   * either mode.
   */
  const goIdle = (f: any) => {
    jasmine.clock().tick(6000);
    f.detectChanges();
  };

  beforeEach(() => {
    reduceMotion = false;
    touchOnly = false;
    iiif = {
      bookMode$: of(false), zoomLock$: of(false), mapMode$: of(false),
      isMapMode: () => false, isBookMode: () => false, isZoomLocked: () => false,
    };
    config = {
      isViewerControlEnabled: jasmine.createSpy('isViewerControlEnabled').and.returnValue(true),
      isFeatureEnabled: jasmine.createSpy('isFeatureEnabled').and.returnValue(true),
      isViewerModeAvailable: jasmine.createSpy('isViewerModeAvailable').and.returnValue(true),
    };
    // Both media queries the component consults, answered from the flags above.
    spyOn(window, 'matchMedia').and.callFake((q: string) => ({
      matches: q.includes('reduce') ? reduceMotion : touchOnly,
      media: q,
    }) as MediaQueryList);
    jasmine.clock().install();
    TestBed.resetTestingModule();
  });

  afterEach(() => jasmine.clock().uninstall());

  it('starts visible', () => {
    const fixture = build();

    expect(fixture.componentInstance.idle()).toBe(false);
    expect(panel(fixture).classList.contains('viewer-controls--idle')).toBe(false);
  });

  it('fades out once the reader has been still', () => {
    const fixture = build();

    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
    expect(panel(fixture).classList.contains('viewer-controls--idle')).toBe(true);
  });

  it('stops swallowing clicks meant for the scan underneath while faded', () => {
    const fixture = build();

    goIdle(fixture);

    expect(getComputedStyle(panel(fixture)).pointerEvents).toBe('none');
  });

  it('comes back on the next pointer move', () => {
    const fixture = build();
    goIdle(fixture);

    document.dispatchEvent(new MouseEvent('mousemove'));
    fixture.detectChanges();

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('comes back when the reader scrolls the scan rather than moving the mouse', () => {
    const fixture = build();
    goIdle(fixture);

    document.dispatchEvent(new WheelEvent('wheel'));
    fixture.detectChanges();

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('comes back on a keypress, so Tab never lands on a faded control', () => {
    const fixture = build();
    goIdle(fixture);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    fixture.detectChanges();

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('fades again after the reader goes still once more', () => {
    const fixture = build();
    goIdle(fixture);
    document.dispatchEvent(new MouseEvent('mousemove'));
    fixture.detectChanges();

    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
  });

  it('never vanishes from under a pointer resting on it', () => {
    const fixture = build();

    host(fixture).dispatchEvent(new MouseEvent('mouseenter'));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('resumes fading once the pointer leaves again', () => {
    const fixture = build();
    host(fixture).dispatchEvent(new MouseEvent('mouseenter'));
    goIdle(fixture);

    host(fixture).dispatchEvent(new MouseEvent('mouseleave'));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
  });

  it('holds still while focus is inside, for readers with no pointer to hold it there', () => {
    const fixture = build();

    panel(fixture).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  /**
   * Touch fades too -- a tablet is where the column covers the most of the
   * page. The review concern was that a touch reader could be left with no
   * way back (no pointer to move) or could fire a button with the very tap
   * that wakes it; the three tests below pin down both.
   */
  it('fades on a touch device, where the column covers the most of the page', () => {
    touchOnly = true;
    const fixture = build();

    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
  });

  it('gives a touch reader longer to react than a mouse user', () => {
    touchOnly = true;
    const fixture = build();

    // Past the mouse delay, short of the touch one.
    jasmine.clock().tick(4500);
    fixture.detectChanges();

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('comes back on a tap anywhere, so it is never lost without a mouse', () => {
    touchOnly = true;
    const fixture = build();
    goIdle(fixture);

    document.dispatchEvent(new Event('touchstart'));
    fixture.detectChanges();

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  /**
   * The waking tap must reach the scan, not a button: the faded column drops
   * pointer-events precisely so the tap passes through it.
   */
  it('lets the waking tap through instead of firing a hidden button', () => {
    touchOnly = true;
    const fixture = build();

    goIdle(fixture);

    expect(getComputedStyle(panel(fixture)).pointerEvents).toBe('none');
  });

  it('holds still for the length of a pan or pinch, then resumes', () => {
    touchOnly = true;
    const fixture = build();

    document.dispatchEvent(new Event('touchstart'));
    goIdle(fixture);
    expect(fixture.componentInstance.idle()).toBe(false);

    document.dispatchEvent(new Event('touchend'));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
  });

  /**
   * Tapping a button emits a synthetic mouseenter that no mouseleave ever
   * answers, which would pin the column open for the rest of the session.
   */
  it('still fades after a tap on the column itself', () => {
    touchOnly = true;
    const fixture = build();

    host(fixture).dispatchEvent(new MouseEvent('mouseenter'));
    document.dispatchEvent(new Event('touchend'));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(true);
  });

  /** focusout always answers focusin, so this hold is safe on touch too. */
  it('holds still while focus is inside on touch as well', () => {
    touchOnly = true;
    const fixture = build();

    panel(fixture).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('never fades for a reader who asked for reduced motion', () => {
    reduceMotion = true;
    const fixture = build();

    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(false);
  });

  it('arms no timer in mobile menu mode, where there is no floating column', () => {
    const fixture = build(c => { c.mobileMenuMode = true; });

    goIdle(fixture);

    expect(fixture.componentInstance.idle()).toBe(false);
    expect(panel(fixture)).toBeNull();
  });

  /** The regression annie-cz reported: page-text must never be tucked away. */
  it('keeps every tool in the column, page-text included', () => {
    const fixture = build();
    const icons = Array.from(panel(fixture).querySelectorAll('button i'))
      .map(i => (i as HTMLElement).className);

    expect(icons.some(c => c.includes('icon-text'))).toBe(true);
    expect(panel(fixture).querySelector('.viewer-controls__toggle')).toBeNull();
    expect(panel(fixture).querySelector('.viewer-controls__extras')).toBeNull();
  });
});
