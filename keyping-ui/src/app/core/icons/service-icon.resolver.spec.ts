import { resolveEntryIcon } from './service-icon.resolver';

describe('service icon resolver', () => {
  it('detects by domain with highest confidence', () => {
    const result = resolveEntryIcon({
      label: 'Random',
      loginUrl: 'https://store.steampowered.com/account'
    });
    expect(result.serviceId).toBe('steam');
    expect(result.source).toBe('domain');
    expect(result.isAutoDetected).toBeTrue();
  });

  it('detects by title keyword', () => {
    const result = resolveEntryIcon({
      label: 'GitHub Personal'
    });
    expect(result.serviceId).toBe('github');
    expect(result.source).toBe('title');
  });

  it('detects exact X title as x/twitter', () => {
    const result = resolveEntryIcon({
      label: 'X'
    });
    expect(result.serviceId).toBe('twitterx');
    expect(result.source).toBe('title');
  });

  it('detects by email domain', () => {
    const result = resolveEntryIcon({
      email: 'usuario@outlook.com'
    });
    expect(result.serviceId).toBe('outlook');
    expect(result.source).toBe('username');
  });

  it('detects newly added services by domain', () => {
    const result = resolveEntryIcon({
      loginUrl: 'https://mycompany.atlassian.net/jira/software/projects/ABC'
    });
    expect(result.serviceId).toBe('jira');
    expect(result.source).toBe('domain');
  });

  it('detects newly added services by title', () => {
    const result = resolveEntryIcon({
      label: 'Telegram personal'
    });
    expect(result.serviceId).toBe('telegram');
    expect(result.source).toBe('title');
  });

  it('keeps title priority over username matches', () => {
    const result = resolveEntryIcon({
      label: 'GitHub Personal',
      email: 'usuario@outlook.com'
    });
    expect(result.serviceId).toBe('github');
    expect(result.source).toBe('title');
  });

  it('prefers domain over title conflicts', () => {
    const result = resolveEntryIcon({
      label: 'Steam account',
      loginUrl: 'https://github.com/zula'
    });
    expect(result.serviceId).toBe('github');
    expect(result.source).toBe('domain');
  });

  it('resolves mail.google.com consistently as gmail', () => {
    const result = resolveEntryIcon({
      loginUrl: 'https://mail.google.com/mail/u/0'
    });
    expect(result.serviceId).toBe('gmail');
    expect(result.source).toBe('domain');
  });

  it('respects manual icon assignment', () => {
    const result = resolveEntryIcon({
      label: 'Steam Zula',
      iconName: 'custom-star',
      iconSource: 'manual',
      detectedService: 'custom'
    });
    expect(result.iconName).toBe('custom-star');
    expect(result.source).toBe('manual');
    expect(result.isAutoDetected).toBeFalse();
  });

  it('falls back to generic when there is no match', () => {
    const result = resolveEntryIcon({
      label: 'My Intranet Service'
    });
    expect(result.serviceId).toBe('generic');
    expect(result.iconName).toBe('generic');
    expect(result.source).toBe('fallback');
  });

  it('avoids ambiguous false positives', () => {
    const result = resolveEntryIcon({
      label: 'x account',
      username: 'prime_user'
    });
    expect(result.serviceId).toBe('generic');
    expect(result.source).toBe('fallback');
  });
});
