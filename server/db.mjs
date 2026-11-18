import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diaAtual, diaPermitido, listarDiasRecentes } from "./dias.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pastaDados = join(__dirname, "data");
const caminhoDb = join(pastaDados, "counters.json");
const COMENTARIO_MAX = 280;
const EVENTOS_MAX = 5000;

mkdirSync(pastaDados, { recursive: true });

function estadoVazio() {
  return { proximoId: 1, dias: {}, eventos: [] };
}

function carregar() {
  if (!existsSync(caminhoDb)) return estadoVazio();
  try {
    const dados = JSON.parse(readFileSync(caminhoDb, "utf8"));
    if (!dados || typeof dados !== "object") return estadoVazio();
    if (!dados.dias || typeof dados.dias !== "object") dados.dias = {};
    if (!Array.isArray(dados.eventos)) dados.eventos = [];
    if (!Number.isInteger(dados.proximoId) || dados.proximoId < 1) {
      const maxId = dados.eventos.reduce(
        (acc, ev) => Math.max(acc, Number(ev.id) || 0),
        0
      );
      dados.proximoId = maxId + 1;
    }
    return dados;
  } catch {
    return estadoVazio();
  }
}

function salvar(estado) {
  const tmp = `${caminhoDb}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(estado)}\n`, "utf8");
  renameSync(tmp, caminhoDb);
}

function agoraIso() {
  return new Date().toISOString();
}

function normalizarComentario(valor) {
  if (valor == null || valor === "") return "";
  if (typeof valor !== "string") {
    const erro = new Error("Comentário inválido");
    erro.status = 400;
    throw erro;
  }
  return valor.trim().slice(0, COMENTARIO_MAX);
}

function garantirDia(estado, dia) {
  if (!estado.dias[dia]) {
    estado.dias[dia] = {
      dia,
      obediencia: 0,
      desobediencia: 0,
      atualizadoEm: agoraIso(),
    };
    return { registro: estado.dias[dia], criado: true };
  }
  return { registro: estado.dias[dia], criado: false };
}

function snapshotDia(registro) {
  return {
    dia: registro.dia,
    obediencia: registro.obediencia,
    desobediencia: registro.desobediencia,
    atualizadoEm: registro.atualizadoEm,
  };
}

