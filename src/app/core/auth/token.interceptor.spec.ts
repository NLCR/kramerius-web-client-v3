import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { tokenInterceptor } from './token.interceptor';
import { SKIP_AUTH_INTERCEPTOR } from '../services/http-context-tokens';

describe('tokenInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', [
      'getAccessToken',
      'isTokenExpired',
      'refreshToken',
      'logout',
    ]);
    authService.getAccessToken.and.returnValue('current-token');
    authService.isTokenExpired.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('attaches a valid access token', () => {
    http.get('/protected').subscribe();

    const request = httpMock.expectOne('/protected');
    expect(request.request.headers.get('Authorization')).toBe('Bearer current-token');
    request.flush({ ok: true });
  });

  it('does not leak the Kramerius token to an endpoint configured without authentication', () => {
    http.post('/ai/v1/chat/completions', {}, {
      context: new HttpContext().set(SKIP_AUTH_INTERCEPTOR, true),
    }).subscribe();

    const request = httpMock.expectOne('/ai/v1/chat/completions');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ choices: [] });
  });

  it('does not call the code-exchange endpoint or log out for an expired token', () => {
    authService.isTokenExpired.and.returnValue(true);
    let responseError: HttpErrorResponse | undefined;

    http.get('/items/uuid:page/ocr/text').subscribe({ error: error => responseError = error });

    const request = httpMock.expectOne('/items/uuid:page/ocr/text');
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(responseError?.status).toBe(401);
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not refresh or log out for a 401 when there is no stored session', () => {
    authService.getAccessToken.and.returnValue(null);

    http.get('/protected').subscribe({ error: () => undefined });
    httpMock.expectOne('/protected').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not retry or log out when a long AI request ends with 401', () => {
    let responseError: HttpErrorResponse | undefined;

    http.post('/ai/v1/chat/completions', {}).subscribe({ error: error => responseError = error });
    httpMock.expectOne('/ai/v1/chat/completions')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(responseError?.status).toBe(401);
    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not log out for an AI timeout or server failure', () => {
    http.post('/ai/v1/chat/completions', {}).subscribe({ error: () => undefined });
    httpMock.expectOne('/ai/v1/chat/completions')
      .flush({}, { status: 504, statusText: 'Gateway Timeout' });

    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });
});
