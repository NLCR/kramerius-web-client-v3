import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AutocompleteComponent } from './autocomplete.component';
import { SearchHistoryService } from '../../services/search-history.service';
import { SpeechRecognitionService } from '../../services/speech-recognition.service';

describe('AutocompleteComponent voice search', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AutocompleteComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: SearchHistoryService,
          useValue: { history: signal<string[]>([]), add: () => undefined, remove: () => undefined }
        },
        {
          provide: SpeechRecognitionService,
          useValue: {
            isSupported: true,
            isListening: signal(false),
            start: () => of('hlasový dotaz'),
            stop: () => undefined
          }
        }
      ]
    });
  });

  it('submits a recognized query when auto-submit is enabled', () => {
    const fixture = TestBed.createComponent(AutocompleteComponent);
    const component = fixture.componentInstance;
    const submitted: string[] = [];
    component.submit.subscribe(value => submitted.push(value));

    component.onDictationResult('hlasový dotaz');

    expect(component.inputTerm()).toBe('hlasový dotaz');
    expect(submitted).toEqual(['hlasový dotaz']);
  });
});
