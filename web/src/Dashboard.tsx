import { useState } from "react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3, Building2, Check, ChevronDown, CircleHelp, LayoutDashboard, Menu, Package, PanelLeftClose, PanelLeftOpen, Settings, ShoppingBag, ShoppingCart, Users, Warehouse, X } from "lucide-react";
import { Button } from "./components/ui/button";
import ProductCatalog, { type Product, type ProductStock } from "./ProductCatalog";
import OpeningStock from "./OpeningStock";
import Locations from "./Locations";
import type { BranchLocation, Workspace } from "./Workspace";
import "./dashboard.css";

const navigation = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Purchases", icon: ShoppingCart }, { name: "Sales", icon: ShoppingBag },
  { name: "Contacts", icon: Users }, { name: "Reports", icon: BarChart3 },
  { name: "Team", icon: Users }, { name: "Settings", icon: Settings },
];

export default function Dashboard({ workspace, onSignOut }: { workspace: Workspace; onSignOut: () => void }) {
  const [page, setPage] = useState("Overview");
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [openingStockDirty, setOpeningStockDirty] = useState(false);
  const [branches, setBranches] = useState<BranchLocation[]>(workspace.branches);
  const [activeBranchId, setActiveBranchId] = useState(workspace.activeBranchId);
  const [activeWarehouseId, setActiveWarehouseId] = useState(workspace.activeWarehouseId);
  const [helpOpen, setHelpOpen] = useState(false);
  const currentBranch = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];
  const currentWarehouse = currentBranch.warehouses.find((warehouse) => warehouse.id === activeWarehouseId && warehouse.active) ?? currentBranch.warehouses.find((warehouse) => warehouse.active)!;
  const locationLabels = Object.fromEntries(branches.flatMap((branch) => branch.warehouses.map((warehouse) => [warehouse.id, `${branch.name} · ${warehouse.name}`])));
  function navigate(next: string) {
    if (page === "Opening stock" && next !== page && openingStockDirty && !window.confirm("Leave opening stock? Unsaved changes will be lost.")) return;
    if (next !== page) setOpeningStockDirty(false);
    setPage(next); setNavOpen(false); if (next === "Products" || next === "Opening stock") setInventoryOpen(true);
  }
  function selectLocation(branchId: string, warehouseId: string) {
    if (warehouseId === currentWarehouse.id) return;
    if (page === "Opening stock" && openingStockDirty && !window.confirm("Switch warehouse? Unsaved opening stock changes will be lost.")) return;
    setOpeningStockDirty(false);
    setActiveBranchId(branchId); setActiveWarehouseId(warehouseId);
  }
  function addOpeningStock(productId: string, stock: ProductStock) {
    setProducts((items) => items.map((product) => product.id === productId ? { ...product, stockByLocation: [...product.stockByLocation, stock] } : product));
  }
  function saveOpeningStock(entries: { productId: string; stocks: ProductStock[] }[]) {
    const byProduct = new Map(entries.map((entry) => [entry.productId, entry]));
    setProducts((items) => items.map((product) => {
      const entry = byProduct.get(product.id);
      if (!entry) return product;
      const otherLocations = product.stockByLocation.filter((stock) => stock.warehouseId !== currentWarehouse.id);
      return { ...product, stockByLocation: [...otherLocations, ...entry.stocks] };
    }));
  }
  function updateLocations(next: BranchLocation[]) { setBranches(next); }

  return <main className="dashboard-frame">
    <a className="dash-skip" href="#dashboard-content">Skip to content</a>
    <div className={`dashboard-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`dash-sidebar ${navOpen ? "is-open" : ""}`} id="workspace-navigation">
        <div className="dash-sidebar-head"><div className="dash-brand"><span className="dash-mark"><Package size={19} /></span><span className="dash-brand-name">stockroom<span className="dash-brand-dot">.</span></span></div><button className="dash-sidebar-toggle" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-controls="workspace-navigation" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">{navigation.slice(0, 1).map(({ name, icon: Icon }) => <button key={name} title={sidebarCollapsed ? name : undefined} aria-label={sidebarCollapsed ? name : undefined} type="button" onClick={() => navigate(name)} aria-current={page === name ? "page" : undefined}><Icon size={18} strokeWidth={1.7} /><span>{name}</span>{page === name && <span className="nav-active-dot" />}</button>)}
          <div className="inventory-nav-group"><button className={`inventory-trigger ${page === "Products" || page === "Opening stock" ? "is-active" : ""}`} type="button" title={sidebarCollapsed ? "Inventory" : undefined} aria-label={sidebarCollapsed ? "Inventory" : undefined} aria-expanded={inventoryOpen} aria-controls="inventory-submenu" onClick={() => { if (sidebarCollapsed) { setSidebarCollapsed(false); setInventoryOpen(true); } else setInventoryOpen((open) => !open); }}><Package size={18} strokeWidth={1.7} /><span>Inventory</span>{(page === "Products" || page === "Opening stock") && <span className="nav-active-dot" />}<ChevronDown className={`inventory-chevron ${inventoryOpen ? "is-open" : ""}`} size={14} /></button>{inventoryOpen && <div className="inventory-submenu" id="inventory-submenu"><button type="button" onClick={() => navigate("Products")} aria-current={page === "Products" ? "page" : undefined}>Products{page === "Products" && <span className="nav-active-dot" />}</button><button type="button" onClick={() => navigate("Opening stock")} aria-current={page === "Opening stock" ? "page" : undefined}>Fill opening stock{page === "Opening stock" && <span className="nav-active-dot" />}</button></div>}</div>
          {navigation.slice(1).map(({ name, icon: Icon }) => <button key={name} title={sidebarCollapsed ? name : undefined} aria-label={sidebarCollapsed ? name : undefined} type="button" onClick={() => navigate(name)} aria-current={page === name ? "page" : undefined}><Icon size={18} strokeWidth={1.7} /><span>{name}</span>{page === name && <span className="nav-active-dot" />}</button>)}</nav>
        <div className="sidebar-bottom"><button type="button" title={sidebarCollapsed ? "Getting started" : undefined} onClick={() => setHelpOpen((open) => !open)} aria-expanded={helpOpen}><CircleHelp size={17} /><span>Getting started</span></button>{helpOpen && <p>Add your products, then record opening quantities for each warehouse. Your overview will fill in as you work.</p>}<span className="prototype-label">Design preview · data not saved</span></div>
      </aside>
      <div className="dash-workspace-main">
        <header className="dash-topbar">
          <button className="dash-mobile-menu" type="button" aria-label={navOpen ? "Close navigation" : "Open navigation"} aria-controls="workspace-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>{navOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <span className="dash-breadcrumb">{workspace.businessName} <span>/</span> <strong>{page}</strong></span>
          <div className="dash-top-actions"><details className="location-picker"><summary aria-label={`Current stock location: ${currentBranch.name}, ${currentWarehouse.name}`}><Building2 size={15} /><span><strong>{currentBranch.name}</strong><small>{currentWarehouse.name}</small></span><ChevronDown size={13} /></summary><div className="location-picker-menu">{branches.filter((branch) => branch.active && branch.warehouses.some((warehouse) => warehouse.active)).map((branch) => <section key={branch.id}><h3>{branch.name}</h3>{branch.warehouses.filter((warehouse) => warehouse.active).map((warehouse) => <button key={warehouse.id} type="button" aria-pressed={warehouse.id === currentWarehouse.id} onClick={(event) => { selectLocation(branch.id, warehouse.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Warehouse size={14} />{warehouse.name}{warehouse.id === currentWarehouse.id && <span>Current</span>}</button>)}</section>)}</div></details><span className="top-divider" /><details className="profile-menu"><summary aria-label="Account menu"><span className="profile-avatar">{workspace.businessName.charAt(0).toUpperCase()}</span><ChevronDown size={13} /></summary><div><strong>{workspace.businessName}</strong><button type="button" onClick={() => navigate("Settings")}>Workspace settings</button><button type="button" onClick={onSignOut}>Back to sign in</button></div></details></div>
        </header>
        <section className="dash-content" id="dashboard-content" tabIndex={-1}>
          {page === "Overview" ? <>
            <div className="dash-page-heading"><div><p className="dash-eyebrow">YOUR DAILY OVERVIEW</p><h1>A clear view of your business.</h1><p>Everything starts here. Let’s get your stock in place.</p></div><Button onClick={() => navigate("Products")}><Package size={15} />Add products</Button></div>
            <div className="dash-scope"><Warehouse size={14} /><span>{currentBranch.name} · {currentWarehouse.name}</span><span className="scope-separator">·</span><span>Current workspace</span></div>
            <div className="dash-metrics">
              {[{ title: "Products", detail: "In your catalog", icon: Package, destination: "Products", value: products.length }, { title: "Low stock", detail: "Items needing attention", icon: BarChart3, destination: "Products", value: 0 }, { title: "To receive", detail: "Pending purchase receipts", icon: ArrowDownLeft, destination: "Purchases", value: 0 }, { title: "To dispatch", detail: "Pending sales dispatches", icon: ArrowUpRight, destination: "Sales", value: 0 }].map(({ title, detail, icon: Icon, destination, value }) => <button type="button" key={title} onClick={() => navigate(destination)} className="metric"><span className="metric-label">{title}<Icon size={17} /></span><strong>{value}</strong><span className="metric-description">{detail}<ArrowRight size={13} /></span></button>)}
            </div>
            <div className="dash-panels">
              <section className="dash-card getting-started"><div className="card-heading"><h2>Make it your workspace</h2><span>1 of 3 complete</span></div><p className="card-description">A few essentials to get your team moving.</p><div className="setup-task completed"><span className="task-marker"><Check size={15} /></span><div><h3>Set up your locations</h3><p>{currentBranch.name} · {currentWarehouse.name}</p></div><span className="done-label">Done</span></div><button className="setup-task" onClick={() => navigate("Products")}><span className="task-marker">2</span><div><h3>Add your products</h3><p>Build your catalog, one product or a file at a time.</p></div><ArrowRight size={17} /></button><button className="setup-task" onClick={() => navigate("Opening stock")}><span className="task-marker">3</span><div><h3>Enter opening stock</h3><p>Start with what’s already on your shelves.</p></div><ArrowRight size={17} /></button></section>
              <section className="dash-card activity-card"><div className="card-heading"><h2>Recent activity</h2><span className="quiet-pill">This workspace</span></div><div className="activity-empty"><span className="empty-illustration"><Package size={27} strokeWidth={1.2} /></span><h3>A fresh start.</h3><p>Receipts, dispatches, and stock changes will appear here as your team works.</p></div></section>
            </div>
            <div className="dash-location-note"><span className="location-note-icon"><Building2 size={19} /></span><div><strong>Room to grow</strong><p>Add branches and warehouses whenever your business needs them.</p></div><button onClick={() => navigate("Locations")}>Manage locations<ArrowRight size={14} /></button></div>
          </> : page === "Products" ? <ProductCatalog products={products} onAdd={(product) => setProducts((items) => [...items, product])} onAddStock={addOpeningStock} warehouseId={currentWarehouse.id} branchName={currentBranch.name} warehouseName={currentWarehouse.name} locationLabels={locationLabels} /> : page === "Opening stock" ? <OpeningStock key={currentWarehouse.id} products={products} warehouseId={currentWarehouse.id} branchName={currentBranch.name} warehouseName={currentWarehouse.name} onSave={saveOpeningStock} onAddProducts={() => navigate("Products")} onDirtyChange={setOpeningStockDirty} /> : page === "Locations" ? <Locations branches={branches} products={products} currentWarehouseId={currentWarehouse.id} onChange={updateLocations} onSelectLocation={selectLocation} onBack={() => navigate("Settings")} /> : page === "Settings" ? <><div className="dash-page-heading"><div><p className="dash-eyebrow">WORKSPACE</p><h1>Settings</h1><p>Manage your business locations and workspace preferences.</p></div></div><section className="dash-card location-settings-card"><div><span className="location-icon"><Building2 size={18} /></span><div><h2>Branches &amp; warehouses</h2><p>Add branches and the warehouses where you keep stock.</p></div></div><Button onClick={() => navigate("Locations")}>Manage locations<ArrowRight size={15} /></Button></section></> : <><div className="dash-page-heading"><div><p className="dash-eyebrow">YOUR WORKSPACE</p><h1>{page}</h1><p>{workspace.businessName} · {currentBranch.name}</p></div></div><section className="dash-card section-preview"><Package size={32} strokeWidth={1.3} /><h2>{page} is coming next</h2><p>This section is part of the planned workspace. Its tools are not connected yet.</p><Button variant="ghost" onClick={() => navigate("Overview")}>Back to overview<ArrowRight size={15} /></Button></section></>}
          <footer className="dash-footer">Stockroom<span>Keep every location in view.</span></footer>
        </section>
      </div>
    </div>
  </main>;
}
