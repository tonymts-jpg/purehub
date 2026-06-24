export const CONTENT_CATEGORIES = ["Cosplay", "美足", "調教", "戶外", "R18"] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

const LEGACY_CATEGORY_MAP: Record<string, ContentCategory> = {
  数字艺术: "Cosplay",
  摄影: "美足",
  动画: "調教",
  音乐: "戶外",
  设计: "R18",
  游戏: "Cosplay"
};

export function migrateCategory(category: string): ContentCategory {
  if ((CONTENT_CATEGORIES as readonly string[]).includes(category)) {
    return category as ContentCategory;
  }
  return LEGACY_CATEGORY_MAP[category] ?? "Cosplay";
}
