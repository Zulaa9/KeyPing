import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  // Idiomas soportados en la app.
  private readonly supported = ['en', 'es'];
  private readonly languageSubject = new BehaviorSubject<string>(this.detectLanguage());
  private readonly dictionarySubject = new BehaviorSubject<Record<string, string>>({});
  private readonly cache = new Map<string, Record<string, string>>();
  private readonly loading = new Map<string, Promise<Record<string, string>>>();

  readonly language$ = this.languageSubject.asObservable();

  constructor(private http: HttpClient) {
    void this.use(this.languageSubject.value);
  }

  get currentLanguage(): string {
    return this.languageSubject.value;
  }

  async use(lang: string): Promise<void> {
    const normalized = this.normalize(lang);
    const dict = await this.loadDictionary(normalized);
    this.dictionarySubject.next(dict);
    this.languageSubject.next(normalized);
    try {
      localStorage.setItem('keyping_lang', normalized);
    } catch {
      // Ignora errores de almacenamiento (entornos sin acceso a almacenamiento local o modo privado).
    }
  }

  translate(key: string, params?: Record<string, string | number>): string {
    if (!key) return '';
    const template = this.dictionarySubject.value[key] ?? key;
    return this.interpolate(template, params);
  }

  private async loadDictionary(lang: string): Promise<Record<string, string>> {
    // Cachea diccionarios para evitar recargas HTTP repetidas entre cambios de idioma.
    if (this.cache.has(lang)) {
      return this.cache.get(lang) as Record<string, string>;
    }
    if (this.loading.has(lang)) {
      return this.loading.get(lang) as Promise<Record<string, string>>;
    }

    const loadPromise = this.fetchDictionary(lang);
    this.loading.set(lang, loadPromise);
    const dict = await loadPromise;
    this.loading.delete(lang);
    this.cache.set(lang, dict);
    return dict;
  }

  private async fetchDictionary(lang: string): Promise<Record<string, string>> {
    try {
      const res = await firstValueFrom(
        this.http.get<Record<string, string>>(`assets/i18n/${lang}.json`)
      );
      return res || {};
    } catch (err) {
      console.error(`[i18n] No se pudo cargar el idioma ${lang}`, err);
      return {};
    }
  }

  private interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) return template;
    return template.replace(/{{\s*(.+?)\s*}}/g, (_, key) => {
      const val = params[key];
      return val === undefined || val === null ? '' : String(val);
    });
  }

  private detectLanguage(): string {
    try {
      const stored = localStorage.getItem('keyping_lang');
      if (stored) return this.normalize(stored);
    } catch {
      // Sin almacenamiento disponible: se usa el idioma del navegador o valor por defecto.
    }
    const browserLang =
      typeof navigator !== 'undefined' && navigator.language ? navigator.language : '';
    if (browserLang) {
      return this.normalize(browserLang);
    }
    return 'es';
  }

  private normalize(lang: string): string {
    const short = (lang || '').slice(0, 2).toLowerCase();
    return this.supported.includes(short) ? short : 'en';
  }
}
