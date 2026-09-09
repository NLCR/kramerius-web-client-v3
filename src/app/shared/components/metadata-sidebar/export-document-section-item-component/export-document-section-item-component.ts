import { Component, EventEmitter, inject, Input, OnChanges, OnDestroy, Output, signal, SimpleChanges } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { MatRadioModule } from '@angular/material/radio';
import { FormsModule } from '@angular/forms';
import { NgFor } from '@angular/common';
import { trigger, state, style, animate, transition } from '@angular/animations';
import { Subscription } from 'rxjs';
import { DirectPdfAvailability, DirectPdfService } from '../../../services/direct-pdf.service';
import { ToastService } from '../../../services/toast.service';

export interface ExportOption {
  label: string;
  value: string;
  disabled: boolean;
}

@Component({
  selector: 'app-export-document-section-item-component',
  imports: [
    TranslatePipe,
    MatRadioModule,
    FormsModule,
    NgFor,
  ],
  templateUrl: './export-document-section-item-component.html',
  styleUrl: './export-document-section-item-component.scss',
  animations: [
    trigger('expandCollapse', [
      state('expanded', style({ height: '*', opacity: 1, overflow: 'hidden' })),
      state('collapsed', style({ height: '0px', opacity: 0, overflow: 'hidden' })),
      transition('expanded <=> collapsed', animate('200ms ease-in-out')),
    ]),
  ],
})
export class ExportDocumentSectionItemComponent implements OnChanges, OnDestroy {

  @Input() title = '';
  @Input() icon = '';
  @Input() set options(value: ExportOption[]) {
    this._options = value ?? [];
    this.ensureSelection();
  }
  get options(): ExportOption[] { return this._options; }
  private _options: ExportOption[] = [];
  @Input() groupName = '';
  @Input() collapsible = false;
  @Input() loading = false;
  @Input() loginRequired = false;
  @Input() directPdfPid: string | null = null;
  /** Optional translation key rendered as an informational note below the options. */
  @Input() note = '';
  @Input() set expanded(value: boolean) { this._expanded.set(value); }

  @Output() submit = new EventEmitter<string>();
  @Output() optionChange = new EventEmitter<string>();
  @Output() toggle = new EventEmitter<void>();

  @Input() selectedOption: string | null = null;

  _expanded = signal(true);
  directPdf = signal<DirectPdfAvailability | null>(null);

  private directPdfService = inject(DirectPdfService);
  private toastService = inject(ToastService);
  private directPdfRequest?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['directPdfPid']) return;

    this.directPdfRequest?.unsubscribe();
    this.directPdf.set(null);
    if (!this.directPdfPid) return;

    this.directPdfRequest = this.directPdfService.checkAvailability(this.directPdfPid)
      .subscribe(info => this.directPdf.set(info));
  }

  ngOnDestroy(): void {
    this.directPdfRequest?.unsubscribe();
  }

  toggleExpanded(): void {
    this._expanded.update(v => !v);
    this.toggle.emit();
  }

  onSubmit() {
    if (this.selectedOption) {
      this.submit.emit(this.selectedOption);
    }
  }

  onDirectPdfDownload(): void {
    this.toastService.show('direct-pdf-download-started');
  }

  onOptionChange(event: any) {
    this.optionChange.emit(event.value);
  }

  /**
   * Pre-select a default option once enabled options are available.
   * Prefers "current-page" first, then "whole-document", then the first enabled option.
   * Keeps an existing, still-enabled selection untouched.
   */
  private ensureSelection(): void {
    const enabled = this._options.filter(o => !o.disabled);
    const current = enabled.find(o => o.value === this.selectedOption);
    if (current) {
      return;
    }
    const preferred =
      enabled.find(o => o.value === 'current-page') ??
      enabled.find(o => o.value === 'whole-document') ??
      enabled[0];
    this.selectedOption = preferred ? preferred.value : null;
  }

}
