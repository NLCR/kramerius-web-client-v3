import { Component, EventEmitter, inject, Input, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { TtsVoiceEntry } from '../../../settings.model';
import { BrowserTtsService } from '../../../../../shared/services/browser-tts.service';
import { ClickOutsideDirective } from '../../../../../shared/directives/click-outside';
import { TtsVoiceOption, VoiceGroup, SAMPLE_TEXTS } from '../tts-voices.data';

@Component({
  selector: 'app-tts-voice-dropdown',
  standalone: true,
  imports: [CommonModule, ClickOutsideDirective],
  templateUrl: './tts-voice-dropdown.component.html',
  styleUrl: './tts-voice-dropdown.component.scss'
})
export class TtsVoiceDropdownComponent implements OnDestroy {
  @Input({ required: true }) entry!: TtsVoiceEntry;
  @Input({ required: true }) label!: string;
  @Output() voiceChange = new EventEmitter<TtsVoiceOption>();

  private browserTtsService = inject(BrowserTtsService);
  private translate = inject(TranslateService);

  expanded = false;
  previewingVoice: string | null = null;
  private previewUtterance: SpeechSynthesisUtterance | null = null;

  get voiceGroups(): VoiceGroup[] {
    const automatic: TtsVoiceOption = {
      name: this.translate.instant('settings.tts.automatic-device-voice'), code: '', gender: '', provider: 'browser'
    };
    const voices = this.browserTtsService.voicesForLanguage(this.entry.langCode).map(voice => ({
      name: voice.name,
      code: voice.name,
      gender: '',
      provider: 'browser' as const,
    }));
    return [{ provider: this.translate.instant('settings.tts.device'), voices: [automatic, ...voices] }];
  }

  toggle(): void {
    this.expanded = !this.expanded;
  }

  close(): void {
    this.expanded = false;
  }

  select(voice: TtsVoiceOption): void {
    this.expanded = false;
    this.voiceChange.emit(voice);
  }

  previewVoice(voice: TtsVoiceOption, event: Event): void {
    event.stopPropagation();

    if (this.previewingVoice === voice.code) {
      this.browserTtsService.cancel(this.previewUtterance);
      this.previewUtterance = null;
      this.previewingVoice = null;
      return;
    }

    this.previewingVoice = voice.code;
    const sampleText = SAMPLE_TEXTS[this.entry.langCode] || SAMPLE_TEXTS['en'];

    this.previewUtterance = this.browserTtsService.speak(sampleText, this.entry.langCode, voice.code, {
      onEnd: () => this.finishPreview(),
      onError: () => this.finishPreview(),
    });
    if (!this.previewUtterance) this.finishPreview();
  }

  ngOnDestroy(): void {
    this.browserTtsService.cancel(this.previewUtterance);
  }

  private finishPreview(): void {
    this.previewUtterance = null;
    this.previewingVoice = null;
  }
}
