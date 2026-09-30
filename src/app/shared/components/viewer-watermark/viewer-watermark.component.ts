import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import OpenSeadragon from 'openseadragon';
import { ConfigService } from '../../../core/config/config.service';
import { TranslateService } from '@ngx-translate/core';
import { LicenseWatermarkConfig, LocalizedLabel } from '../../../core/config/config.interfaces';

/**
 * The page geometry the watermark lays itself out on: the scan's size in image
 * pixels, plus the projection from image pixels to viewer-element pixels.
 *
 * `drawCanvas` needs nothing else about the image, which is what lets the same
 * drawing code serve both the OpenSeadragon viewport and the thumbnail
 * placeholder shown before the tiled image exists.
 */
interface PageGeometry {
  contentSize: { x: number; y: number };
  toScreen(imageX: number, imageY: number): { x: number; y: number };
}

/**
 * Watermark drawn *onto* the scan rather than floating over the viewport.
 *
 * The overlay is the condition under which some scans may be published at all,
 * so it has to behave like part of the image: pinned to the same spot on the
 * page and growing with it as the reader zooms in. This mirrors the previous
 * client, which drew the watermark as an OpenLayers vector layer whose features
 * lived in image coordinates.
 *
 * The grid is therefore laid out in **image pixel coordinates** and converted to
 * screen coordinates on every viewport change, instead of being spread across
 * the viewer element.
 *
 * ## Why the thumbnail placeholder is also watermarked
 *
 * The tiled image only exists after `info.json` has been fetched and parsed, so
 * a watermark that waits for it is absent for a whole network round-trip —
 * while the reader is already looking at the page, because the viewer paints
 * the thumbnail as a CSS background before that request even starts. That gap
 * is exactly when an unwatermarked page is on screen, which defeats the point
 * of the overlay.
 *
 * So the component draws against the *thumbnail's* geometry until the real one
 * arrives. The thumbnail is laid out with `background-size: contain`, whose
 * rectangle is computable locally from the thumbnail's intrinsic size — the
 * same rectangle OpenSeadragon will project once it opens, so the handoff is
 * invisible rather than a jump.
 */
