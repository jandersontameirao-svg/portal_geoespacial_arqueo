import { useState, useEffect } from "react";
import Joyride, { CallBackProps, STATUS, Step, ACTIONS, EVENTS } from "react-joyride";
import { useAuth } from "@/_core/hooks/useAuth";

const TOUR_COMPLETED_KEY = "portal_tour_completed";

const tourSteps: Step[] = [
  {
    target: "body",
    content: (
      <div className="text-center">
        <h3 className="text-lg font-bold mb-2">Bem-vindo ao Portal Geoespacial!</h3>
        <p className="text-sm text-muted-foreground">
          Este tour rápido vai apresentar as principais funcionalidades do sistema.
          Você pode pular a qualquer momento clicando em "Pular".
        </p>
      </div>
    ),
    placement: "center",
    disableBeacon: true,
  },
  {
    target: '[data-tour="projects"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Projetos</h4>
        <p className="text-sm text-muted-foreground">
          Acesse seus projetos geoespaciais. Cada projeto pode conter múltiplas camadas,
          arquivos e geometrias.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[data-tour="tools-menu"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Ferramentas</h4>
        <p className="text-sm text-muted-foreground">
          Acesse ferramentas avançadas como Mapas Técnicos ABNT, Atlas Automático
          e Repositório de Arquivos.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[data-tour="search"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Busca Global</h4>
        <p className="text-sm text-muted-foreground">
          Use Ctrl+K para buscar rapidamente projetos, arquivos e camadas em todo o sistema.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[data-tour="notifications"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Notificações</h4>
        <p className="text-sm text-muted-foreground">
          Receba alertas sobre novos convites, uploads concluídos e atividades importantes.
        </p>
      </div>
    ),
    placement: "bottom",
  },
  {
    target: '[data-tour="user-menu"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Menu do Usuário</h4>
        <p className="text-sm text-muted-foreground">
          Acesse seu perfil, configurações de segurança (MFA) e faça logout.
        </p>
      </div>
    ),
    placement: "bottom-end",
  },
  {
    target: '[data-tour="globe"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Visualizador 3D</h4>
        <p className="text-sm text-muted-foreground">
          Explore seus dados geoespaciais no globo 3D interativo. Use os controles
          para alternar entre visualização 2D/3D, adicionar geometrias e importar arquivos.
        </p>
      </div>
    ),
    placement: "left",
  },
  {
    target: '[data-tour="control-panel"]',
    content: (
      <div>
        <h4 className="font-semibold mb-1">Painel de Controle</h4>
        <p className="text-sm text-muted-foreground">
          Acesso rápido a todas as ferramentas e funcionalidades administrativas
          diretamente da página inicial.
        </p>
      </div>
    ),
    placement: "right",
  },
  {
    target: "body",
    content: (
      <div className="text-center">
        <h3 className="text-lg font-bold mb-2">Pronto para começar!</h3>
        <p className="text-sm text-muted-foreground">
          Você pode reiniciar este tour a qualquer momento pelo menu do usuário.
          Bom trabalho!
        </p>
      </div>
    ),
    placement: "center",
  },
];

interface GuidedTourProps {
  forceStart?: boolean;
  onComplete?: () => void;
}

export function GuidedTour({ forceStart = false, onComplete }: GuidedTourProps) {
  const { isAuthenticated } = useAuth();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (forceStart) {
      setRun(true);
      setStepIndex(0);
      return;
    }

    // Verificar se é a primeira visita do usuário
    if (isAuthenticated) {
      const tourCompleted = localStorage.getItem(TOUR_COMPLETED_KEY);
      if (!tourCompleted) {
        // Aguardar um pouco para os elementos renderizarem
        const timer = setTimeout(() => {
          setRun(true);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [isAuthenticated, forceStart]);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, action, index, type } = data;

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      // Avançar para o próximo step
      setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem(TOUR_COMPLETED_KEY, "true");
      onComplete?.();
    }
  };

  if (!isAuthenticated) return null;

  return (
    <Joyride
      steps={tourSteps}
      run={run}
      stepIndex={stepIndex}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      spotlightClicks
      disableOverlayClose
      callback={handleJoyrideCallback}
      locale={{
        back: "Voltar",
        close: "Fechar",
        last: "Finalizar",
        next: "Próximo",
        skip: "Pular",
      }}
      styles={{
        options: {
          primaryColor: "#f97316", // orange-500
          textColor: "#1e293b",
          backgroundColor: "#ffffff",
          arrowColor: "#ffffff",
          overlayColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: "12px",
          padding: "16px",
        },
        tooltipContainer: {
          textAlign: "left",
        },
        tooltipTitle: {
          fontSize: "16px",
          fontWeight: 600,
        },
        tooltipContent: {
          padding: "8px 0",
        },
        buttonNext: {
          backgroundColor: "#f97316",
          borderRadius: "8px",
          padding: "8px 16px",
        },
        buttonBack: {
          color: "#64748b",
          marginRight: "8px",
        },
        buttonSkip: {
          color: "#94a3b8",
        },
        spotlight: {
          borderRadius: "8px",
        },
      }}
      floaterProps={{
        disableAnimation: false,
      }}
    />
  );
}

// Hook para controlar o tour programaticamente
export function useTour() {
  const [shouldStart, setShouldStart] = useState(false);

  const startTour = () => {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
    setShouldStart(true);
  };

  const resetTourFlag = () => {
    setShouldStart(false);
  };

  return { shouldStart, startTour, resetTourFlag };
}
