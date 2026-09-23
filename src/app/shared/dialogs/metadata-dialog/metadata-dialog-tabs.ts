import { LicenseActionsConfig } from '../../../core/config/config.interfaces';

/**
 * The metadata dialog's resource tabs, in display order, with the license action
 * each one depends on.
 *
 * `metadata: true` (which DNNTO grants) opens the dialog, but it says nothing
 * about the *content* behind each tab — and several of these tabs serve exactly
 * what other actions forbid:
 *
 *  - `alto` / `ocr` fetch /ocr/alto and /ocr/text, i.e. the page's OCR text that
 *    `text: false` keeps out of reach everywhere else. Here it would arrive as
 *    selectable, copyable `<pre>` text.
 *  - `foxml` is the raw Fedora object and carries the OCR datastreams with it,
 *    so it follows `text` too.
 *  - `iiif` is the image info/manifest — the route to the full-resolution scan —
 *    so it follows `jpeg`.
 *
 * The descriptive tabs (mods, dc, solr, item, children) are metadata proper and
 * stay governed by `metadata` alone.
 */
export const METADATA_DIALOG_TABS: readonly { id: string; requires?: keyof LicenseActionsConfig }[] = [
  { id: 'mods' },
  { id: 'dc' },
  { id: 'solr' },
  { id: 'foxml', requires: 'text' },
  { id: 'alto', requires: 'text' },
  { id: 'ocr', requires: 'text' },
  { id: 'item' },
  { id: 'children' },
  { id: 'iiif', requires: 'jpeg' },
];

/**
 * The tabs a document may show, given a predicate answering whether an action is
 * permitted for it. Kept as a free function so the policy can be tested without
 * constructing the dialog.
 */
export function visibleMetadataTabs(
  isAllowed: (action: keyof LicenseActionsConfig) => boolean,
): string[] {
  return METADATA_DIALOG_TABS
    .filter(tab => !tab.requires || isAllowed(tab.requires))
    .map(tab => tab.id);
}
