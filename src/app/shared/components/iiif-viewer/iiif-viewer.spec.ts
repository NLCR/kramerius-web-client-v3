import { IIIFViewer } from './iiif-viewer';
import { Subject, Subscription } from 'rxjs';

/**
 * Regression tests for issue #161: swipe page-turning stopped working once the
 * AI panel split the viewer, and in portrait generally.
 *
 * The gate is isAtBaseZoom(), which used to compare the current zoom against
 * getHomeZoom() alone. updateMinZoomLevel() raises minZoomLevel to fit-height,
 * which in a tall/narrow container sits well above home zoom — so the viewer
 * rested above its own tolerance and every swipe was rejected.
 */
describe('IIIFViewer.isAtBaseZoom', () => {

  /**
   * Drives the real isAtBaseZoom() against a stub viewport, so the arithmetic
   * under test is the component's own.
   */
  function atBaseZoom(opts: { currentZoom: number; homeZoom: number; minZoomLevel: number }): boolean {
    const component = Object.create(IIIFViewer.prototype) as IIIFViewer;
    (component as any).SWIPE_CONFIG = { zoomTolerance: 1.15 };
    (component as any).viewer = {
      minZoomLevel: opts.minZoomLevel,
      viewport: {
        getZoom: () => opts.currentZoom,
        getHomeZoom: () => opts.homeZoom,
      },
    };
    return (component as any).isAtBaseZoom();
  }

  it('treats a portrait viewer resting at fit-height as un-zoomed', () => {
    // Phone portrait, 2000x3000 image: home=1.0 but minZoomLevel=1.197,
    // so the viewport rests at 1.197 without the user zooming at all.
    expect(atBaseZoom({ currentZoom: 1.197, homeZoom: 1.0, minZoomLevel: 1.197 })).toBe(true);
  });

  it('treats the half-width AI split view as un-zoomed', () => {
    // Same image at half width: minZoomLevel more than doubles.
    expect(atBaseZoom({ currentZoom: 2.393, homeZoom: 1.0, minZoomLevel: 2.393 })).toBe(true);
  });

  it('still reports a genuinely zoomed-in viewer as zoomed', () => {
    // User pinch-zoomed well past the resting level.
    expect(atBaseZoom({ currentZoom: 5.0, homeZoom: 1.0, minZoomLevel: 2.393 })).toBe(false);
  });

  it('allows a small amount of zoom within the tolerance', () => {
    expect(atBaseZoom({ currentZoom: 2.5, homeZoom: 1.0, minZoomLevel: 2.393 })).toBe(true);
    expect(atBaseZoom({ currentZoom: 2.76, homeZoom: 1.0, minZoomLevel: 2.393 })).toBe(false);
  });

  it('keeps working where home zoom is already the resting zoom', () => {
    // Landscape / desktop: minZoomLevel equals home zoom, the case that always worked.
    expect(atBaseZoom({ currentZoom: 0.371, homeZoom: 0.371, minZoomLevel: 0.371 })).toBe(true);
    expect(atBaseZoom({ currentZoom: 1.5, homeZoom: 0.371, minZoomLevel: 0.371 })).toBe(false);
  });

  it('tolerates a viewer with no minZoomLevel set', () => {
    expect(atBaseZoom({ currentZoom: 1.0, homeZoom: 1.0, minZoomLevel: 0 })).toBe(true);
  });

});

/**
 * Regression tests for the licensed-JPEG blank viewer.
 *
 * Every JPEG page 404s on IIIF info.json and falls back to the direct image.
 * That fallback used to be handed to OpenSeadragon as `{type:'image', url}`,
 * which ImageTileSource loads with `image.src = url` — a plain <img> request
 * that cannot carry the viewer's ajaxHeaders. Licensed pages (e.g. dnnto)
 * therefore hit the API anonymously and got 403 even for a signed-in user.
 * The image is now fetched via HttpClient (token attached) and handed over as
 * a blob object URL.
 */
