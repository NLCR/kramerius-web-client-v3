import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Store } from '@ngrx/store';
import { AuthService } from './auth.service';
import { ConfigService } from '../config/config.service';
import { EnvironmentService } from '../../shared/services/environment.service';
import { LocalStorageService } from '../../shared/services/local-storage.service';
import { UserService } from '../../shared/services/user.service';
import { AuthTokens } from './auth.models';

describe('AuthService token refresh', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let storedTokens: AuthTokens;

  beforeEach(() => {
    storedTokens = {
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1,
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AuthService,
        { provide: Store, useValue: { dispatch: () => {} } },
        { provide: ConfigService, useValue: { isLoginEnabled: () => true } },
        { provide: EnvironmentService, useValue: { getApiUrl: () => 'https://api.example.org/user' } },
        {
          provide: LocalStorageService,
          useValue: {
            get: (key: string) => key === 'auth_tokens' ? storedTokens : null,
            set: (key: string, value: AuthTokens) => {
              if (key === 'auth_tokens') storedTokens = value;
            },
            remove: () => {},
          }
        },
        { provide: UserService, useValue: { loadUserData: () => Promise.resolve(), userSession: null } },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('uses the GET refresh contract exposed by the Kramerius client API', () => {
    let refreshed: AuthTokens | undefined;
    service.refreshToken().subscribe(tokens => refreshed = tokens);

    const request = httpMock.expectOne(req =>
      req.url === 'https://api.example.org/user/auth/token'
      && req.params.get('refresh_token') === 'refresh-token'
      && req.params.get('grant_type') === 'refresh_token'
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      token_type: 'Bearer',
      expires_in: 300,
    });

    expect(refreshed?.accessToken).toBe('new-access-token');
    expect(storedTokens.accessToken).toBe('new-access-token');
  });
});
