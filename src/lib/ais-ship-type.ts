/**
 * AIS "Type of ship and cargo" code (ITU-R M.1371, message 5 / ShipStaticData.Type)
 * mapped to the maritime plugin's vessel categories.
 *
 * Intentionally coarse: only bands the maritime UI already labels (cargo, tanker,
 * passenger, fishing, military, sailing, tug) are mapped. Everything else stays
 * `other` until Kyle/product expands categories — not an exhaustive ITU table.
 *
 * Unmapped ITU codes (all → `other`):
 * - 0: not available / default
 * - 1–29: reserved
 * - 33–34, 37–39: reserved / pleasure (37) / etc.
 * - 38–39: reserved
 * - 40–49: high-speed craft (HSC), WIG, and related (no HSC/WIG plugin bucket yet)
 * - 50–51, 53–54, 55–59: pilot, SAR, tug variants, port tender, etc. (except 52→tug)
 * - 90–99: other / reserved
 */
export type VesselCategory =
    | "cargo"
    | "tanker"
    | "passenger"
    | "fishing"
    | "military"
    | "sailing"
    | "tug"
    | "other";

export function aisShipTypeToCategory(code: unknown): VesselCategory {
    if (typeof code !== "number" || !Number.isInteger(code)) return "other";
    if (code === 30) return "fishing";
    if (code === 31 || code === 32 || code === 52) return "tug";
    if (code === 35) return "military";
    if (code === 36) return "sailing";
    if (code >= 60 && code <= 69) return "passenger";
    if (code >= 70 && code <= 79) return "cargo";
    if (code >= 80 && code <= 89) return "tanker";
    return "other";
}
