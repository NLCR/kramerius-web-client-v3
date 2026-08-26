import {
  Component,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  signal,
  computed,
  SimpleChanges,
  ChangeDetectorRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { MatCalendar } from '@angular/material/datepicker';
import { NgIf } from '@angular/common';
import { DateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RecordHandlerService } from '../../services/record-handler.service';
import { Store } from '@ngrx/store';
import { loadMonthIssues } from '../../../modules/periodical/state/periodical-detail/periodical-detail.actions';
import {
  selectMonthIssues,
  selectPidFromAvailableYears,
  selectPeriodicalState,
  selectAvailableYears,
} from '../../../modules/periodical/state/periodical-detail/periodical-detail.selectors';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subject, take } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MonthYearSelectorComponent, MonthYearChange } from '../month-year-selector/month-year-selector.component';
import { ClickOutsideDirective } from '../../directives/click-outside/click-outside.directive';

@Component({
  selector: 'app-calendar-popup',
  imports: [
    MatCalendar,
    NgIf,
    MonthYearSelectorComponent,
    ClickOutsideDirective,
    TranslatePipe,
  ],
  providers: [
    {
      provide: MAT_DATE_LOCALE,
      useFactory: (translate: TranslateService) => translate.getCurrentLang(),
      deps: [TranslateService],
    },
  ],
  template: `
    <div class="calendar-dropdown" appClickOutside (clickOutside)="close()">
<!--      <div class="calendar-popup-header">-->
<!--        <button class="nav-btn" (click)="previousMonth()">-->
<!--          <i class="icon-arrow-left-1"></i>-->
<!--        </button>-->
<!--        <h3>{{ monthNames[currentMonth()] }} {{ currentYear() }}</h3>-->
<!--        <button class="nav-btn" (click)="nextMonth()">-->
<!--          <i class="icon-arrow-right-1"></i>-->
<!--        </button>-->
<!--        <button class="close-btn" (click)="close()">×</button>-->
<!--      </div>-->
      <div class="calendar-popup-selectors">
        <app-month-year-selector
          [month]="currentMonth()"
          [year]="currentYear()"
          [availableYears]="availableYearNumbers()"
          [restrictToAvailableYears]="true"
          [showMonthNavigation]="true"
          (monthYearChange)="onMonthYearChange($event)">
        </app-month-year-selector>
      </div>
      <div class="single-calendar-container">
        <div class="loading-overlay" *ngIf="isLoadingCalendar()">
          <div class="loading-spinner">
            <div class="spinner"></div>
            <span>{{ 'loading' | translate }}</span>
          </div>
        </div>
        <mat-calendar class="custom-label"
                      [class.loading]="isLoadingCalendar()"
                      [dateClass]="dateClass"
                      [dateFilter]="dateFilter"
                      [startAt]="currentDate()"
                      [startView]="'month'"
                      (selectedChange)="onDateSelected($event)">
        </mat-calendar>
      </div>
      <div class="calendar-legend" aria-live="polite">
        <div class="calendar-legend__item">
          <span class="calendar-legend__swatch calendar-legend__swatch--digitized" aria-hidden="true"></span>
          <span>{{ 'periodical-calendar-digitized-open' | translate }}</span>
        </div>
        <div class="calendar-legend__item">
          <span class="calendar-legend__swatch calendar-legend__swatch--restricted" aria-hidden="true"></span>
          <span>{{ 'periodical-calendar-digitized-restricted' | translate }}</span>
        </div>
        <div class="calendar-legend__item">
          <span class="calendar-legend__swatch calendar-legend__swatch--missing" aria-hidden="true"></span>
          <span>{{ 'periodical-calendar-not-digitized' | translate }}</span>
        </div>
      </div>
      <p class="calendar-help">{{ 'periodical-calendar-help' | translate }}</p>
    </div>
  `,
  styles: `
    :host { display: contents; }
    .calendar-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-bg-base);
      border-radius: var(--spacing-x2);
      border: 1px solid var(--color-primary);
      box-shadow: 0 2px 16px 2px rgba(0, 0, 0, 0.08);
      width: 320px;
      max-width: calc(100vw - 16px);
      z-index: 800;
      padding: var(--spacing-x2);
    }

    .calendar-popup-header {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #e0e0e0;
      background: #f5f5f5;
      border-radius: 8px 8px 0 0;
      gap: 12px;
    }

    .calendar-popup-header h3 {
      margin: 0;
      font-size: calc(18px * var(--accessibility-text-scale));
      font-weight: 600;
      color: #333;
      flex: 1;
      text-align: center;
    }

    .nav-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #666;
      padding: 8px;
      border-radius: 50%;
      transition: background-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .nav-btn:hover {
      background-color: #e0e0e0;
    }

    .close-btn {
      background: none;
      border: none;
      font-size: calc(20px * var(--accessibility-text-scale));
      cursor: pointer;
      color: #666;
      padding: 4px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: background-color 0.2s;
    }

    .close-btn:hover {
      background-color: #e0e0e0;
    }

    .calendar-popup-selectors {
      padding: 0 0 var(--spacing-x2) 0;
      border-bottom: 1px solid var(--color-border-bright);
    }

    .single-calendar-container {
      margin-top: var(--spacing-x2);
      display: flex;
      justify-content: center;
      position: relative;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--calendar-popup-content-ts);
      border-radius: 8px;
    }

    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid var(--color-primary, #007bff);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    .loading-spinner span {
      font-size: var(--font-size-small);
      color: #666;
      font-weight: 500;
    }

    .calendar-legend {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px 12px;
      margin-top: var(--spacing-x2);
      padding-top: var(--spacing-x2);
      border-top: 1px solid var(--color-border-light);
      color: var(--color-text-secondary);
      font-size: var(--font-size-xxsmall);
      line-height: 1.35;
    }

    .calendar-legend__item {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .calendar-legend__swatch {
      width: 13px;
      height: 13px;
      border-radius: 4px;
      flex: 0 0 auto;
    }

    .calendar-legend__swatch--digitized {
      background: var(--accessibility-public-bg);
      border: 1px solid color-mix(in srgb, var(--accessibility-public-text-color) 24%, transparent);
    }

    .calendar-legend__swatch--restricted {
      background: var(--accessibility-private-bg);
      border: 1px solid color-mix(in srgb, var(--accessibility-private-text-color) 24%, transparent);
    }

    .calendar-legend__swatch--missing {
      background: transparent;
      border: 1px solid var(--color-border-bright);
      opacity: .65;
    }

    .calendar-help {
      margin: var(--spacing-x2) 0 0;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xxsmall);
      line-height: 1.4;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    @keyframes spin {
      0% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(360deg);
      }
    }

    :host ::ng-deep .mat-calendar-header {
      display: none !important;
    }

    :host ::ng-deep .mat-calendar {
      width: 100%;
      transition: opacity 0.2s ease;
    }

    :host ::ng-deep .mat-calendar.loading {
      opacity: 0.5;
    }

    :host ::ng-deep .mat-calendar-content {
      padding: 0 !important;
    }

    :host ::ng-deep .mat-calendar-table {
      width: 100%;
      border-collapse: collapse;
    }

    :host ::ng-deep button {
      padding: 8px 2px;
    }

    :host ::ng-deep .mat-calendar-body-label {
      visibility: hidden !important;
      padding: 0 !important;
      height: 0 !important;
      line-height: 0 !important;
      font-size: 0 !important;
    }

    :host ::ng-deep .mat-calendar-table-header th {
      font-size: var(--font-size-small);
      font-weight: 500;
      color: var(--color-text-tertiary);
      padding: var(--spacing-x2) 0;
      text-align: center;
    }

    :host ::ng-deep .mat-calendar-table-header-divider {
      display: none;
    }

    :host ::ng-deep .mat-calendar-body-cell {
      height: 90%;
      width: 90%;
    }

    :host ::ng-deep .mat-calendar-body-cell-content {
      font-size: var(--font-size-small) !important;
      font-weight: 400;
      color: var(--color-text-tertiary) !important;
      border-radius: var(--spacing-x2) !important;
      top: 7.5% !important;
      left: 7.5% !important;
      width: 85% !important;
      height: 85% !important;
      line-height: 1 !important;
    }

    :host ::ng-deep .mat-calendar-body-disabled .mat-calendar-body-cell-content {
      color: var(--color-text-tertiary) !important;
      opacity: .34;
      background: transparent !important;
    }

    :host ::ng-deep .has-issue .mat-calendar-body-cell-content {
      background-color: var(--accessibility-public-bg) !important;
      color: var(--accessibility-public-text-color) !important;
      border-radius: var(--spacing-x2) !important;
      font-weight: 500;
    }

    :host ::ng-deep .has-issue.accessibility-private .mat-calendar-body-cell-content {
      background-color: var(--accessibility-private-bg) !important;
      color: var(--accessibility-private-text-color) !important;
    }

    /* Issue count dots — on the cell so they don't move on hover */
    :host ::ng-deep .mat-calendar-body-cell.multiple-issues.issue-count-2::after {
      content: '••';
      position: absolute;
      top: 65%;
      left: 50%;
      transform: translateX(-50%);
      font-size: calc(10px * var(--accessibility-text-scale, 1));
      line-height: 1;
      color: var(--accessibility-public-text-color);
      letter-spacing: 1px;
      pointer-events: none;
      z-index: 1;
    }

    :host ::ng-deep .mat-calendar-body-cell.multiple-issues.issue-count-3plus::after {
      content: '•••';
      position: absolute;
      top: 65%;
      left: 50%;
      transform: translateX(-50%);
      font-size: calc(10px * var(--accessibility-text-scale, 1));
      line-height: 1;
      color: var(--accessibility-public-text-color);
      letter-spacing: 1px;
      pointer-events: none;
      z-index: 1;
    }

    :host ::ng-deep .mat-calendar-body-cell.has-issue.accessibility-private::after {
      color: var(--accessibility-private-text-color) !important;
    }

    :host ::ng-deep .has-issue:hover .mat-calendar-body-cell-content {
      filter: brightness(0.95);
    }

    :host ::ng-deep .mat-calendar-body-selected {
      background-color: transparent !important;
      box-shadow: none !important;
    }

    :host ::ng-deep .mat-calendar-body-active > .mat-calendar-body-cell-content:not(.mat-calendar-body-selected) {
      background-color: transparent !important;
    }

    :host ::ng-deep .mat-calendar-body-cell:not(.mat-calendar-body-disabled) {
      cursor: pointer;
    }

    :host ::ng-deep .mat-calendar-body-cell:not(.mat-calendar-body-disabled):hover > .mat-calendar-body-cell-content:not(.mat-calendar-body-selected):not(.mat-calendar-body-comparison-identical) {
      background-color: var(--color-bg-light) !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }

    :host ::ng-deep .has-issue:not(.mat-calendar-body-disabled):hover > .mat-calendar-body-cell-content {
      background-color: var(--accessibility-public-bg) !important;
      filter: brightness(0.95);
    }

    :host ::ng-deep .has-issue.accessibility-private:not(.mat-calendar-body-disabled):hover > .mat-calendar-body-cell-content {
      background-color: var(--accessibility-private-bg) !important;
    }

    :host ::ng-deep .mat-calendar-body-today:not(.mat-calendar-body-selected):not(.mat-calendar-body-comparison-identical) {
      border-color: transparent !important;
    }

    /* Preselected date — fill the full cell */
    :host ::ng-deep .mat-calendar-body-cell.preselected-date .mat-calendar-body-cell-content {
      background-color: var(--color-primary) !important;
      color: white !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }

    :host ::ng-deep .mat-calendar-body-cell.preselected-date:hover .mat-calendar-body-cell-content,
    :host ::ng-deep .mat-calendar-body-cell.preselected-date.has-issue:not(.mat-calendar-body-disabled):hover > .mat-calendar-body-cell-content {
      background-color: var(--color-primary-hover) !important;
    }

    :host ::ng-deep .mat-calendar-body-cell.preselected-date.multiple-issues::after,
    :host ::ng-deep .mat-calendar-body-cell.preselected-date.has-issue.accessibility-private::after {
      color: white !important;
    }
  `,
})
export class CalendarPopupComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  private adapter = inject(DateAdapter);
  private translate = inject(TranslateService);
  private recordHandler = inject(RecordHandlerService);
  private store = inject(Store);
  private cdr = inject(ChangeDetectorRef);

  @Input() year!: string;
  @Input() preselectedDate?: string;
  /**
   * Exact parent volume for the currently opened issue. For the initial year
   * this is more reliable than looking a volume up by year (some periodicals
   * can have more than one volume in the same calendar year).
   */
  @Input() parentVolumeUuid: string = '';
  @Output() dateSelected = new EventEmitter<{ pid: string, year: number }>();
  @Output() closePopup = new EventEmitter<void>();

  // Current view state
  currentMonth = signal(0);
  currentYear = signal(2024);
  currentDate = signal(new Date());
  isLoadingCalendar = signal(false);
  isOpen = false;
  private currentVolumeUuid = signal('');

  // Data map for current month only
  issueMap = signal(new Map<string, { pid: string; accessibility: string, licenses: string[] }[]>());

  // Always lazy load
  currentMonthIssues = signal<any[]>([]);

  // Real years carried by this periodical (drives the year dropdown).
  private availableYearsSig = toSignal(this.store.select(selectAvailableYears), { initialValue: [] as any[] });
  availableYearNumbers = computed(() => {
    const years = (this.availableYearsSig() || [])
      .map((y: any) => parseInt(String(y.year), 10))
      .filter((n: number) => Number.isFinite(n));
    return Array.from(new Set<number>(years)).sort((a, b) => b - a);
  });


  private destroy$ = new Subject<void>();
  private loadingTimeouts = new Map<string, any>();
  private loadGeneration = 0;

  @ViewChild(MatCalendar) calendar!: MatCalendar<Date>;

  monthNames: string[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  constructor() {
    // Init date locale; mat-calendar header uses 'narrow' day names — alias it to 'short'
    // so we get "Po, Út, St…" instead of "P, Ú, S…".
    const originalGetDayOfWeekNames = this.adapter.getDayOfWeekNames.bind(this.adapter);
    this.adapter.getDayOfWeekNames = (style: 'long' | 'short' | 'narrow') =>
      originalGetDayOfWeekNames(style === 'narrow' ? 'short' : style);

    this.adapter.setLocale(this.translate.getCurrentLang());
    this.translate.onLangChange
      .pipe(takeUntil(this.destroy$))
      .subscribe(e => this.adapter.setLocale(e.lang));

    // Set up reactive data loading for current month
    this.setupReactiveDataLoading();
  }

  ngOnInit(): void {
    // Set calendar as open after a small delay to prevent immediate close from click-outside
    setTimeout(() => {
      this.isOpen = true;
    }, 0);
  }

  ngAfterViewInit(): void {
    // Calendar ViewChild is now available
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Handle year changes (including initial setup)
    if (changes['year'] && this.year) {
      const yearNum = parseInt(this.year, 10);
      this.currentYear.set(yearNum);

      // Check if we have a preselected date to determine the starting month
      let startingMonth = 0; // Default to January
      if (this.preselectedDate) {
        const preselectedDateObj = this.parseDate(this.preselectedDate);
        if (preselectedDateObj && preselectedDateObj.getFullYear() === yearNum) {
          startingMonth = preselectedDateObj.getMonth();
        }
      }

      this.currentMonth.set(startingMonth);
      this.updateCurrentDate();
      this.loadCurrentMonthIssues();
      return; // Early return to avoid duplicate processing
    }

    // A different parent volume can have exactly the same year/date as the
    // previous title. Reload explicitly so the popup can never keep the old
    // title's issue map just because its visible date did not change.
    if (changes['parentVolumeUuid'] && !changes['parentVolumeUuid'].firstChange) {
      if (this.preselectedDate) {
        const selected = this.parseDate(this.preselectedDate);
        if (selected) {
          this.currentYear.set(selected.getFullYear());
          this.currentMonth.set(selected.getMonth());
          this.updateCurrentDate();
          this.navigateCalendar();
        }
      }
      this.loadCurrentMonthIssues();
      return;
    }

    // Handle preselected date changes (only if year didn't change)
    if (changes['preselectedDate'] && this.preselectedDate) {
      console.log('Preselected date changed:', this.preselectedDate);
      this.updateCalendarToPreselectedDate();
    }
  }

  private updateCurrentDate(): void {
    const date = new Date(this.currentYear(), this.currentMonth(), 1);
    this.currentDate.set(date);
    console.log(`Updated current date to: ${date.toISOString().split('T')[0]}`);
  }

  private updateCalendarToPreselectedDate(): void {
    if (!this.preselectedDate) return;

    const preselectedDateObj = this.parseDate(this.preselectedDate);
    if (preselectedDateObj) {
      const newMonth = preselectedDateObj.getMonth();
      const newYear = preselectedDateObj.getFullYear();

      if (newMonth !== this.currentMonth() || newYear !== this.currentYear()) {
        this.isLoadingCalendar.set(true);
        this.currentMonth.set(newMonth);
        this.currentYear.set(newYear);
        this.updateCurrentDate();
        this.loadCurrentMonthIssues(); // Lazy load the new month
      } else {
        setTimeout(() => {
          if (this.calendar) {
            this.calendar.updateTodaysDate();
          }
          this.refreshCalendar();
        }, 0);
      }
    }
  }

  previousMonth(): void {
    const currentM = this.currentMonth();
    const currentY = this.currentYear();

    if (currentM === 0) {
      this.currentMonth.set(11);
      this.currentYear.set(currentY - 1);
    } else {
      this.currentMonth.set(currentM - 1);
    }
    this.updateCurrentDate();
    this.navigateCalendar();
    this.loadCurrentMonthIssues();
  }

  nextMonth(): void {
    const currentM = this.currentMonth();
    const currentY = this.currentYear();

    if (currentM === 11) {
      this.currentMonth.set(0);
      this.currentYear.set(currentY + 1);
    } else {
      this.currentMonth.set(currentM + 1);
    }
    this.updateCurrentDate();
    this.navigateCalendar();
    this.loadCurrentMonthIssues();
  }

  private navigateCalendar(): void {
    // Programmatically navigate the Material Calendar to the current month/year
    if (this.calendar) {
      this.calendar.activeDate = new Date(this.currentYear(), this.currentMonth(), 1);
      // Force the calendar to update its view
      this.cdr.detectChanges();
    }
  }

  private refreshCalendar(): void {
    // Force change detection to update calendar display
    this.cdr.detectChanges();
  }


  // Periodical records are usually DD.MM.YYYY, but some installations also
  // expose ISO YYYY-MM-DD. Supporting both prevents valid digitized issues
  // from silently disappearing from the calendar.
  parseDate(str: string): Date | null {
    const value = String(str ?? '').trim();
    let day: number;
    let month: number;
    let year: number;

    let match = value.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
      if (!match) return null;
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    }

    const result = new Date(year, month - 1, day);
    return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day
      ? result
      : null;
  }

  formatDateKey(date: Date): string {
    // Material calendar works with local dates. toISOString() shifts dates in
    // positive time zones (e.g. 1 Jan -> 31 Dec in Czechia), so build the key
    // from local calendar fields instead.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }


  // Only dates with an actual digitized issue are interactive. This is
  // important for weekly/monthly/irregular titles: a normal calendar otherwise
  // falsely suggests that every day is a valid issue date.
  dateFilter = (date: Date | null): boolean => {
    if (!date) return false;
    return this.issueMap().has(this.formatDateKey(date));
  };

  dateClass = (date: Date): string => {
    const dateKey = this.formatDateKey(date);
    let classes = '';

    // Check if this is the preselected date
    if (this.preselectedDate) {
      const preselectedDateObj = this.parseDate(this.preselectedDate);
      if (preselectedDateObj && this.formatDateKey(preselectedDateObj) === dateKey) {
        classes += ' preselected-date';
      }
    }

    // Get current issues from the issueMap signal
    const currentIssueMap = this.issueMap();
    const issues = currentIssueMap.get(dateKey);

    if (issues && issues.length > 0) {
      // If at least one issue variant on this date is readable, the day itself
      // should be presented as readable. A restrictive secondary variant must
      // not make an otherwise accessible date look locked.
      const allIssuesLocked = issues.every(issue =>
        this.recordHandler.isRecordLocked(issue.licenses || []),
      );

      classes += ' has-issue';
      if (issues.length > 1) {
        classes += ' multiple-issues';
        if (issues.length === 2) {
          classes += ' issue-count-2';
        } else {
          classes += ' issue-count-3plus';
        }
      }
      classes += ` accessibility-${allIssuesLocked ? 'private' : 'public'}`;
    }

    return classes.trim();
  };

  onDateSelected(date: Date | null): void {
    if (!date) return;
    const issues = this.issueMap().get(this.formatDateKey(date));
    if (issues && issues.length > 0) {
      const preferredIssue = issues.find(issue => !this.recordHandler.isRecordLocked(issue.licenses || [])) ?? issues[0];
      this.dateSelected.emit({
        pid: preferredIssue.pid,
        year: date.getFullYear()
      });
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closePopup.emit();
  }

  onMonthYearChange(change: MonthYearChange): void {
    this.currentMonth.set(change.month);
    this.currentYear.set(change.year);
    this.updateCurrentDate();
    this.navigateCalendar();
    this.loadCurrentMonthIssues();
  }


  private setupReactiveDataLoading(): void {
    this.store.select(selectPeriodicalState)
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (!this.isLoadingCalendar()) return;

        const volumeUuid = this.currentVolumeUuid();
        if (!volumeUuid) return;

        const year = this.currentYear();
        const month = this.currentMonth() + 1;
        const key = `${volumeUuid}|${year}-${String(month).padStart(2, '0')}`;

        // Ignore changes belonging to another periodical/month. The old code
        // reacted to any monthIssues mutation, which is how stale calendar data
        // leaked between titles.
        if (Object.prototype.hasOwnProperty.call(state?.monthIssues ?? {}, key)) {
          this.updateCurrentMonthFromStore(volumeUuid);
        } else if (state?.monthLoading?.[key] === false) {
          // Failed request: clear old cells rather than leaving a previous month
          // visible forever.
          this.currentMonthIssues.set([]);
          this.issueMap.set(new Map());
          this.isLoadingCalendar.set(false);
          this.refreshCalendar();
        }
      });
  }

  private updateCurrentMonthFromStore(parentVolumeUuid: string): void {
    const year = this.currentYear();
    const month = this.currentMonth() + 1;

    // Get the current data from store (synchronously)
    let currentData: any[] = [];
    this.store.select(selectMonthIssues(parentVolumeUuid, year, month))
      .pipe(take(1))
      .subscribe(issues => {
        currentData = issues as any[];
      });

    // Always clear loading state when data arrives, even if empty
    console.log(`Found ${currentData.length} issues in store for ${year}-${month}, updating calendar`);

    if (currentData.length > 0) {
      this.currentMonthIssues.set(currentData);
      this.updateIssueMapForMonth(currentData);
    } else {
      this.currentMonthIssues.set([]);
      this.issueMap.set(new Map());
      this.refreshCalendar();
    }
    this.isLoadingCalendar.set(false);

  }


  // Always lazy load current month
  loadCurrentMonthIssues(): void {

    const year = this.currentYear();
    const month = this.currentMonth() + 1; // Convert 0-based to 1-based month
    const monthKey = `${year}-${month}`;
    const generation = ++this.loadGeneration;

    // Never show the previous periodical/month while the new data is loading.
    this.currentMonthIssues.set([]);
    this.issueMap.set(new Map());
    this.currentVolumeUuid.set('');

    // A popup has only one visible month. Cancel every pending debounce from
    // older navigation so a late callback cannot restore a previous month/year.
    this.loadingTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.loadingTimeouts.clear();

    // Set loading state
    this.isLoadingCalendar.set(true);

    // Debounce the loading to prevent rapid calls
    const timeoutId = setTimeout(() => {
      if (generation !== this.loadGeneration) return;
      this.loadingTimeouts.delete(monthKey);

      // For the year of the currently opened issue use its exact parent volume.
      // If the user switches to another year, resolve that year's volume from
      // the periodical hierarchy.
      const initialYear = parseInt(this.year, 10);
      const exactCurrentVolume = this.parentVolumeUuid && year === initialYear
        ? this.parentVolumeUuid
        : '';

      const handleVolumeUuid = (uuid: string) => {
        if (generation !== this.loadGeneration) return;

        if (!uuid) {
          console.warn(`No volume UUID found for year ${year}`);
          this.isLoadingCalendar.set(false);
          return;
        }

        this.currentVolumeUuid.set(uuid);

        // Check current state by looking at the raw store data
        this.store.select(selectPeriodicalState).pipe(take(1)).subscribe(state => {
          if (generation !== this.loadGeneration) return;
          const monthKey = `${uuid}|${year}-${String(month).padStart(2, '0')}`;
          const monthIssues = state?.monthIssues[monthKey];
          const isLoading = !!state?.monthLoading[monthKey];
          const hasBeenLoaded = monthKey in (state?.monthIssues || {});

          console.log(`Month ${year}-${month}: hasBeenLoaded=${hasBeenLoaded}, issues=${monthIssues?.length || 0}, loading=${isLoading}`);

          if (!hasBeenLoaded && !isLoading) {
            this.store.dispatch(loadMonthIssues({
              parentVolumeUuid: uuid,
              year,
              month,
            }));
            // Keep loading until the exact cache key is populated (or fails).
          } else if (hasBeenLoaded) {
            this.isLoadingCalendar.set(false);
            this.currentMonthIssues.set(monthIssues ?? []);
            this.updateIssueMapForMonth(monthIssues ?? []);
          }
          // If the exact request is already loading, do nothing. In particular,
          // do not clear the loading overlay and do not reuse another title's data.
        });
      };

      if (exactCurrentVolume) {
        handleVolumeUuid(exactCurrentVolume);
      } else {
        this.store.select(selectPidFromAvailableYears(year.toString())).pipe(take(1)).subscribe(volumeUuid => {
          handleVolumeUuid(volumeUuid as string);
        });
      }
    }, 100); // 100ms debounce

    this.loadingTimeouts.set(monthKey, timeoutId);
  }

  private updateIssueMapForMonth(items: any[]): void {
    const map = new Map<string, { pid: string; accessibility: string, licenses: string[] }[]>();

    for (const item of items) {
      const date = this.parseDate(item['date.str']);
      if (!date || !item.pid) continue;

      const key = this.formatDateKey(date);
      const issueData = {
        pid: item.pid,
        accessibility: item.accessibility || 'private',
        licenses: item.licenses || [],
      };

      if (map.has(key)) {
        map.get(key)!.push(issueData);
      } else {
        map.set(key, [issueData]);
      }
    }

    this.issueMap.set(map);

    // Force calendar to update its date classes
    setTimeout(() => {
      if (this.calendar) {
        this.calendar.updateTodaysDate();
      }
      this.refreshCalendar();
    }, 20);
  }

  ngOnDestroy(): void {
    // Clear all pending timeouts
    this.loadingTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.loadingTimeouts.clear();

    this.destroy$.next();
    this.destroy$.complete();
  }

}
