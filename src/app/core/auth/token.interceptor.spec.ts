import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { tokenInterceptor } from './token.interceptor';

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

  it('refreshes an expired session before requesting protected OCR text', () => {
    authService.isTokenExpired.and.returnValue(true);
    authService.refreshToken.and.returnValue(of({
      accessToken: 'refreshed-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000,
    }));

    http.get('/items/uuid:page/ocr/text').subscribe();

    const request = httpMock.expectOne('/items/uuid:page/ocr/text');
    expect(request.request.headers.get('Authorization')).toBe('Bearer refreshed-token');
    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    request.flush('OCR text');
  });

  it('does not refresh or log out for a 401 when there is no stored session', () => {
    authService.getAccessToken.and.returnValue(null);

    http.get('/protected').subscribe({ error: () => undefined });
    httpMock.expectOne('/protected').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authService.refreshToken).not.toHaveBeenCalled();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('refreshes once but does not log out when the retried AI request still fails', () => {
    authService.refreshToken.and.returnValue(of({
      accessToken: 'refreshed-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000,
    }));
    let responseError: HttpErrorResponse | undefined;

    http.post('/ai/v1/chat/completions', {}).subscribe({ error: error => responseError = error });
    httpMock.expectOne('/ai/v1/chat/completions')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    const retry = httpMock.expectOne('/ai/v1/chat/completions');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer refreshed-token');
    retry.flush({}, { status: 504, statusText: 'Gateway Timeout' });

    expect(responseError?.status).toBe(504);
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not log out after a transient refresh-server failure', () => {
    authService.refreshToken.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 503,
      statusText: 'Service Unavailable',
    })));

    http.get('/protected').subscribe({ error: () => undefined });
    httpMock.expectOne('/protected').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('logs out only when Keycloak definitively rejects the refresh token', () => {
    authService.refreshToken.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 400,
      statusText: 'Bad Request',
    })));

    http.get('/protected').subscribe({ error: () => undefined });
    httpMock.expectOne('/protected').flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).toHaveBeenCalledTimes(1);
  });
});
