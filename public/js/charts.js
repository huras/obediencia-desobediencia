const CORES = {
  verde: "#3dba8a",
  vermelho: "#e07a4a",
  amarelo: "#e8c44a",
  vazio: "rgba(255,255,255,0.12)",
};

const formatadorCurto = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "numeric",
  month: "numeric",
});

function rotuloDia(diaIso) {
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  return formatadorCurto.format(data).replace(".", "");
}

function montarConic(item) {
  const verde = item.obediencia || 0;
  const vermelho = item.desobediencia || 0;
  const amarelo = item.desculpa || 0;
  const total = verde + vermelho + amarelo;
  if (total === 0) {
    return `conic-gradient(${CORES.vazio} 0deg 360deg)`;
  }

  const fatias = [];
  let angulo = 0;
  const partes = [
    { valor: verde, cor: CORES.verde },
    { valor: vermelho, cor: CORES.vermelho },
    { valor: amarelo, cor: CORES.amarelo },
  ];

  for (const parte of partes) {
    if (parte.valor <= 0) continue;
    const proximo = angulo + (parte.valor / total) * 360;
    fatias.push(`${parte.cor} ${angulo}deg ${proximo}deg`);
    angulo = proximo;
  }
  return `conic-gradient(${fatias.join(", ")})`;
}

function escapar(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Renderiza sequência horizontal de cards-pizza (um por dia).
 * onEscolherDia(diaIso) — toque no card abre aquele dia.
 */
export function renderizarPizzas(container, serie, { diaAtivo, onEscolherDia } = {}) {
  if (!container) return;

  // Série invertida: hoje / mais recente primeiro (melhor no mobile)
  const dias = [...(serie || [])].reverse();
  container.innerHTML = "";

  if (dias.length === 0) {
    container.innerHTML =
      '<p class="pizzas__vazio">Sem histórico neste período.</p>';
    return;
  }

  const faixa = document.createElement("div");
  faixa.className = "pizzas__faixa";
  faixa.setAttribute("role", "list");

  for (const item of dias) {
    const verde = item.obediencia || 0;
    const vermelho = item.desobediencia || 0;
    const amarelo = item.desculpa || 0;
    const total = verde + vermelho + amarelo;
    const ativo = item.dia === diaAtivo;

    const card = document.createElement("button");
    card.type = "button";
    card.className = `pizza-card${ativo ? " is-ativo" : ""}`;
    card.setAttribute("role", "listitem");
    card.setAttribute("data-dia", item.dia);
    card.setAttribute(
      "aria-label",
      `${rotuloDia(item.dia)}: ${verde} verde, ${vermelho} vermelho, ${amarelo} amarelo`
    );
    if (ativo) card.setAttribute("aria-current", "true");

    card.innerHTML = `
      <span class="pizza-card__dia">${escapar(rotuloDia(item.dia))}</span>
      <span class="pizza-card__pizza" style="background: ${montarConic(item)}" aria-hidden="true">
        <span class="pizza-card__miolo">${total === 0 ? "·" : total}</span>
      </span>
      <span class="pizza-card__legenda">
        <span class="pizza-card__chip pizza-card__chip--verde">${verde}</span>
        <span class="pizza-card__chip pizza-card__chip--vermelho">${vermelho}</span>
        <span class="pizza-card__chip pizza-card__chip--amarelo">${amarelo}</span>
      </span>
    `;

    card.addEventListener("click", () => onEscolherDia?.(item.dia));
    faixa.appendChild(card);
  }

  container.appendChild(faixa);

  // Centraliza o dia ativo no scroll
  const ativoEl = faixa.querySelector(".pizza-card.is-ativo");
  if (ativoEl) {
    requestAnimationFrame(() => {
      ativoEl.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: "smooth",
      });
    });
  }
}

export function calcularResumo(serie) {
  let obediencia = 0;
  let desobediencia = 0;
  let desculpa = 0;
  for (const item of serie) {
    obediencia += item.obediencia || 0;
    desobediencia += item.desobediencia || 0;
    desculpa += item.desculpa || 0;
  }
  const total = obediencia + desobediencia;
  const razao = total === 0 ? null : Math.round((obediencia / total) * 100);
  return { obediencia, desobediencia, desculpa, razao };
}
