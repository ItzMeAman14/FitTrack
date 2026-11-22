import type { MeasurementUnit, WeightUnit } from '../types/fittrack';

export const CM_PER_INCH = 2.54;
export const LBS_PER_KG = 2.20462;

export function measureUnitSuffix(unit: MeasurementUnit | undefined): 'in' | 'cm' {
  return unit === 'INCHES' ? 'in' : 'cm';
}

export function measureUnitName(unit: MeasurementUnit | undefined): string {
  return unit === 'INCHES' ? 'inches' : 'centimeters';
}

export function weightUnitSuffix(unit: WeightUnit | undefined): 'lbs' | 'kg' {
  return unit === 'LBS' ? 'lbs' : 'kg';
}

export function cmToDisplay(
  cm: number | null | undefined,
  unit: MeasurementUnit | undefined,
  decimals = 2
): number | null {
  if (cm === null || cm === undefined || Number.isNaN(cm)) return null;
  if (unit === 'INCHES') {
    return Number((cm / CM_PER_INCH).toFixed(decimals));
  }
  return Number(cm.toFixed(decimals));
}

export function displayToCm(
  raw: string | number | null | undefined,
  unit: MeasurementUnit | undefined
): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return null;
  if (unit === 'INCHES') {
    return Number((num * CM_PER_INCH).toFixed(2));
  }
  return Number(num.toFixed(2));
}

export function formatMeasure(
  cm: number | null | undefined,
  unit: MeasurementUnit | undefined,
  decimals = 2
): string {
  const val = cmToDisplay(cm, unit, decimals);
  if (val === null) return '—';
  return `${val} ${measureUnitSuffix(unit)}`;
}

export function formatMeasureDelta(
  cmDelta: number | null | undefined,
  unit: MeasurementUnit | undefined,
  decimals = 2
): string {
  if (cmDelta === null || cmDelta === undefined || Number.isNaN(cmDelta)) return '—';
  const converted =
    unit === 'INCHES'
      ? Number((cmDelta / CM_PER_INCH).toFixed(decimals))
      : Number(cmDelta.toFixed(decimals));
  const sign = converted > 0 ? '+' : '';
  return `${sign}${converted} ${measureUnitSuffix(unit)}`;
}

export function kgToDisplay(
  kg: number | null | undefined,
  unit: WeightUnit | undefined,
  decimals = 1
): number | null {
  if (kg === null || kg === undefined || Number.isNaN(kg)) return null;
  if (unit === 'LBS') {
    return Number((kg * LBS_PER_KG).toFixed(decimals));
  }
  return Number(kg.toFixed(decimals));
}

export function displayToKg(
  raw: string | number | null | undefined,
  unit: WeightUnit | undefined
): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return null;
  if (unit === 'LBS') {
    return Number((num / LBS_PER_KG).toFixed(2));
  }
  return Number(num.toFixed(2));
}

export function formatWeight(
  kg: number | null | undefined,
  unit: WeightUnit | undefined,
  decimals = 1
): string {
  const val = kgToDisplay(kg, unit, decimals);
  if (val === null) return '—';
  return `${val} ${weightUnitSuffix(unit)}`;
}

export function measurePlaceholder(cmExample: number, unit: MeasurementUnit | undefined): string {
  if (unit === 'INCHES') {
    return (cmExample / CM_PER_INCH).toFixed(1);
  }
  return cmExample.toFixed(1);
}

export function getMeasureBounds(maxCm: number, unit: MeasurementUnit | undefined) {
  const minCm = 5;
  if (unit === 'INCHES') {
    return {
      min: Number((minCm / CM_PER_INCH).toFixed(1)),
      max: Number((maxCm / CM_PER_INCH).toFixed(1)),
      suffix: 'in',
    };
  }
  return {
    min: minCm,
    max: maxCm,
    suffix: 'cm',
  };
}
