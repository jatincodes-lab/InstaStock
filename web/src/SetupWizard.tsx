import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Package } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import type { Workspace } from "./Workspace";

type Step = "business" | "branch" | "warehouse" | "done";

const steps: Exclude<Step, "done">[] = ["business", "branch", "warehouse"];
const titles: Record<Exclude<Step, "done">, string> = {
  business: "Your business",
  branch: "First branch",
  warehouse: "First warehouse",
};

export default function SetupWizard({ onBack, onComplete }: { onBack: () => void; onComplete: (workspace: Workspace) => void }) {
  const [step, setStep] = useState<Step>("business");
  const [businessName, setBusinessName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [message, setMessage] = useState("");

  function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (step === "business") {
      const value = businessName.trim();
      if (!value) return setMessage("Enter your business name to continue.");
      setBusinessName(value);
      setStep("branch");
    } else if (step === "branch") {
      const value = branchName.trim();
      if (!value) return setMessage("Enter a branch name to continue.");
      setBranchName(value);
      setStep("warehouse");
    } else if (step === "warehouse") {
      const value = warehouseName.trim();
      if (!value) return setMessage("Enter a warehouse name to finish setup.");
      setWarehouseName(value);
      setStep("done");
    }
  }

  function goBack() {
    setMessage("");
    if (step === "branch") setStep("business");
    else if (step === "warehouse") setStep("branch");
    else if (step === "done") setStep("warehouse");
    else onBack();
  }

  function completeSetup() {
    const branchId = crypto.randomUUID();
    const warehouseId = crypto.randomUUID();
    onComplete({ businessName, activeBranchId: branchId, activeWarehouseId: warehouseId, branches: [{ id: branchId, name: branchName, active: true, warehouses: [{ id: warehouseId, name: warehouseName, active: true }] }] });
  }

  const currentStep = steps.indexOf(step as Exclude<Step, "done">);

  return (
    <main className="setup-frame">
      <section className="setup-shell" aria-label="Workspace setup">
        <header className="setup-header">
          <a className="setup-brand" href="#setup" aria-label="Stockroom">
            <span className="setup-brand-mark"><Package size={17} /></span><span>stockroom<span className="setup-brand-dot">.</span></span>
          </a>
          <span className="setup-preview-tag">PREVIEW · NOT SAVED</span>
        </header>

        <div className="setup-main">
          <div className="setup-content">
            {step !== "done" ? (
              <>
                <div className="setup-progress" aria-label={`Step ${currentStep + 1} of 3`}>
                  {steps.map((item, index) => (
                    <div className={`setup-progress-step ${index <= currentStep ? "is-active" : ""}`} key={item}>
                      <span>{index < currentStep ? <Check size={13} /> : `0${index + 1}`}</span>
                      <small>{titles[item]}</small>
                    </div>
                  ))}
                </div>
                <p className="setup-eyebrow">LET’S SET UP YOUR SPACE</p>
                <h1 className="setup-title">{titles[step]}</h1>
                <p className="setup-description">
                  {step === "business" && "Start with the name your team knows you by."}
                  {step === "branch" && "Branches help organize your business locations."}
                  {step === "warehouse" && "Stock is tracked separately in each warehouse."}
                </p>

                <form className="setup-form" onSubmit={advance}>
                  {step === "business" && (
                    <div className="setup-field">
                      <Label htmlFor="business-name">Business name</Label>
                      <Input id="business-name" autoFocus autoComplete="organization" placeholder="e.g. Northstar Supply" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required maxLength={150} />
                      <details className="optional-details">
                        <summary>Regional settings <span>Optional · change later</span></summary>
                        <div className="optional-fields">
                          <div><Label htmlFor="currency">Currency</Label><select id="currency" defaultValue="INR"><option value="INR">INR · Indian rupee</option><option value="USD">USD · US dollar</option><option value="EUR">EUR · Euro</option></select></div>
                          <div><Label htmlFor="timezone">Timezone</Label><select id="timezone" defaultValue="Asia/Kolkata"><option value="Asia/Kolkata">India Standard Time</option><option value="UTC">UTC</option><option value="America/New_York">Eastern Time</option></select></div>
                        </div>
                      </details>
                    </div>
                  )}
                  {step === "branch" && (
                    <div className="setup-field">
                      <Label htmlFor="branch-name">Branch name</Label>
                      <Input id="branch-name" autoFocus placeholder="e.g. Main branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} required maxLength={150} />
                      <details className="optional-details">
                        <summary>Branch details <span>Optional · add later</span></summary>
                        <div className="optional-fields stacked"><div><Label htmlFor="branch-code">Branch code</Label><Input id="branch-code" placeholder="e.g. DEL-01" maxLength={50} /></div><div><Label htmlFor="branch-address">Address</Label><Input id="branch-address" placeholder="Street, city" maxLength={500} /></div></div>
                      </details>
                    </div>
                  )}
                  {step === "warehouse" && (
                    <div className="setup-field">
                      <Label htmlFor="warehouse-name">Warehouse name</Label>
                      <Input id="warehouse-name" autoFocus placeholder="e.g. Main warehouse" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} required maxLength={150} />
                      <p className="setup-hint">Branch <strong>{branchName}</strong></p>
                      <details className="optional-details">
                        <summary>Warehouse address <span>Optional · add later</span></summary>
                        <div className="optional-fields"><div><Label htmlFor="warehouse-address">Address</Label><Input id="warehouse-address" placeholder="Street, city" maxLength={500} /></div></div>
                      </details>
                    </div>
                  )}
                  {message && <p className="setup-notice" role="status">{message}</p>}
                  <div className="setup-actions">
                    <Button type="button" variant="ghost" className="setup-back" onClick={goBack}><ArrowLeft size={15} /> Back</Button>
                    <Button type="submit" className="setup-next">{step === "warehouse" ? "Finish setup" : "Continue"}<ArrowRight size={16} /></Button>
                  </div>
                </form>
                <p className="setup-save-note">You can add more details and locations later.</p>
              </>
            ) : (
              <div className="setup-done">
                <span className="setup-done-icon"><Check size={23} /></span>
                <p className="setup-eyebrow">YOUR SPACE IS READY</p>
                <h1 className="setup-title">A good start.</h1>
                <p className="setup-description">Your business and first stock location are set up.</p>
                <div className="setup-summary"><div><small>BUSINESS</small><strong>{businessName}</strong></div><div><small>BRANCH</small><strong>{branchName}</strong></div><div><small>WAREHOUSE</small><strong>{warehouseName}</strong></div></div>
                <Button type="button" className="setup-next" onClick={completeSetup}>Open dashboard<ArrowRight size={16} /></Button>
                {message && <p className="setup-notice" role="status">{message}</p>}
                <button className="setup-link" type="button" onClick={onBack}>Back to sign in preview</button>
              </div>
            )}
          </div>
        </div>
        <footer className="setup-footer"><span>STOCKROOM · WORKSPACE SETUP</span><span>Step {step === "done" ? "03" : `0${currentStep + 1}`} / 03</span></footer>
      </section>
    </main>
  );
}
