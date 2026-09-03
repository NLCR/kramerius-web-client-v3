import { LicenseActionsConfig } from '../../../core/config/config.interfaces';
import { visibleMetadataTabs } from './metadata-dialog-tabs';

/**
 * `metadata: true` opens the metadata dialog, but says nothing about the content
 * of each resource tab. ALTO/OCR serve the page's OCR text and IIIF is the route
 * to the full-resolution scan, so those tabs must follow `text` / `jpeg` — the
 * same actions that block copying the text and downloading the image elsewhere.
 */
describe('visibleMetadataTabs', () => {
  const allowAll = () => true;
  const deny = (...blocked: (keyof LicenseActionsConfig)[]) =>
    (action: keyof LicenseActionsConfig) => !blocked.includes(action);

  it('shows every tab when nothing is restricted', () => {
    expect(visibleMetadataTabs(allowAll)).toEqual(
      ['mods', 'dc', 'solr', 'foxml', 'alto', 'ocr', 'item', 'children', 'iiif'],
    );
  });

  it('hides the OCR-bearing tabs when text is forbidden', () => {
    const tabs = visibleMetadataTabs(deny('text'));
    expect(tabs).not.toContain('alto');
    expect(tabs).not.toContain('ocr');
    // FOXML is the raw object and ships the OCR datastreams with it.
    expect(tabs).not.toContain('foxml');
  });

  it('hides the IIIF tab when the image is forbidden', () => {
    expect(visibleMetadataTabs(deny('jpeg'))).not.toContain('iiif');
  });

  it('leaves only the descriptive tabs under a DNNTO-style license', () => {
    // dnnto: text false, jpeg false, metadata true.
    expect(visibleMetadataTabs(deny('text', 'jpeg')))
      .toEqual(['mods', 'dc', 'solr', 'item', 'children']);
  });

  it('never hides the descriptive tabs, which `metadata` alone governs', () => {
    // Denying every content action must not touch them.
    const tabs = visibleMetadataTabs(() => false);
    expect(tabs).toEqual(['mods', 'dc', 'solr', 'item', 'children']);
  });

  it('preserves the configured display order', () => {
    const tabs = visibleMetadataTabs(deny('text'));
    expect(tabs).toEqual(['mods', 'dc', 'solr', 'item', 'children', 'iiif']);
  });
});
