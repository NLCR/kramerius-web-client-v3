import { EnvironmentService } from '../../shared/services/environment.service';
import { ConfigService } from '../config/config.service';
import { UserService } from '../../shared/services/user.service';
import { initLicenseConfig } from '../solr/solr-misc';
import { SolrQueryBuilder } from '../solr/solr-query-builder';

/** Uses the configured application logo as the browser-tab icon. */
export function updateFaviconFromLogo(logo: string | undefined, targetDocument?: Document): void {
  if (!logo) return;

  const doc = targetDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
  }

  link.setAttribute('href', logo);
  const path = logo.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith('.ico')) {
    link.type = 'image/x-icon';
  } else if (path.endsWith('.svg')) {
    link.type = 'image/svg+xml';
  } else if (path.endsWith('.png')) {
    link.type = 'image/png';
  } else if (/\.jpe?g$/u.test(path)) {
    link.type = 'image/jpeg';
  } else if (path.endsWith('.webp')) {
    link.type = 'image/webp';
  } else {
    link.removeAttribute('type');
  }
}

/**
 * APP_INITIALIZER factory.
 * Library routing is handled by the :libCode route prefix and libraryPrefixGuard.
 */
export function initApp(envService: EnvironmentService, configService: ConfigService, userService: UserService) {
  return async () => {
    await envService.load();
    try {
      await configService.load();
    } catch (err) {
      document.body.innerHTML =
        '<div style="font-family:sans-serif;padding:2rem;color:#b00">' +
        'Chyba: konfiguráciu sa nepodarilo načítať (config-main.json).' +
        '</div>';
      throw err;
    }
    updateFaviconFromLogo(configService.app.logo);
    initLicenseConfig(configService);
    SolrQueryBuilder.setConfiguredModels(configService.getConfig().search?.doctypes || []);

    // Load the user session AFTER config is applied, so the request targets the
    // configured backend (api.baseUrl) and _licenses is populated before any
    // record renders. Otherwise an early session fetch hits an empty base URL
    // (→ localhost) and every record falsely shows as locked until navigation.
    // A session failure must not block bootstrap.
    try {
      await userService.loadUserData();
    } catch (err) {
      console.warn('initApp: failed to load user session at startup.', err);
    }
  };
}
