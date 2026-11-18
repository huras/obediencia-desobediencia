import {
  buscarDia,
  buscarHistorico,
  enviarEvento,
  definirDia,
  salvarComentario,
  excluirEvento,
} from "./api.js?v=20261118c";
import {
  inicializarGrafico,
  atualizarGrafico,
  calcularResumo,
} from "./charts.js?v=20261118c";
import { criarFolha } from "./folha.js?v=20261118c";

const INTERVALO_POLL_MS = 2500;
const COMENTARIO_MAX = 280;

const elData = document.getElementById("rotulo-data");
const elDicaDia = document.getElementById("dica-dia");
const elStatus = document.getElementById("status-sync");
const elObediencia = document.getElementById("valor-obediencia");
const elDesobediencia = document.getElementById("valor-desobediencia");
const elDesculpa = document.getElementById("valor-desculpa");
const elResumoObediencia = document.getElementById("resumo-obediencia");
const elResumoDesobediencia = document.getElementById("resumo-desobediencia");
const elResumoDesculpa = document.getElementById("resumo-desculpa");
const elResumoRazao = document.getElementById("resumo-razao");
const elListaLog = document.getElementById("lista-log");
const elLogVazio = document.getElementById("log-vazio");
const btnDiaAnterior = document.getElementById("btn-dia-anterior");
const btnDiaProximo = document.getElementById("btn-dia-proximo");
const btnEscolherDia = document.getElementById("btn-escolher-dia");
const btnAjusteManual = document.getElementById("btn-ajuste-manual");
const btnDesculpa = document.getElementById("btn-desculpa");
const canvas = document.getElementById("grafico-progresso");

const formatadorData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const formatadorHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

let estado = {
  dia: null,
  obediencia: 0,
  desobediencia: 0,
  desculpa: 0,
  atualizadoEm: null,
  eventos: [],
};

let diaAtivo = null;
let diaHojeCache = null;
let periodoDias = 7;
let abortPoll = null;
let abortHistorico = null;
let filaEnvio = Promise.resolve();
let pollId = null;
let folhaAberta = null;

