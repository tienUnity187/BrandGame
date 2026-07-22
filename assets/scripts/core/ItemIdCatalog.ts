/** MHTK pack: 12 tile arts (files 0-11). */
export const ITEM_ID_GROUPS: string[] = Array.from({ length: 12 }, (_, index) => `${index}`);

export const ITEM_ID_COUNT = ITEM_ID_GROUPS.length;

const LEGACY_ITEM_NAMES = [
    'cushion',
    'lamp',
    'clock',
    'vase',
    'plant',
    'basket',
    'frame',
    'storagebox',
    'candle',
    'carpet',
    'chair',
    'coasters',
    'bedroom lamp',
    'tissue box',
    'table',
    'book',
    'mirror',
    'shelf',
];

export const LEGACY_ITEM_ID_MAP: Record<string, string> = LEGACY_ITEM_NAMES.reduce((map, name, index) => {
    map[name] = ITEM_ID_GROUPS[index % ITEM_ID_COUNT];
    return map;
}, {} as Record<string, string>);

export function normalizeItemId(value: string): string {
    if (Object.prototype.hasOwnProperty.call(LEGACY_ITEM_ID_MAP, value)) {
        return LEGACY_ITEM_ID_MAP[value];
    }
    return value;
}

export function isCanonicalItemId(value: string): boolean {
    return ITEM_ID_GROUPS.includes(value);
}
