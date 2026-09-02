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

  it('does not misuse the authorization-code endpoint for token refresh', () => {
    let caught: Error | undefined;
    service.refreshToken().subscribe({ error: error => caught = error });

    httpMock.expectNone('https://api.example.org/user/auth/token');
    expect(caught?.message).toContain('not supported');
    expect(storedTokens.accessToken).toBe('expired-access-token');
  });
});
