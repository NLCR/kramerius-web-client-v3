import { createReducer, on } from '@ngrx/store';
import {
  loadPeriodical, loadPeriodicalFailure,
  loadPeriodicalSuccess, setPeriodicalSearchParams,
  loadPeriodicalItems, loadPeriodicalItemsSuccess, loadPeriodicalItemsFailure, loadMonthIssues, loadMonthIssuesSuccess,
  loadMonthIssuesFailure, resetPeriodicalDetail,
} from './periodical-detail.actions';
import {PeriodicalItem, PeriodicalItemChild, PeriodicalItemYear} from '../../../models/periodical-item';
import {Metadata} from '../../../../shared/models/metadata.model';
import {SolrOperators, SolrSortDirections, SolrSortFields} from '../../../../core/solr/solr-helpers';
import {monthCacheKey} from './periodical-detail.selectors';

export interface PeriodicalDetailState {
  activeUuid: string | null;
  activeItemsParentUuid: string | null;
  document: PeriodicalItem | null;
  metadata: Metadata | null;
  years: PeriodicalItemYear[];
  availableYears: PeriodicalItemYear[];
  children: PeriodicalItemChild[];
  loading: boolean;
  error: any;
  searchParams: {
    filters: string[];
    advancedQuery?: string;
    page: number;
    pageCount: number;
    sortBy: any;
    sortDirection: any;
    cdkCollection?: string | null;
  };
  monthIssues: Record<string, any[]>;
  monthLoading: Record<string, boolean>;
}

export const initialState: PeriodicalDetailState = {
  activeUuid: null,
  activeItemsParentUuid: null,
  document: null,
  metadata: null,
  years: [],
  availableYears: [],
  children: [],
  loading: false,
  error: null,
  searchParams: {
    filters: [],
    advancedQuery: '',
    page: 1,
    pageCount: 10000,
    sortBy: SolrSortFields.dateMin,
    sortDirection: SolrSortDirections.asc,
    cdkCollection: null
  },
  monthIssues: {},
  monthLoading: {}
};

export const periodicalDetailReducer = createReducer(
  initialState,
  on(loadPeriodical, (state, { uuid }) => {
    const contextChanged = state.activeUuid !== uuid;
    return {
      ...state,
      activeUuid: uuid,
      loading: true,
      error: null,
      // A different periodical/volume must never inherit navigation or calendar
      // state from the previously opened title. This was the source of stale
      // dates appearing in the date popup.
      document: null,
      metadata: null,
      ...(contextChanged ? {
        years: [],
        availableYears: [],
        children: [],
        activeItemsParentUuid: null,
        monthIssues: {},
        monthLoading: {},
      } : {}),
    };
  }),
  on(setPeriodicalSearchParams, (state, { filters, advancedQuery, page, pageCount, sortBy, sortDirection, cdkCollection }) => {
    console.log('setPeriodicalSearchParams reducer - filters:', {
      filters,
      advancedQuery,
      page,
      pageCount,
      sortBy,
      sortDirection
    });
    return {
      ...state,
      searchParams: {
        filters,
        advancedQuery,
        page,
        pageCount,
        sortBy,
        sortDirection,
        cdkCollection
      }
    };
  }),
  on(loadPeriodicalSuccess, (state, { document, metadata, years, availableYears, children, facets }) => {
    // Ignore a late response belonging to a title that is no longer active.
    if (state.activeUuid && metadata?.uuid && metadata.uuid !== state.activeUuid) {
      return state;
    }
    return {
      ...state,
      loading: false,
      facets: facets ?? {},
      document,
      metadata,
      years,
      availableYears: availableYears ?? state.availableYears,
      children: children || []
    };
  }),
  on(loadPeriodicalFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadPeriodicalItems, (state, { parentVolumeUuid }) => {
    const volumeChanged = state.activeItemsParentUuid !== parentVolumeUuid;
    return {
      ...state,
      loading: true,
      error: null,
      activeItemsParentUuid: parentVolumeUuid,
      // Clear the old volume immediately so detail navigation cannot briefly use
      // issues from the previously opened volume.
      children: [],
      // availableYears belongs to the *root periodical*, not globally to the
      // application. When the parent volume changes we cannot prove it is the
      // same title, so invalidate the hierarchy and month cache. The effect will
      // reload the proper root volumes from the new child's root.pid.
      ...(volumeChanged ? {
        years: [],
        availableYears: [],
        monthIssues: {},
        monthLoading: {},
      } : {}),
    };
  }),
  on(loadPeriodicalItemsSuccess, (state, { parentVolumeUuid, children, availableYears }) => {
    if (state.activeItemsParentUuid && state.activeItemsParentUuid !== parentVolumeUuid) {
      return state;
    }
    return {
      ...state,
      loading: false,
      children: children || [],
      availableYears: availableYears ?? state.availableYears,
    };
  }),
  on(loadPeriodicalItemsFailure, (state, { parentVolumeUuid, error }) =>
    state.activeItemsParentUuid && state.activeItemsParentUuid !== parentVolumeUuid
      ? state
      : ({ ...state, loading: false, error })
  ),
  on(loadMonthIssues, (state, { parentVolumeUuid, year, month }) => {
    const key = monthCacheKey(parentVolumeUuid, year, month);
    return {
      ...state,
      monthLoading: { ...state.monthLoading, [key]: true }
    };
  }),
  on(loadMonthIssuesSuccess, (state, { parentVolumeUuid, year, month, issues }) => {
    const key = monthCacheKey(parentVolumeUuid, year, month);
    return {
      ...state,
      monthIssues: { ...state.monthIssues, [key]: issues },
      monthLoading: { ...state.monthLoading, [key]: false }
    };
  }),
  on(loadMonthIssuesFailure, (state, { parentVolumeUuid, year, month }) => {
    const key = monthCacheKey(parentVolumeUuid, year, month);
    return {
      ...state,
      monthLoading: { ...state.monthLoading, [key]: false }
    };
  }),
  on(resetPeriodicalDetail, () => ({ ...initialState })),
);
