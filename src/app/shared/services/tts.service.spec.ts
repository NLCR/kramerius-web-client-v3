import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TtsService } from './tts.service';
import { AltoService } from './alto.service';
import { AiApiService } from './ai-api.service';
import { BrowserSpeechHandlers, BrowserTtsService } from './browser-tts.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { ToastService } from './toast.service';
import { DocumentInfoService } from './document-info.service';

describe('TtsService browser speech playback', () => {
  let service: TtsService;
  let detailViewStub: { pages: { pid: string }[]; goToPage: jasmine.Spy };
  let aiApiStub: { detectLanguage: jasmine.Spy; translate: jasmine.Spy };
  let browserTtsStub: {
    isSupported: jasmine.Spy;
    speak: jasmine.Spy;
    pause: jasmine.Spy;
    resume: jasmine.Spy;
    cancel: jasmine.Spy;
  };
  let latestHandlers: BrowserSpeechHandlers;
  let toastStub: { show: jasmine.Spy };

  const BLOCKS = [
    { text: 'first block' },
    { text: 'second block' },
    { text: 'third block' },
    { text: 'fourth block' },
  ];

  beforeEach(() => {
    detailViewStub = {
      pages: [{ pid: 'page-1' }, { pid: 'page-2' }],
      goToPage: jasmine.createSpy('goToPage'),
    };
    aiApiStub = {
      detectLanguage: jasmine.createSpy('detectLanguage').and.returnValue(of('cs')),
      translate: jasmine.createSpy('translate').and.callFake((text: string) => of(text)),
    };
    browserTtsStub = {
      isSupported: jasmine.createSpy('isSupported').and.returnValue(true),
      speak: jasmine.createSpy('speak').and.callFake(
        (_text: string, _language: string, _voice: string | undefined, handlers: BrowserSpeechHandlers) => {
          latestHandlers = handlers;
          return {} as SpeechSynthesisUtterance;
        }
      ),
      pause: jasmine.createSpy('pause'),
      resume: jasmine.createSpy('resume'),
      cancel: jasmine.createSpy('cancel'),
    };
    toastStub = { show: jasmine.createSpy('show') };

    TestBed.configureTestingModule({
      providers: [
        TtsService,
        { provide: AltoService, useValue: {
          fetchOcrContent: () => of({ text: 'page text', altoXml: '<alto/>' }),
          getBlocksForReading: () => BLOCKS,
        } },
        { provide: AiApiService, useValue: aiApiStub },
        { provide: BrowserTtsService, useValue: browserTtsStub },
        { provide: DetailViewService, useValue: detailViewStub },
        { provide: IIIFViewerService, useValue: {
          showTtsHighlight: () => {},
          clearTtsHighlight: () => {},
        } },
        { provide: SettingsService, useValue: { settings: null } },
        { provide: ToastService, useValue: toastStub },
        { provide: DocumentInfoService, useValue: { hasAlto: () => true } },
      ],
    });
    service = TestBed.inject(TtsService);
  });

  afterEach(() => service.stop());

  it('detects language through AI and speaks the OCR block locally', () => {
    service.startReading('page-1');

    expect(aiApiStub.detectLanguage).toHaveBeenCalledWith('first block');
    expect(browserTtsStub.speak).toHaveBeenCalledWith(
      'first block', 'cs', undefined, jasmine.any(Object)
    );
  });

  it('holds its position when browser speech is blocked', () => {
    service.startReading('page-1');
    latestHandlers.onError?.('not-allowed');

    expect(service.currentBlockIndex()).toBe(0);
    expect(service.playbackBlocked()).toBe(true);
    expect(service.isPaused()).toBe(true);
    expect(detailViewStub.goToPage).not.toHaveBeenCalled();
  });

  it('retries the current block after a user resumes blocked speech', () => {
    service.startReading('page-1');
    latestHandlers.onError?.('not-allowed');
    const callsBefore = browserTtsStub.speak.calls.count();

    service.resume();

    expect(browserTtsStub.speak.calls.count()).toBe(callsBefore + 1);
    expect(service.currentBlockIndex()).toBe(0);
  });

  it('stops after three consecutive browser speech failures', () => {
    service.startReading('page-1');
    latestHandlers.onError?.('synthesis-failed');
    latestHandlers.onError?.('synthesis-failed');
    latestHandlers.onError?.('synthesis-failed');

    expect(service.isReading()).toBe(false);
    expect(detailViewStub.goToPage).not.toHaveBeenCalled();
  });

  it('delegates pause and resume to browser speech', () => {
    service.startReading('page-1');
    service.pause();
    service.resume();

    expect(browserTtsStub.pause).toHaveBeenCalled();
    expect(browserTtsStub.resume).toHaveBeenCalled();
  });

  it('cancels local speech when reading stops', () => {
    service.startReading('page-1');
    service.stop();

    expect(browserTtsStub.cancel).toHaveBeenCalled();
    expect(service.isReading()).toBe(false);
  });

  it('reports when local speech synthesis is unavailable', () => {
    browserTtsStub.isSupported.and.returnValue(false);

    service.startReading('page-1');

    expect(service.isReading()).toBe(false);
    expect(service.error()).toBe('ai.error-unavailable');
    expect(toastStub.show).toHaveBeenCalledWith('ai.error-unavailable');
  });
});
