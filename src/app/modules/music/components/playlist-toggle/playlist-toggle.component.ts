import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Sidebar toggle that switches the sound-recording detail between the track
 * list ("records", pressed) and the page images ("images", released). Replaces
 * the old records/images tab strip - the design puts a single stateful button
 * above the search input instead.
 */
@Component({
  selector: 'app-playlist-toggle',
  imports: [TranslatePipe],
  templateUrl: './playlist-toggle.component.html',
  styleUrl: './playlist-toggle.component.scss'
})
export class PlaylistToggleComponent {

  /** Pressed state: true while the track list is the active view. */
  @Input() active = false;
  @Input() trackCount = 0;

  @Output() toggled = new EventEmitter<boolean>();

  /** Czech/Slovak/Polish need a singular form, so the count picks the key. */
  get trackCountLabel(): string {
    return this.trackCount === 1
      ? 'sound-records--track-count-one'
      : 'sound-records--track-count';
  }
}
