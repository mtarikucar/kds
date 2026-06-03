// Shape of a marketplace add-on's `grants` JSON. Kept here so the catalog
// service, the projector, and the admin DTOs all agree.

export interface AddOnGrants {
  [key: string]: boolean | number | string[];
}

export type AddOnKind = "software" | "integration" | "capacity" | "support";
export type AddOnBilling = "recurring" | "oneTime";
export type AddOnStatus = "draft" | "published" | "archived";
export type TenantAddOnStatus = "active" | "cancelled" | "expired";
