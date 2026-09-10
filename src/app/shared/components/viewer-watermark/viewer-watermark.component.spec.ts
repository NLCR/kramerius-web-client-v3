/**
 * Tests for the watermark's geometry — the part a configurator has to be able to
 * predict from the config alone.
 *
 * Two defects motivated these:
 *
 *   1. The watermark was drawn across the *viewer element* and repainted only on
 *      input changes, so it floated over the scan: the image panned and zoomed
 *      independently underneath it. The overlay is a licensing condition, so it
 *      has to travel with the page it protects.
 *   2. `scale` had no predictable meaning. The previous client sized watermarks
 *      as `scale * imageHeight / 2000 / zoom`, so the same config rendered at
 *      different sizes depending on the scan's resolution and the logo file's
 *      pixel dimensions. `scale` is now the fraction of the grid cell's width
 *      the watermark spans, independent of both.
 */

// Marks this file as a module: spec files share one global scope in the Karma
// bundle, so top-level declarations here would otherwise collide with
// same-named ones in other specs.
export {};

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { ViewerWatermarkComponent } from './viewer-watermark.component';
import { ConfigService } from '../../../core/config/config.service';
import { LicenseWatermarkConfig } from '../../../core/config/config.interfaces';

/** Page geometry the fake viewer reports, in image pixels. */
const IMAGE_W = 1000;
const IMAGE_H = 1500;

/** Viewer element size in CSS pixels. */
const VIEWER_W = 800;
const VIEWER_H = 600;

interface DrawnImage {
  x: number; y: number; w: number; h: number;
}

/**
 * Minimal OpenSeadragon stand-in. `pxPerImagePx` is the zoom: how many screen
 * pixels one image pixel occupies, which is exactly what the real viewport
 * conversion collapses to for an axis-aligned image.
 */
function fakeViewer(pxPerImagePx: number, originX = 0, originY = 0) {
  const item = {
    getContentSize: () => ({ x: IMAGE_W, y: IMAGE_H }),
    imageToViewerElementCoordinates: (p: { x: number; y: number }) => ({
      x: originX + p.x * pxPerImagePx,
      y: originY + p.y * pxPerImagePx,
    }),
  };
  return {
    world: { getItemAt: (i: number) => (i === 0 ? item : null) },
    addHandler: () => {},
    removeHandler: () => {},
  } as any;
}

/** Records what was drawn so the geometry can be asserted. */
function spyContext() {
  const drawnImages: DrawnImage[] = [];
  const fills: { text: string; font: string }[] = [];
  const clips: DrawnImage[] = [];
  let font = '';
  // The canvas transform is a translate stack; tracking it lets the recorded
  // draw positions be expressed in viewer-element coordinates.
  let tx = 0, ty = 0;
  const stack: { tx: number; ty: number }[] = [];

  const ctx = {
    setTransform: () => { tx = 0; ty = 0; },
    clearRect: () => {},
    save: () => { stack.push({ tx, ty }); },
    restore: () => { const s = stack.pop(); if (s) { tx = s.tx; ty = s.ty; } },
    translate: (x: number, y: number) => { tx += x; ty += y; },
    rotate: () => {},
    beginPath: () => {},
    rect: (x: number, y: number, w: number, h: number) => clips.push({ x, y, w, h }),
    clip: () => {},
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) =>
      drawnImages.push({ x: tx + x, y: ty + y, w, h }),
    measureText: (t: string) => ({ width: t.length * 50 }), // 50px/char at the reference size
    fillText: (text: string) => fills.push({ text, font }),
    set font(v: string) { font = v; },
    get font() { return font; },
    globalAlpha: 1,
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
  };
  return { ctx, drawnImages, fills, clips };
}

