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
