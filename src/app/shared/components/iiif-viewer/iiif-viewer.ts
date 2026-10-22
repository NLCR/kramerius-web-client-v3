import {
  Component,
  inject,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  ElementRef,
  ViewChild,
  AfterViewInit,
  NgZone,
  ChangeDetectorRef,
  signal,
  effect,
  HostListener
} from '@angular/core';
import { Metadata } from '../../models/metadata.model';
import { IIIFViewerService } from '../../services/iiif-viewer.service';
import { Subject, Subscription, switchMap, EMPTY, catchError, skip, distinctUntilChanged } from 'rxjs';
import { DetailViewService } from '../../../modules/detail-view-page/services/detail-view.service';
import OpenSeadragon from 'openseadragon';
import { SelectionControls } from '../selection-controls/selection-controls';
import { CommonModule } from '@angular/common';
import { ViewerWatermarkComponent } from '../viewer-watermark/viewer-watermark.component';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { RecordHandlerService } from '../../services/record-handler.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ExportService } from '../../services/export.service';
import { AltoService } from '../../services/alto.service';
import { TtsService } from '../../services/tts.service';
import { AiPanelService } from '../../services/ai-panel.service';
import { ThumbnailImageComponent } from '../thumbnail-image/thumbnail-image.component';
import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { TranslatePipe } from '@ngx-translate/core';
import { SKIP_ERROR_INTERCEPTOR } from '../../../core/services/http-context-tokens';

@Component({
  selector: 'app-iiif-viewer',
  imports: [
    SelectionControls,
    CommonModule,
    ThumbnailImageComponent,
    ViewerWatermarkComponent,
    TranslatePipe
  ],
  templateUrl: './iiif-viewer.html',
  styleUrl: './iiif-viewer.scss'
})
export class IIIFViewer implements OnInit, OnDestroy, OnChanges, AfterViewInit {

  @Input() metadata: Metadata | null = null;
  @Input() imagePid: string | null = null;

  @ViewChild('viewerContainer', { static: false }) viewerContainer!: ElementRef;
  // Thumbnails of the neighbouring pages, slid in alongside the page during a swipe.
  @ViewChild('peekPrev', { static: false }) peekPrev?: ElementRef<HTMLElement>;
  @ViewChild('peekNext', { static: false }) peekNext?: ElementRef<HTMLElement>;

