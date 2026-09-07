import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PlaylistToggleComponent } from './playlist-toggle.component';

describe('PlaylistToggleComponent', () => {
  let component: PlaylistToggleComponent;
  let fixture: ComponentFixture<PlaylistToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlaylistToggleComponent, TranslateModule.forRoot()]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PlaylistToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('uses the singular key for exactly one track', () => {
    component.trackCount = 1;
    expect(component.trackCountLabel).toBe('sound-records--track-count-one');
  });

  it('uses the plural key for any other count', () => {
    component.trackCount = 5;
    expect(component.trackCountLabel).toBe('sound-records--track-count');

    component.trackCount = 0;
    expect(component.trackCountLabel).toBe('sound-records--track-count');
  });

  it('reflects the pressed state through aria-pressed', () => {
    component.active = true;
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.classList).toContain('playlist-toggle--active');

    component.active = false;
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.classList).not.toContain('playlist-toggle--active');
  });

  it('emits the inverted state when clicked', () => {
    const emitted: boolean[] = [];
    component.toggled.subscribe(v => emitted.push(v));

    component.active = false;
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();

    component.active = true;
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toEqual([true, false]);
  });
});
