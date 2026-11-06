/** Your own settings, as sections of /settings. */
export const SETTINGS_SECTIONS = [
  {
    id: "account",
    label: "Account",
    hint: "Profile and security",
    icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  },
  {
    id: "finance",
    label: "Finance",
    hint: "Wallet and payouts",
    icon: "M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h.01",
  },
  {
    id: "prefs",
    label: "Preferences",
    hint: "Theme, emails, shortcuts",
    icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  },
  {
    id: "agents",
    label: "Agents & API",
    hint: "Agents, team, integrations",
    icon: "M4 8h16v12H4zM12 4v4M9 14h.01M15 14h.01",
  },
  {
    id: "data",
    label: "Data & privacy",
    hint: "Export or delete account",
    icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];
