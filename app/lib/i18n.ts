import en from "~/locales/en.json";

type Translations = typeof en;
type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string ? `${K & string}.${NestedKeyOf<T[K]>}` : never }[keyof T]
  : never;

export type TranslationKey = NestedKeyOf<Translations>;

// Current locale (always "en" for now — future: detect from request)
const translations: Translations = en;

export function t(key: TranslationKey): string {
  const parts = key.split(".");
  let current: unknown = translations;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key; // fallback to key name
    }
  }
  return typeof current === "string" ? current : key;
}