function hojeIsoLocal() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function somarDias(diaIso, delta) {
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const base = Date.UTC(ano, mes - 1, dia, 15, 0, 0);
  const prox = new Date(base + delta * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(prox);
}

function formatarRotuloDia(diaIso) {
  if (!diaIso) return formatadorData.format(new Date());
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  return formatadorData.format(data);
}

function definirStatus(texto, tipo = "") {
  elStatus.textContent = texto;
  elStatus.classList.remove("is-ok", "is-erro");
  if (tipo) elStatus.classList.add(tipo);
}

function animarBump(elemento) {
  elemento.classList.remove("is-bump");
  void elemento.offsetWidth;
  elemento.classList.add("is-bump");
  window.setTimeout(() => elemento.classList.remove("is-bump"), 220);
}

function ehHoje(dia) {
  return dia === (diaHojeCache || hojeIsoLocal());
}

function atualizarNavegacaoDia() {
  const hoje = diaHojeCache || hojeIsoLocal();
  const passado = diaAtivo && diaAtivo < hoje;
  elDicaDia.textContent = passado ? "dia passado · editável" : "hoje";
  elDicaDia.classList.toggle("is-passado", passado);
  btnDiaProximo.disabled = !diaAtivo || diaAtivo >= hoje;
  btnDiaAnterior.disabled = false;
}

function atualizarBotaoDesculpa() {
  if (!btnDesculpa) return;
  const pode = (estado.desobediencia || 0) > 0;
  btnDesculpa.disabled = !pode;
  btnDesculpa.title = pode
    ? "Anula 1 vermelho e marca amarelo"
    : "Precisa de pelo menos 1 ponto vermelho";
}

function pintarContadores(proximo, { animar = false } = {}) {
  const mudouObediencia = proximo.obediencia !== estado.obediencia;
  const mudouDesobediencia = proximo.desobediencia !== estado.desobediencia;
  const mudouDesculpa = (proximo.desculpa || 0) !== (estado.desculpa || 0);

  elObediencia.textContent = String(proximo.obediencia || 0);
  elDesobediencia.textContent = String(proximo.desobediencia || 0);
  elDesculpa.textContent = String(proximo.desculpa || 0);

  if (animar && mudouObediencia) animarBump(elObediencia);
  if (animar && mudouDesobediencia) animarBump(elDesobediencia);
  if (animar && mudouDesculpa) animarBump(elDesculpa);

  estado = {
    ...estado,
    ...proximo,
    desculpa: proximo.desculpa || 0,
    eventos: Array.isArray(proximo.eventos) ? proximo.eventos : estado.eventos,
  };
  atualizarBotaoDesculpa();
}

function pintarResumo(serie) {
  const resumo = calcularResumo(serie);
  elResumoObediencia.textContent = String(resumo.obediencia);
  elResumoDesobediencia.textContent = String(resumo.desobediencia);
  elResumoDesculpa.textContent = String(resumo.desculpa);
  elResumoRazao.textContent =
    resumo.razao === null ? "—" : `${resumo.razao}%`;
}

function rotuloTipo(tipo) {
  if (tipo === "obediencia") return "Obediência";
  if (tipo === "desobediencia") return "Desobediência";
  if (tipo === "desculpa") return "Desculpa";
  return "Ajuste";
}

function badgeDelta(evento) {
  if (evento.tipo === "ajuste") return "±";
  if (evento.tipo === "desculpa") return "↩";
  return evento.delta > 0 ? "+1" : "−1";
}

function escaparHtml(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pintarLog(eventos) {
  const lista = Array.isArray(eventos) ? eventos : [];
  elListaLog.innerHTML = "";

  for (const evento of lista) {
    const li = document.createElement("li");
    li.className = `log__item log__item--${evento.tipo || "ajuste"}`;
    const hora = evento.criadoEm
      ? formatadorHora.format(new Date(evento.criadoEm))
      : "";
    const comentario = evento.comentario
      ? escaparHtml(evento.comentario)
      : "Sem observação";
    const podeGerir = evento.tipo !== "ajuste";

    li.innerHTML = `
      <span class="log__badge">${badgeDelta(evento)}</span>
      <div>
        <p class="log__meta">${rotuloTipo(evento.tipo)} · ${hora}</p>
        <p class="log__comentario ${evento.comentario ? "" : "is-vazio"}">${comentario}</p>
      </div>
      ${
        podeGerir
          ? `<div class="log__acoes">
              <button type="button" class="log__editar" data-editar-id="${evento.id}">Nota</button>
              <button type="button" class="log__excluir" data-excluir-id="${evento.id}" aria-label="Excluir ponto">Excluir</button>
            </div>`
          : `<span></span>`
      }
    `;
    elListaLog.appendChild(li);
  }

  elLogVazio.classList.toggle("is-oculto", lista.length > 0);
}

function aplicarEstadoDia(dados, { animar = false } = {}) {
  diaAtivo = dados.dia;
  diaHojeCache = hojeIsoLocal();
  pintarContadores(dados, { animar });
  pintarLog(dados.eventos || []);
  elData.textContent = formatarRotuloDia(dados.dia);
  atualizarNavegacaoDia();
}

async function sincronizarHistorico() {
  if (abortHistorico) abortHistorico.abort();
  abortHistorico = new AbortController();
  try {
    const dados = await buscarHistorico(periodoDias, abortHistorico.signal);
    atualizarGrafico(dados.dias || []);
    pintarResumo(dados.dias || []);
  } catch (erro) {
    if (erro.name === "AbortError") return;
    console.warn("Falha ao carregar histórico", erro);
  }
}

async function sincronizarDia({ silencioso = false } = {}) {
  if (!diaAtivo) diaAtivo = hojeIsoLocal();
  if (abortPoll) abortPoll.abort();
  abortPoll = new AbortController();

  try {
    const dados = await buscarDia(diaAtivo, abortPoll.signal);
    const mudou =
      dados.obediencia !== estado.obediencia ||
      dados.desobediencia !== estado.desobediencia ||
      dados.dia !== estado.dia ||
      (dados.eventos?.length || 0) !== (estado.eventos?.length || 0);

    aplicarEstadoDia(dados, { animar: mudou && silencioso });

    if (!silencioso || mudou) {
      definirStatus(
        ehHoje(dados.dia) ? "Ao vivo · compartilhado" : "Editando dia passado",
        "is-ok"
      );
    }

    if (mudou) await sincronizarHistorico();
  } catch (erro) {
    if (erro.name === "AbortError") return;
    definirStatus("Sem conexão com o servidor", "is-erro");
  }
}

function fecharFolhaAtual() {
  if (folhaAberta) {
    folhaAberta.fechar();
    folhaAberta = null;
  }
}

function enfileirarEvento({ tipo, delta, comentario = "" }) {
  const otimista = {
    ...estado,
    obediencia:
      tipo === "obediencia"
        ? Math.max(0, estado.obediencia + delta)
        : estado.obediencia,
    desobediencia: estado.desobediencia,
    desculpa: estado.desculpa || 0,
  };

  if (tipo === "desobediencia") {
    otimista.desobediencia = Math.max(0, estado.desobediencia + delta);
  } else if (tipo === "desculpa" && delta === 1) {
    otimista.desculpa = (estado.desculpa || 0) + 1;
    otimista.desobediencia = Math.max(0, estado.desobediencia - 1);
  }

  pintarContadores(otimista, { animar: true });

  if (navigator.vibrate) {
    try {
      navigator.vibrate(12);
    } catch {
      /* ignore */
    }
  }

  filaEnvio = filaEnvio
    .then(async () => {
      const confirmado = await enviarEvento({
        tipo,
        delta,
        comentario,
        dia: diaAtivo,
      });
      aplicarEstadoDia(confirmado, { animar: false });
      await sincronizarHistorico();
      definirStatus(
        ehHoje(confirmado.dia)
          ? "Ao vivo · compartilhado"
          : "Dia passado atualizado",
        "is-ok"
      );
    })
    .catch(async (erro) => {
      console.warn("Falha ao enviar evento", erro);
      definirStatus("Não deu para salvar. Tentando sincronizar…", "is-erro");
      await sincronizarDia();
    });
}

/** Folha na hora do +: observação já nasce ligada ao ponto. */
function abrirFolhaMarcarPonto(tipo, delta) {
  if (tipo === "desculpa" && (estado.desobediencia || 0) < 1) {
    definirStatus("Precisa de um ponto vermelho para se retratar", "is-erro");
    return;
  }

  fecharFolhaAtual();
  const ehMais = delta === 1;
  let titulo = "Marcar ponto";
  let meta = `${ehMais ? "+1" : "−1"} · a observação fica ligada a ele`;
  let placeholder = "Ex.: guardou o brinquedo sem reclamar";

  if (tipo === "obediencia") {
    titulo = ehMais ? "Marcar obediência" : "Diminuir obediência";
  } else if (tipo === "desobediencia") {
    titulo = ehMais ? "Marcar desobediência" : "Diminuir desobediência";
    placeholder = "Ex.: gritou / não quis guardar";
  } else if (tipo === "desculpa") {
    titulo = "Desculpas / retratação";
    meta = "Anula 1 vermelho e soma 1 amarelo";
    placeholder = "Ex.: pediu desculpas pelo que falou";
  }

  const folha = criarFolha({
    titulo,
    corpoHtml: `
      <p class="log__meta">${meta}</p>
      <div class="folha__campo">
        <label for="campo-comentario">Observação (opcional, até ${COMENTARIO_MAX})</label>
        <textarea id="campo-comentario" maxlength="${COMENTARIO_MAX}" placeholder="${placeholder}"></textarea>
      </div>
    `,
    acoes: [
      {
        rotulo: "Cancelar",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: tipo === "desculpa" ? "Se retratar" : ehMais ? "Marcar" : "Confirmar",
        classe: "folha__btn--primario",
        onClick: () => {
          const texto = folha.query("#campo-comentario").value.trim();
          folha.fechar();
          enfileirarEvento({ tipo, delta, comentario: texto });
        },
      },
    ],
  });
  folhaAberta = folha;
}

function abrirFolhaNota({ eventoId, comentarioInicial = "", titulo }) {
  fecharFolhaAtual();
  const folha = criarFolha({
    titulo: titulo || "Observação do ponto",
    corpoHtml: `
      <div class="folha__campo">
        <label for="campo-comentario">Observação (opcional, até ${COMENTARIO_MAX})</label>
        <textarea id="campo-comentario" maxlength="${COMENTARIO_MAX}" placeholder="Ex.: guardou o brinquedo sem reclamar">${escaparHtml(comentarioInicial)}</textarea>
      </div>
    `,
    acoes: [
      {
        rotulo: "Cancelar",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: "Salvar",
        classe: "folha__btn--primario",
        onClick: async () => {
          const texto = folha.query("#campo-comentario").value.trim();
          try {
            const dados = await salvarComentario(eventoId, texto);
            aplicarEstadoDia(dados);
            await sincronizarHistorico();
            definirStatus("Observação salva", "is-ok");
            folha.fechar();
          } catch (erro) {
            definirStatus(erro.message || "Falha ao salvar", "is-erro");
          }
        },
      },
    ],
  });
  folhaAberta = folha;
}

function abrirFolhaExcluir(evento) {
  fecharFolhaAtual();
  const folha = criarFolha({
    titulo: "Excluir ponto?",
    corpoHtml: `
      <p class="log__meta">Soft delete: some do log e desfaz o contador. O registro fica guardado.</p>
      <p class="log__comentario">${
        evento.comentario
          ? escaparHtml(evento.comentario)
          : "Sem observação"
      }</p>
    `,
    acoes: [
      {
        rotulo: "Cancelar",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: "Excluir",
        classe: "folha__btn--primario",
        onClick: async () => {
          try {
            const dados = await excluirEvento(evento.id);
            aplicarEstadoDia(dados, { animar: true });
            await sincronizarHistorico();
            definirStatus("Ponto excluído", "is-ok");
            folha.fechar();
          } catch (erro) {
            definirStatus(erro.message || "Falha ao excluir", "is-erro");
          }
        },
      },
    ],
  });
  folhaAberta = folha;
}

function abrirFolhaEscolherDia() {
  fecharFolhaAtual();
  const hoje = hojeIsoLocal();
  const folha = criarFolha({
    titulo: "Escolher dia",
    corpoHtml: `
      <div class="folha__campo">
        <label for="campo-dia">Dia (até hoje)</label>
        <input id="campo-dia" type="date" max="${hoje}" value="${diaAtivo || hoje}" />
      </div>
    `,
    acoes: [
      {
        rotulo: "Cancelar",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: "Abrir dia",
        classe: "folha__btn--primario",
        onClick: async () => {
          const escolhido = folha.query("#campo-dia").value;
          if (!escolhido || escolhido > hoje) {
            definirStatus("Escolha um dia válido", "is-erro");
            return;
          }
          diaAtivo = escolhido;
          folha.fechar();
          await sincronizarDia();
          await sincronizarHistorico();
        },
      },
    ],
  });
  folhaAberta = folha;
}

function abrirFolhaAjusteManual() {
  fecharFolhaAtual();
  const folha = criarFolha({
    titulo: "Ajuste manual do dia",
    corpoHtml: `
      <p class="log__meta">Corrige os totais sem precisar +/− um a um. Fica registrado no log.</p>
      <div class="folha__linha">
        <div class="folha__campo">
          <label for="ajuste-obediencia">Verde</label>
          <input id="ajuste-obediencia" type="number" min="0" max="9999" step="1" value="${estado.obediencia}" />
        </div>
        <div class="folha__campo">
          <label for="ajuste-desobediencia">Vermelho</label>
          <input id="ajuste-desobediencia" type="number" min="0" max="9999" step="1" value="${estado.desobediencia}" />
        </div>
      </div>
      <div class="folha__campo">
        <label for="ajuste-desculpa">Amarelo (desculpas)</label>
        <input id="ajuste-desculpa" type="number" min="0" max="9999" step="1" value="${estado.desculpa || 0}" />
      </div>
    `,
    acoes: [
      {
        rotulo: "Cancelar",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: "Salvar",
        classe: "folha__btn--primario",
        onClick: async () => {
          const o = Number(folha.query("#ajuste-obediencia").value);
          const d = Number(folha.query("#ajuste-desobediencia").value);
          const a = Number(folha.query("#ajuste-desculpa").value);
          try {
            const dados = await definirDia(diaAtivo, o, d, a);
            aplicarEstadoDia(dados, { animar: true });
            await sincronizarHistorico();
            definirStatus("Dia ajustado", "is-ok");
            folha.fechar();
          } catch (erro) {
            definirStatus(erro.message || "Falha no ajuste", "is-erro");
          }
        },
      },
    ],
  });
  folhaAberta = folha;
}

function iniciarPolling() {
  pararPolling();
  pollId = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (folhaAberta) return;
    sincronizarDia({ silencioso: true });
  }, INTERVALO_POLL_MS);
}

