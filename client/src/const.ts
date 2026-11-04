import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS };

/**
 * Login próprio (e-mail+senha): não há portal OAuth externo. Quando uma página
 * exige autenticação e não há sessão, levamos o usuário à Home ("/"), que
 * renderiza o formulário de login. Se já estamos na Home, não faz nada —
 * o formulário já está visível.
 */
export const startLogin = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== "/") {
    window.location.assign("/");
  }
};
