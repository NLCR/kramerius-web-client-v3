import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoTextCopyDirective } from './no-text-copy.directive';

/**
 * The DNNTO rule is "readable but not extractable": the OCR text must render,
 * but selecting and copying it must not work. CSS alone is not enough (Ctrl+A
 * reaches through `user-select: none`, and the context menu never fires a
 * keyboard handler), so both halves are asserted here.
 */
@Component({
  standalone: true,
  imports: [NoTextCopyDirective],
  template: `<p [appNoTextCopy]="blocked">page text</p>`,
})
class HostComponent {
  blocked = true;
}

describe('NoTextCopyDirective', () => {
  function setup(blocked = true) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.blocked = blocked;
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement.querySelector('p') as HTMLElement };
  }

  it('renders the text so it stays readable', () => {
    const { el } = setup();
    expect(el.textContent?.trim()).toBe('page text');
  });

  it('disables selection when blocked', () => {
    const { el } = setup();
    expect(el.style.userSelect).toBe('none');
  });

  it('cancels a copy attempt', () => {
    const { el } = setup();
    const event = new Event('copy', { cancelable: true, bubbles: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels a cut attempt', () => {
    const { el } = setup();
    const event = new Event('cut', { cancelable: true, bubbles: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the element alone when not blocked', () => {
    const { el } = setup(false);
    expect(el.style.userSelect).toBe('');

    const event = new Event('copy', { cancelable: true, bubbles: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops blocking when the binding flips to false', () => {
    const { fixture, el } = setup(true);

    fixture.componentInstance.blocked = false;
    fixture.detectChanges();

    expect(el.style.userSelect).toBe('');
    const event = new Event('copy', { cancelable: true, bubbles: true });
    el.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
