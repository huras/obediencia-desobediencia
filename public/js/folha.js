/**
 * Folha inferior acessível (bottom sheet) reutilizável.
 */
export function criarFolha({ titulo, corpoHtml, acoes = [] }) {
  const overlay = document.createElement("div");
  overlay.className = "folha-overlay";
  overlay.setAttribute("role", "presentation");

  const painel = document.createElement("div");
  painel.className = "folha";
  painel.setAttribute("role", "dialog");
  painel.setAttribute("aria-modal", "true");
  painel.setAttribute("aria-label", titulo);

  painel.innerHTML = `
    <div class="folha__puxador" aria-hidden="true"></div>
    <header class="folha__cabecalho">
      <h2 class="folha__titulo">${titulo}</h2>
      <button type="button" class="folha__fechar" aria-label="Fechar">×</button>
    </header>
    <div class="folha__corpo">${corpoHtml}</div>
    <footer class="folha__acoes"></footer>
  `;

  const elAcoes = painel.querySelector(".folha__acoes");
  for (const acao of acoes) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `folha__btn ${acao.classe || ""}`.trim();
    botao.textContent = acao.rotulo;
    botao.addEventListener("click", () => acao.onClick?.());
    elAcoes.appendChild(botao);
  }

  overlay.appendChild(painel);
  document.body.appendChild(overlay);

  const focoAnterior = document.activeElement;
  const btnFechar = painel.querySelector(".folha__fechar");

  function fechar() {
    overlay.classList.remove("is-aberta");
    window.setTimeout(() => {
      overlay.remove();
      if (focoAnterior && typeof focoAnterior.focus === "function") {
        focoAnterior.focus();
      }
    }, 200);
    document.removeEventListener("keydown", noEsc);
  }

  function noEsc(ev) {
    if (ev.key === "Escape") fechar();
  }

  btnFechar.addEventListener("click", fechar);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) fechar();
  });
  document.addEventListener("keydown", noEsc);

  requestAnimationFrame(() => overlay.classList.add("is-aberta"));

  const primeiroCampo = painel.querySelector("textarea, input, button");
  if (primeiroCampo) primeiroCampo.focus();

  return {
    painel,
    fechar,
    query: (sel) => painel.querySelector(sel),
  };
}
