import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Building2, MapPin, Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import type { BranchLocation, WarehouseLocation } from "./Workspace";
import type { Product } from "./ProductCatalog";

export default function Locations({ branches, products, currentWarehouseId, onChange, onSelectLocation, onBack }: { branches: BranchLocation[]; products: Product[]; currentWarehouseId: string; onChange: (branches: BranchLocation[]) => void; onSelectLocation: (branchId: string, warehouseId: string) => void; onBack: () => void }) {
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [warehouseBranchId, setWarehouseBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [branchCode, setBranchCode] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseCode, setWarehouseCode] = useState("");
  const [warehouseAddress, setWarehouseAddress] = useState("");
  const [error, setError] = useState("");
  const branchDialogRef = useRef<HTMLDialogElement>(null);
  const warehouseDialogRef = useRef<HTMLDialogElement>(null);
  const activeWarehouseCount = branches.reduce((count, branch) => count + (branch.active ? branch.warehouses.filter((warehouse) => warehouse.active).length : 0), 0);

  useEffect(() => {
    const dialog = branchDialogRef.current;
    if (branchDialogOpen && dialog && !dialog.open) dialog.showModal();
    if (!branchDialogOpen && dialog?.open) dialog.close();
  }, [branchDialogOpen]);

  useEffect(() => {
    const dialog = warehouseDialogRef.current;
    if (warehouseBranchId && dialog && !dialog.open) dialog.showModal();
    if (!warehouseBranchId && dialog?.open) dialog.close();
  }, [warehouseBranchId]);

  function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = branchName.trim();
    const code = branchCode.trim().toUpperCase();
    if (!name) return setError("Enter a branch name.");
    if (branches.some((branch) => branch.name.toLowerCase() === name.toLowerCase())) return setError("A branch with this name already exists.");
    if (code && branches.some((branch) => branch.code?.toLowerCase() === code.toLowerCase())) return setError("This branch code is already in use.");
    onChange([...branches, { id: crypto.randomUUID(), name, code: code || undefined, address: branchAddress.trim() || undefined, active: true, warehouses: [] }]);
    setBranchName(""); setBranchCode(""); setBranchAddress(""); setError(""); setBranchDialogOpen(false);
  }

  function saveWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!warehouseBranchId) return;
    const name = warehouseName.trim();
    const code = warehouseCode.trim().toUpperCase();
    const parent = branches.find((branch) => branch.id === warehouseBranchId);
    if (!parent?.active) return setError("Reactivate this branch before adding a warehouse.");
    if (!name) return setError("Enter a warehouse name.");
    if (parent.warehouses.some((warehouse) => warehouse.name.toLowerCase() === name.toLowerCase())) return setError("A warehouse with this name already exists in this branch.");
    if (code && branches.some((branch) => branch.warehouses.some((warehouse) => warehouse.code?.toLowerCase() === code.toLowerCase()))) return setError("This warehouse code is already in use.");
    const warehouse: WarehouseLocation = { id: crypto.randomUUID(), name, code: code || undefined, address: warehouseAddress.trim() || undefined, active: true };
    onChange(branches.map((branch) => branch.id === parent.id ? { ...branch, warehouses: [...branch.warehouses, warehouse] } : branch));
    setWarehouseName(""); setWarehouseCode(""); setWarehouseAddress(""); setError(""); setWarehouseBranchId(null);
  }

  function archiveWarehouse(branchId: string, warehouse: WarehouseLocation) {
    if (!window.confirm(`Archive ${warehouse.name}? It will no longer appear as a stock location.`)) return;
    onChange(branches.map((branch) => branch.id === branchId ? { ...branch, warehouses: branch.warehouses.map((item) => item.id === warehouse.id ? { ...item, active: false } : item) } : branch));
  }

  function archiveBranch(branch: BranchLocation) {
    if (!window.confirm(`Archive ${branch.name}? Its historical records will remain available.`)) return;
    onChange(branches.map((item) => item.id === branch.id ? { ...item, active: false } : item));
  }

  function toggleBranch(branch: BranchLocation) {
    onChange(branches.map((item) => item.id === branch.id ? { ...item, active: !item.active } : item));
  }

  function toggleWarehouse(branchId: string, warehouse: WarehouseLocation) {
    onChange(branches.map((branch) => branch.id === branchId ? { ...branch, warehouses: branch.warehouses.map((item) => item.id === warehouse.id ? { ...item, active: !item.active } : item) } : branch));
  }

  return <>
    <div className="dash-page-heading locations-heading"><div><p className="dash-eyebrow">WORKSPACE SETTINGS</p><h1>Branches &amp; warehouses</h1><p>Organize stock by the places your team works.</p></div><Button onClick={() => { setError(""); setBranchDialogOpen(true); }}><Plus size={15} />Add branch</Button></div>
    <div className="locations-summary"><span><Building2 size={15} />{branches.filter((branch) => branch.active).length} active {branches.filter((branch) => branch.active).length === 1 ? "branch" : "branches"}</span><span><WarehouseIcon size={15} />{activeWarehouseCount} active {activeWarehouseCount === 1 ? "warehouse" : "warehouses"}</span></div>
    {branches.length === 0 ? <section className="dash-card locations-empty"><MapPin size={28} /><h2>Add your first branch</h2><p>Then create one or more warehouses inside it.</p><Button onClick={() => setBranchDialogOpen(true)}><Plus size={15} />Add branch</Button></section> : <div className="location-branch-list">{branches.map((branch) => {
      const activeBranches = branches.filter((item) => item.active).length;
      const canArchiveBranch = branch.active && !branch.warehouses.some((warehouse) => warehouse.active) && activeBranches > 1;
      return <section className={`location-branch ${branch.active ? "" : "is-archived"}`} key={branch.id}>
        <header className="location-branch-header"><span className="location-icon"><Building2 size={17} /></span><div className="location-title"><h2>{branch.name}</h2><span>{branch.code || "No code"}{branch.address && ` · ${branch.address}`}</span></div><span className={`location-status ${branch.active ? "is-active" : ""}`}>{branch.active ? "Active" : "Archived"}</span><Button type="button" variant="ghost" disabled={!branch.active} onClick={() => { setError(""); setWarehouseBranchId(branch.id); }}> <Plus size={14} />Add warehouse</Button>{branch.active ? <button className="location-text-action" type="button" disabled={!canArchiveBranch} title={canArchiveBranch ? "Archive branch" : "Archive its warehouses first; keep one active branch."} onClick={() => archiveBranch(branch)}>Archive</button> : <button className="location-text-action" type="button" onClick={() => toggleBranch(branch)}>Reactivate</button>}</header>
        {branch.warehouses.length ? <div className="location-warehouse-list">{branch.warehouses.map((warehouse) => {
          const hasStock = products.some((product) => product.stockByLocation.some((stock) => stock.warehouseId === warehouse.id));
          const canArchive = warehouse.active && branch.active && activeWarehouseCount > 1 && !hasStock && warehouse.id !== currentWarehouseId;
          return <div className="location-warehouse-row" key={warehouse.id}><span className="location-warehouse-icon"><WarehouseIcon size={16} /></span><div className="location-title"><strong>{warehouse.name}</strong><span>{warehouse.code || "No code"}{warehouse.address && ` · ${warehouse.address}`}</span></div><span className={`location-status ${warehouse.active ? "is-active" : ""}`}>{warehouse.active ? "Active" : "Archived"}</span>{warehouse.active ? <><button type="button" className="location-text-action" disabled={!canArchive} title={!branch.active ? "Reactivate the branch first." : warehouse.id === currentWarehouseId ? "Switch to another warehouse before archiving this one." : hasStock ? "Move or reconcile stock before archiving." : activeWarehouseCount <= 1 ? "Keep at least one active warehouse." : "Archive warehouse"} onClick={() => archiveWarehouse(branch.id, warehouse)}>Archive</button>{warehouse.id !== currentWarehouseId && <button type="button" className="location-use-action" disabled={!branch.active} onClick={() => onSelectLocation(branch.id, warehouse.id)}>Use location</button>}</> : <button type="button" className="location-text-action" disabled={!branch.active} onClick={() => toggleWarehouse(branch.id, warehouse)}>Reactivate</button>}</div>;
        })}</div> : <p className="location-no-warehouses">No warehouses yet. Add one to make this branch available for stock.</p>}
      </section>;
    })}</div>}
    <div className="locations-footer"><Button variant="ghost" onClick={onBack}><ArrowLeft size={15} />Back to settings</Button></div>

    <dialog ref={branchDialogRef} className="product-dialog" aria-labelledby="add-branch-title" onCancel={(event) => { event.preventDefault(); setBranchDialogOpen(false); }} onClose={() => setBranchDialogOpen(false)}>
      <form className="product-dialog-form" onSubmit={saveBranch}><header className="product-dialog-header"><div><p className="dash-eyebrow">WORKSPACE LOCATIONS</p><h2 id="add-branch-title">Add branch</h2><p>Create a branch, then add its warehouses.</p></div></header><div className="product-dialog-body"><div className="product-field"><Label htmlFor="new-branch-name">Branch name <span aria-hidden="true">*</span></Label><Input id="new-branch-name" autoFocus maxLength={150} placeholder="e.g. North branch" value={branchName} onChange={(event) => { setBranchName(event.target.value); setError(""); }} required /></div><div className="product-field"><Label htmlFor="new-branch-code">Branch code <span className="field-optional">Optional</span></Label><Input id="new-branch-code" maxLength={50} placeholder="e.g. NORTH-01" value={branchCode} onChange={(event) => { setBranchCode(event.target.value); setError(""); }} /></div><div className="product-field"><Label htmlFor="new-branch-address">Address <span className="field-optional">Optional</span></Label><Input id="new-branch-address" maxLength={500} placeholder="Street, city" value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></div>{error && <p className="product-error" role="alert">{error}</p>}</div><footer className="product-dialog-actions"><Button type="button" variant="ghost" onClick={() => setBranchDialogOpen(false)}>Cancel</Button><Button type="submit">Add branch<Plus size={15} /></Button></footer></form>
    </dialog>

    <dialog ref={warehouseDialogRef} className="product-dialog" aria-labelledby="add-warehouse-title" onCancel={(event) => { event.preventDefault(); setWarehouseBranchId(null); }} onClose={() => setWarehouseBranchId(null)}>
      <form className="product-dialog-form" onSubmit={saveWarehouse}><header className="product-dialog-header"><div><p className="dash-eyebrow">{branches.find((branch) => branch.id === warehouseBranchId)?.name}</p><h2 id="add-warehouse-title">Add warehouse</h2><p>Stock in this warehouse is tracked separately.</p></div></header><div className="product-dialog-body"><div className="product-field"><Label htmlFor="new-warehouse-name">Warehouse name <span aria-hidden="true">*</span></Label><Input id="new-warehouse-name" autoFocus maxLength={150} placeholder="e.g. Main warehouse" value={warehouseName} onChange={(event) => { setWarehouseName(event.target.value); setError(""); }} required /></div><div className="product-field"><Label htmlFor="new-warehouse-code">Warehouse code <span className="field-optional">Optional</span></Label><Input id="new-warehouse-code" maxLength={50} placeholder="e.g. WH-01" value={warehouseCode} onChange={(event) => { setWarehouseCode(event.target.value); setError(""); }} /></div><div className="product-field"><Label htmlFor="new-warehouse-address">Address <span className="field-optional">Optional</span></Label><Input id="new-warehouse-address" maxLength={500} placeholder="Street, city" value={warehouseAddress} onChange={(event) => setWarehouseAddress(event.target.value)} /></div>{error && <p className="product-error" role="alert">{error}</p>}</div><footer className="product-dialog-actions"><Button type="button" variant="ghost" onClick={() => setWarehouseBranchId(null)}>Cancel</Button><Button type="submit">Add warehouse<Plus size={15} /></Button></footer></form>
    </dialog>
  </>;
}
