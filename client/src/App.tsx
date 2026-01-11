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
        <Route path="/security" component={Security} />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
