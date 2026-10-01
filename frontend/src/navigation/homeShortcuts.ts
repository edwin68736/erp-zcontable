import {
  OPERATIONAL_MODULES,
  STUDIO_SECTION,
  filterSidebarEntries,
  isOperationalModuleVisible,
  isSidebarLinkVisible,
  isStudioSectionVisible,
  type SidebarLinkItem,
} from './sidebarConfig';

export type HomeSection = {
  id: string;
  label: string;
  icon: string;
  items: SidebarLinkItem[];
};

/**
 * Secciones y accesos directos según permisos del usuario — misma regla que el menú lateral:
 * reusa `isOperationalModuleVisible`/`filterSidebarEntries` (en vez de reimplementar el filtro acá)
 * para que el gate adicional por módulo (`moduleGatePermission`, ej. "Supervisores" solo visible
 * para quien aprueba declaraciones) también aplique en el home, no solo en el sidebar.
 */
export function getHomeSections(): HomeSection[] {
  const sections: HomeSection[] = [];

  for (const mod of OPERATIONAL_MODULES) {
    if (!isOperationalModuleVisible(mod)) continue;
    const items: SidebarLinkItem[] = [];
    for (const entry of filterSidebarEntries(mod.entries)) {
      if (entry.type === 'link') items.push(entry);
      else items.push(...entry.items);
    }
    if (items.length > 0) {
      sections.push({ id: mod.id, label: mod.label, icon: mod.icon, items });
    }
  }

  const studioItems = isStudioSectionVisible() ? STUDIO_SECTION.items.filter((l) => isSidebarLinkVisible(l)) : [];
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
