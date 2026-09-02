import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SelectComponent } from './select.component';

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
