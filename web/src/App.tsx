import { useState, type FormEvent } from "react";
import { ArrowRight, Package } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import SetupWizard from "./SetupWizard";
import Dashboard from "./Dashboard";
import type { Workspace } from "./Workspace";
import InventoryCanvas from "./InventoryCanvas";

export default function App() {
  const [previewSetup, setPreviewSetup] = useState(() => window.location.pathname === "/setup");
  const [email, setEmail] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmail((value) => value.trim());
    window.history.pushState(null, "", "/setup");
    setPreviewSetup(true);
  }

  if (workspace) return <Dashboard workspace={workspace} onSignOut={() => { setWorkspace(null); setPreviewSetup(false); window.history.replaceState(null, "", "/"); }} />;
  if (previewSetup) return <SetupWizard onComplete={(details) => { setWorkspace(details); window.history.replaceState(null, "", "/dashboard"); }} onBack={() => { window.history.replaceState(null, "", "/"); setPreviewSetup(false); }} />;

  return (
    <main className="page-frame">
      <section className="app-shell" aria-label="Stockroom sign in">
        <div className="login-layout">
          <section className="welcome-panel" aria-labelledby="welcome-title">
          <a className="brand" href="#home" aria-label="Stockroom home">
            <span className="brand-mark"><Package size={17} strokeWidth={1.8} /></span>
            <span>stockroom<span className="brand-period">.</span></span>
          </a>
            <InventoryCanvas />
            <div className="welcome-copy">
              <div className="eyebrow"><span className="eyebrow-line" /> INVENTORY, IN SYNC</div>
              <h1 id="welcome-title">Your stock,<br />in view.</h1>
              <p>Keep products, branches, and warehouses moving together.</p>
              <div className="welcome-tags"><span>Products</span><i /><span>Locations</span><i /><span>Stock</span></div>
            </div>
            <span className="welcome-footer">A clearer view of every location.</span>
          </section>

          <section className="form-panel" aria-labelledby="signin-title">
            <div className="form-content">
              <div className="form-intro">
                <div className="form-icon"><Package size={20} strokeWidth={1.8} /></div>
                <p className="form-kicker">WELCOME TO STOCKROOM</p>
                <h2 id="signin-title">Sign in to your workspace</h2>
                <p className="form-subtitle">Get started with your work email.</p>
              </div>

              <form onSubmit={submit} className="signin-form">
                <div className="field-group">
                  <Label htmlFor="email">Email address</Label>
                  <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
                </div>
                <Button type="submit" className="submit-button">
                  <span>Continue</span><ArrowRight size={17} />
                </Button>
              </form>

              <p className="invite-note">Need access? Ask your workspace administrator for an invite.</p>
            </div>
            <div className="form-footnote"><span>SECURE WORKSPACE</span><span>© 2026 Stockroom</span></div>
          </section>
        </div>
      </section>
    </main>
  );
}
