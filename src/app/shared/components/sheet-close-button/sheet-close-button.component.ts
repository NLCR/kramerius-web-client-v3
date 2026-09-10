import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { BreakpointService } from '../../services/breakpoint.service';

/**
 * Dismisses the mobile slide-up sheet from inside a sidebar's own first row.
 *
 * The sheet hides its caption header on mobile (see `SlideUpPanelComponent`'s
 * `hideTitle`), so instead of spending a row on a lone X, the hosting sidebar
 * places this button beside its leading control - typically the in-document
 * search field. Renders nothing on wider viewports, where the sheet is not in
 * play (GitHub issue #177).
 */
@Component({
  selector: 'app-sheet-close-button',
  imports: [TranslatePipe],
  template: `
    @if (breakpointService.isMobile()) {
      <button class="sheet-close-button" type="button" (click)="close()"
        [attr.aria-label]="'close-dialog--arialabel' | translate">
        <i class="icon-close" aria-hidden="true"></i>
      </button>
    }
  `,
  styleUrl: './sheet-close-button.component.scss'
})
export class SheetCloseButtonComponent {
  protected breakpointService = inject(BreakpointService);

  close(): void {
    this.breakpointService.manualToggle.set(false);
  }
}
