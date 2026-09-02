import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { catchError, finalize, shareReplay, switchMap } from 'rxjs/operators';
import { throwError, Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { AuthTokens } from './auth.models';

let refreshRequest$: Observable<AuthTokens> | null = null;

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Skip auth endpoints
  if (isAuthEndpoint(req.url)) {
    return next(req);
  }

  const token = authService.getAccessToken();

  let authReq = req;
  if (token && !authService.isTokenExpired()) {
    authReq = addTokenToRequest(req, token);
  }

  return next(authReq).pipe(
    catchError(error => {
      // A 401 received without any stored session is an ordinary unauthorized
      // response (for example a protected OCR stream), not a reason to start a
      // Keycloak refresh/logout flow.
      if (error instanceof HttpErrorResponse && error.status === 401 && token) {
        return handle401Error(req, next, authService);
      }
      return throwError(() => error);
    })
  );
};

function addTokenToRequest(req: HttpRequest<any>, token: string): HttpRequest<any> {
  return req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });
}

function isAuthEndpoint(url: string): boolean {
  return url.includes('/auth/login') || url.includes('/auth/token');
}

function handle401Error(req: HttpRequest<any>, next: HttpHandlerFn, authService: AuthService): Observable<HttpEvent<any>> {
  return getOrStartTokenRefresh(authService).pipe(
    // Deliberately keep the retried request outside the refresh catchError.
    // A Qwen/proxy failure after a successful refresh must be returned to the
    // AI panel, never mistaken for a failed Keycloak refresh and logged out.
    switchMap(tokens => next(addTokenToRequest(req, tokens.accessToken)))
  );
}

function getOrStartTokenRefresh(authService: AuthService): Observable<AuthTokens> {
  if (refreshRequest$) return refreshRequest$;

  refreshRequest$ = authService.refreshToken().pipe(
    catchError(error => {
      // Network outages and server errors are temporary and must not destroy a
      // valid browser session. Only a definitive rejection of the refresh token
      // means that the Keycloak session can no longer be recovered.
      if (isDefinitiveRefreshRejection(error)) {
        authService.logout();
      }
      return throwError(() => error);
    }),
    finalize(() => {
      refreshRequest$ = null;
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  return refreshRequest$;
}

function isDefinitiveRefreshRejection(error: unknown): boolean {
  if (error instanceof HttpErrorResponse) {
    return error.status === 400 || error.status === 401 || error.status === 403;
  }
  return error instanceof Error && error.message === 'No refresh token available';
}
