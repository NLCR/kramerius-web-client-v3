import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ModelBadgeComponent } from './model-badge.component';
import { DocumentTypeEnum } from '../../../modules/constants/document-type';

describe('ModelBadgeComponent icon', () => {
  function render(model: DocumentTypeEnum, monographUnitCount = 0) {
    TestBed.configureTestingModule({
      imports: [ModelBadgeComponent, TranslateModule.forRoot()],
    });
    const fixture = TestBed.createComponent(ModelBadgeComponent);
    fixture.componentInstance.model = model;
    fixture.componentInstance.monographUnitCount = monographUnitCount;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.badge.model i') as HTMLElement | null;
  }

  it('shows the same icon as the document-type filter for a single-volume monograph', () => {
    const icon = render(DocumentTypeEnum.monograph);
    expect(icon?.className).toBe('icon-book-1');
  });

  it('shows the double-book icon for a multivolume monograph instead of the plain one', () => {
    const icon = render(DocumentTypeEnum.monograph, 3);
    expect(icon?.className).toBe('icon-book-2');
  });

  it('shows the collection icon', () => {
    const icon = render(DocumentTypeEnum.collection);
    expect(icon?.className).toBe('icon-layer');
  });

  it('renders no icon element for a model without one (e.g. a page)', () => {
    const icon = render(DocumentTypeEnum.page);
    expect(icon).toBeNull();
  });
});
