import { Component, computed, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ConfigService } from '../../../core/config/config.service';

interface SiteBanner {
  id: string;
  level: 'info' | 'warning';
  /** Translation key or ready text (see `translate`). */
  text: string;
  translate: boolean;
}

/**
 * Site-wide strips at the very top of the client (above the header bar).
 *
 * - Kramerius unavailable: the /ui-config API failed (5xx, network) while API
 *   config is enabled in the deployment (APP_API_CONFIG_BASE_URL).
 *
 * Each strip can be closed for the rest of the visit. The strips' height is
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

  private readonly dismissed = signal<ReadonlySet<string>>(new Set());

  readonly banners = computed<SiteBanner[]>(() => {
    const banners: SiteBanner[] = [];
    if (this.configService.apiConfigUnavailable()) {
      banners.push({ id: 'kramerius-unavailable', level: 'warning', text: 'site-banner--kramerius-unavailable', translate: true });
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
  }
}
