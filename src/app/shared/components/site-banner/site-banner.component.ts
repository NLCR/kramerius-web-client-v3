import { Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ConfigService } from '../../../core/config/config.service';
import { AppTranslationService } from '../../translation/app-translation.service';

interface SiteBanner {
  id: string;
  level: 'info' | 'warning';
  /** Translation key or ready text (see `translate`). */
  text: string;
  translate: boolean;
  dismissible: boolean;
}

/**
 * Site-wide strips at the very top of the client (above the header bar).
 *
 * - Kramerius unavailable: the /ui-config API failed (5xx, network) while API
 *   config is enabled in the deployment (APP_API_CONFIG_BASE_URL).
 * - Notice: the `notice` text from config-main (e.g. a planned outage).
 *
 * The warning can be closed for the rest of the visit; a closed notice stays
 * closed (localStorage) until its text changes. The strips' height is
 * published as --site-banner-height and counted into --header-height, so
 * every "100dvh - header" layout below stays exact.
 */
@Component({
  selector: 'app-site-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './site-banner.component.html',
  styleUrl: './site-banner.component.scss',
})
export class SiteBannerComponent {
  private configService = inject(ConfigService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private translation = inject(AppTranslationService);

  private static readonly NOTICE_STORAGE_KEY = 'site-notice-dismissed';

  private readonly dismissed = signal<ReadonlySet<string>>(new Set(
    [SiteBannerComponent.readDismissedNotice()].filter((id): id is string => !!id)
  ));

  readonly banners = computed<SiteBanner[]>(() => {
    const banners: SiteBanner[] = [];
    if (this.configService.apiConfigUnavailable()) {
      banners.push({ id: 'kramerius-unavailable', level: 'warning', text: 'site-banner--kramerius-unavailable', translate: true, dismissible: true });
    }
    const notice = this.configService.notice;
    if (notice) {
      const lang = this.translation.currentLanguage().code;
      const text = this.configService.resolveLabel(notice.text, lang);
      if (text) {
        banners.push({
          // Keyed by its full text, so editing the notice shows it again.
          id: 'notice:' + JSON.stringify(notice.text),
          level: notice.level === 'warning' ? 'warning' : 'info',
          text,
          translate: false,
          dismissible: notice.dismissible !== false,
        });
      }
    }
    return banners.filter(b => !this.dismissed().has(b.id));
  });

  constructor() {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--site-banner-height', `${this.host.nativeElement.offsetHeight}px`);
    });
    observer.observe(this.host.nativeElement);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      root.style.removeProperty('--site-banner-height');
    });
  }

  dismiss(banner: SiteBanner): void {
    this.dismissed.update(ids => new Set(ids).add(banner.id));
    if (banner.id.startsWith('notice:')) {
      try {
        localStorage.setItem(SiteBannerComponent.NOTICE_STORAGE_KEY, banner.id);
      } catch {
        // Storage unavailable: the notice stays closed for this visit only.
      }
    }
  }

  private static readDismissedNotice(): string | null {
    try {
      return localStorage.getItem(SiteBannerComponent.NOTICE_STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
