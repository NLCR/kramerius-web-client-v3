import {Component, HostListener, inject, Input} from '@angular/core';
import {
  FilterSidebarComponent
} from "../../../modules/search-results-page/components/filter-sidebar/filter-sidebar.component";
import {DetailViewService} from '../../../modules/detail-view-page/services/detail-view.service';
import {TranslatePipe} from '@ngx-translate/core';

@Component({
  selector: 'app-detail-layout',
  imports: [
    FilterSidebarComponent,
    TranslatePipe
  ],
  templateUrl: './detail-layout.component.html',
  styleUrl: './detail-layout.component.scss'
})
export class DetailLayoutComponent {

  @Input() constrainBottomToolbar = false;

  @Input() showBottomToolbar = true;

  @Input() showRightSidebar = false;

  @Input() rightSidebarCollapsed = false;

  @Input() hideFilterToggle = false;

  /** Forwarded to the left filter-sidebar's mobile slide-up header. */
  @Input() leftSidebarMobileTitleKey = 'filters';

  /**
   * Drops the left slide-up's caption on mobile, keeping only its close button.
   * The document/recording panels below are self-describing, so the caption was
   * both redundant and a waste of phone height (GitHub issue #177).
   */
  @Input() hideLeftSidebarMobileTitle = false;

  private detailViewService = inject(DetailViewService);

  @HostListener('document:keydown', ['$event'])
  keydownHandler(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowLeft': {
        this.detailViewService.goToPrevious();
        break;
      }
      case 'ArrowRight': {
        this.detailViewService.goToNext();
        break;
      }
      case 'ArrowUp': {
        // go -3 pages
        this.detailViewService.goToPrevious(3);
        break;
      }
      case 'ArrowDown': {
        // go +3 pages
        this.detailViewService.goToNext(3);
        break;
      }
      default: {
        // Do nothing
      }
    }
  }

}
