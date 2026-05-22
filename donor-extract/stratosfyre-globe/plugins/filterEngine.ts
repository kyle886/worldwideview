/**
 * Generic filter application.
 *
 * Adapted from WWV's src/core/filters/filterEngine.ts. The only change:
 * parameterized over `<T>` so it isn't tied to `GeoEntity.properties`. Each
 * plugin tells the engine which property keys to read via its
 * `FilterDefinition.propertyKey`.
 *
 * Semantics: AND across active filters. An empty value (empty text, no
 * select options) is treated as "filter off, keep everything."
 */

import type { FilterDefinition, FilterValue } from './types';

export function applyFilters<T extends Record<string, unknown>>(
  data: T[],
  definitions: FilterDefinition[],
  activeFilters: Record<string, FilterValue>,
): T[] {
  const entries = Object.entries(activeFilters);
  if (entries.length === 0) return data;

  const defMap = new Map(definitions.map((d) => [d.id, d]));

  return data.filter((datum) => {
    for (const [filterId, value] of entries) {
      const def = defMap.get(filterId);
      if (!def) continue;
      const propValue = datum[def.propertyKey];
      if (!matchesFilter(propValue, value)) return false;
    }
    return true;
  });
}

function matchesFilter(propValue: unknown, filter: FilterValue): boolean {
  switch (filter.type) {
    case 'text': {
      if (!filter.value) return true;
      const str = String(propValue ?? '').toLowerCase();
      return str.includes(filter.value.toLowerCase());
    }
    case 'select': {
      if (filter.values.length === 0) return true;
      return filter.values.includes(String(propValue ?? ''));
    }
    case 'range': {
      const num = Number(propValue ?? 0);
      if (Number.isNaN(num)) return false;
      return num >= filter.min && num <= filter.max;
    }
    case 'boolean':
      return Boolean(propValue) === filter.value;
    default:
      return true;
  }
}
