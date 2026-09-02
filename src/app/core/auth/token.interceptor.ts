import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { AuthService } from './auth.service';

export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Skip auth endpoints
  if (isAuthEndpoint(req.url)) {
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
