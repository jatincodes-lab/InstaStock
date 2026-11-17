import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Package, Plus, Search, X } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

type TaxTreatment = "taxable" | "exempt" | "nil-rated" | "non-gst" | "";
export type ProductStock = { id: string; warehouseId: string; quantity: number; unitCost?: number; batchNumber?: string; manufacturedAt?: string; expiresAt?: string; mrp?: number };
export type Product = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  taxTreatment?: TaxTreatment;
  hsnCode?: string;
  gstRate?: number;
  cess?: number;
  trackBatches: boolean;
  stockByLocation: ProductStock[];
};

const taxLabels: Record<Exclude<TaxTreatment, "">, string> = {
  taxable: "Taxable",
  exempt: "Exempt",
  "nil-rated": "Nil-rated",
  "non-gst": "Non-GST",
};

export default function ProductCatalog({ products, onAdd, onAddStock, warehouseId, branchName, warehouseName, locationLabels }: { products: Product[]; onAdd: (product: Product) => void; onAddStock: (productId: string, stock: ProductStock) => void; warehouseId: string; branchName: string; warehouseName: string; locationLabels: Record<string, string> }) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("Piece");
  const [trackBatches, setTrackBatches] = useState(false);
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>("");
  const [hsnCode, setHsnCode] = useState("");
  const [gstRate, setGstRate] = useState("");
  const [cess, setCess] = useState("");
  const [error, setError] = useState("");
  const [openingProduct, setOpeningProduct] = useState<Product | null>(null);
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingUnitCost, setOpeningUnitCost] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [manufacturedAt, setManufacturedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [mrp, setMrp] = useState("");
  const [stockError, setStockError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stockDialogRef = useRef<HTMLDialogElement>(null);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term)) : products;
  }, [products, query]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (creating && dialog && !dialog.open) dialog.showModal();
    if (!creating && dialog?.open) dialog.close();
  }, [creating]);

  useEffect(() => {
    const dialog = stockDialogRef.current;
    if (openingProduct && dialog && !dialog.open) dialog.showModal();
    if (!openingProduct && dialog?.open) dialog.close();
  }, [openingProduct]);

  function dismissOpeningStock() {
    setOpeningProduct(null);
    setOpeningQuantity("");
    setOpeningUnitCost("");
    setBatchNumber("");
    setManufacturedAt("");
    setExpiresAt("");
    setMrp("");
    setStockError("");
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const productName = name.trim();
    const parsedRate = gstRate === "" ? undefined : Number(gstRate);
    const parsedCess = cess === "" ? undefined : Number(cess);
    if (!productName) return setError("Enter a product name.");
    if (taxTreatment === "taxable" && (parsedRate === undefined || !Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100)) return setError("Enter a GST rate from 0 to 100%.");
    if (parsedCess !== undefined && (!Number.isFinite(parsedCess) || parsedCess < 0 || parsedCess > 100)) return setError("Enter a cess rate from 0 to 100%.");
    if (hsnCode && !/^\d{2,8}$/.test(hsnCode)) return setError("HSN code must contain 2 to 8 digits.");
    const id = crypto.randomUUID();
    const product: Product = { id, name: productName, sku: `SKU-${id.slice(0, 8).toUpperCase()}`, unit, trackBatches, taxTreatment: taxTreatment || undefined, hsnCode: hsnCode || undefined, gstRate: parsedRate, cess: parsedCess, stockByLocation: [] };
    onAdd(product);
    setName("");
    setUnit("Piece");
    setTrackBatches(false);
    setTaxTreatment("");
    setHsnCode("");
    setGstRate("");
    setCess("");
    setError("");
    setCreating(false);
    setOpeningProduct(product);
  }

  function saveOpeningStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openingProduct) return;
    const quantity = Number(openingQuantity);
    const unitCost = openingUnitCost === "" ? undefined : Number(openingUnitCost);
    const batchMrp = mrp === "" ? undefined : Number(mrp);
    if (!Number.isFinite(quantity) || quantity < 0) return setStockError("Enter a quantity of zero or more.");
    if (["Piece", "Box"].includes(openingProduct.unit) && !Number.isInteger(quantity)) return setStockError(`${openingProduct.unit} quantities must be whole numbers.`);
    if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) return setStockError("Unit cost must be zero or more.");
    if (openingProduct.trackBatches && !batchNumber.trim()) return setStockError("Enter the batch number.");
    if (manufacturedAt && expiresAt && expiresAt < manufacturedAt) return setStockError("Expiry date must be after the manufacturing date.");
    if (batchMrp !== undefined && (!Number.isFinite(batchMrp) || batchMrp < 0)) return setStockError("MRP must be zero or more.");
    onAddStock(openingProduct.id, { id: crypto.randomUUID(), warehouseId, quantity, unitCost, ...(openingProduct.trackBatches ? { batchNumber: batchNumber.trim(), manufacturedAt: manufacturedAt || undefined, expiresAt: expiresAt || undefined, mrp: batchMrp } : {}) });
    dismissOpeningStock();
  }

  return <>
    <div className="dash-page-heading product-heading"><div><p className="dash-eyebrow">INVENTORY</p><h1>Products</h1><p>Your product catalog for {products.length ? `${products.length} ${products.length === 1 ? "item" : "items"}` : "this workspace"}.</p></div><Button onClick={() => setCreating(true)}><Plus size={15} />Add product</Button></div>
    {products.length > 0 && <label className="product-search"><Search size={16} /><Input aria-label="Search products" placeholder="Search products or SKU" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
    {products.length === 0 ? <section className="dash-card product-empty"><span className="empty-illustration"><Package size={26} strokeWidth={1.4} /></span><h2>Your catalog starts here</h2><p>Add products one at a time. You can import a file after the basics are in place.</p><Button onClick={() => setCreating(true)}><Plus size={15} />Add first product</Button></section> : filtered.length === 0 ? <section className="dash-card product-no-results"><h2>No matching products</h2><p>Try another name or SKU.</p></section> : <div className="dash-card product-table-wrap"><table className="product-table"><thead><tr><th scope="col">SKU</th><th scope="col">Product</th><th scope="col">Base unit</th><th scope="col">Tax</th><th scope="col">On hand</th></tr></thead><tbody>{filtered.map((product) => { const currentStock = product.stockByLocation.filter((stock) => stock.warehouseId === warehouseId); const total = currentStock.reduce((sum, stock) => sum + stock.quantity, 0); const hasStock = currentStock.length > 0; return <tr key={product.id}><td><span className="sku">{product.sku}</span></td><td className="product-name-cell">{product.name}{product.trackBatches && <small className="batch-tracked-label">Batch tracked</small>}</td><td>{product.unit}</td><td>{product.taxTreatment === "taxable" ? <>{product.gstRate}% GST{product.hsnCode && <small className="product-hsn">HSN {product.hsnCode}</small>}</> : product.taxTreatment ? taxLabels[product.taxTreatment] : "Not set"}</td><td className="product-stock-cell">{hasStock ? <>{total.toLocaleString(undefined, { maximumFractionDigits: 3 })} {product.unit}<small className="product-stock-location">{locationLabels[warehouseId] ?? warehouseName}</small></> : "—"}</td></tr>; })}</tbody></table><p className="product-note">On-hand quantities are shown for {locationLabels[warehouseId] ?? `${branchName} · ${warehouseName}`}.</p></div>}

    <dialog ref={dialogRef} className="product-dialog" aria-labelledby="product-dialog-title" onCancel={(event) => { event.preventDefault(); setCreating(false); }} onClose={() => setCreating(false)}>
      <form className="product-dialog-form" onSubmit={save}>
        <header className="product-dialog-header"><div><p className="dash-eyebrow">INVENTORY</p><h2 id="product-dialog-title">Add product</h2><p>Start with the essentials. Add tax details if you have them.</p></div><button className="product-dialog-close" type="button" aria-label="Close dialog" onClick={() => setCreating(false)}><X size={18} /></button></header>
        <div className="product-dialog-body">
          <div className="product-field"><Label htmlFor="product-name">Product name <span aria-hidden="true">*</span></Label><Input id="product-name" autoFocus maxLength={150} placeholder="e.g. Packing tape" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} required /></div>
          <div className="product-field"><Label htmlFor="product-unit">Base unit <span aria-hidden="true">*</span></Label><select id="product-unit" value={unit} onChange={(event) => setUnit(event.target.value)} required><option>Piece</option><option>Box</option><option>Kg</option><option>Gram</option><option>Litre</option><option>Meter</option></select></div>
          <label className="product-batch-toggle"><input type="checkbox" checked={trackBatches} onChange={(event) => setTrackBatches(event.target.checked)} /><span><strong>Track batches</strong><small>Store batch quantities, dates, and prices separately.</small></span></label>
          <div className="generated-sku"><span>SKU</span><strong>Generated when saved</strong></div>
          <details className="product-tax-details"><summary>GST &amp; tax details <span>Optional</span></summary><div className="product-tax-fields">
            <div className="product-field"><Label htmlFor="product-tax-treatment">Tax treatment</Label><select id="product-tax-treatment" value={taxTreatment} onChange={(event) => { const treatment = event.target.value as TaxTreatment; setTaxTreatment(treatment); setError(""); if (treatment !== "taxable") { setHsnCode(""); setGstRate(""); setCess(""); } }}><option value="">Set later</option><option value="taxable">Taxable</option><option value="exempt">Exempt</option><option value="nil-rated">Nil-rated</option><option value="non-gst">Non-GST</option></select></div>
            {taxTreatment === "taxable" && <><div className="product-field"><Label htmlFor="product-gst-rate">GST rate (%) <span aria-hidden="true">*</span></Label><Input id="product-gst-rate" type="number" inputMode="decimal" min="0" max="100" step="0.01" placeholder="e.g. 18" value={gstRate} onChange={(event) => { setGstRate(event.target.value); setError(""); }} required /></div><div className="product-field"><Label htmlFor="product-hsn">HSN code</Label><Input id="product-hsn" inputMode="numeric" maxLength={8} placeholder="Digits only" value={hsnCode} onChange={(event) => { setHsnCode(event.target.value.replace(/\D/g, "")); setError(""); }} /></div><div className="product-field"><Label htmlFor="product-cess">Cess (%) <span className="field-optional">Optional</span></Label><Input id="product-cess" type="number" inputMode="decimal" min="0" max="100" step="0.01" placeholder="If applicable" value={cess} onChange={(event) => { setCess(event.target.value); setError(""); }} /></div></>}
          </div><p className="product-tax-hint">Confirm the HSN and applicable rate for your product before invoicing.</p></details>
          {error && <p className="product-error" role="alert">{error}</p>}
        </div>
        <footer className="product-dialog-actions"><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit">Add product<Plus size={15} /></Button></footer>
      </form>
    </dialog>

    <dialog ref={stockDialogRef} className="product-dialog" aria-labelledby="opening-stock-title" onCancel={(event) => { event.preventDefault(); dismissOpeningStock(); }} onClose={dismissOpeningStock}>
      {openingProduct && <form className="product-dialog-form" onSubmit={saveOpeningStock}>
        <header className="product-dialog-header"><div><p className="dash-eyebrow">OPENING STOCK</p><h2 id="opening-stock-title">Add starting quantity</h2><p>{openingProduct.name} · {openingProduct.unit}</p></div><button className="product-dialog-close" type="button" aria-label="Skip opening stock" onClick={dismissOpeningStock}><X size={18} /></button></header>
        <div className="product-dialog-body">
          <div className="opening-stock-location"><span>Stock location</span><strong>{branchName} · {warehouseName}</strong></div>
          <div className="product-field"><Label htmlFor="opening-quantity">Quantity <span aria-hidden="true">*</span></Label><Input id="opening-quantity" autoFocus type="number" inputMode="decimal" min="0" step={["Piece", "Box"].includes(openingProduct.unit) ? "1" : "0.001"} placeholder="Enter current quantity" value={openingQuantity} onChange={(event) => { setOpeningQuantity(event.target.value); setStockError(""); }} required /></div>
          <div className="product-field"><Label htmlFor="opening-unit-cost">Unit cost <span className="field-optional">Optional</span></Label><Input id="opening-unit-cost" type="number" inputMode="decimal" min="0" step="0.01" placeholder="For stock valuation" value={openingUnitCost} onChange={(event) => { setOpeningUnitCost(event.target.value); setStockError(""); }} /></div>
          {openingProduct.trackBatches && <><div className="product-field"><Label htmlFor="opening-batch-number">Batch number <span aria-hidden="true">*</span></Label><Input id="opening-batch-number" maxLength={80} placeholder="Enter the batch or lot number" value={batchNumber} onChange={(event) => { setBatchNumber(event.target.value); setStockError(""); }} required /></div><div className="product-field"><Label htmlFor="opening-manufactured">Manufacturing date <span className="field-optional">Optional</span></Label><Input id="opening-manufactured" type="date" value={manufacturedAt} onChange={(event) => { setManufacturedAt(event.target.value); setStockError(""); }} /></div><div className="product-field"><Label htmlFor="opening-expires">Expiry date <span className="field-optional">Optional</span></Label><Input id="opening-expires" type="date" value={expiresAt} onChange={(event) => { setExpiresAt(event.target.value); setStockError(""); }} /></div><div className="product-field"><Label htmlFor="opening-mrp">Batch MRP <span className="field-optional">Optional</span></Label><Input id="opening-mrp" type="number" inputMode="decimal" min="0" step="0.01" placeholder="If printed on the pack" value={mrp} onChange={(event) => { setMrp(event.target.value); setStockError(""); }} /></div></>}
          {stockError && <p className="product-error" role="alert">{stockError}</p>}
        </div>
        <footer className="product-dialog-actions"><Button type="button" variant="ghost" onClick={dismissOpeningStock}>Skip for now</Button><Button type="submit">Save opening stock<Plus size={15} /></Button></footer>
      </form>}
    </dialog>
  </>;
}
