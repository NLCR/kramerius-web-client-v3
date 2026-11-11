import {Component, EventEmitter, Input, Output} from '@angular/core';
import {TranslatePipe} from '@ngx-translate/core';

@Component({
  selector: 'app-page-navigator',
  imports: [
    TranslatePipe,
  ],
  templateUrl: './page-navigator.component.html',
  styleUrl: './page-navigator.component.scss'
})
export class PageNavigatorComponent {

  @Input() currentPage = 1;
  @Input() totalPages = 1;
  @Input() compact = false;
  /** Number of pages shown by an image spread. */
  @Input() pageStep = 1;
  /** Translation key for the leading label; "Strana" unless overridden. */
  @Input() label = 'page';

  @Output() prev = new EventEmitter<void>();
  @Output() next = new EventEmitter<void>();
  @Output() pageChange = new EventEmitter<number>();
  /** Compact mode: emitted when the "12 of 232" indicator is tapped. */
  @Output() indicatorClick = new EventEmitter<void>();

  goPrev() {
    if (this.currentPage > 1) {
      this.prev.emit();
    }
  }

  goNext() {
    if (!this.nextDisabled) {
      this.next.emit();
    }
  }

  get nextDisabled(): boolean {
    return this.currentPage + this.pageStep > this.totalPages;
  }

  get compactPageLabel(): string {
    return this.pageStep > 1 && this.currentPage < this.totalPages
      ? `${this.currentPage}–${Math.min(this.currentPage + this.pageStep - 1, this.totalPages)}`
      : String(this.currentPage);
  }

  get currentPageString(): string {
    return this.currentPage.toString().padStart(2, '0');
  }

  get totalPagesString(): string {
    return this.totalPages.toString().padStart(2, '0');
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseInt(input.value, 10);

    if (!isNaN(value) && value >= 1 && value <= this.totalPages) {
      this.currentPage = value;
      this.pageChange.emit(this.currentPage - 1); // Emit page index (0-based)
    } else {
      (event.target as HTMLInputElement).value = this.currentPageString;
    }
  }

  onInputConfirm(event: Event): void {
    this.onInputChange(event);
  }

}
