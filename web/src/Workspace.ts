export type WarehouseLocation = { id: string; name: string; code?: string; address?: string; active: boolean };
export type BranchLocation = { id: string; name: string; code?: string; address?: string; active: boolean; warehouses: WarehouseLocation[] };
export type Workspace = { businessName: string; branches: BranchLocation[]; activeBranchId: string; activeWarehouseId: string };
