import { describe, expect, it } from 'vitest';
import {
  canSubmitTemplateActivity,
  filterActiveTemplates,
  formatTemplateOptionLabel,
  validateActivityDays,
} from './activityTemplateSelectorUtils';
import type { ActivityTemplate } from '../../../services/activityTemplates';

const templates: ActivityTemplate[] = [
  {
    id: 1,
    code: 'AC001',
    name: 'Generación NPS',
    activity_type: 'nps',
    priority: 'media',
    text_color: '#1d4ed8',
    sort_order: 0,
    is_validatable: true,
    active: true,
  },
  {
    id: 2,
    code: 'AC002',
    name: 'PDT 601 mensual',
    activity_type: 'pdt_601',
    priority: 'alta',
    text_color: '#b91c1c',
    sort_order: 1,
    is_validatable: true,
    active: false,
  },
  {
    id: 3,
    code: 'AC003',
    name: 'Cierre contable',
    activity_type: 'closing',
    priority: 'critica',
    text_color: '#047857',
    sort_order: 2,
    is_validatable: false,
    active: true,
  },
];

describe('formatTemplateOptionLabel', () => {
  it('formatea código y nombre', () => {
    expect(formatTemplateOptionLabel({ code: 'AC002', name: 'Generación NPS' })).toBe(
      'AC002 - Generación NPS',
    );
  });
});

describe('filterActiveTemplates', () => {
  it('oculta plantillas inactivas', () => {
    expect(filterActiveTemplates(templates, '')).toHaveLength(2);
    expect(filterActiveTemplates(templates, '').every((t) => t.active)).toBe(true);
  });

  it('filtra por código', () => {
    const rows = filterActiveTemplates(templates, 'ac003');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('AC003');
  });

  it('filtra por nombre', () => {
    const rows = filterActiveTemplates(templates, 'nps');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Generación NPS');
  });

  it('no devuelve inactivas aunque coincidan en búsqueda', () => {
    expect(filterActiveTemplates(templates, 'pdt 601')).toHaveLength(0);
  });
});

describe('validateActivityDays', () => {
  it('normaliza rango y due_day dentro del mes', () => {
    const result = validateActivityDays(5, 3, 31, 30);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.days).toEqual({ start_day: 5, end_day: 5, due_day: 30 });
    }
  });

  it('rechaza días no numéricos', () => {
    expect(validateActivityDays(Number.NaN, 5, 5, 31).ok).toBe(false);
  });
});

describe('canSubmitTemplateActivity', () => {
  it('requiere activity_template_id y días válidos', () => {
    expect(canSubmitTemplateActivity(null, 1, 1, 1, 31)).toBe(false);
    expect(canSubmitTemplateActivity(0, 1, 1, 1, 31)).toBe(false);
    expect(canSubmitTemplateActivity(5, 1, 1, 1, 31)).toBe(true);
  });
});
