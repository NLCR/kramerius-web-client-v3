import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { DetailViewBottomToolbarComponent } from './detail-view-bottom-toolbar.component';
import { IIIFViewerService } from '../../../../shared/services/iiif-viewer.service';

/**
 * The real IIIFViewerService pulls in auth, environment and HTTP; this toolbar
 * only forwards button presses to it, so a spy object is all it needs. The
 * ViewerControls child (with its own large dependency graph) is rendered as an
 * unknown element.
 */
describe('DetailViewBottomToolbarComponent', () => {
  let component: DetailViewBottomToolbarComponent;
  let fixture: ComponentFixture<DetailViewBottomToolbarComponent>;
  let viewer: jasmine.SpyObj<IIIFViewerService>;

  beforeEach(async () => {
    viewer = jasmine.createSpyObj<IIIFViewerService>('IIIFViewerService', [
      'zoomIn', 'zoomOut', 'toggleRotation', 'toggleFullscreen', 'fitToScreen', 'fitToWidth', 'resetView',
    ]);

    await TestBed.configureTestingModule({
      imports: [DetailViewBottomToolbarComponent],
      providers: [{ provide: IIIFViewerService, useValue: viewer }],
    })
    .overrideComponent(DetailViewBottomToolbarComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    })
    .compileComponents();

    fixture = TestBed.createComponent(DetailViewBottomToolbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('forwards every control to the viewer service', () => {
    component.onZoomIn();
    component.onZoomOut();
    component.onRotate();
    component.onFullscreen();
    component.onFitToScreen();
    component.onFitToWidth();
    component.onResetView();

    expect(viewer.zoomIn).toHaveBeenCalledTimes(1);
    expect(viewer.zoomOut).toHaveBeenCalledTimes(1);
    expect(viewer.toggleRotation).toHaveBeenCalledTimes(1);
    expect(viewer.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(viewer.fitToScreen).toHaveBeenCalledTimes(1);
    expect(viewer.fitToWidth).toHaveBeenCalledTimes(1);
    expect(viewer.resetView).toHaveBeenCalledTimes(1);
  });
});