describe('IIIFViewer direct-image fallback', () => {

  const PID = 'uuid:071b2770-e06e-11e1-9570-000d606f5dc6';

  function makeComponent(opts: {
    token?: string;
    respond: (observer: { next: (b: any) => void; error: (e: any) => void }) => void;
  }) {
    const component = Object.create(IIIFViewer.prototype) as IIIFViewer;
    const requests: { url: string; headers: any }[] = [];

    (component as any).imagePid = PID;
    (component as any).metadata = null;
    (component as any).viewer = { open: jasmine.createSpy('open') };
    (component as any).ngZone = { run: (fn: () => void) => fn() };
    (component as any).cdr = { detectChanges: () => {} };
    (component as any).directImageFailedPids = new Set<string>();
    (component as any).failedPids = new Set<string>();
    (component as any).showFallback = signalStub(false);
    (component as any).fallbackImageUrl = signalStub<string | null>(null);
    (component as any).accessDenied = signalStub(false);
    (component as any).fallbackObjectUrl = null;

    (component as any).iiifViewerService = {
      getDirectImageUrl: (pid: string) => `https://api.test/items/${pid}/image`,
      getThumbnailUrl: (pid: string) => `https://api.test/items/${pid}/image/thumb`,
      getAuthHeaders: () => (opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    };

    (component as any).http = {
      get: (url: string, options: any) => {
        requests.push({ url, headers: options.headers });
        return { subscribe: (observer: any) => opts.respond(observer) };
      }
    };

    return { component, requests };
  }

  /** Minimal stand-in for an Angular signal. */
  function signalStub<T>(initial: T) {
    let value = initial;
    const fn: any = () => value;
    fn.set = (v: T) => { value = v; };
    return fn;
  }

  it('sends the Authorization header when fetching the direct image', () => {
    const { component, requests } = makeComponent({
      token: 'abc123',
      respond: () => {}
    });

    (component as any).loadDirectImageFallback(PID);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toBe(`https://api.test/items/${PID}/image`);
    // This is the whole point of the fix: a plain <img> could never do this.
    expect(requests[0].headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('opens the viewer with a blob object URL, not the API URL', () => {
    const blob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    const { component } = makeComponent({
      token: 'abc123',
      respond: (o) => o.next(blob)
    });

    (component as any).loadDirectImageFallback(PID);

    const open = (component as any).viewer.open as jasmine.Spy;
    expect(open).toHaveBeenCalled();
    const tileSource = open.calls.mostRecent().args[0].tileSource;
    expect(tileSource.type).toBe('image');
    expect(tileSource.url.startsWith('blob:')).toBe(true);

    URL.revokeObjectURL(tileSource.url);
  });

  it('flags a 403 as access denied rather than a broken image', () => {
    const { component } = makeComponent({
      respond: (o) => o.error({ status: 403 })
    });

    (component as any).loadDirectImageFallback(PID);

    expect((component as any).accessDenied()).toBe(true);
    expect((component as any).showFallback()).toBe(true);
    // The fallback <img> has no auth either, so it must use the thumbnail,
    // which stays readable, instead of the full image that just 403'd.
    expect((component as any).fallbackImageUrl()).toBe(`https://api.test/items/${PID}/image/thumb`);
  });

  it('does not flag a network failure as access denied', () => {
    const { component } = makeComponent({
      respond: (o) => o.error({ status: 500 })
    });

    (component as any).loadDirectImageFallback(PID);

    expect((component as any).accessDenied()).toBe(false);
    expect((component as any).showFallback()).toBe(true);
  });

  it('ignores a response that arrives after the user navigated away', () => {
    let deferred: any = null;
    const { component } = makeComponent({
      respond: (o) => { deferred = o; }
    });

    (component as any).loadDirectImageFallback(PID);
    // User turns the page before the image comes back.
    (component as any).imagePid = 'uuid:some-other-page';
    deferred.next(new Blob(['late'], { type: 'image/jpeg' }));

    expect((component as any).viewer.open).not.toHaveBeenCalled();
  });

  it('revokes the previous blob before installing the next one', () => {
    const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
    const { component } = makeComponent({
      respond: (o) => o.next(new Blob(['x'], { type: 'image/jpeg' }))
    });

    (component as any).loadDirectImageFallback(PID);
    const first = (component as any).fallbackObjectUrl;
    (component as any).loadDirectImageFallback(PID);

    expect(revoke).toHaveBeenCalledWith(first);
    URL.revokeObjectURL((component as any).fallbackObjectUrl);
  });

});

/**
 * Regression tests for shared crop ("vystrizek") links: /uuid/<pid>?bb=x,y,w,h
 *
 * Main reverted the automatic crop zoom in 1f43400a. The current behavior
 * restores a selection after imageLoaded$ and then removes bb from the URL.
 * Exercise that subscription instead of the helper removed by the rollback.
 */
describe('IIIFViewer bb crop links', () => {

  function makeComponent(bb: string | null) {
    const component = Object.create(IIIFViewer.prototype) as IIIFViewer;

    const zoomCalls: { x: number; y: number; width: number; height: number }[] = [];
    const selectionCalls: any[] = [];
    const navigations: any[] = [];
    const imageLoaded$ = new Subject<void>();
    const subscriptions: Subscription[] = [];
    (component as any).subscriptions = subscriptions;
    (component as any).updateViewer$ = new Subject<void>();

    (component as any).iiifViewerService = {
      zoomToImageRegion: (rect: any) => zoomCalls.push({
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      }),
      setSelection: (rect: any) => selectionCalls.push({
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      }),
      bookMode$: new Subject<boolean>(),
      cdkLibraryCode$: new Subject<string>(),
      selectedArea$: new Subject<unknown>(),
      imageLoaded$,
    };
    (component as any).route = {
      snapshot: { queryParamMap: { get: (key: string) => (key === 'bb' ? bb : null) } },
    };
    (component as any).router = {
      navigate: (commands: any, extras: any) => navigations.push(extras),
    };

    component.ngOnInit();
    return { component, zoomCalls, selectionCalls, navigations, imageLoaded$, subscriptions };
  }

  function apply(bb: string | null) {
    const ctx = makeComponent(bb);
    ctx.imageLoaded$.next();
    ctx.subscriptions.forEach(subscription => subscription.unsubscribe());
    return ctx;
  }

  it('restores the shared crop as a selection after the image loads', () => {
    // The reported URL: ?bb=340,1209,456,449
    const { selectionCalls } = apply('340,1209,456,449');

    expect(selectionCalls.length).toBe(1);
    expect(selectionCalls[0]).toEqual({ x: 340, y: 1209, width: 456, height: 449 });
  });

  it('keeps the crop pending until the image is loaded', () => {
    const ctx = makeComponent('340,1209,456,449');
    expect(ctx.selectionCalls.length).toBe(0);
    expect(ctx.navigations.length).toBe(0);

    ctx.imageLoaded$.next();
    expect(ctx.selectionCalls.length).toBe(1);
    expect(ctx.zoomCalls.length).toBe(0);
    ctx.subscriptions.forEach(subscription => subscription.unsubscribe());
  });

  it('strips the bb param once applied', () => {
    const { navigations } = apply('340,1209,456,449');

    expect(navigations.length).toBe(1);
    expect(navigations[0].queryParams).toEqual({ bb: null });
    expect(navigations[0].replaceUrl).toBe(true);
    expect(navigations[0].queryParamsHandling).toBe('merge');
  });

  it('does nothing when no bb param is present', () => {
    const { selectionCalls, navigations } = apply(null);

    expect(selectionCalls.length).toBe(0);
    expect(navigations.length).toBe(0);
  });

  it('ignores a malformed bb param', () => {
    // Wrong arity, non-numeric, and empty values must not reach the viewport.
    for (const bad of ['340,1209,456', '340,1209,456,449,7', 'a,b,c,d', '', '340,,456,449']) {
      const { selectionCalls, navigations } = apply(bad);
      expect(selectionCalls.length).withContext(bad).toBe(0);
      expect(navigations.length).withContext(bad).toBe(0);
    }
  });

  it('does not apply a crop after its subscriptions are disposed', () => {
    const ctx = makeComponent('340,1209,456,449');
    ctx.subscriptions.forEach(subscription => subscription.unsubscribe());
    ctx.imageLoaded$.next();

    expect(ctx.selectionCalls.length).toBe(0);
    expect(ctx.navigations.length).toBe(0);
  });

  it('accepts fractional coordinates', () => {
    const { selectionCalls } = apply('340.5,1209.25,456.75,449.5');

    expect(selectionCalls[0]).toEqual({ x: 340.5, y: 1209.25, width: 456.75, height: 449.5 });
  });

});