function eventosDoDia(estado, dia, { incluirExcluidos = false } = {}) {
  return estado.eventos
    .filter(
      (ev) =>
        ev.dia === dia && (incluirExcluidos || !ev.excluidoEm)
    )
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

function resolverDiaAlvo(diaInformado) {
  const hoje = diaAtual();
  const dia = diaInformado || hoje;
  if (!diaPermitido(dia)) {
    const erro = new Error("Dia inválido ou futuro");
    erro.status = 400;
    throw erro;
  }
  return dia;
}

function encontrarEvento(estado, eventoId) {
  const id = Number(eventoId);
  if (!Number.isInteger(id) || id < 1) {
    const erro = new Error("Evento inválido");
    erro.status = 400;
    throw erro;
  }
  const evento = estado.eventos.find((ev) => ev.id === id);
  if (!evento) {
    const erro = new Error("Evento não encontrado");
    erro.status = 404;
    throw erro;
  }
  return evento;
}

function aplicarDeltaNoDia(registro, tipo, delta) {
  if (tipo === "obediencia") {
    registro.obediencia = Math.max(0, registro.obediencia + delta);
  } else if (tipo === "desobediencia") {
    registro.desobediencia = Math.max(0, registro.desobediencia + delta);
  }
  registro.atualizadoEm = agoraIso();
}

function respostaDia(estado, dia, evento = null) {
  const registro = garantirDia(estado, dia).registro;
  return {
    ...snapshotDia(registro),
    eventos: eventosDoDia(estado, dia),
    evento: evento ? { ...evento } : null,
  };
}

export function obterHoje() {
  return obterDia(diaAtual());
}

export function obterDia(diaInformado) {
  const dia = resolverDiaAlvo(diaInformado);
  const estado = carregar();
  const { registro, criado } = garantirDia(estado, dia);
  if (criado) salvar(estado);
  return {
    ...snapshotDia(registro),
    eventos: eventosDoDia(estado, dia),
  };
}

export function registrarEvento(tipo, delta, opcoes = {}) {
  if (tipo !== "obediencia" && tipo !== "desobediencia") {
    const erro = new Error("Tipo inválido");
    erro.status = 400;
    throw erro;
  }
  if (delta !== 1 && delta !== -1) {
    const erro = new Error("Delta inválido");
    erro.status = 400;
    throw erro;
  }

  const comentario = normalizarComentario(opcoes.comentario);
  const dia = resolverDiaAlvo(opcoes.dia);
  const estado = carregar();
  const { registro: atual } = garantirDia(estado, dia);

  const proximo = {
    dia,
    obediencia: atual.obediencia,
    desobediencia: atual.desobediencia,
    atualizadoEm: agoraIso(),
  };

  if (tipo === "obediencia") {
    proximo.obediencia = Math.max(0, atual.obediencia + delta);
  } else {
    proximo.desobediencia = Math.max(0, atual.desobediencia + delta);
  }

  if (
    proximo.obediencia === atual.obediencia &&
    proximo.desobediencia === atual.desobediencia
  ) {
    return respostaDia(estado, dia, null);
  }

  const evento = {
    id: estado.proximoId++,
    dia,
    tipo,
    delta,
    comentario,
    criadoEm: agoraIso(),
    excluidoEm: null,
  };

  estado.dias[dia] = proximo;
  estado.eventos.push(evento);
  if (estado.eventos.length > EVENTOS_MAX) {
    estado.eventos = estado.eventos.slice(-(EVENTOS_MAX - 1000));
  }
  salvar(estado);

  return respostaDia(estado, dia, evento);
}

export function definirContagens(diaInformado, obediencia, desobediencia) {
  const dia = resolverDiaAlvo(diaInformado);
  const o = Number(obediencia);
  const d = Number(desobediencia);
  if (!Number.isInteger(o) || !Number.isInteger(d) || o < 0 || d < 0) {
    const erro = new Error("Contagens inválidas");
    erro.status = 400;
    throw erro;
  }
  if (o > 9999 || d > 9999) {
    const erro = new Error("Contagem alta demais");
    erro.status = 400;
    throw erro;
  }

  const estado = carregar();
  const { registro: atual } = garantirDia(estado, dia);
  const agora = agoraIso();

  if (atual.obediencia === o && atual.desobediencia === d) {
    return respostaDia(estado, dia, null);
  }

  const evento = {
    id: estado.proximoId++,
    dia,
    tipo: "ajuste",
    delta: 0,
    comentario: `Ajuste manual: O ${atual.obediencia}→${o} · D ${atual.desobediencia}→${d}`,
    criadoEm: agora,
    excluidoEm: null,
    antes: {
      obediencia: atual.obediencia,
      desobediencia: atual.desobediencia,
    },
    depois: { obediencia: o, desobediencia: d },
  };

  estado.dias[dia] = {
    dia,
    obediencia: o,
    desobediencia: d,
    atualizadoEm: agora,
  };
  estado.eventos.push(evento);
  if (estado.eventos.length > EVENTOS_MAX) {
    estado.eventos = estado.eventos.slice(-(EVENTOS_MAX - 1000));
  }
  salvar(estado);

  return respostaDia(estado, dia, evento);
}

export function atualizarComentario(eventoId, comentarioBruto) {
  const estado = carregar();
  const evento = encontrarEvento(estado, eventoId);
  if (evento.excluidoEm) {
    const erro = new Error("Evento excluído não pode ser editado");
    erro.status = 400;
    throw erro;
  }
  if (evento.tipo === "ajuste") {
    const erro = new Error("Ajuste automático não pode ser editado");
    erro.status = 400;
    throw erro;
  }

  evento.comentario = normalizarComentario(comentarioBruto);
  evento.editadoEm = agoraIso();
  salvar(estado);
  return respostaDia(estado, evento.dia, evento);
}

/** Soft delete: marca excluidoEm e desfaz o efeito no contador do dia. */
export function excluirEvento(eventoId) {
  const estado = carregar();
  const evento = encontrarEvento(estado, eventoId);

  if (evento.excluidoEm) {
    return respostaDia(estado, evento.dia, evento);
  }
  if (evento.tipo === "ajuste") {
    const erro = new Error("Ajuste manual não pode ser excluído assim");
    erro.status = 400;
    throw erro;
  }

  const { registro } = garantirDia(estado, evento.dia);
  // desfaz o delta original (+1 → −1, −1 → +1)
  aplicarDeltaNoDia(registro, evento.tipo, -evento.delta);
  evento.excluidoEm = agoraIso();
  salvar(estado);
  return respostaDia(estado, evento.dia, evento);
}

/** Restaura um soft delete e reaplica o delta no contador. */
export function restaurarEvento(eventoId) {
  const estado = carregar();
  const evento = encontrarEvento(estado, eventoId);

  if (!evento.excluidoEm) {
    return respostaDia(estado, evento.dia, evento);
  }
  if (evento.tipo === "ajuste") {
    const erro = new Error("Ajuste não pode ser restaurado assim");
    erro.status = 400;
    throw erro;
  }

  const { registro } = garantirDia(estado, evento.dia);
  aplicarDeltaNoDia(registro, evento.tipo, evento.delta);
  evento.excluidoEm = null;
  evento.restauradoEm = agoraIso();
  salvar(estado);
  return respostaDia(estado, evento.dia, evento);
}

export function obterHistorico(quantidadeDias = 30) {
  const estado = carregar();
  return listarDiasRecentes(quantidadeDias).map((dia) => {
    const existente = estado.dias[dia];
    if (existente) {
      return {
        ...snapshotDia(existente),
        notas: eventosDoDia(estado, dia).filter((ev) => ev.comentario).length,
      };
    }
    return {
      dia,
      obediencia: 0,
      desobediencia: 0,
      atualizadoEm: null,
      notas: 0,
    };
  });
}

export function fecharDb() {}

export { COMENTARIO_MAX };
