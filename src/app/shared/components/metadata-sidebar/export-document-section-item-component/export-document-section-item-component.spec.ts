import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DirectPdfService } from '../../../services/direct-pdf.service';
import { ToastService } from '../../../services/toast.service';
import { ExportDocumentSectionItemComponent } from './export-document-section-item-component';

describe('ExportDocumentSectionItemComponent confirm label', () => {
  let fixture: ComponentFixture<ExportDocumentSectionItemComponent>;
  let component: ExportDocumentSectionItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExportDocumentSectionItemComponent, TranslateModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: DirectPdfService, useValue: { getInfo: () => Promise.resolve(null) } },
        { provide: ToastService, useValue: { show: () => {} } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ExportDocumentSectionItemComponent);
    component = fixture.componentInstance;
    component.options = [
      { label: 'current-page', value: 'current-page', disabled: false },
      { label: 'whole-document', value: 'whole-document', disabled: false },
      { label: 'select-pages', value: 'select-pages', disabled: false },
    ];
    component.loginRequired = true;
    component.loginFreeOptions = ['current-page'];
  });

  const label = () => {
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('button.button.primary') as HTMLElement).textContent!.trim();
  };

  it('says just "confirm" for an option that needs no login', () => {
    component.selectedOption = 'current-page';
    expect(label()).toBe('confirm');
  });

  it('mentions the login for options that need it', () => {
    component.selectedOption = 'whole-document';
    expect(label()).toBe('confirm--login-required');
    component.selectedOption = 'select-pages';
    expect(label()).toBe('confirm--login-required');
  });

  it('says just "confirm" once logged in', () => {
    component.loginRequired = false;
    component.selectedOption = 'whole-document';
    expect(label()).toBe('confirm');
  });
});
