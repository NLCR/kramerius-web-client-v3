import { Component, EventEmitter, Output, inject } from '@angular/core';
import { ConfigService } from '../../../core/config';
import { TranslatePipe } from '@ngx-translate/core';
import { DetailViewService } from '../../../modules/detail-view-page/services/detail-view.service';

@Component({
    selector: 'app-selection-controls',
    standalone: true,
    imports: [TranslatePipe],
    templateUrl: './selection-controls.html',
    styleUrl: './selection-controls.scss'
})
export class SelectionControls {
    @Output() text = new EventEmitter<void>();
    @Output() export = new EventEmitter<void>();
    @Output() share = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    private configService = inject(ConfigService);
    private detailViewService = inject(DetailViewService, { optional: true });

    // Selection control visibility getters
    get showText(): boolean {
        return this.configService.isSelectionControlEnabled('text');
    }

    /**
     * The crop *download* button. Selecting an area and previewing its text stay
     * available under a restricted license — only taking the image away is
     * blocked, which is exactly what `crop: false` means (DNNTO).
     *
     * Outside the detail view there is no document to consult (the component is
     * also used where no DetailViewService is provided), so the license gate
     * defers to the config gate alone.
     */
    get showExport(): boolean {
        return this.configService.isSelectionControlEnabled('export')
            && (this.detailViewService?.isActionAllowed('crop') ?? true);
    }

    get showShare(): boolean {
        return this.configService.isSelectionControlEnabled('share');
    }

    onCancel() {
        this.cancel.emit();
    }

    onText() {
        this.text.emit();
    }

    onExport() {
        this.export.emit();
    }

    onShare() {
        this.share.emit();
    }
}
