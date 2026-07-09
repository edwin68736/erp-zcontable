import {
  OPERATIONAL_MODULES,
  STUDIO_SECTION,
  isSidebarLinkVisible,
  type SidebarLinkItem,
} from './sidebarConfig';

export type HomeSection = {
  id: string;
  label: string;
  icon: string;
  items: SidebarLinkItem[];
};

/** Secciones y accesos directos según permisos del usuario (misma regla que el menú lateral). */
export function getHomeSections(): HomeSection[] {
  const sections: HomeSection[] = [];

  for (const mod of OPERATIONAL_MODULES) {
    const items: SidebarLinkItem[] = [];
    for (const entry of mod.entries) {
      if (entry.type === 'link') {
        if (isSidebarLinkVisible(entry)) items.push(entry);
      } else {
        for (const link of entry.items) {
          if (isSidebarLinkVisible(link)) items.push(link);
        }
      }
    }
    if (items.length > 0) {
      sections.push({ id: mod.id, label: mod.label, icon: mod.icon, items });
    }
  }

  const studioItems = STUDIO_SECTION.items.filter((l) => isSidebarLinkVisible(l));
  if (studioItems.length > 0) {
    sections.push({
      id: STUDIO_SECTION.id,
      label: STUDIO_SECTION.label,
      icon: STUDIO_SECTION.icon,
      items: studioItems,
    });
  }

  return sections;
}
