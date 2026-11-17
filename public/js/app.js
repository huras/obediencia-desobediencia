import {
  buscarDia,
  buscarHistorico,
  enviarEvento,
  definirDia,
  salvarComentario,
} from "./api.js";
import {
  inicializarGrafico,
  atualizarGrafico,
  calcularResumo,
} from "./charts.js";
import { criarFolha } from "./folha.js";

const INTERVALO_POLL_MS = 2500;
const COMENTARIO_MAX = 280;

const elData = document.getElementById("rotulo-data");
const elDicaDia = document.getElementById("dica-dia");
const elStatus = document.getElementById("status-sync");
const elObediencia = document.getElementById("valor-obediencia");
const elDesobediencia = document.getElementById("valor-desobediencia");
const elResumoObediencia = document.getElementById("resumo-obediencia");
const elResumoDesobediencia = document.getElementById("resumo-desobediencia");
const elResumoRazao = document.getElementById("resumo-razao");
const elListaLog = document.getElementById("lista-log");
const elLogVazio = document.getElementById("log-vazio");
const btnDiaAnterior = document.getElementById("btn-dia-anterior");
const btnDiaProximo = document.getElementById("btn-dia-proximo");
const btnEscolherDia = document.getElementById("btn-escolher-dia");
const btnAjusteManual = document.getElementById("btn-ajuste-manual");
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

function pintarContadores(proximo, { animar = false } = {}) {
  const mudouObediencia = proximo.obediencia !== estado.obediencia;
  const mudouDesobediencia = proximo.desobediencia !== estado.desobediencia;

  elObediencia.textContent = String(proximo.obediencia);
  elDesobediencia.textContent = String(proximo.desobediencia);

  if (animar && mudouObediencia) animarBump(elObediencia);
  if (animar && mudouDesobediencia) animarBump(elDesobediencia);

  estado = {
    ...estado,
    ...proximo,
    eventos: Array.isArray(proximo.eventos) ? proximo.eventos : estado.eventos,
  };
}

function pintarResumo(serie) {
  const resumo = calcularResumo(serie);
  elResumoObediencia.textContent = String(resumo.obediencia);
  elResumoDesobediencia.textContent = String(resumo.desobediencia);
  elResumoRazao.textContent =
    resumo.razao === null ? "—" : `${resumo.razao}%`;
}

function rotuloTipo(tipo) {
  if (tipo === "obediencia") return "Obediência";
  if (tipo === "desobediencia") return "Desobediência";
  return "Ajuste";
}

function badgeDelta(evento) {
  if (evento.tipo === "ajuste") return "±";
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
      : "Sem nota";
    const podeEditar = evento.tipo !== "ajuste";

    li.innerHTML = `
      <span class="log__badge">${badgeDelta(evento)}</span>
      <div>
        <p class="log__meta">${rotuloTipo(evento.tipo)} · ${hora}</p>
        <p class="log__comentario ${evento.comentario ? "" : "is-vazio"}">${comentario}</p>
      </div>
      ${
        podeEditar
          ? `<button type="button" class="log__editar" data-editar-id="${evento.id}">Nota</button>`
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

function abrirFolhaNota({ eventoId, comentarioInicial = "", titulo }) {
  fecharFolhaAtual();
  const folha = criarFolha({
    titulo: titulo || "Nota do ponto",
    corpoHtml: `
      <div class="folha__campo">
        <label for="campo-comentario">Comentário (opcional, até ${COMENTARIO_MAX})</label>
        <textarea id="campo-comentario" maxlength="${COMENTARIO_MAX}" placeholder="Ex.: guardou o brinquedo sem reclamar">${escaparHtml(comentarioInicial)}</textarea>
      </div>
    `,
    acoes: [
      {
        rotulo: "Pular",
        classe: "folha__btn--ghost",
        onClick: () => folha.fechar(),
      },
      {
        rotulo: "Salvar nota",
        classe: "folha__btn--primario",
        onClick: async () => {
          const texto = folha.query("#campo-comentario").value.trim();
          try {
            const dados = await salvarComentario(eventoId, texto);
            aplicarEstadoDia(dados);
            await sincronizarHistorico();
            definirStatus("Nota salva", "is-ok");
            folha.fechar();
          } catch (erro) {
            definirStatus(erro.message || "Falha ao salvar nota", "is-erro");
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
          <label for="ajuste-obediencia">Obediência</label>
          <input id="ajuste-obediencia" type="number" min="0" max="9999" step="1" value="${estado.obediencia}" />
        </div>
        <div class="folha__campo">
          <label for="ajuste-desobediencia">Desobediência</label>
          <input id="ajuste-desobediencia" type="number" min="0" max="9999" step="1" value="${estado.desobediencia}" />
        </div>
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
          try {
            const dados = await definirDia(diaAtivo, o, d);
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

function enfileirarEvento(tipo, delta, botao) {
  botao.classList.add("is-pulse");
  window.setTimeout(() => botao.classList.remove("is-pulse"), 280);

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
      const confirmado = await enviarEvento({
        tipo,
        delta,
        dia: diaAtivo,
      });
      aplicarEstadoDia(confirmado, { animar: false });
      await sincronizarHistorico();
      definirStatus(
        ehHoje(confirmado.dia) ? "Ao vivo · compartilhado" : "Dia passado atualizado",
        "is-ok"
      );

      if (confirmado.evento && delta === 1) {
        abrirFolhaNota({
          eventoId: confirmado.evento.id,
          titulo:
            tipo === "obediencia"
              ? "Nota da obediência"
              : "Nota da desobediência",
        });
      }
    })
    .catch(async (erro) => {
      console.warn("Falha ao enviar evento", erro);
      definirStatus("Não deu para salvar. Tentando sincronizar…", "is-erro");
      await sincronizarDia();
    });
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
    const botao = ev.target.closest("[data-editar-id]");
    if (!botao) return;
    const id = Number(botao.getAttribute("data-editar-id"));
    const evento = (estado.eventos || []).find((item) => item.id === id);
    if (!evento) return;
    abrirFolhaNota({
      eventoId: id,
      comentarioInicial: evento.comentario || "",
      titulo: "Editar nota",
    });
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
