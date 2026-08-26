import {Component, EventEmitter, HostBinding, inject, Input, OnDestroy, OnInit, Output, signal} from '@angular/core';
import {AsyncPipe, NgClass, NgIf} from '@angular/common';
import {SoundTrackModel, TrackViewType} from '../../../models/sound-track.model';
import {TranslatePipe} from '@ngx-translate/core';
import {MusicService} from '../../services/music.service';
import {Observable, EMPTY} from 'rxjs';
import {FavoritesService} from '../../../../shared/services/favorites.service';
import {UserService} from '../../../../shared/services/user.service';
import {CdkTooltipDirective} from '../../../../shared/directives';
import {ThumbnailImageComponent} from '../../../../shared/components/thumbnail-image/thumbnail-image.component';

@Component({
  selector: '[app-music-track-item]',
  imports: [
    NgIf,
    TranslatePipe,
    AsyncPipe,
    NgClass,
    CdkTooltipDirective,
    ThumbnailImageComponent,
  ],
  templateUrl: './music-track-item.component.html',
  styleUrls: ['./music-track-item.component.scss', '../music-track-list-table.scss'],
  standalone: true
})
export class MusicTrackItemComponent implements OnInit, OnDestroy {

  isMouseOverFavorite = false;

  // Fallback duration (seconds) read directly from the audio file when Solr's
  // 'track.length' is missing/0 — mirrors how the player itself determines
  // duration (from the loaded audio element), so the list stops showing "0:00"
  // for tracks whose Solr metadata never got a length.
  private probedDurationSeconds = signal<number | null>(null);
  private probeAudio: HTMLAudioElement | null = null;

  public musicService = inject(MusicService);
  private favoritesService = inject(FavoritesService);
  private userService = inject(UserService);

  @Input() track!: SoundTrackModel;
  @Input() index: number = 0;
  @Input() selectedPid: string | null = null;
  @Input() playingPid: string | null = null;
  @Input() viewType: TrackViewType = TrackViewType.DEFAULT;

  @Output() trackSelected = new EventEmitter<SoundTrackModel>();
  @Output() addToQueueClicked = new EventEmitter<SoundTrackModel>();
  @Output() toggleFavoriteClicked = new EventEmitter<{track: SoundTrackModel, event: Event}>();
  @Output() downloadClicked = new EventEmitter<SoundTrackModel>();
  @Output() removeClicked = new EventEmitter<SoundTrackModel>();

  isFavorited$: Observable<boolean> = EMPTY;

  ngOnInit() {
    if (this.track?.pid) {
      this.isFavorited$ = this.favoritesService.getFavoritedStatus(this.track.pid);
    }

    if (!this.track?.['track.length'] && this.track?.url) {
      this.probeAudio = new Audio();
      this.probeAudio.preload = 'metadata';
      this.probeAudio.addEventListener('loadedmetadata', () => {
        if (this.probeAudio && isFinite(this.probeAudio.duration)) {
          this.probedDurationSeconds.set(this.probeAudio.duration);
        }
      });
      this.probeAudio.src = this.track.url;
    }
  }

  ngOnDestroy(): void {
    if (this.probeAudio) {
      this.probeAudio.removeAttribute('src');
      this.probeAudio.load();
      this.probeAudio = null;
    }
  }

  get isSelected(): boolean {
    return this.track?.pid === this.selectedPid;
  }

  get isPlaying(): boolean {
    return this.track?.pid === this.playingPid;
  }

  get isFolderView(): boolean {
    return this.viewType === TrackViewType.FOLDER;
  }

  get showRemoveButton(): boolean {
    return this.isFolderView;
  }

  get primaryAuthor(): string {
    return this.track?.authors && this.track.authors.length > 0 ? this.track.authors[0] : '';
  }

  get trackYear(): string {
    return this.track?.year ? this.track.year.toString() : '';
  }

  get duration(): string {
    const seconds = this.track?.['track.length'] || this.probedDurationSeconds();
    if (seconds == null) {
      return '-';
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  get pageReference(): string {
    return ''
    //return this.track?.['page.number'] ? `Strana ${this.track['page.number']}` : '';
  }

  select(): void {
    this.trackSelected.emit(this.track);
  }

  addToQueue(): void {
    this.addToQueueClicked.emit(this.track);
  }

  toggleFavorite(event: Event): void {
    this.toggleFavoriteClicked.emit({track: this.track, event});
  }

  download(): void {
    this.downloadClicked.emit(this.track);
  }

  remove(): void {
    this.removeClicked.emit(this.track);
  }

  get canAccessTrack(): boolean {
    return this.userService.hasAnyLicense(this.track?.licenses_of_ancestors || []);
  }

  @HostBinding('class.disabled')
  get isDisabled(): boolean {
    return !this.canAccessTrack;
  }
}
