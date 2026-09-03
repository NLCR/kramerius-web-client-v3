import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { AiContentToolbarComponent } from './ai-content-toolbar.component';
import { AiPanelService } from '../../../services/ai-panel.service';
import { TtsService } from '../../../services/tts.service';
import { DetailViewService } from '../../../../modules/detail-view-page/services/detail-view.service';

/**
 * The "copy to clipboard" button writes the panel text out directly, so it
 * sidesteps the `appNoTextCopy` protection on the panel body (user-select plus
 * the cancelled copy/cut events). Under `text: false` (DNNTO) it must not be
 * offered, or one click hands over exactly what those blocks prevent.
 */
describe('AiContentToolbarComponent copy gating', () => {
  function setup(textAllowed: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AiContentToolbarComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AiPanelService,
          useValue: {
            contentType: signal('text'),
            content: signal('page text'),
            showOriginal: signal(false),
            targetLanguage: signal('cs'),
            summaryLanguage: signal('cs'),
          },
        },
        {
          provide: TtsService,
          useValue: { isReading: signal(false), isPaused: signal(false), playbackBlocked: signal(false) },
        },
        { provide: DetailViewService, useValue: { isActionAllowed: () => textAllowed } },
      ],
    });

    const fixture = TestBed.createComponent(AiContentToolbarComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('offers the copy button when the license permits the text', () => {
    const fixture = setup(true);
    expect(fixture.componentInstance.canCopyContent).toBe(true);
    expect(fixture.nativeElement.querySelector('.icon-copy')).not.toBeNull();
  });

  it('hides the copy button when the license forbids taking the text', () => {
    const fixture = setup(false);
    expect(fixture.componentInstance.canCopyContent).toBe(false);
    expect(fixture.nativeElement.querySelector('.icon-copy')).toBeNull();
  });

  // Spies on the actual clipboard write (copyTextToClipboard is a plain module
  // export, so it is not patchable — and execCommand is what really matters).
  it('does not write to the clipboard even if copyContent is called directly', () => {
    // Hiding the button does not close the code path — the handler is the guard.
    const spy = spyOn(document, 'execCommand');
    const fixture = setup(false);

    fixture.componentInstance.copyContent();

    expect(spy).not.toHaveBeenCalled();
  });

  it('still copies when allowed', () => {
    const spy = spyOn(document, 'execCommand');
    const fixture = setup(true);

    fixture.componentInstance.copyContent();

    expect(spy).toHaveBeenCalledWith('copy');
  });
});
