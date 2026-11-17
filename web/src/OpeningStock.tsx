import { Fragment, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ClipboardList, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { type Product, type ProductStock } from "./ProductCatalog";

type OpeningEntry = { productId: string; stocks: ProductStock[] };
type OpeningRow = { id: string; productId: string; stockId?: string; batchNumber: string; quantity: string; unitCost: string; mrp: string; manufacturedAt: string; expiresAt: string };
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

function makeRow(productId: string, stock?: ProductStock): OpeningRow {
  return { id: stock?.id ?? crypto.randomUUID(), productId, stockId: stock?.id, batchNumber: stock?.batchNumber ?? "", quantity: stock ? String(stock.quantity) : "", unitCost: stock?.unitCost === undefined ? "" : String(stock.unitCost), mrp: stock?.mrp === undefined ? "" : String(stock.mrp), manufacturedAt: stock?.manufacturedAt ?? "", expiresAt: stock?.expiresAt ?? "" };
}

export default function OpeningStock({ products, warehouseId, branchName, warehouseName, onSave, onAddProducts, onDirtyChange }: { products: Product[]; warehouseId: string; branchName: string; warehouseName: string; onSave: (entries: OpeningEntry[]) => void; onAddProducts: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<OpeningRow[]>(() => products.flatMap((product) => {
    const current = product.stockByLocation.filter((stock) => stock.warehouseId === warehouseId);
    return current.length ? current.map((stock) => makeRow(product.id, stock)) : [makeRow(product.id)];
  }));
  const [expanded, setExpanded] = useState<string[]>(() => {
    const firstUnrecorded = products.find((product) => !product.stockByLocation.some((stock) => stock.warehouseId === warehouseId));
    return firstUnrecorded ? [firstUnrecorded.id] : [];
  });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const recordedCount = useMemo(() => products.filter((product) => product.stockByLocation.some((stock) => stock.warehouseId === warehouseId)).length, [products, warehouseId]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(term)) : products;
  }, [products, query]);

  function update(rowId: string, field: keyof OpeningRow, value: string) {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
    onDirtyChange(true);
    setError("");
    setSaved("");
  }

  function addBatch(productId: string) {
    setRows((current) => [...current, makeRow(productId)]);
    setExpanded((current) => current.includes(productId) ? current : [...current, productId]);
    onDirtyChange(true);
  }

  function removeBatch(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
    onDirtyChange(true);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries: OpeningEntry[] = [];
    for (const product of products) {
      const productRows = rows.filter((row) => row.productId === product.id);
      const stocks: ProductStock[] = [];
      for (const row of productRows) {
        if (!row.quantity.trim()) {
          if (row.stockId || row.batchNumber.trim() || row.unitCost.trim() || row.mrp.trim() || row.manufacturedAt || row.expiresAt) return setError(`Enter a quantity for ${product.name}, or clear the unfinished row.`);
          continue;
        }
        const quantity = Number(row.quantity);
        const unitCost = row.unitCost.trim() ? Number(row.unitCost) : undefined;
        const mrpValue = row.mrp.trim() ? Number(row.mrp) : undefined;
        if (!Number.isFinite(quantity) || quantity < 0) return setError(`Enter a quantity of zero or more for ${product.name}.`);
        if (["Piece", "Box"].includes(product.unit) && !Number.isInteger(quantity)) return setError(`${product.name} is measured in ${product.unit}; enter a whole quantity.`);
        if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) return setError(`Enter a valid unit cost for ${product.name}.`);
        if (mrpValue !== undefined && (!Number.isFinite(mrpValue) || mrpValue < 0)) return setError(`Enter a valid MRP for ${product.name}.`);
        if (product.trackBatches && !row.batchNumber.trim()) return setError(`Enter a batch number for ${product.name}.`);
        if (row.manufacturedAt && row.expiresAt && row.expiresAt < row.manufacturedAt) return setError(`Expiry date must be after the manufacturing date for ${product.name}.`);
        stocks.push({ id: row.stockId ?? row.id, warehouseId, quantity, unitCost, batchNumber: product.trackBatches ? row.batchNumber.trim() : undefined, mrp: mrpValue, manufacturedAt: product.trackBatches ? row.manufacturedAt || undefined : undefined, expiresAt: product.trackBatches ? row.expiresAt || undefined : undefined });
      }
      if (stocks.length) entries.push({ productId: product.id, stocks });
    }
    if (!entries.length) return setError("Enter a quantity for at least one product.");
    onSave(entries);
    onDirtyChange(false);
    const savedStocks = new Map(entries.flatMap((entry) => entry.stocks.map((stock) => [stock.id, stock] as const)));
    setRows((current) => current.map((row) => {
      const stock = savedStocks.get(row.stockId ?? row.id);
      return stock ? { ...row, stockId: stock.id, batchNumber: stock.batchNumber ?? "", quantity: String(stock.quantity), unitCost: stock.unitCost === undefined ? "" : String(stock.unitCost), mrp: stock.mrp === undefined ? "" : String(stock.mrp), manufacturedAt: stock.manufacturedAt ?? "", expiresAt: stock.expiresAt ?? "" } : row;
    }));
    setError("");
    setSaved(`Opening stock saved for ${entries.length} ${entries.length === 1 ? "product" : "products"}.`);
  }

  function toggleExpanded(productId: string, open: boolean) {
    setExpanded((current) => open ? [...new Set([...current, productId])] : current.filter((id) => id !== productId));
  }

  return <>
    <div className="dash-page-heading product-heading"><div><p className="dash-eyebrow">INVENTORY</p><h1>Opening stock</h1><p>Record what you already have at this location.</p></div></div>
    <div className="opening-stock-page-location"><span className="opening-stock-location-icon"><ClipboardList size={17} /></span><div><small>STOCK LOCATION</small><strong>{branchName} · {warehouseName}</strong></div><span className="opening-stock-count">{recordedCount} of {products.length} recorded</span></div>
    {products.length > 0 && <label className="product-search"><Search size={16} /><Input aria-label="Search products" placeholder="Search products or SKU" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
    {products.length === 0 ? <section className="dash-card opening-stock-empty"><span className="empty-illustration"><ClipboardList size={25} /></span><h2>Add products first</h2><p>Once your products are in the catalog, you can enter their starting quantities here.</p><Button type="button" variant="ghost" onClick={onAddProducts}>Go to products</Button></section> : filtered.length === 0 ? <section className="dash-card product-no-results"><h2>No matching products</h2><p>Try another name or SKU.</p></section> : <form onSubmit={save}>
      <div className="opening-product-list">{filtered.map((product) => {
        const productRows = rows.filter((row) => row.productId === product.id);
        const filledRows = productRows.filter((row) => row.quantity.trim() !== "");
        const totalQuantity = filledRows.reduce((sum, row) => sum + Number(row.quantity), 0);
        const valueKnown = filledRows.length > 0 && filledRows.every((row) => row.unitCost.trim() !== "");
        const totalValue = filledRows.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unitCost || 0), 0);
        const hasSaved = productRows.some((row) => row.stockId);
        const hasDraft = productRows.some((row) => !row.stockId && (row.quantity.trim() || row.batchNumber.trim() || row.unitCost.trim() || row.mrp.trim() || row.manufacturedAt || row.expiresAt));
        const status = hasDraft ? "Unsaved" : hasSaved ? "Recorded" : "Not entered";
        const warnings = productRows.filter((row) => Number(row.unitCost) > 0 && Number(row.mrp) > Number(row.unitCost) * 10).length;
        const step = ["Piece", "Box"].includes(product.unit) ? "1" : "0.001";
        return <details className="opening-product" key={product.id} open={expanded.includes(product.id)} onToggle={(event) => toggleExpanded(product.id, event.currentTarget.open)}>
          <summary className="opening-product-summary"><ChevronDown className="opening-product-chevron" size={16} /><span className="opening-product-identity"><strong>{product.name}</strong><small className="sku">{product.sku}</small></span><span className="opening-product-unit">{product.unit}</span>{product.trackBatches && <span className="opening-product-badge">Batch tracked</span>}<span className={`opening-product-status ${status === "Recorded" ? "is-recorded" : status === "Unsaved" ? "is-unsaved" : ""}`}>{status}</span><span className="opening-product-summary-total">{filledRows.length ? <>{product.trackBatches && `${filledRows.length} ${filledRows.length === 1 ? "batch" : "batches"} · `}{totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} {product.unit} · {valueKnown ? money.format(totalValue) : "Value not set"}</> : product.trackBatches ? "No batches yet" : "Quantity empty"}</span>{warnings > 0 && <span className="opening-product-warning">{warnings} warning{warnings > 1 ? "s" : ""}</span>}</summary>
          <div className="opening-product-fields">
            {product.trackBatches ? <>
              <div className="opening-batch-header"><span>Batch / lot</span><span>Quantity</span><span>Unit cost (₹)</span><span>MRP (₹)</span><span>Manufactured</span><span>Expires</span><span>Value</span><span /></div>
              {productRows.map((row) => {
                const unitCostValue = Number(row.unitCost);
                const mrpValue = Number(row.mrp);
                const unusualPrice = unitCostValue > 0 && mrpValue > unitCostValue * 10;
                return <Fragment key={row.id}>
                  <div className="opening-batch-row">
                    <Input aria-label={`Batch number for ${product.name}`} maxLength={80} placeholder="e.g. BAT-001" value={row.batchNumber} onChange={(event) => update(row.id, "batchNumber", event.target.value)} />
                    <Input aria-label={`Quantity for ${product.name}, batch ${row.batchNumber || "new"}`} type="number" inputMode="decimal" min="0" step={step} placeholder="0" value={row.quantity} onChange={(event) => update(row.id, "quantity", event.target.value)} />
                    <Input aria-label={`Unit cost for ${product.name}, batch ${row.batchNumber || "new"}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={row.unitCost} onChange={(event) => update(row.id, "unitCost", event.target.value)} />
                    <div className="opening-price-field"><Input aria-label={`MRP for ${product.name}, batch ${row.batchNumber || "new"}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={row.mrp} onChange={(event) => update(row.id, "mrp", event.target.value)} />{unusualPrice && <small role="status">MRP is {(mrpValue / unitCostValue).toFixed(1)}× cost. Check for an extra zero?</small>}</div>
                    <Input aria-label={`Manufacturing date for ${product.name}`} type="date" value={row.manufacturedAt} onChange={(event) => update(row.id, "manufacturedAt", event.target.value)} />
                    <Input aria-label={`Expiry date for ${product.name}`} type="date" value={row.expiresAt} onChange={(event) => update(row.id, "expiresAt", event.target.value)} />
                    <span className="opening-batch-value">{row.quantity && row.unitCost ? money.format(Number(row.quantity) * Number(row.unitCost)) : "—"}</span>
                    <button className="opening-batch-remove" type="button" aria-label={`Remove batch row for ${product.name}`} disabled={Boolean(row.stockId)} onClick={() => removeBatch(row.id)}><Trash2 size={15} /></button>
                  </div>
                </Fragment>;
              })}
              <button className="opening-add-batch" type="button" onClick={() => addBatch(product.id)}><Plus size={14} />Add batch</button>
            </> : <div className="opening-simple-stock"><label><span>Quantity</span><Input aria-label={`Quantity for ${product.name}`} type="number" inputMode="decimal" min="0" step={step} placeholder="Empty" value={productRows[0]?.quantity ?? ""} onChange={(event) => productRows[0] && update(productRows[0].id, "quantity", event.target.value)} /></label><label><span>Unit cost (₹)</span><Input aria-label={`Unit cost for ${product.name}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="Optional" value={productRows[0]?.unitCost ?? ""} onChange={(event) => productRows[0] && update(productRows[0].id, "unitCost", event.target.value)} /></label><label><span>MRP (₹)</span><Input aria-label={`MRP for ${product.name}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="Optional" value={productRows[0]?.mrp ?? ""} onChange={(event) => productRows[0] && update(productRows[0].id, "mrp", event.target.value)} /></label><div className="opening-simple-value"><span>Value</span><strong>{productRows[0]?.quantity && productRows[0]?.unitCost ? money.format(Number(productRows[0].quantity) * Number(productRows[0].unitCost)) : "—"}</strong></div></div>}
          </div>
        </details>;
      })}</div>
      <div className="opening-stock-savebar">{error ? <p className="product-error" role="alert">{error}</p> : <p role="status">{saved || "Existing quantities are prefilled. Blank quantities are not recorded."}</p>}<Button type="submit">Save quantities</Button></div>
    </form>}
  </>;
}
