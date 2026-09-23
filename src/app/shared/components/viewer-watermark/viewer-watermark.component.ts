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
    this.scheduleRender();
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
    const viewer = this.osdViewer;
    if (!canvas || !viewer) return;

    const parent = canvas.parentElement;
    if (!parent) return;

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

    const item = viewer.world.getItemAt(0);
    if (!item) return;

    const imageSize = item.getContentSize();
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
    const originScreen = item.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
    const unitScreen = item.imageToViewerElementCoordinates(new OpenSeadragon.Point(imageSize.x, 0));
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
    const pageTopLeft = item.imageToViewerElementCoordinates(new OpenSeadragon.Point(0, 0));
    const pageBottomRight = item.imageToViewerElementCoordinates(
      new OpenSeadragon.Point(imageSize.x, imageSize.y)
    );
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
        const screen = item.imageToViewerElementCoordinates(new OpenSeadragon.Point(imgCx, imgCy));

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

