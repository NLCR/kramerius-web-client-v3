import { Directive, ElementRef, OnDestroy, Renderer2, effect, inject, input } from '@angular/core';

/**
 * Makes the host's text readable but not extractable, for content served under a
 * license that permits display only (`text: false` in the license permission
 * matrix — DNNTO).
 *
 * Reading the OCR text on screen is fine; carrying it off as a transcript is
 * what the license forbids. So this blocks the two ways text leaves the page:
 *
 *  1. `user-select: none` stops the drag-select that would highlight it.
 *  2. `copy` / `cut` are cancelled, because CSS alone is not enough — Ctrl+A
 *     selects through a `user-select: none` subtree in several browsers, and
 *     the context-menu "Copy" never goes through a keyboard handler at all.
 *
 * Both are needed: either one alone leaves a working path to the clipboard.
 *
 * This is a deterrent, not a secrecy boundary — the text still arrives in the
 * DOM, so anyone with devtools can read it. The backend serves the ALTO text
 * regardless of license, so a real guarantee has to come from there; this keeps
 * the ordinary reader from copying text they are only licensed to view.
 */
@Directive({
  selector: '[appNoTextCopy]',
  standalone: true,
})
export class NoTextCopyDirective implements OnDestroy {
  /** When false the host behaves normally, so callers can bind a license check directly. */
  readonly appNoTextCopy = input(true, { transform: (v: boolean | '') => v === '' || v !== false });

  private el = inject(ElementRef<HTMLElement>);
  private renderer = inject(Renderer2);
  private listeners: (() => void)[] = [];

  constructor() {
    effect(() => {
      const active = this.appNoTextCopy();
      this.teardown();
      if (active) this.apply();
      else this.clear();
    });
  }

  private apply(): void {
    const node = this.el.nativeElement;
    this.renderer.setStyle(node, 'user-select', 'none');
    this.renderer.setStyle(node, '-webkit-user-select', 'none');
    // Long-press on iOS raises the selection callout even with user-select off.
    this.renderer.setStyle(node, '-webkit-touch-callout', 'none');

    for (const event of ['copy', 'cut'] as const) {
      this.listeners.push(
        this.renderer.listen(node, event, (e: Event) => {
          e.preventDefault();
          return false;
        }),
      );
    }
  }

  private clear(): void {
    const node = this.el.nativeElement;
    for (const prop of ['user-select', '-webkit-user-select', '-webkit-touch-callout']) {
      this.renderer.removeStyle(node, prop);
    }
  }

  private teardown(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  ngOnDestroy(): void {
    this.teardown();
  }
}
