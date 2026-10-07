import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { AuthService } from './auth.service';
import { SKIP_AUTH_INTERCEPTOR } from '../services/http-context-tokens';
import { EnvironmentService } from '../../shared/services/environment.service';

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const env = inject(EnvironmentService);

  // Skip auth endpoints
  if (isAuthEndpoint(req.url) || req.context.get(SKIP_AUTH_INTERCEPTOR)) {
    return next(req);
  }

  // Only our own backend participates in the CDK session. A third-party host
  // (the AI proxy, above all) has its own authorization and its own reasons to
  // answer 401. They must not receive a CDK token or affect the CDK session.
  // Relative URLs are ours; absolute ones must match the API origin.
  if (!isOwnApi(req.url, env)) {
    return next(req);
  }

  const token = authService.getAccessToken();

  // The Kramerius client endpoint `/user/auth/token` exchanges only an OAuth
  // authorization code. It does not implement a refresh-token grant: sending a
  // refresh token there returns a 200 response containing `invalid_grant`. The
  // old interceptor mistook that response for an expired Keycloak session and
  // redirected the entire browser through `/auth/logout`, often while a long AI
  // summary was still running.
  //
  // Attach only a currently valid token and let an authorization failure reach
  // the caller. No HTTP failure is allowed to trigger a browser logout here.
  return next(token && !authService.isTokenExpired()
    ? addTokenToRequest(req, token)
    : req);
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

/**
 * Whether a request targets the backend that issued the CDK session, and so may
 * carry its token.
 *
 * A relative URL qualifies. An absolute or protocol-relative URL qualifies only
 * when its origin matches the configured API base —
 * an unparseable or unconfigured one does not, so the conservative outcome is
 * to leave the request alone rather than attach a token to an unknown host.
 */
function isOwnApi(url: string, env: EnvironmentService): boolean {
  if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
    return true;
  }

  const apiUrl = env.getApiUrl('user') || env.getApiConfigBaseUrl();
  if (!apiUrl) {
    return false;
  }

  try {
    return new URL(url, window.location.origin).origin === new URL(apiUrl, window.location.origin).origin;
  } catch {
    return false;
  }
}
