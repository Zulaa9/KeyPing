import { generatePassword, secureRandomInt } from './password-generator';

describe('generatePassword', () => {
  it('usa Web Crypto y nunca Math.random', () => {
    const cryptoSpy = spyOn(crypto, 'getRandomValues').and.callThrough();
    const mathSpy = spyOn(Math, 'random').and.callThrough();
    generatePassword({ length: 32 });
    expect(cryptoSpy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
  });

  it('respeta la longitud e incluye todos los tipos pedidos', () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generatePassword({ length: 12, upper: true, lower: true, numbers: true, symbols: true });
      expect(pwd.length).toBe(12);
      expect(/[A-Z]/.test(pwd)).toBeTrue();
      expect(/[a-z]/.test(pwd)).toBeTrue();
      expect(/\d/.test(pwd)).toBeTrue();
      expect(/[^A-Za-z0-9]/.test(pwd)).toBeTrue();
    }
    expect(/^[a-z]+$/.test(generatePassword({ length: 10, upper: false, numbers: false, symbols: false }))).toBeTrue();
  });

  it('descarta valores sesgados (muestreo por rechazo)', () => {
    const values = [0xffffffff, 7];
    const rng = (buf: Uint32Array) => { buf[0] = values.shift()!; return buf; };
    expect(secureRandomInt(10, rng)).toBe(7);
  });
});
