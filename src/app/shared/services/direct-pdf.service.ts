import { HttpBackend, HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { ConfigService } from '../../core/config';
import { SKIP_ERROR_INTERCEPTOR } from '../../core/services/http-context-tokens';

interface PdfServerResponse {
  pdf?: boolean | string;
  size?: number | string;
}

export interface DirectPdfAvailability {
  /** Size in MB, as supplied by the configured PDF server. */
  sizeMb: string;
  downloadUrl: string;
}

@Injectable({ providedIn: 'root' })
export class DirectPdfService {
  // The PDF server is public. Bypass the application's bearer-token interceptor:
  // adding Authorization would turn this cross-origin GET into a failing preflight.
  private http = new HttpClient(inject(HttpBackend));
  private configService = inject(ConfigService);

  checkAvailability(pid: string): Observable<DirectPdfAvailability | null> {
    const statusUrl = this.buildUrl(pid, false);
    const downloadUrl = this.buildUrl(pid, true);
    if (!statusUrl || !downloadUrl) return of(null);

    return this.http.get<PdfServerResponse>(statusUrl, {
      context: new HttpContext().set(SKIP_ERROR_INTERCEPTOR, true),
    }).pipe(
      map(response => {
        const available = response?.pdf === true || response?.pdf === 'true';
        const size = String(response?.size ?? '').trim();
        return available && size
          ? { sizeMb: size, downloadUrl }
          : null;
      }),
      catchError(() => of(null)),
    );
  }

  private buildUrl(pid: string, download: boolean): string | null {
    const configuredUrl = this.configService.getConfig().api.pdfServer?.trim();
    if (!configuredUrl || !pid) return null;

    try {
      const url = new URL(configuredUrl);
      // The deployed service lives under /pdf/. Without the trailing slash,
      // nginx serves the web client instead of the JSON/PDF endpoint.
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      url.searchParams.set('uuid', pid);
      if (download) url.searchParams.set('pdf', 'true');
      return url.toString();
    } catch {
      return null;
    }
  }
}
