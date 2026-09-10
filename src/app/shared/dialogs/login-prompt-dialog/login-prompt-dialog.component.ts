import {Component, EventEmitter, inject, Output} from '@angular/core';
import {TranslatePipe} from '@ngx-translate/core';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';

export interface LoginPromptDialogData {
  titleKey?: string;
  messageKey?: string;
}

@Component({
  selector: 'app-login-prompt-dialog',
  imports: [
    TranslatePipe,
  ],
  templateUrl: './login-prompt-dialog.component.html',
  styleUrls: ['./login-prompt-dialog.component.scss', '../generic-dialog.scss'],
})
export class LoginPromptDialogComponent {

  @Output() close = new EventEmitter<void>();
  @Output() login = new EventEmitter<void>();

  private dialogRef = inject(MatDialogRef<LoginPromptDialogComponent>, { optional: true });
  data = inject<LoginPromptDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  titleKey = this.data?.titleKey ?? 'login-required-favorites-title';
  messageKey = this.data?.messageKey ?? 'login-prompt-message-favorites';

  onClose() {
    this.close.emit();
    this.dialogRef?.close('cancel');
  }

  onLogin() {
    this.login.emit();
    this.dialogRef?.close('login');
  }
}
