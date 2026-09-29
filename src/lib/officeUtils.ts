export const OFFICE_IDS = {
  SEARCH: 'LNrWc8f6G703aUYRZ5e2',
  HOME: 'nWioUcWXUskreYjmSL8p',
} as const;

export const normalizeOfficeString = (val?: any): string => {
  if (!val) return '';
  return String(val).toLowerCase().replace(/[\s\-_+]/g, '');
};

/**
 * 文字列やタグが「ホーム」系か判定
 * ホーム, HOME, treekidsschoolhome, TREE KIDS SCHOOL HOME, nWioUcWXUskreYjmSL8p など
 */
export const isHomeOffice = (val?: any): boolean => {
  if (!val) return false;
  const s = normalizeOfficeString(val);
  return (
    s.includes('ホーム') ||
    s.includes('home') ||
    s.includes('treekidsschoolhome') ||
    s === OFFICE_IDS.HOME.toLowerCase()
  );
};

/**
 * 文字列やタグが「サーチ」系か判定
 * サーチ, SEARCH, treekidsschoolsearch, Tree Kids School Search, LNrWc8f6G703aUYRZ5e2 など
 */
export const isSearchOffice = (val?: any): boolean => {
  if (!val) return false;
  const s = normalizeOfficeString(val);
  return (
    s.includes('サーチ') ||
    s.includes('search') ||
    s.includes('treekidsschoolsearch') ||
    s === OFFICE_IDS.SEARCH.toLowerCase()
  );
};

/**
 * 指定の officeId と タグ・所属配列が一致するか判定
 */
export const matchesOffice = (officeId: string, tagsOrOffices: any): boolean => {
  if (!tagsOrOffices) return false;
  const list: any[] = Array.isArray(tagsOrOffices)
    ? tagsOrOffices
    : typeof tagsOrOffices === 'string'
      ? [tagsOrOffices]
      : typeof tagsOrOffices === 'object'
        ? Object.values(tagsOrOffices)
        : [tagsOrOffices];

  const targetIsSearch = isSearchOffice(officeId);
  const targetIsHome = isHomeOffice(officeId);

  return list.some(item => {
    if (targetIsSearch && isSearchOffice(item)) return true;
    if (targetIsHome && isHomeOffice(item)) return true;
    return normalizeOfficeString(item) === normalizeOfficeString(officeId);
  });
};
