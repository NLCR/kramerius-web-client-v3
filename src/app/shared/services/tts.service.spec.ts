import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TtsService } from './tts.service';
import { AltoService } from './alto.service';
import { AiApiService } from './ai-api.service';
import { DetailViewService } from '../../modules/detail-view-page/services/detail-view.service';
import { IIIFViewerService } from './iiif-viewer.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { ToastService } from './toast.service';
import { DocumentInfoService } from './document-info.service';

describe('TtsService Piper playback', () => {
  let service: TtsService;
  let detailViewStub: { pages: { pid: string }[]; goToPage: jasmine.Spy };
  let aiApiStub: {
    detectLanguage: jasmine.Spy;
    correctOcrText: jasmine.Spy;
    translate: jasmine.Spy;
    textToSpeech: jasmine.Spy;
  };
  let toastStub: { show: jasmine.Spy };
  let playSpy: jasmine.Spy;
  let pauseSpy: jasmine.Spy;

  const AUDIO = new Blob(['wav'], { type: 'audio/wav' });
  const BLOCKS = [
    { text: 'first block' },
    { text: 'second block' },
    { text: 'third block' },
    { text: 'fourth block' },
  ];

  beforeEach(() => {
    playSpy = spyOn(HTMLMediaElement.prototype, 'play').and.returnValue(Promise.resolve());
    pauseSpy = spyOn(HTMLMediaElement.prototype, 'pause');
    spyOn(URL, 'createObjectURL').and.returnValue('blob:tts-test');
    spyOn(URL, 'revokeObjectURL');

    detailViewStub = {
      pages: [{ pid: 'page-1' }, { pid: 'page-2' }],
      goToPage: jasmine.createSpy('goToPage'),
    };
    aiApiStub = {
      detectLanguage: jasmine.createSpy('detectLanguage').and.returnValue(of('cs')),
      correctOcrText: jasmine.createSpy('correctOcrText').and.callFake((text: string) => of(text)),
      translate: jasmine.createSpy('translate').and.callFake((text: string) => of(text)),
      textToSpeech: jasmine.createSpy('textToSpeech').and.returnValue(of(AUDIO)),
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

  it('detects language and requests speech from Piper', () => {
    service.startReading('page-1');

    expect(aiApiStub.detectLanguage).toHaveBeenCalledWith('first block');
    expect(aiApiStub.correctOcrText).toHaveBeenCalledWith('first block', 'cs');
    expect(aiApiStub.textToSpeech).toHaveBeenCalledWith('first block', 'cs', undefined);
    expect(playSpy).toHaveBeenCalled();
  });

  it('speaks the contextually corrected OCR returned by Qwen', () => {
    aiApiStub.correctOcrText.and.returnValue(of('zdravý zrak'));

    service.startReading('page-1');

    expect(aiApiStub.textToSpeech).toHaveBeenCalledWith('zdravý zrak', 'cs', undefined);
  });

  it('falls back to cleaned source text when contextual OCR correction fails', () => {
    aiApiStub.correctOcrText.and.returnValue(throwError(() => new Error('temporary failure')));

    service.startReading('page-1');

    expect(aiApiStub.textToSpeech).toHaveBeenCalledWith('first block', 'cs', undefined);
    expect(service.isReading()).toBe(true);
  });

  it('holds its position when WAV autoplay is blocked', fakeAsync(() => {
    playSpy.and.returnValues(
      Promise.resolve(),
      Promise.reject({ name: 'NotAllowedError' }),
    );

    service.startReading('page-1');
    tick();

    expect(service.currentBlockIndex()).toBe(0);
    expect(service.playbackBlocked()).toBe(true);
    expect(service.isPaused()).toBe(true);
    expect(detailViewStub.goToPage).not.toHaveBeenCalled();
  }));

  it('resumes the already downloaded WAV after a user gesture', fakeAsync(() => {
    playSpy.and.returnValues(
      Promise.resolve(),
      Promise.reject({ name: 'NotAllowedError' }),
      Promise.resolve(),
    );

    service.startReading('page-1');
    tick();
    service.resume();
    tick();

    expect(playSpy.calls.count()).toBe(3);
    expect(aiApiStub.textToSpeech.calls.count()).toBe(1);
    expect(service.playbackBlocked()).toBe(false);
    expect(service.isPaused()).toBe(false);
  }));

  it('stops and reports an error after three consecutive Piper failures', () => {
    aiApiStub.textToSpeech.and.returnValue(throwError(() => new Error('ai.error-unavailable')));

    service.startReading('page-1');

    expect(service.isReading()).toBe(false);
    expect(service.error()).toBe('ai.error-unavailable');
    expect(toastStub.show).toHaveBeenCalledWith('ai.error-unavailable');
    expect(detailViewStub.goToPage).not.toHaveBeenCalled();
  });

  it('pauses and resumes server audio locally without a new request', fakeAsync(() => {
    service.startReading('page-1');
    tick();
    const requestsBefore = aiApiStub.textToSpeech.calls.count();

    service.pause();
    service.resume();
    tick();

    expect(pauseSpy).toHaveBeenCalled();
    expect(aiApiStub.textToSpeech.calls.count()).toBe(requestsBefore);
  }));

  it('cancels audio playback when reading stops', () => {
    service.startReading('page-1');
    service.stop();

    expect(pauseSpy).toHaveBeenCalled();
    expect(service.isReading()).toBe(false);
  });
});
