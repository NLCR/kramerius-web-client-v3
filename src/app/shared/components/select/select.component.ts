import {
  Component,
  signal,
  EventEmitter,
  Output,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  TemplateRef,
} from '@angular/core';
import { NgIf, NgForOf, NgClass, NgTemplateOutlet } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { InputComponent } from '../input/input.component';
import { resolveNamespacedTranslation } from '../../translation/namespaced-translation';

import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';

@Component({
  selector: 'app-select',
  standalone: true,
  imports: [NgIf, NgForOf, TranslatePipe, NgClass, NgTemplateOutlet, FormsModule, InputComponent, ScrollingModule, OverlayModule],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
})
export class SelectComponent<T = any> implements AfterViewInit, OnDestroy, OnChanges {
  private searchBuffer = '';
  private searchTimeout?: any;

  @Input() class = '';
  @Input() size: 'sm' | 'base' = 'base';
  @Input() theme: 'light' | 'base' = 'base';
  @Input() options: T[] = [];
  @Input() displayFn: (option: T | null) => string = (o: T | null) => (o != null ? String(o) : '-');
  /**
   * When set, option labels are translated within this namespace
   * (e.g. 'language' -> key 'language-{code}'), falling back to the raw value
   * when no translation exists. Avoids collisions with the global namespace.
   */
  @Input() translateNamespace?: string;
  @Input() value: T | null = null;
  /**
   * Optional per-option leading content (e.g. a logo), rendered before the label
   * in both the trigger and the dropdown options. The template receives the
   * option as implicit context: `<ng-template let-option>`. When unset, nothing
   * extra is rendered and the select looks exactly as before.
   */
  @Input() optionPrefixTpl?: TemplateRef<{ $implicit: T | null }>;
  @Input() filterable = false;
  @Input() filterPlaceholder = 'Filter...';
  @Input() disabled = false;
  @Input() zIndex = 1000;
  @Input() showMicButton = false;

  // Virtual Scroll Inputs
  @Input() virtualScroll = false;
  @Input() itemSize = 36;
  @Input() visibleItemsCount = 8;

  @Output() valueChange = new EventEmitter<T>();
  @Output() closed = new EventEmitter<void>();

  open = signal(false);
  filterText = '';
  filteredOptions: T[] = [];
  focusedIndex = -1;
  dropdownWidth = 0;
  readonly overlayPositions: ConnectedPosition[] = [
    {
      originX: 'start', originY: 'bottom',
      overlayX: 'start', overlayY: 'top',
      offsetY: 6,
    },
    {
      originX: 'start', originY: 'top',
      overlayX: 'start', overlayY: 'bottom',
      offsetY: -6,
    },
  ];

  @ViewChild('wrapper') wrapperRef?: ElementRef;
  @ViewChild('optionsContainer') optionsContainerRef?: ElementRef<HTMLElement>;
  @ViewChild('filterInput') filterInputRef?: InputComponent;
  @ViewChild(CdkVirtualScrollViewport) virtualViewport?: CdkVirtualScrollViewport;
  private resizeObserver?: ResizeObserver;

  constructor(
    private hostRef: ElementRef,
    private translate: TranslateService
  ) { }

  getViewportHeight(): string {
    return `${this.visibleItemsCount * this.itemSize}px`;
  }

  get focusedOptionLabel(): string {
    const option = this.filteredOptions[this.focusedIndex];
    if (this.focusedIndex < 0 || option === undefined) return '';
    return this.displayLabel(option);
  }