describe('ViewerWatermarkComponent geometry', () => {
  let fixture: ComponentFixture<ViewerWatermarkComponent>;
  let component: ViewerWatermarkComponent;
  let watermarkConfig: LicenseWatermarkConfig | null;
  let recorder: ReturnType<typeof spyContext>;

  /** A square logo, so aspect-ratio effects don't muddy width assertions. */
  const squareLogo = { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement;

  beforeEach(() => {
    watermarkConfig = null;
    TestBed.configureTestingModule({
      imports: [ViewerWatermarkComponent],
      providers: [
        { provide: ConfigService, useValue: { getWatermarkConfig: () => watermarkConfig } },
        { provide: TranslateService, useValue: { getCurrentLang: () => 'cs' } },
      ],
    });
    fixture = TestBed.createComponent(ViewerWatermarkComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    recorder = spyContext();
    const canvas = component.canvasRef.nativeElement;
    spyOn(canvas, 'getContext').and.returnValue(recorder.ctx as unknown as CanvasRenderingContext2D);
    // jsdom/Karma gives the detached host no layout, so the element the canvas
    // sizes itself from has to report a size explicitly.
    const parent = canvas.parentElement!;
    spyOnProperty(parent, 'clientWidth').and.returnValue(VIEWER_W);
    spyOnProperty(parent, 'clientHeight').and.returnValue(VIEWER_H);
  });

  /** Draw synchronously, bypassing the rAF the public inputs schedule. */
  function draw(config: LicenseWatermarkConfig, pxPerImagePx: number, origin = { x: 0, y: 0 }) {
    watermarkConfig = config;
    (component as any).osdViewer = fakeViewer(pxPerImagePx, origin.x, origin.y);
    (component as any).drawCanvas(config, config.type === 'image' ? squareLogo : null);
  }

  describe('scale is the fraction of the cell width', () => {
    it('spans the full page width at scale 1.0 on a 1x1 grid', () => {
      draw({ type: 'image', logo: 'l.png', rowCount: 1, colCount: 1, scale: 1.0 }, 1);
      // Cell is the whole page, so the logo spans all 1000 image px.
      expect(recorder.drawnImages.length).toBe(1);
      expect(recorder.drawnImages[0].w).toBeCloseTo(IMAGE_W, 5);
    });

    it('spans half the page width at scale 0.5 on a 1x1 grid', () => {
      draw({ type: 'image', logo: 'l.png', rowCount: 1, colCount: 1, scale: 0.5 }, 1);
      expect(recorder.drawnImages[0].w).toBeCloseTo(IMAGE_W / 2, 5);
    });

    it('spans one third of the page per cell at scale 1.0 on a 3x3 grid', () => {
      // Zoomed out far enough that the whole page is on screen, so every cell
      // is drawn and the assertion is about size rather than culling.
      const zoom = 0.25;
      draw({ type: 'image', logo: 'l.png', rowCount: 3, colCount: 3, scale: 1.0 }, zoom);
      expect(recorder.drawnImages.length).toBe(9);
      for (const d of recorder.drawnImages) {
        expect(d.w).toBeCloseTo((IMAGE_W / 3) * zoom, 5);
      }
    });

    it('defaults to the full cell width when scale is omitted', () => {
      draw({ type: 'image', logo: 'l.png', rowCount: 1, colCount: 1 }, 1);
      expect(recorder.drawnImages[0].w).toBeCloseTo(IMAGE_W, 5);
    });
  });

  it('is independent of the logo file\'s pixel dimensions', () => {
    // The old sizing multiplied by the logo's natural size, so a larger file
    // rendered a larger watermark from an identical config.
    const config: LicenseWatermarkConfig =
      { type: 'image', logo: 'l.png', rowCount: 1, colCount: 1, scale: 0.5 };

    watermarkConfig = config;
    (component as any).osdViewer = fakeViewer(1);
    (component as any).drawCanvas(config, { naturalWidth: 40, naturalHeight: 40 } as HTMLImageElement);
    const small = recorder.drawnImages.pop()!.w;

    (component as any).drawCanvas(config, { naturalWidth: 4000, naturalHeight: 4000 } as HTMLImageElement);
    const large = recorder.drawnImages.pop()!.w;

    expect(small).toBeCloseTo(large, 5);
  });

  it('grows with the scan as the reader zooms in', () => {
    const config: LicenseWatermarkConfig =
      { type: 'image', logo: 'l.png', rowCount: 1, colCount: 1, scale: 1.0 };

    draw(config, 1);
    const atZoom1 = recorder.drawnImages.pop()!.w;

    draw(config, 3);
    const atZoom3 = recorder.drawnImages.pop()!.w;

    // Three times the screen pixels per image pixel means three times the size:
    // the watermark is pinned to the page, not to the window.
    expect(atZoom3).toBeCloseTo(atZoom1 * 3, 5);
  });

  it('keeps its place on the page when the image is panned', () => {
    const config: LicenseWatermarkConfig =
      { type: 'image', logo: 'l.png', rowCount: 1, colCount: 1, scale: 0.5 };

    draw(config, 1, { x: 0, y: 0 });
    const before = recorder.drawnImages.pop()!;

    draw(config, 1, { x: 120, y: -40 });
    const after = recorder.drawnImages.pop()!;

    expect(after.x - before.x).toBeCloseTo(120, 5);
    expect(after.y - before.y).toBeCloseTo(-40, 5);
  });

  it('clips drawing to the page so the grey surround stays clean', () => {
    draw({ type: 'image', logo: 'l.png', rowCount: 1, colCount: 1 }, 0.2, { x: 50, y: 30 });
    expect(recorder.clips.length).toBe(1);
    expect(recorder.clips[0]).toEqual({
      x: 50, y: 30, w: IMAGE_W * 0.2, h: IMAGE_H * 0.2,
    });
  });

  it('skips cells that cannot reach the visible area', () => {
    // Zoomed in far enough that only part of the grid is on screen. Drawing the
    // whole grid every frame is the cost this avoids.
    draw({ type: 'image', logo: 'l.png', rowCount: 10, colCount: 10, scale: 1.0 }, 4);
    expect(recorder.drawnImages.length).toBeGreaterThan(0);
    expect(recorder.drawnImages.length).toBeLessThan(100);
  });

  it('caps a tall logo at the cell height rather than letting it overflow', () => {
    const tall = { naturalWidth: 100, naturalHeight: 400 } as HTMLImageElement;
    const config: LicenseWatermarkConfig =
      { type: 'image', logo: 'l.png', rowCount: 3, colCount: 1, scale: 1.0 };
    watermarkConfig = config;
    (component as any).osdViewer = fakeViewer(1);
    (component as any).drawCanvas(config, tall);

    const cellH = IMAGE_H / 3;
    for (const d of recorder.drawnImages) {
      expect(d.h).toBeLessThanOrEqual(cellH + 1e-6);
      expect(d.w).toBeLessThanOrEqual(IMAGE_W + 1e-6);
    }
  });

  describe('text sizing', () => {
    it('sizes the font so the string spans scale of the cell width', () => {
      draw({ type: 'text', staticText: 'abcd', rowCount: 1, colCount: 1, scale: 0.5 }, 1);
      // measureText reports 50px/char at the 100px reference size, so "abcd"
      // is 200px there; the target is 500 image px, i.e. 2.5x => 250px font.
      expect(recorder.fills.length).toBe(1);
      expect(recorder.fills[0].font).toBe('250px sans-serif');
    });

    it('sets a longer string smaller so it occupies the same width', () => {
      draw({ type: 'text', staticText: 'ab', rowCount: 1, colCount: 1, scale: 1.0 }, 1);
      const shortFont = parseFloat(recorder.fills.pop()!.font);

      draw({ type: 'text', staticText: 'abcdefgh', rowCount: 1, colCount: 1, scale: 1.0 }, 1);
      const longFont = parseFloat(recorder.fills.pop()!.font);

      expect(longFont).toBeLessThan(shortFont);
      // Four times the characters at the same target width => a quarter the size.
      expect(longFont).toBeCloseTo(shortFont / 4, 5);
    });

    it('falls back to fontSize in image pixels when no scale is given', () => {
      draw({ type: 'text', staticText: 'abc', rowCount: 1, colCount: 1, fontSize: 20 }, 2);
      // Legacy path: fontSize is in image px, so it still scales with the scan.
      expect(recorder.fills.pop()!.font).toBe('40px sans-serif');
    });
  });

  describe('probability mask', () => {
    it('keeps the same cells stamped across repaints so they do not flicker', () => {
      // The roll used to happen per draw, which made watermarks jump between
      // cells on every pan and zoom frame once the canvas repainted live.
      const config: LicenseWatermarkConfig =
        { type: 'image', logo: 'l.png', rowCount: 4, colCount: 4, probability: 50 };
      component.pagePid = 'uuid:page-1';

      // Alternate the roll so exactly half the cells are stamped, rather than
      // leaving the count to chance.
      let n = 0;
      spyOn(Math, 'random').and.callFake(() => (n++ % 2 === 0 ? 0.1 : 0.9));

      // Both draws are zoomed out enough to keep the whole grid on screen, so
      // any difference in count comes from the mask, not from culling.
      draw(config, 0.25);
      const first = recorder.drawnImages.length;
      recorder.drawnImages.length = 0;

      draw(config, 0.3);
      const second = recorder.drawnImages.length;

      expect(first).toBe(second);
      // A roll that happened to return every cell (or none) would make the
      // assertion above vacuous, so pin the mask to a partial selection.
      expect(first).toBe(8);
    });

    it('stamps every cell at probability 100', () => {
      draw({ type: 'image', logo: 'l.png', rowCount: 2, colCount: 5, probability: 100 }, 0.25);
      expect(recorder.drawnImages.length).toBe(10);
    });

    it('stamps no cell at probability 0', () => {
      draw({ type: 'image', logo: 'l.png', rowCount: 2, colCount: 5, probability: 0 }, 1);
      expect(recorder.drawnImages.length).toBe(0);
    });
  });

  it('draws nothing when no license carries a watermark', () => {
    watermarkConfig = null;
    (component as any).osdViewer = fakeViewer(1);
    (component as any).render();
    expect(recorder.drawnImages.length).toBe(0);
  });

  it('draws nothing before a viewer is available', () => {
    // Without a viewer there is no image geometry to align with, and drawing
    // anyway is what produced the floating overlay.
    (component as any).osdViewer = null;
    (component as any).drawCanvas({ type: 'image', logo: 'l.png' }, squareLogo);
    expect(recorder.drawnImages.length).toBe(0);
  });
});
