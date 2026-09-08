"use client";

import { createContext, useContext } from "react";
import { messages, type Locale, type Messages } from "./messages";

const Ctx = createContext<{ locale: Locale; m: Messages }>({ locale: "en", m: messages.en });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={{ locale, m: messages[locale] }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
