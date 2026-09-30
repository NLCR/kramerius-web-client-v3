import { facetKeysEnum } from './facets';

/**
 * Explanatory tooltips shown next to a filter's heading, keyed by facet key.
 *
 * "Zdroj" (cdk.collection) and "Místo uložení" (physical_locations.facet) sit
 * next to each other in the filter panel and both read as a kind of location,
 * so the difference between them — which library digitised and provides the
 * record, versus where the physical original is held — is spelled out here.
 */
export const FACET_HEADING_TOOLTIPS: Record<string, string> = {
  [facetKeysEnum.cdkCollection]: 'facet-cdk-collection-tooltip',
  [facetKeysEnum.physical_locations]: 'facet-physical-locations-tooltip',
};
