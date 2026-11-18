import { checkEntryUrl } from './url-utils';

describe('checkEntryUrl (renderer)', () => {
  it('acepta enlaces sin esquema y rechaza los peligrosos', () => {
    expect(checkEntryUrl('github.com/settings').ok).toBeTrue();
    expect(checkEntryUrl('javascript:alert(1)').ok).toBeFalse();
    expect(checkEntryUrl('file:///etc/passwd').ok).toBeFalse();
    expect(checkEntryUrl('\\\\srv\\share').ok).toBeFalse();
  });
});
