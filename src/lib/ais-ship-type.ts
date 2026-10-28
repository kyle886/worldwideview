/**
 * AIS "Type of ship and cargo" code (ITU-R M.1371, message 5 / ShipStaticData.Type)
 * mapped to the maritime plugin's vessel categories.
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