@Component({
  selector: 'app-viewer-watermark',
  imports: [],
  templateUrl: './viewer-watermark.component.html',
  styleUrl: './viewer-watermark.component.scss'
})
export class ViewerWatermarkComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() docLicenses: string[] = [];
  @Input() pagePid: string | null = null;

  /**
   * URL of the thumbnail the viewer paints as a background placeholder while
   * `info.json` is in flight. Supplying it lets the watermark appear on that
   * placeholder instead of waiting for the tiled image; without it the
   * watermark simply starts at `add-item` as before.
   */
  @Input() set placeholderSrc(src: string | null) {
    if (this.placeholderUrl === src) return;
    this.placeholderUrl = src;
    this.placeholderImage = null;
    this.loadPlaceholder();
  }

  /**
   * The viewer whose image this watermark is glued to. Supplied by the parent
   * once OpenSeadragon exists; without it there is no image geometry to align
   * with and nothing is drawn.
   */
  @Input() set viewer(viewer: OpenSeadragon.Viewer | null) {
    if (this.osdViewer === viewer) return;
    this.detachViewer();
    this.osdViewer = viewer;
    this.attachViewer();
    this.scheduleRender();
  }

  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private configService = inject(ConfigService);
  private translateService = inject(TranslateService);

  private osdViewer: OpenSeadragon.Viewer | null = null;
  private loadedImage: HTMLImageElement | null = null;
  private loadedImageSrc: string | null = null;
  private rafId: number | null = null;

  /**
   * The placeholder thumbnail, kept only for its intrinsic dimensions — the
   * pixels themselves are painted by the viewer's CSS background, not here.
   */
  private placeholderUrl: string | null = null;
  private placeholderImage: HTMLImageElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * Which grid cells are stamped, decided once per page.
   *
   * `probability` is rolled when the layout is built rather than on every draw:
   * the canvas now repaints on every pan and zoom frame, so rolling per draw
   * would make the watermarks flicker in and out as the reader moves.
   */
  private cellMask: boolean[] | null = null;
  private cellMaskKey: string | null = null;

  private readonly onViewportChange = () => this.render();

  /**
   * The watermark draws in image coordinates, so it needs the `TiledImage` to
   * exist before it can project anything — `drawCanvas` bails out while
   * `world` is still empty.
   *
   * `open` is not enough: it can fire before the item is in the world, and the
   * remaining handlers (`animation`, `update-viewport`) only fire once
   * OpenSeadragon starts painting tiles. That made the first draw wait for the
   * tiles, which is very visible now that each tile pays the CDK proxy's
   * per-request overhead. `add-item` fires as soon as the tile source is
   * parsed, which is the earliest the geometry is known.
   */
  private readonly onWorldItemAdded = () => this.render();

  ngAfterViewInit(): void {
    // Start fetching the logo before the viewer geometry is ready, so the first
    // draw is not delayed by the logo's own round-trip on top of it.
    this.preloadLogo();
    this.observeResize();
    this.scheduleRender();
  }

  /**
   * Keep the placeholder watermark aligned while the container changes size.
   *
   * OpenSeadragon's own `resize` handler covers this once it exists, but the
   * placeholder is drawn before that — and its rectangle is derived from the
   * container's dimensions, so a resize in that window would leave the stamp
   * off the page.
   */
  private observeResize(): void {
    const parent = this.canvasRef?.nativeElement?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(parent);
  }

  /**
   * Warm `loadedImage` so `render` can draw synchronously on its first call.
   * Without this the earliest draw still waits for the logo to arrive, which
   * would undo the point of drawing as soon as the geometry exists.
   */
  private preloadLogo(): void {
    const config = this.configService.getWatermarkConfig(this.docLicenses);
    if (!config || config.type !== 'image' || !config.logo) return;
    if (this.loadedImageSrc === config.logo) return;

    const img = new Image();
    img.onload = () => {
      this.loadedImage = img;
      this.loadedImageSrc = config.logo!;
      this.scheduleRender();
    };
    img.src = config.logo;
  }

  /**
   * Learn the placeholder's intrinsic size so its on-screen rectangle can be
   * reproduced. The viewer is already loading this exact URL as a CSS
   * background, so this resolves from the HTTP cache rather than costing a
   * second round-trip.
   */
  private loadPlaceholder(): void {
    const src = this.placeholderUrl;
    if (!src) {
      this.scheduleRender();
      return;
    }

    const img = new Image();
    img.onload = () => {
      // A later page may have swapped the URL out while this was in flight.
      if (this.placeholderUrl !== src) return;
      this.placeholderImage = img;
      this.scheduleRender();
    };
    img.src = src;
  }

  /**
   * The geometry to draw against, preferring the real image once it exists.
   *
   * OpenSeadragon wins as soon as it has a tiled image: it is the authoritative
   * projection and it tracks pan and zoom. Until then the placeholder stands in
   * so the watermark is on screen for the same frames the page is.
   */
  private resolveGeometry(): PageGeometry | null {
    const item = this.osdViewer?.world?.getItemAt(0);
    if (item) {
      const contentSize = item.getContentSize();
      if (contentSize.x > 0 && contentSize.y > 0) {
        return {
          contentSize,
          toScreen: (x, y) =>
            item.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y)),
        };
      }
    }
    return this.placeholderGeometry();
  }

  /**
   * Reproduce the rectangle `background-size: contain` gives the thumbnail:
   * scaled to fit inside the viewer element without cropping, and centred.
   *
   * Laid out in the thumbnail's own pixels, so the watermark grid divides the
   * page by the same proportions it will once the full scan opens — the two
   * share an aspect ratio, so the rectangles coincide and the handoff does not
   * move anything.
   */
  private placeholderGeometry(): PageGeometry | null {
    const img = this.placeholderImage;
    const parent = this.canvasRef?.nativeElement?.parentElement;
    if (!img || !parent) return null;

    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    if (imgW === 0 || imgH === 0 || cw === 0 || ch === 0) return null;

    const scale = Math.min(cw / imgW, ch / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const offsetX = (cw - drawW) / 2;
    const offsetY = (ch - drawH) / 2;

    return {
      contentSize: { x: imgW, y: imgH },
      toScreen: (x, y) => ({ x: offsetX + x * scale, y: offsetY + y * scale }),
    };
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['docLicenses'] || changes['pagePid']) {
      // A new page or license means a fresh roll of the probability mask.
      this.cellMask = null;
      this.cellMaskKey = null;
      // A license change can point at a different logo — fetch it up front too.
      if (changes['docLicenses']) this.preloadLogo();
      this.scheduleRender();
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachViewer();
  }

  private attachViewer(): void {
    const viewer = this.osdViewer;
    if (!viewer) return;
    // `animation` covers pan/zoom frames, `update-viewport` covers programmatic
    // moves and `resize` the container changing under a static viewport.
    viewer.addHandler('animation', this.onViewportChange);
    viewer.addHandler('update-viewport', this.onViewportChange);
    viewer.addHandler('resize', this.onViewportChange);
    viewer.addHandler('open', this.onViewportChange);
    // Draw as soon as the image geometry exists, without waiting for tiles.
    viewer.world?.addHandler('add-item', this.onWorldItemAdded);
  }

  private detachViewer(): void {
    const viewer = this.osdViewer;
    if (!viewer) return;
    viewer.removeHandler('animation', this.onViewportChange);
    viewer.removeHandler('update-viewport', this.onViewportChange);
    viewer.removeHandler('resize', this.onViewportChange);
    viewer.removeHandler('open', this.onViewportChange);
    // `world` is gone once the viewer has been destroyed, which is exactly when
    // the parent detaches us.
    viewer.world?.removeHandler('add-item', this.onWorldItemAdded);
  }

  private scheduleRender(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const config = this.configService.getWatermarkConfig(this.docLicenses);
    if (!config) {
      this.clear();
      return;
    }

    if (config.type === 'image' && config.logo) {
      if (this.loadedImage && this.loadedImageSrc === config.logo) {
        this.drawCanvas(config, this.loadedImage);
      } else {
        const img = new Image();
        img.onload = () => {
          this.loadedImage = img;
          this.loadedImageSrc = config.logo!;
          this.drawCanvas(config, img);
        };
        img.src = config.logo;
      }
    } else {
      this.drawCanvas(config, null);
    }
  }

  private clear(): void {
    const canvas = this.canvasRef?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private resolveStaticText(staticText: string | LocalizedLabel | undefined): string | null {
    if (!staticText) return null;
    if (typeof staticText === 'string') return staticText;
    const lang = this.translateService.getCurrentLang();
    return staticText[lang] ?? staticText['en'] ?? staticText[Object.keys(staticText)[0]] ?? null;
  }

  /**
   * Decide once per (page, grid, probability) which cells carry a stamp, so the
   * pattern stays put while the reader pans and zooms.
   */
  private getCellMask(rows: number, cols: number, probability: number): boolean[] {
    const key = `${this.pagePid ?? ''}|${rows}x${cols}|${probability}`;
    if (this.cellMask && this.cellMaskKey === key) return this.cellMask;

    const mask = new Array<boolean>(rows * cols);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = Math.random() * 100 <= probability;
    }
    this.cellMask = mask;
    this.cellMaskKey = key;
    return mask;
  }

  private drawCanvas(config: LicenseWatermarkConfig, img: HTMLImageElement | null): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // Either the live viewport or the thumbnail placeholder standing in for it
    // until `info.json` lands; null means there is no page on screen yet.
    const geometry = this.resolveGeometry();
    if (!geometry) return;

    // The canvas still covers the viewer element — it is only the *content* that
    // is placed in image space.
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const imageSize = geometry.contentSize;
    if (imageSize.x === 0 || imageSize.y === 0) return;

    const rows = config.rowCount ?? 3;
    const cols = config.colCount ?? 3;
    const probability = config.probability ?? 100;
    const opacity = config.opacity ?? 0.15;
    // Upright by default. The diagonal tilt suits a tiled anti-copy text watermark,
    // but a single full-page logo (e.g. mzk_public-muo) must read straight, so the
    // angle is opt-in per license rather than imposed on every watermark.
    const rotation = ((config.rotation ?? 0) * Math.PI) / 180;

    // Cell geometry in image pixels: the grid divides the page itself.
    const cellW = imageSize.x / cols;
    const cellH = imageSize.y / rows;

    // How many screen pixels one image pixel currently occupies. Everything is
    // sized in image pixels and multiplied by this, which is what makes the
    // watermark grow and shrink with the scan.
    const originScreen = geometry.toScreen(0, 0);
    const unitScreen = geometry.toScreen(imageSize.x, 0);
    const pxPerImagePx = (unitScreen.x - originScreen.x) / imageSize.x;
    if (!Number.isFinite(pxPerImagePx) || pxPerImagePx <= 0) return;

    // `scale` is the fraction of its cell's width the watermark spans:
    // 1.0 fills the cell edge to edge, 0.5 half of it. With the default 1x1
    // grid the cell is the whole page, so `scale: 1.0` spans the full page
    // width. Independent of scan resolution and of the logo's native size, so
    // the rendered size can be predicted when writing the config.
    const scale = config.scale ?? 1.0;
    const mask = this.getCellMask(rows, cols, probability);

    ctx.globalAlpha = opacity;

    // Clip to the page: the watermark belongs to the scan, so it must not spill
    // onto the grey surround when the image is zoomed out.
    const pageTopLeft = geometry.toScreen(0, 0);
    const pageBottomRight = geometry.toScreen(imageSize.x, imageSize.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      pageTopLeft.x,
      pageTopLeft.y,
      pageBottomRight.x - pageTopLeft.x,
      pageBottomRight.y - pageTopLeft.y
    );
    ctx.clip();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask[r * cols + c]) continue;

        // Cell centre in image pixels, then projected onto the screen.
        const imgCx = cellW * c + cellW / 2;
        const imgCy = cellH * r + cellH / 2;
        const screen = geometry.toScreen(imgCx, imgCy);

        // Skip cells whose watermark cannot reach the visible area — a zoomed-in
        // page keeps most of its grid off-screen and drawing it is wasted work
        // on every frame. The margin is the watermark's own half-diagonal, so a
        // rotated stamp is not culled while part of it is still on screen.
        const cellScreenW = cellW * pxPerImagePx;
        const cellScreenH = cellH * pxPerImagePx;
        const halfDiagonal = Math.hypot(cellScreenW, cellScreenH) / 2;
        if (
          screen.x < -halfDiagonal || screen.x > cssW + halfDiagonal ||
          screen.y < -halfDiagonal || screen.y > cssH + halfDiagonal
        ) {
          continue;
        }

        ctx.save();
        ctx.translate(screen.x, screen.y);
        if (rotation) ctx.rotate(-rotation);

        if (img && config.type === 'image') {
          // Target width is `scale` of the cell width, in image pixels, then
          // converted to screen pixels. Height follows the logo's aspect ratio,
          // capped so a tall logo cannot outgrow its cell.
          const ratio = img.naturalWidth / img.naturalHeight;
          let drawW = cellW * scale * pxPerImagePx;
          let drawH = drawW / ratio;
          const maxH = cellH * scale * pxPerImagePx;
          if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * ratio;
          }
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        } else {
          const text = this.resolveStaticText(config.staticText) ?? '';
          if (!text) { ctx.restore(); continue; }

          const color = config.color ?? 'rgba(0,0,0,0.5)';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Text uses the same rule: `scale` is the fraction of the cell width
          // the string spans. It is measured at a reference size and the font
          // scaled by the ratio, so the result is predictable regardless of how
          // long the text is. `fontSize` remains as a fallback for configs that
          // set it and no `scale`.
          const targetW = cellW * scale * pxPerImagePx;
          if (config.scale !== undefined || config.fontSize === undefined) {
            const REFERENCE_FONT_PX = 100;
            ctx.font = `${REFERENCE_FONT_PX}px sans-serif`;
            const measured = ctx.measureText(text).width;
            const fontPx = measured > 0
              ? (targetW / measured) * REFERENCE_FONT_PX
              : REFERENCE_FONT_PX;
            ctx.font = `${fontPx}px sans-serif`;
          } else {
            // Legacy sizing: `fontSize` is in image pixels so it still scales
            // with the scan rather than staying a fixed screen size.
            ctx.font = `${config.fontSize * pxPerImagePx}px sans-serif`;
          }

          ctx.fillText(text, 0, 0);
        }

        ctx.restore();
      }
    }

    ctx.restore();
  }
}