  /**
   * Resolves the visible label for an option, honoring translateNamespace when
   * set (with raw-value fallback) and falling back to plain translation otherwise.
   */
  displayLabel(option: T | null): string {
    const raw = this.displayFn(option);
    if (this.translateNamespace) {
      return resolveNamespacedTranslation(this.translate, raw, this.translateNamespace);
    }
    return this.translate.instant(raw);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['options']) {
      this.updateFilteredOptions();
    }
  }

  ngAfterViewInit() {
    this.resizeObserver = new ResizeObserver(() => this.checkPosition());
    if (this.wrapperRef?.nativeElement) {
      this.resizeObserver.observe(this.wrapperRef.nativeElement);
    }
    document.addEventListener('click', this.onClickOutside);
    document.addEventListener('scroll', this.onScrollClose, true);
    this.updateFilteredOptions();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    document.removeEventListener('click', this.onClickOutside);
    document.removeEventListener('scroll', this.onScrollClose, true);
  }

  focus(): void {
    if (!this.open()) {
      this.toggle();
    }
  }

  toggle() {
    if (this.disabled) return;
    const willOpen = !this.open();
    if (willOpen) {
      this.filterText = '';
      this.updateFilteredOptions();
      this.focusedIndex = this.filteredOptions.findIndex((o) => o === this.value);
      this.checkPosition();
    }
    this.open.set(willOpen);

    requestAnimationFrame(() => {
      if (this.open()) {
        if (this.focusedIndex >= 0) {
          this.scrollFocusedIntoView();
        }
        if (this.filterable) {
          this.filterInputRef?.focus();
        }
      }
    });
  }

  select(option: T) {
    this.value = option;
    this.valueChange.emit(option);
    this.open.set(false);
    this.filterText = '';
    this.updateFilteredOptions();
    setTimeout(() => this.closed.emit(), 0);
  }

  onFilterChange(text: string | number) {
    const filterText = String(text);
    this.filterText = filterText;
    this.updateFilteredOptions();
    this.focusedIndex = -1; // Reset focused index when filtering
  }

  onFilterKeyDown(event: KeyboardEvent) {
    const key = event.key;

    switch (key) {
      case 'ArrowDown':
        if (this.focusedIndex < 0) {
          if (this.filteredOptions.length > 0) {
            this.focusedIndex = 0;
            this.scrollFocusedIntoView();
          }
        } else {
          this.moveFocus(1);
        }
        event.preventDefault();
        break;
      case 'ArrowUp':
        if (this.focusedIndex < 0) {
          if (this.filteredOptions.length > 0) {
            this.focusedIndex = this.filteredOptions.length - 1;
            this.scrollFocusedIntoView();
          }
        } else {
          this.moveFocus(-1);
        }
        event.preventDefault();
        break;
      case 'Enter':
        if (this.focusedIndex >= 0 && this.filteredOptions[this.focusedIndex]) {
          this.select(this.filteredOptions[this.focusedIndex]);
          event.preventDefault();
        }
        break;
      case 'Escape':
        this.open.set(false);
        event.preventDefault();
        break;
      case 'Tab':
        this.open.set(false);
        break;
    }
  }

  onKeyDown(event: KeyboardEvent) {
    if (!this.open()) {
      switch (event.key) {
        case 'Enter':
        case ' ':
        case 'ArrowDown':
        case 'ArrowUp':
          this.toggle();
          event.preventDefault();
          break;
      }
      return;
    }

    const key = event.key;

    switch (key) {
      case 'ArrowDown':
        this.moveFocus(1);
        event.preventDefault();
        break;
      case 'ArrowUp':
        this.moveFocus(-1);
        event.preventDefault();
        break;
      case 'Enter':
      case ' ':
        if (this.focusedIndex >= 0) {
          this.select(this.filteredOptions[this.focusedIndex]);
          event.preventDefault();
        }
        break;
      case 'Escape':
        this.open.set(false);
        event.preventDefault();
        break;
      default:
        this.searchByCharacter(key);
        break;
    }
  }

  private updateFilteredOptions() {
    if (!this.filterText.trim()) {
      this.filteredOptions = [...this.options];
    } else {
      const filterLower = this.filterText.toLowerCase();
      this.filteredOptions = this.options.filter((option) => {
        const translated = this.displayLabel(option);
        return translated.toLowerCase().includes(filterLower);
      });
    }
  }

  private moveFocus(delta: number) {
    if (!this.filteredOptions.length) return;

    this.focusedIndex = (this.focusedIndex + delta + this.filteredOptions.length) % this.filteredOptions.length;
    this.scrollFocusedIntoView();
  }

  private scrollFocusedIntoView() {
    requestAnimationFrame(() => {
      if (this.virtualScroll && this.virtualViewport) {
        // Virtual scroll: off-screen options aren't in the DOM, so scrollIntoView
        // can't find them. Drive the viewport directly, centering when possible.
        const offset = Math.max(0, Math.floor(this.visibleItemsCount / 2) - 1);
        const target = Math.max(0, this.focusedIndex - offset);
        this.virtualViewport.scrollToIndex(target);
        return;
      }
      const el = document.getElementById('option-' + this.focusedIndex);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }

  private searchByCharacter(key: string) {
    if (key.length !== 1 || !/^[\p{L}\p{N}]$/u.test(key)) return;

    this.searchBuffer += key.toLowerCase();

    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => (this.searchBuffer = ''), 500);

    const matchIndex = this.filteredOptions.findIndex((opt) => {
      const translated = this.displayLabel(opt);
      return translated.toLowerCase().startsWith(this.searchBuffer);
    });

    if (matchIndex !== -1) {
      this.focusedIndex = matchIndex;
      this.scrollFocusedIntoView();
    }
  }

  focusFirst() {
    this.focusedIndex = 0;
  }

  checkPosition() {
    const wrapperEl = this.wrapperRef?.nativeElement as HTMLElement;
    if (!wrapperEl) return;
    this.dropdownWidth = wrapperEl.getBoundingClientRect().width;
  }

  trackByFn = (_: number, option: T) => option;

  private onClickOutside = (event: Event) => {
    const target = event.target as Node;
    if (!this.hostRef.nativeElement.contains(target) && !this.optionsContainerRef?.nativeElement.contains(target)) {
      this.open.set(false);
      this.filterText = '';
      this.updateFilteredOptions();
    }
  };

  private onScrollClose = (event: Event) => {
    if (!this.open()) return;
    const target = event.target as Node;
    // Don't close when scrolling within the dropdown options list
    if (this.hostRef.nativeElement.contains(target) || this.optionsContainerRef?.nativeElement.contains(target)) return;
    this.open.set(false);
    this.filterText = '';
    this.updateFilteredOptions();
  };
}
