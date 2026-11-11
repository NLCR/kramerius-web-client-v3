import { PageNavigatorComponent } from './page-navigator.component';

describe('PageNavigatorComponent book spreads', () => {
  it('shows both pages and disables next when the final spread is already visible', () => {
    const component = new PageNavigatorComponent();
    component.pageStep = 2;
    component.currentPage = 3;
    component.totalPages = 4;
    const next = spyOn(component.next, 'emit');

    expect(component.compactPageLabel).toBe('3–4');
    expect(component.nextDisabled).toBe(true);
    component.goNext();
    expect(next).not.toHaveBeenCalled();
  });

  it('allows reaching a final single page and displays it without an invented neighbour', () => {
    const component = new PageNavigatorComponent();
    component.pageStep = 2;
    component.currentPage = 3;
    component.totalPages = 5;
    const next = spyOn(component.next, 'emit');

    component.goNext();
    expect(next).toHaveBeenCalled();
    component.currentPage = 5;
    expect(component.compactPageLabel).toBe('5');
    expect(component.nextDisabled).toBe(true);
  });
});
