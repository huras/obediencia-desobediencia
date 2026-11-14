import { buscarHoje, buscarHistorico, enviarEvento } from "./api.js";
import {
  inicializarGrafico,
  atualizarGrafico,
  calcularResumo,
} from "./charts.js";

const INTERVALO_POLL_MS = 2500;

const elData = document.getElementById("rotulo-data");
const elStatus = document.getElementById("status-sync");
const elObediencia = document.getElementById("valor-obediencia");
const elDesobediencia = document.getElementById("valor-desobediencia");
const elResumoObediencia = document.getElementById("resumo-obediencia");
const elResumoDesobediencia = document.getElementById("resumo-desobediencia");
const elResumoRazao = document.getElementById("resumo-razao");
const canvas = document.getElementById("grafico-progresso");

let estado = {
  dia: null,
  obediencia: 0,
  desobediencia: 0,
  atualizadoEm: null,
};

let periodoDias = 7;
let abortPoll = null;
let abortHistorico = null;
let filaEnvio = Promise.resolve();
let pollId = null;
const formatadorData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function definirStatus(texto, tipo = "") {
  elStatus.textContent = texto;
  elStatus.classList.remove("is-ok", "is-erro");
  if (tipo) elStatus.classList.add(tipo);
}

function animarBump(elemento) {
  elemento.classList.remove("is-bump");
  // força reflow para reiniciar animação
  void elemento.offsetWidth;
  elemento.classList.add("is-bump");
  window.setTimeout(() => elemento.classList.remove("is-bump"), 220);
}

function pintarContadores(proximo, { animar = false } = {}) {
  const mudouObediencia = proximo.obediencia !== estado.obediencia;
  const mudouDesobediencia = proximo.desobediencia !== estado.desobediencia;

  elObediencia.textContent = String(proximo.obediencia);
  elDesobediencia.textContent = String(proximo.desobediencia);

  if (animar && mudouObediencia) animarBump(elObediencia);
  if (animar && mudouDesobediencia) animarBump(elDesobediencia);

  estado = { ...proximo };
}

function formatarRotuloDia(diaIso) {
  if (!diaIso) return formatadorData.format(new Date());
  const [ano, mes, dia] = diaIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia, 15, 0, 0));
  return formatadorData.format(data);
}

function pintarResumo(serie) {
  const resumo = calcularResumo(serie);
  elResumoObediencia.textContent = String(resumo.obediencia);
  elResumoDesobediencia.textContent = String(resumo.desobediencia);
  elResumoRazao.textContent =
    resumo.razao === null ? "—" : `${resumo.razao}%`;
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

async function sincronizarHoje({ silencioso = false } = {}) {
  if (abortPoll) abortPoll.abort();
  abortPoll = new AbortController();

  try {
    const dados = await buscarHoje(abortPoll.signal);
    const mudou =
      dados.obediencia !== estado.obediencia ||
      dados.desobediencia !== estado.desobediencia ||
      dados.dia !== estado.dia;

    pintarContadores(dados, { animar: mudou && silencioso });
    elData.textContent = formatarRotuloDia(dados.dia);

    if (!silencioso || mudou) {
      definirStatus("Ao vivo · compartilhado", "is-ok");
    }

    if (mudou) {
      await sincronizarHistorico();
    }
  } catch (erro) {
    if (erro.name === "AbortError") return;
    definirStatus("Sem conexão com o servidor", "is-erro");
  }
}

function enfileirarEvento(tipo, delta, botao) {
  botao.classList.add("is-pulse");
  window.setTimeout(() => botao.classList.remove("is-pulse"), 280);

  // Optimistic UI
  const otimista = {
    ...estado,
    obediencia:
      tipo === "obediencia"
        ? Math.max(0, estado.obediencia + delta)
        : estado.obediencia,
    desobediencia:
      tipo === "desobediencia"
        ? Math.max(0, estado.desobediencia + delta)
        : estado.desobediencia,
  };
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
      const confirmado = await enviarEvento(tipo, delta);
      pintarContadores(confirmado, { animar: false });
      await sincronizarHistorico();
      definirStatus("Ao vivo · compartilhado", "is-ok");
    })
    .catch(async (erro) => {
      console.warn("Falha ao enviar evento", erro);
      definirStatus("Não deu para salvar. Tentando sincronizar…", "is-erro");
      await sincronizarHoje();
    });
}

function iniciarPolling() {
  pararPolling();
  pollId = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    sincronizarHoje({ silencioso: true });
  }, INTERVALO_POLL_MS);
}

function pararPolling() {
  if (pollId) {
    clearInterval(pollId);
    pollId = null;
  }
}

function ligarBotoes() {
  document.querySelectorAll(".btn[data-tipo]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const tipo = botao.getAttribute("data-tipo");
      const delta = Number(botao.getAttribute("data-delta"));
      enfileirarEvento(tipo, delta, botao);
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
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    sincronizarHoje({ silencioso: true });
    iniciarPolling();
  } else {
    pararPolling();
  }
});

async function iniciar() {
  ligarBotoes();
  try {
    await inicializarGrafico(canvas);
  } catch (erro) {
    console.warn(erro);
    definirStatus("Gráfico indisponível", "is-erro");
  }
  await sincronizarHoje();
  await sincronizarHistorico();
  iniciarPolling();
}

iniciar();
