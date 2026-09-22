"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Select } from "./select";
import { translate } from "@/lib/ui-translations";
type Language = "en" | "fr";
type Theme = "dark" | "light";
const Preferences = createContext({ language: "en" as Language, theme: "dark" as Theme, setLanguage: (_value: Language) => {}, setTheme: (_value: Theme) => {} });
export function PreferencesProvider({ children, initialLanguage, initialTheme }: { children: React.ReactNode; initialLanguage: Language; initialTheme: Theme }) {
  const [language, setLanguage] = useState(initialLanguage), [theme, setTheme] = useState(initialTheme);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dataset.theme = theme; document.cookie = `hooka-language=${language}; Path=/; Max-Age=31536000; SameSite=Lax`; document.cookie = `hooka-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`; }, [language, theme]);
  return <Preferences.Provider value={{ language, theme, setLanguage, setTheme }}>{children}</Preferences.Provider>;
}
export function useTranslation() { const { language } = useContext(Preferences); return (text: string) => translate(text, language); }
export function T({ text }: { text: string }) { const t = useTranslation(); return <>{t(text)}</>; }
export function PreferencesMenu() {
  const { language, theme, setLanguage, setTheme } = useContext(Preferences);
  return <div className="preferences" role="group" aria-label={language === "fr" ? "Préférences d’affichage" : "Display preferences"}><button type="button" className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={language === "fr" ? (theme === "dark" ? "Activer le thème clair" : "Activer le thème sombre") : (theme === "dark" ? "Switch to light theme" : "Switch to dark theme")} title={theme === "dark" ? "Light / Clair" : "Dark / Sombre"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><Select label={language === "fr" ? "Langue" : "Language"} value={language} onChange={value => setLanguage(value as Language)} options={[{ value: "en", label: "English" }, { value: "fr", label: "Français" }]} /></div>;
}