function pararPolling() {
  if (pollId) {
    clearInterval(pollId);
    pollId = null;
  }
}

function ligarInteracoes() {
  document.querySelectorAll(".btn[data-tipo]").forEach((botao) => {
    botao.addEventListener("click", () => {
      botao.classList.add("is-pulse");
      window.setTimeout(() => botao.classList.remove("is-pulse"), 280);
      const tipo = botao.getAttribute("data-tipo");
      const delta = Number(botao.getAttribute("data-delta"));
      // + e − passam pela folha: observação nasce ligada ao ponto
      abrirFolhaMarcarPonto(tipo, delta);
    });
  });

  document.querySelectorAll(".periodo__btn").forEach((botao) => {
    botao.addEventListener("click", async () => {
      periodoDias = Number(botao.getAttribute("data-dias"));
      document.querySelectorAll(".periodo__btn").forEach((outro) => {
        const ativo = outro === botao;
        outro.classList.toggle("is-ativo", ativo);
        outro.setAttribute("aria-pressed", ativo ? "true" : "false");
      });
      await sincronizarHistorico();
    });
  });

  btnDiaAnterior.addEventListener("click", async () => {
    diaAtivo = somarDias(diaAtivo || hojeIsoLocal(), -1);
    await sincronizarDia();
  });

  btnDiaProximo.addEventListener("click", async () => {
    const hoje = hojeIsoLocal();
    const proximo = somarDias(diaAtivo || hoje, 1);
    if (proximo > hoje) return;
    diaAtivo = proximo;
    await sincronizarDia();
  });

  btnEscolherDia.addEventListener("click", abrirFolhaEscolherDia);
  btnAjusteManual.addEventListener("click", abrirFolhaAjusteManual);

  elListaLog.addEventListener("click", (ev) => {
    const editar = ev.target.closest("[data-editar-id]");
    if (editar) {
      const id = Number(editar.getAttribute("data-editar-id"));
      const evento = (estado.eventos || []).find((item) => item.id === id);
      if (!evento) return;
      abrirFolhaNota({
        eventoId: id,
        comentarioInicial: evento.comentario || "",
        titulo: "Editar observação",
      });
      return;
    }

    const excluir = ev.target.closest("[data-excluir-id]");
    if (excluir) {
      const id = Number(excluir.getAttribute("data-excluir-id"));
      const evento = (estado.eventos || []).find((item) => item.id === id);
      if (!evento) return;
      abrirFolhaExcluir(evento);
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    sincronizarDia({ silencioso: true });
    iniciarPolling();
  } else {
    pararPolling();
  }
});

async function iniciar() {
  diaAtivo = hojeIsoLocal();
  diaHojeCache = diaAtivo;
  ligarInteracoes();
  try {
    await inicializarGrafico(canvas);
  } catch (erro) {
    console.warn(erro);
    definirStatus("Gráfico indisponível", "is-erro");
  }
  await sincronizarDia();
  await sincronizarHistorico();
  iniciarPolling();
}

iniciar();
