import { Metadata, Publisher, mergeMetadata } from './metadata.model';

/**
 * Solr only carries `publishers.search`, a bare list of names, so
 * fromSolrToMetadata builds Publisher objects whose `place` and `date` are
 * empty. MODS carries all three. Merging keyed on `name|place|date` therefore
 * never recognised the two as the same publisher: the incomplete Solr entry
 * survived and the rich MODS one was appended next to it, so the sidebar showed
 * a publisher with no place and no year (issue #190).
 */
describe('mergeMetadata publishers: MODS enriches an incomplete Solr publisher', () => {

  function solrPublisherNameOnly(): Metadata {
    const solr = new Metadata();
    const pub = new Publisher();
    pub.name = 'Aventinum';
    solr.publishers = [pub];
    return solr;
  }

  function modsPublisherFull(): Metadata {
    const mods = new Metadata();
    const pub = new Publisher();
    pub.name = 'Aventinum';
    pub.place = 'Praha';
    pub.date = '1934';
    mods.publishers = [pub];
    return mods;
  }

  it('fills place and date into the Solr publisher instead of duplicating it', () => {
    const merged = mergeMetadata(solrPublisherNameOnly(), modsPublisherFull());

    expect(merged.publishers.length).toBe(1);
    expect(merged.publishers[0].place).toBe('Praha');
    expect(merged.publishers[0].date).toBe('1934');
  });

  it('renders the full "Praha: Aventinum, 1934" detail after merging', () => {
    const merged = mergeMetadata(solrPublisherNameOnly(), modsPublisherFull());

    expect(merged.publishers[0].fullDetail()).toContain('Praha');
    expect(merged.publishers[0].fullDetail()).toContain('1934');
  });

  it('keeps a genuinely different publisher as a separate entry', () => {
    const mods = modsPublisherFull();
    const other = new Publisher();
    other.name = 'Melantrich';
    other.place = 'Praha';
    other.date = '1935';
    mods.publishers.push(other);

    const merged = mergeMetadata(solrPublisherNameOnly(), mods);

    expect(merged.publishers.length).toBe(2);
    expect(merged.publishers.map(p => p.name)).toEqual(['Aventinum', 'Melantrich']);
  });

  it('does not overwrite a place or date that Solr already had', () => {
    const solr = solrPublisherNameOnly();
    solr.publishers[0].place = 'Brno';
    solr.publishers[0].date = '1900';

    const merged = mergeMetadata(solr, modsPublisherFull());

    expect(merged.publishers[0].place).toBe('Brno');
    expect(merged.publishers[0].date).toBe('1900');
  });

  it('leaves the cached MODS publisher untouched while enriching', () => {
    const mods = modsPublisherFull();
    mergeMetadata(solrPublisherNameOnly(), mods);

    expect(mods.publishers[0].place).toBe('Praha');
    expect(mods.publishers[0].date).toBe('1934');
  });

});
