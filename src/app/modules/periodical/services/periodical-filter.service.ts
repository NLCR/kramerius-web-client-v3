import { computed, Injectable } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, of } from 'rxjs';
import { FacetPageQuery, FacetPageResult, FilterService } from '../../../shared/services/filter.service';
import { Store } from '@ngrx/store';
import {map} from 'rxjs/operators';
import {UserService} from '../../../shared/services/user.service';

@Injectable({
  providedIn: 'root'
})
export class PeriodicalFilterService implements FilterService {
  constructor(
    private store: Store,
    private userService: UserService,
  ) {

    // Fire-and-forget: not awaited by design (constructors can't be async),
    // but an unhandled rejection here (e.g. API URL not ready yet) otherwise
    // surfaces as a bare, contextless error via the global ErrorHandler.
    this.load().catch(err => console.warn('PeriodicalFilterService: failed to preload user licenses on startup.', err));

  }

  async load() {
    await this.userService.loadLicenses();
  }

  getFacets(): Observable<any> {
    // todo implement
    return this.store.pipe()
  }

  getFiltersWithOperators(): Observable<Record<string, string>> {
    // todo implement, now just return empty object
    return this.store.pipe(
      map(() => ({}))
    );
  }

  toggleFilter(route: ActivatedRoute, fullValue: string): void {
    // Implement filter toggle logic for periodicals
    const [facetKey, value] = fullValue.split(':');
    // Add your periodical-specific filter toggle logic here
  }

  updateFilters(route: ActivatedRoute, facetKey: string, selectedValues: string[]): void {
    // todo implement
  }

  loadFacetPage(facetKey: string, query: FacetPageQuery): Observable<FacetPageResult> {
    // todo implement — stub returns no items
    return of({ items: [], totalCount: 0 });
  }

  readonly hasSubmittedQuery = computed(() => false);
  readonly hasFulltextFilter = computed(() => false);
  readonly filtersContainDate = computed(() => false);

  resetPage() {

  }
}
