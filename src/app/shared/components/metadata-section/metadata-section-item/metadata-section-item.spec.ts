import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MetadataSectionItem } from './metadata-section-item';
import { AppMissingTranslationService } from '../../../translation/app-missing-translation-handler';

/**
 * The secondary line ("Signatura: PE 265" under its holding library) lives
 * inside the clickable <li> but must not read as part of the link: it carries
 * no underline, no pointer and is not a click target. An item whose `itemHref`
 * declines it has nothing to search for, so it must not be a focusable control
 * either.
 */
describe('MetadataSectionItem clickable-list subtext', () => {
  async function render(inputs: Record<string, unknown>) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MetadataSectionItem, TranslateModule.forRoot()],
      providers: [AppMissingTranslationService],
    }).compileComponents();

    const fixture = TestBed.createComponent(MetadataSectionItem);
    fixture.componentRef.setInput('label', 'locations');
    fixture.componentRef.setInput('type', 'clickable-list');
    fixture.componentRef.setInput('disableTranslate', true);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const location = { physicalLocation: 'Knihovna AV ČR', shelfLocator: 'PE 265' };

  it('renders the subtext on its own line outside the link', async () => {
    const el = await render({
      items: [location],
      displayFn: (l: typeof location) => l.physicalLocation,
      itemSubtextFn: (l: typeof location) => `Signatura: ${l.shelfLocator}`,
      itemHref: () => '/search?fq=physical_locations:x',
    });

    const link = el.querySelector('a.item-link')!;
    expect(link.textContent!.trim()).toBe('Knihovna AV ČR');
    // The locator must not be swallowed into the anchor.
    expect(link.textContent).not.toContain('PE 265');

    const subtext = el.querySelector('.item-subtext');
    expect(subtext).withContext('subtext line should render').toBeTruthy();
    expect(subtext!.textContent!.trim()).toBe('Signatura: PE 265');
    expect(subtext!.closest('a')).withContext('subtext must sit outside the link').toBeNull();
  });

  it('omits the subtext line when the function returns nothing', async () => {
    const el = await render({
      items: [location],
      displayFn: (l: typeof location) => l.physicalLocation,
      itemSubtextFn: () => '',
      itemHref: () => '/search?fq=physical_locations:x',
    });

    expect(el.querySelector('.item-subtext')).toBeNull();
  });

  it('does not expose an item as a control when itemHref declines it', async () => {
    const el = await render({
      items: [{ physicalLocation: '', shelfLocator: 'PE 265' }],
      displayFn: (l: typeof location) => l.shelfLocator,
      itemHref: () => null,
      onItemClick: () => {},
    });

    const li = el.querySelector('li')!;
    expect(li.getAttribute('role')).toBeNull();
    expect(li.getAttribute('tabindex')).toBeNull();
    expect(li.classList).not.toContain('clickable');
  });

  it('keeps an item interactive when itemHref supplies a link', async () => {
    const el = await render({
      items: [location],
      displayFn: (l: typeof location) => l.physicalLocation,
      itemHref: () => '/search?fq=physical_locations:x',
      onItemClick: () => {},
    });

    const li = el.querySelector('li')!;
    expect(li.classList).toContain('clickable');
    // The inner <a> owns focus, so the <li> stays out of the tab order.
    expect(li.getAttribute('tabindex')).toBeNull();
    expect(el.querySelector('a.item-link')).toBeTruthy();
  });

  it('falls back to onItemClick for sections that supply no itemHref', async () => {
    const el = await render({
      items: ['Praha', 'Brno'],
      onItemClick: () => {},
    });

    const li = el.querySelector('li')!;
    expect(li.classList).toContain('clickable');
    expect(li.getAttribute('role')).toBe('button');
    expect(li.getAttribute('tabindex')).toBe('0');
  });
});

/**
 * Issue #194: the panel's link appearance moved into a single shared mixin
 * (`_metadata-link.scss`). These lock in the structural contract that mixin
 * hangs off, so a future restyle cannot silently make a dead row look like a
 * link or strip the affordance off a live one.
 *
 * Colors are deliberately not asserted: `public/styles/main.scss` — which
 * defines every `--color-*` token — is in angular.json `build.options.styles`
 * but not in `test.options.styles`, so under Karma the tokens resolve to an
 * empty string and a computed-color expectation would be vacuous. The visual
 * result is verified in the browser instead.
 */
describe('MetadataSectionItem link affordance', () => {
  async function render(inputs: Record<string, unknown>) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MetadataSectionItem, TranslateModule.forRoot()],
      providers: [AppMissingTranslationService],
    }).compileComponents();

    const fixture = TestBed.createComponent(MetadataSectionItem);
    fixture.componentRef.setInput('label', 'collections');
    fixture.componentRef.setInput('type', 'clickable-list');
    fixture.componentRef.setInput('disableTranslate', true);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('marks every interactive row as clickable and renders it as a real anchor', async () => {
    const el = await render({
      items: ['Sbírka Kevorka Marouchiana', 'České muzeum hudby'],
      itemHref: (c: string) => `/search?fq=collection:${c}`,
    });

    const rows = Array.from(el.querySelectorAll('li'));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.classList).withContext('interactive row carries .clickable').toContain('clickable');
      expect(row.querySelector('a.item-link.item-content'))
        .withContext('interactive row renders as an anchor carrying .item-content')
        .toBeTruthy();
    }
  });

  it('leaves a non-interactive row unmarked and out of the tab order', async () => {
    const el = await render({
      items: ['Knihovna bez odkazu'],
      itemHref: () => null,
    });

    const li = el.querySelector('li')!;
    expect(li.classList).not.toContain('clickable');
    expect(li.querySelector('a')).withContext('no anchor for a dead row').toBeNull();
    expect(li.getAttribute('tabindex')).toBeNull();
    expect(li.getAttribute('role')).toBeNull();
  });

  /**
   * Regression for #194: an href-backed row renders as `<a class="item-content
   * item-link">`. `a.item-link` outranks `.item-content`, so if it only
   * inherits its decoration the global `a { text-decoration: none }` reset
   * (public/styles/_typography.scss) wins and the row shows no underline at
   * all — which is exactly what collections, languages and locations did.
   * The anchor must therefore carry the underline itself.
   */
  it('gives the anchor its own underline rather than inheriting one', async () => {
    const el = await render({
      items: ['Denní tisk'],
      itemHref: () => '/collection/uuid:1',
    });
    document.body.appendChild(el);

    const anchor = el.querySelector('a.item-link') as HTMLElement;
    expect(anchor).withContext('href row renders as an anchor').toBeTruthy();
    expect(getComputedStyle(anchor).textDecorationLine)
      .withContext('anchor underlines itself; inheriting resolves to none')
      .toContain('underline');

    el.remove();
  });

  /**
   * The underline lives on `.item-content`, never on the <li>: a decoration on
   * the row would be inherited by `.item-subtext`, and a descendant cannot
   * cancel an inherited text-decoration.
   */
  it('keeps the link treatment off the row itself so subtext can opt out', async () => {
    const el = await render({
      items: [{ name: 'Knihovna AV ČR', sig: 'PE 265' }],
      displayFn: (l: { name: string }) => l.name,
      itemSubtextFn: (l: { sig: string }) => `Signatura: ${l.sig}`,
      itemHref: () => '/search?fq=x',
    });

    const subtext = el.querySelector('.item-subtext')!;
    expect(subtext.closest('a')).withContext('subtext sits outside the anchor').toBeNull();
    expect(subtext.closest('.item-content')).withContext('subtext sits outside the link body').toBeNull();
  });
});
