// Project-local declarations for the vendored @allmaps/viewer-lite build.
// They intentionally avoid type-only dependencies from the upstream monorepo.

export interface GeoreferencedMap {
  id: string;
  [key: string]: unknown;
}

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ViewportState {
  bounds: ViewportBounds;
  center: { lon: number; lat: number };
  zoom: number;
}

export interface OutlineStyle {
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
}

export type OutlineMode = 'mask' | 'bbox';
export type OutlineFillMode = 'fill' | 'none';

export interface BasemapXYZ {
  type: 'xyz';
  url: string;
  attribution?: string;
  maxZoom?: number;
}

export type BasemapPreset = 'osm' | 'esri-world-topo' | 'esri-world-street' | 'esri-world-imagery';
export type BasemapInput = BasemapPreset | BasemapXYZ | false;

export interface ViewerOptions {
  maps?: GeoreferencedMap[];
  basemap?: BasemapInput;
  fitOnInit?: boolean;
  outlineStyle?: OutlineStyle;
  preview?: { mode?: OutlineMode };
}

export interface AllmapsViewer {
  // Map data
  setMaps(maps: GeoreferencedMap[]): Promise<void>;
  addMaps(maps: GeoreferencedMap[]): Promise<void>;
  clearMaps(): Promise<void>;
  removeMap(mapId: string): Promise<void>;
  getMapIds(): string[];
  getMaps(): GeoreferencedMap[];

  // Visibility
  setMapVisibility(mapId: string, visible: boolean): void;

  // Z-order
  bringMapsToFront(mapIds: Iterable<string>): void;
  bringMapsForward(mapIds: Iterable<string>): void;
  sendMapsBackward(mapIds: Iterable<string>): void;
  sendMapsToBack(mapIds: Iterable<string>): void;

  // Navigation
  fitToMaps(): void;
  fitToMap(mapId: string): void;
  resize(): void;
  getViewportBounds(projection?: string): ViewportBounds;
  getViewportState(projection?: string): ViewportState;

  // Basemap
  getBasemapPresets(): Array<{ value: string; label: string; type: 'xyz'; url: string; attribution?: string; maxZoom?: number }>;
  getBasemap(): BasemapXYZ | false;
  setBasemap(basemap: BasemapInput): void;
  setBasemapVisible(visible: boolean): void;

  // Render
  setOpacity(value: number): void;
  setEnhanceLines(value: number): void;

  // Outlines
  setOutlinedMapIds(mapIds: Iterable<string>): void;
  getOutlinedMapIds(): string[];
  setOutlinesVisible(visible: boolean): void;
  getOutlinesVisible(): boolean;
  setOutlineFillMode(mode: OutlineFillMode): void;
  getOutlineFillMode(): OutlineFillMode;
  setPreviewMode(mode: OutlineMode): void;
  getPreviewMode(): OutlineMode;
  showPreviewByMapId(mapId: string): void;
  hidePreviewByMapId(mapId: string): void;
  togglePreviewByMapId(mapId: string): boolean;
  syncPreviewsForMapIds(mapIds: Iterable<string>): void;
  showPreviewGeometry(preview: unknown): void;
  hidePreview(): void;
  setOutlineStyle(style: OutlineStyle): void;
  getOutlineStyle(): OutlineStyle;

  // Events
  on(eventName: 'ready', handler: () => void): void;
  on(eventName: 'mapclick', handler: (event: CustomEvent<{ mapId: string }>) => void): void;
  on(eventName: 'maphover', handler: (event: CustomEvent<{ mapId: string }>) => void): void;
  on(eventName: 'viewportchange', handler: (event: CustomEvent<ViewportState>) => void): void;
  on(eventName: string, handler: (event: CustomEvent) => void): void;

  // Internal OpenLayers map (used for programmatic pan/zoom)
  map: {
    getView(): {
      fit(extent: [number, number, number, number], options?: { size?: number[]; padding?: number[] }): void;
      setCenter(center: [number, number]): void;
      setZoom(zoom: number): void;
      getZoom(): number | undefined;
      animate(options: { zoom?: number; center?: [number, number]; duration?: number }): void;
    };
    getSize(): number[];
  };

  // Lifecycle
  destroy(): void;

  // WebGL layer (background removal)
  warpedMapLayer?: {
    setLayerOptions?(options: {
      removeColor?: boolean;
      removeColorColor?: string;
      removeColorThreshold?: number;
      removeColorHardness?: number;
      removeColorInvert?: boolean;
    }): void;
  };
}

export declare function createAllmapsViewer(container: HTMLElement, options: ViewerOptions): AllmapsViewer;
export declare function parseAnnotation(annotation: unknown): GeoreferencedMap[];