  public iiifViewerService = inject(IIIFViewerService);
  private detailViewService = inject(DetailViewService);
  private recordHandlerService = inject(RecordHandlerService);
  private exportService = inject(ExportService);
  private altoService = inject(AltoService);
  private aiPanelService = inject(AiPanelService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ttsService = inject(TtsService);

  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  private subscriptions: Subscription[] = [];

  private viewer: OpenSeadragon.Viewer | null = null;
  /**
   * Exposed to the template so the watermark overlay can bind to the live
   * viewer: it draws in image coordinates and needs the viewport to project
   * them onto the screen.
   */
  public readonly osdViewer = signal<OpenSeadragon.Viewer | null>(null);
  private updateViewer$ = new Subject<void>();
  private failedPids = new Set<string>();
  private directImageFailedPids = new Set<string>();

  public showFallback = signal<boolean>(false);
  public fallbackImageUrl = signal<string | null>(null);

  /**
   * The thumbnail currently painted as the container's background placeholder.
   *
   * Handed to the watermark overlay so it can stamp that placeholder too: the
   * tiled image does not exist until `info.json` returns, and without this the
   * page would be on screen unwatermarked for that whole round-trip.
   */
  public readonly placeholderUrl = signal<string | null>(null);

  /**
   * Object URL of the direct-image fallback currently held by OpenSeadragon.
   * ImageTileSource loads via a plain `new Image()`, which cannot carry an
   * Authorization header, so licensed images are fetched as a blob instead
   * (see loadDirectImageFallback). The URL must be revoked once it is no
   * longer displayed or the blob leaks for the lifetime of the document.
   */
  private fallbackObjectUrl: string | null = null;

  /**
   * Set when the direct image came back 403 — the image exists but the current
   * user has no right to it (e.g. a `dnnto` page while logged out or without
   * the licence). Distinguishes "not allowed" from "failed to load".
   */
  public accessDenied = signal<boolean>(false);

  readonly docLicenses = toSignal(
    this.detailViewService.document$.pipe(map(doc => doc?.licences ?? [])),
    { initialValue: [] as string[] }
  );

  public selectionRect: { top: number, left: number } | null = null;
  public showSelectionControls = false;

  // Page-turn swipe configuration (touch, pen and mouse drag). At resting zoom the page follows
  // the finger like a sheet of paper and turns on release; when zoomed in, a
  // drag pans the image instead. There is deliberately no maximum duration: a
  // slow, deliberate drag is how people turn pages, and rejecting it left the
  // image sliding around without ever turning (the old 600 ms limit).
  private readonly SWIPE_CONFIG = {
    lockDistance: 8,        // px of movement before the gesture picks an axis
    commitRatio: 0.2,       // fraction of the viewer width that turns the page
    commitVelocity: 0.35,   // px/ms flick speed that turns the page regardless of distance
    edgeResistance: 0.3,    // drag damping on the first/last page (rubber band)
    animMs: 220,            // slide-out / snap-back duration
    zoomTolerance: 1.15     // zoom above resting zoom (15%) counts as "zoomed in"
  } as const;

  // Page-turn swipe state. 'pending' = finger down at resting zoom, axis not
  // chosen yet; 'page' = horizontal page drag in progress; 'blocked' = vertical
  // drag at resting zoom (ignored); 'none' = not ours (OSD pans/pinches).
  private swipe = {
    mode: 'none' as 'none' | 'pending' | 'page' | 'blocked',
    pointerId: -1,
    startX: 0,
    startY: 0,
    dx: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    activeTouches: new Set<number>(),
    animating: false,
  };

  private readonly TEST_FALLBACK = false;

  constructor() {
    // Watch TTS state and show/clear highlight overlay on matching page
    effect(() => {
      const currentBlock = this.ttsService.currentBlock();
      const ttsPagePid = this.ttsService.currentPagePid();
      const isReading = this.ttsService.isReading();

      if (isReading && currentBlock && ttsPagePid === this.imagePid) {
        this.iiifViewerService.showTtsHighlight(currentBlock);
      } else {
        this.iiifViewerService.clearTtsHighlight();
      }
    });
  }

  private resizeObserver: ResizeObserver | null = null;

  ngOnInit(): void {
    this.iiifViewerService.uuid = this.metadata?.uuid || null;

    // Wire up viewer update pipeline with switchMap so rapid navigation cancels in-flight requests
    this.subscriptions.push(
      this.updateViewer$.pipe(
        switchMap(() => this.buildViewerUpdate().pipe(
          catchError((error) => {
            console.error('Failed to fetch IIIF info.json for page update', error);
            this.handleOpenFailed();
            return EMPTY;
          })
        ))
      ).subscribe()
    );

    // Subscribe to book mode changes. bookMode$ is a BehaviorSubject, so it
    // replays its seed on subscribe; skip(1) ignores that replay because the
    // initial load is owned by initializeViewer. distinctUntilChanged avoids
    // rebuilding the viewer when the mode is re-emitted with the same value.
    this.subscriptions.push(
      this.iiifViewerService.bookMode$.pipe(
        skip(1),
        distinctUntilChanged(),
      ).subscribe(() => {
        this.triggerViewerUpdate();
      })
    );

    // CDK: when the user picks a different source library in metadata-section,
    // URLs change (now include /{libraryCode}/) — refresh tiles, thumb, fallback.
    // skip(1) ignores the BehaviorSubject seed; the initial tile load happens via
    // initializeViewer, not here. distinctUntilChanged avoids redundant reloads.
    this.subscriptions.push(
      this.iiifViewerService.cdkLibraryCode$.pipe(
        skip(1),
        distinctUntilChanged(),
      ).subscribe(() => {
        const pid = this.imagePid || this.metadata?.uuid;
        if (!pid) return;
        this.failedPids.delete(pid);
        this.directImageFailedPids.delete(pid);
        this.showFallback.set(false);
        this.fallbackImageUrl.set(null);
        this.accessDenied.set(false);
        this.releaseFallbackObjectUrl();
        this.triggerViewerUpdate();
      })
    );

    this.subscriptions.push(
      this.iiifViewerService.selectedArea$.subscribe(rect => {
        console.log('rect', rect)
        this.ngZone.run(() => {
          if (rect) {
            this.showSelectionControls = true;
            this.updateSelectionControlsPosition(rect);
          } else {
            this.showSelectionControls = false;
            this.selectionRect = null;
            this.currentImageRect = null;
          }
          this.cdr.detectChanges();

          // The first placement above runs before the controls exist in the
          // DOM, so it has to clamp against fallback dimensions. Now that
          // detectChanges() has rendered them, recompute with the measured box
          // and repaint if that moved anything.
          if (rect) {
            const before = this.selectionRect ? { ...this.selectionRect } : null;
            this.updateControlsPosition();
            if (before && this.selectionRect &&
              (before.top !== this.selectionRect.top || before.left !== this.selectionRect.left)) {
              this.cdr.detectChanges();
            }
          }
        });
      })
    );

    // Check for selection in URL
    this.subscriptions.push(
      this.iiifViewerService.imageLoaded$.subscribe(() => {
        const bb = this.route.snapshot.queryParamMap.get('bb');
        if (bb) {
          const parts = bb.split(',');
          if (parts.length === 4) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const w = parseFloat(parts[2]);
            const h = parseFloat(parts[3]);

            if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
              const rect = new OpenSeadragon.Rect(x, y, w, h);
              this.iiifViewerService.setSelection(rect);

              this.router.navigate([], {
                relativeTo: this.route,
                queryParams: { bb: null },
                queryParamsHandling: 'merge',
                replaceUrl: true
              });
            }
          }
        }
      })
    );
  }

  ngAfterViewInit(): void {
    // Check if container has dimensions
    if (this.viewerContainer.nativeElement.offsetHeight > 0 && this.viewerContainer.nativeElement.offsetWidth > 0) {
      this.initializeViewer();
    } else {
      console.log('Viewer container has no dimensions, waiting for resize...');
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            console.log('Viewer container resized, initializing viewer');
            this.initializeViewer();
            this.resizeObserver?.disconnect();
            this.resizeObserver = null;
          }
        }
      });
      this.resizeObserver.observe(this.viewerContainer.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.iiifViewerService.clearTtsHighlight();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up page-turn swipe listeners
    if (this.viewerContainer?.nativeElement) {
      const container = this.viewerContainer.nativeElement;
      container.removeEventListener('pointerdown', this.onSwipePointerDown, true);
      container.removeEventListener('pointermove', this.onSwipePointerMove, true);
      container.removeEventListener('pointerup', this.onSwipePointerUp, true);
      container.removeEventListener('pointercancel', this.onSwipePointerUp, true);
    }

    if (this.viewer) {
      // Detach the watermark's viewport handlers before the viewer goes away.
      this.osdViewer.set(null);
      this.viewer.destroy();
    }

    // Release the direct-image blob after the viewer that displays it is gone.
    this.releaseFallbackObjectUrl();

    // Disable test mode when component is destroyed
    this.iiifViewerService.setTestFallbackMode(false);
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Update viewer when imagePid changes
    if (changes['imagePid'] && !changes['imagePid'].firstChange) {
      // Reset fallback state when switching to a new image. The blob object URL
      // is deliberately not revoked here — OpenSeadragon may still be painting
      // it; loadDirectImageFallback revokes the previous one as it installs the
      // next, and ngOnDestroy covers the final page.
      this.showFallback.set(false);
      this.fallbackImageUrl.set(null);
      this.accessDenied.set(false);
      this.triggerViewerUpdate();
    }
  }

  private initializeViewer(): void {
    const pid = this.imagePid || this.metadata?.uuid;
    if (!pid) {
      console.error('No PID or UUID provided for IIIF viewer');
      return;
    }

    // Enable test mode in service if TEST_FALLBACK is true
    this.iiifViewerService.setTestFallbackMode(this.TEST_FALLBACK);

    // Set thumbnail as background placeholder (blur→sharp effect)
    this.setThumbnailBackground(pid);

    const infoUrl = this.iiifViewerService.getIIIFInfoUrl(pid);

    // Get authorization headers if user is authenticated
    const authHeaders = this.iiifViewerService.getAuthHeaders();

    // Create HttpHeaders for the initial request
    let headers = new HttpHeaders();
    if (authHeaders['Authorization']) {
      headers = headers.set('Authorization', authHeaders['Authorization']);
    }

    // When book mode is already active (e.g. re-mounting after a brief access-check
    // reload on page turn — see DetailViewService.loadPageInfo), open the current and
    // next page side by side right away instead of always falling back to a single
    // page, which would otherwise silently drop book mode on every page turn.
    const isBookMode = this.iiifViewerService.isBookMode();
    const nextPagePid = isBookMode ? this.getNextPagePid() : null;

    if (!isBookMode || !nextPagePid) {
      // Fetch info.json with auth headers, then create viewer
      this.http.get(infoUrl, {
        headers,
        context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
      }).subscribe({
        next: (infoJson: any) => {
          this.processInfoJson(infoJson, infoUrl);
          this.createViewer(infoJson);
        },
        error: (error) => {
          console.error('Failed to fetch IIIF info.json', error);
          this.handleOpenFailed();
        }
      });
      return;
    }

    this.clearThumbnailBackground();
    const nextInfoUrl = this.iiifViewerService.getIIIFInfoUrl(nextPagePid);
    this.http.get(infoUrl, {
      headers,
      context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
    }).subscribe({
      next: (infoJson: any) => {
        this.processInfoJson(infoJson, infoUrl);
        this.http.get(nextInfoUrl, {
          headers,
          context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
        }).subscribe({
          next: (nextInfoJson: any) => {
            this.processInfoJson(nextInfoJson, nextInfoUrl);
            this.createViewer([
              { tileSource: infoJson, x: 0, y: 0, width: 0.5 },
              { tileSource: nextInfoJson, x: 0.5, y: 0, width: 0.5 }
            ]);
          },
          error: (error) => {
            console.error('Failed to fetch IIIF info.json for next page', error);
            // Fall back to single page rather than failing the whole viewer.
            this.createViewer(infoJson);
          }
        });
      },
      error: (error) => {
        console.error('Failed to fetch IIIF info.json', error);
        this.handleOpenFailed();
      }
    });
  }

  /**
   * Set thumbnail image as background placeholder while IIIF tiles load
   * Creates the blur→sharp progressive loading effect
   */
  private setThumbnailBackground(pid: string): void {
    const thumbnailUrl = this.iiifViewerService.getThumbnailUrl(pid);
    // The watermark lays itself out on this thumbnail until the tiled image
    // exists, so it has to learn the URL at the same moment the background does.
    this.placeholderUrl.set(thumbnailUrl);
    const container = this.viewerContainer.nativeElement;
    container.style.backgroundImage = `url('${thumbnailUrl}')`;
    container.style.backgroundSize = 'contain';
    container.style.backgroundPosition = 'center';
    container.style.backgroundRepeat = 'no-repeat';
  }

  /**
   * Clear the thumbnail background after IIIF tiles have loaded
   */
  private clearThumbnailBackground(): void {
    // Only the placeholder goes away; the watermark has the real geometry by
    // now and keeps drawing from the viewport.
    this.placeholderUrl.set(null);
    const container = this.viewerContainer.nativeElement;
    container.style.backgroundImage = '';
  }

  /**
   * Wait for the viewer's image to be fully loaded, then clear the thumbnail background.
   * Handles both IIIF tiled sources (waits for all tiles) and direct image fallbacks.
   */
  private waitForImageLoaded(): void {
    const tiledImage = this.viewer?.world.getItemAt(0);
    if (tiledImage) {
      if (tiledImage.getFullyLoaded()) {
        requestAnimationFrame(() => this.clearThumbnailBackground());
      } else {
        const onFullyLoaded = (e: any) => {
          if (e.fullyLoaded) {
            tiledImage.removeHandler('fully-loaded-change', onFullyLoaded);
            requestAnimationFrame(() => this.clearThumbnailBackground());
          }
        };
        tiledImage.addHandler('fully-loaded-change', onFullyLoaded);
      }
    } else {
      // World is empty — image not added yet (can happen with direct image fallbacks).
      // Listen for the item to be added, then wait for it to fully load.
      const onAddItem = (e: any) => {
        this.viewer?.world.removeHandler('add-item', onAddItem);
        const item = e.item;
        if (item.getFullyLoaded()) {
          requestAnimationFrame(() => this.clearThumbnailBackground());
        } else {
          const onFullyLoaded = (ev: any) => {
            if (ev.fullyLoaded) {
              item.removeHandler('fully-loaded-change', onFullyLoaded);
              requestAnimationFrame(() => this.clearThumbnailBackground());
            }
          };
          item.addHandler('fully-loaded-change', onFullyLoaded);
        }
      };
      this.viewer?.world.addHandler('add-item', onAddItem);
    }
  }

  private createViewer(tileSource: any): void {
    if (this.viewer) {
      this.osdViewer.set(null);
      this.viewer.destroy();
    }

    const authHeaders = this.iiifViewerService.getAuthHeaders();

    this.viewer = OpenSeadragon({
      element: this.viewerContainer.nativeElement,
      prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1/build/openseadragon/images/',
      tileSources: tileSource,
      showNavigationControl: false,
      showRotationControl: false,
      showHomeControl: false,
      showZoomControl: false,
      showFullPageControl: false,
      // Tiles are fetched via the API proxy which requires the same auth token.
      // loadTilesWithAjax must be true for ajaxHeaders to be sent.
      loadTilesWithAjax: true,
      crossOriginPolicy: 'Anonymous',
      ajaxWithCredentials: false,
      ajaxHeaders: authHeaders,
      // Transparent placeholder so thumbnail background shows through
      placeholderFillStyle: 'transparent',
      // Left at OpenSeadragon's default (false) so the pyramid is walked
      // low-res → high-res and the page sharpens progressively. Setting it to
      // true pins every tile's priority to the target level, so nothing shows
      // until those tiles land and the page then appears all at once.
      // The thumbnail background covers the gap until the first tiles arrive.
      immediateRender: false,
      // OpenSeadragon's default is 0 (unlimited), which fires every tile of the
      // visible grid at once. Each one pays the CDK proxy's per-request
      // overhead, so the burst is what makes page loads feel slow — capping
      // concurrency spreads it out without dropping any tile. This is the knob
      // to reach for when proxy load is the problem: prefer it over coarsening
      // minPixelRatio below, which pays for fewer requests with image quality.
      imageLoaderLimit: 6,
      // Caps the pyramid level OSD targets: highestLevel is clamped by
      // log2(zeroRatio / minPixelRatio), so raising this picks a coarser level.
      // Kept at OpenSeadragon's default. It was raised to 1.0 to cut proxy
      // round-trips, but that drops the finest pyramid level the viewport can
      // actually use, which is what made pages look soft at typical laptop
      // resolutions (issue #183) — zooming only partly recovers it. The saving
      // was small: a page at fit-to-screen needs on the order of ten tiles
      // either way, and one level down removes only a handful. Use
      // imageLoaderLimit above to bound proxy load instead; it costs no
      // quality. Note that tiles are fetched via AJAX and are HTTP-cached, so
      // measuring this needs a page not yet visited in the session.
      minPixelRatio: 0.5,
      gestureSettingsMouse: {
        clickToZoom: false,
        dblClickToZoom: true,
        flickEnabled: true,
        pinchToZoom: true,
        scrollToZoom: true
      },
      gestureSettingsTouch: {
        clickToZoom: false,
        dblClickToZoom: true,
        flickEnabled: false, // Disable flick to prevent interference with swipe
        pinchToZoom: true,
        scrollToZoom: false
      },
      minZoomLevel: 0,
      maxZoomLevel: 10,
      visibilityRatio: 1,
      constrainDuringPan: false
    });

    // Hand the new viewer to the watermark overlay, which projects its image
    // coordinates through this viewport.
    this.osdViewer.set(this.viewer);

    // Reset fallback state when image source opens, then wait for all tiles to render
    this.viewer.addHandler('open', () => {
      this.ngZone.run(() => {
        this.showFallback.set(false);
        this.fallbackImageUrl.set(null);
        this.accessDenied.set(false);
        // Page loaded successfully — unlock it in the sidebar grid
        const pid = this.imagePid || this.metadata?.uuid;
        if (pid) {
          this.detailViewService.markPageAsAccessible(pid);
        }
      });
      // Set minimum zoom to fit-to-height so max zoom-out shows the full image height
      this.updateMinZoomLevel();
      // Restore locked zoom after the new page opens
      this.iiifViewerService.applyLockedZoom();

      // Wait for image content to be rendered before clearing thumbnail background.
      // For IIIF tiled images this creates a blur→sharp progressive loading effect.
      // For direct image fallbacks, the single "tile" loads fully at once.
      this.waitForImageLoaded();
      // The page that a swipe brought in is now open: drop the neighbour
      // thumbnail that covered the swap, and warm up the next neighbours.
      this.hidePeeks();
      this.prefetchNeighbours();
    });

    this.viewer.addHandler('update-viewport', () => {
      if (this.showSelectionControls) {

      }
    });

    this.viewer.addHandler('animation', () => {
      this.ngZone.run(() => {
        this.updateControlsPosition();
      });
    });
    this.viewer.addHandler('update-viewport', () => {
      this.ngZone.run(() => {
        this.updateControlsPosition();
      });
    });

    // The container changes size without the image reopening — most visibly when
    // the AI panel splits the viewer in half — and minZoomLevel is derived from
    // that size, so recompute it on resize (issue #161).
    this.viewer.addHandler('resize', () => {
      this.updateMinZoomLevel();
    });

    // Page-turn swipe: native pointer listeners decide whether a touch drag turns
    // the page; while they own the gesture, OSD's own drag (pan) and flick are
    // suppressed so the image does not slide around under the finger.
    this.setupSwipeListeners();
    this.viewer.addHandler('canvas-drag', (event: any) => {
      if (this.swipe.mode !== 'none') {
        event.preventDefaultAction = true;
      }
    });
    this.viewer.addHandler('canvas-drag-end', (event: any) => {
      if (this.swipe.mode !== 'none') {
        event.preventDefaultAction = true;
      }
    });

    this.viewer.addHandler('open-failed', () => {
      this.handleOpenFailed();
    });

    this.iiifViewerService.setViewer(this.viewer);
  }

  private handleOpenFailed(): void {
    const currentPid = this.imagePid || this.metadata?.uuid;
    if (!currentPid) {
      console.error('No PID available for fallback');
      this.showFallback.set(true);
      return;
    }

    // Check if direct image already failed for this PID.
    // The fallback <img> carries no Authorization header, so it must point at
    // the thumbnail (always readable) rather than the full image, which 403s
    // for licensed pages and would render as a broken image.
    if (this.directImageFailedPids.has(currentPid)) {
      console.log(`Both IIIF and direct image failed for PID: ${currentPid}. Showing thumbnail fallback.`);
      this.ngZone.run(() => {
        this.fallbackImageUrl.set(this.iiifViewerService.getThumbnailUrl(currentPid));
        this.showFallback.set(true);
        this.cdr.detectChanges();
      });
      return;
    }

    // Check if IIIF already failed (meaning this is the direct image failing now)
    if (this.failedPids.has(currentPid)) {
      console.log(`Direct image fallback also failed for PID: ${currentPid}. Showing thumbnail fallback.`);
      this.directImageFailedPids.add(currentPid);
      this.ngZone.run(() => {
        this.fallbackImageUrl.set(this.iiifViewerService.getThumbnailUrl(currentPid));
        this.showFallback.set(true);
        this.cdr.detectChanges();
      });

      setTimeout(() => {
        this.directImageFailedPids.delete(currentPid);
      }, 5000);
      return;
    }

    // IIIF failed, try direct image URL
    this.failedPids.add(currentPid);
    this.loadDirectImageFallback(currentPid);

    setTimeout(() => {
      this.failedPids.delete(currentPid);
    }, 5000);
  }

  /**
   * Load the direct (non-tiled) image as the viewer's source.
   *
   * OpenSeadragon's ImageTileSource fetches with `image.src = url` — a plain
   * <img> request that ignores the viewer's `ajaxHeaders`. Licensed pages
   * (e.g. `dnnto`) therefore hit the API anonymously and get 403 even when the
   * user is signed in. Fetching the bytes ourselves via HttpClient lets the
   * Authorization header through; the resulting blob is handed to OpenSeadragon
   * as an object URL, which `new Image()` can load without any credentials.
   */
  private loadDirectImageFallback(pid: string): void {
    const directImageUrl = this.iiifViewerService.getDirectImageUrl(pid);
    console.log(`IIIF failed, attempting fallback image: ${directImageUrl}`);

    const authHeaders = this.iiifViewerService.getAuthHeaders();
    let headers = new HttpHeaders();
    if (authHeaders['Authorization']) {
      headers = headers.set('Authorization', authHeaders['Authorization']);
    }

    this.http.get(directImageUrl, {
      headers,
      responseType: 'blob',
      context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
    }).subscribe({
      next: (blob) => {
        // Navigation may have moved on while the request was in flight.
        if ((this.imagePid || this.metadata?.uuid) !== pid) return;

        this.releaseFallbackObjectUrl();
        this.fallbackObjectUrl = URL.createObjectURL(blob);

        const directImageTileSource = { type: 'image', url: this.fallbackObjectUrl };

        this.ngZone.run(() => {
          this.accessDenied.set(false);

          if (this.viewer) {
            this.viewer.open({ tileSource: directImageTileSource });
          } else {
            // Viewer was never created (info.json fetch failed before createViewer ran).
            // Create it now with the direct image as tile source.
            this.createViewer(directImageTileSource);
          }
        });
      },
      error: (error) => {
        if ((this.imagePid || this.metadata?.uuid) !== pid) return;

        // 403 means the image is there but this user may not see it — a licence
        // prompt is the useful response, not a generic "image broken" fallback.
        const denied = error?.status === 403 || error?.status === 401;
        if (denied) {
          console.log(`Direct image denied (HTTP ${error.status}) for PID: ${pid}. User lacks licence access.`);
        } else {
          console.error(`Direct image fallback failed for PID: ${pid}`, error);
        }

        this.directImageFailedPids.add(pid);
        this.ngZone.run(() => {
          this.accessDenied.set(denied);
          this.fallbackImageUrl.set(this.iiifViewerService.getThumbnailUrl(pid));
          this.showFallback.set(true);
          this.cdr.detectChanges();
        });

        setTimeout(() => {
          this.directImageFailedPids.delete(pid);
        }, 5000);
      }
    });
  }

  /** Revoke the currently held fallback object URL, if any. */
  private releaseFallbackObjectUrl(): void {
    if (this.fallbackObjectUrl) {
      URL.revokeObjectURL(this.fallbackObjectUrl);
      this.fallbackObjectUrl = null;
    }
  }

  private updateViewerSource(): void {
    if (!this.viewer) return;

    const pid = this.imagePid || this.metadata?.uuid;
    if (!pid) return;

    const infoUrl = this.iiifViewerService.getIIIFInfoUrl(pid);
    this.viewer.open({ tileSource: infoUrl });
  }

  /**
   * Triggers a viewer update. Any in-flight update is cancelled via switchMap.
   */
  private triggerViewerUpdate(): void {
    if (!this.viewer) return;
    this.updateViewer$.next();
  }

  /**
   * Builds the observable that updates the viewer for the current page/book mode state.
   * Used with switchMap so rapid navigation cancels in-flight HTTP requests.
   */
  private buildViewerUpdate() {
    if (!this.viewer) return EMPTY;

    const currentPid = this.imagePid || this.metadata?.uuid;
    if (!currentPid) return EMPTY;

    // Area selection ("select area"/crop) is scoped to a single page. Turning it
    // off on every page change (a no-op when it wasn't active) prevents it from
    // getting stuck across a page turn — mouse nav staying disabled and the
    // crosshair cursor persisting even though the page itself already changed.
    this.iiifViewerService.setSelectionMode(false);

    // Clear existing overlays when changing pages
    this.iiifViewerService.clearAllOverlays();

    const isBookMode = this.iiifViewerService.isBookMode();
    const nextPagePid = isBookMode ? this.getNextPagePid() : null;

    // Set thumbnail as background placeholder for blur→sharp effect (single page only)
    if (!isBookMode) {
      this.setThumbnailBackground(currentPid);
    } else {
      this.clearThumbnailBackground();
    }

    const authHeaders = this.iiifViewerService.getAuthHeaders();
    let headers = new HttpHeaders();
    if (authHeaders['Authorization']) {
      headers = headers.set('Authorization', authHeaders['Authorization']);
    }

    const infoUrl = this.iiifViewerService.getIIIFInfoUrl(currentPid);

    if (!isBookMode || !nextPagePid) {
      return this.http.get(infoUrl, {
        headers,
        context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
      }).pipe(
        switchMap((infoJson: any) => {
          this.processInfoJson(infoJson, infoUrl);
          this.viewer?.open(infoJson);
          return EMPTY;
        })
      );
    }

    // Book mode: fetch both pages
    const nextInfoUrl = this.iiifViewerService.getIIIFInfoUrl(nextPagePid);
    return this.http.get(infoUrl, {
      headers,
      context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
    }).pipe(
      switchMap((infoJson: any) => {
        this.processInfoJson(infoJson, infoUrl);
        return this.http.get(nextInfoUrl, {
          headers,
          context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
        }).pipe(
          switchMap((nextInfoJson: any) => {
            this.processInfoJson(nextInfoJson, nextInfoUrl);
            this.viewer?.open([
              { tileSource: infoJson, x: 0, y: 0, width: 0.5 },
              { tileSource: nextInfoJson, x: 0.5, y: 0, width: 0.5 }
            ]);
            return EMPTY;
          })
        );
      })
    );
  }

  /**
   * Process IIIF info.json for use with OpenSeadragon:
   * 1. Fix HTTP URLs to HTTPS (prevents mixed content errors)
   * 2. Ensure @id points to the API proxy URL for tile resolution
   * 3. Remove sizes array to prevent wrong tile grid calculation
   *
   * @param infoJson - The info.json response object (mutated in place)
   * @param apiInfoUrl - The API proxy URL used to fetch this info.json.
   *   When provided, @id is set to the base image URL derived from it
   *   so OpenSeadragon always resolves tiles through the API proxy —
   *   not through an internal imageserver URL that may not be reachable.
   */
  private processInfoJson(infoJson: any, apiInfoUrl?: string): void {
    this.fixHttpUrls(infoJson);

    // Ensure OpenSeadragon resolves tiles through the API proxy.
    // The info.json 'id' field often points to an internal imageserver that
    // is not publicly accessible. Override @id with the API proxy base URL
    // so tile requests go through the same proxy that served info.json.
    if (apiInfoUrl) {
      // info.json URL is ".../info.json", the base image URL is the parent path
      const baseUrl = apiInfoUrl.replace(/\/info\.json$/, '');
      infoJson['@id'] = baseUrl;
      delete infoJson['id'];
    } else if (infoJson['id'] && infoJson['@id']) {
      delete infoJson['id'];
    }

    // Remove sizes array to prevent OpenSeadragon bug where it uses sizes
    // as level dimensions instead of computing from actual width/height.
    // When sizes.length coincidentally equals maxLevel+1 but doesn't include
    // the full resolution, OSD only tiles a fraction of the image.
    if (infoJson.sizes && infoJson.tiles) {
      delete infoJson.sizes;
    }
  }

  /**
   * Fix HTTP URLs in IIIF info.json to use HTTPS (prevents mixed content errors)
   * Recursively processes all string values in the JSON
   * NOTE: Preserves @context and protocol fields as OpenSeadragon needs exact
   * "http://iiif.io/api/image/..." patterns to identify IIIF tile sources
   */
  private fixHttpUrls(obj: any): void {
    if (!obj || typeof obj !== 'object') return;

    // Fields that OpenSeadragon checks for exact "http://..." patterns
    const preserveFields = ['@context', 'protocol', 'profile'];

    for (const key of Object.keys(obj)) {
      // Skip IIIF spec fields that must remain as http://
      if (preserveFields.includes(key)) continue;

      const value = obj[key];
      if (typeof value === 'string' && value.startsWith('http://')) {
        obj[key] = value.replace('http://', 'https://');
      } else if (typeof value === 'object') {
        this.fixHttpUrls(value);
      }
    }
  }

  /**
   * Gets the PID of the next page from DetailViewService
   * Returns null if there is no next page
   */
  private getNextPagePid(): string | null {
    const pages = this.detailViewService.pages;
    const currentPageIndex = this.detailViewService.currentPageIndex;

    if (currentPageIndex < pages.length - 1) {
      return pages[currentPageIndex + 1].pid;
    }

    return null;
  }

  private currentImageRect: OpenSeadragon.Rect | null = null;

  private updateSelectionControlsPosition(imageRect: OpenSeadragon.Rect) {
    this.currentImageRect = imageRect;
    this.updateControlsPosition();
  }

  /** Gap between the selection box and the floating controls, in px. */
  private static readonly CONTROLS_GAP = 10;
  /** Keep this much clearance from the viewer edges when clamping. */
  private static readonly CONTROLS_MARGIN = 8;
  /** Fallback size used before the controls have been measured (see SCSS). */
  private static readonly CONTROLS_FALLBACK_WIDTH = 48;
  private static readonly CONTROLS_FALLBACK_HEIGHT = 168;

  private updateControlsPosition() {
    if (!this.viewer || !this.currentImageRect || !this.showSelectionControls) return;

    const viewportRect = this.viewer.viewport.imageToViewportRectangle(this.currentImageRect);
    const elementRect = this.viewer.viewport.viewportToViewerElementRectangle(viewportRect);

    const container = this.viewerContainer?.nativeElement as HTMLElement | undefined;
    const containerWidth = container?.clientWidth ?? 0;
    const containerHeight = container?.clientHeight ?? 0;

    // Measure the rendered controls when available so the clamp matches the
    // actual box (its height depends on how many buttons config enables).
    const controlsEl = container?.querySelector('app-selection-controls') as HTMLElement | null;
    const controlsWidth = controlsEl?.offsetWidth || IIIFViewer.CONTROLS_FALLBACK_WIDTH;
    const controlsHeight = controlsEl?.offsetHeight || IIIFViewer.CONTROLS_FALLBACK_HEIGHT;

    const gap = IIIFViewer.CONTROLS_GAP;
    const margin = IIIFViewer.CONTROLS_MARGIN;

    // Preferred placement: just outside the selection's right edge.
    let left = elementRect.x + elementRect.width + gap;

    if (containerWidth > 0) {
      const overflowsRight = left + controlsWidth + margin > containerWidth;
      if (overflowsRight) {
        // Flip to the selection's left edge; if that would also clip (selection
        // is wide or hugs the left), clamp inside the viewer instead.
        const flipped = elementRect.x - gap - controlsWidth;
        left = flipped >= margin
          ? flipped
          : Math.max(margin, containerWidth - controlsWidth - margin);
      }
    }

    // Vertically the controls track the selection's top edge, clamped so they
    // never run past the bottom (or above the top) of the viewer.
    let top = elementRect.y;
    if (containerHeight > 0) {
      const maxTop = Math.max(margin, containerHeight - controlsHeight - margin);
      top = Math.min(Math.max(top, margin), maxTop);
    }

    // `update-viewport` and `animation` fire continuously. Allocating a new
    // object each time would hand the template a fresh identity on every frame
    // and re-run the bindings for the floating controls; mutate in place and
    // bail out when the position is unchanged.
    if (this.selectionRect) {
      if (this.selectionRect.top === top && this.selectionRect.left === left) return;
      this.selectionRect.top = top;
      this.selectionRect.left = left;
      return;
    }

    this.selectionRect = { top, left };
  }

  onText() {
    if (this.currentImageRect && this.imagePid && this.viewer) {
      // Get image dimensions from the viewer
      const tiledImage = this.viewer?.world.getItemAt(0);
      if (!tiledImage) {
        console.warn('No tiled image available');
        return;
      }

      const imageSize = tiledImage.getContentSize();
      const imageWidth = imageSize.x;
      const imageHeight = imageSize.y;

      console.log('Image dimensions:', { imageWidth, imageHeight });
      console.log('Selection rect (image coords):', this.currentImageRect);

      // Convert selection rect to the format expected by getTextInBox: [x1, y1, x2, y2]
      const box = [
        this.currentImageRect.x,
        this.currentImageRect.y,
        this.currentImageRect.x + this.currentImageRect.width,
        this.currentImageRect.y + this.currentImageRect.height
      ];

      console.log('Box coordinates [x1, y1, x2, y2]:', box);

      // Fetch ALTO XML and extract text
      this.altoService.fetchAltoXml(this.imagePid).subscribe({
        next: (altoXml) => {
          const altoDims = this.altoService.getAltoDimensions(altoXml);
          console.log('ALTO dimensions:', altoDims);

          const extractedText = this.altoService.getTextInBox(altoXml, box, imageWidth, imageHeight);
          console.log('Extracted text from selection:', extractedText);

          if (!extractedText) {
            console.warn('No text found in selection. This might be due to coordinate mismatch.');
            return;
          }
          this.aiPanelService.showText(extractedText, this.imagePid || undefined);
        },
        error: (error) => {
          console.error('Error fetching ALTO XML:', error);
        }
      });
    } else {
      console.warn('No selection or image PID available for text extraction');
    }
  }

  onExport() {
    // Selecting an area stays allowed under a restricted license — only taking
    // the image away is blocked. Checked here and not just on the button because
    // the Enter-key shortcut in `handleEnterPress` calls this directly.
    if (!this.detailViewService.isActionAllowed('crop')) return;

    if (this.currentImageRect && this.imagePid) {
      const rect = {
        x: this.currentImageRect.x,
        y: this.currentImageRect.y,
        width: this.currentImageRect.width,
        height: this.currentImageRect.height
      };
      this.exportService.exportJpegCrop(this.imagePid, rect);
    } else {
      console.warn('No selection or image PID available for export');
    }
  }

  @HostListener('document:keydown.enter', ['$event'])
  handleEnterPress(event: Event) {
    if (this.showSelectionControls && this.selectionRect) {
      event.preventDefault();
      this.onExport();
    }
  }

  onShare() {
    if (this.currentImageRect && this.metadata) {
      const x = Math.round(this.currentImageRect.x);
      const y = Math.round(this.currentImageRect.y);
      const w = Math.round(this.currentImageRect.width);
      const h = Math.round(this.currentImageRect.height);
      const bb = `${x},${y},${w},${h}`;

      this.recordHandlerService.openShareDialog(this.metadata, { bb });
    }
  }

  onSelectionCancel() {
    this.iiifViewerService.setSelectionMode(false);
  }

  /**
   * Check if viewer is at base zoom level (not zoomed in)
   */
  private isAtBaseZoom(): boolean {
    if (!this.viewer) return false;

    const viewport = this.viewer.viewport;
    const currentZoom = viewport.getZoom();

    const restingZoom = Math.max(viewport.getHomeZoom(), (this.viewer as any).minZoomLevel || 0);

    return currentZoom <= restingZoom * this.SWIPE_CONFIG.zoomTolerance;
  }

  private swipeListenersAttached = false;

  /**
   * Attach the page-turn swipe listeners once per container. createViewer can
   * run more than once (fallbacks), so guard against stacking duplicates.
   * Capture phase so they see each pointer before OpenSeadragon's canvas does,
   * and outside the Angular zone so drags don't run change detection per frame.
   */
  private setupSwipeListeners(): void {
    if (this.swipeListenersAttached) return;
    this.swipeListenersAttached = true;
    const container = this.viewerContainer.nativeElement;
    this.ngZone.runOutsideAngular(() => {
      container.addEventListener('pointerdown', this.onSwipePointerDown, true);
      container.addEventListener('pointermove', this.onSwipePointerMove, true);
      container.addEventListener('pointerup', this.onSwipePointerUp, true);
      container.addEventListener('pointercancel', this.onSwipePointerUp, true);
    });
  }

  private get canGoNext(): boolean {
    return this.detailViewService.currentPageIndex < this.detailViewService.totalPages - 1;
  }

  private get canGoPrevious(): boolean {
    return this.detailViewService.currentPageIndex > 0;
  }

  private onSwipePointerDown = (e: PointerEvent): void => {
    // Touch, pen and the primary mouse button: dragging the page with the
    // mouse turns it just like a finger swipe does.
    if (!this.viewer || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.swipe.activeTouches.add(e.pointerId);

    // A second finger means pinch-zoom: give the gesture back to OSD.
    if (this.swipe.activeTouches.size > 1) {
      if (this.swipe.mode === 'page') this.snapBack();
      this.swipe.mode = 'none';
      return;
    }

    if (this.swipe.animating || this.iiifViewerService.selectionModeActive) {
      this.swipe.mode = 'none';
      return;
    }

    // Zoomed in: a drag pans the image (OSD default); no page turning.
    this.swipe.mode = this.isAtBaseZoom() ? 'pending' : 'none';
    this.swipe.pointerId = e.pointerId;
    this.swipe.startX = this.swipe.lastX = e.clientX;
    this.swipe.startY = e.clientY;
    this.swipe.lastT = e.timeStamp;
    this.swipe.dx = 0;
    this.swipe.velocity = 0;
  };

  private onSwipePointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.swipe.pointerId) return;
    const { mode } = this.swipe;
    if (mode === 'none' || mode === 'blocked') return;

    const dx = e.clientX - this.swipe.startX;
    const dy = e.clientY - this.swipe.startY;

    if (mode === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < this.SWIPE_CONFIG.lockDistance) return;
      // The page fits the screen at resting zoom, so a vertical drag has
      // nothing to reveal; swallowing it keeps the page from wobbling.
      this.swipe.mode = Math.abs(dx) > Math.abs(dy) ? 'page' : 'blocked';
      if (this.swipe.mode !== 'page') return;
      this.preparePeeks();
    }

    // Exponential smoothing of the release velocity (px/ms).
    const dt = Math.max(1, e.timeStamp - this.swipe.lastT);
    const v = (e.clientX - this.swipe.lastX) / dt;
    this.swipe.velocity = this.swipe.velocity * 0.6 + v * 0.4;
    this.swipe.lastX = e.clientX;
    this.swipe.lastT = e.timeStamp;

    // Rubber band when there is no page in that direction.
    const blocked = (dx < 0 && !this.canGoNext) || (dx > 0 && !this.canGoPrevious);
    this.swipe.dx = blocked ? dx * this.SWIPE_CONFIG.edgeResistance : dx;
    this.setPageOffset(this.swipe.dx, false);
  };

  private onSwipePointerUp = (e: PointerEvent): void => {
    this.swipe.activeTouches.delete(e.pointerId);
    if (e.pointerId !== this.swipe.pointerId) return;
    const mode = this.swipe.mode;
    this.swipe.pointerId = -1;

    if (mode !== 'page') {
      // Keep the mode until OSD's drag-end has been suppressed, then release.
      setTimeout(() => { if (this.swipe.pointerId === -1) this.swipe.mode = 'none'; });
      return;
    }

    const width = this.viewerContainer.nativeElement.clientWidth || 1;
    const { dx, velocity } = this.swipe;
    const farEnough = Math.abs(dx) > width * this.SWIPE_CONFIG.commitRatio;
    const fastEnough = Math.abs(velocity) > this.SWIPE_CONFIG.commitVelocity && Math.sign(velocity) === Math.sign(dx);
    const direction: 'next' | 'previous' = dx < 0 ? 'next' : 'previous';
    const possible = direction === 'next' ? this.canGoNext : this.canGoPrevious;

    if (e.type !== 'pointercancel' && possible && (farEnough || fastEnough)) {
      this.turnPage(direction, width);
    } else {
      this.snapBack();
    }
    setTimeout(() => { if (this.swipe.pointerId === -1) this.swipe.mode = 'none'; });
  };

  private static readonly PEEK_GAP = 16; // px between the page and its neighbour while swiping

  /** Page index step of one turn (book mode shows two pages at a time). */
  private get pageStep(): number {
    return this.iiifViewerService.isBookMode() ? 2 : 1;
  }

  private neighbourPid(direction: 'next' | 'previous'): string | null {
    const pages = this.detailViewService.pages;
    const i = this.detailViewService.currentPageIndex + (direction === 'next' ? this.pageStep : -this.pageStep);
    return pages[i]?.pid ?? null;
  }

  /** Paint the neighbour thumbnails into the peek elements as a drag starts. */
  private preparePeeks(): void {
    const setup = (el: HTMLElement | undefined, pid: string | null) => {
      if (!el) return;
      el.style.backgroundImage = pid ? `url('${this.iiifViewerService.getThumbnailUrl(pid)}')` : 'none';
      el.dataset['pid'] = pid ?? '';
    };
    setup(this.peekPrev?.nativeElement, this.neighbourPid('previous'));
    setup(this.peekNext?.nativeElement, this.neighbourPid('next'));
  }

  private hidePeeks(): void {
    if (this.peekHideTimer) {
      clearTimeout(this.peekHideTimer);
      this.peekHideTimer = null;
    }
    for (const el of [this.peekPrev?.nativeElement, this.peekNext?.nativeElement]) {
      if (!el) continue;
      el.style.transition = 'none';
      el.style.visibility = 'hidden';
      el.style.transform = '';
      el.classList.remove('page-peek--cover');
    }
  }
  private peekHideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Slide the page off-screen while its neighbour slides in, then navigate.
   * The neighbour thumbnail stays on top until the new page has opened (see the
   * 'open' handler), so the swap never flashes an empty viewer.
   */
  private turnPage(direction: 'next' | 'previous', width: number): void {
    this.swipe.animating = true;
    const distance = width + IIIFViewer.PEEK_GAP;
    this.setPageOffset(direction === 'next' ? -distance : distance, true);
    setTimeout(() => {
      const peek = (direction === 'next' ? this.peekNext : this.peekPrev)?.nativeElement;
      peek?.classList.add('page-peek--cover');
      this.ngZone.run(() => {
        if (direction === 'next') {
          this.detailViewService.goToNext();
        } else {
          this.detailViewService.goToPrevious();
        }
      });
      // The page under the cover resets instantly; the cover lifts on 'open'.
      const el = this.viewerContainer?.nativeElement;
      if (el) {
        el.style.transition = 'none';
        el.style.transform = '';
      }
      this.swipe.animating = false;
      this.swipe.dx = 0;
      // Safety net if the new page never opens (error, access denied, fallback).
      this.peekHideTimer = setTimeout(() => this.hidePeeks(), 2500);
    }, this.SWIPE_CONFIG.animMs);
  }

  private snapBack(): void {
    this.swipe.animating = true;
    this.setPageOffset(0, true);
    setTimeout(() => this.finishSwipeAnimation(), this.SWIPE_CONFIG.animMs);
  }

  private finishSwipeAnimation(): void {
    this.swipe.animating = false;
    this.swipe.dx = 0;
    const el = this.viewerContainer?.nativeElement;
    if (el) {
      el.style.transition = '';
      el.style.transform = '';
    }
    this.hidePeeks();
  }

  /** Move the page and its neighbours horizontally, like a strip of pages. */
  private setPageOffset(px: number, animate: boolean): void {
    const el = this.viewerContainer?.nativeElement;
    if (!el) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const distance = (el.clientWidth || 1) + IIIFViewer.PEEK_GAP;
    const transition = animate && !reduceMotion
      ? `transform ${this.SWIPE_CONFIG.animMs}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
      : 'none';
    el.style.transition = transition;
    el.style.transform = px === 0 ? '' : `translate3d(${px}px, 0, 0)`;
    const place = (peek: HTMLElement | undefined, base: number) => {
      if (!peek || !peek.dataset['pid']) return;
      peek.style.transition = transition;
      peek.style.visibility = 'visible';
      peek.style.transform = `translate3d(${base + px}px, 0, 0)`;
    };
    place(this.peekPrev?.nativeElement, -distance);
    place(this.peekNext?.nativeElement, distance);
  }

  private prefetchedPids = new Set<string>();

  /**
   * Warm the HTTP cache for the neighbouring pages after a page opens: their
   * thumbnails (shown instantly as the swipe preview and placeholder) and their
   * IIIF info.json (the round trip that precedes every tile request).
   */
  private prefetchNeighbours(): void {
    const pages = this.detailViewService.pages;
    const idx = this.detailViewService.currentPageIndex;
    const step = this.pageStep;
    const candidates = [idx + step, idx - step, idx + 2 * step]
      .map(i => pages[i]?.pid)
      .filter((pid): pid is string => !!pid && !this.prefetchedPids.has(pid));
    if (candidates.length === 0) return;

    const authHeaders = this.iiifViewerService.getAuthHeaders();
    let headers = new HttpHeaders();
    if (authHeaders['Authorization']) {
      headers = headers.set('Authorization', authHeaders['Authorization']);
    }
    for (const pid of candidates) {
      this.prefetchedPids.add(pid);
      const img = new Image();
      img.decoding = 'async';
      img.src = this.iiifViewerService.getThumbnailUrl(pid);
      this.http.get(this.iiifViewerService.getIIIFInfoUrl(pid), {
        headers,
        context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true)
      }).subscribe({ error: () => { /* prefetch only */ } });
    }
  }


  /**
   * Set minZoomLevel so the maximum zoom-out level fits the image to the container height.
   * Called after each 'open' event when image dimensions are known.
   */
  private updateMinZoomLevel(): void {
    if (!this.viewer) return;
    const item = this.viewer.world.getItemAt(0);
    if (!item) return;

    const containerSize = this.viewer.viewport.getContainerSize();
    const imageSize = item.getContentSize();
    if (containerSize.x === 0 || containerSize.y === 0 || imageSize.x === 0 || imageSize.y === 0) return;

    // Viewport zoom where the image height exactly fills the container height.
    // OSD normalizes by image width, so: fitHeightZoom = (containerH/containerW) * (imageW/imageH)
    const fitHeightZoom = (containerSize.y / containerSize.x) * (imageSize.x / imageSize.y);
    // Never above the zoom that shows the whole page: on a portrait phone a
    // page wider than the screen's aspect (spreads, maps, wide covers) would
    // otherwise be cropped at the sides with no way to zoom out. On desktop
    // (wide container, portrait page) both values are the same, so this only
    // changes narrow viewports.
    const fitWholeZoom = this.viewer.viewport.getHomeZoom();
    (this.viewer as any).minZoomLevel = Math.min(fitHeightZoom, fitWholeZoom);
  }
}
