import { Component } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SelectComponent } from './select.component';

/**
 * The virtual option list must lay options out exactly `itemSize` apart. The
 * size used to be a fixed 36px, which only matched the default text size: with
 * the accessibility text scale the options grew taller and the list jumped.
 * The host scales the line height the way the accessibility setting does.
 */
@Component({
  standalone: true,
  imports: [SelectComponent],
  template: `
    <div style="--line-height-xs: 30px; width: 300px;">
      <app-select [options]="options" [virtualScroll]="true" [visibleItemsCount]="5"></app-select>
    </div>
  `,
})
class HostComponent {
  options = Array.from({ length: 100 }, (_, i) => `Option ${i}`);
}

describe('SelectComponent virtual list', () => {
  let fixture: ComponentFixture<HostComponent>;
  let overlayContainer: OverlayContainer;

  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
    }).compileComponents();
    overlayContainer = TestBed.inject(OverlayContainer);
    // Accessibility scaling lives on the body in the app; the dropdown is an overlay.
    overlayContainer.getContainerElement().style.setProperty('--line-height-xs', '30px');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  async function openSelect(): Promise<SelectComponent> {
    const select = fixture.debugElement.children[0].children[0].componentInstance as SelectComponent;
    select.toggle();
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await frame();
      fixture.detectChanges();
      await fixture.whenStable();
    }
    return select;
  }

  it('sizes items from the rendered line height, not a fixed 36px', async () => {
    const select = await openSelect();

    // 30px line height + 10px top and bottom padding.
    expect(select.virtualItemSize).toBe(50);
    const options = Array.from(overlayContainer.getContainerElement().querySelectorAll('.option')) as HTMLElement[];
    expect(options.length).toBeGreaterThan(1);
    expect(options[1].getBoundingClientRect().top - options[0].getBoundingClientRect().top).toBeCloseTo(50, 1);
  });

  it('keeps the viewport at the visible item count', async () => {
    const select = await openSelect();

    expect(select.getViewportHeight()).toBe('250px');
  });
});

describe('SelectComponent', () => {
  let overlayContainer: OverlayContainer;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SelectComponent, NoopAnimationsModule, TranslateModule.forRoot()]
    });
    overlayContainer = TestBed.inject(OverlayContainer);
  });

  afterEach(() => {
    overlayContainer.getContainerElement().innerHTML = '';
  });

  it('renders its options in the CDK overlay and selects an option', async () => {
    const fixture = TestBed.createComponent(SelectComponent<string>);
    fixture.componentInstance.options = ['Autor', 'Název'];
    fixture.componentInstance.value = 'Autor';
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.select-wrapper') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const options = overlayContainer.getContainerElement().querySelectorAll<HTMLElement>('.option');
    expect(options.length).toBe(2);

    options[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value).toBe('Název');
  });
});
