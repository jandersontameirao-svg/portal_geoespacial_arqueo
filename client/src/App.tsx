import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import Header from "./components/Header";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Invitations from "./pages/Invitations";
import Admin from "./pages/Admin";
import Security from "./pages/Security";
import TechnicalMaps from "./pages/TechnicalMaps";
import Atlas from "./pages/Atlas";
import Users from "./pages/Users";
import Files from "./pages/Files";
import Backups from "./pages/Backups";
import BaseLayers from "./pages/BaseLayers";
import BaseLayersViewer from "./pages/BaseLayersViewer";
import GisUploads from "./pages/GisUploads";
import WMSDemo from "./pages/WMSDemo";
import GISDiagnostics from "./pages/GISDiagnostics";
import OgcCatalog from "./pages/OgcCatalog";
import { GuidedTour } from "./components/GuidedTour";
import Atena from "./pages/Atena";
import AssistenteAtena from "./pages/AssistenteAtena";
import Observacoes from "./pages/Observacoes";
import MalhaCampo from "./pages/MalhaCampo";
import AtenaChatWidget from "./components/AtenaChatWidget";

function Router() {
  return (
    <>
      <Header />
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:id" component={ProjectDetail} />
        <Route path="/invitations" component={Invitations} />
        <Route path="/admin" component={Admin} />
        <Route path="/admin/users" component={Users} />
        <Route path="/security" component={Security} />
        <Route path="/technical-maps" component={TechnicalMaps} />
        <Route path="/atlas" component={Atlas} />
        <Route path="/atena" component={Atena} />
        <Route path="/assistente" component={AssistenteAtena} />
        <Route path="/observacoes" component={Observacoes} />
        <Route path="/malha-campo" component={MalhaCampo} />
        <Route path="/files" component={Files} />
        <Route path="/admin/backups" component={Backups} />
        <Route path="/admin/ogc-catalog" component={OgcCatalog} />
        <Route path="/base-layers" component={BaseLayers} />
        <Route path="/base-layers/viewer" component={BaseLayersViewer} />
        <Route path="/gis-uploads" component={GisUploads} />
        <Route path="/wms-demo" component={WMSDemo} />
        <Route path="/gis-diagnostics" component={GISDiagnostics} />
        <Route path={"/404"} component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <GuidedTour />
          <Router />
          <AtenaChatWidget />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
